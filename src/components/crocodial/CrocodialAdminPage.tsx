import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PlugZap, RefreshCw, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import type { CrocodialAdminOverview, CrocodialConnection, CrocodialMappingCheck, CrocodialTestResult, Profile } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi, usersApi } from '../../lib/api/endpoints';
import { btn, Card, ErrorBanner, Field, inputCls, selectCls, Spinner } from '../team-member/pipeline/shared';

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
  NO_CREDENTIAL: ['Token setting missing on the server', 'bg-amber-50 text-amber-800'],
  AUTH_FAILED: ['Token refused by Crocodial', 'bg-rose-50 text-rose-800'],
  DISABLED_AT_SOURCE: ['Token turned off in Crocodial', 'bg-rose-50 text-rose-800'],
  RATE_LIMITED: ['Crocodial rate limit reached', 'bg-amber-50 text-amber-800'],
  ERROR: ['Error', 'bg-rose-50 text-rose-800']
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
    usersApi.list({ departmentId, division: 'SALES', status: 'ACTIVE', pageSize: 200 }).then(r => setPeople(r.items)).catch(e => setError(errText(e)));
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

export const CrocodialAdminPage: React.FC = () => {
  const [data, setData] = useState<CrocodialAdminOverview | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, CrocodialTestResult>>({});
  const load = useCallback(() => { crocodialApi.overview().then(d => { setData(d); setError(''); }).catch(e => setError(errText(e))); }, []);
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
                  onClick={() => { if (!r.allowed || window.confirm(`Pause Crocodial for ${r.departmentName} Sales? Its link is switched off and nobody's data is shown.`)) void run(`ro-${r.departmentId}`, () => crocodialApi.setRollout({ departmentId: r.departmentId, division: 'SALES', allowed: !r.allowed })); }}>
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
                    <p className="text-xs text-slate-500 font-mono">{c.credentialRef} {c.credentialConfigured ? <span className="text-emerald-700">(set on the server)</span> : <span className="text-amber-700">(not set on the server)</span>}</p>
                    <p className="text-xs text-slate-500">Last test / sync: {when(c.lastAttemptAt)} · last success: {when(c.lastSuccessAt)}{c.timezone ? ` · ${c.timezone}` : ''}</p>
                    {c.lastError ? <p className="text-xs text-rose-700">{c.lastError}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={tone}>{hl}</Pill>
                    <Pill tone={c.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}>{c.enabled ? 'On' : 'Off'}</Pill>
                    <button type="button" className={btn.secondary} disabled={busy !== null} data-testid="croc-test"
                      onClick={() => void run(`t-${c.id}`, async () => { const r = await crocodialApi.testConnection(c.id); setTests(x => ({ ...x, [c.id]: r })); })}>
                      {busy === `t-${c.id}` ? 'Testing…' : 'Test connection'}
                    </button>
                    <button type="button" className={btn.secondary} disabled={busy !== null}
                      onClick={() => void run(`e-${c.id}`, () => crocodialApi.saveConnection({ id: c.id, name: c.name, externalAccountLabel: c.externalAccountLabel, credentialRef: c.credentialRef, enabled: !c.enabled }))}>
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
                    </span>
                    <span className="flex gap-2">
                      {m.status === 'PENDING' ? <button type="button" className={btn.green} disabled={busy !== null}
                        onClick={() => { if (window.confirm(`Approve: ${m.profileName} is Crocodial user “${m.externalName}” (id ${m.externalEmployeeId})?`)) void run(`a-${m.id}`, () => crocodialApi.approveMapping(m.id), `${m.profileName} approved.`); }}>Approve</button> : null}
                      <button type="button" className={btn.danger} disabled={busy !== null}
                        onClick={() => { const reason = window.prompt(`End ${m.profileName}'s mapping? Activity before now stays theirs. Reason (optional):`); if (reason !== null) void run(`r-${m.id}`, () => crocodialApi.revokeMapping(m.id, reason), 'Mapping ended.'); }}>
                        {m.status === 'PENDING' ? 'Withdraw' : 'Revoke'}
                      </button>
                    </span>
                  </div>
                ))}
                {links.length ? <MappingForm data={data} connectionId={c.id} departmentId={links[0].departmentId} onSaved={text => { setFlash(text); load(); }} />
                  : <p className="text-xs text-slate-500">Link a department first; people are mapped within it.</p>}
              </div>
            </div>
          );
        })}
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="text-sm font-bold text-slate-900">History</h2>
        {!data.audit.length ? <p className="text-xs text-slate-500">No changes yet.</p> : (
          <ul className="text-xs divide-y divide-slate-100" data-testid="croc-audit">
            {data.audit.map((a, i) => <li key={i} className="py-1.5"><span className="text-slate-500">{when(a.at)}</span> · {a.action.replace(/^CROCODIAL_/, '').replace(/_/g, ' ').toLowerCase()} · {a.actorName ?? 'system'}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default CrocodialAdminPage;
