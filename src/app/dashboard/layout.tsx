import type { ReactNode } from 'react';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await getDashboardContext();
  return children;
}
