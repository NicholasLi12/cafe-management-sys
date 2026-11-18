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

CREATE OR REPLACE FUNCTION public.enforce_franchise_branch_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND (
      NEW.owner_user_id <> auth.uid()
      OR NOT EXISTS (
        SELECT 1 FROM public.franchise_branches AS owned_branch
        WHERE owned_branch.owner_user_id = auth.uid()
      )
    ) THEN
      RAISE EXCEPTION 'Only the franchise HQ owner may create branches';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the franchise HQ owner may manage this branch';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_user_id <> OLD.owner_user_id OR NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'A branch cannot be reassigned';
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS franchise_branches_owner_guard ON public.franchise_branches;
CREATE TRIGGER franchise_branches_owner_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.franchise_branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_franchise_branch_owner();

REVOKE ALL ON FUNCTION public.enforce_franchise_branch_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_franchise_employee(uuid, text, text, text, numeric, text, date, text, text, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_franchise_employee(uuid, text, text, text, numeric, text, date, text, text, numeric, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
