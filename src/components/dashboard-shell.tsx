import Link from 'next/link';
import { SignOutButton } from '@/components/sign-out-button';

const navItems = [
  { href: '/dashboard', label: 'Summary' },
  { href: '/dashboard/tables', label: 'Tables' },
  { href: '/dashboard/barista', label: 'Barista Queue' },
  { href: '/dashboard/orders', label: 'Orders' },
  { href: '/dashboard/menu', label: 'Menu' },
  { href: '/dashboard/inventory', label: 'Inventory' },
  { href: '/dashboard/employees', label: 'Employees' },
  { href: '/dashboard/analytics', label: 'Analytics' },
] as const;

type DashboardShellProps = {
  children: React.ReactNode;
  cafeName?: string;
  ownerName?: string | null;
  role?: string | null;
  mode?: 'demo' | 'live';
};

export function DashboardShell({
  children,
  cafeName = 'Cafe Manager',
  ownerName,
  role = null,
  mode = 'demo',
}: DashboardShellProps) {
  const statusLabel = mode === 'live' ? 'Live data' : 'Demo mode';
  const normalizedRole = role?.toLowerCase();
  const visibleNavItems: ReadonlyArray<{ href: (typeof navItems)[number]['href']; label: string }> = normalizedRole === 'barista'
    ? [
      ...navItems.filter((item) => item.href !== '/dashboard' && item.href !== '/dashboard/employees'),
      { href: '/dashboard/employees', label: 'My Shifts' },
    ]
    : normalizedRole === 'admin'
      ? navItems
      : navItems.filter((item) => item.href !== '/dashboard/analytics');
  const roleLabel = normalizedRole === 'barista' ? 'Barista' : normalizedRole === 'admin' ? 'Admin' : null;

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-slate-900 text-slate-100 lg:flex">
        <div className="px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">CafeOps</p>
          <h2 className="mt-2 truncate text-xl font-bold">{cafeName}</h2>
          {ownerName && <p className="mt-1 truncate text-sm text-slate-400">{ownerName}</p>}
          {roleLabel && <span className="mt-3 inline-flex rounded-full bg-brand-900 px-2.5 py-1 text-xs font-semibold text-brand-100">{roleLabel}</span>}
        </div>

        <nav className="space-y-2 px-3">
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-3">
          <SignOutButton />
        </div>

        <div className="mt-auto border-t border-slate-800 p-4 text-sm text-slate-300">
          {statusLabel} · Asia/Bangkok
        </div>
      </aside>

      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:hidden">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">CafeOps</p>
            <h2 className="mt-1 truncate font-bold text-slate-900">{cafeName}</h2>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {statusLabel}
          </span>
        </div>
        {ownerName && <p className="mt-1 truncate text-sm text-slate-500">{ownerName}</p>}
        {roleLabel && <span className="mt-2 inline-flex rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">{roleLabel}</span>}
        <nav aria-label="Dashboard" className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-700"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-3">
          <SignOutButton />
        </div>
      </header>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:ml-64 lg:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
