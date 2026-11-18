ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number integer;

WITH numbered_orders AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY owner_id, (created_at AT TIME ZONE 'Asia/Bangkok')::date
      ORDER BY created_at ASC, id ASC
    )::integer AS daily_number
  FROM public.orders
)
UPDATE public.orders AS orders
SET order_number = numbered_orders.daily_number
FROM numbered_orders
WHERE orders.id = numbered_orders.id;

CREATE OR REPLACE FUNCTION public.assign_daily_branch_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_date date := (COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.owner_id::text || ':' || v_order_date::text));
  NEW.order_number := COALESCE((
    SELECT MAX(orders.order_number)
    FROM public.orders AS orders
    WHERE orders.owner_id = NEW.owner_id
      AND (orders.created_at AT TIME ZONE 'Asia/Bangkok')::date = v_order_date
  ), 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_daily_branch_order_number ON public.orders;
CREATE TRIGGER trg_assign_daily_branch_order_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_daily_branch_order_number();

CREATE UNIQUE INDEX IF NOT EXISTS orders_owner_daily_number_key
  ON public.orders (
    owner_id,
    ((created_at AT TIME ZONE 'Asia/Bangkok')::date),
    order_number
  );

NOTIFY pgrst, 'reload schema';
