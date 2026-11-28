import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Headphones, RefreshCw, X } from 'lucide-react';
import type { TcPerformanceList, TcPolicy, TcTarget } from '../../../../shared/hrUpgrade';
import { telecallerPerformanceApi } from '../../../lib/api/endpoints';
import { confirmAction, toast } from '../../feedback/AppFeedback';
import { btn, ErrorBanner, inputCls, selectCls, Spinner } from '../../team-member/pipeline/shared';
import { HrPageHeader } from '../hrUi';
import { fmtDate, fmtDateTime, StatCard } from '../reviews/reviewUi';
import { CategoryPill, errText, pctText, ReviewPill, TelecallerProfile } from './TelecallerProfile';

type Tab = 'weekly' | 'targets' | 'policy';
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Call targets: the history of each scope, and (for the department's head, its CEO, the HR Department Head or the Super Admin) a form to set one. */
const TargetsTab: React.FC<{ data: TcPerformanceList }> = ({ data }) => {
  const [rows, setRows] = useState<TcTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({ scopeType: 'DEPARTMENT', effectiveFrom: data.weekEnd ? addDays(data.weekEnd, 1) : '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await telecallerPerformanceApi.targets()); setError(null); } catch (e) { setError(errText(e, 'The targets could not be loaded.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const o = data.options;
  const save = async () => {
    const daily = Number(f.dailyCalls);
    if (!Number.isInteger(daily) || daily < 1 || daily > 2000) { toast.error('The daily target is a whole number of calls (1 to 2000).'); return; }
    const body: Record<string, unknown> = { scopeType: f.scopeType, dailyCalls: daily, effectiveFrom: f.effectiveFrom };
    if (f.scopeType === 'DEPARTMENT' || f.scopeType === 'DESIGNATION') body.departmentId = f.departmentId;
    if (f.scopeType === 'DESIGNATION') body.designation = f.designation;
    if (f.scopeType === 'TEAM') body.teamId = f.teamId;
    if (f.scopeType === 'EMPLOYEE') body.profileId = f.profileId;
    if (f.weeklyCalls) body.weeklyCalls = Number(f.weeklyCalls);
    if (f.note?.trim()) body.note = f.note.trim();
    if (!(await confirmAction({ title: `Set a target of ${daily} calls a day?`, description: 'The current target of the same scope ends the day before. Finalised weeks keep the target they were calculated with.', confirmLabel: 'Set target' }))) return;
    setBusy(true);
    try { setRows(await telecallerPerformanceApi.setTarget(body)); toast.success('Target saved.'); } catch (e) { toast.error(errText(e, 'The target could not be saved.')); } finally { setBusy(false); }
  };
  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!rows) return <Spinner label="Loading targets…" />;
  const scopeText = (t: TcTarget) => t.scopeType === 'EMPLOYEE' ? `Employee: ${t.employee ?? '–'}` : t.scopeType === 'TEAM' ? `Team: ${t.team ?? '–'}`
    : t.scopeType === 'DESIGNATION' ? `${t.designation} (${t.department ?? '–'})` : `Department: ${t.department ?? '–'}`;
  return (
    <div className="space-y-3" data-testid="tc-targets">
      {data.canManage && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
          <p className="text-sm font-bold text-slate-800">Set a call target</p>
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="text-xs font-semibold text-slate-600">Applies to
              <select className={`${selectCls} w-full mt-1`} value={f.scopeType} onChange={e => setF({ ...f, scopeType: e.target.value })}>
                <option value="DEPARTMENT">A department</option><option value="TEAM">A team</option><option value="DESIGNATION">A designation</option><option value="EMPLOYEE">One Telecaller</option>
              </select></label>
            {(f.scopeType === 'DEPARTMENT' || f.scopeType === 'DESIGNATION') && <label className="text-xs font-semibold text-slate-600">Department
              <select className={`${selectCls} w-full mt-1`} value={f.departmentId ?? ''} onChange={e => setF({ ...f, departmentId: e.target.value })}>
                <option value="">Choose…</option>{o.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
            {f.scopeType === 'DESIGNATION' && <label className="text-xs font-semibold text-slate-600">Designation
              <input className={`${inputCls} mt-1`} list="tc-designations" maxLength={80} value={f.designation ?? ''} onChange={e => setF({ ...f, designation: e.target.value })} />
              <datalist id="tc-designations">{o.designations.map(d => <option key={d} value={d} />)}</datalist></label>}
            {f.scopeType === 'TEAM' && <label className="text-xs font-semibold text-slate-600">Team
              <select className={`${selectCls} w-full mt-1`} value={f.teamId ?? ''} onChange={e => setF({ ...f, teamId: e.target.value })}>
                <option value="">Choose…</option>{o.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
            {f.scopeType === 'EMPLOYEE' && <label className="text-xs font-semibold text-slate-600">Telecaller
              <select className={`${selectCls} w-full mt-1`} value={f.profileId ?? ''} onChange={e => setF({ ...f, profileId: e.target.value })}>
                <option value="">Choose…</option>{o.telecallers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
            <label className="text-xs font-semibold text-slate-600">Calls a day
              <input type="number" min={1} max={2000} className={`${inputCls} mt-1`} value={f.dailyCalls ?? ''} onChange={e => setF({ ...f, dailyCalls: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600">Weekly calls (optional, for reference)
              <input type="number" min={1} max={14000} className={`${inputCls} mt-1`} value={f.weeklyCalls ?? ''} onChange={e => setF({ ...f, weeklyCalls: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600">Starts on
              <input type="date" className={`${inputCls} mt-1`} value={f.effectiveFrom ?? ''} onChange={e => setF({ ...f, effectiveFrom: e.target.value })} /></label>
            <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Note
              <input className={`${inputCls} mt-1`} maxLength={500} value={f.note ?? ''} onChange={e => setF({ ...f, note: e.target.value })} /></label>
          </div>
          <div className="flex justify-end"><button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>Save target</button></div>
        </div>
      )}
      {rows.length === 0 ? <p className="text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 p-4 text-center">No call targets are set yet.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="text-left p-2">Scope</th><th className="text-right p-2">Calls a day</th><th className="text-right p-2">Weekly</th>
              <th className="text-left p-2">From</th><th className="text-left p-2">To</th><th className="text-left p-2">Set by</th><th className="text-left p-2">Note</th></tr></thead>
            <tbody>{rows.map(t => (
              <tr key={t.id} className={`border-t border-slate-100 ${t.effectiveTo ? 'text-slate-400' : ''}`}>
                <td className="p-2">{scopeText(t)}</td><td className="p-2 text-right font-semibold">{t.dailyCalls}</td><td className="p-2 text-right">{t.weeklyCalls ?? '–'}</td>
                <td className="p-2">{fmtDate(t.effectiveFrom)}</td><td className="p-2">{t.effectiveTo ? fmtDate(t.effectiveTo) : 'Current'}</td><td className="p-2">{t.by ?? '–'}</td><td className="p-2">{t.note ?? ''}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/** The review policy: the thresholds and the automatic review meetings (off until management approves). */
const PolicyTab: React.FC = () => {
  const [p, setP] = useState<TcPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const x = await telecallerPerformanceApi.policy(); setP(x); setError(null);
      setF({ achievedPct: String(x.achieved_pct), onTrackPct: String(x.on_track_pct), needsImprovementPct: String(x.needs_improvement_pct), reviewBelowPct: String(x.review_below_pct),
        minWorkingDays: String(x.min_working_days), consecutiveWeeks: String(x.consecutive_weeks), minDaysBetweenReviews: String(x.min_days_between_reviews),
        maxAutoReviews: String(x.max_auto_reviews), meetingMinutes: String(x.meeting_minutes), inviteTeamLead: x.invite_team_lead, inviteDepartmentHead: x.invite_department_head,
        inviteOperationsHead: x.invite_operations_head, enabled: x.enabled });
    } catch (e) { setError(errText(e, 'The policy could not be loaded.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!p) return <Spinner label="Loading the policy…" />;
  const num = (k: string) => Number(f[k]);
  const save = async () => {
    const body: Record<string, unknown> = { enabled: !!f.enabled, inviteTeamLead: !!f.inviteTeamLead, inviteDepartmentHead: !!f.inviteDepartmentHead, inviteOperationsHead: !!f.inviteOperationsHead };
    for (const k of ['achievedPct', 'onTrackPct', 'needsImprovementPct', 'reviewBelowPct', 'minWorkingDays', 'consecutiveWeeks', 'minDaysBetweenReviews', 'maxAutoReviews', 'meetingMinutes']) {
      if (!Number.isFinite(num(k))) { toast.error('Fill in every number.'); return; }
      body[k] = num(k);
    }
    if (!(num('achievedPct') >= num('onTrackPct') && num('onTrackPct') >= num('needsImprovementPct'))) { toast.error('The thresholds must go down: achieved ≥ on track ≥ needs improvement.'); return; }
    if (f.enabled && !p.enabled && !(await confirmAction({ title: 'Switch on automatic review meetings?', description: 'From the next weekly run, a finalised week below the review threshold opens one supportive review meeting with HR. You are recorded as the approver.', confirmLabel: 'Approve and switch on' }))) return;
    setBusy(true);
    try { await telecallerPerformanceApi.setPolicy(body); toast.success('Policy saved.'); await load(); } catch (e) { toast.error(errText(e, 'The policy could not be saved.')); } finally { setBusy(false); }
  };
  const field = (k: string, label: string, step = 1) => (
    <label key={k} className="text-xs font-semibold text-slate-600">{label}
      <input type="number" step={step} disabled={!p.canEdit} className={`${inputCls} mt-1`} value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
  );
  const box = (k: string, label: string) => (
    <label key={k} className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" disabled={!p.canEdit} checked={!!f[k]} onChange={e => setF({ ...f, [k]: e.target.checked })} />{label}</label>
  );
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3" data-testid="tc-policy">
      <p className={`text-sm rounded-xl p-2 ${p.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
        {p.enabled ? `Automatic review meetings are on (approved by ${p.approvedByName ?? '–'} on ${fmtDateTime(p.approved_at)}).`
          : 'Automatic review meetings are off until management approves the thresholds. The weekly figures are still calculated.'}</p>
      <div className="grid sm:grid-cols-3 gap-2">
        {field('achievedPct', 'Target achieved from (%)')}{field('onTrackPct', 'On track from (%)')}{field('needsImprovementPct', 'Needs improvement from (%)')}
        {field('reviewBelowPct', 'Review meeting below (%)')}{field('minWorkingDays', 'Minimum working days in the week', 0.5)}{field('consecutiveWeeks', 'Weeks in a row below the threshold')}
        {field('minDaysBetweenReviews', 'Days between two reviews')}{field('maxAutoReviews', 'Automatic reviews a year (max)')}{field('meetingMinutes', 'Meeting length (minutes)')}
      </div>
      <div className="flex flex-wrap gap-4">{box('inviteTeamLead', 'Invite the Team Lead')}{box('inviteDepartmentHead', 'Invite the Department Head')}{box('inviteOperationsHead', 'Invite the CEO')}</div>
      {box('enabled', 'Automatic review meetings on')}
      {p.canEdit ? <div className="flex justify-end"><button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>Save policy</button></div>
        : <p className="text-xs text-slate-500">Only the HR Department Head, a CEO or the Super Admin change the policy.</p>}
    </div>
  );
};

/**
 * Telecaller Performance (docs/hr-dashboard-upgrade.md, Phase 3): the weekly call figures against the working-day adjusted targets, the cards that
 * filter the list, the targets, the review policy, and one Telecaller's history (meetings, reports, improvement plans). Used by HR and by the
 * Sales Department Head / CEO / Team Lead dashboards: the database returns only the Telecallers each of them may see.
 */
export const TelecallerPerformance: React.FC<{ title?: string }> = ({ title = 'Telecaller Performance' }) => {
  const [tab, setTab] = useState<Tab>('weekly');
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const [data, setData] = useState<TcPerformanceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await telecallerPerformanceApi.list({ ...filters, weekStart: week })); setError(null); }
    catch (e) { setError(errText(e, 'The Telecaller performance could not be loaded.')); }
    finally { setLoading(false); }
  }, [filters, week]);
  useEffect(() => { void load(); }, [load]);
  const toggle = (k: string, v: string) => setFilters(f => ({ ...f, category: undefined, reviewStatus: undefined, [k]: f[k] === v ? undefined : v }));
  const c = data?.cards;
  const syncIssue = data?.sync.find(s => s.error);
  return (
    <div className="space-y-4" data-testid="telecaller-performance">
      <HrPageHeader icon={Headphones} title={title}
        subtitle="Outgoing Crocodial calls against the daily target × working days (approved leave, holidays and weekly offs adjusted). A week becomes final once its call logs are synchronised."
        actions={<button type="button" className={btn.secondary} onClick={() => void load()} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>} />
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {([['weekly', 'Weekly performance'], ['targets', 'Targets'], ['policy', 'Review policy']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? btn.primary : btn.secondary} onClick={() => setTab(id)}>{label}</button>))}
      </div>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <Spinner label="Loading Telecaller performance…" />}
      {data && tab === 'targets' && <TargetsTab data={data} />}
      {data && tab === 'policy' && <PolicyTab />}
      {data && tab === 'weekly' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn.secondary} aria-label="Previous week" onClick={() => setWeek(addDays(data.weekStart, -7))}><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold text-slate-800" data-testid="tc-week">Week of {fmtDate(data.weekStart)} – {fmtDate(data.weekEnd)}</span>
            <button type="button" className={btn.secondary} aria-label="Next week" onClick={() => setWeek(addDays(data.weekStart, 7))}><ChevronRight className="w-4 h-4" /></button>
            {data.options.teams.length > 1 && (
              <select aria-label="Team" className={selectCls} value={filters.teamId ?? ''} onChange={e => setFilters(f => ({ ...f, teamId: e.target.value || undefined }))}>
                <option value="">All teams</option>{data.options.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>)}
            {data.options.departments.length > 1 && (
              <select aria-label="Department" className={selectCls} value={filters.departmentId ?? ''} onChange={e => setFilters(f => ({ ...f, departmentId: e.target.value || undefined }))}>
                <option value="">All departments</option>{data.options.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>)}
          </div>
          {!data.policy.enabled && <p className="text-xs rounded-xl bg-amber-50 text-amber-900 p-2">Automatic review meetings are off until management approves the thresholds (Review policy tab).</p>}
          {syncIssue && <p className="text-xs rounded-xl bg-rose-50 text-rose-800 p-2">Crocodial call-log sync problem ({syncIssue.connection}): weeks stay "Call sync pending" until the logs are read again.</p>}
          {c && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" data-testid="tc-cards">
              <StatCard label="Telecallers" value={c.telecallers} />
              <StatCard label="Average achievement" value={pctText(c.average)} />
              <StatCard label="Target achieved" value={c.achieved} active={filters.category === 'TARGET_ACHIEVED'} onClick={() => toggle('category', 'TARGET_ACHIEVED')} />
              <StatCard label="On track" value={c.onTrack} active={filters.category === 'ON_TRACK'} onClick={() => toggle('category', 'ON_TRACK')} />
              <StatCard label="Needs improvement" value={c.needsImprovement} tone="warn" active={filters.category === 'NEEDS_IMPROVEMENT'} onClick={() => toggle('category', 'NEEDS_IMPROVEMENT')} />
              <StatCard label="Low performance" value={c.low} tone="danger" active={filters.category === 'LOW_PERFORMANCE'} onClick={() => toggle('category', 'LOW_PERFORMANCE')} testId="tc-card-low" />
              <StatCard label="Not evaluated / data pending" value={c.insufficient} />
              <StatCard label="Meetings pending" value={c.pendingMeetings} active={filters.reviewStatus === 'PENDING_SCHEDULING'} onClick={() => toggle('reviewStatus', 'PENDING_SCHEDULING')} />
              <StatCard label="Meetings scheduled" value={data.rows.filter(r => r.reviewStatus === 'SCHEDULED').length} active={filters.reviewStatus === 'SCHEDULED'} onClick={() => toggle('reviewStatus', 'SCHEDULED')} />
              <StatCard label="Reviews completed" value={c.completedMeetings} active={filters.reviewStatus === 'COMPLETED'} onClick={() => toggle('reviewStatus', 'COMPLETED')} />
            </div>
          )}
          {data.rows.length === 0 ? (
            <p className="text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 p-6 text-center">
              {filters.category || filters.reviewStatus ? 'No Telecallers match this filter.' : 'No figures for this week yet. They are calculated by the weekly run after the week ends.'}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-full text-xs" data-testid="tc-table">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="text-left p-2">Telecaller</th><th className="text-left p-2">Team</th><th className="text-right p-2">Working days</th><th className="text-right p-2">Adjusted target</th>
                  <th className="text-right p-2">Calls</th><th className="text-right p-2">Connected</th><th className="text-right p-2">Achievement</th><th className="text-left p-2">Category</th><th className="text-left p-2">Review</th>
                </tr></thead>
                <tbody>{data.rows.map(r => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-indigo-50/40 cursor-pointer" tabIndex={0} onClick={() => setOpen({ id: r.profileId, name: r.name })}
                    onKeyDown={e => { if (e.key === 'Enter') setOpen({ id: r.profileId, name: r.name }); }}>
                    <td className="p-2 font-semibold text-slate-800">{r.name}<span className="block text-[10px] font-normal text-slate-400">{r.employeeCode}</span></td>
                    <td className="p-2">{r.team ?? '–'}</td><td className="p-2 text-right">{r.eligibleDays}</td><td className="p-2 text-right">{r.adjustedTarget ?? '–'}</td>
                    <td className="p-2 text-right">{r.actualCalls}</td><td className="p-2 text-right">{r.connectedCalls}</td>
                    <td className="p-2 text-right font-semibold">{pctText(r.achievement)}{r.previousAchievement !== null && r.achievement !== null && (
                      <span className={`block text-[10px] ${r.achievement >= r.previousAchievement ? 'text-emerald-600' : 'text-rose-600'}`}>{r.achievement >= r.previousAchievement ? '▲' : '▼'} {pctText(Math.abs(r.achievement - r.previousAchievement))}</span>)}</td>
                    <td className="p-2"><CategoryPill value={r.category} />{r.status === 'PRELIMINARY' && <span className="block text-[10px] text-slate-400">preliminary</span>}</td>
                    <td className="p-2"><ReviewPill value={r.reviewStatus} /></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true" aria-label={`${open.name}: call performance`} onClick={() => setOpen(null)}>
          <div className="h-full w-full max-w-3xl overflow-y-auto bg-slate-50 p-4" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900">{open.name}</h2>
              <button type="button" className={btn.secondary} aria-label="Close" onClick={() => { setOpen(null); void load(); }}><X className="w-4 h-4" /></button>
            </div>
            <TelecallerProfile profileId={open.id} canRecalc={!!data?.canManage} />
          </div>
        </div>
      )}
    </div>
  );
};
