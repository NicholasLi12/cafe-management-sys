CREATE TABLE IF NOT EXISTS public.staff_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  clock_in timestamptz NOT NULL DEFAULT now(),
  clock_out timestamptz,
  total_hours numeric(8, 2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shifts_total_hours_nonnegative CHECK (total_hours IS NULL OR total_hours >= 0),
  CONSTRAINT staff_shifts_clock_order CHECK (clock_out IS NULL OR clock_out > clock_in)
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_shifts_one_active_per_employee
  ON public.staff_shifts (employee_id)
  WHERE clock_out IS NULL;

CREATE INDEX IF NOT EXISTS staff_shifts_franchise_clock_in_idx
  ON public.staff_shifts (franchise_owner_id, clock_in DESC);

ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Franchise staff read own or all shifts" ON public.staff_shifts;
CREATE POLICY "Franchise staff read own or all shifts" ON public.staff_shifts FOR SELECT
  USING (
    franchise_owner_id = public.current_franchise_id()
    AND (
      public.current_user_role() = 'admin'
      OR EXISTS (
        SELECT 1
        FROM public.employees AS employee
        WHERE employee.id = staff_shifts.employee_id
          AND employee.franchise_owner_id = public.current_franchise_id()
          AND COALESCE(employee.user_id, employee.auth_user_id) = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Admins manage franchise shifts" ON public.staff_shifts;
CREATE POLICY "Admins manage franchise shifts" ON public.staff_shifts FOR ALL
  USING (
    franchise_owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    franchise_owner_id = public.current_franchise_id()
    AND public.current_user_role() = 'admin'
  );

GRANT SELECT ON public.staff_shifts TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.staff_shifts FROM authenticated;

DROP POLICY IF EXISTS "Employees read own franchise record" ON public.employees;
CREATE POLICY "Employees read own franchise record" ON public.employees FOR SELECT
  USING (
    franchise_owner_id = public.current_franchise_id()
    AND COALESCE(user_id, auth_user_id) = auth.uid()
  );

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_hours_worked_half_hour;

CREATE OR REPLACE FUNCTION public.sync_staff_shift_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_franchise_id uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    SELECT franchise_owner_id INTO v_franchise_id
    FROM public.employees
    WHERE id = NEW.employee_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Employee not found for this shift';
    END IF;

    IF TG_OP = 'UPDATE' AND (
      NEW.employee_id <> OLD.employee_id
      OR NEW.franchise_owner_id <> OLD.franchise_owner_id
    ) THEN
      RAISE EXCEPTION 'A shift cannot be reassigned to another employee or cafe';
    END IF;

    NEW.franchise_owner_id := v_franchise_id;
    IF NEW.clock_out IS NOT NULL THEN
      IF NEW.clock_out <= NEW.clock_in THEN
        RAISE EXCEPTION 'Clock-out must be later than clock-in';
      END IF;
      NEW.total_hours := round((extract(epoch FROM (NEW.clock_out - NEW.clock_in)) / 3600.0)::numeric, 2);
    ELSE
      NEW.total_hours := NULL;
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_staff_shift_payroll_delta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_hours_delta numeric(10, 2);
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_employee_id := NEW.employee_id;
    v_hours_delta := COALESCE(NEW.total_hours, 0);
  ELSIF TG_OP = 'DELETE' THEN
    v_employee_id := OLD.employee_id;
    v_hours_delta := -COALESCE(OLD.total_hours, 0);
  ELSE
    v_employee_id := NEW.employee_id;
    v_hours_delta := COALESCE(NEW.total_hours, 0) - COALESCE(OLD.total_hours, 0);
  END IF;

  IF v_hours_delta <> 0 THEN
    UPDATE public.employees
    SET hours_worked = GREATEST(0, hours_worked + v_hours_delta)
    WHERE id = v_employee_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_shifts_calculate_hours ON public.staff_shifts;
CREATE TRIGGER staff_shifts_calculate_hours
  BEFORE INSERT OR UPDATE ON public.staff_shifts
  FOR EACH ROW EXECUTE FUNCTION public.sync_staff_shift_hours();

DROP TRIGGER IF EXISTS staff_shifts_apply_payroll_delta ON public.staff_shifts;
CREATE TRIGGER staff_shifts_apply_payroll_delta
  AFTER INSERT OR UPDATE ON public.staff_shifts
  FOR EACH ROW EXECUTE FUNCTION public.apply_staff_shift_payroll_delta();

CREATE OR REPLACE FUNCTION public.staff_clock_in()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_shift_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('admin', 'barista') THEN
    RAISE EXCEPTION 'Sign in with a staff account to clock in';
  END IF;

  SELECT * INTO v_employee
  FROM public.employees
  WHERE COALESCE(user_id, auth_user_id) = auth.uid()
    AND franchise_owner_id = public.current_franchise_id()
    AND COALESCE(is_active, true)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active employee record is linked to this account';
  END IF;

  INSERT INTO public.staff_shifts (franchise_owner_id, employee_id)
  VALUES (v_employee.franchise_owner_id, v_employee.id)
  RETURNING id INTO v_shift_id;

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_clock_out(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('admin', 'barista') THEN
    RAISE EXCEPTION 'Sign in with a staff account to clock out';
  END IF;

  SELECT id INTO v_employee_id
  FROM public.employees
  WHERE COALESCE(user_id, auth_user_id) = auth.uid()
    AND franchise_owner_id = public.current_franchise_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No employee record is linked to this account';
  END IF;

  UPDATE public.staff_shifts
  SET clock_out = now()
  WHERE id = p_shift_id
    AND employee_id = v_employee_id
    AND franchise_owner_id = public.current_franchise_id()
    AND clock_out IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active shift not found; refresh and try again';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_staff_shift(
  p_shift_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.current_user_role() <> 'admin'
     OR public.current_franchise_id() IS NULL THEN
    RAISE EXCEPTION 'Only cafe admins may edit staff shifts';
  END IF;
  IF p_clock_in IS NULL OR (p_clock_out IS NOT NULL AND p_clock_out <= p_clock_in) THEN
    RAISE EXCEPTION 'Shift times are invalid; clock-out must be later than clock-in';
  END IF;

  UPDATE public.staff_shifts
  SET clock_in = p_clock_in,
      clock_out = p_clock_out,
      notes = p_notes
  WHERE id = p_shift_id
    AND franchise_owner_id = public.current_franchise_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found in this cafe';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_staff_shift_hours() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_staff_shift_payroll_delta() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_clock_in() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_clock_out(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_staff_shift(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_clock_in() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_clock_out(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_staff_shift(uuid, timestamptz, timestamptz, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
