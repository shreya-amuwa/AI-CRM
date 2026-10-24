import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Pencil, Search } from 'lucide-react';
import { CALL_STATUSES, type CallStatus, type TelecallerContact, type TelecallerContactList, type TelecallerSheet } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { telecallerApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Avatar, Dialog, ErrorBanner, Field, Pager, Spinner, todayIso, useDebounced } from '../team-member/pipeline/shared';
import { Card, StatCard as HeadStat, Tabs } from '../tasks/head/headParts';
import { CallStatusBadge, CALL_STATUS_OPTIONS, EmptyState, dateText, dateTimeText, notifyTelecallerChanged, tcBtn, tcInput, tcSelect } from './ui';

const FILTERS: { value: '' | CallStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'INTERESTED', label: 'Interested' },
  { value: 'FOLLOW_UP_REQUIRED', label: 'Follow-up Required' },
  { value: 'NOT_INTERESTED', label: 'Not Interested' },
  { value: 'COMPLETED', label: 'Completed' }
];

/** Tasks: the contact sheets the Department Head assigned, the calls to make and what came of each one. */
export const TasksPage: React.FC<{ initialStatus?: string }> = ({ initialStatus }) => {
  const [sheets, setSheets] = useState<TelecallerSheet[]>([]);
  const [sheetsLoaded, setSheetsLoaded] = useState(false);
  const [listId, setListId] = useState('');
  const [status, setStatus] = useState<'' | CallStatus>((CALL_STATUSES as readonly string[]).includes(initialStatus || '') ? (initialStatus as CallStatus) : '');
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<TelecallerContactList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TelecallerContact | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  const loadSheets = useCallback(() => {
    telecallerApi.lists().then(
      s => (setSheets(s), setSheetsLoaded(true)),
      err => (setError(errorMessage(err)), setSheetsLoaded(true))
    );
  }, []);
  useEffect(loadSheets, [loadSheets]);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    telecallerApi.contacts({ listId: listId || undefined, search: query || undefined, status: status || undefined, page, pageSize }).then(
      d => mine === seq.current && (setData(d), setLoading(false)),
      err => mine === seq.current && (setError(errorMessage(err)), setLoading(false))
    );
  }, [listId, query, status, page, pageSize]);
  useEffect(load, [load]);
  // a new search, filter or sheet starts on page 1
  useEffect(() => setPage(1), [listId, query, status, pageSize]);

  const sheet = useMemo(() => sheets.find(s => s.id === listId) ?? null, [sheets, listId]);
  const summary = sheet
    ? { total: sheet.total, pending: sheet.pending, completed: sheet.called }
    : { total: sheets.reduce((n, s) => n + s.total, 0), pending: sheets.reduce((n, s) => n + s.pending, 0), completed: sheets.reduce((n, s) => n + s.called, 0) };
  const counts = data?.counts ?? {};
  const allCount = Object.values(counts).reduce((n, v) => n + (v ?? 0), 0);

  const saved = (c: TelecallerContact) => {
    setEditing(null);
    setNotice(`${c.name} was updated.`);
    setTimeout(() => setNotice(null), 4000);
    load();
    loadSheets();
    notifyTelecallerChanged();
  };

  return (
    <div className="space-y-5">
      <PageTitle title="Tasks" subtitle="The contact sheets assigned to you. Call each contact and record how it went." />

      {error && <ErrorBanner message={error} onRetry={() => (load(), loadSheets())} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}

      {sheetsLoaded && sheets.length === 0 && !error ? (
        <Card>
          <EmptyState icon={FileSpreadsheet} title="No contact sheet has been assigned to you yet">
            When your Department Head assigns you an Excel contact sheet, its contacts appear here and you will get a notification.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card label="Contact sheet" className="p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <label htmlFor="tc-sheet" className="block text-xs font-medium text-slate-600 mb-1">Sheet</label>
                <select id="tc-sheet" className={`${tcSelect} w-full sm:w-auto sm:min-w-[20rem] max-w-full`} value={listId} onChange={e => setListId(e.target.value)}>
                  <option value="">All sheets ({sheets.length})</option>
                  {sheets.map(s => <option key={s.id} value={s.id}>{s.fileName} · {dateText(s.assignedAt)}</option>)}
                </select>
                {sheet ? (
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-900" data-testid="sheet-name">{sheet.fileName}</span> · Assigned {dateText(sheet.assignedAt)} by <span className="font-semibold">{sheet.assignedBy || 'your Department Head'}</span>
                    {sheet.note ? <span className="block text-slate-500">{sheet.note}</span> : null}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Showing the contacts of all your sheets.</p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 shrink-0 w-full sm:w-auto sm:min-w-[24rem]">
                <HeadStat label="Total" value={summary.total} testId="sheet-total" />
                <HeadStat label="Pending" value={summary.pending} tone="amber" testId="sheet-pending" />
                <HeadStat label="Completed" value={summary.completed} tone="green" testId="sheet-completed" />
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 flex flex-col gap-3 border-b border-slate-100">
              <Tabs label="Call status" value={status} onChange={v => setStatus(v as '' | CallStatus)} options={FILTERS.map(f => ({ id: f.value as string, label: f.label, count: f.value ? counts[f.value] ?? 0 : allCount }))} />
              <div className="relative max-w-md">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input className={`${tcInput} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, phone, email or remarks" aria-label="Search contacts" />
              </div>
            </div>

            {loading && !data ? (
              <Spinner label="Loading contacts…" />
            ) : !data || data.items.length === 0 ? (
              <EmptyState title={query || status ? 'No contacts match' : 'No contacts here'}>
                {query || status ? 'Try another filter or clear the search.' : 'This sheet has no contacts.'}
              </EmptyState>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-sm min-w-[1100px]" aria-busy={loading}>
                    <thead>
                      <tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">
                        {['Contact Name', 'Company Name', 'Phone Number', 'Email', 'Assigned Date', 'Call Status', 'Last Called', 'Follow-up Date', 'Remarks', 'Actions'].map(h => (
                          <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.items.map(c => (
                        <tr key={c.id} className="hover:bg-slate-50/60 align-top">
                          <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={c.name} /><span className="font-semibold text-slate-900 text-[13px] whitespace-nowrap">{c.name}</span></div></td>
                          <td className="px-4 py-3 text-slate-600">{c.company || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap"><a href={`tel:${c.phone}`} className="text-blue-600 hover:underline">{c.phone}</a></td>
                          <td className="px-4 py-3 text-slate-600 break-all">{c.email || '-'}</td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(c.assignedAt)}</td>
                          <td className="px-4 py-3"><CallStatusBadge status={c.callStatus} /></td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateTimeText(c.lastCalledAt)}</td>
                          <td className={`px-4 py-3 whitespace-nowrap ${c.followUpDue ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>{dateText(c.followUpDate)}{c.followUpDue ? ' · due' : ''}</td>
                          <td className="px-4 py-3 text-slate-600 max-w-[16rem]"><span className="line-clamp-2" title={c.remarks || undefined}>{c.remarks || '-'}</span></td>
                          <td className="px-4 py-3"><button type="button" className={tcBtn.row} onClick={() => setEditing(c)} aria-label={`Update call for ${c.name}`}><Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Update</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="md:hidden divide-y divide-slate-100">
                  {data.items.map(c => (
                    <li key={c.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          <div className="text-xs text-slate-500">{c.company || 'No company'}</div>
                        </div>
                        <CallStatusBadge status={c.callStatus} />
                      </div>
                      <div className="text-sm"><a href={`tel:${c.phone}`} className="text-blue-600 font-semibold">{c.phone}</a>{c.email ? <span className="text-slate-500"> · {c.email}</span> : null}</div>
                      <div className="text-xs text-slate-500">
                        Assigned {dateText(c.assignedAt)} · Last called {dateTimeText(c.lastCalledAt)}
                        {c.followUpDate ? <span className={c.followUpDue ? 'text-rose-600 font-semibold' : ''}> · Follow-up {dateText(c.followUpDate)}</span> : null}
                      </div>
                      {c.remarks && <p className="text-xs text-slate-600">{c.remarks}</p>}
                      <button type="button" className={tcBtn.secondary} onClick={() => setEditing(c)}>Update call</button>
                    </li>
                  ))}
                </ul>
                <Pager page={page} pageSize={pageSize} total={data.total} noun="contacts" onPage={setPage} onPageSize={setPageSize} />
              </>
            )}
          </Card>
        </>
      )}

      {editing && <CallDialog contact={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
};

/** Record a call: the outcome, the remarks and the follow-up date. Saved through the API; the database checks it belongs to this Telecaller. */
const CallDialog: React.FC<{ contact: TelecallerContact; onClose: () => void; onSaved: (c: TelecallerContact) => void }> = ({ contact, onClose, onSaved }) => {
  const [callStatus, setCallStatus] = useState<CallStatus>(contact.callStatus === 'PENDING' ? 'CONTACTED' : contact.callStatus);
  const [remarks, setRemarks] = useState(contact.remarks || '');
  const [followUp, setFollowUp] = useState(contact.followUpDate || '');
  const [called, setCalled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const needsDate = callStatus === 'FOLLOW_UP_REQUIRED';
  const noFollowUp = callStatus === 'COMPLETED' || callStatus === 'NOT_INTERESTED';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return; // a double click must not record the call twice
    if (needsDate && !followUp) return setError('Enter the follow-up date.');
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const r = await telecallerApi.updateContact(contact.id, { callStatus, remarks: remarks.trim() || null, followUpDate: noFollowUp ? null : followUp || null, called });
      onSaved({ ...contact, ...r });
    } catch (err) {
      setError(errorMessage(err));
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog title={`Update call · ${contact.name}`} description={`${contact.company ? `${contact.company} · ` : ''}${contact.phone}`} onClose={onClose} persistent>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Call status" htmlFor="tc-call-status" required>
          <select id="tc-call-status" className={`${tcInput}`} value={callStatus} onChange={e => setCallStatus(e.target.value as CallStatus)}>
            {CALL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {!noFollowUp && (
          <Field label="Follow-up date" htmlFor="tc-follow-up" required={needsDate} error={undefined}>
            <input id="tc-follow-up" type="date" className={tcInput} min={todayIso()} value={followUp} onChange={e => setFollowUp(e.target.value)} />
          </Field>
        )}
        <Field label="Remarks" htmlFor="tc-remarks">
          <textarea id="tc-remarks" className={`${tcInput} min-h-[96px]`} maxLength={1000} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="What was discussed?" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={called} onChange={e => setCalled(e.target.checked)} className="rounded border-slate-300" />
          I called this contact just now (updates “Last Called”)
        </label>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={tcBtn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={tcBtn.primary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Dialog>
  );
};

