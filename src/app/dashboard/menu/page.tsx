import { DashboardShell } from '@/components/dashboard-shell';

export default function MenuPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Menu</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Menu & Recipe Controls</h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold">Popular Items</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span>Espresso</span>
                <span>฿45</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span>Latte</span>
                <span>฿75</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span>Butter Croissant</span>
                <span>฿60</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold">Recipe Mapping</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">Latte → 0.02kg beans + 0.25L milk</li>
              <li className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">Espresso → 0.015kg beans</li>
              <li className="rounded-xl bg-slate-100 px-3 py-2 text-slate-700">Croissant → butter + flour</li>
            </ul>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
