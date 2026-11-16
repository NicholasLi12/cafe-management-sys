import Link from 'next/link';

const navItems = [
  { href: '/dashboard', label: 'Summary' },
  { href: '/dashboard/tables', label: 'Tables' },
  { href: '/dashboard/menu', label: 'Menu' },
  { href: '/dashboard/inventory', label: 'Inventory' },
  { href: '/dashboard/employees', label: 'Employees' },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 w-64 border-r border-slate-200 bg-slate-900 text-slate-100">
        <div className="px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">CafeOps</p>
          <h2 className="mt-2 text-xl font-bold">Cafe Manager</h2>
        </div>

        <nav className="space-y-2 px-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-800 p-4 text-sm text-slate-300">
          Demo mode · Asia/Bangkok
        </div>
      </aside>

      <main className="ml-64 p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
