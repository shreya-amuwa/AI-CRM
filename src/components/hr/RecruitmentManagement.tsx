import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, RefreshCw, Search } from 'lucide-react';
import { recruitmentApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { fmtDay } from '../../lib/support';
import type {
  HrRecruiter, RecruitmentActionKind, RecruitmentAgenda, RecruitmentCallOutcome, RecruitmentCandidate, RecruitmentConfirmation, RecruitmentDetail,
  RecruitmentList, RecruitmentOverview, RecruitmentPosition
} from '../../../shared/contracts';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pager, Pill, selectCls, Spinner, type Tone } from '../team-member/pipeline/shared';

/**
 * HR dashboard > Recruitment Management. Candidates live in the database (hr_candidates and its pending items, calls and history); the table
 * has the six columns Candidate Name, Email, Position, Pending, Call and Confirmation, and the last three are separate stages (what is
 * outstanding / the call side / where the confirmation stands), never one combined status. Only HR staff and the Super Admin reach it; the
 * database refuses everyone else. Loaded when the page opens and after each change; nothing polls.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

const CONFIRMATION: Record<RecruitmentConfirmation, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Not started', tone: 'slate' },
  OFFER_PENDING: { label: 'Offer pending', tone: 'orange' },
  OFFERED: { label: 'Offered', tone: 'indigo' },
  CONFIRMED: { label: 'Confirmed', tone: 'green' },
  DECLINED: { label: 'Declined', tone: 'red' },
  ON_HOLD: { label: 'On hold', tone: 'orange' }
};
const OUTCOME: Record<RecruitmentCallOutcome, string> = { ANSWERED: 'Answered', NO_ANSWER: 'No answer', CALL_BACK: 'Asked to call back', NOT_INTERESTED: 'Not interested', WRONG_NUMBER: 'Wrong number' };
const ACTION_KIND: Record<RecruitmentActionKind, string> = { INTERVIEW: 'Interview', DOCUMENTS: 'Documents', ASSESSMENT: 'Assessment', BACKGROUND_CHECK: 'Background check', REFERENCE_CHECK: 'Reference check', OTHER: 'Other' };

type Tab = 'candidates' | 'agenda' | 'positions';
const PAGE = 25;

const Stat: React.FC<{ label: string; value: number; alert?: boolean }> = ({ label, value, alert }) => (
  <Card className={`p-4 ${alert && value > 0 ? 'border-rose-200 bg-rose-50/40' : ''}`}>
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 text-2xl font-extrabold ${alert && value > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div>
  </Card>
);

const PendingCell: React.FC<{ c: RecruitmentCandidate }> = ({ c }) => {
  const p = c.pending;
  if (p.open === 0) return <span className="text-xs text-slate-400">Nothing pending</span>;
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={p.overdue > 0 ? 'red' : 'indigo'}>{p.open} open</Pill>
        {p.overdue > 0 && <Pill tone="red">{p.overdue} overdue</Pill>}
      </div>
      <div className="text-[11px] text-slate-600 max-w-[16rem] truncate" title={p.items.map(i => i.title).join(' · ')}>{p.items[0]?.title}{p.open > 1 ? ` +${p.open - 1} more` : ''}</div>
      {p.nextDue && <div className="text-[11px] text-slate-500">Next due {fmtDay(p.nextDue)}</div>}
    </div>
  );
};
const CallCell: React.FC<{ c: RecruitmentCandidate }> = ({ c }) => {
  const k = c.call;
  return (
    <div className="space-y-0.5">
      {k.nextAt ? <div className="flex items-center gap-1.5"><Pill tone="indigo">Scheduled</Pill><span className="text-[11px] text-slate-600">{when(k.nextAt)}</span></div> : null}
      {k.missedScheduled > 0 && <Pill tone="red">{k.missedScheduled} missed</Pill>}
      {k.last ? (
        <div className="text-[11px] text-slate-600">Last: {OUTCOME[k.last.outcome]} ({fmtDay(k.last.at)})</div>
      ) : !k.nextAt && k.missedScheduled === 0 ? <span className="text-xs text-slate-400">No call yet</span> : null}
      {k.last?.followUpDate && <div className={`text-[11px] ${k.followUpOverdue ? 'font-bold text-rose-700' : 'text-slate-500'}`}>Follow-up {fmtDay(k.last.followUpDate)}{k.followUpOverdue ? ' (overdue)' : ''}</div>}
    </div>
  );
};
const ConfirmationCell: React.FC<{ c: RecruitmentCandidate }> = ({ c }) => {
  const x = CONFIRMATION[c.confirmation.status];
  return (
    <div className="space-y-0.5">
      <Pill tone={x.tone}>{x.label}</Pill>
      {c.confirmation.date && <div className="text-[11px] text-slate-500">{fmtDay(c.confirmation.date)}</div>}
    </div>
  );
};

export const RecruitmentManagement: React.FC = () => {
  const [tab, setTab] = useState<Tab>('candidates');
  const [overview, setOverview] = useState<RecruitmentOverview | null>(null);
  const [positions, setPositions] = useState<RecruitmentPosition[] | null>(null);
  const [recruiters, setRecruiters] = useState<HrRecruiter[]>([]);
  const [list, setList] = useState<RecruitmentList | null>(null);
  const [agenda, setAgenda] = useState<RecruitmentAgenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [position, setPosition] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState('');
  const [call, setCall] = useState('');
  const [owner, setOwner] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadSide = useCallback(async () => {
    const [o, p, r, a] = await Promise.allSettled([recruitmentApi.overview(), recruitmentApi.positions(), recruitmentApi.recruiters(), recruitmentApi.agenda()]);
    if (o.status === 'fulfilled') setOverview(o.value); else setError(errText(o.reason));
    if (p.status === 'fulfilled') setPositions(p.value); else setError(errText(p.reason));
    if (r.status === 'fulfilled') setRecruiters(r.value);
    if (a.status === 'fulfilled') setAgenda(a.value);
  }, []);
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      setList(await recruitmentApi.list({
        search: debounced || undefined, positionId: position || undefined, confirmation: confirmation || undefined, pending: pending || undefined,
        call: call || undefined, ownerId: owner || undefined, limit: PAGE, offset: (page - 1) * PAGE
      }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [debounced, position, confirmation, pending, call, owner, page]);
  useEffect(() => { void loadSide(); }, [loadSide]);
  useEffect(() => { void loadList(); }, [loadList]);
  const refresh = () => { setError(null); void loadSide(); void loadList(); };

  const filtered = !!(debounced || position || confirmation || pending || call || owner);
  return (
    <section className="space-y-5" aria-label="Recruitment management">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">Recruitment Management</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">Candidates, what is still pending for each, their calls and follow-ups, and where the confirmation stands. Every change is kept in the candidate's history.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={refresh}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          <button type="button" className={btn.primary} onClick={() => setOpen('new')}><Plus className="w-3.5 h-3.5" /> Add candidate</button>
        </div>
      </header>
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat label="Candidates" value={overview?.candidates ?? 0} />
        <Stat label="With pending items" value={overview?.withPending ?? 0} />
        <Stat label="Overdue items" value={overview?.overdueActions ?? 0} alert />
        <Stat label="Calls (next 7 days)" value={overview?.upcomingCalls ?? 0} />
        <Stat label="Overdue follow-ups" value={(overview?.overdueFollowUps ?? 0) + (overview?.missedCalls ?? 0)} alert />
        <Stat label="Confirmed" value={overview?.confirmed ?? 0} />
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-slate-50 border border-slate-200 rounded-xl w-fit" role="tablist" aria-label="Recruitment sections">
        {([['candidates', 'Candidates'], ['agenda', 'Calls & follow-ups'], ['positions', 'Positions']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
        ))}
      </div>

      {tab === 'candidates' && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
            <label className="relative block flex-1 min-w-[13rem] max-w-xs"><span className="sr-only">Search by name or e-mail</span>
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input className={`${inputCls} !pl-9`} placeholder="Search name or e-mail" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <select aria-label="Position" className={selectCls} value={position} onChange={e => { setPosition(e.target.value); setPage(1); }}>
              <option value="">All positions</option>{(positions ?? []).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <select aria-label="Pending" className={selectCls} value={pending} onChange={e => { setPending(e.target.value); setPage(1); }}>
              <option value="">Pending: any</option><option value="OPEN">Has pending items</option><option value="OVERDUE">Has overdue items</option><option value="NONE">Nothing pending</option>
            </select>
            <select aria-label="Call" className={selectCls} value={call} onChange={e => { setCall(e.target.value); setPage(1); }}>
              <option value="">Call: any</option><option value="SCHEDULED">Call scheduled</option><option value="FOLLOW_UP_OVERDUE">Follow-up overdue</option><option value="NONE">Never called</option>
            </select>
            <select aria-label="Confirmation" className={selectCls} value={confirmation} onChange={e => { setConfirmation(e.target.value); setPage(1); }}>
              <option value="">Confirmation: any</option>{(Object.keys(CONFIRMATION) as RecruitmentConfirmation[]).map(k => <option key={k} value={k}>{CONFIRMATION[k].label}</option>)}
            </select>
            <select aria-label="Responsible HR employee" className={selectCls} value={owner} onChange={e => { setOwner(e.target.value); setPage(1); }}>
              <option value="">Anyone responsible</option>{recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {!list ? <Spinner label="Loading candidates…" /> : list.items.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{filtered ? 'No candidate matches these filters.' : 'No candidates yet. Add the first one with "Add candidate".'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[56rem]">
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Candidate Name</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Email</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Position</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Pending</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Call</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Confirmation</th>
                    <th scope="col" className="px-3 py-2.5"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-slate-100 ${loading ? 'opacity-60' : ''}`}>
                  {list.items.map(c => (
                    <tr key={c.id} className="align-top hover:bg-slate-50/60">
                      <td className="px-4 py-3"><div className="font-bold text-slate-900">{c.name}</div>{c.owner && <div className="text-[11px] text-slate-500">Responsible: {c.owner}</div>}</td>
                      <td className="px-3 py-3 text-slate-700 break-all">{c.email}</td>
                      <td className="px-3 py-3 text-slate-700">{c.position}</td>
                      <td className="px-3 py-3"><PendingCell c={c} /></td>
                      <td className="px-3 py-3"><CallCell c={c} /></td>
                      <td className="px-3 py-3"><ConfirmationCell c={c} /></td>
                      <td className="px-3 py-3 text-right"><button type="button" className="text-xs font-bold text-indigo-700 hover:underline" onClick={() => setOpen(c.id)} aria-label={`Open ${c.name}`}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list && list.total > PAGE && <Pager page={page} pageSize={PAGE} total={list.total} noun="candidates" onPage={setPage} />}
        </Card>
      )}

      {tab === 'agenda' && <AgendaTab agenda={agenda} onOpen={setOpen} />}
      {tab === 'positions' && <PositionsTab positions={positions} onChanged={refresh} />}

      {open && <CandidateDialog id={open} positions={positions ?? []} recruiters={recruiters} onClose={() => setOpen(null)} onChanged={refresh} />}
    </section>
  );
};

// ---------------------------------------------------------------------------
const AgendaTab: React.FC<{ agenda: RecruitmentAgenda | null; onOpen: (id: string) => void }> = ({ agenda, onOpen }) => {
  if (!agenda) return <Spinner />;
  const Row: React.FC<{ id: string; name: string; sub: string; tone?: Tone; label: string }> = ({ id, name, sub, tone = 'slate', label }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0"><button type="button" className="font-bold text-slate-900 hover:underline text-left" onClick={() => onOpen(id)}>{name}</button><div className="text-[11px] text-slate-500">{sub}</div></div>
      <Pill tone={tone}>{label}</Pill>
    </li>
  );
  const Section: React.FC<{ title: string; empty: string; children: React.ReactNode; count: number }> = ({ title, empty, children, count }) => (
    <Card className="p-4"><h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-indigo-600" aria-hidden="true" /> {title} <span className="text-xs text-slate-500 font-semibold">({count})</span></h3>
      {count === 0 ? <p className="mt-2 text-xs text-slate-500">{empty}</p> : <ul className="mt-1 divide-y divide-slate-100">{children}</ul>}</Card>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="Upcoming calls (14 days)" empty="No call is scheduled." count={agenda.upcomingCalls.length}>
        {agenda.upcomingCalls.map(c => <Row key={c.callId} id={c.candidateId} name={c.name} sub={c.position ?? ''} tone="indigo" label={when(c.at)} />)}
      </Section>
      <Section title="Planned calls not recorded" empty="Nothing is waiting to be recorded." count={agenda.overdueCalls.length}>
        {agenda.overdueCalls.map(c => <Row key={c.callId} id={c.candidateId} name={c.name} sub={c.position ?? ''} tone="red" label={`Was ${when(c.at)}`} />)}
      </Section>
      <Section title="Overdue follow-ups" empty="No follow-up is overdue." count={agenda.overdueFollowUps.length}>
        {agenda.overdueFollowUps.map(c => <Row key={c.candidateId} id={c.candidateId} name={c.name} sub={c.position ?? ''} tone="red" label={`Due ${fmtDay(c.followUpDate)}`} />)}
      </Section>
      <Section title="Overdue pending items" empty="No pending item is overdue." count={agenda.overdueActions.length}>
        {agenda.overdueActions.map(a => <Row key={a.actionId} id={a.candidateId} name={a.name} sub={`${a.title}${a.assignee ? ` · ${a.assignee}` : ''}`} tone="red" label={`Due ${fmtDay(a.dueDate)}`} />)}
      </Section>
    </div>
  );
};

const PositionsTab: React.FC<{ positions: RecruitmentPosition[] | null; onChanged: () => void }> = ({ positions, onChanged }) => {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await recruitmentApi.savePosition({ title, isOpen: true });
      setTitle('');
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (p: RecruitmentPosition) => {
    try { await recruitmentApi.savePosition({ id: p.id, title: p.title, departmentId: p.departmentId, isOpen: !p.isOpen }); onChanged(); } catch (err) { setError(errText(err)); }
  };
  return (
    <Card className="p-4 space-y-3">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[14rem] max-w-sm"><Field label="New position" htmlFor="pos-title"><input id="pos-title" className={inputCls} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sales Executive" /></Field></div>
        <button type="submit" className={btn.primary} disabled={busy || title.trim().length < 2}><Plus className="w-3.5 h-3.5" /> Add position</button>
      </form>
      {error && <ErrorBanner message={error} />}
      {!positions ? <Spinner /> : positions.length === 0 ? <p className="text-xs text-slate-500">No positions yet. Add the roles you are hiring for, then add candidates against them.</p> : (
        <ul className="divide-y divide-slate-100">
          {positions.map(p => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div><span className="font-bold text-slate-900">{p.title}</span> <span className="text-xs text-slate-500">· {p.candidates} candidate{p.candidates === 1 ? '' : 's'}{p.department ? ` · ${p.department}` : ''}</span></div>
              <div className="flex items-center gap-2"><Pill tone={p.isOpen ? 'green' : 'slate'}>{p.isOpen ? 'Open' : 'Closed'}</Pill>
                <button type="button" className={btn.secondary} onClick={() => void toggle(p)}>{p.isOpen ? 'Close position' : 'Reopen'}</button></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const CandidateDialog: React.FC<{ id: string | 'new'; positions: RecruitmentPosition[]; recruiters: HrRecruiter[]; onClose: () => void; onChanged: () => void }> = ({ id, positions, recruiters, onClose, onChanged }) => {
  const isNew = id === 'new';
  const [d, setD] = useState<RecruitmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({ name: '', email: '', phone: '', positionId: positions.find(p => p.isOpen)?.id ?? positions[0]?.id ?? '', ownerId: '', source: '', notes: '' }));
  const [act, setAct] = useState({ kind: 'INTERVIEW' as RecruitmentActionKind, title: '', dueDate: '', assigneeId: '' });
  const [sched, setSched] = useState(toLocalInput(new Date(Date.now() + 86_400_000)));
  const [rec, setRec] = useState({ callId: '', outcome: 'ANSWERED' as RecruitmentCallOutcome, note: '', followUpDate: '' });
  const [conf, setConf] = useState({ status: 'NOT_STARTED' as RecruitmentConfirmation, date: '', note: '' });

  const apply = useCallback((x: RecruitmentDetail) => {
    setD(x);
    setForm({ name: x.name, email: x.email, phone: x.phone ?? '', positionId: x.positionId, ownerId: x.ownerId ?? '', source: x.source ?? '', notes: x.notes ?? '' });
    setConf({ status: x.confirmation.status, date: x.confirmation.date ?? '', note: x.confirmation.note ?? '' });
  }, []);
  const load = useCallback(async () => {
    if (isNew) return;
    try { apply(await recruitmentApi.get(id)); } catch (e) { setError(errText(e)); }
  }, [id, isNew, apply]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (isNew && !form.positionId && positions[0]) setForm(f => ({ ...f, positionId: positions.find(p => p.isOpen)?.id ?? positions[0].id })); }, [isNew, positions, form.positionId]);

  const run = async (key: string, fn: () => Promise<unknown>, done: string, reload = true) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      onChanged();
      if (reload) await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: form.name, email: form.email, phone: form.phone || null, positionId: form.positionId, ownerId: form.ownerId || null, source: form.source || null, notes: form.notes || null };
    if (isNew) {
      void run('save', async () => { await recruitmentApi.create(body); onClose(); }, 'Candidate added.', false);
    } else void run('save', () => recruitmentApi.update(id, body), 'Details saved.');
  };
  const plannedCalls = (d?.calls ?? []).filter(c => !c.calledAt);

  return (
    <Dialog title={isNew ? 'Add candidate' : d ? d.name : 'Candidate'} description={isNew ? 'Add the candidate and the position they applied for. Pending items, calls and confirmation are added after.' : d ? `${d.position} · ${d.email}` : undefined} onClose={onClose} wide>
      {error && <ErrorBanner message={error} />}
      {notice && <div role="status" className="mb-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{notice}</div>}
      {!isNew && !d && !error && <Spinner />}
      {(isNew || d) && (
        <div className="space-y-6">
          <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Candidate details" noValidate>
            <Field label="Candidate name" required htmlFor="c-name"><input id="c-name" className={inputCls} value={form.name} maxLength={160} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email" required htmlFor="c-email"><input id="c-email" type="email" className={inputCls} value={form.email} maxLength={254} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone" htmlFor="c-phone"><input id="c-phone" className={inputCls} value={form.phone} maxLength={40} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Position applied for" required htmlFor="c-pos">
              <select id="c-pos" className={inputCls} value={form.positionId} onChange={e => setForm({ ...form, positionId: e.target.value })}>
                <option value="">Choose a position</option>{positions.map(p => <option key={p.id} value={p.id}>{p.title}{p.isOpen ? '' : ' (closed)'}</option>)}
              </select>
              {positions.length === 0 && <p className="mt-1 text-[11px] text-amber-700">Add a position first (Positions tab).</p>}
            </Field>
            <Field label="Responsible HR employee" htmlFor="c-owner">
              <select id="c-owner" className={inputCls} value={form.ownerId} onChange={e => setForm({ ...form, ownerId: e.target.value })}>
                <option value="">Not assigned</option>{recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Source" htmlFor="c-source"><input id="c-source" className={inputCls} value={form.source} maxLength={80} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="Referral, job portal…" /></Field>
            <div className="sm:col-span-2"><Field label="Notes" htmlFor="c-notes"><textarea id="c-notes" rows={2} maxLength={2000} className={inputCls} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field></div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
              <button type="submit" className={btn.primary} disabled={busy === 'save' || !form.name.trim() || !form.email.trim() || !form.positionId}>{busy === 'save' ? 'Saving…' : isNew ? 'Add candidate' : 'Save details'}</button>
            </div>
          </form>

          {d && (
            <>
              <section aria-label="Pending" className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900">Pending</h3>
                {d.actions.length === 0 ? <p className="text-xs text-slate-500">Nothing pending.</p> : (
                  <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {d.actions.map(a => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div className="min-w-0"><span className="font-bold text-slate-900">{a.title}</span> <span className="text-slate-500">· {ACTION_KIND[a.kind]}{a.assignee ? ` · ${a.assignee}` : ''}{a.dueDate ? ` · due ${fmtDay(a.dueDate)}` : ''}</span>
                          {a.status !== 'OPEN' && a.note && <div className="text-slate-500">{a.note}</div>}</div>
                        {a.status === 'OPEN' ? (
                          <div className="flex items-center gap-1.5">{a.overdue && <Pill tone="red">Overdue</Pill>}
                            <button type="button" className={btn.green} disabled={!!busy} onClick={() => void run(`done-${a.id}`, () => recruitmentApi.closeAction(a.id, { done: true }), 'Marked done.')}>Done</button>
                            <button type="button" className={btn.secondary} disabled={!!busy} onClick={() => void run(`cancel-${a.id}`, () => recruitmentApi.closeAction(a.id, { done: false }), 'Cancelled.')}>Cancel</button></div>
                        ) : <Pill tone={a.status === 'DONE' ? 'green' : 'slate'}>{a.status === 'DONE' ? 'Done' : 'Cancelled'}</Pill>}
                      </li>
                    ))}
                  </ul>
                )}
                <form className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end" onSubmit={e => { e.preventDefault(); void run('action', async () => { await recruitmentApi.addAction(id, { kind: act.kind, title: act.title, dueDate: act.dueDate || null, assigneeId: act.assigneeId || null }); setAct({ ...act, title: '', dueDate: '' }); }, 'Pending item added.'); }} aria-label="Add a pending item">
                  <Field label="What" htmlFor="a-kind"><select id="a-kind" className={inputCls} value={act.kind} onChange={e => setAct({ ...act, kind: e.target.value as RecruitmentActionKind })}>{(Object.keys(ACTION_KIND) as RecruitmentActionKind[]).map(k => <option key={k} value={k}>{ACTION_KIND[k]}</option>)}</select></Field>
                  <div className="sm:col-span-2"><Field label="Details" htmlFor="a-title"><input id="a-title" className={inputCls} value={act.title} maxLength={200} onChange={e => setAct({ ...act, title: e.target.value })} placeholder="e.g. Technical interview with the team lead" /></Field></div>
                  <Field label="Due" htmlFor="a-due"><input id="a-due" type="date" className={inputCls} value={act.dueDate} onChange={e => setAct({ ...act, dueDate: e.target.value })} /></Field>
                  <Field label="Assigned to" htmlFor="a-who"><select id="a-who" className={inputCls} value={act.assigneeId} onChange={e => setAct({ ...act, assigneeId: e.target.value })}><option value="">{d.owner ? `${d.owner} (responsible)` : 'Nobody'}</option>{recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
                  <div className="sm:col-span-5 flex justify-end"><button type="submit" className={btn.secondary} disabled={!!busy || act.title.trim().length < 2}><Plus className="w-3.5 h-3.5" /> Add pending item</button></div>
                </form>
              </section>

              <section aria-label="Calls" className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900">Calls and follow-ups</h3>
                {d.calls.length > 0 && (
                  <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {d.calls.map(c => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div>{c.calledAt ? <><b className="text-slate-900">{c.outcome ? OUTCOME[c.outcome] : ''}</b> <span className="text-slate-500">· {when(c.calledAt)}{c.madeBy ? ` · ${c.madeBy}` : ''}{c.followUpDate ? ` · follow up ${fmtDay(c.followUpDate)}` : ''}</span>{c.note && <div className="text-slate-600">{c.note}</div>}</>
                          : <><b className="text-slate-900">Planned</b> <span className="text-slate-500">· {when(c.scheduledAt)}</span></>}</div>
                        {!c.calledAt && <Pill tone="indigo">Not recorded yet</Pill>}
                      </li>
                    ))}
                  </ul>
                )}
                <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void run('sched', () => recruitmentApi.scheduleCall(id, new Date(sched).toISOString()), 'Call scheduled.'); }} aria-label="Schedule a call">
                  <Field label="Schedule a call" htmlFor="k-at"><input id="k-at" type="datetime-local" className={inputCls} value={sched} onChange={e => setSched(e.target.value)} /></Field>
                  <button type="submit" className={btn.secondary} disabled={!!busy || !sched}><CalendarClock className="w-3.5 h-3.5" /> Schedule</button>
                </form>
                <form className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end" onSubmit={e => { e.preventDefault(); void run('rec', async () => { await recruitmentApi.recordCall(id, { callId: rec.callId || null, outcome: rec.outcome, note: rec.note || null, followUpDate: rec.followUpDate || null }); setRec({ ...rec, callId: '', note: '', followUpDate: '' }); }, 'Call recorded.'); }} aria-label="Record a call">
                  <Field label="Record a call" htmlFor="r-call"><select id="r-call" className={inputCls} value={rec.callId} onChange={e => setRec({ ...rec, callId: e.target.value })}><option value="">A call that was not planned</option>{plannedCalls.map(c => <option key={c.id} value={c.id}>Planned {when(c.scheduledAt)}</option>)}</select></Field>
                  <Field label="Outcome" htmlFor="r-out"><select id="r-out" className={inputCls} value={rec.outcome} onChange={e => setRec({ ...rec, outcome: e.target.value as RecruitmentCallOutcome })}>{(Object.keys(OUTCOME) as RecruitmentCallOutcome[]).map(k => <option key={k} value={k}>{OUTCOME[k]}</option>)}</select></Field>
                  <Field label="Follow-up date" htmlFor="r-fu"><input id="r-fu" type="date" className={inputCls} value={rec.followUpDate} onChange={e => setRec({ ...rec, followUpDate: e.target.value })} /></Field>
                  <Field label="Note" htmlFor="r-note"><input id="r-note" className={inputCls} value={rec.note} maxLength={1000} onChange={e => setRec({ ...rec, note: e.target.value })} /></Field>
                  <div className="sm:col-span-4 flex justify-end"><button type="submit" className={btn.secondary} disabled={!!busy}>Record call</button></div>
                </form>
              </section>

              <section aria-label="Confirmation" className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900">Confirmation</h3>
                <form className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end" onSubmit={e => { e.preventDefault(); void run('conf', () => recruitmentApi.setConfirmation(id, { status: conf.status, date: conf.date || null, note: conf.note || null }), 'Confirmation updated.'); }}>
                  <Field label="Status" htmlFor="f-status"><select id="f-status" className={inputCls} value={conf.status} onChange={e => setConf({ ...conf, status: e.target.value as RecruitmentConfirmation })}>{(Object.keys(CONFIRMATION) as RecruitmentConfirmation[]).map(k => <option key={k} value={k}>{CONFIRMATION[k].label}</option>)}</select></Field>
                  <Field label="Date (offer / decision)" htmlFor="f-date"><input id="f-date" type="date" className={inputCls} value={conf.date} onChange={e => setConf({ ...conf, date: e.target.value })} /></Field>
                  <div className="sm:col-span-2"><Field label="Note" htmlFor="f-note"><input id="f-note" className={inputCls} value={conf.note} maxLength={500} onChange={e => setConf({ ...conf, note: e.target.value })} /></Field></div>
                  <div className="sm:col-span-4 flex justify-end"><button type="submit" className={btn.secondary} disabled={!!busy}>Update confirmation</button></div>
                </form>
              </section>

              <section aria-label="History" className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900">History</h3>
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl max-h-56 overflow-y-auto">
                  {d.history.map(h => <li key={h.id} className="px-3 py-2 text-xs flex flex-wrap justify-between gap-2"><span className="text-slate-800">{h.summary}</span><span className="text-slate-500">{h.actor ?? 'System'} · {when(h.at)}</span></li>)}
                </ul>
              </section>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
};
