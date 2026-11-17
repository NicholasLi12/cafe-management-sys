CREATE TABLE IF NOT EXISTS public.franchise_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.franchise_branches (id, owner_user_id, branch_name)
SELECT DISTINCT ON (COALESCE(profile.franchise_owner_id, profile.id))
  COALESCE(profile.franchise_owner_id, profile.id),
  COALESCE(profile.franchise_owner_id, profile.id),
  COALESCE(owner_profile.cafe_name, profile.cafe_name, 'My Cafe')
FROM public.profiles AS profile
LEFT JOIN public.profiles AS owner_profile
  ON owner_profile.id = COALESCE(profile.franchise_owner_id, profile.id)
ORDER BY COALESCE(profile.franchise_owner_id, profile.id), profile.id
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_branch_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.franchise_branches(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'barista')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_branch_memberships_user_branch_key UNIQUE (user_id, branch_id)
);

INSERT INTO public.user_branch_memberships (user_id, branch_id, role)
SELECT profile.id, COALESCE(profile.franchise_owner_id, profile.id), profile.role
FROM public.profiles AS profile
WHERE profile.role IN ('admin', 'barista')
ON CONFLICT (user_id, branch_id) DO UPDATE SET role = EXCLUDED.role;

DO $$
DECLARE
  target record;
  constraint_row record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('profiles', 'franchise_owner_id'),
      ('employees', 'owner_id'),
      ('employees', 'franchise_owner_id'),
      ('cafe_tables', 'owner_id'),
      ('menu_items', 'owner_id'),
      ('supplies', 'owner_id'),
      ('orders', 'owner_id'),
      ('restock_orders', 'owner_id'),
      ('staff_shifts', 'franchise_owner_id'),
      ('menu_item_recipes', 'tenant_id'),
      ('modifier_supply_rules', 'tenant_id')
    ) AS columns_to_repoint(table_name, column_name)
  LOOP
    FOR constraint_row IN
      SELECT con.conname
      FROM pg_constraint AS con
      JOIN pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
      JOIN pg_attribute AS attr ON attr.attrelid = rel.oid AND attr.attnum = ANY(con.conkey)
      WHERE ns.nspname = 'public'
        AND rel.relname = target.table_name
        AND attr.attname = target.column_name
        AND con.contype = 'f'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', target.table_name, constraint_row.conname);
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_franchise_owner_id_fkey
  FOREIGN KEY (franchise_owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE,
  ADD CONSTRAINT employees_franchise_owner_id_fkey
  FOREIGN KEY (franchise_owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.cafe_tables
  ADD CONSTRAINT cafe_tables_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.supplies
  ADD CONSTRAINT supplies_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.restock_orders
  ADD CONSTRAINT restock_orders_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.staff_shifts
  ADD CONSTRAINT staff_shifts_franchise_owner_id_fkey
  FOREIGN KEY (franchise_owner_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.menu_item_recipes
  ADD CONSTRAINT menu_item_recipes_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;
ALTER TABLE public.modifier_supply_rules
  ADD CONSTRAINT modifier_supply_rules_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.franchise_branches(id) ON DELETE CASCADE;

ALTER TABLE public.franchise_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branch_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own branch memberships" ON public.user_branch_memberships;
CREATE POLICY "Users read own branch memberships" ON public.user_branch_memberships FOR SELECT
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users read member branches" ON public.franchise_branches;
CREATE POLICY "Users read member branches" ON public.franchise_branches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_branch_memberships AS membership
      WHERE membership.branch_id = franchise_branches.id
        AND membership.user_id = auth.uid()
    )
  );
GRANT SELECT ON public.user_branch_memberships, public.franchise_branches TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_profile_branch_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.franchise_owner_id IS NOT NULL AND NEW.role IN ('admin', 'barista') THEN
    INSERT INTO public.user_branch_memberships (user_id, branch_id, role)
    VALUES (NEW.id, NEW.franchise_owner_id, NEW.role)
    ON CONFLICT (user_id, branch_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_branch_membership ON public.profiles;
CREATE TRIGGER profiles_sync_branch_membership
  AFTER INSERT OR UPDATE OF franchise_owner_id, role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_branch_membership();

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT membership.role
  FROM public.profiles AS profile
  JOIN public.user_branch_memberships AS membership
    ON membership.user_id = profile.id
   AND membership.branch_id = profile.franchise_owner_id
  WHERE profile.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_franchise_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.franchise_owner_id
  FROM public.profiles AS profile
  JOIN public.user_branch_memberships AS membership
    ON membership.user_id = profile.id
   AND membership.branch_id = profile.franchise_owner_id
  WHERE profile.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_name text := COALESCE(NEW.raw_user_meta_data->>'owner_name', 'Owner');
  v_branch_name text := COALESCE(NEW.raw_user_meta_data->>'cafe_name', 'My Cafe');
  v_role text := CASE
    WHEN NULLIF(NEW.raw_user_meta_data->>'franchise_provisioning_nonce', '') IS NOT NULL THEN 'barista'
    ELSE 'admin'
  END;
  v_modifier record;
BEGIN
  IF v_role = 'admin' THEN
    INSERT INTO public.franchise_branches (id, owner_user_id, branch_name)
    VALUES (NEW.id, NEW.id, v_branch_name)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  INSERT INTO public.profiles (id, email, owner_name, cafe_name, role, franchise_owner_id)
  VALUES (
    NEW.id, COALESCE(NEW.email, ''), v_owner_name, v_branch_name,
    v_role, CASE WHEN v_role = 'admin' THEN NEW.id ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_role = 'admin' THEN
    INSERT INTO public.user_branch_memberships (user_id, branch_id, role)
    VALUES (NEW.id, NEW.id, 'admin')
    ON CONFLICT (user_id, branch_id) DO NOTHING;

    INSERT INTO public.cafe_tables (owner_id, table_number, capacity, status)
    SELECT NEW.id, 'T' || n, CASE WHEN n IN (1, 2, 3) THEN 2 ELSE 4 END, 'available'
    FROM generate_series(1, 6) AS n;

    FOR v_modifier IN
      SELECT * FROM (VALUES
        ('Oat Milk', 'milk', 15::numeric, 10),
        ('Soy Milk', 'milk', 10::numeric, 20),
        ('Extra Espresso Shot', 'addon', 20::numeric, 30),
        ('Vanilla Syrup', 'addon', 10::numeric, 40),
        ('Caramel Drizzle', 'addon', 10::numeric, 50)
      ) AS modifiers(modifier_name, group_type, price_delta, sort_order)
    LOOP
      INSERT INTO public.modifier_supply_rules (
        tenant_id, modifier_name, group_type, action_type, target_slot, supply_id,
        quantity_used, price_delta, is_active, sort_order
      )
      VALUES (NEW.id, v_modifier.modifier_name, v_modifier.group_type, 'none', NULL, NULL, NULL, v_modifier.price_delta, true, v_modifier.sort_order)
      ON CONFLICT (tenant_id, modifier_name) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.switch_active_branch(p_branch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role INTO v_role
  FROM public.user_branch_memberships
  WHERE user_id = auth.uid() AND branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not have access to that branch';
  END IF;
  UPDATE public.profiles
  SET franchise_owner_id = p_branch_id,
      role = v_role,
      cafe_name = (SELECT branch_name FROM public.franchise_branches WHERE id = p_branch_id)
  WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your profile could not be updated';
  END IF;
  RETURN p_branch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_franchise_barista(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_provisioning_nonce text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_franchise_id uuid := public.current_franchise_id();
  v_cafe_name text;
  v_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'admin' OR v_franchise_id IS NULL THEN
    RAISE EXCEPTION 'Only franchise admins may create barista accounts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = p_user_id
      AND raw_user_meta_data->>'franchise_provisioning_nonce' = p_provisioning_nonce
  ) THEN
    RAISE EXCEPTION 'The new account was not created by this provisioning request';
  END IF;

  SELECT branch_name INTO v_cafe_name
  FROM public.franchise_branches
  WHERE id = v_franchise_id;

  INSERT INTO public.profiles (id, email, owner_name, cafe_name, role, franchise_owner_id)
  VALUES (p_user_id, p_email, p_full_name, COALESCE(v_cafe_name, 'My Cafe'), 'barista', v_franchise_id)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    owner_name = EXCLUDED.owner_name,
    cafe_name = EXCLUDED.cafe_name,
    role = 'barista',
    franchise_owner_id = v_franchise_id;

  INSERT INTO public.employees (owner_id, franchise_owner_id, auth_user_id, full_name, role)
  VALUES (v_franchise_id, v_franchise_id, p_user_id, p_full_name, 'Barista')
  RETURNING id INTO v_employee_id;
  RETURN v_employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_franchise_branch_analytics(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  orders_count bigint,
  gross_sales numeric,
  cogs_total numeric,
  net_profit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'admin'
     OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'A valid authenticated date range is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_branch_memberships
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only franchise admins may view branch analytics';
  END IF;

  RETURN QUERY
  SELECT branch.id, branch.branch_name,
    COUNT(order_row.id),
    COALESCE(SUM(order_row.total_amount), 0)::numeric,
    COALESCE(SUM(order_row.cogs_total), 0)::numeric,
    (COALESCE(SUM(order_row.total_amount), 0) - COALESCE(SUM(order_row.cogs_total), 0))::numeric
  FROM public.user_branch_memberships AS membership
  JOIN public.franchise_branches AS branch ON branch.id = membership.branch_id
  LEFT JOIN public.orders AS order_row
    ON order_row.owner_id = branch.id
   AND order_row.status = 'paid'
   AND order_row.created_at >= p_start
   AND order_row.created_at < p_end
  WHERE membership.user_id = auth.uid()
    AND membership.role = 'admin'
  GROUP BY branch.id, branch.branch_name
  ORDER BY branch.branch_name;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_branch_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_franchise_branch(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.switch_active_branch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_franchise_barista(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_franchise_branch_analytics(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_franchise_branch(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_active_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_franchise_barista(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_franchise_branch_analytics(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
