import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { SummaryCards } from '@/components/summary-cards';
import { APP_TIMEZONE } from '@/lib/currency';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

function getTodayRange() {
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const start = new Date(`${today}T00:00:00+07:00`);

  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError) {
    return (
      <DashboardShell>
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Could not verify your session: {authError.message}
        </p>
      </DashboardShell>
    );
  }

  if (!user) {
    return (
      <DashboardShell>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Overview</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Daily Summary Routine</h1>
          </div>
          <SummaryCards />
          <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-slate-600 shadow-soft">
            This is a demo dashboard. <Link className="font-semibold text-brand-700 hover:underline" href="/login">Sign in</Link> to see your cafe data.
          </div>
        </div>
      </DashboardShell>
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email, owner_name, cafe_name, role, franchise_owner_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return (
      <DashboardShell mode="live">
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Could not load your profile: {profileError.message}
        </p>
      </DashboardShell>
    );
  }

  if (profile?.role === 'barista') redirect('/dashboard/tables');
  const franchiseId = profile?.franchise_owner_id ?? user.id;
  const { start, end } = getTodayRange();
  const [ordersResult, suppliesResult, tablesResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total_amount, platform_fee')
      .eq('owner_id', franchiseId)
      .eq('status', 'paid')
      .gte('created_at', start)
      .lt('created_at', end),
    supabase
      .from('supplies')
      .select('item_name, unit, current_stock, low_stock_threshold')
      .eq('owner_id', franchiseId)
      .order('item_name'),
    supabase
      .from('cafe_tables')
      .select('status')
      .eq('owner_id', franchiseId),
  ]);
  const queryError = ordersResult.error ?? suppliesResult.error ?? tablesResult.error;

  if (queryError) {
    return (
      <DashboardShell mode="live">
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Could not load your cafe data: {queryError.message}
        </p>
      </DashboardShell>
    );
  }

  const orders = ordersResult.data ?? [];
  const supplies = suppliesResult.data ?? [];
  const tables = tablesResult.data ?? [];
  const orderItemsResult = orders.length
    ? await supabase
        .from('order_items')
        .select('quantity, menu_item_id')
        .in('order_id', orders.map((order) => order.id))
    : null;

  if (orderItemsResult?.error) {
    return (
      <DashboardShell mode="live">
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Could not load your order costs: {orderItemsResult.error.message}
        </p>
      </DashboardShell>
    );
  }

  const orderItems = orderItemsResult?.data ?? [];
  const menuItemIds = Array.from(new Set(orderItems.map((item) => item.menu_item_id)));
  const menuItemsResult = menuItemIds.length
    ? await supabase
        .from('menu_items')
        .select('id, estimated_cost')
        .in('id', menuItemIds)
    : null;

  if (menuItemsResult?.error) {
    return (
      <DashboardShell mode="live">
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Could not load menu costs: {menuItemsResult.error.message}
        </p>
      </DashboardShell>
    );
  }

  const grossRevenue = orders.reduce((total, order) => total + Number(order.total_amount ?? 0), 0);
  const platformFees = orders.reduce((total, order) => total + Number(order.platform_fee ?? 0), 0);
  const menuItemCosts = new Map(
    (menuItemsResult?.data ?? []).map((item) => [item.id, Number(item.estimated_cost ?? 0)])
  );
  const ingredientCosts = orderItems.reduce(
    (total, item) => total + Number(item.quantity ?? 0) * (menuItemCosts.get(item.menu_item_id) ?? 0),
    0
  );
  const lowStockSupplies = supplies.filter(
    (supply) => Number(supply.current_stock) <= Number(supply.low_stock_threshold)
  );
  const occupiedTables = tables.filter((table) => table.status === 'occupied').length;

  return (
    <DashboardShell
      mode="live"
      cafeName={profile?.cafe_name ?? 'Your Cafe'}
      ownerName={profile?.owner_name}
      role={profile?.role === 'barista' ? 'barista' : 'admin'}
    >
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Overview</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            {profile?.cafe_name ? `${profile.cafe_name} · Daily Summary` : 'Daily Summary'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">Today’s paid orders · Asia/Bangkok</p>
        </div>

        {!profile && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No owner profile was found for this account. Your other cafe data is shown, but update your profile after signing in again.
          </p>
        )}

        <SummaryCards
          summary={{
            grossRevenue,
            platformFees,
            ingredientCosts,
            netProfit: grossRevenue - platformFees - ingredientCosts,
          }}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-slate-900">Low Stock Alerts</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              {lowStockSupplies.length ? lowStockSupplies.map((supply) => (
                <li key={supply.item_name} className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
                  {supply.item_name} · {supply.current_stock} {supply.unit} · below threshold ({supply.low_stock_threshold} {supply.unit})
                </li>
              )) : (
                <li className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">
                  {supplies.length ? 'All supplies are above their low-stock thresholds.' : 'No supplies have been added yet.'}
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-slate-900">Today’s Notes</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="rounded-xl bg-slate-100 px-3 py-2">{orders.length} paid {orders.length === 1 ? 'order' : 'orders'} recorded today.</li>
              <li className="rounded-xl bg-slate-100 px-3 py-2">{occupiedTables} of {tables.length} tables are occupied.</li>
              <li className="rounded-xl bg-slate-100 px-3 py-2">Signed in as {profile?.email ?? user.email ?? 'Cafe owner'}.</li>
            </ul>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
