ALTER TABLE public.supplies
  ADD COLUMN IF NOT EXISTS low_stock_threshold numeric NOT NULL DEFAULT 0;
ALTER TABLE public.supplies
  ALTER COLUMN low_stock_threshold SET DEFAULT 0;

DROP POLICY IF EXISTS "Admins manage franchise supplies" ON public.supplies;
CREATE POLICY "Admins manage franchise supplies" ON public.supplies FOR ALL
  USING (
    owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  );

CREATE OR REPLACE FUNCTION public.get_low_stock_supplies()
RETURNS TABLE (
  id uuid,
  item_name text,
  unit text,
  current_stock numeric,
  low_stock_threshold numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT supply.id, supply.item_name, supply.unit,
         supply.current_stock, supply.low_stock_threshold
  FROM public.supplies AS supply
  WHERE supply.owner_id = public.current_franchise_id()
    AND (
      supply.current_stock <= 0
      OR (
        supply.low_stock_threshold > 0
        AND supply.current_stock <= supply.low_stock_threshold
      )
    )
  ORDER BY
    (supply.current_stock <= 0) DESC,
    CASE
      WHEN supply.low_stock_threshold > 0
        THEN supply.current_stock / supply.low_stock_threshold
      ELSE 0
    END ASC,
    supply.item_name;
$$;

REVOKE ALL ON FUNCTION public.get_low_stock_supplies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_low_stock_supplies() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_franchise_branch(
  p_branch_name text,
  p_clone_from_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_branch_id uuid := gen_random_uuid();
  v_source record;
  v_new_id uuid;
  v_supply_map jsonb := '{}'::jsonb;
  v_menu_map jsonb := '{}'::jsonb;
  v_mapped_supply uuid;
  v_mapped_menu uuid;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_branch_memberships
    WHERE user_id = v_user_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only an admin with branch membership may create a franchise branch';
  END IF;
  IF p_branch_name IS NULL OR btrim(p_branch_name) = '' THEN
    RAISE EXCEPTION 'Branch name is required';
  END IF;
  IF p_clone_from_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_branch_memberships
    WHERE user_id = v_user_id AND branch_id = p_clone_from_branch_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'You must be an admin of the source branch to clone it';
  END IF;

  INSERT INTO public.franchise_branches (id, owner_user_id, branch_name)
  VALUES (v_branch_id, v_user_id, btrim(p_branch_name));
  INSERT INTO public.user_branch_memberships (user_id, branch_id, role)
  VALUES (v_user_id, v_branch_id, 'admin');
  INSERT INTO public.cafe_tables (owner_id, table_number, capacity, status)
  SELECT v_branch_id, 'T' || n, CASE WHEN n IN (1, 2, 3) THEN 2 ELSE 4 END, 'available'
  FROM generate_series(1, 6) AS n;

  IF p_clone_from_branch_id IS NOT NULL THEN
    FOR v_source IN
      SELECT * FROM public.supplies WHERE owner_id = p_clone_from_branch_id
    LOOP
      INSERT INTO public.supplies (
        owner_id, item_name, unit, current_stock, low_stock_threshold, unit_cost, auto_reorder_qty
      )
      VALUES (
        v_branch_id, v_source.item_name, v_source.unit, 0,
        v_source.low_stock_threshold, v_source.unit_cost, v_source.auto_reorder_qty
      )
      RETURNING id INTO v_new_id;
      v_supply_map := v_supply_map || jsonb_build_object(v_source.id::text, v_new_id::text);
    END LOOP;

    FOR v_source IN
      SELECT * FROM public.menu_items WHERE owner_id = p_clone_from_branch_id
    LOOP
      INSERT INTO public.menu_items (
        owner_id, name, category, price, estimated_cost, is_available, has_sizes, size_prices
      )
      VALUES (
        v_branch_id, v_source.name, v_source.category, v_source.price,
        v_source.estimated_cost, v_source.is_available, v_source.has_sizes, v_source.size_prices
      )
      RETURNING id INTO v_new_id;
      v_menu_map := v_menu_map || jsonb_build_object(v_source.id::text, v_new_id::text);
    END LOOP;

    FOR v_source IN
      SELECT * FROM public.menu_item_recipes WHERE tenant_id = p_clone_from_branch_id
    LOOP
      v_mapped_menu := NULLIF(v_menu_map->>v_source.menu_item_id::text, '')::uuid;
      v_mapped_supply := NULLIF(v_supply_map->>v_source.supply_id::text, '')::uuid;
      IF v_mapped_menu IS NOT NULL AND v_mapped_supply IS NOT NULL THEN
        INSERT INTO public.menu_item_recipes (tenant_id, menu_item_id, supply_id, quantity_used, slot_type)
        VALUES (v_branch_id, v_mapped_menu, v_mapped_supply, v_source.quantity_used, v_source.slot_type);
      END IF;
    END LOOP;

    FOR v_source IN
      SELECT * FROM public.modifier_supply_rules WHERE tenant_id = p_clone_from_branch_id
    LOOP
      v_mapped_supply := NULL;
      IF v_source.supply_id IS NOT NULL THEN
        v_mapped_supply := NULLIF(v_supply_map->>v_source.supply_id::text, '')::uuid;
      END IF;
      INSERT INTO public.modifier_supply_rules (
        tenant_id, modifier_name, group_type, action_type, target_slot, supply_id,
        quantity_used, price_delta, is_active, sort_order
      )
      VALUES (
        v_branch_id, v_source.modifier_name, v_source.group_type,
        CASE WHEN v_source.supply_id IS NOT NULL AND v_mapped_supply IS NULL THEN 'none' ELSE v_source.action_type END,
        CASE WHEN v_mapped_supply IS NOT NULL THEN v_source.target_slot ELSE NULL END,
        v_mapped_supply,
        CASE WHEN v_mapped_supply IS NOT NULL THEN v_source.quantity_used ELSE NULL END,
        v_source.price_delta, v_source.is_active, v_source.sort_order
      );
    END LOOP;
  ELSE
    INSERT INTO public.modifier_supply_rules (
      tenant_id, modifier_name, group_type, action_type, target_slot, supply_id,
      quantity_used, price_delta, is_active, sort_order
    )
    VALUES
      (v_branch_id, 'Oat Milk', 'milk', 'none', NULL, NULL, NULL, 15, true, 10),
      (v_branch_id, 'Soy Milk', 'milk', 'none', NULL, NULL, NULL, 10, true, 20),
      (v_branch_id, 'Extra Espresso Shot', 'addon', 'none', NULL, NULL, NULL, 20, true, 30),
      (v_branch_id, 'Vanilla Syrup', 'addon', 'none', NULL, NULL, NULL, 10, true, 40),
      (v_branch_id, 'Caramel Drizzle', 'addon', 'none', NULL, NULL, NULL, 10, true, 50);
  END IF;

  UPDATE public.profiles
  SET franchise_owner_id = v_branch_id, cafe_name = btrim(p_branch_name), role = 'admin'
  WHERE id = v_user_id;
  RETURN v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_franchise_branch(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_franchise_branch(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
