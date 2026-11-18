import { redirect } from 'next/navigation';
import { BaristaOrderQueue, type BaristaOrderTicket } from '@/components/barista-order-queue';
import { DashboardShell } from '@/components/dashboard-shell';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

export default async function BaristaQueuePage() {
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
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, order_number, order_type, platform_name, created_at, table_id, prep_status')
    .eq('owner_id', franchiseId)
    .in('prep_status', ['new', 'preparing', 'ready'])
    .order('created_at', { ascending: true });

  if (ordersError) {
    return <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load the barista queue: {ordersError.message}</p>
    </DashboardShell>;
  }

  const orderRows = orders ?? [];
  const orderIds = orderRows.map((order) => order.id);
  const tableIds = Array.from(new Set(orderRows.flatMap((order) => order.table_id ? [order.table_id] : [])));
  const [itemsResult, tablesResult] = await Promise.all([
    orderIds.length
      ? supabase.from('order_items').select('order_id, menu_item_id, quantity, unit_price, modifiers, notes').in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    tableIds.length
      ? supabase.from('cafe_tables').select('id, table_number').in('id', tableIds).eq('owner_id', franchiseId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const detailError = itemsResult.error ?? tablesResult.error;
  if (detailError) {
    return <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load queue details: {detailError.message}</p>
    </DashboardShell>;
  }

  const itemRows = itemsResult.data ?? [];
  const menuItemIds = Array.from(new Set(itemRows.map((item) => item.menu_item_id)));
  const menuResult = menuItemIds.length
    ? await supabase.from('menu_items').select('id, name').in('id', menuItemIds).eq('owner_id', franchiseId)
    : { data: [], error: null };
  if (menuResult.error) {
    return <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load queue item names: {menuResult.error.message}</p>
    </DashboardShell>;
  }

  const itemNames = new Map((menuResult.data ?? []).map((item) => [item.id, item.name]));
  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }
  const tablesById = new Map((tablesResult.data ?? []).map((table) => [table.id, table]));

  const tickets = orderRows.map((order) => ({
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    platform_name: order.platform_name,
    created_at: order.created_at ?? new Date(0).toISOString(),
    prep_status: order.prep_status,
    table_number: order.table_id ? tablesById.get(order.table_id)?.table_number ?? null : null,
    items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
      name: itemNames.get(item.menu_item_id) ?? 'Removed menu item',
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      notes: item.notes,
    })),
  })) satisfies BaristaOrderTicket[];

  return (
    <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role={role}>
      <BaristaOrderQueue initialTickets={tickets} franchiseId={franchiseId} />
    </DashboardShell>
  );
}
