import React, { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { ReviewCards, TcCards } from '../../../shared/hrUpgrade';
import { hrReviewsApi, telecallerPerformanceApi } from '../../lib/api/endpoints';
import { openHrTab, type HrTab } from './hrTabEvents';

type Loaded<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error' };
const load = <T,>(p: Promise<T>, set: (v: Loaded<T>) => void) => p.then(data => set({ state: 'ok', data }), () => set({ state: 'error' }));

/** One overview card: a number that opens the HR page it counts (keyboard accessible). */
const Tile: React.FC<{ label: string; value: number | string | null; hint?: string; tone?: 'default' | 'warn' | 'danger'; tab: HrTab; testId: string }> = ({
  label, value, hint, tone = 'default', tab, testId
}) => {
  const color = value === null ? 'text-slate-400' : tone === 'danger' && Number(value) > 0 ? 'text-rose-700' : tone === 'warn' && Number(value) > 0 ? 'text-amber-700' : 'text-slate-900';
  return (
    <button type="button" onClick={() => openHrTab(tab)} data-testid={testId}
      className="text-left bg-white p-3 rounded-2xl border border-slate-200/90 hover:border-indigo-300 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
      <p className="text-[11px] font-semibold text-slate-500 leading-tight">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${color}`}>{value === null ? '–' : value}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </button>
  );
};

/**
 * HR dashboard overview: the confirmation and internship reviews and the Telecaller performance at a glance (docs/hr-dashboard-upgrade.md, Phase 5).
 * The counts come from the same scoped database functions as the pages they open. A source that cannot be read shows "–" (never a made-up zero).
 */
export const HrUpgradeOverview: React.FC = () => {
  const [conf, setConf] = useState<Loaded<ReviewCards>>({ state: 'loading' });
  const [intern, setIntern] = useState<Loaded<ReviewCards>>({ state: 'loading' });
  const [tc, setTc] = useState<Loaded<{ cards: TcCards; weekStart: string; enabled: boolean }>>({ state: 'loading' });
  useEffect(() => {
    void load(hrReviewsApi.list({ type: 'PROBATION' }).then(r => r.cards), setConf);
    void load(hrReviewsApi.list({ type: 'INTERNSHIP' }).then(r => r.cards), setIntern);
    void load(telecallerPerformanceApi.list().then(r => ({ cards: r.cards, weekStart: r.weekStart, enabled: r.policy.enabled })), setTc);
  }, []);
  const v = <T,>(x: Loaded<T>, f: (d: T) => number | string) => (x.state === 'ok' ? f(x.data) : null);
  const failed = [conf, intern, tc].every(x => x.state === 'error');
  if (failed) return null;   // nothing readable (e.g. an HR Recruiter, or the migrations not run yet): the rest of the overview stays as it was
  return (
    <section aria-label="Reviews and performance" className="space-y-2" data-testid="hr-upgrade-overview">
      <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4" />Reviews and performance</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Tile label="Confirmations due within 10 days" value={v(conf, c => c.due10)} tab="hr_probation" testId="ov-due10" />
        <Tile label="Awaiting HR decision" value={v(conf, c => c.pendingHr)} tone="warn" tab="hr_probation" testId="ov-pending-hr" />
        <Tile label="Overdue confirmations" value={v(conf, c => c.overdue)} tone="danger" tab="hr_probation" testId="ov-overdue" />
        <Tile label="Upcoming internship reviews" value={v(intern, c => c.internshipsUpcoming)} hint={intern.state === 'ok' && intern.data.overdue ? `${intern.data.overdue} overdue` : undefined}
          tone="warn" tab="hr_internships" testId="ov-internships" />
        <Tile label="Telecallers below target (last week)" value={v(tc, d => d.cards.low + d.cards.needsImprovement)}
          hint={tc.state === 'ok' ? `${tc.data.cards.evaluated} of ${tc.data.cards.telecallers} evaluated` : undefined} tone="warn" tab="hr_telecaller_performance" testId="ov-tc-low" />
        <Tile label="Performance review meetings open" value={v(tc, d => d.cards.pendingMeetings)}
          hint={tc.state === 'ok' && !tc.data.enabled ? 'Automatic meetings off' : undefined} tab="hr_telecaller_performance" testId="ov-tc-meetings" />
      </div>
    </section>
  );
};
