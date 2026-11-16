const formatCurrency = (value: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
  }).format(value);

export function SummaryCards() {
  const stats = [
    { label: 'Gross Revenue', value: formatCurrency(8420), tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Platform Fees', value: formatCurrency(980), tone: 'bg-amber-50 text-amber-700' },
    { label: 'Ingredient Costs', value: formatCurrency(2140), tone: 'bg-rose-50 text-rose-700' },
    { label: 'Net Profit', value: formatCurrency(5300), tone: 'bg-brand-50 text-brand-700' },
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
