import { DashboardShell } from '@/components/dashboard-shell';

export default function EmployeesPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Team</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Employee Directory</h1>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            ['Nina', 'Manager', '฿450/day'],
            ['Kim', 'Barista', '฿320/day'],
            ['Aon', 'Cashier', '฿280/day'],
          ].map(([name, role, wage]) => (
            <div key={name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">{name[0]}</div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">{name}</h2>
              <p className="text-sm text-slate-600">{role}</p>
              <p className="mt-3 text-sm font-medium text-brand-600">{wage}</p>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
