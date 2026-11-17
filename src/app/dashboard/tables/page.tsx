import { DashboardShell } from '@/components/dashboard-shell';
import { TableFloor, type CafeTable, type OrderMenuItem } from '@/components/table-floor';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

export default async function TablesPage() {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }

  let tables: CafeTable[] = [];
  let menuItems: OrderMenuItem[] = [];
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
    const [tablesResult, menuResult] = await Promise.all([
      supabase.from('cafe_tables').select('id, table_number, capacity, status').eq('owner_id', franchiseId).order('table_number'),
      role === 'admin'
        ? supabase.from('menu_items').select('id, name, category, price, estimated_cost').eq('owner_id', franchiseId).eq('is_available', true).order('name')
        : supabase.from('menu_items').select('id, name, category, price').eq('owner_id', franchiseId).eq('is_available', true).order('name'),
    ]);
    const loadError = tablesResult.error ?? menuResult.error;
    if (loadError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load operations data: {loadError.message}</p></DashboardShell>;
    tables = (tablesResult.data ?? []).map((table) => ({ ...table, capacity: Number(table.capacity) })) as CafeTable[];
    menuItems = (menuResult.data ?? []).map((item) => ({
      ...item,
      price: Number(item.price),
      estimated_cost: 'estimated_cost' in item ? Number(item.estimated_cost) : 0,
    })) as OrderMenuItem[];
  }

  return (
    <DashboardShell mode={user ? 'live' : 'demo'} cafeName={cafeName} ownerName={ownerName} role={role}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Operations</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Table Status Board</h1>
        </div>
        <TableFloor tables={tables} menuItems={menuItems} demo={!user} isAdmin={!user || role === 'admin'} />
      </div>
    </DashboardShell>
  );
}
