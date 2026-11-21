import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CrocodialActivity } from '../../../shared/contracts';
import { crocodialApi } from '../../lib/api/endpoints';
import { EVENT_LABEL, ROLE_LABEL, incomeApi, rupees, units, type Earning, type IncomeSummary } from '../../lib/income';
import { PageTitle } from '../layout/shell';

/**
 * "My Income": the signed-in person's own incentive earnings (income_summary / income_earnings, 20270119000100). Shown in the side panel of
 * every sales dashboard. Earnings appear the moment Accounts verifies a payment (or a demo / field visit is completed); a reversed payment
 * shows its earning struck through. Payouts come later: until then the balance is everything earned.
 */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayText = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const whenText = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const duration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const PERIODS = [{ id: '30', label: 'Last 30 days', days: 29 }, { id: '90', label: 'Last 90 days', days: 89 }, { id: '365', label: 'Last 12 months', days: 364 }];

const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: string; strong?: boolean }> = ({ label, value, hint, strong }) => (
  <div className={`rounded-2xl border p-4 ${strong ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 text-2xl font-extrabold tabular-nums ${strong ? 'text-emerald-800' : 'text-slate-900'}`}>{value}</p>
    {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
  </div>
);

const what = (e: Earning) => {
  const parts = [e.serviceName, e.customerName].filter(Boolean).join(' · ');
  return parts || e.ruleName;
};

export const IncomePage: React.FC<{ title?: string }> = ({ title = 'My Income' }) => {
  const [summary, setSummary] = useState<IncomeSummary | null>(null);
  const [earnings, setEarnings] = useState<Earning[] | null>(null);
  const [period, setPeriod] = useState(PERIODS[0]);
  const [calls, setCalls] = useState<CrocodialActivity['calls'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const to = new Date(), from = new Date();
    from.setDate(from.getDate() - period.days);
    try {
      const [s, e] = await Promise.all([incomeApi.summary(), incomeApi.earnings(ymd(from), ymd(to))]);
      setSummary(s); setEarnings(e ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your income could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [period]);
  useEffect(() => { void load(); }, [load]);

  // calls and talk time only for someone connected to Crocodial (the calling app); anyone else sees no calls tile at all
  useEffect(() => {
    let alive = true;
    const now = new Date();
    const first = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    crocodialApi.me()
      .then(s => (s.enabled ? crocodialApi.activity({ from: first, to: ymd(now) }) : null))
      .then(a => { if (alive) setCalls(a && a.enabled && a.calls ? a.calls : null); })
      .catch(() => { if (alive) setCalls(null); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-6">
      <PageTitle
        title={title}
        subtitle="What you have earned from incentives. A sale counts when Accounts verifies the payment; a part payment counts in part."
        actions={<button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>}
      />
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      {summary && !summary.eligible && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Incentives start on <strong>{dayText(summary.startsOn)}</strong>. Work done before then does not earn an incentive.
        </div>
      )}

      <section aria-label="Earnings" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Today" value={summary ? rupees(summary.today) : '…'} />
        <Tile label="This month" value={summary ? rupees(summary.month) : '…'} />
        <Tile label="Total earned" value={summary ? rupees(summary.total) : '…'} />
        <Tile label="Balance" value={summary ? rupees(summary.balance) : '…'} hint="Withdrawals are coming soon." strong />
      </section>

      {summary && summary.targets.length > 0 && (
        <section aria-label="Targets" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Targets</h2>
          {summary.targets.map(t => {
            const pct = Math.min(100, t.targetUnits ? (t.unitsDone / t.targetUnits) * 100 : 0);
            return (
              <div key={t.ruleId}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-800">{t.serviceName || t.name}</span>
                  <span className="tabular-nums text-slate-600" data-testid="target-progress">{units(t.unitsDone)} of {units(t.targetUnits)}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label={`${t.serviceName || t.name} target`} aria-valuemin={0} aria-valuemax={t.targetUnits} aria-valuenow={t.unitsDone}>
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-slate-500">A target is a goal: every sale earns from the first one.</p>
        </section>
      )}

      <section aria-label="Activity this month" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Business this month" value={summary ? rupees(summary.activity.businessThisMonth) : '…'} hint="Verified payments on your customers" />
        <Tile label="Demos completed" value={summary ? summary.activity.demosCompletedThisMonth : '…'} hint="This month" />
        <Tile label="Field visits completed" value={summary ? summary.activity.visitsCompletedThisMonth : '…'} hint="This month" />
        {calls && <Tile label="Calls this month" value={calls.made} hint={`${calls.connected} connected · ${duration(calls.talkSeconds)} talk time`} />}
      </section>

      <section aria-label="Earnings list" className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">Your earnings</h2>
          <label className="text-sm text-slate-600 flex items-center gap-2">
            <span className="sr-only">Period</span>
            <select className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm" value={period.id} onChange={e => setPeriod(PERIODS.find(p => p.id === e.target.value) ?? PERIODS[0])}>
              {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        </div>
        {earnings && earnings.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No earnings in this period yet.</p>}
        {earnings && earnings.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {earnings.map(e => {
              const reversed = e.status === 'REVERSED';
              return (
                <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="earning-row">
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold text-slate-900 break-words ${reversed ? 'line-through text-slate-500' : ''}`}>{what(e)}</p>
                    <p className="text-xs text-slate-500">
                      {EVENT_LABEL[e.eventType]} · {ROLE_LABEL[e.role] ?? e.role} · {whenText(e.earnedAt)}
                    </p>
                    {reversed && <p className="mt-0.5 text-xs font-semibold text-rose-700">Reversed{e.reversedAt ? ` on ${whenText(e.reversedAt)}` : ''}: the payment was reversed.</p>}
                  </div>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${reversed ? 'line-through text-slate-400' : 'text-emerald-700'}`}>{rupees(e.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

export default IncomePage;
