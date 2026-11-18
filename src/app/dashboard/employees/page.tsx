import { DashboardShell } from '@/components/dashboard-shell';
import { EmployeeManager, type Employee } from '@/components/employee-manager';
import { ShiftLogs, type StaffShift } from '@/components/shift-logs';
import { StaffShiftClock } from '@/components/staff-shift-clock';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

export default async function EmployeesPage() {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }

  let cafeName: string | undefined;
  let ownerName: string | null = null;
  let franchiseId = user?.id;
  let employees: Employee[] = [];
  let shifts: StaffShift[] = [];
  let role: 'admin' | 'barista' | null = user ? 'admin' : null;
  let currentEmployee: Employee | null = null;
  let activeShift: { id: string; clock_in: string } | null = null;
  let isHQOwner = false;
  if (user) {
    if (profileError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load your profile: {profileError.message}</p></DashboardShell>;
    if (!profile) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">No profile was found for this account.</p></DashboardShell>;
    role = profile.role === 'barista' ? 'barista' : 'admin';
    cafeName = profile.cafe_name;
    ownerName = profile.owner_name;
    franchiseId = profile.franchise_owner_id ?? user.id;
    const { data: ownedBranch, error: branchError } = await supabase
      .from('franchise_branches')
      .select('id')
      .eq('owner_user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (branchError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify branch ownership: {branchError.message}</p></DashboardShell>;
    isHQOwner = !!ownedBranch;
    let employeesQuery = supabase.from('employees')
      .select('id, full_name, role, email, user_id, hourly_rate, phone, is_active, hired_date, employment_type, hours_worked, salary_paid, last_paid_at')
      .eq('franchise_owner_id', franchiseId);
    if (role !== 'admin') employeesQuery = employeesQuery.eq('user_id', user.id);
    const [employeesResult, shiftsResult] = await Promise.all([
      employeesQuery.order('full_name'),
      supabase.from('staff_shifts')
        .select('id, employee_id, clock_in, clock_out, total_hours, notes')
        .eq('franchise_owner_id', franchiseId)
        .order('clock_in', { ascending: false })
        .limit(300),
    ]);
    if (employeesResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load employees: {employeesResult.error.message}</p></DashboardShell>;
    if (shiftsResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load shift logs: {shiftsResult.error.message}</p></DashboardShell>;

    employees = (employeesResult.data ?? []).map((employee) => ({
      ...employee,
      hourly_rate: Number(employee.hourly_rate),
      hours_worked: Number(employee.hours_worked),
      is_active: Boolean(employee.is_active),
      salary_paid: Boolean(employee.salary_paid),
    })) as Employee[];
    const employeeNames = new Map(employees.map((employee) => [employee.id, employee.full_name]));
    shifts = (shiftsResult.data ?? []).map((shift) => ({
      ...shift,
      total_hours: shift.total_hours === null ? null : Number(shift.total_hours),
      notes: shift.notes ?? null,
      employee_name: employeeNames.get(shift.employee_id) ?? 'Staff member',
    }));
    currentEmployee = employees.find((employee) => employee.user_id === user.id) ?? null;
    const currentShift = currentEmployee
      ? shifts.find((shift) => shift.employee_id === currentEmployee?.id && !shift.clock_out)
      : null;
    activeShift = currentShift ? { id: currentShift.id, clock_in: currentShift.clock_in } : null;
  }

  return (
    <DashboardShell mode={user ? 'live' : 'demo'} cafeName={cafeName} ownerName={ownerName} role={role}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Team</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">{role === 'barista' ? 'My Shift Time' : 'Employee Directory'}</h1>
        </div>
        <StaffShiftClock
          employee={currentEmployee ? { id: currentEmployee.id, full_name: currentEmployee.full_name } : null}
          activeShift={activeShift}
        />
        <ShiftLogs shifts={shifts} isAdmin={role === 'admin'} />
        {role !== 'barista' && <EmployeeManager employees={employees} demo={!user} isAdmin={!!user} isHQOwner={isHQOwner} />}
      </div>
    </DashboardShell>
  );
}
