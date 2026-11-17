ALTER TABLE public.modifier_supply_rules
  ALTER COLUMN supply_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS group_type text NOT NULL DEFAULT 'addon',
  ADD COLUMN IF NOT EXISTS price_delta numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.modifier_supply_rules
  DROP CONSTRAINT IF EXISTS modifier_supply_rules_action_type_check,
  DROP CONSTRAINT IF EXISTS modifier_supply_rules_slot_check,
  DROP CONSTRAINT IF EXISTS modifier_supply_rules_quantity_check,
  DROP CONSTRAINT IF EXISTS modifier_supply_rules_group_type_check;

UPDATE public.modifier_supply_rules
SET group_type = CASE
      WHEN modifier_name IN ('Oat Milk', 'Soy Milk') THEN 'milk'
      WHEN modifier_name IN ('Small Cup', 'Medium Cup', 'Large Cup') THEN 'size_cup'
      ELSE COALESCE(group_type, 'addon')
    END,
    price_delta = CASE
      WHEN modifier_name = 'Oat Milk' THEN 15
      WHEN modifier_name = 'Soy Milk' THEN 10
      WHEN modifier_name = 'Extra Espresso Shot' THEN 20
      WHEN modifier_name IN ('Vanilla Syrup', 'Caramel Drizzle') THEN 10
      ELSE COALESCE(price_delta, 0)
    END,
    action_type = CASE
      WHEN supply_id IS NULL THEN 'none'
      WHEN action_type IN ('replace_slot', 'add_ingredient') THEN action_type
      ELSE 'none'
    END,
    target_slot = CASE
      WHEN supply_id IS NOT NULL AND action_type = 'replace_slot' THEN 'milk'
      ELSE NULL
    END,
    quantity_used = CASE
      WHEN supply_id IS NOT NULL AND action_type = 'add_ingredient'
        AND modifier_name IN ('Small Cup', 'Medium Cup', 'Large Cup') THEN COALESCE(quantity_used, 1)
      WHEN supply_id IS NOT NULL AND action_type = 'add_ingredient' THEN quantity_used
      ELSE NULL
    END;

ALTER TABLE public.modifier_supply_rules
  ADD CONSTRAINT modifier_supply_rules_action_type_check
    CHECK (action_type IN ('none', 'replace_slot', 'add_ingredient')),
  ADD CONSTRAINT modifier_supply_rules_slot_check CHECK (
    (action_type = 'none' AND target_slot IS NULL AND quantity_used IS NULL)
    OR (action_type = 'replace_slot' AND target_slot = 'milk' AND quantity_used IS NULL)
    OR (action_type = 'add_ingredient' AND target_slot IS NULL AND quantity_used IS NOT NULL AND quantity_used > 0)
  ),
  ADD CONSTRAINT modifier_supply_rules_quantity_check
    CHECK (quantity_used IS NULL OR quantity_used > 0),
  ADD CONSTRAINT modifier_supply_rules_group_type_check
    CHECK (group_type IN ('milk', 'addon', 'size_cup'));

ALTER TABLE public.modifier_supply_rules
  ALTER COLUMN group_type SET DEFAULT 'addon',
  ALTER COLUMN group_type SET NOT NULL,
  ALTER COLUMN price_delta SET DEFAULT 0,
  ALTER COLUMN price_delta SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN sort_order SET DEFAULT 0,
  ALTER COLUMN sort_order SET NOT NULL;

DROP POLICY IF EXISTS "Admins manage franchise modifier supply rules" ON public.modifier_supply_rules;
DROP POLICY IF EXISTS "Franchise members read modifier supply rules" ON public.modifier_supply_rules;
CREATE POLICY "Franchise members read modifier supply rules" ON public.modifier_supply_rules FOR SELECT
  USING (tenant_id = public.current_franchise_id());
CREATE POLICY "Admins manage franchise modifier supply rules" ON public.modifier_supply_rules FOR ALL
  USING (
    tenant_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
    AND (
      supply_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.supplies
        WHERE supplies.id = modifier_supply_rules.supply_id
          AND supplies.owner_id = public.current_franchise_id()
      )
    )
  );

DROP POLICY IF EXISTS "Admins manage franchise menu item recipes" ON public.menu_item_recipes;
DROP POLICY IF EXISTS "Franchise members read menu item recipes" ON public.menu_item_recipes;
CREATE POLICY "Franchise members read menu item recipes" ON public.menu_item_recipes FOR SELECT
  USING (tenant_id = public.current_franchise_id());
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.modifier_supply_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_recipes TO authenticated;

INSERT INTO public.modifier_supply_rules (
  tenant_id, modifier_name, group_type, action_type, target_slot, supply_id,
  quantity_used, price_delta, is_active, sort_order
)
SELECT profile.franchise_owner_id, defaults.modifier_name, defaults.group_type,
       'none', NULL, NULL, NULL, defaults.price_delta, true, defaults.sort_order
FROM public.profiles AS profile
CROSS JOIN (VALUES
  ('Oat Milk', 'milk', 15::numeric, 10),
  ('Soy Milk', 'milk', 10::numeric, 20),
  ('Extra Espresso Shot', 'addon', 20::numeric, 30),
  ('Vanilla Syrup', 'addon', 10::numeric, 40),
  ('Caramel Drizzle', 'addon', 10::numeric, 50)
) AS defaults(modifier_name, group_type, price_delta, sort_order)
WHERE profile.franchise_owner_id IS NOT NULL
ON CONFLICT (tenant_id, modifier_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_paid_order_atomic_dynamic(
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
  v_skip_supply boolean;
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
        IF NOT v_has_sizes OR v_size IS NOT NULL THEN
          RAISE EXCEPTION 'This menu item does not accept the requested drink size';
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
      ELSIF v_modifier->>'group' IN ('Milk', 'Add-on') THEN
        SELECT * INTO v_rule
        FROM public.modifier_supply_rules
        WHERE tenant_id = v_owner_id
          AND modifier_name = v_modifier->>'option'
          AND group_type = CASE WHEN v_modifier->>'group' = 'Milk' THEN 'milk' ELSE 'addon' END
          AND is_active;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Modifier is unavailable: %', v_modifier->>'option';
        END IF;
        v_modifier_upcharge := v_modifier_upcharge + v_rule.price_delta;
      ELSE
        RAISE EXCEPTION 'Unsupported drink modifier group: %', v_modifier->>'group';
      END IF;
    END LOOP;

    v_unit_price := v_base_price + v_modifier_upcharge;
    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'Drink size or modifier adjustment cannot reduce the price below zero';
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
      v_skip_supply := false;
      IF v_recipe.slot_type = 'milk' THEN
        FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_item_modifiers)
        LOOP
          IF v_modifier->>'group' = 'Milk' AND v_modifier->>'option' <> 'Regular' THEN
            SELECT * INTO v_rule
            FROM public.modifier_supply_rules
            WHERE tenant_id = v_owner_id
              AND modifier_name = v_modifier->>'option'
              AND group_type = 'milk'
              AND is_active;
            IF FOUND THEN
              IF v_rule.action_type = 'replace_slot' THEN
                v_supply_id := v_rule.supply_id;
                v_skip_supply := v_rule.supply_id IS NULL;
              ELSIF v_rule.action_type = 'none' THEN
                v_skip_supply := true;
              END IF;
            END IF;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_skip_supply AND v_supply_id IS NOT NULL THEN
        UPDATE public.supplies
        SET current_stock = GREATEST(0, current_stock - (v_quantity_used * v_quantity))
        WHERE id = v_supply_id AND owner_id = v_owner_id
        RETURNING * INTO v_updated_supply;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Recipe ingredient is missing or belongs to another cafe';
        END IF;
        v_cogs := v_cogs + (v_quantity_used * v_quantity * v_updated_supply.unit_cost);
      END IF;
    END LOOP;

    FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_item_modifiers)
    LOOP
      IF v_modifier->>'group' = 'Size' THEN
        SELECT * INTO v_rule
        FROM public.modifier_supply_rules
        WHERE tenant_id = v_owner_id
          AND modifier_name = (v_modifier->>'option') || ' Cup'
          AND group_type = 'size_cup'
          AND is_active
          AND action_type = 'add_ingredient';
        IF FOUND AND v_rule.supply_id IS NOT NULL THEN
          v_quantity_used := COALESCE(v_rule.quantity_used, 1);
        ELSE
          CONTINUE;
        END IF;
      ELSIF v_modifier->>'group' IN ('Milk', 'Add-on') THEN
        SELECT * INTO v_rule
        FROM public.modifier_supply_rules
        WHERE tenant_id = v_owner_id
          AND modifier_name = v_modifier->>'option'
          AND group_type = CASE WHEN v_modifier->>'group' = 'Milk' THEN 'milk' ELSE 'addon' END
          AND is_active
          AND action_type = 'add_ingredient';
        IF NOT FOUND OR v_rule.supply_id IS NULL THEN
          CONTINUE;
        END IF;
        v_quantity_used := v_rule.quantity_used;
      ELSE
        CONTINUE;
      END IF;

      UPDATE public.supplies
      SET current_stock = GREATEST(0, current_stock - (v_quantity_used * v_quantity))
      WHERE id = v_rule.supply_id AND owner_id = v_owner_id
      RETURNING * INTO v_updated_supply;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Modifier supply is missing or belongs to another cafe';
      END IF;
      v_cogs := v_cogs + (v_quantity_used * v_quantity * v_updated_supply.unit_cost);
    END LOOP;
  END LOOP;

  UPDATE public.orders SET total_amount = v_total, cogs_total = round(v_cogs, 2) WHERE id = v_order_id;
  IF p_table_id IS NOT NULL THEN
    UPDATE public.cafe_tables SET status = 'occupied' WHERE id = p_table_id AND owner_id = v_owner_id;
  END IF;
  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_paid_order_atomic_dynamic(uuid, text, text, text, text, text, numeric, jsonb) FROM PUBLIC;

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
  SELECT public.create_paid_order_atomic_dynamic(
    p_table_id, p_order_type, p_payment_method, p_notes, p_platform_name,
    p_external_order_ref, p_platform_fee, p_items
  );
$$;

REVOKE ALL ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
