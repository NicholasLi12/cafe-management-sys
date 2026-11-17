'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSubmitting}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          placeholder="owner@cafe.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          placeholder="••••••••"
        />
      </div>

      {errorMessage && (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-xl bg-brand-600 px-4 py-3 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? 'Signing in…' : 'Sign In'}
      </button>

      <p className="text-center text-sm text-slate-600">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-semibold text-brand-700 hover:underline">
          Create a cafe account
        </Link>
      </p>
    </form>
  );
}
