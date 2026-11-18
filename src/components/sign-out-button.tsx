'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createSupabaseClient } from '@/lib/supabase/client';

export function SignOutButton({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
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
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors disabled:opacity-60 ${
          variant === 'dark'
            ? 'text-slate-400 hover:bg-white/5 hover:text-white'
            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <LogOut size={18} strokeWidth={1.75} />
        {isSigningOut ? 'Signing out…' : 'Sign Out'}
      </button>
      {errorMessage && <p role="alert" className={`mt-2 text-xs ${variant === 'dark' ? 'text-rose-300' : 'text-rose-700'}`}>{errorMessage}</p>}
    </div>
  );
}
