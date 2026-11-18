'use client';

import Link from 'next/link';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrencyTHB } from '@/lib/currency';
import { Activity, CircleDollarSign, Package, TrendingUp, type LucideIcon } from 'lucide-react';

type DateRange = '7d' | '30d' | 'month';
type OrderItem = {
  quantity: number;
  unit_price: number;
  modifiers: unknown;
  menu_item: { name: string } | null;
};

export type AnalyticsOrder = {
  id: string;
  total_amount: number;
  cogs_total: number;
  order_type: string;
  created_at: string;
  order_items: OrderItem[];
};

export type AnalyticsBranch = {
  branch_id: string;
  branch_name: string;
  orders_count: number;
  gross_sales: number;
  cogs_total: number;
  net_profit: number;
};

const rangeOptions: { value: DateRange; label: string }[] = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'month', label: 'This Month' },
];
const chartOrange = '#ea580c';
const chartGreen = '#059669';
const chartRed = '#e11d48';
const chartSlate = '#64748b';
const channelColors = [chartOrange, chartSlate, '#a855f7'];

function localDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function localHour(date: Date) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date));
}

function rangeDays(range: DateRange) {
  const today = localDateKey(new Date());
  const [year, month, day] = today.split('-').map(Number);
  const start = range === 'month'
    ? new Date(Date.UTC(year, month - 1, 1))
    : new Date(Date.UTC(year, month - 1, day - (range === '30d' ? 29 : 6)));
  const count = Math.round((Date.UTC(year, month - 1, day) - start.getTime()) / 86400000) + 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getTime() + index * 86400000);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return {
      key,
      label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date),
    };
  });
}

function modifierEntries(modifiers: unknown): { group: string; option: string }[] {
  if (!Array.isArray(modifiers)) return [];
  return modifiers.flatMap((modifier) => {
    if (!modifier || typeof modifier !== 'object') return [];
    const entry = modifier as { group?: unknown; option?: unknown };
    if (typeof entry.group !== 'string' || typeof entry.option !== 'string') return [];
    if (!['Size', 'Milk', 'Add-on'].includes(entry.group)) return [];
    if (entry.group === 'Milk' && entry.option === 'Regular') return [];
    return [{ group: entry.group, option: entry.option }];
  });
}

function channelName(orderType: string) {
  if (orderType === 'dine_in') return 'Dine-in';
  if (orderType === 'pickup') return 'Takeaway';
  return 'Delivery';
}

function MetricCard({ label, value, detail, tone, Icon }: { label: string; value: string; detail: string; tone: string; Icon: LucideIcon }) {
  return (
    <article className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
          <Icon size={18} strokeWidth={1.75} />
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function ChartCard({ title, description, children, className = '' }: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      {children}
    </section>
  );
}

export function AnalyticsDashboard({
  orders,
  range,
  branchComparison = [],
}: {
  orders: AnalyticsOrder[];
  range: DateRange;
  branchComparison?: AnalyticsBranch[];
}) {
  const dailyRows = rangeDays(range).map((day) => ({ ...day, sales: 0, cogs: 0, profit: 0 }));
  const dailyByKey = new Map(dailyRows.map((day) => [day.key, day]));
  const hourlyRows = Array.from({ length: 16 }, (_, index) => ({ hour: index + 7, label: `${String(index + 7).padStart(2, '0')}:00`, orders: 0 }));
  const items = new Map<string, { name: string; units: number; revenue: number }>();
  const channels = new Map<string, number>([['Dine-in', 0], ['Takeaway', 0], ['Delivery', 0]]);
  const customizations = new Map<string, { name: string; group: string; count: number }>();
  let grossSales = 0;
  let ingredientCost = 0;

  for (const order of orders) {
    grossSales += order.total_amount;
    ingredientCost += order.cogs_total;
    const createdAt = new Date(order.created_at);
    const day = dailyByKey.get(localDateKey(createdAt));
    if (day) {
      day.sales += order.total_amount;
      day.cogs += order.cogs_total;
      day.profit += order.total_amount - order.cogs_total;
    }
    const hour = localHour(createdAt);
    const hourly = hourlyRows.find((row) => row.hour === hour);
    if (hourly) hourly.orders += 1;
    const channel = channelName(order.order_type);
    channels.set(channel, (channels.get(channel) ?? 0) + 1);

    for (const item of order.order_items) {
      const name = item.menu_item?.name ?? 'Menu item';
      const itemEntry = items.get(name) ?? { name, units: 0, revenue: 0 };
      itemEntry.units += item.quantity;
      itemEntry.revenue += item.quantity * item.unit_price;
      items.set(name, itemEntry);
      for (const modifier of modifierEntries(item.modifiers)) {
        const key = `${modifier.group}:${modifier.option}`;
        const entry = customizations.get(key) ?? { name: modifier.option, group: modifier.group, count: 0 };
        entry.count += item.quantity;
        customizations.set(key, entry);
      }
    }
  }

  const netProfit = grossSales - ingredientCost;
  const margin = grossSales === 0 ? 0 : (netProfit / grossSales) * 100;
  const topItems = Array.from(items.values()).sort((a, b) => b.units - a.units).slice(0, 5);
  const customizationRows = Array.from(customizations.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  const channelRows = Array.from(channels, ([name, value]) => ({ name, value })).filter((row) => row.value > 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Business Insights</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Sales, costs, and order patterns · Asia/Bangkok.</p>
        </div>
        <nav aria-label="Analytics date range" className="flex flex-wrap gap-2">
          {rangeOptions.map((option) => (
            <Link
              key={option.value}
              href={`/dashboard/analytics?range=${option.value}`}
              aria-current={range === option.value ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${range === option.value ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </header>

      {branchComparison.length >= 2 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Branch Performance Comparison</h2>
            <p className="mt-1 text-sm text-slate-500">Admin branches · selected date range</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Branch</th>
                  <th className="px-5 py-3 text-right">Orders</th>
                  <th className="px-5 py-3 text-right">Gross Sales</th>
                  <th className="px-5 py-3 text-right">Ingredient Cost / COGS</th>
                  <th className="px-5 py-3 text-right">True Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branchComparison.map((branch) => (
                  <tr key={branch.branch_id}>
                    <td className="px-5 py-3 font-medium text-slate-900">{branch.branch_name}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{branch.orders_count}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatCurrencyTHB(branch.gross_sales)}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatCurrencyTHB(branch.cogs_total)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-emerald-700">{formatCurrencyTHB(branch.net_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Performance summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Gross Sales" value={formatCurrencyTHB(grossSales)} detail={`${orders.length} paid orders`} tone="bg-orange-50 text-orange-600" Icon={CircleDollarSign} />
        <MetricCard label="Ingredient Cost / COGS" value={formatCurrencyTHB(ingredientCost)} detail="Recipe-based recorded costs" tone="bg-slate-100 text-slate-600" Icon={Package} />
        <MetricCard label="True Net Profit" value={formatCurrencyTHB(netProfit)} detail="Gross sales minus ingredient cost" tone="bg-emerald-50 text-emerald-600" Icon={TrendingUp} />
        <MetricCard label="Net Profit Margin" value={`${margin.toFixed(1)}%`} detail="Net profit as a share of sales" tone="bg-orange-50 text-orange-600" Icon={Activity} />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Revenue vs. Ingredient Cost & Net Profit" description="Daily totals in ฿ for the selected period">
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value: number) => `฿${value.toLocaleString('en-US')}`} width={58} />
                <Tooltip formatter={(value) => formatCurrencyTHB(Number(value ?? 0))} />
                <Area type="monotone" dataKey="sales" name="Gross Sales" stroke={chartOrange} fill={chartOrange} fillOpacity={0.14} strokeWidth={2} />
                <Area type="monotone" dataKey="cogs" name="Ingredient Cost" stroke={chartRed} fill={chartRed} fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="profit" name="Net Profit" stroke={chartGreen} fill={chartGreen} fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-orange-600" />Gross sales</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-rose-600" />Ingredient cost</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" />Net profit</span>
          </div>
        </ChartCard>

        <ChartCard title="Peak Rush Hours" description="Paid order count by cafe-local hour · 07:00–22:00">
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyRows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={54} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="orders" name="Orders" fill={chartOrange} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Top-Selling Drinks & Items" description="Top five menu items by units sold; revenue shown on hover">
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topItems} layout="vertical" margin={{ top: 4, right: 20, left: 12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(label, payload) => {
                    const row = payload[0]?.payload as { revenue?: number } | undefined;
                    return `${label} · ${formatCurrencyTHB(Number(row?.revenue ?? 0))} revenue`;
                  }}
                  formatter={(value) => [`${value ?? 0} units`, 'Units sold']}
                />
                <Bar dataKey="units" name="Units sold" fill={chartOrange} radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Order Channels & Popular Customizations" description="Channel mix and most selected sizes, milk options, and add-ons">
          <div className="grid gap-2 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="min-w-0">
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Order channels</p>
              {channelRows.length ? (
                <>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={channelRows} dataKey="value" nameKey="name" innerRadius={45} outerRadius={76} paddingAngle={3}>
                          {channelRows.map((row, index) => <Cell key={row.name} fill={channelColors[index % channelColors.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1">
                    {channelRows.map((row, index) => (
                      <p key={row.name} className="flex items-center justify-between text-xs text-slate-600">
                        <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: channelColors[index % channelColors.length] }} />{row.name}</span>
                        <strong className="text-slate-900">{row.value}</strong>
                      </p>
                    ))}
                  </div>
                </>
              ) : <p className="mt-6 text-sm text-slate-500">No paid orders in this period.</p>}
            </div>
            <div className="min-w-0">
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Popular customizations</p>
              {customizationRows.length ? (
                <div className="mt-3 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={customizationRows} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value) => [`${value ?? 0} selections`, 'Selected']} />
                      <Bar dataKey="count" name="Selections" fill={chartSlate} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="mt-6 text-sm text-slate-500">No drink customizations recorded yet.</p>}
              {customizationRows.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {customizationRows.map((row) => `${row.name} (${row.group === 'Size' ? 'size' : row.group === 'Milk' ? 'milk' : 'add-on'})`).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </ChartCard>
      </section>
      {!orders.length && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">No paid orders were found for this date range. The charts will populate as orders are recorded.</p>}
    </div>
  );
}
