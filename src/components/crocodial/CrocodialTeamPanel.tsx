import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, PhoneCall } from 'lucide-react';
import type { CrocodialRefreshCapabilities, CrocodialTeamActivity, CrocodialTeamLeads } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi } from '../../lib/api/endpoints';
import { CrocodialActivityPanel } from './CrocodialActivity';
import { CrocodialRefreshControl } from './CrocodialRefreshControl';

/**
 * The management view of Crocodial (part 4 of docs/CROCODIAL_INTEGRATION.md): the connected people the signed-in manager may see, in the
 * existing hierarchy (a Team Lead: the people they lead; a Sales Department / Operations Head: the departments and Sales they cover; the
 * Super Admin: everyone). The database decides who is listed (croc_team_activity). Totals cover only the connected people listed and are
 * labelled so ("Crocodial Pilot - N connected employees"); a person not synced yet is shown as "not available", never as zero.
 * Choosing a person opens their activity (croc_activity, which checks again who may see it).
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86_400_000));
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const hours = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
const ROLE: Record<string, string> = { TELECALLER: 'Telecaller', BUSINESS_ASSOCIATE: 'Business Associate', INFLUENCER: 'Influencer', VISIT_SALES: 'Visit Sales', BUSINESS_PARTNER: 'Business Partner' };

/** A head's or Team Lead's own role, shown where they have no team (heads sit above teams). */
const HEAD_ROLE: Record<string, string> = { DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead' };

/**
 * What the "Crocodial" section of a Team Lead's or head's side panel shows: their own activity and leads (self: they are connected
 * themselves) and the people they oversee (team: any connected person they may see). Nothing is shown when both are false.
 */
/**
 * Whether a manager's dashboard shows the Crocodial menu. It comes from croc_refresh_capabilities (20270303000100): a Department Head, CEO or
 * Team Lead keeps the menu whenever one of their Sales departments has Crocodial switched on, even before anyone is connected and without a
 * mapping of their own; the pages then say what is missing. A failed request never hides the menu of a manager (the page shows the error and
 * a retry); only a definite "not enabled" does. `scopeKey` (the active department) reloads it after the department scope changes.
 */
export function useCrocodialNav(scopeKey?: string | null): { self: boolean; team: boolean } {
  const [team, setTeam] = useState(false);
  const [self, setSelf] = useState(false);
  useEffect(() => {
    let alive = true;
    crocodialApi.refreshCapabilities().then(
      c => {
        if (!alive) return;
        const manager = c.kind !== 'EMPLOYEE';
        setTeam(manager && c.active && (c.eligible ?? (c.departments.length > 0 || !!c.team?.people)));
        setSelf(c.active && c.self.state === 'CONNECTED');
      },
      () => alive && setTeam(true)
    );
    // a person connected before the capabilities existed (older database) still gets their own pages
    crocodialApi.me().then(d => alive && d.enabled && setSelf(true)).catch(() => undefined);
    return () => { alive = false; };
  }, [scopeKey]);
  return { self, team };
}

const Card: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-900">{value}</p>
    {hint ? <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p> : null}
  </div>
);

/**
 * The refresh buttons of a manager's view, from croc_refresh_capabilities:
 *   Team Lead        - Sync My Team (+ Sync My Data when connected themselves)
 *   Department Head  - Sync Department Data (+ a department choice when they cover more than one) (+ Sync My Data)
 *   CEO              - Sync Selected Department, Sync All My Departments (+ Sync My Data)
 *   Super Admin      - Sync Selected Department, Sync All Departments
 * The department choice also filters the figures below. Counts come from approved mappings, never from Crocodial's own user list.
 */
const RefreshBar: React.FC<{ caps: CrocodialRefreshCapabilities; dept: string; setDept: (v: string) => void; onCompleted: () => void; lastSyncAt: string | null }> = ({ caps, dept, setDept, onCompleted, lastSyncAt }) => {
  const heads = caps.kind === 'DEPARTMENT_HEAD' || caps.kind === 'OPERATIONS_HEAD' || caps.kind === 'SUPER_ADMIN';
  const depts = caps.departments;
  const chosen = depts.find(d => d.departmentId === dept) ?? (depts.length === 1 ? depts[0] : undefined);
  const recent = (scope: string, id?: string) => (caps.recent && caps.recent.scope === scope && (caps.recent.departmentId ?? undefined) === id ? caps.recent : null);
  const self = caps.self.state === 'CONNECTED';
  if (!self && !(caps.team?.people) && !(heads && depts.length)) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-start justify-between gap-3" data-testid="croc-refresh-bar">
      <div className="text-xs text-slate-600 space-y-1">
        {caps.kind === 'TEAM_LEAD' ? <p><b className="text-slate-800">My Team Crocodial Activity</b> · Connected employees: {caps.team?.people ?? 0}</p> : null}
        {heads ? (
          <p><b className="text-slate-800">{caps.kind === 'OPERATIONS_HEAD' ? 'CEO Crocodial Activity' : caps.kind === 'SUPER_ADMIN' ? 'All Crocodial Activity' : 'Department Crocodial Activity'}</b>
            {' '}· {caps.kind === 'DEPARTMENT_HEAD' ? 'Departments' : 'Authorized departments'}: {depts.length} · Connected employees: {caps.all?.people ?? 0}</p>
        ) : null}
        {heads && depts.length > 1 ? (
          <label className="flex items-center gap-1.5">Department
            <select className="border border-slate-200 rounded-md px-1.5 py-0.5 text-xs" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department">
              <option value="">All my departments</option>
              {depts.map(d => <option key={d.departmentId} value={d.departmentId}>{d.name} ({d.people})</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {caps.kind === 'TEAM_LEAD' && caps.team?.people ? (
          <CrocodialRefreshControl scope="TEAM" label="Sync My Team" variant="primary" lastSyncAt={lastSyncAt} onCompleted={onCompleted} resume={recent('TEAM')} />
        ) : null}
        {heads && chosen ? (
          <CrocodialRefreshControl key={chosen.departmentId} scope="DEPARTMENT" departmentId={chosen.departmentId}
            label={depts.length > 1 ? 'Sync Selected Department' : 'Sync Department Data'} variant={caps.kind === 'DEPARTMENT_HEAD' ? 'primary' : 'secondary'}
            lastSyncAt={chosen.lastSyncAt} onCompleted={onCompleted} resume={recent('DEPARTMENT', chosen.departmentId)} />
        ) : null}
        {heads && depts.length > 1 && caps.kind !== 'DEPARTMENT_HEAD' ? (
          <CrocodialRefreshControl scope="ALL" label={caps.kind === 'SUPER_ADMIN' ? 'Sync All Departments' : 'Sync All My Departments'} variant="primary"
            lastSyncAt={lastSyncAt} onCompleted={onCompleted} resume={recent('ALL')} />
        ) : null}
        {heads && depts.length > 1 && caps.kind === 'DEPARTMENT_HEAD' && !chosen ? (
          <CrocodialRefreshControl scope="ALL" label="Sync All My Departments" variant="primary" lastSyncAt={lastSyncAt} onCompleted={onCompleted} resume={recent('ALL')} />
        ) : null}
        {self ? <CrocodialRefreshControl scope="SELF" label="Sync My Data" lastSyncAt={caps.self.lastSyncAt} onCompleted={onCompleted} resume={recent('SELF')} /> : null}
      </div>
    </div>
  );
};

export const CrocodialTeamPanel: React.FC<{ title?: string }> = ({ title = 'Crocodial calling activity' }) => {
  const [range, setRange] = useState<[string, number]>(['7', 6]);
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(daysAgo(0));
  const [team, setTeam] = useState('');
  const [dept, setDept] = useState('');
  const [data, setData] = useState<CrocodialTeamActivity | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const [caps, setCaps] = useState<CrocodialRefreshCapabilities | null>(null);
  const [leads, setLeads] = useState<CrocodialTeamLeads | null>(null);
  const load = useCallback(() => {
    setError('');
    crocodialApi.teamActivity({ from, to, teamId: team || undefined, departmentId: dept || undefined }).then(setData).catch(e => setError(errText(e)));
    // who owns which lead now (an older server without it: the section is simply not shown)
    crocodialApi.teamLeads({ teamId: team || undefined, departmentId: dept || undefined }).then(setLeads, () => setLeads(null));
  }, [from, to, team, dept]);
  useEffect(load, [load]);
  // which refresh buttons this person has (the database decides from their role, scopes and approved mappings)
  useEffect(() => {
    crocodialApi.refreshCapabilities().then(setCaps).catch(() => setCaps(null));
  }, []);
  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.people ?? []) if (p.teamId) m.set(p.teamId, p.teamName ?? 'Team');
    return [...m.entries()];
  }, [data]);
  const maxDay = Math.max(1, ...(data?.daily ?? []).map(d => d.made));
  const extra = useMemo(() => {
    const ok = (data?.people ?? []).filter(p => p.available && p.calls);
    return { incoming: ok.reduce((n, p) => n + (p.calls?.incoming ?? 0), 0), missed: ok.reduce((n, p) => n + (p.calls?.missed ?? 0), 0) };
  }, [data]);
  // people without a team: Department Heads sit above teams, so name them rather than calling them "No team"
  const noTeam = (data?.people ?? []).filter(p => !p.teamId);
  const noTeamLabel = noTeam.length && noTeam.every(p => p.role === 'DEPARTMENT_HEAD') ? (noTeam.length === 1 ? 'Department Head' : 'Department Heads') : 'No team';

  if (open) {
    return (
      <div className="space-y-3">
        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" onClick={() => setOpen(null)}>
          <ChevronLeft className="w-3.5 h-3.5" aria-hidden /> All connected employees
        </button>
        <CrocodialActivityPanel profileId={open.id} title={`${open.name} — Crocodial activity`} />
      </div>
    );
  }
  const t = data?.totals;
  return (
    <section aria-label={title} className="space-y-4" data-testid="crocodial-team">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2"><PhoneCall className="w-5 h-5 text-indigo-600" aria-hidden /> {title}</h1>
          <p className="text-sm text-slate-500">{data ? data.label : 'Crocodial Pilot'} · Source: Crocodial (read-only){data?.oldestSyncAt ? ` · synced ${when(data.oldestSyncAt)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period">
          {([['today', 'Today', 0], ['7', 'Last 7 days', 6], ['30', 'Last 30 days', 29], ['90', 'Last 90 days', 89]] as [string, string, number][]).map(([id, label, back]) => (
            <button key={id} type="button" aria-pressed={range[0] === id} onClick={() => { setRange([id, back]); setFrom(daysAgo(back)); setTo(daysAgo(0)); }}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${range[0] === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
          ))}
          <label className="text-[11px] text-slate-500 flex items-center gap-1">From<input type="date" className="border border-slate-200 rounded-md px-1.5 py-0.5 text-xs" value={from} max={to} onChange={e => { setRange(['custom', 0]); setFrom(e.target.value); }} aria-label="From date" /></label>
          <label className="text-[11px] text-slate-500 flex items-center gap-1">to<input type="date" className="border border-slate-200 rounded-md px-1.5 py-0.5 text-xs" value={to} min={from} onChange={e => { setRange(['custom', 0]); setTo(e.target.value); }} aria-label="To date" /></label>
          {teams.length > 1 || team ? (
            <select className="border border-slate-200 rounded-md px-1.5 py-0.5 text-xs" value={team} onChange={e => setTeam(e.target.value)} aria-label="Team">
              <option value="">All teams</option>
              {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          ) : null}
        </div>
      </div>

      {caps?.active ? <RefreshBar caps={caps} dept={dept} setDept={v => { setDept(v); setTeam(''); }} onCompleted={load} lastSyncAt={data?.oldestSyncAt ?? null} /> : null}

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{error} <button type="button" className="underline" onClick={load}>Try again</button></p> : null}
      {!data && !error ? <p className="text-xs text-slate-500" role="status">Loading…</p> : null}
      {data && !data.connectedEmployees ? (
        <div className="text-sm text-slate-500 space-y-1" data-testid="croc-team-empty">
          <p>{caps?.kind === 'TEAM_LEAD' ? 'No team members connected to Crocodial yet.' : 'None of your people is connected to Crocodial yet.'}</p>
          {/* the menu stays for a manager whose departments have Crocodial on: say what is missing instead of hiding it */}
          {caps?.enabledDepartments?.length ? (
            <p className="text-xs" data-testid="croc-team-enabled">Crocodial is switched on for {caps.enabledDepartments.map(d => d.name).join(', ')}. Figures appear here once the administrator approves the employees' Crocodial accounts (Super Admin → Crocodial Integration → Employee mapping).</p>
          ) : null}
        </div>
      ) : null}
      {data && data.connectedEmployees > 0 && data.unavailable === data.connectedEmployees ? <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" role="status" data-testid="croc-team-first-import">The first Crocodial import is still in progress. Figures appear once it has finished (they are not zero).</p> : null}

      {data && data.connectedEmployees ? (
        <>
          <p className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900" data-testid="croc-team-note">
            <b>{data.label}.</b> {data.note}{data.unavailable ? ` ${data.unavailable} not synced yet (not counted).` : ''}
          </p>
          {data.anyStale ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">Some figures are more than 24 hours old and may not be current.</p> : null}
          {t ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-label="Totals">
              {/* the call figures of shared/crocodialFields.ts; unique numbers count each number once across the people listed */}
              <Card label="Total calls" value={t.made} hint="Outgoing calls" />
              <Card label="Connected" value={t.connected} hint={`Connect rate ${pct(t.connectRate)}`} />
              <Card label="Not connected" value={t.notConnected ?? '—'} />
              <Card label="Unique numbers" value={t.uniqueNumbers ?? '—'} hint="Each number once, whoever called it" />
              <Card label="Talk time" value={hours(t.talkSeconds)} />
              <Card label="Demos (CRM)" value={`${t.demosCompleted} / ${t.demosScheduled}`} hint="completed / scheduled" />
              {/* (20270304000100) incoming and missed calls are separate from outgoing; an unknown connection is never counted as failed */}
              <Card label="Incoming calls" value={extra.incoming} />
              <Card label="Missed calls" value={extra.missed} />
              <Card label="Avg call duration" value={t.connected ? hours(Math.round(t.talkSeconds / t.connected)) : '—'} hint="Talk time per connected call" />
              <Card label="Follow-ups completed" value={t.followupsCompleted} hint={`${t.followupsScheduled} scheduled`} />
              <Card label="Follow-ups pending" value={Math.max(0, t.followupsScheduled - t.followupsCompleted)} />
              <Card label="Overdue follow-ups" value={t.followupsOverdue} />
            </div>
          ) : null}
          {leads && leads.connectedEmployees ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" aria-label="Lead ownership" data-testid="croc-team-leads">
              <h2 className="text-sm font-bold text-slate-800">Leads assigned now <span className="font-normal text-slate-500 text-xs">(point in time, each lead once; the period above applies to calls only)</span></h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card label="Assigned leads" value={leads.totals.assigned} />
                <Card label="New leads" value={leads.totals.newLeads} />
                <Card label="Contacted" value={leads.totals.contacted} />
                <Card label="Not contacted" value={leads.totals.notContacted} />
                <Card label="Follow-up due" value={leads.totals.followupDue} />
              </div>
              {leads.statuses.length ? (
                <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="Lead status distribution">
                  {leads.statuses.map(s => <li key={`${s.status}-${s.disposition}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{s.status}{s.disposition ? ` (${s.disposition.replace(/_/g, ' ').toLowerCase()})` : ''}: <b>{s.leads}</b></li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
          {data.daily.length ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Calls per day">
              <h2 className="text-sm font-bold text-slate-800 mb-2">Calls per day</h2>
              <div className="flex items-end gap-1 h-24" role="img" aria-label={`Calls made per day, ${data.daily.length} days`}>
                {data.daily.map(d => (
                  <div key={d.day} className="flex-1 flex flex-col items-center justify-end" title={`${d.day}: ${d.made} made, ${d.connected} connected`}>
                    <div className="w-full rounded-t bg-indigo-200" style={{ height: `${(d.made / maxDay) * 100}%` }}>
                      <div className="w-full rounded-t bg-indigo-600" style={{ height: `${d.made ? (d.connected / d.made) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Light: calls made · dark: connected</p>
            </div>
          ) : null}
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="croc-team-table">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>{['Employee', 'Team', 'Total calls', 'Connected', 'Not connected', 'Rate', 'Unique numbers', 'Talk time', 'Demos (CRM)', ''].map(h => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.people.map(p => (
                  <tr key={p.profileId} data-testid="croc-team-row">
                    <td className="px-2.5 py-2 font-semibold text-slate-800 whitespace-nowrap">{p.name}<span className="block text-[11px] font-normal text-slate-500">{p.salesSubRole ? ROLE[p.salesSubRole] ?? p.salesSubRole : HEAD_ROLE[p.role] ?? 'Sales'}</span></td>
                    <td className="px-2.5 py-2 whitespace-nowrap">{p.teamName ?? (HEAD_ROLE[p.role] ? `${HEAD_ROLE[p.role]} (above teams)` : '—')}</td>
                    {p.available && p.calls ? (
                      <>
                        <td className="px-2.5 py-2">{p.calls.made}</td>
                        <td className="px-2.5 py-2">{p.calls.connected}</td>
                        <td className="px-2.5 py-2">{p.calls.notConnected ?? '—'}</td>
                        <td className="px-2.5 py-2">{pct(p.calls.connectRate)}</td>
                        <td className="px-2.5 py-2">{p.calls.uniqueNumbers ?? '—'}</td>
                        <td className="px-2.5 py-2 whitespace-nowrap">{hours(p.calls.talkSeconds)}</td>
                      </>
                    ) : <td colSpan={6} className="px-2.5 py-2 text-slate-500">Not available yet (not synced)</td>}
                    <td className="px-2.5 py-2">{p.demos ? `${p.demos.completed} / ${p.demos.scheduled}` : '—'}</td>
                    <td className="px-2.5 py-2"><button type="button" className="text-indigo-700 font-semibold hover:underline" onClick={() => setOpen({ id: p.profileId, name: p.name })} aria-label={`Open ${p.name}'s activity`}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.teams.length > 1 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs" aria-label="By team">
              <h2 className="text-sm font-bold text-slate-800 mb-1">By team</h2>
              <ul className="space-y-0.5">{data.teams.map(tm => <li key={tm.teamId ?? 'none'}>{tm.teamName ?? noTeamLabel}: {tm.people} connected · {tm.made ?? 0} calls made · {tm.connected ?? 0} connected</li>)}</ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
};

export default CrocodialTeamPanel;

