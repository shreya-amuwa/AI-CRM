import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarPlus, ClipboardList, Download, FilePlus2, FileSignature, Phone, Search } from 'lucide-react';
import { BA_STAGES, BA_STAGE_LABELS, type BaContactDetail, type BaContactList, type BaStage } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Field, Pager, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { CallStatusBadge, EmptyState, StatCard, TemperatureBadge, dateText, dateTimeText, tcBtn, tcInput, tcSelect } from '../telecaller/ui';
import type { BaNavigate } from './BusinessAssociateDashboard';
import { DocBadge, StageBadge, inr, notifyBaChanged, openFile } from './ui';

const FILTERS: { value: '' | BaStage; label: string }[] = [
  { value: '', label: 'All Contacts' },
  { value: 'NEW', label: 'New' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'QUOTATION_PENDING', label: 'Quotation Pending' },
  { value: 'DEMO_SCHEDULED', label: 'Demo Scheduled' },
  { value: 'SCOPE_PENDING', label: 'Scope of Project Pending' },
  { value: 'COMPLETED', label: 'Completed' }
];

/** Tasks: the contacts Telecallers handed over to this Business Associate, and the client view where the whole workflow starts. */
export const TasksPage: React.FC<{ go: BaNavigate; initialContactId?: string; initialStage?: string }> = ({ go, initialContactId, initialStage }) => {
  const [contactId, setContactId] = useState<string | null>(initialContactId ?? null);
  if (contactId) return <ContactDetail id={contactId} go={go} onBack={() => setContactId(null)} />;
  return <ContactList go={go} initialStage={initialStage} onOpen={setContactId} />;
};

const ContactList: React.FC<{ go: BaNavigate; initialStage?: string; onOpen: (id: string) => void }> = ({ initialStage, onOpen }) => {
  const [stage, setStage] = useState<'' | BaStage>((BA_STAGES as readonly string[]).includes(initialStage || '') ? (initialStage as BaStage) : '');
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<BaContactList | null>(null);
  const [counts, setCounts] = useState<BaContactList['counts']>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    businessAssociateApi.contacts({ search: query || undefined, stage: stage || undefined, page, pageSize }).then(
      d => mine === seq.current && (setData(d), setCounts(c => (stage || query ? c : d.counts)), setLoading(false)),
      err => mine === seq.current && (setError(errorMessage(err)), setLoading(false))
    );
  }, [query, stage, page, pageSize]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [query, stage, pageSize]);
  // the counts of the whole list (not of a filtered page) come from an unfiltered request
  useEffect(() => {
    businessAssociateApi.contacts({ page: 1, pageSize: 1 }).then(d => setCounts(d.counts), () => undefined);
  }, []);

  const total = Object.values(counts).reduce((n, v) => n + (v ?? 0), 0);
  const n = (s: BaStage) => counts[s] ?? 0;

  return (
    <div className="space-y-5">
      <PageTitle title="Tasks" subtitle="Contacts your Telecallers have qualified and handed over to you." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      <section aria-label="Summary" className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Total Assigned Contacts" value={total} icon={ClipboardList} tone="bg-blue-50 text-blue-600" />
        <StatCard label="New Contacts" value={n('NEW')} icon={ClipboardList} tone="bg-sky-50 text-sky-600" onClick={() => setStage('NEW')} />
        <StatCard label="In Progress" value={n('IN_PROGRESS')} icon={ClipboardList} tone="bg-indigo-50 text-indigo-600" onClick={() => setStage('IN_PROGRESS')} />
        <StatCard label="Quotations Pending" value={n('QUOTATION_PENDING')} icon={ClipboardList} tone="bg-amber-50 text-amber-600" onClick={() => setStage('QUOTATION_PENDING')} />
        <StatCard label="Demos Scheduled" value={n('DEMO_SCHEDULED')} icon={ClipboardList} tone="bg-violet-50 text-violet-600" onClick={() => setStage('DEMO_SCHEDULED')} />
        <StatCard label="Scope Documents Pending" value={n('SCOPE_PENDING')} icon={ClipboardList} tone="bg-orange-50 text-orange-600" onClick={() => setStage('SCOPE_PENDING')} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="p-4 flex flex-col gap-3 border-b border-slate-100">
          <div role="tablist" aria-label="Stage" className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => {
              const on = stage === f.value;
              const c = f.value ? n(f.value) : total;
              return (
                <button key={f.value || 'all'} type="button" role="tab" aria-selected={on} onClick={() => setStage(f.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                  {f.label} <span className={on ? 'text-blue-100' : 'text-slate-400'}>{c}</span>
                </button>
              );
            })}
          </div>
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className={`${tcInput} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, phone, email or source" aria-label="Search contacts" />
          </div>
        </div>

        {loading && !data ? (
          <Spinner label="Loading contacts…" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={ClipboardList} title={query || stage ? 'No contacts match' : 'No contacts have been handed over to you yet'}>
            {query || stage ? 'Try another filter or clear the search.' : 'When a Telecaller qualifies a lead and converts it, the client appears here.'}
          </EmptyState>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" aria-busy={loading}>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
                    {['Contact Name', 'Company/Business Name', 'Phone Number', 'Email', 'Lead Source', 'Assigned Telecaller', 'Assigned Date', 'Business Associate', 'Requirement Status', 'Next Follow-up', 'Actions'].map(h => (
                      <th key={h} scope="col" className="px-4 py-3 font-bold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => onOpen(c.id)}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{c.name}</td>
                      <td className="px-4 py-3 text-slate-600">{c.company || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.phone ? <a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline">{c.phone}</a> : '-'}</td>
                      <td className="px-4 py-3 text-slate-600 break-all">{c.email || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.leadSource || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.telecaller || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(c.assignedAt)}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.businessAssociate || '-'}</td>
                      <td className="px-4 py-3"><StageBadge stage={c.stage} /></td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(c.nextFollowUp)}</td>
                      <td className="px-4 py-3"><button type="button" className={tcBtn.link} onClick={e => { e.stopPropagation(); onOpen(c.id); }} aria-label={`Open ${c.name}`}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden divide-y divide-slate-100">
              {data.items.map(c => (
                <li key={c.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="font-semibold text-slate-900">{c.name}</div><div className="text-xs text-slate-500">{c.company || 'No company'}</div></div>
                    <StageBadge stage={c.stage} />
                  </div>
                  <div className="text-xs text-slate-500">From {c.telecaller || 'a Telecaller'} · {c.leadSource || 'No source'} · Assigned {dateText(c.assignedAt)}{c.nextFollowUp ? ` · Follow-up ${dateText(c.nextFollowUp)}` : ''}</div>
                  <button type="button" className={tcBtn.secondary} onClick={() => onOpen(c.id)}>Open</button>
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={pageSize} total={data.total} noun="contacts" onPage={setPage} onPageSize={setPageSize} />
          </>
        )}
      </section>
    </div>
  );
};

const Card: React.FC<{ title: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, actions, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3"><h2 className="text-base font-extrabold text-slate-900">{title}</h2>{actions}</div>
    <div className="p-5">{children}</div>
  </section>
);
const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="text-sm text-slate-800 break-words">{children || '-'}</dd></div>
);

/** One client: details, requirements, notes and every document, with a way into each next step. */
const ContactDetail: React.FC<{ id: string; go: BaNavigate; onBack: () => void }> = ({ id, go, onBack }) => {
  const [c, setC] = useState<BaContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requirements, setRequirements] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const apply = (d: BaContactDetail) => { setC(d); setRequirements(d.requirements || ''); setFollowUp(d.nextFollowUp || ''); };
  const load = useCallback(() => {
    setError(null);
    businessAssociateApi.contact(id).then(apply, err => setError(errorMessage(err)));
  }, [id]);
  useEffect(load, [load]);
  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 4000); };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setSaving(true);
    setError(null);
    try { await fn(); say(done); notifyBaChanged(); load(); } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  const download = async (get: () => Promise<{ url: string }>) => { const m = await openFile(get); if (m) setError(m); };

  if (!c) return <div className="space-y-4"><button type="button" className={tcBtn.secondary} onClick={onBack}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to Tasks</button>{error ? <ErrorBanner message={error} onRetry={load} /> : <Spinner label="Loading the contact…" />}</div>;

  return (
    <div className="space-y-5">
      <button type="button" className={tcBtn.secondary} onClick={onBack}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to Tasks</button>
      <PageTitle
        title={c.name}
        subtitle={[c.company, c.leadSource && `Source: ${c.leadSource}`, c.telecaller && `Handed over by ${c.telecaller}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <button type="button" className={tcBtn.primary} onClick={() => go('quotation', { contactId: c.id })}><FilePlus2 className="w-4 h-4" aria-hidden="true" /> Quotation</button>
            <button type="button" className={tcBtn.secondary} onClick={() => go('demos', { contactId: c.id, newDemo: true })}><CalendarPlus className="w-4 h-4" aria-hidden="true" /> Schedule demo</button>
            <button type="button" className={tcBtn.secondary} onClick={() => go('scope', { contactId: c.id })}><FileSignature className="w-4 h-4" aria-hidden="true" /> Scope of Project</button>
          </>
        }
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Card title="Client information">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <Fact label="Phone">{c.phone ? <a href={`tel:${c.phone}`} className="text-blue-600 inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" aria-hidden="true" />{c.phone}</a> : null}</Fact>
              <Fact label="Email">{c.email}</Fact>
              <Fact label="Business address">{c.address}</Fact>
              <Fact label="Interested services">{c.services.map(s => s.name).join(', ')}</Fact>
              <Fact label="Lead temperature"><TemperatureBadge value={c.leadTemperature} /></Fact>
              <Fact label="Call status"><CallStatusBadge status={c.callStatus} /></Fact>
              <Fact label="Assigned">{`${dateText(c.assignedAt)} to ${c.businessAssociate || 'you'}`}</Fact>
              <Fact label="Telecaller">{c.telecaller}</Fact>
              <div className="sm:col-span-2"><Fact label="Hand-over note">{c.handoverNote}</Fact></div>
              <div className="sm:col-span-2"><Fact label="Lead notes">{c.notes}</Fact></div>
            </dl>
          </Card>

          <Card title="Business requirements">
            <div className="space-y-3">
              <Field label="What the client needs" htmlFor="ba-req">
                <textarea id="ba-req" className={`${tcInput} min-h-[120px]`} maxLength={5000} value={requirements} onChange={e => setRequirements(e.target.value)} placeholder="Describe the client's business, what they want to achieve and which services they need." />
              </Field>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Next follow-up" htmlFor="ba-follow"><input id="ba-follow" type="date" className={tcInput} value={followUp} onChange={e => setFollowUp(e.target.value)} /></Field>
                <button type="button" className={tcBtn.primary} disabled={saving} onClick={() => void run(() => businessAssociateApi.updateContact(c.id, { requirements: requirements.trim() || null, nextFollowUp: followUp || null }), 'Saved.')}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
              <p className="text-xs text-slate-500">The business profile (industry, goals, current tools…) is kept in <button type="button" className="text-blue-600 underline" onClick={() => go('scope', { contactId: c.id })}>Scope of Project</button>; quotations and the scope read the same facts.</p>
            </div>
          </Card>

          <Card title="Communication notes">
            <form className="flex flex-col sm:flex-row gap-2 mb-4" onSubmit={e => { e.preventDefault(); if (note.trim()) void run(() => businessAssociateApi.addNote(c.id, note.trim()).then(() => setNote('')), 'Note added.'); }}>
              <input className={tcInput} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="Add a note about a call or meeting" aria-label="New note" />
              <button type="submit" className={tcBtn.primary} disabled={saving || !note.trim()}>Add note</button>
            </form>
            {c.events.length === 0 ? <p className="text-sm text-slate-500">No history yet.</p> : (
              <ul className="space-y-2.5">
                {c.events.map(e => (
                  <li key={e.id} className="text-sm"><span className="text-slate-800">{e.note}</span><div className="text-xs text-slate-400">{e.by || 'System'} · {dateTimeText(e.at)} · {e.kind.toLowerCase()}</div></li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Current progress">
            <div className="space-y-3">
              <StageBadge stage={c.stage} />
              <Field label="Change stage" htmlFor="ba-stage">
                <select id="ba-stage" className={`${tcSelect} w-full`} value={c.stage} disabled={saving} onChange={e => void run(() => businessAssociateApi.updateContact(c.id, { stage: e.target.value }), 'Stage updated.')}>
                  {BA_STAGES.map(s => <option key={s} value={s}>{BA_STAGE_LABELS[s]}</option>)}
                </select>
              </Field>
              <p className="text-xs text-slate-500">The stage moves by itself as you draft a quotation, book and complete a demo and finalise the scope. Set it yourself when you need to.</p>
            </div>
          </Card>

          <Card title="Quotations" actions={<button type="button" className={tcBtn.link} onClick={() => go('quotation', { contactId: c.id })}>New / open</button>}>
            {c.quotations.length === 0 ? <p className="text-sm text-slate-500">No quotation yet.</p> : (
              <ul className="space-y-3">
                {c.quotations.map(q => (
                  <li key={q.id} className="text-sm flex items-start justify-between gap-2">
                    <div><button type="button" className="font-semibold text-slate-900 hover:text-blue-700 text-left" onClick={() => go('quotation', { contactId: c.id, quotationId: q.id })}>{q.number} · r{q.revision}</button>
                      <div className="text-xs text-slate-500">{inr(q.total)} · {dateText(q.updatedAt)}</div><DocBadge status={q.status} aiGenerated={q.aiGenerated} reviewed={q.reviewed} /></div>
                    {q.hasPdf && <button type="button" className={tcBtn.link} aria-label={`Download ${q.number}`} onClick={() => void download(() => businessAssociateApi.quotationFile(q.id, 'download'))}><Download className="w-3.5 h-3.5 inline" aria-hidden="true" /> PDF</button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Demos" actions={<button type="button" className={tcBtn.link} onClick={() => go('demos', { contactId: c.id, newDemo: true })}>Schedule</button>}>
            {c.demos.length === 0 ? <p className="text-sm text-slate-500">No demo yet.</p> : (
              <ul className="space-y-2.5">
                {c.demos.map(d => (<li key={d.id} className="text-sm"><div className="font-semibold text-slate-900">{d.title}</div><div className="text-xs text-slate-500">{dateTimeText(d.startsAt)} · {d.mode === 'ONLINE' ? 'Online' : 'In person'} · {d.status.toLowerCase()}</div></li>))}
              </ul>
            )}
          </Card>

          <Card title="Scope of Project" actions={<button type="button" className={tcBtn.link} onClick={() => go('scope', { contactId: c.id })}>Open</button>}>
            {c.scopes.length === 0 ? <p className="text-sm text-slate-500">No scope document yet.</p> : (
              <ul className="space-y-3">
                {c.scopes.map(s => (
                  <li key={s.id} className="text-sm flex items-start justify-between gap-2">
                    <div><button type="button" className="font-semibold text-slate-900 hover:text-blue-700 text-left" onClick={() => go('scope', { contactId: c.id, scopeId: s.id })}>Version {s.version}</button>
                      <div className="text-xs text-slate-500">{dateText(s.updatedAt)}</div><DocBadge status={s.status} aiGenerated={s.aiGenerated} reviewed={s.reviewed} /></div>
                    {s.hasPdf && <button type="button" className={tcBtn.link} aria-label={`Download scope version ${s.version}`} onClick={() => void download(() => businessAssociateApi.scopeFile(s.id, 'download'))}><Download className="w-3.5 h-3.5 inline" aria-hidden="true" /> PDF</button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
