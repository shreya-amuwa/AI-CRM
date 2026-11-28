import React, { useCallback, useRef, useState } from 'react';
import type { ZodError } from 'zod';
import type { AdsLink, AdsReport, AdsReportStatus } from '../../../shared/contracts';
import { ADS_REPORT_STATUSES, ADS_REPORT_STATUS_LABELS } from '../../../shared/contracts';
import { adsReportReviewSchema, adsReportSchema } from '../../../shared/validation';
import { SideDrawer } from '../common/SideDrawer';
import { ReportWordFields, reportWordsWithinLimits } from '../common/ReportWordFields';
import { notifyAdsChanged, takePendingAds, useOpenAdsRequest } from './adsEvents';
import {
  aiDesignStudioApi, Card, CardHead, ClientSelect, cleanLinks, DetailRow, EmptyState, ErrorLine, errorMessage, fieldCls, FormField, Flash, fmtDate, fmtDateTime, ghostBtn,
  isHead, isLead, LinksField, LinksList, LoadingLine, primaryBtn, ReportStatusBadge, Tabs, textareaCls, Timeline, todayIso, useAdsData, useAdsSession
} from './adsUi';

function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? '_');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

/** One id per opened form: a double click or a retry returns the first report instead of making a second one. */
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const daysBack = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ---------------------------------------------------------------------------------------------------- the report form
export const ReportForm: React.FC<{ initial?: AdsReport; onSaved: (text: string) => void }> = ({ initial, onSaved }) => {
  const { ctx } = useAdsSession();
  const clients = useAdsData(() => aiDesignStudioApi.clients({ status: 'ACTIVE' }), []);
  const assignments = useAdsData(() => aiDesignStudioApi.assignments({ view: 'mine' }), []);
  const [reportDate, setReportDate] = useState(initial?.reportDate ?? todayIso());
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [assignmentId, setAssignmentId] = useState(initial?.assignmentId ?? '');
  const [workCompleted, setWorkCompleted] = useState(initial?.workCompleted ?? '');
  const [workInProgress, setWorkInProgress] = useState(initial?.workInProgress ?? '');
  const [pendingWork, setPendingWork] = useState(initial?.pendingWork ?? '');
  const [challenges, setChallenges] = useState(initial?.challenges ?? '');
  const [remarks, setRemarks] = useState(initial?.remarks ?? '');
  const [links, setLinks] = useState<AdsLink[]>(initial?.attachments ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());
  // (20270305000100) the report has three optional fields: Work Completed (150 words), Work Pending (100), Additional Note (50, stored as remarks). Work in progress,
  // challenges and links are no longer asked for; an older report that has them keeps them unchanged when it is sent again.
  const withinLimits = reportWordsWithinLimits({ workCompleted, pendingWork, remarks });

  const route = isHead(ctx)
    ? null
    : isLead(ctx)
      ? 'Your own reports go directly to the Department Head.'
      : ctx.unassigned
        ? 'No Team Lead assigned yet: this report goes directly to the Department Head.'
        : `This report goes to ${ctx.leadName ?? 'your Team Lead'}, then to the Department Head.`;

  const pickAssignment = (id: string) => {
    setAssignmentId(id);
    const a = assignments.data?.find(x => x.id === id);
    if (a) setClientId(a.clientId);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setServerError(null);
    const parsed = adsReportSchema.safeParse({
      id: initial?.id, reportDate, clientId, assignmentId, workCompleted, workInProgress, pendingWork, challenges, remarks, attachments: cleanLinks(links),
      clientRequestId: initial ? undefined : requestId.current
    });
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({});
    setBusy(true);
    try {
      await aiDesignStudioApi.submitReport(parsed.data);
      requestId.current = newRequestId();
      if (!initial) {
        setWorkCompleted(''); setWorkInProgress(''); setPendingWork(''); setChallenges(''); setRemarks(''); setLinks([]); setClientId(''); setAssignmentId('');
      }
      notifyAdsChanged();
      onSaved(initial ? 'Report sent again.' : 'Report submitted.');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={initial ? 'Edit and send the report again' : 'Daily report'}>
      {route && <p className="text-[13px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{route}</p>}
      <ErrorLine message={serverError} />
      {(clients.error || assignments.error) && <ErrorLine message={clients.error || assignments.error} onRetry={() => { clients.reload(); assignments.reload(); }} />}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField label="Report date" htmlFor="rep-date" required error={errors.reportDate}>
          <input id="rep-date" type="date" className={fieldCls} min={daysBack(60)} max={todayIso()} value={reportDate} disabled={busy} aria-invalid={!!errors.reportDate} onChange={e => setReportDate(e.target.value)} />
        </FormField>
        <FormField label="Client" htmlFor="rep-client" error={errors.clientId}>
          <ClientSelect id="rep-client" value={clientId} onChange={setClientId} clients={clients.data ?? []} allowEmpty disabled={busy} />
        </FormField>
        <FormField label="Assignment / task" htmlFor="rep-asg" error={errors.assignmentId}>
          <select id="rep-asg" className={fieldCls} value={assignmentId} disabled={busy} onChange={e => pickAssignment(e.target.value)}>
            <option value="">No specific assignment</option>
            {(assignments.data ?? []).filter(a => a.status !== 'COMPLETED' || a.id === assignmentId).map(a => <option key={a.id} value={a.id}>{a.title}{a.clientName ? ` · ${a.clientName}` : ''}</option>)}
          </select>
        </FormField>
        <div className="md:col-span-3">
          <ReportWordFields idPrefix="rep" values={{ workCompleted, pendingWork, remarks }} errors={errors} disabled={busy} inputClassName={textareaCls}
            onChange={(k, v) => (k === 'workCompleted' ? setWorkCompleted(v) : k === 'pendingWork' ? setPendingWork(v) : setRemarks(v))} />
        </div>
      </div>
      <button type="submit" className={primaryBtn} disabled={busy || !withinLimits} data-testid="ads-report-submit">{busy ? 'Sending…' : initial ? 'Send again' : 'Submit report'}</button>
    </form>
  );
};

// ---------------------------------------------------------------------------------------------------- lists
const ReportTable: React.FC<{ rows: AdsReport[]; showAuthor: boolean; onOpen: (id: string) => void }> = ({ rows, showAuthor, onOpen }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
          <th scope="col" className="px-5 py-2.5 font-semibold">Date</th>
          {showAuthor && <th scope="col" className="px-3 py-2.5 font-semibold">Employee</th>}
          <th scope="col" className="px-3 py-2.5 font-semibold">Client</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Assignment</th>
          <th scope="col" className="px-3 py-2.5 font-semibold">Work Completed</th>
          <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className={`border-b border-slate-50 hover:bg-slate-50/70 ${r.canReview ? 'bg-amber-50/40' : ''}`}>
            <td className="px-5 py-3 whitespace-nowrap">
              <button type="button" className="font-semibold text-slate-900 underline decoration-slate-300 hover:decoration-blue-600" onClick={() => onOpen(r.id)}>{fmtDate(r.reportDate)}</button>
              {r.revision > 1 && <div className="text-xs text-slate-500">Sent {r.revision} times</div>}
            </td>
            {showAuthor && <td className="px-3 py-3 text-slate-700">{r.authorName || '–'}{r.leadName && r.authorId !== r.leadId ? <div className="text-xs text-slate-500">Lead: {r.leadName}</div> : null}</td>}
            <td className="px-3 py-3 text-slate-700">{r.clientName || '–'}</td>
            <td className="px-3 py-3 text-slate-700">{r.assignmentTitle || '–'}</td>
            <td className="px-3 py-3 text-slate-700 max-w-xs"><span className="line-clamp-2">{r.workCompleted || r.pendingWork || r.remarks || '–'}</span></td>
            <td className="px-5 py-3"><ReportStatusBadge status={r.status} />{r.canReview && <div className="text-xs font-semibold text-amber-700 mt-1">Waiting for you</div>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

interface ListQuery { view: 'mine' | 'team' | 'all'; status?: string; from?: string; to?: string; clientId?: string; authorId?: string; leadId?: string }
const ReportList: React.FC<{ query: ListQuery; showAuthor: boolean; emptyTitle: string; emptyHint?: string; onOpen: (id: string) => void }> = ({ query, showAuthor, emptyTitle, emptyHint, onOpen }) => {
  const key = JSON.stringify(query);
  const { data, loading, error, reload } = useAdsData(() => aiDesignStudioApi.reports(query), [key]);
  if (loading && !data) return <LoadingLine label="Loading reports…" />;
  if (error) return <div className="p-5"><ErrorLine message={error} onRetry={reload} /></div>;
  if (!data || data.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return <ReportTable rows={data} showAuthor={showAuthor} onOpen={onOpen} />;
};

// ---------------------------------------------------------------------------------------------------- drawer
const ReviewPanel: React.FC<{ report: AdsReport; onDone: (text: string) => void }> = ({ report, onDone }) => {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'APPROVE' | 'RETURN') => {
    setServerError(null);
    if (decision === 'RETURN' && !remarks.trim()) { setError('Add remarks when you return a report.'); return; }
    const parsed = adsReportReviewSchema.safeParse({ decision, remarks });
    if (!parsed.success) { setError(fieldErrors(parsed.error).remarks || 'Check the remarks.'); return; }
    setError(null);
    setBusy(true);
    try {
      await aiDesignStudioApi.reviewReport(report.id, parsed.data.decision, parsed.data.remarks ?? undefined);
      setRemarks('');
      notifyAdsChanged();
      onDone(decision === 'APPROVE' ? 'Report approved.' : 'Report returned with your remarks.');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" role="group" aria-label="Your decision">
      <h3 className="text-sm font-extrabold text-slate-900">Your decision</h3>
      <ErrorLine message={serverError} />
      <FormField label="Remarks (required when you return it)" htmlFor="rv-remarks" error={error}>
        <textarea id="rv-remarks" rows={3} className={textareaCls} value={remarks} maxLength={2000} disabled={busy} aria-invalid={!!error} onChange={e => { setRemarks(e.target.value); setError(null); }} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => void decide('APPROVE')}>Approve</button>
        <button type="button" className={ghostBtn} disabled={busy} onClick={() => void decide('RETURN')}>Return with remarks</button>
      </div>
    </div>
  );
};

const ReportDrawer: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { ctx } = useAdsSession();
  const { data, loading, error, reload } = useAdsData(() => aiDesignStudioApi.report(id), [id]);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const done = (text: string) => { setFlash(text); setEditing(false); reload(); };
  const canEdit = !!data && data.authorId === ctx.userId && data.status === 'RETURNED';

  return (
    <SideDrawer title={data ? `Report of ${fmtDate(data.reportDate)}` : 'Report'} subtitle={data ? `${data.authorName ?? ''}${data.clientName ? ` · ${data.clientName}` : ''}` : undefined} onClose={onClose}>
      <div className="p-5 space-y-6">
        {loading && !data && <LoadingLine label="Loading report…" />}
        <ErrorLine message={error} onRetry={reload} />
        <Flash text={flash} onClose={() => setFlash(null)} />
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ReportStatusBadge status={data.status} />
              {data.status === 'RETURNED' && data.returnStage && <span className="text-xs text-slate-500">Returned by the {data.returnStage === 'TEAM_LEAD' ? 'Team Lead' : 'Department Head'}</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DetailRow label="Employee">{data.authorName}</DetailRow>
              <DetailRow label="Team Lead">{data.authorRole === 'TEAM_MEMBER' ? data.leadName || 'None assigned yet' : '–'}</DetailRow>
              <DetailRow label="Client">{data.clientName}</DetailRow>
              <DetailRow label="Assignment">{data.assignmentTitle}</DetailRow>
              <div className="col-span-2"><DetailRow label="Work Completed">{data.workCompleted}</DetailRow></div>
              <div className="col-span-2"><DetailRow label="Work Pending">{data.pendingWork}</DetailRow></div>
              {data.challenges?.trim() ? <div className="col-span-2"><DetailRow label="Challenges or blockers">{data.challenges}</DetailRow></div> : null}
              {/* parts no longer asked for: shown only on an older report that has them */}
              {data.workInProgress?.trim() ? <div className="col-span-2"><DetailRow label="Work in progress">{data.workInProgress}</DetailRow></div> : null}
              {data.remarks?.trim() ? <div className="col-span-2"><DetailRow label="Additional Note">{data.remarks}</DetailRow></div> : null}
              {data.attachments.length > 0 ? <div className="col-span-2"><DetailRow label="Attachments"><LinksList links={data.attachments} /></DetailRow></div> : null}
              <DetailRow label="Last sent">{fmtDateTime(data.submittedAt)}</DetailRow>
            </dl>

            {data.canReview && <ReviewPanel report={data} onDone={done} />}

            {canEdit && !editing && <button type="button" className={primaryBtn} onClick={() => setEditing(true)}>Edit and send again</button>}
            {canEdit && editing && (
              <section aria-label="Edit and send again" className="space-y-3">
                <h3 className="text-sm font-extrabold text-slate-900">Edit and send again</h3>
                <ReportForm initial={data} onSaved={done} />
              </section>
            )}

            <section aria-label="Approval history" className="space-y-2">
              <h3 className="text-sm font-extrabold text-slate-900">Approval history</h3>
              {data.events.length ? <Timeline events={data.events} /> : <p className="text-[13px] text-slate-500">No history yet.</p>}
            </section>
          </>
        )}
      </div>
    </SideDrawer>
  );
};

// ---------------------------------------------------------------------------------------------------- panels per role
/** My own reports: the form (optional here) and the list. */
const MyReportsList: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => (
  <Card label="My reports">
    <CardHead title="My reports" hint="Open a report to see its approval history and the reviewers' remarks. A returned report can be edited and sent again." />
    <ReportList query={{ view: 'mine' }} showAuthor={false} emptyTitle="No reports yet" emptyHint="Reports you submit appear here with their status." onOpen={onOpen} />
  </Card>
);

const SubmitCard: React.FC<{ onSaved: (text: string) => void }> = ({ onSaved }) => (
  <Card label="Submit a daily report">
    <CardHead title="Submit a daily report" />
    <div className="px-5 pb-5"><ReportForm onSaved={onSaved} /></div>
  </Card>
);

const MemberReports: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [tab, setTab] = useState<'submit' | 'mine'>('submit');
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Tabs label="Reports" value={tab} onChange={setTab} options={[{ id: 'submit', label: 'Submit report' }, { id: 'mine', label: 'My reports' }]} />
      <Flash text={flash} onClose={() => setFlash(null)} />
      {tab === 'submit' ? <SubmitCard onSaved={t => { setFlash(t); setTab('mine'); }} /> : <MyReportsList onOpen={onOpen} />}
    </div>
  );
};

const STATUS_TABS = (extra?: { id: AdsReportStatus; count: number }): { id: 'ALL' | AdsReportStatus; label: string; count?: number }[] => [
  { id: 'ALL', label: 'All' },
  ...ADS_REPORT_STATUSES.map(s => ({ id: s, label: ADS_REPORT_STATUS_LABELS[s], count: extra && extra.id === s ? extra.count : undefined }))
];

const LeadReports: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const { people } = useAdsSession();
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const [flash, setFlash] = useState<string | null>(null);
  const [status, setStatus] = useState<'ALL' | AdsReportStatus>('ALL');
  const [authorId, setAuthorId] = useState('');
  const waiting = useAdsData(() => aiDesignStudioApi.reports({ view: 'team', status: 'PENDING_TL' }), []);
  return (
    <div className="space-y-4">
      <Tabs label="Reports" value={tab} onChange={setTab}
        options={[{ id: 'mine', label: 'My Reports' }, { id: 'team', label: 'Team Member Reports', count: waiting.data?.length || undefined }]} />
      <Flash text={flash} onClose={() => setFlash(null)} />
      {tab === 'mine' ? (
        <>
          <SubmitCard onSaved={setFlash} />
          <MyReportsList onOpen={onOpen} />
        </>
      ) : (
        <Card label="Team Member reports">
          <CardHead title="Team Member reports" hint="Reports from your own Team Members. Approve them to send them on to the Department Head, or return them with remarks."
            right={
              <div className="w-full sm:w-56">
                <label htmlFor="rep-filter-member" className="sr-only">Filter by Team Member</label>
                <select id="rep-filter-member" className={fieldCls} value={authorId} onChange={e => setAuthorId(e.target.value)}>
                  <option value="">All my Team Members</option>
                  {people.filter(p => p.role === 'TEAM_MEMBER').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            } />
          <div className="px-5 pb-3"><Tabs label="Status" value={status} onChange={setStatus} options={STATUS_TABS({ id: 'PENDING_TL', count: waiting.data?.length ?? 0 })} /></div>
          <ReportList query={{ view: 'team', status: status === 'ALL' ? undefined : status, authorId: authorId || undefined }} showAuthor
            emptyTitle="No Team Member reports" emptyHint="Reports submitted by your Team Members appear here." onOpen={onOpen} />
        </Card>
      )}
    </div>
  );
};

const HeadReports: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const { people } = useAdsSession();
  const clients = useAdsData(() => aiDesignStudioApi.clients(), []);
  const waiting = useAdsData(() => aiDesignStudioApi.reports({ view: 'all', status: 'PENDING_DH' }), []);
  const [status, setStatus] = useState<'ALL' | AdsReportStatus>('ALL');
  const [leadId, setLeadId] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <Card label="All reports">
      <CardHead title="All AI Design Studio reports" hint="Review what the Team Leads approved, and see every report with its full approval history." />
      <div className="px-5 pb-3 space-y-3">
        <Tabs label="Status" value={status} onChange={setStatus} options={STATUS_TABS({ id: 'PENDING_DH', count: waiting.data?.length ?? 0 })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <FormField label="Team Lead" htmlFor="hf-lead">
            <select id="hf-lead" className={fieldCls} value={leadId} onChange={e => setLeadId(e.target.value)}>
              <option value="">All Team Leads</option>
              {people.filter(p => p.role === 'TEAM_HEAD').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
          <FormField label="Team Member" htmlFor="hf-member">
            <select id="hf-member" className={fieldCls} value={authorId} onChange={e => setAuthorId(e.target.value)}>
              <option value="">Everyone</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
          <FormField label="Client" htmlFor="hf-client"><ClientSelect id="hf-client" value={clientId} onChange={setClientId} clients={clients.data ?? []} allowEmpty emptyLabel="All clients" /></FormField>
          <FormField label="From" htmlFor="hf-from"><input id="hf-from" type="date" className={fieldCls} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></FormField>
          <FormField label="To" htmlFor="hf-to"><input id="hf-to" type="date" className={fieldCls} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></FormField>
        </div>
      </div>
      <ReportList
        query={{ view: 'all', status: status === 'ALL' ? undefined : status, leadId: leadId || undefined, authorId: authorId || undefined, clientId: clientId || undefined, from: from || undefined, to: to || undefined }}
        showAuthor emptyTitle="No reports found" emptyHint="Try other filters, or wait for the team to submit reports." onOpen={onOpen} />
    </Card>
  );
};

export const AdsReports: React.FC = () => {
  const { ctx } = useAdsSession();
  const [openId, setOpenId] = useState<string | null>(() => takePendingAds('ads_report'));
  useOpenAdsRequest(useCallback(d => {
    if (d.entityType !== 'ads_report') return;
    const id = takePendingAds('ads_report');
    if (id) setOpenId(id);
  }, []));
  const close = useCallback(() => setOpenId(null), []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 font-heading">Report</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {isHead(ctx) ? 'Daily reports of the whole department.' : isLead(ctx) ? 'Your own daily reports, and the reports of your Team Members.' : 'Your daily work reports.'}
        </p>
      </div>
      {isHead(ctx) ? <HeadReports onOpen={setOpenId} /> : isLead(ctx) ? <LeadReports onOpen={setOpenId} /> : <MemberReports onOpen={setOpenId} />}
      {openId && <ReportDrawer id={openId} onClose={close} />}
    </div>
  );
};
