'use client';

import { useState } from 'react';

export function LoginForm() {
  const [form, setForm] = useState({ email: '', password: '', cafeName: '', ownerName: '' });

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    console.log('Login request payload', form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Owner Name</label>
        <input
          value={form.ownerName}
          onChange={(e) => handleChange('ownerName', e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none ring-0 transition focus:border-brand-500"
          placeholder="Jane Doe"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Cafe Name</label>
        <input
          value={form.cafeName}
          onChange={(e) => handleChange('cafeName', e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none ring-0 transition focus:border-brand-500"
          placeholder="Morning Brew Cafe"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => handleChange('email', e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none ring-0 transition focus:border-brand-500"
          placeholder="owner@cafe.com"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
        <input
          type="password"
          value={form.password}
          onChange={(e) => handleChange('password', e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none ring-0 transition focus:border-brand-500"
          placeholder="••••••••"
        />
      </div>

      <button type="submit" className="w-full rounded-xl bg-brand-600 px-4 py-3 font-medium text-white transition hover:bg-brand-700">
        Sign In / Sign Up
      </button>
    </form>
  );
}
