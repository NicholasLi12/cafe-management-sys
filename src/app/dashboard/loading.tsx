function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading dashboard" className="space-y-6">
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-4 flex-1" />)}
        </div>
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="flex gap-4 border-b border-slate-100 px-4 py-4 last:border-0">
            {Array.from({ length: 5 }, (_, column) => <Skeleton key={column} className="h-4 flex-1" />)}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading dashboard content…</span>
    </div>
  );
}
