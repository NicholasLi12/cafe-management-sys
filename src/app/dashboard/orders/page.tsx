import { DashboardShell } from '@/components/dashboard-shell';
import { OrderHistory, type HistoryOrder } from '@/components/order-history';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';
import { redirect } from 'next/navigation';

export default async function OrdersPage() {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }
  if (!user) redirect('/login');

  if (profileError) {
    return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load your profile: {profileError.message}</p></DashboardShell>;
  }
  if (!profile) {
    return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">No profile was found for this account.</p></DashboardShell>;
  }

  const role = profile.role === 'barista' ? 'barista' : 'admin';
  const franchiseId = profile.franchise_owner_id ?? user.id;
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      order_type,
      platform_name,
      external_order_ref,
      status,
      payment_method,
      total_amount,
      platform_fee,
      notes,
      created_at,
      table_id
    `)
    .eq('owner_id', franchiseId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false });

  if (error) {
    return <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load order history: {error.message}</p>
    </DashboardShell>;
  }

  const orderRows = data ?? [];
  const orderIds = orderRows.map((order) => order.id);
  const tableIds = Array.from(new Set(orderRows.flatMap((order) => order.table_id ? [order.table_id] : [])));
  const [itemsResult, tablesResult] = await Promise.all([
    orderIds.length
      ? supabase.from('order_items').select('order_id, menu_item_id, quantity, unit_price, subtotal, modifiers, notes').in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    tableIds.length
      ? supabase.from('cafe_tables').select('id, table_number').in('id', tableIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const detailError = itemsResult.error ?? tablesResult.error;
  if (detailError) {
    return <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load order details: {detailError.message}</p>
    </DashboardShell>;
  }

  const itemRows = itemsResult.data ?? [];
  const menuItemIds = Array.from(new Set(itemRows.map((item) => item.menu_item_id)));
  const menuResult = menuItemIds.length
    ? await supabase.from('menu_items').select('id, name').in('id', menuItemIds)
    : { data: [], error: null };
  if (menuResult.error) {
    return <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load ordered item names: {menuResult.error.message}</p>
    </DashboardShell>;
  }

  const itemNames = new Map((menuResult.data ?? []).map((item) => [item.id, item.name]));
  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const orderItems = itemsByOrder.get(item.order_id) ?? [];
    orderItems.push(item);
    itemsByOrder.set(item.order_id, orderItems);
  }
  const tablesById = new Map((tablesResult.data ?? []).map((table) => [table.id, table]));

  const orders = orderRows.map((order) => ({
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    platform_name: order.platform_name,
    external_order_ref: order.external_order_ref,
    payment_method: order.payment_method,
    total_amount: Number(order.total_amount),
    platform_fee: Number(order.platform_fee),
    notes: order.notes,
    created_at: order.created_at ?? new Date(0).toISOString(),
    table: order.table_id ? tablesById.get(order.table_id) ?? null : null,
    items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
      name: itemNames.get(item.menu_item_id) ?? 'Removed menu item',
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      notes: item.notes,
    })),
  })) satisfies HistoryOrder[];

  return (
    <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Orders</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Order History</h1>
          <p className="mt-1 text-sm text-slate-500">Search and review paid orders for your cafe.</p>
        </div>
        <OrderHistory orders={orders} branchName={profile.cafe_name} />
      </div>
    </DashboardShell>
  );
}
