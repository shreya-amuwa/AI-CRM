import React, { useCallback, useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import type { CrocodialActivity as Activity, CrocodialMyStatus } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi } from '../../lib/api/endpoints';

/**
 * "My Crocodial Activity": a person's calling and follow-up work in Crocodial (read-only, part 3 of docs/CROCODIAL_INTEGRATION.md), on the
 * dashboard they already have. Shown only when the database says this person has an approved mapping (croc_my_status); everything comes
 * from croc_activity, which decides who may see whom. Unavailable is never shown as zero, and old data is labelled as not current.
 *
 * profileId: a manager's view of one of their people (part 4); without it, the signed-in person's own activity.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86_400_000));
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const duration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
const PRESETS: [string, string, number][] = [['today', 'Today', 0], ['7', 'Last 7 days', 6], ['30', 'Last 30 days', 29], ['90', 'Last 90 days', 89]];
const TYPE_LABEL: Record<string, string> = { outgoing: 'Outgoing', incoming: 'Incoming', missed: 'Missed', rejected: 'Rejected', voicemail: 'Voicemail', blocked: 'Blocked', answered_elsewhere: 'Answered elsewhere', unknown: '—' };

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: string }> = ({ label, value, hint, tone = 'text-slate-900' }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 text-xl font-extrabold tabular-nums ${tone}`}>{value}</p>
    {hint ? <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p> : null}
  </div>
);

export const CrocodialActivityPanel: React.FC<{ profileId?: string; title?: string; showDemos?: boolean }> = ({ profileId, title = 'My Crocodial Activity', showDemos }) => {
  const [status, setStatus] = useState<CrocodialMyStatus | null>(profileId ? { enabled: true } : null);
  const [preset, setPreset] = useState('7');
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(daysAgo(0));
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (profileId) return;
    crocodialApi.me().then(setStatus).catch(() => setStatus({ enabled: false }));
  }, [profileId]);
  const load = useCallback(() => {
    if (!status?.enabled) return;
    setLoading(true);
    setError('');
    crocodialApi.activity({ profileId, from, to }).then(setData).catch(e => setError(errText(e))).finally(() => setLoading(false));
  }, [status, profileId, from, to]);
  useEffect(load, [load]);

  if (!status?.enabled) return null;
  if (data && !data.enabled) return null;
  const choose = (id: string, back: number) => { setPreset(id); setFrom(daysAgo(back)); setTo(daysAgo(0)); };
  const demos = showDemos ?? data?.person?.salesSubRole === 'BUSINESS_ASSOCIATE';
  const c = data?.calls;
  const f = data?.followups;

  return (
    <section aria-label={title} className="space-y-3" data-testid="crocodial-activity">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2"><PhoneCall className="w-4 h-4 text-indigo-600" aria-hidden /> {title}</h2>
          <p className="text-xs text-slate-500">Source: Crocodial (read-only){data?.lastSyncAt ? ` · last synced ${when(data.lastSyncAt)}` : ''}{data?.timezone ? ` · ${data.timezone}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period">
          {PRESETS.map(([id, label, back]) => (
            <button key={id} type="button" aria-pressed={preset === id} onClick={() => choose(id, back)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${preset === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
          ))}
          <label className="text-[11px] text-slate-500 flex items-center gap-1">From<input type="date" className="border border-slate-200 rounded-md px-1.5 py-0.5 text-xs" value={from} max={to} onChange={e => { setPreset('custom'); setFrom(e.target.value); }} aria-label="From date" /></label>
          <label className="text-[11px] text-slate-500 flex items-center gap-1">to<input type="date" className="border border-slate-200 rounded-md px-1.5 py-0.5 text-xs" value={to} min={from} onChange={e => { setPreset('custom'); setTo(e.target.value); }} aria-label="To date" /></label>
        </div>
      </div>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{error} <button type="button" className="underline" onClick={load}>Try again</button></p> : null}
      {loading && !data ? <p className="text-xs text-slate-500" role="status">Loading Crocodial activity…</p> : null}
      {data?.enabled && data.available === false ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" role="status" data-testid="croc-unavailable">
          Crocodial data is not available yet: the first sync has not finished. Figures appear here once it has (they are not zero).
        </p>
      ) : null}
      {data?.available && data.stale ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status" data-testid="croc-stale">
          These figures are from {when(data.lastSyncAt)} and may not be current (the last complete sync is more than 24 hours old).
        </p>
      ) : null}

      {data?.available && c && f ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="Calling summary">
            <Stat label="Calls made" value={c.made} hint="Outgoing calls you made" />
            <Stat label="Connected calls" value={c.connected} hint={`Connect rate ${pct(c.connectRate)}`} tone="text-emerald-700" />
            <Stat label="Talk time" value={duration(c.talkSeconds)} hint="Connected outgoing calls" />
            <Stat label="Unique leads contacted" value={c.uniqueLeads} />
            <Stat label="Incoming / missed" value={`${c.incoming} / ${c.missed}`} />
            <Stat label="Follow-ups scheduled" value={f.scheduled} hint={`${f.completed} completed · ${pct(f.completionRate)}`} />
            <Stat label="Overdue follow-ups" value={f.overdue} tone={f.overdue ? 'text-rose-700' : 'text-slate-900'} hint="Not done, past their time" />
            <Stat label="My Crocodial leads" value={data.leads?.assigned ?? '—'} hint={data.leads ? `${data.leads.neverCalled} never called` : undefined} />
          </div>
          {demos && data.demos ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="Demos">
              <Stat label="Demos scheduled" value={data.demos.scheduled} hint="From the CRM demo schedule" />
              <Stat label="Demos completed" value={data.demos.completed} tone="text-emerald-700" />
              <Stat label="Upcoming demos" value={data.demos.upcoming} />
              <Stat label="Cancelled demos" value={data.demos.cancelled} />
            </div>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="text-sm font-bold text-slate-800 mb-2">Recent calls</h3>
              {!data.recentCalls?.length ? <p className="text-xs text-slate-500">No calls in this period.</p> : (
                <ul className="divide-y divide-slate-100 text-xs" data-testid="croc-recent-calls">
                  {data.recentCalls.map((r, i) => (
                    <li key={i} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate"><b>{r.contactName || 'Unknown'}</b>{r.phone ? <span className="text-slate-500"> · {r.phone}</span> : null}</span>
                      <span className="whitespace-nowrap text-slate-600">{TYPE_LABEL[r.type] ?? r.type} · {r.connected ? duration(r.durationSeconds ?? 0) : 'not connected'} · {when(r.callAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="text-sm font-bold text-slate-800 mb-2">Open follow-ups</h3>
              {!data.upcomingFollowups?.length ? <p className="text-xs text-slate-500">No open follow-ups.</p> : (
                <ul className="divide-y divide-slate-100 text-xs">
                  {data.upcomingFollowups.map((u, i) => (
                    <li key={i} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate"><b>{u.leadName || 'Lead'}</b>{u.note ? <span className="text-slate-500"> · {u.note}</span> : null}</span>
                      <span className={`whitespace-nowrap ${u.overdue ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>{u.overdue ? 'Overdue · ' : ''}{when(u.scheduledAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};

export default CrocodialActivityPanel;
