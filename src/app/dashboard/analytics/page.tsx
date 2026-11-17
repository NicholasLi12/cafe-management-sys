import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { AnalyticsDashboard, type AnalyticsBranch, type AnalyticsOrder } from '@/components/analytics-dashboard';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

type DateRange = '7d' | '30d' | 'month';

function getBangkokDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

function bangkokMidnightUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000);
}

function getRangeStart(range: DateRange, now: Date) {
  const { year, month, day } = getBangkokDateParts(now);
  if (range === 'month') return bangkokMidnightUtc(year, month, 1);
  const daysBack = range === '30d' ? 29 : 6;
  const localStart = new Date(Date.UTC(year, month - 1, day - daysBack));
  return bangkokMidnightUtc(localStart.getUTCFullYear(), localStart.getUTCMonth() + 1, localStart.getUTCDate());
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: { range?: string };
}) {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError || !user) redirect('/login');
  if (profileError || !profile || profile.role?.toLowerCase() !== 'admin') redirect('/dashboard/tables');

  const range: DateRange = searchParams?.range === '30d' || searchParams?.range === 'month'
    ? searchParams.range
    : '7d';
  const now = new Date();
  const start = getRangeStart(range, now);
  const tenantId = profile.franchise_owner_id ?? user.id;
  const [ordersResult, membershipsResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total_amount, cogs_total, order_type, created_at, order_items(quantity, unit_price, modifiers, menu_items(name))')
      .eq('owner_id', tenantId)
      .eq('status', 'paid')
      .gte('created_at', start.toISOString())
      .lte('created_at', now.toISOString())
      .order('created_at', { ascending: true }),
    supabase.from('user_branch_memberships').select('branch_id').eq('user_id', user.id).eq('role', 'admin'),
  ]);
  const { data, error } = ordersResult;

  if (error) {
    return (
      <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role="admin">
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">
          Could not load analytics: {error.message}
        </p>
      </DashboardShell>
    );
  }
  if (membershipsResult.error) {
    return (
      <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role="admin">
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">
          Could not load franchise memberships: {membershipsResult.error.message}
        </p>
      </DashboardShell>
    );
  }

  let branchComparison: {
    branch_id: string;
    branch_name: string;
    orders_count: number;
    gross_sales: number;
    cogs_total: number;
    net_profit: number;
  }[] = [];
  if ((membershipsResult.data ?? []).length >= 2) {
    const { data: comparisonData, error: comparisonError } = await supabase.rpc('get_franchise_branch_analytics', {
      p_start: start.toISOString(),
      p_end: now.toISOString(),
    });
    if (comparisonError) {
      return (
        <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role="admin">
          <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">
            Could not load branch comparison: {comparisonError.message}
          </p>
        </DashboardShell>
      );
    }
    branchComparison = (comparisonData ?? []).map((branch: AnalyticsBranch) => ({
      ...branch,
      orders_count: Number(branch.orders_count),
      gross_sales: Number(branch.gross_sales),
      cogs_total: Number(branch.cogs_total),
      net_profit: Number(branch.net_profit),
    }));
  }

  const orders: AnalyticsOrder[] = (data ?? []).map((order) => ({
    id: order.id,
    total_amount: Number(order.total_amount),
    cogs_total: Number(order.cogs_total ?? 0),
    order_type: order.order_type,
    created_at: order.created_at,
    order_items: (order.order_items ?? []).map((item) => ({
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      modifiers: item.modifiers,
      menu_item: Array.isArray(item.menu_items) ? item.menu_items[0] ?? null : item.menu_items,
    })),
  }));

  return (
    <DashboardShell mode="live" cafeName={profile.cafe_name} ownerName={profile.owner_name} role="admin">
      <AnalyticsDashboard orders={orders} range={range} branchComparison={branchComparison} />
    </DashboardShell>
  );
}
