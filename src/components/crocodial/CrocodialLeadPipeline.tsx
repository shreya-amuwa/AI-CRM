import React, { useCallback, useEffect, useState } from 'react';
import { GitMerge, RefreshCw } from 'lucide-react';
import type { CrocodialLeadLink, CrocodialLeadLinkList, CrocodialLinkStatus, CrocodialReconcileOverview } from '../../../shared/contracts';
import { CROCODIAL_DISPOSITIONS } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { crocodialApi } from '../../lib/api/endpoints';
import { confirmAction } from '../feedback/AppFeedback';
import { btn, ErrorBanner, selectCls, Spinner } from '../team-member/pipeline/shared';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

/** What each held state means, in plain words, and what the Super Admin can do about it. */
const STATUS: Record<CrocodialLinkStatus, string> = {
  LINKED: 'Linked to a CRM lead',
  PENDING_CREATE: 'Preview: would create a lead',
  PENDING_LINK: 'Preview: would link to an existing lead',
  UNMAPPED_ASSIGNEE: 'Assignee has no approved mapping',
  OUT_OF_SCOPE: 'Mapped person not in the department’s Sales',
  NOT_ENABLED: 'Import off for the department',
  AMBIGUOUS: 'Several possible CRM matches',
  OWNER_CONFLICT: 'Existing lead has another owner',
  PROTECTED: 'Existing record past the lead stage',
  IGNORED: 'Ignored',
  FAILED: 'Failed'
};
const HELD: CrocodialLinkStatus[] = ['UNMAPPED_ASSIGNEE', 'AMBIGUOUS', 'OWNER_CONFLICT', 'OUT_OF_SCOPE', 'FAILED', 'PENDING_CREATE', 'PENDING_LINK', 'PROTECTED', 'IGNORED', 'LINKED'];
const DISPOSITION_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', FOLLOW_UP: 'Follow-up', INTERESTED: 'Interested', DEMO_SCHEDULED: 'Demo scheduled (no demo record is created)',
  NOT_INTERESTED: 'Not interested', LOST: 'Lost (lifecycle unchanged)', CONVERTED: 'Converted (never skips Accounts verification)', IGNORE: 'Ignore (no CRM status)'
};

/**
 * Super Admin > Crocodial Integration > a connection > "Leads in the CRM" (20270304000100): the import switch per department (Off -> Preview ->
 * Import), the status mapping, the reconciliation monitor (unmapped assignees, duplicates, conflicts, unknown statuses, failures, last runs)
 * and the held leads with their resolution actions. Every rule is enforced by the database; this page only shows and asks.
 */
export const CrocodialLeadPipeline: React.FC<{ connectionId: string }> = ({ connectionId }) => {
  const [open, setOpen] = useState(false);
  const [o, setO] = useState<CrocodialReconcileOverview | null>(null);
  const [list, setList] = useState<CrocodialLeadLinkList | null>(null);
  const [status, setStatus] = useState<CrocodialLinkStatus>('UNMAPPED_ASSIGNEE');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    crocodialApi.reconcileOverview(connectionId).then(setO, e => setError(errText(e)));
    crocodialApi.leadLinks(connectionId, { status, pageSize: 25 }).then(setList, e => setError(errText(e)));
  }, [connectionId, status]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(key); setError('');
    try { await fn(); if (done) setFlash(done); load(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const setMode = async (departmentId: string, name: string, mode: 'OFF' | 'PREVIEW' | 'IMPORT') => {
    if (mode === 'IMPORT' && !(await confirmAction({
      title: `Import Crocodial leads into ${name}'s CRM pipeline?`,
      description: 'Leads assigned in Crocodial to approved, mapped people become CRM leads (no welcome messages are sent). Check the Preview first. Existing customers are never changed, and nothing is deleted.',
      details: [`${o?.counts.PENDING_CREATE ?? 0} would be created`, `${o?.counts.PENDING_LINK ?? 0} would be linked to an existing lead`, `${(o?.counts.AMBIGUOUS ?? 0) + (o?.counts.OWNER_CONFLICT ?? 0)} need a decision`],
      confirmLabel: 'Start importing'
    }))) return;
    await act(`m-${departmentId}`, () => crocodialApi.setLeadImport(connectionId, departmentId, mode), `Lead import for ${name}: ${mode.toLowerCase()}.`);
  };
  const resolve = (l: CrocodialLeadLink, action: 'LINK' | 'IGNORE' | 'RETRY' | 'RELEASE_OVERRIDE', customerId?: string) =>
    act(`r-${l.id}`, () => crocodialApi.resolveLeadLink(l.id, action, customerId), action === 'LINK' ? 'Linked.' : action === 'IGNORE' ? 'Ignored.' : action === 'RETRY' ? 'It is looked at again on the next run.' : 'Crocodial’s assignee applies again.');

  return (
    <div className="rounded-lg border border-slate-200" data-testid="croc-lead-pipeline">
      <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-sm font-bold text-slate-800" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="flex items-center gap-2"><GitMerge className="w-4 h-4" aria-hidden /> Leads in the CRM pipeline</span>
        <span className="text-xs font-normal text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="p-3 pt-0 space-y-3 text-sm">
          {error ? <ErrorBanner message={error} /> : null}
          {flash ? <p className="text-xs text-emerald-800" role="status">{flash}</p> : null}
          {!o ? <Spinner /> : (
            <>
              <div>
                <p className="text-xs font-bold text-slate-700 mb-1">Import per department</p>
                <p className="text-xs text-slate-500 mb-2">Off: nothing is linked. Preview: shows what would happen, changes no CRM record. Import: creates and updates leads. Start with Preview.</p>
                {o.departments.length === 0 ? <p className="text-xs text-slate-500">No Sales department is linked to this connection.</p> : o.departments.map(d => (
                  <label key={d.departmentId} className="flex items-center justify-between gap-2 py-1">
                    <span>{d.name}{d.enabled ? '' : ' (link off)'}</span>
                    <select className={`${selectCls} max-w-[10rem]`} value={d.leadImport} disabled={busy !== null} aria-label={`Lead import for ${d.name}`}
                      onChange={e => void setMode(d.departmentId, d.name, e.target.value as 'OFF' | 'PREVIEW' | 'IMPORT')}>
                      <option value="OFF">Off</option><option value="PREVIEW">Preview</option><option value="IMPORT">Import</option>
                    </select>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Reconciliation">
                {[['Crocodial leads', o.externalLeads], ['Linked', o.counts.LINKED ?? 0], ['Need a decision', (o.counts.AMBIGUOUS ?? 0) + (o.counts.OWNER_CONFLICT ?? 0)],
                  ['Unmapped assignee', o.counts.UNMAPPED_ASSIGNEE ?? 0], ['Would create', o.counts.PENDING_CREATE ?? 0], ['Protected', o.counts.PROTECTED ?? 0],
                  ['Ownership differs', o.ownershipDiffers], ['Failed', o.counts.FAILED ?? 0]].map(([label, n]) => (
                  <div key={label as string} className="rounded-lg bg-slate-50 px-2 py-1.5"><p className="text-[11px] text-slate-500">{label}</p><p className="font-bold tabular-nums">{n}</p></div>
                ))}
              </div>
              <p className="text-xs text-slate-600">
                Last reconciliation {when(o.reconcile?.last_run_at)}{o.reconcile ? ` · ${o.reconcile.processed_last_run} looked at, ${o.reconcile.created_last_run} created, ${o.reconcile.updated_last_run} updated, ${o.reconcile.pending} waiting` : ''}
                {o.reconcile?.duration_ms_last_run != null ? ` · ${(o.reconcile.duration_ms_last_run / 1000).toFixed(1)} s` : ''}{o.reconcile?.last_error ? ` · ${o.reconcile.last_error}` : ''}
                {o.missingAtSource ? ` · ${o.missingAtSource} no longer returned by Crocodial (kept, nothing deleted)` : ''}
              </p>
              <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => void act('rec', async () => {
                const r = await crocodialApi.reconcileNow(connectionId);
                setFlash(r.enabled ? `Reconciled ${r.processed}: ${r.created} created, ${r.updated} updated, ${r.held} held, ${r.failed} failed. ${r.pending} still waiting.` : 'Lead import is off for every department of this connection.');
              }, '')}>
                <RefreshCw className={`w-3.5 h-3.5 ${busy === 'rec' ? 'animate-spin' : ''}`} aria-hidden /> Reconcile now
              </button>

              <details>
                <summary className="cursor-pointer text-xs font-bold text-slate-700">Status mapping ({o.mappings.length} mapped, {o.unknownStatuses.length} unknown)</summary>
                <p className="text-xs text-slate-500 my-1">Crocodial statuses differ per account. Map each one to a CRM disposition; an unmapped status is kept as it is and changes nothing in the CRM.</p>
                <ul className="space-y-1">
                  {[...o.unknownStatuses.map(u => ({ status: u.status, disposition: '', leads: u.leads })), ...o.mappings.map(m => ({ ...m, leads: null as number | null }))].map(m => (
                    <li key={m.status} className="flex items-center justify-between gap-2">
                      <span className="text-xs break-all">“{m.status}”{m.leads != null ? <span className="text-amber-700"> · unknown · {m.leads} leads</span> : null}</span>
                      <select className={`${selectCls} max-w-[13rem]`} value={m.disposition ?? ''} disabled={busy !== null} aria-label={`CRM disposition for ${m.status}`}
                        onChange={e => void act(`s-${m.status}`, () => crocodialApi.setStatusMapping(connectionId, m.status, e.target.value || null), `“${m.status}” mapped.`)}>
                        <option value="">Not mapped</option>
                        {CROCODIAL_DISPOSITIONS.map(d => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              </details>

              {o.unmappedAssignees.length ? (
                <details>
                  <summary className="cursor-pointer text-xs font-bold text-slate-700">Crocodial users with leads but no approved mapping ({o.unmappedAssignees.length})</summary>
                  <ul className="text-xs mt-1 space-y-0.5">{o.unmappedAssignees.map(u => <li key={u.externalId}>{u.name ?? 'Unknown'} (id {u.externalId}) · {u.leads} leads — map and approve them under People above.</li>)}</ul>
                </details>
              ) : null}

              <details>
                <summary className="cursor-pointer text-xs font-bold text-slate-700">Sync and rate limits</summary>
                <ul className="text-xs mt-1 space-y-0.5">
                  {o.resources.map(r => <li key={r.resource}>{r.resource}: last complete read {when(r.lastOkAt)}{r.inProgress ? ' · read in progress' : ''}{r.lastError ? ` · ${r.lastError}` : ''}</li>)}
                  {o.recentRuns.filter(r => r.rateLimited).length ? <li className="text-amber-700">{o.recentRuns.filter(r => r.rateLimited).length} of the last {o.recentRuns.length} runs were slowed by Crocodial’s rate limit.</li> : null}
                </ul>
              </details>

              <div>
                <label className="text-xs font-bold text-slate-700 flex items-center gap-2">Leads
                  <select className={`${selectCls} max-w-[16rem]`} value={status} onChange={e => setStatus(e.target.value as CrocodialLinkStatus)}>
                    {HELD.map(s => <option key={s} value={s}>{STATUS[s]} ({o.counts[s] ?? 0})</option>)}
                  </select>
                </label>
                {!list ? <Spinner /> : list.items.length === 0 ? <p className="text-xs text-slate-500 mt-1">Nothing here.</p> : (
                  <ul className="mt-1 divide-y divide-slate-100" data-testid="croc-lead-links">
                    {list.items.map(l => (
                      <li key={l.id} className="py-2 space-y-1">
                        <p className="text-xs"><b>{l.name || l.company || `Lead ${l.externalLeadId}`}</b>{l.phone ? ` · ${l.phone}` : ''} · Crocodial #{l.externalLeadId}{l.department ? ` · ${l.department}` : ''}</p>
                        <p className="text-[11px] text-slate-600">Crocodial owner: {l.externalOwner ?? '-'}{l.mappedOwner ? ` (${l.mappedOwner})` : ''} · CRM owner: {l.crmOwner ?? '-'} · status “{l.externalStatus ?? '-'}”{l.reason ? ` · ${l.reason}` : ''}</p>
                        {l.candidates.length ? <ul className="text-[11px] text-slate-600 pl-3">{l.candidates.map(c => (
                          <li key={c.id} className="flex flex-wrap items-center gap-2">{c.name} · {c.lifecycle.toLowerCase()} · {c.owner ?? '-'}
                            {l.status !== 'LINKED' && l.status !== 'PROTECTED' ? <button type="button" className="text-indigo-700 font-semibold hover:underline" disabled={busy !== null} onClick={() => void resolve(l, 'LINK', c.id)}>Link to this</button> : null}
                          </li>
                        ))}</ul> : null}
                        <div className="flex flex-wrap gap-3 text-[11px]">
                          {l.status !== 'IGNORED' && l.status !== 'LINKED' ? <button type="button" className="text-slate-700 hover:underline" disabled={busy !== null} onClick={() => void resolve(l, 'IGNORE')}>Ignore</button> : null}
                          <button type="button" className="text-slate-700 hover:underline" disabled={busy !== null} onClick={() => void resolve(l, 'RETRY')}>Look again</button>
                          {l.assignmentMode === 'CRM_OVERRIDE' ? <button type="button" className="text-slate-700 hover:underline" disabled={busy !== null} onClick={() => void resolve(l, 'RELEASE_OVERRIDE')}>Let Crocodial assign it again</button> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
