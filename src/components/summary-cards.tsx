import { formatCurrencyTHB } from '@/lib/currency';

type SummaryStats = {
  grossRevenue: number;
  platformFees: number;
  ingredientCosts: number;
  netProfit: number;
};

export function SummaryCards({ summary }: { summary?: SummaryStats }) {
  const data = summary ?? {
    grossRevenue: 8420,
    platformFees: 980,
    ingredientCosts: 2140,
    netProfit: 5300,
  };
  const stats = [
    { label: 'Gross Revenue', value: formatCurrencyTHB(data.grossRevenue), tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Platform Fees', value: formatCurrencyTHB(data.platformFees), tone: 'bg-amber-50 text-amber-700' },
    { label: 'Ingredient Costs', value: formatCurrencyTHB(data.ingredientCosts), tone: 'bg-rose-50 text-rose-700' },
    { label: 'Net Profit', value: formatCurrencyTHB(data.netProfit), tone: 'bg-brand-50 text-brand-700' },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <p className="text-sm text-slate-500">{stat.label}</p>
          <div className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ${stat.tone}`}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}
