import { LoginForm } from '@/components/login-form';
import { BrandLogo } from '@/components/brand-logo';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-[400px] rounded-2xl border border-slate-200/80 bg-white p-8 shadow-sm">
        <div className="mb-7">
          <BrandLogo showSubtitle />
          <h1 className="mt-7 text-xl font-semibold tracking-tight text-slate-900">Sign in to CafeOps</h1>
          <p className="mt-1 text-sm text-slate-500">Enter your branch or HQ credentials to continue.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
