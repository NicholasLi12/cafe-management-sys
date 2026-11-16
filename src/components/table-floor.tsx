const tables = [
  { id: 'T1', status: 'available', label: 'Available' },
  { id: 'T2', status: 'occupied', label: 'Occupied' },
  { id: 'T3', status: 'reserved', label: 'Reserved' },
  { id: 'T4', status: 'available', label: 'Available' },
  { id: 'T5', status: 'occupied', label: 'Occupied' },
  { id: 'T6', status: 'reserved', label: 'Reserved' },
];

const statusStyles = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  occupied: 'bg-amber-50 text-amber-700 border-amber-200',
  reserved: 'bg-violet-50 text-violet-700 border-violet-200',
};

export function TableFloor() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {tables.map((table) => (
        <div key={table.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{table.id}</h3>
            <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusStyles[table.status as keyof typeof statusStyles]}`}>
              {table.label}
            </span>
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            Quick order: Latte + Croissant
          </div>
          <div className="mt-4 flex gap-2 text-xs">
            <button className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-white">Start Order</button>
            <button className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-700">Mark Paid</button>
          </div>
        </div>
      ))}
    </div>
  );
}
