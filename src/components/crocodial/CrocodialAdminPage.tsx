import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CrocodialConnectionHealth } from './CrocodialConnectionHealth';
import { CrocodialLeadPipeline } from './CrocodialLeadPipeline';
import { CheckCircle2, PlugZap, RefreshCw, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import type { CrocodialAdminOverview, CrocodialConnection, CrocodialMapping, CrocodialMappingCheck, CrocodialSyncStatus, CrocodialTestResult, Profile } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi, usersApi } from '../../lib/api/endpoints';
import { btn, Card, ErrorBanner, Field, inputCls, selectCls, Spinner } from '../team-member/pipeline/shared';
import { confirmAction, promptInput } from '../feedback/AppFeedback';

/**
 * Super Admin > Crocodial Integration. The read-only connector to Crocodial (a calling CRM), switched on step by step:
 *   1. Rollout: which department + function may use it (M Pillar Sales only, until the Super Admin allows another).
 *   2. Connection: one Crocodial account; its token is a SERVER setting (CROCODIAL_TOKEN_...) - the CRM only stores the setting's name.
 *   3. Department link: the connection serves that department's Sales (off until switched on).
 *   4. People: each Crocodial user is mapped to ONE CRM employee and approved here. Switching a department on switches nobody on.
 * Every rule is enforced by the database; this page only shows and asks.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const HEALTH: Record<string, [string, string]> = {
  UNKNOWN: ['Not tested yet', 'bg-slate-100 text-slate-700'],
  OK: ['Connected', 'bg-emerald-50 text-emerald-800'],
  NO_CREDENTIAL: ['Token missing (at the last check)', 'bg-amber-50 text-amber-800'],
  AUTH_FAILED: ['Token refused by Crocodial', 'bg-rose-50 text-rose-800'],
  DISABLED_AT_SOURCE: ['Token turned off in Crocodial', 'bg-rose-50 text-rose-800'],
  RATE_LIMITED: ['Crocodial rate limit reached', 'bg-amber-50 text-amber-800'],
  ERROR: ['Error', 'bg-rose-50 text-rose-800'],
  KEY_UNREADABLE: ['Key needs to be entered again', 'bg-amber-50 text-amber-800']
};
const Pill: React.FC<{ tone: string; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${tone}`}>{children}</span>
);

const ConnectionForm: React.FC<{ initial?: CrocodialConnection; onSaved: () => void; onCancel?: () => void }> = ({ initial, onSaved, onCancel }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [label, setLabel] = useState(initial?.externalAccountLabel ?? '');
  const [ref, setRef] = useState(initial?.credentialRef ?? 'CROCODIAL_TOKEN_');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await crocodialApi.saveConnection({ id: initial?.id, name, externalAccountLabel: label || null, credentialRef: ref, enabled: initial?.enabled });
      onSaved();
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="grid gap-3 md:grid-cols-3" data-testid="croc-connection-form">
      <Field label="Connection name" htmlFor="croc-name" required><input id="croc-name" className={inputCls} value={name} onChange={e => setName(e.target.value)} maxLength={120} /></Field>
      <Field label="Crocodial account (as named in Crocodial)" htmlFor="croc-label"><input id="croc-label" className={inputCls} value={label} onChange={e => setLabel(e.target.value)} maxLength={200} /></Field>
      <Field label="Server setting that holds the token" htmlFor="croc-ref" required>
        <input id="croc-ref" className={`${inputCls} font-mono`} value={ref} onChange={e => setRef(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} maxLength={56} autoComplete="off" spellCheck={false} />
      </Field>
      <p className="md:col-span-3 text-[11px] text-slate-500">
        Never type the token here. Create it in Crocodial (Setup → Outbound API, with “Allow changes” off) and add it to the server’s environment
        under this name; the CRM only stores the name.
      </p>
      {error ? <p className="md:col-span-3 text-xs text-rose-700" role="alert">{error}</p> : null}
      <div className="md:col-span-3 flex gap-2">
        <button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Saving…' : initial ? 'Save connection' : 'Add connection'}</button>
        {onCancel ? <button type="button" className={btn.secondary} onClick={onCancel}>Cancel</button> : null}
      </div>
    </form>
  );
};

const MappingForm: React.FC<{ data: CrocodialAdminOverview; connectionId: string; departmentId: string; onSaved: (text: string) => void }> = ({ data, connectionId, departmentId, onSaved }) => {
  const [people, setPeople] = useState<Profile[]>([]);
  const [ext, setExt] = useState('');
  const [profile, setProfile] = useState('');
  const [check, setCheck] = useState<CrocodialMappingCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    // every active person of the department (heads have no team, so no Sales-team filter here: the check below says who can be mapped),
    // 100 at a time - the most the API returns per page
    let alive = true;
    (async () => {
      const all: Profile[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await usersApi.list({ departmentId, status: 'ACTIVE', page, pageSize: 100 });
        all.push(...r.items);
        if (all.length >= r.total || r.items.length < 100) break;
      }
      if (alive) setPeople(all.sort((a, b) => a.fullName.localeCompare(b.fullName)));
    })().catch(e => alive && setError(errText(e)));
    return () => { alive = false; };
  }, [departmentId]);
  const unmapped = data.externalEmployees.filter(e => e.connectionId === connectionId && !e.mappingStatus && !e.missingSince);
  useEffect(() => {
    setCheck(null);
    if (!ext || !profile) return;
    crocodialApi.checkMapping({ connectionId, externalEmployeeId: Number(ext), profileId: profile, departmentId }).then(setCheck).catch(e => setError(errText(e)));
  }, [ext, profile, connectionId, departmentId]);
  const propose = async () => {
    setBusy(true);
    setError('');
    try {
      await crocodialApi.createMapping({ connectionId, externalEmployeeId: Number(ext), profileId: profile, departmentId });
      setExt(''); setProfile('');
      onSaved('Mapping proposed. Check it and approve it below.');
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const p = check?.profile;
  return (
    <div className="space-y-3" data-testid="croc-mapping-form">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Crocodial user" htmlFor="croc-ext">
          <select id="croc-ext" className={selectCls} value={ext} onChange={e => setExt(e.target.value)}>
            <option value="">Choose a Crocodial user…</option>
            {unmapped.map(e => <option key={e.externalId} value={e.externalId}>{e.name || 'No name'} · Crocodial id {e.externalId}{e.isActive === false ? ' · inactive' : ''}</option>)}
          </select>
        </Field>
        <Field label="CRM employee (M Pillar Sales)" htmlFor="croc-profile">
          <select id="croc-profile" className={selectCls} value={profile} onChange={e => setProfile(e.target.value)}>
            <option value="">Choose the CRM employee…</option>
            {people.map(x => <option key={x.id} value={x.id}>{x.fullName}{x.email ? ` · ${x.email}` : ''}</option>)}
          </select>
        </Field>
      </div>
      {!unmapped.length ? <p className="text-xs text-slate-500">No unmapped Crocodial users. Test the connection to refresh the account’s user list.</p> : null}
      {p ? (
        <div className={`rounded-xl border p-3 text-xs ${p.eligible && !check?.externalAlreadyMapped && !check?.profileAlreadyMapped ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60'}`} data-testid="croc-mapping-check">
          <p className="font-semibold text-slate-800">Check before proposing</p>
          <ul className="mt-1 space-y-0.5 text-slate-700">
            <li>CRM employee: <b>{p.name}</b> · {p.role}{p.salesSubRole ? ` · ${p.salesSubRole}` : ''} · {p.departmentName ?? 'no department'} · {p.teamName ?? 'no team'} ({p.teamDivision ?? '—'})</li>
            <li>Crocodial user: <b>{check?.externalEmployee?.name || '—'}</b> (id {check?.externalEmployee?.externalId})</li>
            <li>{p.active ? '✓ Active' : '✗ Not active'} · {p.inDepartment ? '✓ In this department' : '✗ Not in this department'} · {p.inFunction ? '✓ Sales' : '✗ Not Sales'}</li>
            {check?.externalAlreadyMapped ? <li>✗ This Crocodial user is already mapped.</li> : null}
            {check?.profileAlreadyMapped ? <li>✗ This employee already has a mapping on this connection.</li> : null}
          </ul>
          <p className="mt-1 text-slate-500">Names are not proof of identity: confirm in Crocodial that this user is this person before approving.</p>
        </div>
      ) : null}
      {error ? <p className="text-xs text-rose-700" role="alert">{error}</p> : null}
      <button type="button" className={btn.primary} disabled={busy || !p?.eligible || !!check?.externalAlreadyMapped || !!check?.profileAlreadyMapped} onClick={propose}>
        <UserCheck className="w-3.5 h-3.5" aria-hidden /> Propose mapping
      </button>
    </div>
  );
};

const RESOURCE_LABEL: Record<string, string> = { leads: 'Leads', 'call-logs': 'Call logs', followups: 'Follow-ups', remarks: 'Remarks' };
/** 5. Sync: what was read, when, what is waiting to be mapped. Old data is labelled stale, never shown as current. */
const SyncPanel: React.FC<{ status: CrocodialSyncStatus | undefined; busy: boolean; onSync: () => void }> = ({ status, busy, onSync }) => {
  if (!status) return null;
  const lastOk = status.resources.map(r => r.lastOkAt).filter(Boolean).sort()[0] ?? null;
  const stale = !lastOk || Date.now() - new Date(lastOk).getTime() > 24 * 3600_000;
  return (
    <div className="space-y-2" data-testid="croc-sync">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">5. Sync (read-only)</p>
        <button type="button" className={btn.secondary} disabled={busy || !status.syncable} onClick={onSync} title={status.syncable ? undefined : 'Switch the connection and its department on first'}>
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden /> {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {!status.syncable ? <p className="text-xs text-slate-500">Not synced: the connection or its department is switched off. Crocodial is not contacted.</p> : null}
      {status.resources.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase text-slate-500"><tr><th className="py-1 pr-3">Data</th><th className="py-1 pr-3">Last complete read</th><th className="py-1 pr-3">Rows</th><th className="py-1">State</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {status.resources.map(r => (
                <tr key={r.resource}>
                  <td className="py-1.5 pr-3 font-semibold">{RESOURCE_LABEL[r.resource] ?? r.resource}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{when(r.lastOkAt)}</td>
                  <td className="py-1.5 pr-3">{r.rowsLastRun ?? '—'}{r.skippedLastRun ? <span className="text-amber-700"> · {r.skippedLastRun} unreadable</span> : null}</td>
                  <td className="py-1.5">{r.lastError ? <span className="text-rose-700">{r.lastError}</span> : r.running ? 'Running' : r.inProgress ? 'First read in progress (continues on the next run)' : 'Up to date'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-xs text-slate-500">Not synced yet.</p>}
      <p className="text-xs text-slate-600">
        Stored: {status.counts.leads} leads · {status.counts.calls} calls · {status.counts.followups} follow-ups · {status.counts.remarks} remarks
        {status.counts.missing ? ` · ${status.counts.missing} no longer in Crocodial (kept, marked missing)` : ''}
      </p>
      {lastOk && stale ? <p className="text-xs text-amber-800" role="status">The last complete read is more than 24 hours old: the activity shown is not current.</p> : null}
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="croc-unmatched">
        <p><b>Not attributed to anyone</b> (no approved mapping): {status.unmatched.calls} calls · {status.unmatched.followups} follow-ups · {status.unmatched.leads} leads.
          These are kept and never counted for any employee.</p>
        {status.unmatchedByUser.length ? (
          <ul className="mt-1 list-disc pl-4">
            {status.unmatchedByUser.slice(0, 10).map(u => <li key={u.externalId}>Crocodial user {u.name ? `“${u.name}” ` : ''}(id {u.externalId}{u.name ? '' : ', not in the account’s user list'}): {u.calls} calls</li>)}
          </ul>
        ) : null}
      </div>
    </div>
  );
};

/**
 * When an approved mapping starts counting activity. Approval counts from that moment; the Super Admin may move the start back to the first
 * activity stored for that Crocodial user, or to a chosen day, so earlier calls, follow-ups and remarks count for the person. The database
 * refuses a date that overlaps another mapping of the same Crocodial user or person, and audits every change.
 */
const CountFrom: React.FC<{ mapping: CrocodialMapping; disabled: boolean; onSet: (from: string | null) => void }> = ({ mapping, disabled, onSet }) => {
  const [day, setDay] = useState('');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600" data-testid="croc-count-from">
      <span>Counting activity from <b>{mapping.effectiveFrom ? new Date(mapping.effectiveFrom).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—'}</b>.</span>
      <button type="button" className="font-semibold text-indigo-700 hover:underline disabled:opacity-50" disabled={disabled}
        onClick={async () => { if (await confirmAction({
          title: `Count all past activity for ${mapping.profileName}?`,
          description: `All stored activity of Crocodial user “${mapping.externalName}” (from their first record) is counted as ${mapping.profileName}'s. Only do this if nobody else used this Crocodial login.`,
          confirmLabel: 'Count all past activity'
        })) onSet(null); }}>
        Count all past activity
      </button>
      <span aria-hidden>·</span>
      <label className="flex items-center gap-1">or from
        <input type="date" className="border border-slate-200 rounded-md px-1.5 py-0.5 text-xs" value={day} max={today} onChange={e => setDay(e.target.value)} aria-label={`Count ${mapping.profileName}'s activity from`} />
      </label>
      <button type="button" className="font-semibold text-indigo-700 hover:underline disabled:opacity-50" disabled={disabled || !day}
        onClick={async () => { if (await confirmAction({ title: `Count ${mapping.profileName}'s activity from ${day}?`, description: 'Crocodial activity from the start of that day is counted as theirs.', confirmLabel: 'Use this date' })) onSet(day); }}>
        Use this date
      </button>
    </span>
  );
};

export const CrocodialAdminPage: React.FC = () => {
  const [data, setData] = useState<CrocodialAdminOverview | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, CrocodialTestResult>>({});
  const [sync, setSync] = useState<CrocodialSyncStatus[]>([]);
  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => {
    crocodialApi.overview().then(d => { setData(d); setError(''); }).catch(e => setError(errText(e)));
    crocodialApi.syncStatus().then(setSync).catch(() => setSync([]));
    setReloads(n => n + 1);
  }, []);
  useEffect(load, [load]);
  const run = async (key: string, fn: () => Promise<unknown>, text?: string) => {
    setBusy(key);
    setFlash('');
    try {
      await fn();
      if (text) setFlash(text);
      load();
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const allowed = useMemo(() => (data?.rollout ?? []).filter(r => r.allowed), [data]);

  if (error && !data) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-5" data-testid="crocodial-admin">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Crocodial Integration</h1>
          <p className="text-sm text-slate-500 mt-0.5">Read-only calling activity from Crocodial. Pilot: M Pillar Sales, only the employees you approve here.</p>
        </div>
        <button type="button" className={btn.secondary} onClick={load}><RefreshCw className="w-3.5 h-3.5" aria-hidden /> Refresh</button>
      </div>
      {flash ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status">{flash}</p> : null}
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}

      <CrocodialConnectionHealth reloadKey={reloads} />

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4" aria-hidden /> 1. Rollout</h2>
        <p className="text-xs text-slate-500">Only these departments may use Crocodial. Every other department is <b>not configured</b> and is never contacted.</p>
        <ul className="divide-y divide-slate-100 text-sm" data-testid="croc-rollout">
          {data.rollout.map(r => (
            <li key={`${r.departmentId}-${r.division}`} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span>{r.departmentName} · Sales {r.note ? <span className="text-xs text-slate-500">({r.note})</span> : null}</span>
              <span className="flex items-center gap-2">
                <Pill tone={r.allowed ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}>{r.allowed ? 'Allowed' : 'Paused'}</Pill>
                <button type="button" className={r.allowed ? btn.danger : btn.secondary} disabled={busy !== null}
                  onClick={async () => { if (!r.allowed || await confirmAction({ title: `Pause Crocodial for ${r.departmentName} Sales?`, description: "Its link is switched off and nobody's Crocodial data is shown or synced. Nothing is deleted; you can allow it again.", confirmLabel: 'Pause Crocodial', cancelLabel: 'Keep running', variant: 'destructive' })) void run(`ro-${r.departmentId}`, () => crocodialApi.setRollout({ departmentId: r.departmentId, division: 'SALES', allowed: !r.allowed })); }}>
                  {r.allowed ? 'Pause' : 'Allow again'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><PlugZap className="w-4 h-4" aria-hidden /> 2. Connections</h2>
          {!adding ? <button type="button" className={btn.secondary} onClick={() => setAdding(true)}>Add connection</button> : null}
        </div>
        {adding ? <ConnectionForm onSaved={() => { setAdding(false); setFlash('Connection added (switched off). Test it next.'); load(); }} onCancel={() => setAdding(false)} /> : null}
        {!data.connections.length && !adding ? <p className="text-xs text-slate-500">No connection yet.</p> : null}
        {data.connections.map(c => {
          const [hl, tone] = HEALTH[c.health] ?? HEALTH.ERROR;
          const t = tests[c.id];
          const links = data.departmentLinks.filter(l => l.connectionId === c.id);
          return (
            <div key={c.id} className="rounded-xl border border-slate-200 p-3 space-y-3" data-testid="croc-connection">
              {editing === c.id ? <ConnectionForm initial={c} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} /> : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-semibold text-slate-900">{c.name} {c.externalAccountLabel ? <span className="text-slate-500 font-normal">· {c.externalAccountLabel}</span> : null}</p>
                    <p className="text-xs text-slate-500 font-mono">{c.credentialRef} {c.credentialConfigured ? <span className="text-emerald-700">(set on this server)</span> : <span className="text-amber-700">(not set on this server: see Connection health)</span>}</p>
                    <p className="text-xs text-slate-500">Last test / sync: {when(c.lastAttemptAt)} · last success: {when(c.lastSuccessAt)}{c.timezone ? ` · ${c.timezone}` : ''}</p>
                    {c.lastError ? <p className="text-xs text-rose-700">{c.health === 'NO_CREDENTIAL' && c.credentialConfigured ? `Recorded ${when(c.lastAttemptAt)} (this server has the token now; Test connection clears it): ` : ''}{c.lastError}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={tone}>{hl}</Pill>
                    <Pill tone={c.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}>{c.enabled ? 'On' : 'Off'}</Pill>
                    <button type="button" className={btn.secondary} disabled={busy !== null} data-testid="croc-test"
                      onClick={() => void run(`t-${c.id}`, async () => { const r = await crocodialApi.testConnection(c.id); setTests(x => ({ ...x, [c.id]: r })); })}>
                      {busy === `t-${c.id}` ? 'Testing…' : 'Test connection'}
                    </button>
                    <button type="button" className={btn.secondary} disabled={busy !== null}
                      onClick={() => void run(`e-${c.id}`, () => crocodialApi.saveConnection({ id: c.id, name: c.name, externalAccountLabel: c.externalAccountLabel, credentialRef: c.credentialRef ?? undefined, enabled: !c.enabled }))}>
                      {c.enabled ? 'Switch off' : 'Switch on'}
                    </button>
                    <button type="button" className={btn.secondary} onClick={() => setEditing(c.id)}>Edit</button>
                  </div>
                </div>
              )}
              {t ? <p className={`text-xs ${t.ok ? 'text-emerald-800' : 'text-rose-700'}`} role="status" data-testid="croc-test-result">{t.ok ? <CheckCircle2 className="inline w-3.5 h-3.5" aria-hidden /> : <XCircle className="inline w-3.5 h-3.5" aria-hidden />} {t.message}</p> : null}

              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700">3. Departments this connection serves</p>
                {allowed.map(r => {
                  const l = links.find(x => x.departmentId === r.departmentId);
                  return (
                    <div key={r.departmentId} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="croc-link">
                      <span>{r.departmentName} · Sales {l ? <Pill tone={l.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}>{l.enabled ? `On · ${l.stage === 'PILOT' ? 'pilot' : 'production'}` : 'Linked, off'}</Pill> : <Pill tone="bg-slate-100 text-slate-700">Not linked</Pill>}</span>
                      <button type="button" className={btn.secondary} disabled={busy !== null}
                        onClick={() => void run(`l-${c.id}-${r.departmentId}`, () => crocodialApi.saveDepartmentLink({ connectionId: c.id, departmentId: r.departmentId, division: 'SALES', enabled: l ? !l.enabled : false, stage: l?.stage ?? 'PILOT' }))}>
                        {!l ? 'Link (stays off)' : l.enabled ? 'Switch off' : 'Switch on'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700">4. People</p>
                {data.mappings.filter(m => m.connectionId === c.id && m.status !== 'REVOKED').map(m => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm rounded-lg bg-slate-50 px-3 py-2" data-testid="croc-mapping">
                    <span>
                      <b>{m.profileName}</b> ↔ Crocodial “{m.externalName || '—'}” (id {m.externalEmployeeId}) · {m.departmentName} Sales
                      {m.roleSnapshot.salesSubRole ? ` · ${m.roleSnapshot.salesSubRole}` : ''}
                      <span className="block text-xs text-slate-500">{m.status === 'APPROVED' ? `Approved by ${m.approvedByName ?? '—'} on ${when(m.approvedAt)} · ${m.live ? 'in effect' : 'not in effect (connection or department off)'}` : 'Waiting for approval'}</span>
                      {m.status === 'APPROVED' ? (
                        <CountFrom mapping={m} disabled={busy !== null}
                          onSet={from => void run(`f-${m.id}`, () => crocodialApi.countMappingFrom(m.id, from),
                            from ? `${m.profileName}'s activity now counts from ${from}.` : `${m.profileName}'s past activity now counts.`)} />
                      ) : null}
                    </span>
                    <span className="flex gap-2">
                      {m.status === 'PENDING' ? <button type="button" className={btn.green} disabled={busy !== null}
                        onClick={async () => { if (await confirmAction({ title: `Approve this Crocodial mapping?`, description: `${m.profileName}'s Crocodial activity will come from this Crocodial user. Confirm in Crocodial that it really is them.`, details: [`CRM employee: ${m.profileName}`, `Crocodial user: ${m.externalName} (id ${m.externalEmployeeId})`], confirmLabel: 'Approve mapping' })) void run(`a-${m.id}`, () => crocodialApi.approveMapping(m.id), `${m.profileName} approved.`); }}>Approve</button> : null}
                      <button type="button" className={btn.danger} disabled={busy !== null}
                        onClick={async () => { const reason = await promptInput({ title: m.status === 'PENDING' ? `Withdraw ${m.profileName}'s proposed mapping?` : `End ${m.profileName}'s Crocodial mapping?`, description: 'Activity before now stays theirs. Nothing new is counted for them after this.', label: 'Reason', multiline: true, maxLength: 500, confirmLabel: m.status === 'PENDING' ? 'Withdraw mapping' : 'End mapping', cancelLabel: 'Keep mapping', variant: 'destructive' }); if (reason !== null) void run(`r-${m.id}`, () => crocodialApi.revokeMapping(m.id, reason), 'Mapping ended.'); }}>
                        {m.status === 'PENDING' ? 'Withdraw' : 'Revoke'}
                      </button>
                    </span>
                  </div>
                ))}
                {links.length ? <MappingForm data={data} connectionId={c.id} departmentId={links[0].departmentId} onSaved={text => { setFlash(text); load(); }} />
                  : <p className="text-xs text-slate-500">Link a department first; people are mapped within it.</p>}
              </div>

              <SyncPanel status={sync.find(s => s.connectionId === c.id)} busy={busy === `s-${c.id}`}
                onSync={() => void run(`s-${c.id}`, async () => {
                  const r = await crocodialApi.syncNow(c.id);
                  const rs = r.connections[0]?.resources ?? [];
                  setFlash(rs.length ? `Sync: ${rs.map(x => `${RESOURCE_LABEL[x.resource]} ${x.outcome === 'DONE' ? `${x.rows} rows` : x.outcome === 'PARTIAL' ? 'continues on the next run' : x.outcome.toLowerCase()}`).join(' · ')}.` : (r.connections[0]?.error ?? r.note ?? 'Nothing to sync.'));
                })} />
              <CrocodialLeadPipeline connectionId={c.id} />
            </div>
          );
        })}
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="text-sm font-bold text-slate-900">History</h2>
        {!data.audit.length ? <p className="text-xs text-slate-500">No changes yet.</p> : (
          <ul className="text-xs divide-y divide-slate-100" data-testid="croc-audit">
            {data.audit.map((a, i) => <li key={i} className="py-1.5"><span className="text-slate-500">{when(a.at)}</span> · {a.action === 'CROCODIAL_MAPPING_COUNT_FROM_SET' ? 'activity start date changed' : a.action.replace(/^CROCODIAL_/, '').replace(/_/g, ' ').toLowerCase()} · {a.actorName ?? 'system'}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default CrocodialAdminPage;
