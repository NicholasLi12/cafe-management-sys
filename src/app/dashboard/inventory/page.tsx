import { DashboardShell } from '@/components/dashboard-shell';
import { InventoryManager, type Supply } from '@/components/inventory-manager';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function InventoryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }

  let supplies: Supply[] = [];
  let cafeName: string | undefined;
  let ownerName: string | null = null;
  let role: 'admin' | 'barista' | null = null;
  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, franchise_owner_id, cafe_name, owner_name')
      .eq('id', user.id)
      .single();
    if (profileError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load your profile: {profileError.message}</p></DashboardShell>;
    role = profile.role === 'barista' ? 'barista' : 'admin';
    cafeName = profile.cafe_name;
    ownerName = profile.owner_name;
    const franchiseId = profile.franchise_owner_id ?? user.id;
    if (role === 'admin') {
      const { data, error } = await supabase
        .from('supplies')
        .select('id, item_name, unit, current_stock, low_stock_threshold, unit_cost, auto_reorder_qty')
        .eq('owner_id', franchiseId)
        .order('item_name');
      if (error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load inventory: {error.message}</p></DashboardShell>;
      supplies = data ?? [];
    } else {
      const { data, error } = await supabase
        .from('supplies')
        .select('id, item_name, unit, current_stock, low_stock_threshold')
        .eq('owner_id', franchiseId)
        .order('item_name');
      if (error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load inventory: {error.message}</p></DashboardShell>;
      supplies = (data ?? []).map((supply) => ({ ...supply, unit_cost: 0 }));
    }
  }

  return (
    <DashboardShell mode={user ? 'live' : 'demo'} cafeName={cafeName} ownerName={ownerName} role={role}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Inventory</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Supplies & Restock Center</h1>
        </div>
        <InventoryManager supplies={supplies} demo={!user} isAdmin={!user || role === 'admin'} />
      </div>
    </DashboardShell>
  );
}
