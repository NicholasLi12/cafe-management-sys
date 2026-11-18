CREATE OR REPLACE FUNCTION public.create_franchise_employee(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_hourly_rate numeric,
  p_phone text,
  p_hired_date date,
  p_provisioning_nonce text,
  p_employment_type text,
  p_hours_worked numeric,
  p_salary_paid boolean
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
  IF v_admin_id IS NULL OR public.current_user_role() <> 'admin' OR v_franchise_id IS NULL THEN
    RAISE EXCEPTION 'Only franchise admins may create team members';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.franchise_branches AS branch
    WHERE branch.id = v_franchise_id
      AND branch.owner_user_id = v_admin_id
  ) THEN
    RAISE EXCEPTION 'Only the HQ Owner can create new employee accounts';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('Barista', 'Admin') THEN
    RAISE EXCEPTION 'Role must be Barista or Admin';
  END IF;
  IF p_employment_type IS NULL OR p_employment_type NOT IN ('full_time', 'part_time') THEN
    RAISE EXCEPTION 'Employment type must be full_time or part_time';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;
  IF p_hourly_rate IS NULL OR p_hourly_rate < 0 THEN
    RAISE EXCEPTION 'Hourly rate or monthly salary must be zero or greater';
  END IF;
  IF p_hours_worked IS NULL OR p_hours_worked < 0 OR p_hours_worked * 2 <> trunc(p_hours_worked * 2) THEN
    RAISE EXCEPTION 'Hours worked must be non-negative and use 0.5-hour increments';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = p_user_id
      AND raw_user_meta_data->>'franchise_provisioning_nonce' = p_provisioning_nonce
  ) THEN
    RAISE EXCEPTION 'The new account was not created by this provisioning request';
  END IF;

  SELECT branch.branch_name INTO v_cafe_name
  FROM public.franchise_branches AS branch
  WHERE branch.id = v_franchise_id;
  IF v_cafe_name IS NULL THEN
    RAISE EXCEPTION 'The active branch could not be found';
  END IF;
  v_profile_role := CASE WHEN p_role = 'Admin' THEN 'admin' ELSE 'barista' END;

  INSERT INTO public.profiles (id, email, owner_name, cafe_name, role, franchise_owner_id)
  VALUES (p_user_id, lower(btrim(p_email)), btrim(p_full_name), v_cafe_name, v_profile_role, v_franchise_id)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    owner_name = EXCLUDED.owner_name,
    cafe_name = EXCLUDED.cafe_name,
    role = EXCLUDED.role,
    franchise_owner_id = EXCLUDED.franchise_owner_id;

  INSERT INTO public.user_branch_memberships (user_id, branch_id, role)
  VALUES (p_user_id, v_franchise_id, v_profile_role)
  ON CONFLICT (user_id, branch_id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.employees (
    owner_id, franchise_owner_id, auth_user_id, user_id, email,
    full_name, role, hourly_rate, phone, hired_date,
    employment_type, hours_worked, salary_paid, last_paid_at
  )
  VALUES (
    v_franchise_id, v_franchise_id, p_user_id, p_user_id, lower(btrim(p_email)),
    btrim(p_full_name), p_role, p_hourly_rate, NULLIF(btrim(p_phone), ''), p_hired_date,
    p_employment_type, CASE WHEN p_employment_type = 'part_time' THEN p_hours_worked ELSE 0 END,
    COALESCE(p_salary_paid, false), CASE WHEN COALESCE(p_salary_paid, false) THEN now() ELSE NULL END
  )
  RETURNING id INTO v_employee_id;
  RETURN v_employee_id;
END;
$$;

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
  IF p_role = 'Admin' AND NOT EXISTS (
    SELECT 1
    FROM public.franchise_branches AS branch
    WHERE branch.id = v_franchise_id
      AND branch.owner_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the HQ Owner can promote employees to Admin';
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
