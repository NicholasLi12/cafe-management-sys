'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { createSupabaseClient } from '@/lib/supabase/client';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error('Sign in succeeded but no user account was returned.');
      }

      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role, franchise_owner_id')
          .eq('id', data.user.id)
          .maybeSingle();

        if (!profileError && !profile) {
          const { error: ensureProfileError } = await supabase.from('profiles').upsert(
            {
              id: data.user.id,
              email: data.user.email ?? email.trim(),
              owner_name: data.user.user_metadata.owner_name ?? 'Owner',
              cafe_name: data.user.user_metadata.cafe_name ?? 'My Cafe',
              role: 'admin',
              franchise_owner_id: data.user.id,
            },
            { onConflict: 'id', ignoreDuplicates: true }
          );
          if (ensureProfileError) console.error('Could not ensure profile after sign-in:', ensureProfileError.message);
        }
      } catch (profileError) {
        console.error('Could not load profile after sign-in:', profileError);
      }

      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
        <div className="relative">
          <Mail size={18} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500/20 disabled:bg-slate-50"
            placeholder="owner@cafe.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
        <div className="relative">
          <Lock size={18} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-10 pr-11 text-sm text-slate-900 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500/20 disabled:bg-slate-50"
            placeholder="••••••••"
          />
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          >
            {showPassword
              ? <EyeOff size={17} strokeWidth={1.75} aria-hidden="true" />
              : <Eye size={17} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-orange-600 font-medium text-white shadow-xs transition-all hover:bg-orange-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting && <Loader2 size={16} strokeWidth={2} aria-hidden="true" className="animate-spin" />}
        {isSubmitting ? 'Signing in…' : 'Sign In'}
      </button>

      <p className="text-center text-sm text-slate-600">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-semibold text-orange-700 hover:text-orange-600 hover:underline">
          Create a cafe account
        </Link>
      </p>
    </form>
  );
}
