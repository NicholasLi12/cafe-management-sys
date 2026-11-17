'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({ ownerName: '', cafeName: '', email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseClient();
      const email = form.email.trim();
      const ownerName = form.ownerName.trim();
      const cafeName = form.cafeName.trim();
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: form.password,
          owner_name: ownerName,
          cafe_name: cafeName,
        }),
      });
      const result = await response.json() as { email?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not create your cafe account.');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.email ?? email,
        password: form.password,
      });
      if (signInError) {
        throw new Error(`Account created, but automatic sign-in failed: ${signInError.message}`);
      }

      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : '';
      setErrorMessage(message || 'Could not create your account. Please try again.');
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
