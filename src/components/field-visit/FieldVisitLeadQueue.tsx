import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, UserCheck } from 'lucide-react';
import type { FieldVisitLeadQueue as Queue, FieldVisitLeadRoute, FieldVisitTelecaller } from '../../../shared/contracts';
import { fieldVisitLeadAssignSchema } from '../../../shared/validation';
import { ApiError, errorMessage } from '../../lib/api/client';
import { fieldVisitApi } from '../../lib/api/endpoints';
import { listenToTables } from '../../lib/realtimeShared';
import { PageTitle } from '../layout/shell';
import { Card, Dialog, ErrorBanner, Field, Pager, Pill, Spinner, btn, inputCls, useDebounced } from '../team-member/pipeline/shared';
import { EmptyState } from '../telecaller/ui';
import { agoText, useNow } from './TrackingBits';

const STATUS_TABS = [
  { id: 'PENDING', label: 'Pending assignment' },
  { id: 'ASSIGNED', label: 'Assigned' },
  { id: 'ALL', label: 'All' }
] as const;
type StatusTab = (typeof STATUS_TABS)[number]['id'];

/**
 * Field Visit Leads - Pending Assignment (Sales Department Head): leads the field employees added on a visit. The head reviews each one
 * and gives it to an active Telecaller of the department; the Telecaller then owns it (it is in their Leads), the employee who added it
 * stays recorded as its creator, and every assignment is kept. Who may see and assign which lead is decided by the database.
 */
export const FieldVisitLeadQueuePage: React.FC = () => {
  const [status, setStatus] = useState<StatusTab>('PENDING');
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<FieldVisitLeadRoute | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useNow(60_000);
  const seq = useRef(0);
  useEffect(() => setPage(1), [status, query, pageSize]);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const d = await fieldVisitApi.leadQueue({ status, search: query || undefined, page, pageSize });
      if (n === seq.current) { setData(d); setError(null); }
    } catch (err) {
      if (n !== seq.current) return;
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(errorMessage(err));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [status, query, page, pageSize]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => listenToTables(['field_visit_lead_routes'], () => void load()), [load]);

  if (forbidden) {
    return <Card className="p-6"><EmptyState title="Not available">Field visit leads are assigned by the Sales Department Head.</EmptyState></Card>;
  }
  return (
    <div className="space-y-5" data-testid="fv-lead-queue">
      <PageTitle
        title="Field Visit Leads - Pending Assignment"
        subtitle="Leads your team added on field visits. Review each one and give it to a Telecaller, who follows it up. The employee who added it stays recorded as its creator."
      />
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium" data-testid="fv-queue-notice">{notice}</div>}
      <Card className="overflow-hidden">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
          <div role="tablist" aria-label="Assignment status" className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={status === t.id} onClick={() => setStatus(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${status === t.id ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'}`}>
                {t.label}
                {t.id === 'PENDING' && data ? ` (${data.pending})` : ''}
              </button>
            ))}
          </div>
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Search field visit leads</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input className={`${inputCls} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, phone or city" />
          </label>
        </div>
        {error && <div className="p-4"><ErrorBanner message={error} onRetry={() => void load()} /></div>}
        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length === 0 ? (
          <EmptyState title={query ? 'No lead matches your search' : status === 'PENDING' ? 'Nothing waiting' : 'No field visit lead yet'}>
            {status === 'PENDING' ? 'Leads your team adds on field visits appear here until you assign them.' : 'Field visit leads appear here.'}
          </EmptyState>
        ) : data ? (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map(l => (
                <li key={l.leadId} className="p-4 space-y-2" data-testid="fv-queue-row">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900">{l.company || l.name}</span>
                        <Pill tone={l.status === 'PENDING' ? 'orange' : 'green'}>{l.status === 'PENDING' ? 'Pending assignment' : `Assigned to ${l.assignedTo?.fullName ?? '-'}`}</Pill>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {[l.name, l.phone, l.city].filter(Boolean).join(' · ')}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Added by {l.createdBy ? `${l.createdBy.fullName} (${l.createdBy.role})` : 'a former employee'} · {agoText(l.createdAt, now)}
                      </div>
                    </div>
                    {l.stage === 'LEAD' && (
                      <button type="button" className={l.status === 'PENDING' ? btn.primary : btn.secondary} onClick={() => setAssigning(l)} data-testid="fv-queue-assign">
                        <UserCheck className="w-4 h-4" aria-hidden="true" /> {l.status === 'PENDING' ? 'Assign Telecaller' : 'Reassign'}
                      </button>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                    {([['Address', l.address], ['Email', l.email], ['Business category', l.businessCategory], ['Services', l.services.join(', ')], ['Notes', l.notes],
                      ['Assigned', l.assignedAt ? `${agoText(l.assignedAt, now)} by ${l.assignedBy ?? '-'}` : null]] as [string, string | null][])
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt className="font-medium text-slate-500">{k}</dt>
                          <dd className="text-slate-800 whitespace-pre-wrap break-words">{v}</dd>
                        </div>
                      ))}
                  </dl>
                  {l.history.length > 1 && (
                    <details className="text-[11px] text-slate-600">
                      <summary className="cursor-pointer font-semibold">Assignment history ({l.history.length})</summary>
                      <ol className="mt-1 space-y-0.5">
                        {l.history.map((h, i) => (
                          <li key={i}>{new Date(h.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}: {h.assignedTo ?? '-'} by {h.assignedBy ?? '-'}{h.note ? ` (${h.note})` : ''}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={pageSize} total={data.total} noun="leads" onPage={setPage} onPageSize={setPageSize} />
          </>
        ) : null}
      </Card>
      {assigning && (
        <AssignTelecallerDialog
          lead={assigning}
          onClose={() => setAssigning(null)}
          onDone={r => {
            setAssigning(null);
            setNotice(`${r.company || r.name} was assigned to ${r.assignedTo?.fullName ?? 'the Telecaller'}.`);
            void load();
          }}
        />
      )}
    </div>
  );
};

const AssignTelecallerDialog: React.FC<{ lead: FieldVisitLeadRoute; onClose: () => void; onDone: (r: FieldVisitLeadRoute) => void }> = ({ lead, onClose, onDone }) => {
  const [people, setPeople] = useState<FieldVisitTelecaller[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [telecallerId, setTelecallerId] = useState(lead.assignedTo?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fieldVisitApi.leadTelecallers(lead.leadId).then(setPeople, err => setLoadError(errorMessage(err)));
  }, [lead.leadId]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = fieldVisitLeadAssignSchema.safeParse({ telecallerId, note: note.trim() || null });
    if (!parsed.success) { setError('Choose a Telecaller.'); return; }
    setBusy(true);
    setError(null);
    try {
      onDone(await fieldVisitApi.leadAssign(lead.leadId, parsed.data));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Assign ${lead.company || lead.name}`} description="The Telecaller becomes the lead's owner and is notified. The employee who added it is told who has it." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {loadError && <ErrorBanner message={loadError} />}
        {error && <ErrorBanner message={error} />}
        {!people && !loadError ? (
          <Spinner label="Loading Telecallers…" />
        ) : people && people.length === 0 ? (
          <p className="text-xs text-slate-600">There is no active Telecaller in this department.</p>
        ) : (
          <Field label="Telecaller" required htmlFor="fv-assign-telecaller">
            <select id="fv-assign-telecaller" className={inputCls} value={telecallerId} onChange={e => setTelecallerId(e.target.value)} required>
              <option value="">Choose a Telecaller…</option>
              {(people ?? []).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.team} · {p.openLeads} open leads
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Note for the Telecaller (optional)" htmlFor="fv-assign-note">
          <textarea id="fv-assign-note" rows={3} className={inputCls} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="e.g. Call them this week; they want a demo" />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={busy || !telecallerId} data-testid="fv-assign-submit">{busy ? 'Assigning…' : 'Assign'}</button>
        </div>
      </form>
    </Dialog>
  );
};
