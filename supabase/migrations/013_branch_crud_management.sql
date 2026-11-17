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
    FOR v_source IN SELECT * FROM public.supplies WHERE owner_id = p_clone_from_branch_id LOOP
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

    FOR v_source IN SELECT * FROM public.menu_items WHERE owner_id = p_clone_from_branch_id LOOP
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

    FOR v_source IN SELECT * FROM public.menu_item_recipes WHERE tenant_id = p_clone_from_branch_id LOOP
      v_mapped_menu := NULLIF(v_menu_map->>v_source.menu_item_id::text, '')::uuid;
      v_mapped_supply := NULLIF(v_supply_map->>v_source.supply_id::text, '')::uuid;
      IF v_mapped_menu IS NOT NULL AND v_mapped_supply IS NOT NULL THEN
        INSERT INTO public.menu_item_recipes (tenant_id, menu_item_id, supply_id, quantity_used, slot_type)
        VALUES (v_branch_id, v_mapped_menu, v_mapped_supply, v_source.quantity_used, v_source.slot_type);
      END IF;
    END LOOP;

    FOR v_source IN SELECT * FROM public.modifier_supply_rules WHERE tenant_id = p_clone_from_branch_id LOOP
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

CREATE OR REPLACE FUNCTION public.update_franchise_branch(
  p_branch_id uuid,
  p_branch_name text
)
RETURNS public.franchise_branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch public.franchise_branches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_branch_memberships
    WHERE user_id = auth.uid()
      AND branch_id = p_branch_id
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only an admin of this branch may rename it';
  END IF;
  IF p_branch_name IS NULL OR btrim(p_branch_name) = '' THEN
    RAISE EXCEPTION 'Branch name cannot be empty';
  END IF;

  UPDATE public.franchise_branches
  SET branch_name = btrim(p_branch_name)
  WHERE id = p_branch_id
  RETURNING * INTO v_branch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  UPDATE public.profiles
  SET cafe_name = v_branch.branch_name
  WHERE franchise_owner_id = p_branch_id;
  RETURN v_branch;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_franchise_branch(p_branch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_next_branch_id uuid;
  v_membership_count integer;
  v_profile record;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_branch_memberships
    WHERE user_id = v_user_id
      AND branch_id = p_branch_id
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only an admin of this branch may delete it';
  END IF;

  SELECT COUNT(*) INTO v_membership_count
  FROM public.user_branch_memberships
  WHERE user_id = v_user_id;
  IF v_membership_count <= 1 THEN
    RAISE EXCEPTION 'You cannot delete your only remaining branch.';
  END IF;

  SELECT branch_id INTO v_next_branch_id
  FROM public.user_branch_memberships
  WHERE user_id = v_user_id
    AND branch_id <> p_branch_id
  ORDER BY created_at, branch_id
  LIMIT 1;
  IF v_next_branch_id IS NULL THEN
    RAISE EXCEPTION 'No fallback branch is available';
  END IF;

  FOR v_profile IN
    SELECT DISTINCT ON (profile.id) profile.id, membership.branch_id, membership.role
    FROM public.profiles AS profile
    JOIN public.user_branch_memberships AS membership
      ON membership.user_id = profile.id
     AND membership.branch_id <> p_branch_id
    WHERE profile.franchise_owner_id = p_branch_id
    ORDER BY profile.id, membership.created_at, membership.branch_id
  LOOP
    UPDATE public.profiles
    SET franchise_owner_id = v_profile.branch_id,
        cafe_name = branch.branch_name,
        role = v_profile.role
    FROM public.franchise_branches AS branch
    WHERE profiles.id = v_profile.id
      AND branch.id = v_profile.branch_id;
  END LOOP;

  UPDATE public.profiles
  SET franchise_owner_id = NULL,
      cafe_name = 'Cafe Manager'
  WHERE franchise_owner_id = p_branch_id;

  DELETE FROM public.order_items AS item
  USING public.orders AS order_row
  WHERE item.order_id = order_row.id
    AND order_row.owner_id = p_branch_id;
  DELETE FROM public.orders WHERE owner_id = p_branch_id;
  DELETE FROM public.menu_item_recipes WHERE tenant_id = p_branch_id;
  DELETE FROM public.modifier_supply_rules WHERE tenant_id = p_branch_id;
  DELETE FROM public.restock_orders WHERE owner_id = p_branch_id;
  DELETE FROM public.staff_shifts WHERE franchise_owner_id = p_branch_id;
  DELETE FROM public.employees WHERE franchise_owner_id = p_branch_id;
  DELETE FROM public.menu_items WHERE owner_id = p_branch_id;
  DELETE FROM public.supplies WHERE owner_id = p_branch_id;
  DELETE FROM public.cafe_tables WHERE owner_id = p_branch_id;
  DELETE FROM public.user_branch_memberships WHERE branch_id = p_branch_id;
  DELETE FROM public.franchise_branches WHERE id = p_branch_id;

  RETURN v_next_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_franchise_branch(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_franchise_branch(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_franchise_branch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_franchise_branch(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_franchise_branch(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_franchise_branch(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
