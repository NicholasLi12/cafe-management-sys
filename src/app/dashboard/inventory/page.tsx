import { DashboardShell } from '@/components/dashboard-shell';

export default function InventoryPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Inventory</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Supplies & Restock Center</h1>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3">Supply</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Threshold</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Arabica Beans</td>
                <td className="px-4 py-3">4.2 kg</td>
                <td className="px-4 py-3">5 kg</td>
                <td className="px-4 py-3"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Low</span></td>
                <td className="px-4 py-3"><button className="rounded-lg bg-brand-600 px-3 py-1.5 text-white">Restock</button></td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3">Whole Milk</td>
                <td className="px-4 py-3">28 L</td>
                <td className="px-4 py-3">30 L</td>
                <td className="px-4 py-3"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Low</span></td>
                <td className="px-4 py-3"><button className="rounded-lg bg-brand-600 px-3 py-1.5 text-white">Restock</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
