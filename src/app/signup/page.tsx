import { SignupForm } from '@/components/signup-form';

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Get started</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Create your cafe account</h1>
        </div>
        <SignupForm />
      </div>
    </main>
  );
}
