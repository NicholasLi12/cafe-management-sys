'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';
import { getFranchiseContext } from '@/lib/supabase/franchise-client';

export type Employee = {
  id: string;
  full_name: string;
  role: string;
  email: string | null;
  user_id: string | null;
  hourly_rate: number;
  employment_type: 'full_time' | 'part_time';
  hours_worked: number;
  salary_paid: boolean;
  last_paid_at: string | null;
  phone: string | null;
  is_active: boolean;
  hired_date: string | null;
};

type EmployeeForm = {
  full_name: string;
  role: 'Barista' | 'Admin';
  email: string;
  password: string;
  hourly_rate: string;
  employment_type: 'full_time' | 'part_time';
  hours_worked: string;
  salary_paid: boolean;
  phone: string;
  hired_date: string;
};

const today = () => new Date().toLocaleDateString('en-CA');
const createEmptyForm = (): EmployeeForm => ({
  full_name: '',
  role: 'Barista',
  email: '',
  password: '',
  hourly_rate: '0',
  employment_type: 'full_time',
  hours_worked: '0',
  salary_paid: false,
  phone: '',
  hired_date: today(),
});
const demoEmployees: Employee[] = [
  { id: 'demo-1', full_name: 'Nina', role: 'Admin', email: null, user_id: null, hourly_rate: 18000, employment_type: 'full_time', hours_worked: 0, salary_paid: true, last_paid_at: null, phone: null, is_active: true, hired_date: null },
  { id: 'demo-2', full_name: 'Kim', role: 'Barista', email: null, user_id: null, hourly_rate: 320, employment_type: 'part_time', hours_worked: 60, salary_paid: false, last_paid_at: null, phone: null, is_active: true, hired_date: null },
];

export function EmployeeManager({
  employees,
  demo = false,
  isAdmin = false,
}: {
  employees: Employee[];
  demo?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(demo && !employees.length ? demoEmployees : employees);
  const [form, setForm] = useState<EmployeeForm>(createEmptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [hoursInputs, setHoursInputs] = useState<Record<string, string>>({});

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          hourly_rate: Number(form.hourly_rate),
          hours_worked: form.employment_type === 'part_time' ? Number(form.hours_worked) : 0,
          email: form.email.trim().toLowerCase(),
          full_name: form.full_name.trim(),
        }),
      });
      const result = await response.json() as { employee?: Employee; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not create employee and login.');
      if (!result.employee) throw new Error('Employee login was created but the employee record was not returned.');
      setRows((current) => [...current, result.employee!].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setForm(createEmptyForm());
      setSuccessMessage('Employee and login created successfully.');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create employee and login.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateEmployee = async (
    employee: Employee,
    updates: Partial<Pick<Employee, 'employment_type' | 'hours_worked' | 'salary_paid' | 'last_paid_at'>>
  ) => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(employee.id);
    try {
      await getFranchiseContext();
      const { data, error } = await createSupabaseClient()
        .from('employees')
        .update(updates)
        .eq('id', employee.id)
        .select('employment_type, hours_worked, salary_paid, last_paid_at')
        .single();
      if (error) throw error;
      setRows((current) => current.map((row) => row.id === employee.id ? {
        ...row,
        employment_type: data.employment_type,
        hours_worked: Number(data.hours_worked),
        salary_paid: Boolean(data.salary_paid),
        last_paid_at: data.last_paid_at,
      } : row));
      setSuccessMessage(`${employee.full_name}'s payroll details updated.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update payroll details.');
    } finally {
      setBusyId(null);
    }
  };

  const saveHours = (employee: Employee) => {
    const hours = Number(hoursInputs[employee.id] ?? employee.hours_worked);
    if (!Number.isFinite(hours) || hours < 0 || !Number.isInteger(hours * 2)) {
      setErrorMessage('Hours worked must be a non-negative number in 0.5-hour increments.');
      return;
    }
    void updateEmployee(employee, { hours_worked: hours });
  };

  const toggleSalaryPaid = (employee: Employee) => {
    const salaryPaid = !employee.salary_paid;
    void updateEmployee(employee, {
      salary_paid: salaryPaid,
      last_paid_at: salaryPaid ? new Date().toISOString() : null,
    });
  };

  const startNewPayCycle = async () => {
    if (!window.confirm('Start a new pay cycle? This will mark all staff unpaid and reset part-time hours to zero.')) return;
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId('pay-cycle');
    try {
      const { franchiseId } = await getFranchiseContext();
      const { error } = await createSupabaseClient()
        .from('employees')
        .update({ salary_paid: false, last_paid_at: null, hours_worked: 0 })
        .eq('franchise_owner_id', franchiseId);
      if (error) throw error;
      setRows((current) => current.map((employee) => ({ ...employee, salary_paid: false, last_paid_at: null, hours_worked: 0 })));
      setHoursInputs({});
      setSuccessMessage('New pay cycle started. All employees are marked unpaid and hours have been reset.');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not start a new pay cycle.');
    } finally {
      setBusyId(null);
    }
  };

  const payrollTotal = rows.reduce((total, employee) => total + (
    employee.employment_type === 'part_time'
      ? employee.hourly_rate * employee.hours_worked
      : employee.hourly_rate
  ), 0);
  const paidEmployees = rows.filter((employee) => employee.salary_paid);
  const unpaidEmployees = rows.filter((employee) => !employee.salary_paid);
  const payrollAmount = (employeesToSum: Employee[]) => employeesToSum.reduce((total, employee) => total + (
    employee.employment_type === 'part_time'
      ? employee.hourly_rate * employee.hours_worked
      : employee.hourly_rate
  ), 0);

  const changeRole = async (employee: Employee, role: 'Admin' | 'Barista') => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(employee.id);
    try {
      const response = await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.id, role }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not update employee role.');
      setRows((current) => current.map((row) => row.id === employee.id ? { ...row, role } : row));
      setSuccessMessage(`${employee.full_name}'s role updated to ${role}.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update employee role.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (employee: Employee) => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(employee.id);
    try {
      await getFranchiseContext();
      const { data, error } = await createSupabaseClient().from('employees')
        .update({ is_active: !employee.is_active })
        .eq('id', employee.id)
        .select('is_active')
        .single();
      if (error) throw error;
      setRows((current) => current.map((row) => row.id === employee.id ? { ...row, is_active: Boolean(data.is_active) } : row));
      setSuccessMessage(`${employee.full_name} marked ${data.is_active ? 'active' : 'inactive'}.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update employee status.');
    } finally {
      setBusyId(null);
    }
  };

  const removeEmployee = async (employee: Employee) => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(employee.id);
    try {
      const response = await fetch('/api/employees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not remove employee.');
      setRows((current) => current.filter((row) => row.id !== employee.id));
      setSuccessMessage(`${employee.full_name} removed.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not remove employee.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {demo && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">Demo employee records are read-only. Sign in to manage your team.</p>}
      {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>}

      {(isAdmin || demo) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-slate-900">Add Team Member</h2>
          <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm text-slate-700">Full name
              <input required value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Role
              <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as EmployeeForm['role'] }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="Barista">Barista</option>
                <option value="Admin">Admin</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">Email
              <input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Temporary password
              <input required type="password" minLength={6} autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Work type
              <select value={form.employment_type} onChange={(event) => setForm((current) => ({
                ...current,
                employment_type: event.target.value as EmployeeForm['employment_type'],
                hours_worked: event.target.value === 'full_time' ? '0' : current.hours_worked,
              }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">{form.employment_type === 'full_time' ? 'Monthly salary (฿)' : 'Hourly rate (฿)'}
              <input type="number" min="0" step="0.01" value={form.hourly_rate} onChange={(event) => setForm((current) => ({ ...current, hourly_rate: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            {form.employment_type === 'part_time' && (
              <label className="text-sm text-slate-700">Hours worked
                <input type="number" min="0" step="0.5" value={form.hours_worked} onChange={(event) => setForm((current) => ({ ...current, hours_worked: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
            )}
            <label className="text-sm text-slate-700">Salary status
              <select value={form.salary_paid ? 'paid' : 'unpaid'} onChange={(event) => setForm((current) => ({ ...current, salary_paid: event.target.value === 'paid' }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">Phone
              <input type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Hired date
              <input type="date" value={form.hired_date} onChange={(event) => setForm((current) => ({ ...current, hired_date: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={demo || isSaving} className="w-full rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {isSaving ? 'Creating…' : 'Add Employee & Create Login'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Payroll Summary</h2>
          {isAdmin && !demo && (
            <button type="button" disabled={busyId === 'pay-cycle'} onClick={startNewPayCycle} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">
              {busyId === 'pay-cycle' ? 'Starting…' : 'Start New Pay Cycle'}
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <p className="text-sm text-slate-500">Total Payroll</p>
            <p className="mt-1 text-xl font-bold text-slate-900">฿{payrollTotal.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-800">Paid Staff · {paidEmployees.length}</p>
            <p className="mt-1 text-xl font-bold text-emerald-900">฿{payrollAmount(paidEmployees).toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">Unpaid Staff · {unpaidEmployees.length}</p>
            <p className="mt-1 text-xl font-bold text-amber-900">฿{payrollAmount(unpaidEmployees).toFixed(2)}</p>
          </div>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-soft">
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Full Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Work Type</th>
              <th className="px-4 py-3">Hours & Rate</th>
              <th className="px-4 py-3">Salary Status</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Hired Date</th>
              <th className="px-4 py-3">Login Status</th>
              {isAdmin && !demo && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((employee) => (
              <tr key={employee.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-medium text-slate-900">{employee.full_name}</td>
                <td className="px-4 py-3">{employee.email ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${employee.role.toLowerCase() === 'admin' ? 'bg-violet-100 text-violet-800' : 'bg-brand-100 text-brand-800'}`}>
                    {employee.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${employee.employment_type === 'part_time' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                    {employee.employment_type === 'part_time' ? 'Part-time' : 'Full-time'}
                  </span>
                  {isAdmin && !demo && (
                    <select
                      aria-label={`Work type for ${employee.full_name}`}
                      value={employee.employment_type}
                      disabled={busyId === employee.id}
                      onChange={(event) => {
                        const employmentType = event.target.value as Employee['employment_type'];
                        void updateEmployee(employee, {
                          employment_type: employmentType,
                          ...(employmentType === 'full_time' ? { hours_worked: 0 } : {}),
                        });
                      }}
                      className="mt-2 block rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="full_time">Full-time</option>
                      <option value="part_time">Part-time</option>
                    </select>
                  )}
                </td>
                <td className="min-w-52 px-4 py-3">
                  {employee.employment_type === 'part_time' ? (
                    <>
                      <p>฿{employee.hourly_rate.toFixed(2)}/hr</p>
                      <div className="mt-1 flex items-center gap-2">
                        <label className="sr-only" htmlFor={`hours-${employee.id}`}>Hours worked</label>
                        <input
                          id={`hours-${employee.id}`}
                          type="number"
                          min="0"
                          step="0.5"
                          value={hoursInputs[employee.id] ?? String(employee.hours_worked)}
                          onChange={(event) => setHoursInputs((current) => ({ ...current, [employee.id]: event.target.value }))}
                          disabled={demo || busyId === employee.id}
                          className="w-20 rounded border border-slate-300 px-2 py-1"
                        />
                        {isAdmin && !demo && (
                          <button type="button" disabled={busyId === employee.id} onClick={() => saveHours(employee)} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                            Update
                          </button>
                        )}
                      </div>
                      <p className="mt-1 font-medium text-slate-800">Calculated pay: ฿{(employee.hourly_rate * employee.hours_worked).toFixed(2)}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">Fixed Monthly</p>
                      <p className="font-medium">Monthly salary: ฿{employee.hourly_rate.toFixed(2)}</p>
                    </>
                  )}
                </td>
                <td className="min-w-40 px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${employee.salary_paid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {employee.salary_paid ? 'Paid' : 'Unpaid'}
                  </span>
                  {employee.salary_paid && employee.last_paid_at && (
                    <p className="mt-1 text-xs text-slate-500">{new Date(employee.last_paid_at).toLocaleDateString()}</p>
                  )}
                  {isAdmin && !demo && (
                    <button type="button" disabled={busyId === employee.id} onClick={() => toggleSalaryPaid(employee)} className="mt-2 block rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                      Mark {employee.salary_paid ? 'Unpaid' : 'Paid'}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3">{employee.phone ?? '—'}</td>
                <td className="px-4 py-3">{employee.hired_date ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={employee.user_id && employee.email ? 'text-emerald-700' : 'text-slate-500'}>
                    {employee.user_id && employee.email ? 'Active Login' : 'No login'}
                  </span>
                </td>
                {isAdmin && !demo && (
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Role for ${employee.full_name}`}
                        value={employee.role === 'Admin' ? 'Admin' : 'Barista'}
                        disabled={busyId === employee.id}
                        onChange={(event) => changeRole(employee, event.target.value as 'Admin' | 'Barista')}
                        className="rounded-lg border border-slate-300 px-2 py-1"
                      >
                        <option value="Barista">Barista</option>
                        <option value="Admin">Admin</option>
                      </select>
                      <button type="button" disabled={busyId === employee.id} onClick={() => toggleActive(employee)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                        {employee.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" disabled={busyId === employee.id} onClick={() => removeEmployee(employee)} className="rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-700 disabled:opacity-50">
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={isAdmin && !demo ? 10 : 9} className="px-4 py-8 text-center text-slate-500">No team members added yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
