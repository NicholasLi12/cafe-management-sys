import { DashboardShell } from '@/components/dashboard-shell';
import { SummaryCards } from '@/components/summary-cards';

export default function DashboardPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Overview</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Daily Summary Routine</h1>
        </div>

        <SummaryCards />

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-slate-900">Low Stock Alerts</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">Arabica Beans · 4.2 kg · below threshold</li>
              <li className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">Whole Milk · 28 L · below threshold</li>
              <li className="rounded-xl bg-slate-100 px-3 py-2 text-slate-700">Cups · 96 pcs · stable</li>
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-slate-900">Today’s Notes</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="rounded-xl bg-slate-100 px-3 py-2">Morning prep is complete.</li>
              <li className="rounded-xl bg-slate-100 px-3 py-2">4 dine-in tables are active.</li>
              <li className="rounded-xl bg-slate-100 px-3 py-2">Delivery order demo is ready for testing.</li>
            </ul>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
