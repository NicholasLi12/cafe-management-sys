CREATE OR REPLACE FUNCTION public.create_paid_order_atomic(
  p_table_id uuid,
  p_order_type text,
  p_payment_method text,
  p_notes text,
  p_platform_name text,
  p_external_order_ref text,
  p_platform_fee numeric,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_menu_item_id uuid;
  v_quantity int;
  v_price numeric;
  v_total numeric := 0;
BEGIN
  v_owner_id := public.current_franchise_id();

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_order_type IS NULL OR p_order_type NOT IN ('dine_in', 'pickup', 'online_delivery') THEN
    RAISE EXCEPTION 'Unsupported order type';
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'qr_transfer') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF COALESCE(p_platform_fee, 0) < 0 OR COALESCE(p_platform_fee, 0) = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Platform fee cannot be negative';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;

  IF p_order_type = 'dine_in' THEN
    IF p_table_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.cafe_tables
      WHERE id = p_table_id AND owner_id = v_owner_id
    ) THEN
      RAISE EXCEPTION 'Select one of your cafe tables for dine-in';
    END IF;
  ELSIF p_table_id IS NOT NULL THEN
    RAISE EXCEPTION 'Non-dine-in orders cannot be assigned to a table';
  ELSIF p_order_type = 'online_delivery' AND NULLIF(trim(p_platform_name), '') IS NULL THEN
    RAISE EXCEPTION 'Delivery platform name is required';
  END IF;

  INSERT INTO public.orders (
    owner_id, table_id, order_type, payment_method, notes, platform_name,
    external_order_ref, platform_fee, status, total_amount, closed_at
  )
  VALUES (
    v_owner_id, p_table_id, p_order_type, p_payment_method, p_notes,
    COALESCE(NULLIF(trim(p_platform_name), ''), 'In-House'),
    p_external_order_ref, COALESCE(p_platform_fee, 0), 'paid', 0, now()
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each order item must be an object';
    END IF;

    v_menu_item_id := (v_item->>'menu_item_id')::uuid;
    v_quantity := (v_item->>'quantity')::int;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Order item quantity must be a positive integer';
    END IF;

    SELECT price INTO v_price
    FROM public.menu_items
    WHERE id = v_menu_item_id
      AND owner_id = v_owner_id
      AND is_available = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item is unavailable or does not belong to this cafe';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.menu_item_ingredients ingredients
      JOIN public.supplies supplies ON supplies.id = ingredients.supply_id
      WHERE ingredients.menu_item_id = v_menu_item_id
        AND supplies.owner_id <> v_owner_id
    ) THEN
      RAISE EXCEPTION 'Menu item recipe references inventory outside this cafe';
    END IF;

    INSERT INTO public.order_items (order_id, menu_item_id, quantity, unit_price)
    VALUES (v_order_id, v_menu_item_id, v_quantity, v_price);
    v_total := v_total + (v_quantity * v_price);
  END LOOP;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;

  IF p_table_id IS NOT NULL THEN
    UPDATE public.cafe_tables SET status = 'occupied'
    WHERE id = p_table_id AND owner_id = v_owner_id;
  END IF;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_paid_order_atomic(uuid, text, text, text, text, text, numeric, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
