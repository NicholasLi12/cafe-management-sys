ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS franchise_owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.profiles
SET franchise_owner_id = id
WHERE franchise_owner_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'barista'));
  END IF;
END;
$$;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS franchise_owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.employees
SET franchise_owner_id = owner_id
WHERE franchise_owner_id IS NULL;

ALTER TABLE public.employees
  ALTER COLUMN franchise_owner_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_auth_user_id_key
  ON public.employees(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_franchise_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN profile.role IN ('admin', 'barista') THEN COALESCE(profile.franchise_owner_id, profile.id)
    ELSE NULL
  END
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, owner_name, cafe_name, role, franchise_owner_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'owner_name', 'Owner'),
    COALESCE(NEW.raw_user_meta_data->>'cafe_name', 'My Cafe'),
    CASE
      WHEN NULLIF(NEW.raw_user_meta_data->>'franchise_provisioning_nonce', '') IS NOT NULL
        THEN 'barista'
      ELSE 'admin'
    END,
    NEW.id
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Owners manage own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles readable in franchise" ON public.profiles;
DROP POLICY IF EXISTS "Admins insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT
  USING (auth.uid() = id);
CREATE POLICY "Profiles readable in franchise" ON public.profiles FOR SELECT
  USING (id = auth.uid() OR franchise_owner_id = public.current_franchise_id());
CREATE POLICY "Admins insert own profile" ON public.profiles FOR INSERT
  WITH CHECK (
    id = auth.uid()
    AND role = 'admin'
    AND franchise_owner_id = auth.uid()
  );
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (email, owner_name, cafe_name) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Owners manage own employees" ON public.employees;
DROP POLICY IF EXISTS "Admins manage franchise employees" ON public.employees;
CREATE POLICY "Admins manage franchise employees" ON public.employees FOR ALL
  USING (
    franchise_owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    franchise_owner_id = public.current_franchise_id()
    AND owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Owners manage own tables" ON public.cafe_tables;
DROP POLICY IF EXISTS "Franchise members read tables" ON public.cafe_tables;
DROP POLICY IF EXISTS "Admins insert franchise tables" ON public.cafe_tables;
DROP POLICY IF EXISTS "Franchise members update table status" ON public.cafe_tables;
DROP POLICY IF EXISTS "Admins delete franchise tables" ON public.cafe_tables;
CREATE POLICY "Franchise members read tables" ON public.cafe_tables FOR SELECT
  USING (owner_id = public.current_franchise_id());
CREATE POLICY "Admins insert franchise tables" ON public.cafe_tables FOR INSERT
  WITH CHECK (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin');
CREATE POLICY "Franchise members update table status" ON public.cafe_tables FOR UPDATE
  USING (owner_id = public.current_franchise_id())
  WITH CHECK (
    owner_id = public.current_franchise_id()
    AND (
      public.current_user_role() = 'admin'
      OR status IN ('available', 'occupied')
    )
  );
CREATE POLICY "Admins delete franchise tables" ON public.cafe_tables FOR DELETE
  USING (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin');
REVOKE UPDATE ON public.cafe_tables FROM authenticated;
GRANT UPDATE (status) ON public.cafe_tables TO authenticated;

DROP POLICY IF EXISTS "Owners manage own menu" ON public.menu_items;
DROP POLICY IF EXISTS "Franchise members read menu" ON public.menu_items;
DROP POLICY IF EXISTS "Admins manage franchise menu" ON public.menu_items;
CREATE POLICY "Franchise members read menu" ON public.menu_items FOR SELECT
  USING (owner_id = public.current_franchise_id());
CREATE POLICY "Admins manage franchise menu" ON public.menu_items FOR ALL
  USING (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin')
  WITH CHECK (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Owners manage own supplies" ON public.supplies;
DROP POLICY IF EXISTS "Franchise members read supplies" ON public.supplies;
DROP POLICY IF EXISTS "Admins manage franchise supplies" ON public.supplies;
CREATE POLICY "Franchise members read supplies" ON public.supplies FOR SELECT
  USING (owner_id = public.current_franchise_id());
CREATE POLICY "Admins manage franchise supplies" ON public.supplies FOR ALL
  USING (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin')
  WITH CHECK (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Owners manage own orders" ON public.orders;
DROP POLICY IF EXISTS "Franchise members read orders" ON public.orders;
DROP POLICY IF EXISTS "Franchise members insert paid orders" ON public.orders;
DROP POLICY IF EXISTS "Admins update franchise orders" ON public.orders;
DROP POLICY IF EXISTS "Admins delete franchise orders" ON public.orders;
CREATE POLICY "Franchise members read orders" ON public.orders FOR SELECT
  USING (owner_id = public.current_franchise_id());
CREATE POLICY "Franchise members insert paid orders" ON public.orders FOR INSERT
  WITH CHECK (
    owner_id = public.current_franchise_id()
    AND status = 'paid'
    AND (
      table_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.cafe_tables
        WHERE cafe_tables.id = orders.table_id
          AND cafe_tables.owner_id = public.current_franchise_id()
      )
    )
  );
CREATE POLICY "Admins update franchise orders" ON public.orders FOR UPDATE
  USING (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin')
  WITH CHECK (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin');
CREATE POLICY "Admins delete franchise orders" ON public.orders FOR DELETE
  USING (owner_id = public.current_franchise_id() AND public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Owners manage own order items" ON public.order_items;
DROP POLICY IF EXISTS "Franchise members read order items" ON public.order_items;
DROP POLICY IF EXISTS "Franchise members insert paid order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins update franchise order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins delete franchise order items" ON public.order_items;
CREATE POLICY "Franchise members read order items" ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.owner_id = public.current_franchise_id()
    )
  );
CREATE POLICY "Franchise members insert paid order items" ON public.order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.owner_id = public.current_franchise_id()
        AND orders.status = 'paid'
    )
    AND EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE menu_items.id = order_items.menu_item_id
        AND menu_items.owner_id = public.current_franchise_id()
        AND menu_items.is_available = true
    )
  );
CREATE POLICY "Admins update franchise order items" ON public.order_items FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.owner_id = public.current_franchise_id()
    )
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.owner_id = public.current_franchise_id()
    )
  );
CREATE POLICY "Admins delete franchise order items" ON public.order_items FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.owner_id = public.current_franchise_id()
    )
  );

DROP POLICY IF EXISTS "Owners manage own recipes" ON public.menu_item_ingredients;
DROP POLICY IF EXISTS "Franchise members read recipes" ON public.menu_item_ingredients;
DROP POLICY IF EXISTS "Admins manage franchise recipes" ON public.menu_item_ingredients;
CREATE POLICY "Franchise members read recipes" ON public.menu_item_ingredients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE menu_items.id = menu_item_ingredients.menu_item_id
        AND menu_items.owner_id = public.current_franchise_id()
    )
  );
CREATE POLICY "Admins manage franchise recipes" ON public.menu_item_ingredients FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE menu_items.id = menu_item_ingredients.menu_item_id
        AND menu_items.owner_id = public.current_franchise_id()
    )
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE menu_items.id = menu_item_ingredients.menu_item_id
        AND menu_items.owner_id = public.current_franchise_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.supplies
      WHERE supplies.id = menu_item_ingredients.supply_id
        AND supplies.owner_id = public.current_franchise_id()
    )
  );

DROP POLICY IF EXISTS "Owners manage own restock orders" ON public.restock_orders;
DROP POLICY IF EXISTS "Admins manage franchise restock orders" ON public.restock_orders;
CREATE POLICY "Admins manage franchise restock orders" ON public.restock_orders FOR ALL
  USING (
    owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  );

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
  v_admin_id uuid := auth.uid();
  v_cafe_name text;
  v_employee_id uuid;
BEGIN
  IF v_admin_id IS NULL OR public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only franchise admins may create barista accounts';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = p_user_id
      AND raw_user_meta_data->>'franchise_provisioning_nonce' = p_provisioning_nonce
  ) THEN
    RAISE EXCEPTION 'The new account was not created by this provisioning request';
  END IF;

  SELECT cafe_name INTO v_cafe_name
  FROM public.profiles
  WHERE id = v_admin_id;

  INSERT INTO public.profiles (id, email, owner_name, cafe_name, role, franchise_owner_id)
  VALUES (p_user_id, p_email, p_full_name, COALESCE(v_cafe_name, 'My Cafe'), 'barista', v_admin_id)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    owner_name = EXCLUDED.owner_name,
    cafe_name = EXCLUDED.cafe_name,
    role = 'barista',
    franchise_owner_id = v_admin_id;

  INSERT INTO public.employees (owner_id, franchise_owner_id, auth_user_id, full_name, role)
  VALUES (v_admin_id, v_admin_id, p_user_id, p_full_name, 'Barista')
  RETURNING id INTO v_employee_id;

  RETURN v_employee_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_franchise_barista(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_franchise_barista(uuid, text, text, text) TO authenticated;
