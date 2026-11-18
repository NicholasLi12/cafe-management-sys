import { DashboardShell } from '@/components/dashboard-shell';
import { TableFloor, type CafeTable, type OrderMenuItem, type PosDrinkModifier } from '@/components/table-floor';
import type { ReceiptOrder } from '@/components/receipt-modal';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

type TableReceipt = ReceiptOrder & { id: string };

function normalizeReceiptModifiers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      typeof entry !== 'object'
      || entry === null
      || !('group' in entry)
      || !('option' in entry)
      || !('upcharge' in entry)
      || typeof entry.group !== 'string'
      || typeof entry.option !== 'string'
      || typeof entry.upcharge !== 'number'
    ) return [];
    return [{ group: entry.group, option: entry.option, upcharge: entry.upcharge }];
  });
}

export default async function TablesPage() {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }

  let tables: CafeTable[] = [];
  let menuItems: OrderMenuItem[] = [];
  let drinkModifiers: PosDrinkModifier[] = [];
  let recentOrders: TableReceipt[] = [];
  let cafeName: string | undefined;
  let ownerName: string | null = null;
  let role: 'admin' | 'barista' | null = null;
  if (user) {
    if (profileError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load your profile: {profileError.message}</p></DashboardShell>;
    if (!profile) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">No profile was found for this account.</p></DashboardShell>;
    role = profile.role === 'barista' ? 'barista' : 'admin';
    cafeName = profile.cafe_name;
    ownerName = profile.owner_name;
    const franchiseId = profile.franchise_owner_id ?? user.id;
    const [tablesResult, menuResult, modifiersResult, ordersResult] = await Promise.all([
      supabase.from('cafe_tables').select('id, table_number, capacity, status').eq('owner_id', franchiseId).order('table_number'),
      role === 'admin'
        ? supabase.from('menu_items').select('id, name, category, price, estimated_cost, has_sizes, size_prices').eq('owner_id', franchiseId).eq('is_available', true).order('name')
        : supabase.from('menu_items').select('id, name, category, price, has_sizes, size_prices').eq('owner_id', franchiseId).eq('is_available', true).order('name'),
      supabase.from('modifier_supply_rules')
        .select('id, modifier_name, group_type, price_delta, is_active, sort_order')
        .eq('tenant_id', franchiseId)
        .eq('is_active', true)
        .in('group_type', ['milk', 'addon'])
        .order('sort_order')
        .order('modifier_name'),
      supabase.from('orders')
        .select('id, order_number, order_type, platform_name, payment_method, total_amount, created_at, table_id')
        .eq('owner_id', franchiseId)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    const loadError = tablesResult.error ?? menuResult.error ?? modifiersResult.error ?? ordersResult.error;
    if (loadError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load operations data: {loadError.message}</p></DashboardShell>;
    tables = (tablesResult.data ?? []).map((table) => ({ ...table, capacity: Number(table.capacity) })) as CafeTable[];
    menuItems = (menuResult.data ?? []).map((item) => ({
      ...item,
      price: Number(item.price),
      estimated_cost: 'estimated_cost' in item ? Number(item.estimated_cost) : 0,
      has_sizes: item.has_sizes,
      size_prices: item.size_prices,
    })) as OrderMenuItem[];
    drinkModifiers = (modifiersResult.data ?? []).map((modifier) => ({
      ...modifier,
      price_delta: Number(modifier.price_delta),
    })) as PosDrinkModifier[];

    const orders = ordersResult.data ?? [];
    const orderIds = orders.map((order) => order.id);
    const { data: orderItems, error: orderItemsError } = orderIds.length
      ? await supabase.from('order_items')
        .select('order_id, menu_item_id, quantity, unit_price, subtotal, modifiers, notes')
        .in('order_id', orderIds)
      : { data: [], error: null };
    if (orderItemsError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load recent order items: {orderItemsError.message}</p></DashboardShell>;
    const itemRows = orderItems ?? [];
    const menuIds = Array.from(new Set(itemRows.map((item) => item.menu_item_id)));
    const { data: itemNames, error: itemNamesError } = menuIds.length
      ? await supabase.from('menu_items').select('id, name').eq('owner_id', franchiseId).in('id', menuIds)
      : { data: [], error: null };
    if (itemNamesError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load recent menu item names: {itemNamesError.message}</p></DashboardShell>;

    const itemNameById = new Map((itemNames ?? []).map((item) => [item.id, item.name]));
    const rowsByOrder = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const currentItems = rowsByOrder.get(item.order_id) ?? [];
      currentItems.push(item);
      rowsByOrder.set(item.order_id, currentItems);
    }
    const tableNameById = new Map((tablesResult.data ?? []).map((table) => [table.id, table.table_number]));
    recentOrders = orders.map((order) => ({
      id: order.id,
      order_number: order.order_number,
      created_at: order.created_at ?? new Date(0).toISOString(),
      order_type: order.order_type === 'dine_in'
        ? 'Dine-in'
        : order.order_type === 'online_delivery'
          ? `Delivery · ${order.platform_name ?? 'Platform'}`
          : 'Takeaway / pickup',
      table_label: order.table_id ? tableNameById.get(order.table_id) ?? null : null,
      payment_status: `Paid · ${order.payment_method === 'qr_transfer' ? 'QR Transfer' : order.payment_method ?? 'Payment method unavailable'}`,
      total_amount: Number(order.total_amount),
      items: (rowsByOrder.get(order.id) ?? []).map((item) => ({
        name: itemNameById.get(item.menu_item_id) ?? 'Removed menu item',
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        subtotal: Number(item.subtotal),
        modifiers: normalizeReceiptModifiers(item.modifiers),
        notes: item.notes,
      })),
    }));
  }

  return (
    <DashboardShell mode={user ? 'live' : 'demo'} cafeName={cafeName} ownerName={ownerName} role={role}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Operations</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Table Status Board</h1>
        </div>
        <TableFloor tables={tables} menuItems={menuItems} drinkModifiers={drinkModifiers} recentOrders={recentOrders} demo={!user} isAdmin={!user || role === 'admin'} branchName={cafeName ?? 'Cafe'} />
      </div>
    </DashboardShell>
  );
}
