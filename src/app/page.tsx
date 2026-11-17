import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">CafeOps Manager</p>
        <h1 className="text-3xl font-bold text-slate-900">Cafe operations, inventory, and profit in one place</h1>
        <p className="mt-4 text-base text-slate-600">
          Track orders, manage ingredients, monitor low stock, and understand daily profit without spreadsheet chaos.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/login" className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-3 font-medium text-white transition hover:bg-brand-700">
            Sign In
          </Link>
          <Link href="/signup" className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-100">
            Create Account
          </Link>
        </div>
      </div>
    </main>
  );
}
