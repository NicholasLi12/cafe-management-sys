import { DashboardShell } from '@/components/dashboard-shell';
import { TableFloor } from '@/components/table-floor';

export default function TablesPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Operations</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Table Status Board</h1>
        </div>
        <TableFloor />
      </div>
    </DashboardShell>
  );
}
