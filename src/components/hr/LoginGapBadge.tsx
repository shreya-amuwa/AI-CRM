import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';

/** More than this many minutes between the RM login and the biometric punch is flagged. */
export const LOGIN_GAP_LIMIT_MINUTES = 15;

/**
 * The difference between the RM (CRM) login and the biometric punch, as a badge.
 *  - 15 min or less: quiet, neutral.
 *  - more than 15 min: warning colours plus an icon and a screen-reader text (not colour alone).
 *  - either time missing: a muted "N/A" (never a made-up number).
 * `minutes` and `discrepancy` come from the database, so the badge and the rule always agree.
 */
export const LoginGapBadge: React.FC<{ minutes: number | null; discrepancy: boolean }> = ({ minutes, discrepancy }) => {
  const base = 'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11px] leading-none whitespace-nowrap font-sans';
  if (minutes === null) {
    return (
      <span className={`${base} bg-slate-100 border-slate-200 text-slate-500 font-medium`} title="Needs both an RM login and a biometric punch">
        N/A
        <span className="sr-only">: login timing cannot be compared, one of the two times is missing</span>
      </span>
    );
  }
  if (discrepancy) {
    return (
      <span className={`${base} bg-rose-50 border-rose-300 text-rose-800 font-bold`} title="Login timing discrepancy exceeds 15 minutes" data-testid="gap-badge-warning">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {minutes} min
        <span className="sr-only">: login timing discrepancy exceeds 15 minutes</span>
      </span>
    );
  }
  return (
    <span className={`${base} bg-sky-50 border-sky-200 text-sky-800 font-semibold`} title="Within 15 minutes" data-testid="gap-badge-normal">
      <Clock className="w-3.5 h-3.5 shrink-0 text-sky-500" aria-hidden="true" />
      {minutes} min
    </span>
  );
};
