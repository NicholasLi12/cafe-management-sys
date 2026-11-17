'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({ ownerName: '', cafeName: '', email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseClient();
      const email = form.email.trim();
      const ownerName = form.ownerName.trim();
      const cafeName = form.cafeName.trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          data: { owner_name: ownerName, cafe_name: cafeName },
        },
      });
      if (error) throw error;

      if (!data.user) {
        throw new Error('Account registration did not return a user.');
      }

      if (!data.session) {
        setMessage('Your account was created. Check your email to confirm your address, then sign in.');
        return;
      }

      const { error: profileError } = await supabase.from('profiles').upsert(
        {
          id: data.user.id,
          email: data.user.email ?? email,
          owner_name: ownerName,
          cafe_name: cafeName,
          role: 'admin',
          franchise_owner_id: data.user.id,
        },
        { onConflict: 'id' }
      );
      if (profileError) throw profileError;

      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create your account. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ownerName" className="mb-1 block text-sm font-medium text-slate-700">Owner Name</label>
        <input
          id="ownerName"
          name="ownerName"
          autoComplete="name"
          required
          value={form.ownerName}
          onChange={(event) => updateField('ownerName', event.target.value)}
          disabled={isSubmitting}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          placeholder="Jane Doe"
        />
      </div>

      <div>
        <label htmlFor="cafeName" className="mb-1 block text-sm font-medium text-slate-700">Cafe Name</label>
        <input
          id="cafeName"
          name="cafeName"
          required
          value={form.cafeName}
          onChange={(event) => updateField('cafeName', event.target.value)}
          disabled={isSubmitting}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          placeholder="Morning Brew Cafe"
        />
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(event) => updateField('email', event.target.value)}
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
          autoComplete="new-password"
          minLength={6}
          required
          value={form.password}
          onChange={(event) => updateField('password', event.target.value)}
          disabled={isSubmitting}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          placeholder="At least 6 characters"
        />
      </div>

      {errorMessage && (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-xl bg-brand-600 px-4 py-3 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? 'Creating account…' : 'Create Account'}
      </button>

      <p className="text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
