import { formatCurrencyTHB } from '@/lib/currency';
import { CircleDollarSign, Package, ReceiptText, Wallet } from 'lucide-react';

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
    { label: 'Gross Sales', value: formatCurrencyTHB(data.grossRevenue), Icon: CircleDollarSign, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Platform Fees', value: formatCurrencyTHB(data.platformFees), Icon: ReceiptText, tone: 'bg-slate-100 text-slate-600' },
    { label: 'Ingredient Cost (COGS)', value: formatCurrencyTHB(data.ingredientCosts), Icon: Package, tone: 'bg-orange-50 text-orange-600' },
    { label: 'True Net Profit', value: formatCurrencyTHB(data.netProfit), Icon: Wallet, tone: 'bg-orange-50 text-orange-600' },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">{stat.label}</p>
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${stat.tone}`}>
              <stat.Icon size={18} strokeWidth={1.75} />
            </span>
          </div>
          <p className="mt-3 text-lg font-semibold text-slate-900 tabular-nums">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
