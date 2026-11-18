'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type StaffShift = {
  id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
  total_hours: number | null;
  notes: string | null;
  employee_name: string;
};

function localDateTimeValue(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

export function ShiftLogs({ shifts, isAdmin }: { shifts: StaffShift[]; isAdmin: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [notes, setNotes] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const beginEdit = (shift: StaffShift) => {
    setEditingId(shift.id);
    setClockIn(localDateTimeValue(shift.clock_in));
    setClockOut(shift.clock_out ? localDateTimeValue(shift.clock_out) : localDateTimeValue(new Date().toISOString()));
    setNotes(shift.notes ?? '');
    setErrorMessage('');
    setSuccessMessage('');
  };

  const saveEdit = async (shift: StaffShift) => {
    if (!clockIn || (clockOut && new Date(clockOut) <= new Date(clockIn))) {
      setErrorMessage('Clock-out must be later than clock-in.');
      return;
    }
    setBusyId(shift.id);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const { createSupabaseClient } = await import('@/lib/supabase/client');
      const { error } = await createSupabaseClient().rpc('admin_update_staff_shift', {
        p_shift_id: shift.id,
        p_clock_in: new Date(clockIn).toISOString(),
        p_clock_out: clockOut ? new Date(clockOut).toISOString() : null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      setEditingId(null);
      setSuccessMessage(`${shift.employee_name}'s shift was updated.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update this shift.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Shift Logs</h2>
        <p className="mt-1 text-sm text-slate-500">{isAdmin ? 'Clock activity for your cafe team.' : 'Your recent clock activity.'}</p>
      </div>
      {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-soft">
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Date</th>
              {isAdmin && <th className="px-4 py-3">Staff Name</th>}
              <th className="px-4 py-3">Clock In</th>
              <th className="px-4 py-3">Clock Out</th>
              <th className="px-4 py-3">Duration</th>
              {isAdmin && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id} className="border-t border-slate-200 align-top">
                <td className="whitespace-nowrap px-4 py-3">{formatLocalDate(shift.clock_in)}</td>
                {isAdmin && <td className="px-4 py-3 font-medium text-slate-900">{shift.employee_name}</td>}
                <td className="whitespace-nowrap px-4 py-3">{formatLocalTime(shift.clock_in)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {shift.clock_out
                    ? formatLocalTime(shift.clock_out)
                    : <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Active</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{shift.total_hours === null ? 'In progress' : `${Number(shift.total_hours).toFixed(2)} hrs`}</td>
                {isAdmin && (
                  <td className="min-w-52 px-4 py-3">
                    {editingId === shift.id ? (
                      <div className="space-y-2">
                        <label className="block text-xs">Clock in
                          <input type="datetime-local" value={clockIn} onChange={(event) => setClockIn(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                        </label>
                        <label className="block text-xs">Clock out <span className="text-slate-500">(blank keeps active)</span>
                          <input type="datetime-local" value={clockOut} onChange={(event) => setClockOut(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                        </label>
                        <label className="block text-xs">Notes
                          <input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                        </label>
                        <div className="flex gap-2">
                          <button type="button" disabled={busyId === shift.id} onClick={() => void saveEdit(shift)} className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                            {busyId === shift.id ? 'Saving…' : 'Save Shift'}
                          </button>
                          <button type="button" disabled={busyId === shift.id} onClick={() => setEditingId(null)} className="rounded border border-slate-300 px-3 py-1.5 text-xs">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => beginEdit(shift)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
                        {shift.clock_out ? 'Edit Shift' : 'Edit / Close'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!shifts.length && (
              <tr><td colSpan={isAdmin ? 6 : 4} className="px-4 py-8 text-center text-slate-500">No shift logs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
