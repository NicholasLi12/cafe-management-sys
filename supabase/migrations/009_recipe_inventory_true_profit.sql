CREATE TABLE IF NOT EXISTS public.menu_item_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  supply_id uuid NOT NULL REFERENCES public.supplies(id) ON DELETE CASCADE,
  quantity_used numeric(10, 3) NOT NULL CHECK (quantity_used > 0),
  slot_type text NOT NULL DEFAULT 'standard' CHECK (slot_type IN ('standard', 'milk'))
);

CREATE UNIQUE INDEX IF NOT EXISTS menu_item_recipes_item_supply_slot_key
  ON public.menu_item_recipes(menu_item_id, supply_id, slot_type);
CREATE INDEX IF NOT EXISTS menu_item_recipes_tenant_item_idx
  ON public.menu_item_recipes(tenant_id, menu_item_id);

INSERT INTO public.menu_item_recipes (tenant_id, menu_item_id, supply_id, quantity_used, slot_type)
SELECT menu_items.owner_id, old_recipe.menu_item_id, old_recipe.supply_id, old_recipe.quantity_required, 'standard'
FROM public.menu_item_ingredients AS old_recipe
JOIN public.menu_items ON menu_items.id = old_recipe.menu_item_id
JOIN public.supplies ON supplies.id = old_recipe.supply_id
WHERE menu_items.owner_id = supplies.owner_id
ON CONFLICT (menu_item_id, supply_id, slot_type) DO NOTHING;

ALTER TABLE public.supplies
  ALTER COLUMN current_stock TYPE numeric(12, 3) USING current_stock::numeric(12, 3),
  ALTER COLUMN low_stock_threshold TYPE numeric(12, 3) USING low_stock_threshold::numeric(12, 3),
  ALTER COLUMN auto_reorder_qty TYPE numeric(12, 3) USING auto_reorder_qty::numeric(12, 3);

ALTER TABLE public.restock_orders
  ALTER COLUMN quantity_ordered TYPE numeric(12, 3) USING quantity_ordered::numeric(12, 3);

CREATE TABLE IF NOT EXISTS public.modifier_supply_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modifier_name text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('replace_slot', 'add_ingredient')),
  target_slot text,
  supply_id uuid NOT NULL REFERENCES public.supplies(id) ON DELETE CASCADE,
  quantity_used numeric(10, 3),
  CONSTRAINT modifier_supply_rules_slot_check CHECK (
    (action_type = 'replace_slot' AND target_slot IS NOT NULL AND target_slot IN ('milk'))
    OR (action_type = 'add_ingredient' AND target_slot IS NULL AND quantity_used IS NOT NULL AND quantity_used > 0)
  ),
  CONSTRAINT modifier_supply_rules_quantity_check CHECK (quantity_used IS NULL OR quantity_used > 0),
  CONSTRAINT modifier_supply_rules_tenant_modifier_key UNIQUE (tenant_id, modifier_name)
);

ALTER TABLE public.menu_item_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_supply_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage franchise menu item recipes" ON public.menu_item_recipes;
CREATE POLICY "Admins manage franchise menu item recipes" ON public.menu_item_recipes FOR ALL
  USING (
    tenant_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE menu_items.id = menu_item_recipes.menu_item_id
        AND menu_items.owner_id = public.current_franchise_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.supplies
      WHERE supplies.id = menu_item_recipes.supply_id
        AND supplies.owner_id = public.current_franchise_id()
    )
  );

DROP POLICY IF EXISTS "Admins manage franchise modifier supply rules" ON public.modifier_supply_rules;
CREATE POLICY "Admins manage franchise modifier supply rules" ON public.modifier_supply_rules FOR ALL
  USING (
    tenant_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.supplies
      WHERE supplies.id = modifier_supply_rules.supply_id
        AND supplies.owner_id = public.current_franchise_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_recipes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.modifier_supply_rules TO authenticated;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cogs_total numeric(10, 2) NOT NULL DEFAULT 0;

UPDATE public.orders AS orders
SET cogs_total = COALESCE((
  SELECT round(SUM(order_items.quantity * menu_items.estimated_cost), 2)
  FROM public.order_items
  JOIN public.menu_items ON menu_items.id = order_items.menu_item_id
  WHERE order_items.order_id = orders.id
), 0)
WHERE orders.cogs_total = 0;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS modifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text;

DROP TRIGGER IF EXISTS trg_auto_deduct_supplies ON public.order_items;

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
      SELECT 1 FROM public.cafe_tables
      WHERE id = p_table_id AND owner_id = v_owner_id
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
    SELECT price INTO v_base_price
    FROM public.menu_items
    WHERE id = v_menu_item_id AND owner_id = v_owner_id AND is_available = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item is unavailable or does not belong to this cafe';
    END IF;

    v_modifier_upcharge := 0;
    FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_item_modifiers)
    LOOP
      IF jsonb_typeof(v_modifier) <> 'object' OR v_modifier->>'group' IS NULL OR v_modifier->>'option' IS NULL THEN
        RAISE EXCEPTION 'Each modifier must include a group and option';
      END IF;
      IF v_modifier->>'group' = 'Sweetness' AND v_modifier->>'option' IN ('0%', '25%', '50%', '75%', '100%') THEN
        v_modifier_upcharge := v_modifier_upcharge;
      ELSIF v_modifier->>'group' = 'Ice' AND v_modifier->>'option' IN ('Normal', 'Less Ice', 'No Ice', 'Hot') THEN
        v_modifier_upcharge := v_modifier_upcharge;
      ELSIF v_modifier->>'group' = 'Milk' AND v_modifier->>'option' = 'Regular' THEN
        v_modifier_upcharge := v_modifier_upcharge;
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

    INSERT INTO public.order_items (order_id, menu_item_id, quantity, unit_price, modifiers, notes)
    VALUES (
      v_order_id, v_menu_item_id, v_quantity, v_unit_price, v_item_modifiers,
      NULLIF(btrim(v_item->>'notes'), '')
    );
    v_total := v_total + (v_quantity * v_unit_price);

    FOR v_recipe IN
      SELECT supply_id, quantity_used, slot_type
      FROM public.menu_item_recipes
      WHERE tenant_id = v_owner_id AND menu_item_id = v_menu_item_id
    LOOP
      v_supply_id := v_recipe.supply_id;
      v_quantity_used := v_recipe.quantity_used;

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
           WHERE supply_id = v_updated_supply.id
             AND status IN ('pending_approval', 'ordered')
         ) THEN
        INSERT INTO public.restock_orders (owner_id, supply_id, quantity_ordered, estimated_cost, status)
        VALUES (
          v_updated_supply.owner_id,
          v_updated_supply.id,
          v_updated_supply.auto_reorder_qty,
          v_updated_supply.auto_reorder_qty * v_updated_supply.unit_cost,
          'pending_approval'
        );
      END IF;
    END LOOP;

    FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_item_modifiers)
    LOOP
      SELECT supply_id, quantity_used INTO v_rule
      FROM public.modifier_supply_rules
      WHERE tenant_id = v_owner_id
        AND modifier_name = v_modifier->>'option'
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
             WHERE supply_id = v_updated_supply.id
               AND status IN ('pending_approval', 'ordered')
           ) THEN
          INSERT INTO public.restock_orders (owner_id, supply_id, quantity_ordered, estimated_cost, status)
          VALUES (
            v_updated_supply.owner_id,
            v_updated_supply.id,
            v_updated_supply.auto_reorder_qty,
            v_updated_supply.auto_reorder_qty * v_updated_supply.unit_cost,
            'pending_approval'
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.orders
  SET total_amount = v_total,
      cogs_total = round(v_cogs, 2)
  WHERE id = v_order_id;

  IF p_table_id IS NOT NULL THEN
    UPDATE public.cafe_tables SET status = 'occupied'
    WHERE id = p_table_id AND owner_id = v_owner_id;
  END IF;
  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
