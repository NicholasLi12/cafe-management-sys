ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS hours_worked numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_paid_at timestamptz;

UPDATE public.employees
SET employment_type = COALESCE(employment_type, 'full_time'),
    hours_worked = COALESCE(hours_worked, 0),
    salary_paid = COALESCE(salary_paid, false);

ALTER TABLE public.employees
  ALTER COLUMN employment_type SET DEFAULT 'full_time',
  ALTER COLUMN employment_type SET NOT NULL,
  ALTER COLUMN hours_worked SET DEFAULT 0,
  ALTER COLUMN hours_worked SET NOT NULL,
  ALTER COLUMN salary_paid SET DEFAULT false,
  ALTER COLUMN salary_paid SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.employees'::regclass
      AND conname = 'employees_employment_type_check'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_employment_type_check
      CHECK (employment_type IN ('full_time', 'part_time'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.employees'::regclass
      AND conname = 'employees_hours_worked_nonnegative'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_hours_worked_nonnegative CHECK (hours_worked >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.employees'::regclass
      AND conname = 'employees_hours_worked_half_hour'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_hours_worked_half_hour CHECK (hours_worked * 2 = trunc(hours_worked * 2));
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Admins update franchise employee payroll" ON public.employees;
CREATE POLICY "Admins update franchise employee payroll" ON public.employees FOR UPDATE
  USING (
    franchise_owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    franchise_owner_id = public.current_franchise_id()
    AND owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  );

GRANT UPDATE (employment_type, hours_worked, salary_paid, last_paid_at) ON public.employees TO authenticated;

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
  IF v_admin_id IS NULL OR public.current_user_role() <> 'admin' THEN
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

REVOKE ALL ON FUNCTION public.create_franchise_employee(uuid, text, text, text, numeric, text, date, text, text, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_franchise_employee(uuid, text, text, text, numeric, text, date, text, text, numeric, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
