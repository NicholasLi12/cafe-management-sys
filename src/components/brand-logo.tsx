import { Coffee } from 'lucide-react';

export function BrandLogo({
  tone = 'light',
  showSubtitle = false,
}: {
  tone?: 'light' | 'dark';
  showSubtitle?: boolean;
}) {
  const isDark = tone === 'dark';

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-orange-500 shadow-xs ring-1 ring-orange-500/30">
        <Coffee className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex flex-col">
        <span className={`text-base font-semibold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>CafeOps</span>
        {showSubtitle && <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>POS &amp; Operations</span>}
      </span>
    </div>
  );
}
