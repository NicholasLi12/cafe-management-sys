'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type ActiveShift = { id: string; clock_in: string };

export function StaffShiftClock({
  employee,
  activeShift,
}: {
  employee: { id: string; full_name: string } | null;
  activeShift: ActiveShift | null;
}) {
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clockAction = async () => {
    setIsSaving(true);
    setErrorMessage('');
    try {
      const { createSupabaseClient } = await import('@/lib/supabase/client');
      const supabase = createSupabaseClient();
      const { error } = activeShift
        ? await supabase.rpc('staff_clock_out', { p_shift_id: activeShift.id })
        : await supabase.rpc('staff_clock_in');
      if (error) throw error;
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update your shift time.');
    } finally {
      setIsSaving(false);
    }
  };

  const elapsedSeconds = activeShift
    ? Math.max(0, Math.floor((now - Date.parse(activeShift.clock_in)) / 1000))
    : 0;
  const elapsed = `${Math.floor(elapsedSeconds / 3600).toString().padStart(2, '0')}:${Math.floor((elapsedSeconds % 3600) / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`;
  const clockInTime = activeShift
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(activeShift.clock_in))
    : null;

  return (
    <section className="rounded-2xl bg-slate-950 p-5 text-white shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Shift Time Clock</p>
        {employee ? (
          <>
            <h2 className="mt-1 text-xl font-bold">{employee.full_name}</h2>
            {activeShift ? (
              <p className="mt-1 text-sm text-slate-200">Clocked in since {clockInTime} · <span className="font-mono font-bold text-white">{elapsed}</span> elapsed</p>
            ) : (
              <p className="mt-1 text-sm text-slate-200">Off the clock</p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-200">No employee login is linked to this account.</p>
        )}
      </div>
      {employee && (
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void clockAction()}
          className={`mt-4 min-h-12 rounded-xl px-6 py-3 text-base font-black shadow-md disabled:cursor-wait disabled:opacity-60 sm:mt-0 ${activeShift ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300'}`}
        >
          {isSaving ? 'Saving…' : activeShift ? 'Clock Out' : 'Clock In'}
        </button>
      )}
      {errorMessage && <p role="alert" className="mt-3 basis-full rounded-lg bg-rose-100 px-3 py-2 text-sm font-medium text-rose-900 sm:mt-0">{errorMessage}</p>}
    </section>
  );
}
