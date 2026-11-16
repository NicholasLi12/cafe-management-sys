CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email text NOT NULL,
  owner_name text,
  cafe_name text NOT NULL DEFAULT 'My Cafe',
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, owner_name, cafe_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'owner_name', 'Owner'),
    COALESCE(NEW.raw_user_meta_data->>'cafe_name', 'My Cafe')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE IF NOT EXISTS public.employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'Barista',
  hourly_rate numeric(10,2) NOT NULL DEFAULT 0.00,
  phone text,
  is_active boolean DEFAULT true,
  hired_date date DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cafe_tables (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  table_number text NOT NULL,
  capacity int NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Coffee',
  price numeric(10,2) NOT NULL,
  estimated_cost numeric(10,2) DEFAULT 0.00,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  item_name text NOT NULL,
  unit text NOT NULL,
  current_stock numeric(10,2) NOT NULL DEFAULT 0,
  low_stock_threshold numeric(10,2) NOT NULL DEFAULT 5,
  unit_cost numeric(10,2) NOT NULL DEFAULT 0.00,
  auto_reorder_qty numeric(10,2) NOT NULL DEFAULT 10,
  last_restocked_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  table_id uuid REFERENCES public.cafe_tables(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  order_type text NOT NULL DEFAULT 'dine_in' CHECK (order_type IN ('dine_in', 'pickup', 'online_delivery')),
  platform_name text NOT NULL DEFAULT 'In-House',
  external_order_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'served', 'paid', 'cancelled')),
  payment_method text CHECK (payment_method IN ('cash', 'card', 'qr_transfer')),
  total_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  platform_fee numeric(10,2) NOT NULL DEFAULT 0.00,
  notes text,
  created_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE RESTRICT NOT NULL,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(10,2) NOT NULL,
  subtotal numeric(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE IF NOT EXISTS public.menu_item_ingredients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE CASCADE NOT NULL,
  supply_id uuid REFERENCES public.supplies(id) ON DELETE RESTRICT NOT NULL,
  quantity_required numeric(10,3) NOT NULL CHECK (quantity_required > 0),
  UNIQUE (menu_item_id, supply_id)
);

CREATE TABLE IF NOT EXISTS public.restock_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  supply_id uuid REFERENCES public.supplies(id) ON DELETE CASCADE NOT NULL,
  quantity_ordered numeric(10,2) NOT NULL,
  estimated_cost numeric(10,2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'ordered', 'received', 'dismissed')),
  created_at timestamptz DEFAULT now(),
  received_at timestamptz
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafe_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restock_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage own profile" ON public.profiles FOR ALL
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Owners manage own employees" ON public.employees FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners manage own tables" ON public.cafe_tables FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners manage own menu" ON public.menu_items FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners manage own supplies" ON public.supplies FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners manage own orders" ON public.orders FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners manage own order items" ON public.order_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
      AND orders.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners manage own recipes" ON public.menu_item_ingredients FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE menu_items.id = menu_item_ingredients.menu_item_id
      AND menu_items.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners manage own restock orders" ON public.restock_orders FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.auto_deduct_supplies_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec record;
  updated_supply record;
BEGIN
  FOR rec IN
    SELECT supply_id, quantity_required
    FROM public.menu_item_ingredients
    WHERE menu_item_id = NEW.menu_item_id
  LOOP
    UPDATE public.supplies
    SET current_stock = GREATEST(0, current_stock - (rec.quantity_required * NEW.quantity))
    WHERE id = rec.supply_id
    RETURNING * INTO updated_supply;

    IF updated_supply.current_stock <= updated_supply.low_stock_threshold THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.restock_orders
        WHERE supply_id = updated_supply.id
        AND status IN ('pending_approval', 'ordered')
      ) THEN
        INSERT INTO public.restock_orders (
          owner_id,
          supply_id,
          quantity_ordered,
          estimated_cost,
          status
        ) VALUES (
          updated_supply.owner_id,
          updated_supply.id,
          updated_supply.auto_reorder_qty,
          updated_supply.auto_reorder_qty * updated_supply.unit_cost,
          'pending_approval'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_deduct_supplies ON public.order_items;
CREATE TRIGGER trg_auto_deduct_supplies
  AFTER INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.auto_deduct_supplies_on_order();

CREATE OR REPLACE FUNCTION public.auto_apply_received_restock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'received' AND OLD.status <> 'received' THEN
    UPDATE public.supplies
    SET current_stock = current_stock + NEW.quantity_ordered,
        last_restocked_at = now()
    WHERE id = NEW.supply_id;

    NEW.received_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_apply_restock ON public.restock_orders;
CREATE TRIGGER trg_auto_apply_restock
  BEFORE UPDATE ON public.restock_orders
  FOR EACH ROW EXECUTE FUNCTION public.auto_apply_received_restock();

CREATE OR REPLACE FUNCTION public.create_order_atomic(
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
AS $$
DECLARE
  v_owner_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_total numeric := 0;
BEGIN
  v_owner_id := auth.uid();

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.orders (
    owner_id,
    table_id,
    order_type,
    payment_method,
    notes,
    platform_name,
    external_order_ref,
    platform_fee,
    status,
    total_amount
  )
  VALUES (
    v_owner_id,
    p_table_id,
    p_order_type,
    p_payment_method,
    p_notes,
    p_platform_name,
    p_external_order_ref,
    COALESCE(p_platform_fee, 0),
    'pending',
    0
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (
      order_id,
      menu_item_id,
      quantity,
      unit_price
    )
    SELECT
      v_order_id,
      (v_item->>'menu_item_id')::uuid,
      (v_item->>'quantity')::int,
      m.price
    FROM public.menu_items m
    WHERE m.id = (v_item->>'menu_item_id')::uuid
      AND m.owner_id = v_owner_id;

    v_total := v_total + (
      (v_item->>'quantity')::int * (
        SELECT m.price
        FROM public.menu_items m
        WHERE m.id = (v_item->>'menu_item_id')::uuid
        AND m.owner_id = v_owner_id
      )
    );
  END LOOP;

  UPDATE public.orders
  SET total_amount = v_total
  WHERE id = v_order_id;

  IF p_table_id IS NOT NULL THEN
    UPDATE public.cafe_tables
    SET status = 'occupied'
    WHERE id = p_table_id
      AND owner_id = v_owner_id;
  END IF;

  RETURN v_order_id;
END;
$$;
