ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.employees
SET user_id = auth_user_id
WHERE user_id IS NULL
  AND auth_user_id IS NOT NULL;

UPDATE public.employees AS employee
SET email = profile.email
FROM public.profiles AS profile
WHERE employee.user_id = profile.id
  AND employee.email IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_key
  ON public.employees(user_id)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_franchise_employee(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_hourly_rate numeric,
  p_phone text,
  p_hired_date date,
  p_provisioning_nonce text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_franchise_id uuid := public.current_franchise_id();
  v_cafe_name text;
  v_employee_id uuid;
  v_profile_role text;
BEGIN
  IF v_admin_id IS NULL OR public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only franchise admins may create team members';
  END IF;

  IF p_role NOT IN ('Barista', 'Admin') THEN
    RAISE EXCEPTION 'Role must be Barista or Admin';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;
  IF p_hourly_rate IS NULL OR p_hourly_rate < 0 THEN
    RAISE EXCEPTION 'Hourly rate must be zero or greater';
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

  v_profile_role := CASE WHEN p_role = 'Admin' THEN 'admin' ELSE 'barista' END;

  INSERT INTO public.profiles (id, email, owner_name, cafe_name, role, franchise_owner_id)
  VALUES (p_user_id, lower(btrim(p_email)), btrim(p_full_name), COALESCE(v_cafe_name, 'My Cafe'), v_profile_role, v_franchise_id)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    owner_name = EXCLUDED.owner_name,
    cafe_name = EXCLUDED.cafe_name,
    role = EXCLUDED.role,
    franchise_owner_id = EXCLUDED.franchise_owner_id;

  INSERT INTO public.employees (
    owner_id, franchise_owner_id, auth_user_id, user_id, email,
    full_name, role, hourly_rate, phone, hired_date
  )
  VALUES (
    v_franchise_id, v_franchise_id, p_user_id, p_user_id, lower(btrim(p_email)),
    btrim(p_full_name), p_role, p_hourly_rate, NULLIF(btrim(p_phone), ''), p_hired_date
  )
  RETURNING id INTO v_employee_id;

  RETURN v_employee_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_franchise_employee(uuid, text, text, text, numeric, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_franchise_employee(uuid, text, text, text, numeric, text, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_franchise_employee_role(
  p_employee_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_franchise_id uuid := public.current_franchise_id();
  v_profile_role text;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only franchise admins may change team member roles';
  END IF;
  IF p_role NOT IN ('Barista', 'Admin') THEN
    RAISE EXCEPTION 'Role must be Barista or Admin';
  END IF;

  UPDATE public.employees
  SET role = p_role
  WHERE id = p_employee_id
    AND franchise_owner_id = v_franchise_id
  RETURNING user_id INTO v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this franchise';
  END IF;

  IF v_user_id IS NOT NULL THEN
    v_profile_role := CASE WHEN p_role = 'Admin' THEN 'admin' ELSE 'barista' END;
    UPDATE public.profiles
    SET role = v_profile_role,
        franchise_owner_id = v_franchise_id
    WHERE id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked login profile was not found';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_franchise_employee_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_franchise_employee_role(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_franchise_employee(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only franchise admins may remove team members';
  END IF;

  DELETE FROM public.employees
  WHERE id = p_employee_id
    AND franchise_owner_id = public.current_franchise_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this franchise';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_franchise_employee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_franchise_employee(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
