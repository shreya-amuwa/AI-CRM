import React from 'react';

/**
 * One figure on the Performance Management page. Every card is the same height: the label on top, the value large, and a short muted
 * description under it that wraps instead of overflowing. A figure that cannot be worked out is shown as "-" with the reason in the
 * description (never as 0%, and never as a long sentence in the value's place).
 */
export type KpiTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';
const TONE: Record<KpiTone, string> = {
  neutral: 'text-slate-900',
  blue: 'text-blue-700',
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-rose-700'
};

export const KpiCard: React.FC<{ label: string; value: number | string | null; description: string; tone?: KpiTone; testId?: string }> = ({ label, value, description, tone = 'neutral', testId }) => {
  const empty = value === null;
  return (
    <div className="h-full min-w-0 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col" data-testid={testId ? `${testId}-card` : undefined}>
      <div className="text-[13px] font-semibold text-slate-500 leading-snug">{label}</div>
      <div
        className={`mt-2 text-3xl leading-none font-extrabold tabular-nums ${empty ? 'text-slate-300' : TONE[tone]}`}
        data-testid={testId}
        aria-label={empty ? `${label}: not available` : undefined}
      >
        {empty ? '—' : value}
      </div>
      <p className="mt-2 text-xs leading-snug text-slate-500 break-words">{description}</p>
    </div>
  );
};
