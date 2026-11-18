import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { SummaryCards } from '@/components/summary-cards';
import { APP_TIMEZONE } from '@/lib/currency';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

type LowStockSupply = {
  id: string;
  item_name: string;
  unit: string;
  current_stock: number;
  low_stock_threshold: number;
};

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
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();

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
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Daily Summary Routine</h1>
            <p className="mt-1 text-sm text-slate-500">A quick overview of today’s cafe performance.</p>
          </div>
          <SummaryCards />
          <div className="rounded-2xl border border-brand-100 bg-white p-5 text-sm text-slate-600 shadow-soft">
            This is a demo dashboard. <Link className="font-semibold text-brand-700 hover:underline" href="/login">Sign in</Link> to see your cafe data.
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (profileError) {
    return (
      <DashboardShell mode="live">
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Could not load your profile: {profileError.message}
        </p>
      </DashboardShell>
    );
  }

  const franchiseId = profile?.franchise_owner_id ?? user.id;
  const { start, end } = getTodayRange();
  const [ordersResult, lowStockResult, tablesResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total_amount, platform_fee, cogs_total')
      .eq('owner_id', franchiseId)
      .eq('status', 'paid')
      .gte('created_at', start)
      .lt('created_at', end),
    supabase.rpc('get_low_stock_supplies'),
    supabase
      .from('cafe_tables')
      .select('status')
      .eq('owner_id', franchiseId),
  ]);
  const queryError = ordersResult.error ?? lowStockResult.error ?? tablesResult.error;

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
  const lowStockSupplies: LowStockSupply[] = lowStockResult.data ?? [];
  const tables = tablesResult.data ?? [];
  const grossRevenue = orders.reduce((total, order) => total + Number(order.total_amount ?? 0), 0);
  const platformFees = orders.reduce((total, order) => total + Number(order.platform_fee ?? 0), 0);
  const ingredientCosts = orders.reduce((total, order) => total + Number(order.cogs_total ?? 0), 0);
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
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            {profile?.cafe_name ? `${profile.cafe_name} · Daily Summary` : 'Daily Summary'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Today’s sales, costs, and cafe operations · Asia/Bangkok.</p>
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
            netProfit: grossRevenue - ingredientCosts,
          }}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-slate-900">Low Stock Alerts</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              {lowStockSupplies.length ? lowStockSupplies.map((supply) => (
                <li key={supply.item_name} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{supply.item_name}</span>
                    <span className="block text-slate-600">
                      <span className="tabular-nums">{supply.current_stock} {supply.unit} current · {supply.low_stock_threshold} {supply.unit} minimum</span>
                    </span>
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${Number(supply.current_stock) <= 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {Number(supply.current_stock) <= 0 ? 'Out of Stock' : 'Low Stock'}
                  </span>
                </li>
              )) : (
                <li className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">
                  All ingredients are stocked above threshold
                </li>
              )}
            </ul>
            <Link href="/dashboard/inventory" className="mt-4 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-800">
              Restock →
            </Link>
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
