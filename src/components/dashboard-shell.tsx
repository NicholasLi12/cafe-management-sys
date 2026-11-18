'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  ClipboardList,
  Coffee,
  LayoutDashboard,
  Package,
  ShoppingBag,
  Users,
  Utensils,
} from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { BranchSwitcher } from '@/components/branch-switcher';
import { SignOutButton } from '@/components/sign-out-button';

const sharedNavItems = [
  { href: '/dashboard', label: 'Summary', Icon: LayoutDashboard },
  { href: '/dashboard/tables', label: 'Tables', Icon: Utensils },
  { href: '/dashboard/barista', label: 'Barista Queue', Icon: Coffee },
  { href: '/dashboard/orders', label: 'Orders', Icon: ClipboardList },
  { href: '/dashboard/menu', label: 'Menu', Icon: ShoppingBag },
  { href: '/dashboard/inventory', label: 'Inventory', Icon: Package },
] as const;

const adminNavItems = [
  { href: '/dashboard/employees', label: 'Employees', Icon: Users },
  { href: '/dashboard/analytics', label: 'Analytics', Icon: BarChart3 },
] as const;

type DashboardShellProps = {
  children: ReactNode;
  cafeName?: string;
  ownerName?: string | null;
  role?: string | null;
  mode?: 'demo' | 'live';
};

function isActivePath(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === href : pathname.startsWith(href);
}

export function DashboardShell({
  children,
  cafeName = 'Cafe Manager',
  ownerName,
  role = null,
  mode = 'demo',
}: DashboardShellProps) {
  const pathname = usePathname();
  const statusLabel = mode === 'live' ? 'Live data' : 'Demo mode';
  const normalizedRole = role?.toLowerCase();
  const visibleNavItems = normalizedRole === 'admin'
    ? [...adminNavItems, ...sharedNavItems] as const
    : normalizedRole === 'barista'
      ? [...sharedNavItems, { href: '/dashboard/employees', label: 'My Shifts', Icon: Users }] as const
      : sharedNavItems;
  const roleLabel = normalizedRole === 'barista' ? 'Barista' : normalizedRole === 'admin' ? 'Admin' : null;

  const nav = (
    <nav aria-label="Dashboard" className="space-y-1">
      {visibleNavItems.map(({ href, label, Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'bg-white/10 font-medium text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            {active && <span aria-hidden="true" className="absolute ml-[-0.75rem] h-5 w-0.5 rounded-full bg-orange-400" />}
            <Icon size={18} strokeWidth={1.75} className={active ? 'text-orange-300' : 'text-slate-500 transition-colors group-hover:text-slate-300'} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/10 bg-slate-950 text-slate-100 lg:flex">
        <div className="px-4 pb-5 pt-6">
          <div className="px-2">
            <BrandLogo tone="dark" />
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-white">{cafeName}</h2>
                {ownerName && <p className="mt-1 truncate text-xs text-slate-400">{ownerName}</p>}
              </div>
              {roleLabel && (
                <span className="shrink-0 rounded-full border border-orange-300/20 bg-orange-300/10 px-2 py-0.5 text-[10px] font-semibold text-orange-200">
                  {roleLabel}
                </span>
              )}
            </div>
            {normalizedRole === 'admin' && <BranchSwitcher instanceId="desktop" />}
          </div>
        </div>

        <div className="px-3">{nav}</div>
        <div className="mt-auto space-y-3 px-3 pb-3">
          <SignOutButton />
          <div className="border-t border-white/10 px-3 pt-3 text-xs text-slate-500">
            {statusLabel} · Asia/Bangkok
          </div>
        </div>
      </aside>

      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:hidden">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-600">CafeOps</p>
            <h2 className="mt-1 truncate font-semibold text-slate-900">{cafeName}</h2>
          </div>
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
            {statusLabel}
          </span>
        </div>
        {ownerName && <p className="mt-1 truncate text-sm text-slate-500">{ownerName}</p>}
        {roleLabel && <span className="mt-2 inline-flex rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">{roleLabel}</span>}
        {normalizedRole === 'admin' && <BranchSwitcher instanceId="mobile" />}
        <nav aria-label="Dashboard" className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {visibleNavItems.map(({ href, label, Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Icon size={18} strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-3">
          <SignOutButton variant="light" />
        </div>
      </header>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:ml-64 lg:p-8">
        <div className="dashboard-content mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
