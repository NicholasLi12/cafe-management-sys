ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS has_sizes boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS size_prices jsonb NOT NULL
    DEFAULT '{"Small": -10, "Medium": 0, "Large": 15}'::jsonb;

UPDATE public.menu_items
SET has_sizes = false
WHERE category ~* '(food|pastry|bakery|dessert|snack)';

UPDATE public.menu_items
SET size_prices = '{"Small": -10, "Medium": 0, "Large": 15}'::jsonb
WHERE size_prices IS NULL OR jsonb_typeof(size_prices) <> 'object';

ALTER TABLE public.menu_items
  ALTER COLUMN has_sizes SET DEFAULT true,
  ALTER COLUMN has_sizes SET NOT NULL,
  ALTER COLUMN size_prices SET DEFAULT '{"Small": -10, "Medium": 0, "Large": 15}'::jsonb,
  ALTER COLUMN size_prices SET NOT NULL;

CREATE OR REPLACE FUNCTION public.create_paid_order_atomic_sized(
  p_table_id uuid,
  p_order_type text,
  p_payment_method text,
  p_notes text,
  p_platform_name text,
  p_external_order_ref text,
  p_platform_fee numeric,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid := public.current_franchise_id();
  v_order_id uuid;
  v_item jsonb;
  v_modifier jsonb;
  v_recipe record;
  v_rule record;
  v_menu_item_id uuid;
  v_supply_id uuid;
  v_quantity int;
  v_quantity_used numeric(10, 3);
  v_unit_price numeric(10, 2);
  v_base_price numeric(10, 2);
  v_modifier_upcharge numeric(10, 2);
  v_size text;
  v_size_multiplier numeric(5, 2);
  v_has_sizes boolean;
  v_size_prices jsonb;
  v_updated_supply public.supplies%ROWTYPE;
  v_total numeric(10, 2) := 0;
  v_cogs numeric(10, 2) := 0;
  v_item_modifiers jsonb;
BEGIN
  IF v_owner_id IS NULL OR auth.uid() IS NULL OR public.current_user_role() NOT IN ('admin', 'barista') THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_order_type IS NULL OR p_order_type NOT IN ('dine_in', 'pickup', 'online_delivery') THEN
    RAISE EXCEPTION 'Unsupported order type';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'qr_transfer') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;
  IF COALESCE(p_platform_fee, 0) < 0 OR COALESCE(p_platform_fee, 0) = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Platform fee cannot be negative';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;
  IF p_order_type = 'dine_in' THEN
    IF p_table_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.cafe_tables WHERE id = p_table_id AND owner_id = v_owner_id
    ) THEN
      RAISE EXCEPTION 'Select one of your cafe tables for dine-in';
    END IF;
  ELSIF p_table_id IS NOT NULL THEN
    RAISE EXCEPTION 'Non-dine-in orders cannot be assigned to a table';
  ELSIF p_order_type = 'online_delivery' AND NULLIF(trim(p_platform_name), '') IS NULL THEN
    RAISE EXCEPTION 'Delivery platform name is required';
  END IF;

  INSERT INTO public.orders (
    owner_id, table_id, order_type, payment_method, notes, platform_name,
    external_order_ref, platform_fee, status, prep_status, total_amount, cogs_total, closed_at
  )
  VALUES (
    v_owner_id, p_table_id, p_order_type, p_payment_method, p_notes,
    COALESCE(NULLIF(trim(p_platform_name), ''), 'In-House'),
    p_external_order_ref, COALESCE(p_platform_fee, 0), 'paid', 'new', 0, 0, now()
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each order item must be an object';
    END IF;
    v_menu_item_id := (v_item->>'menu_item_id')::uuid;
    v_quantity := (v_item->>'quantity')::int;
    v_item_modifiers := COALESCE(v_item->'modifiers', '[]'::jsonb);
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Order item quantity must be a positive integer';
    END IF;
    IF jsonb_typeof(v_item_modifiers) <> 'array' THEN
      RAISE EXCEPTION 'Order item modifiers must be an array';
    END IF;

    SELECT price, has_sizes, size_prices
    INTO v_base_price, v_has_sizes, v_size_prices
    FROM public.menu_items
    WHERE id = v_menu_item_id AND owner_id = v_owner_id AND is_available = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item is unavailable or does not belong to this cafe';
    END IF;

    v_size := NULL;
    v_size_multiplier := 1.0;
    v_modifier_upcharge := 0;
    FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_item_modifiers)
    LOOP
      IF jsonb_typeof(v_modifier) <> 'object' OR v_modifier->>'group' IS NULL OR v_modifier->>'option' IS NULL THEN
        RAISE EXCEPTION 'Each modifier must include a group and option';
      END IF;
      IF v_modifier->>'group' = 'Size' THEN
        IF NOT v_has_sizes THEN
          RAISE EXCEPTION 'This menu item does not offer drink sizes';
        END IF;
        IF v_size IS NOT NULL THEN
          RAISE EXCEPTION 'Only one drink size may be selected';
        END IF;
        v_size := v_modifier->>'option';
        IF v_size = 'Small' THEN
          v_size_multiplier := 0.8;
        ELSIF v_size = 'Medium' THEN
          v_size_multiplier := 1.0;
        ELSIF v_size = 'Large' THEN
          v_size_multiplier := 1.25;
        ELSE
          RAISE EXCEPTION 'Unsupported drink size: %', v_size;
        END IF;
        v_modifier_upcharge := v_modifier_upcharge
          + COALESCE(NULLIF(v_size_prices->>v_size, '')::numeric, 0);
      ELSIF v_modifier->>'group' = 'Sweetness' AND v_modifier->>'option' IN ('0%', '25%', '50%', '75%', '100%') THEN
        NULL;
      ELSIF v_modifier->>'group' = 'Ice' AND v_modifier->>'option' IN ('Normal', 'Less Ice', 'No Ice', 'Hot') THEN
        NULL;
      ELSIF v_modifier->>'group' = 'Milk' AND v_modifier->>'option' = 'Regular' THEN
        NULL;
      ELSIF v_modifier->>'group' = 'Milk' AND v_modifier->>'option' = 'Oat Milk' THEN
        v_modifier_upcharge := v_modifier_upcharge + 15;
      ELSIF v_modifier->>'group' = 'Milk' AND v_modifier->>'option' = 'Soy Milk' THEN
        v_modifier_upcharge := v_modifier_upcharge + 10;
      ELSIF v_modifier->>'group' = 'Add-on' AND v_modifier->>'option' = 'Extra Espresso Shot' THEN
        v_modifier_upcharge := v_modifier_upcharge + 20;
      ELSIF v_modifier->>'group' = 'Add-on' AND v_modifier->>'option' IN ('Vanilla Syrup', 'Caramel Drizzle') THEN
        v_modifier_upcharge := v_modifier_upcharge + 10;
      ELSE
        RAISE EXCEPTION 'Unsupported drink modifier: %', v_modifier->>'option';
      END IF;
    END LOOP;
    v_unit_price := v_base_price + v_modifier_upcharge;
    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'Drink size adjustment cannot reduce the price below zero';
    END IF;

    INSERT INTO public.order_items (order_id, menu_item_id, quantity, unit_price, modifiers, notes)
    VALUES (v_order_id, v_menu_item_id, v_quantity, v_unit_price, v_item_modifiers, NULLIF(btrim(v_item->>'notes'), ''));
    v_total := v_total + (v_quantity * v_unit_price);

    FOR v_recipe IN
      SELECT supply_id, quantity_used, slot_type
      FROM public.menu_item_recipes
      WHERE tenant_id = v_owner_id AND menu_item_id = v_menu_item_id
    LOOP
      v_supply_id := v_recipe.supply_id;
      v_quantity_used := v_recipe.quantity_used * v_size_multiplier;
      IF v_recipe.slot_type = 'milk' THEN
        FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_item_modifiers)
        LOOP
          SELECT supply_id INTO v_rule
          FROM public.modifier_supply_rules
          WHERE tenant_id = v_owner_id
            AND modifier_name = v_modifier->>'option'
            AND action_type = 'replace_slot'
            AND target_slot = 'milk';
          IF FOUND THEN
            v_supply_id := v_rule.supply_id;
          END IF;
        END LOOP;
      END IF;

      UPDATE public.supplies
      SET current_stock = GREATEST(0, current_stock - (v_quantity_used * v_quantity))
      WHERE id = v_supply_id AND owner_id = v_owner_id
      RETURNING * INTO v_updated_supply;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Recipe ingredient is missing or belongs to another cafe';
      END IF;
      v_cogs := v_cogs + (v_quantity_used * v_quantity * v_updated_supply.unit_cost);
      IF v_updated_supply.current_stock <= v_updated_supply.low_stock_threshold
         AND NOT EXISTS (
           SELECT 1 FROM public.restock_orders
           WHERE supply_id = v_updated_supply.id AND status IN ('pending_approval', 'ordered')
         ) THEN
        INSERT INTO public.restock_orders (owner_id, supply_id, quantity_ordered, estimated_cost, status)
        VALUES (
          v_updated_supply.owner_id, v_updated_supply.id, v_updated_supply.auto_reorder_qty,
          v_updated_supply.auto_reorder_qty * v_updated_supply.unit_cost, 'pending_approval'
        );
      END IF;
    END LOOP;

    FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_item_modifiers)
    LOOP
      SELECT supply_id, quantity_used INTO v_rule
      FROM public.modifier_supply_rules
      WHERE tenant_id = v_owner_id
        AND modifier_name = CASE
          WHEN v_modifier->>'group' = 'Size' THEN (v_modifier->>'option') || ' Cup'
          ELSE v_modifier->>'option'
        END
        AND action_type = 'add_ingredient';
      IF FOUND THEN
        UPDATE public.supplies
        SET current_stock = GREATEST(0, current_stock - (v_rule.quantity_used * v_quantity))
        WHERE id = v_rule.supply_id AND owner_id = v_owner_id
        RETURNING * INTO v_updated_supply;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Modifier ingredient is missing or belongs to another cafe';
        END IF;
        v_cogs := v_cogs + (v_rule.quantity_used * v_quantity * v_updated_supply.unit_cost);
        IF v_updated_supply.current_stock <= v_updated_supply.low_stock_threshold
           AND NOT EXISTS (
             SELECT 1 FROM public.restock_orders
             WHERE supply_id = v_updated_supply.id AND status IN ('pending_approval', 'ordered')
           ) THEN
          INSERT INTO public.restock_orders (owner_id, supply_id, quantity_ordered, estimated_cost, status)
          VALUES (
            v_updated_supply.owner_id, v_updated_supply.id, v_updated_supply.auto_reorder_qty,
            v_updated_supply.auto_reorder_qty * v_updated_supply.unit_cost, 'pending_approval'
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.orders
  SET total_amount = v_total, cogs_total = round(v_cogs, 2)
  WHERE id = v_order_id;
  IF p_table_id IS NOT NULL THEN
    UPDATE public.cafe_tables SET status = 'occupied'
    WHERE id = p_table_id AND owner_id = v_owner_id;
  END IF;
  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_paid_order_atomic_sized(uuid, text, text, text, text, text, numeric, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_paid_order_atomic(
  p_table_id uuid,
  p_order_type text,
  p_payment_method text,
  p_notes text,
  p_platform_name text,
  p_external_order_ref text,
  p_platform_fee numeric,
  p_items jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.create_paid_order_atomic_sized(
    p_table_id, p_order_type, p_payment_method, p_notes, p_platform_name,
    p_external_order_ref, p_platform_fee, p_items
  );
$$;

REVOKE ALL ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
