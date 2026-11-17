import { DashboardShell } from '@/components/dashboard-shell';
import { EmployeeManager, type Employee } from '@/components/employee-manager';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';
import { redirect } from 'next/navigation';

export default async function EmployeesPage() {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }

  let cafeName: string | undefined;
  let ownerName: string | null = null;
  let franchiseId = user?.id;
  let employees: Employee[] = [];
  if (user) {
    if (profileError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load your profile: {profileError.message}</p></DashboardShell>;
    if (!profile) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">No profile was found for this account.</p></DashboardShell>;
    if (profile.role === 'barista') redirect('/dashboard/tables');
    cafeName = profile.cafe_name;
    ownerName = profile.owner_name;
    franchiseId = profile.franchise_owner_id ?? user.id;
    const { data, error } = await supabase.from('employees')
      .select('id, full_name, role, email, user_id, hourly_rate, phone, is_active, hired_date, employment_type, hours_worked, salary_paid, last_paid_at')
      .eq('franchise_owner_id', franchiseId)
      .order('full_name');
    if (error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load employees: {error.message}</p></DashboardShell>;
    employees = (data ?? []).map((employee) => ({
      ...employee,
      hourly_rate: Number(employee.hourly_rate),
      hours_worked: Number(employee.hours_worked),
      is_active: Boolean(employee.is_active),
      salary_paid: Boolean(employee.salary_paid),
    })) as Employee[];
  }

  return (
    <DashboardShell mode={user ? 'live' : 'demo'} cafeName={cafeName} ownerName={ownerName} role={user ? 'admin' : null}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Team</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Employee Directory</h1>
        </div>
        <EmployeeManager employees={employees} demo={!user} isAdmin={!!user} />
      </div>
    </DashboardShell>
  );
}
