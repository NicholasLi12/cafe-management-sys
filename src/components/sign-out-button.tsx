'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setErrorMessage('');
    setIsSigningOut(true);

    try {
      const { error } = await createSupabaseClient().auth.signOut();
      if (error) throw error;

      router.replace('/login');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to sign out.');
      setIsSigningOut(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white disabled:opacity-60"
      >
        {isSigningOut ? 'Signing out…' : 'Sign Out'}
      </button>
      {errorMessage && <p role="alert" className="mt-2 text-xs text-rose-300">{errorMessage}</p>}
    </div>
  );
}
