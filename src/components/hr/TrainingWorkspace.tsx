import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { trainingApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { fmtDay } from '../../lib/support';
import type {
  TrainingAttendance, TrainingDayConfig, TrainingEmployee, TrainingEnrollmentDetail, TrainingEnrollmentRow, TrainingOverview, TrainingProgram,
  TrainingProgramDetail, TrainingRecords, TrainingStatus
} from '../../../shared/contracts';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pager, Pill, selectCls, Spinner, type Tone } from '../team-member/pipeline/shared';

/**
 * HR dashboard > Training. Structured three-day programs: Day 1 Initial Training, Day 2 Practical Training, Day 3 Final Training and
 * Assessment. HR configures the topics, trainer and assessment criteria; for every employee HR (or the day's trainer) records attendance, the
 * topics and tasks done, the assessment and the feedback, one report per day. A day counts as complete only when the employee attended AND
 * something was recorded: the calendar completes nothing. Every enrollment stays as history. All figures are read from the database.
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const STATUS: Record<TrainingStatus, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Not started', tone: 'slate' },
  IN_PROGRESS: { label: 'In progress', tone: 'indigo' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  INCOMPLETE: { label: 'Incomplete', tone: 'red' }
};
const PHASE: Record<TrainingProgram['phase'], { label: string; tone: Tone }> = {
  UPCOMING: { label: 'Upcoming', tone: 'indigo' }, RUNNING: { label: 'Running', tone: 'green' }, ENDED: { label: 'Ended', tone: 'slate' }, CANCELLED: { label: 'Cancelled', tone: 'red' }
};
const ATTENDANCE: Record<TrainingAttendance, string> = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused' };
const DAY_NAME = ['', 'Day 1 · Initial Training', 'Day 2 · Practical Training', 'Day 3 · Final Training and Assessment'];
const PAGE = 25;

const Stat: React.FC<{ label: string; value: number; alert?: boolean }> = ({ label, value, alert }) => (
  <Card className={`p-4 ${alert && value > 0 ? 'border-rose-200 bg-rose-50/40' : ''}`}>
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 text-2xl font-extrabold ${alert && value > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div>
  </Card>
);

const DayChips: React.FC<{ days: TrainingEnrollmentRow['days'] }> = ({ days }) => (
  <div className="flex gap-1.5">
    {days.map(d => (
      <span key={d.dayNo} title={`Day ${d.dayNo} (${fmtDay(d.date)}): ${d.completed ? 'complete' : d.attendance ? ATTENDANCE[d.attendance] : d.overdue ? 'not reported yet' : 'not yet'}`}
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${d.completed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : d.attendance === 'ABSENT' ? 'bg-rose-50 text-rose-700 border-rose-200' : d.attendance ? 'bg-amber-50 text-amber-700 border-amber-200' : d.overdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
        D{d.dayNo}{d.completed ? ' ✓' : d.overdue && !d.attendance ? ' !' : ''}
      </span>
    ))}
  </div>
);

export const TrainingWorkspace: React.FC = () => {
  const [tab, setTab] = useState<'programs' | 'records'>('programs');
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [programs, setPrograms] = useState<TrainingProgram[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openProgram, setOpenProgram] = useState<string | null>(null);
  const [newProgram, setNewProgram] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [o, p] = await Promise.allSettled([trainingApi.overview(), trainingApi.programs()]);
    if (o.status === 'fulfilled') setOverview(o.value); else setError(errText(o.reason));
    if (p.status === 'fulfilled') setPrograms(p.value); else setError(errText(p.reason));
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (openProgram) return <ProgramView id={openProgram} onBack={() => { setOpenProgram(null); void load(); }} />;
  return (
    <section className="space-y-5" aria-label="Training">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">Training</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">Three-day training programs with a report for every employee and every day. A day is complete only when the employee attended and the training was recorded: the date passing completes nothing.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          <button type="button" className={btn.primary} onClick={() => setNewProgram(true)}><Plus className="w-3.5 h-3.5" /> New program</button>
        </div>
      </header>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat label="Employees enrolled" value={overview?.employeesEnrolled ?? 0} />
        <Stat label="Active programs" value={overview?.activePrograms ?? 0} />
        <Stat label="Completed" value={overview?.completed ?? 0} />
        <Stat label="Pending training" value={overview?.pendingTraining ?? 0} />
        <Stat label="Incomplete" value={overview?.incomplete ?? 0} alert />
        <Stat label="Day reports missing" value={overview?.pendingReports ?? 0} alert />
      </div>
      <div className="flex gap-1 p-1 bg-slate-50 border border-slate-200 rounded-xl w-fit" role="tablist" aria-label="Training sections">
        {([['programs', 'Programs'], ['records', 'Employee records']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
        ))}
      </div>

      {tab === 'programs' && (!programs ? <Spinner label="Loading programs…" /> : programs.length === 0 ? (
        <Card className="p-10 text-center"><p className="text-sm font-bold text-slate-900">No training program yet</p><p className="text-xs text-slate-500 mt-1">Create the first program with “New program”, then enrol employees.</p></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {programs.map(p => (
            <Card key={p.id} className="p-4">
              <button type="button" className="w-full text-left" onClick={() => setOpenProgram(p.id)} aria-label={`Open ${p.name}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-slate-900">{p.name}</h3>
                  <Pill tone={PHASE[p.phase].tone}>{PHASE[p.phase].label}</Pill>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> {fmtDay(p.startDate)} – {fmtDay(p.endDate)}{p.owner ? ` · ${p.owner}` : ''}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="inline-flex items-center gap-1 text-slate-700"><Users className="w-3.5 h-3.5" aria-hidden="true" /> {p.enrolled} enrolled</span>
                  {(Object.keys(STATUS) as TrainingStatus[]).filter(s => p.byStatus[s]).map(s => <Pill key={s} tone={STATUS[s].tone}>{p.byStatus[s]} {STATUS[s].label.toLowerCase()}</Pill>)}
                </div>
              </button>
            </Card>
          ))}
        </div>
      ))}
      {tab === 'records' && <RecordsTab />}
      {newProgram && <ProgramDialog onClose={() => setNewProgram(false)} onSaved={id => { setNewProgram(false); void load(); setOpenProgram(id); }} />}
    </section>
  );
};

// ---------------------------------------------------------------------------
const RecordsTab: React.FC = () => {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TrainingRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(async () => {
    try { setError(null); setData(await trainingApi.records({ search: q || undefined, status: status || undefined, limit: PAGE, offset: (page - 1) * PAGE })); } catch (e) { setError(errText(e)); }
  }, [q, status, page]);
  useEffect(() => { void load(); }, [load]);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
        <label className="relative block flex-1 min-w-[13rem] max-w-xs"><span className="sr-only">Search employee</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input className={`${inputCls} !pl-9`} placeholder="Search employee name or ID" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <select aria-label="Training status" className={selectCls} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>{(Object.keys(STATUS) as TrainingStatus[]).map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
      </div>
      {error && <div className="p-3"><ErrorBanner message={error} onRetry={() => void load()} /></div>}
      {!data ? <Spinner /> : data.items.length === 0 ? <p className="p-10 text-center text-xs text-slate-500">No training records{q || status ? ' match these filters' : ' yet'}. An employee's record appears here when they are enrolled in a program; earlier programs stay in their history.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[48rem]">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Employee</th><th scope="col" className="px-3 py-2.5 font-semibold">Department</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Program</th><th scope="col" className="px-3 py-2.5 font-semibold">Dates</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Days</th><th scope="col" className="px-3 py-2.5 font-semibold">Status</th><th scope="col" className="px-3 py-2.5"><span className="sr-only">Open</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map(r => (
                <tr key={r.id} className="align-top hover:bg-slate-50/60">
                  <td className="px-4 py-3"><div className="font-bold text-slate-900">{r.employeeName}</div><div className="text-[11px] text-slate-500">{[r.employeeCode, r.designation].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-3 py-3 text-slate-700">{r.department ?? '–'}</td>
                  <td className="px-3 py-3 text-slate-700">{r.program}</td>
                  <td className="px-3 py-3 text-slate-600">{fmtDay(r.startDate)} – {fmtDay(r.endDate)}</td>
                  <td className="px-3 py-3"><DayChips days={r.days} /></td>
                  <td className="px-3 py-3"><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill></td>
                  <td className="px-3 py-3 text-right"><button type="button" className="text-xs font-bold text-indigo-700 hover:underline" onClick={() => setOpen(r.id)} aria-label={`Open the record of ${r.employeeName} in ${r.program}`}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE && <Pager page={page} pageSize={PAGE} total={data.total} noun="records" onPage={setPage} />}
      {open && <EnrollmentDialog id={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </Card>
  );
};

// ---------------------------------------------------------------------------
const ProgramDialog: React.FC<{ program?: TrainingProgram; onClose: () => void; onSaved: (id: string) => void }> = ({ program, onClose, onSaved }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(program?.name ?? '');
  const [description, setDescription] = useState(program?.description ?? '');
  const [start, setStart] = useState(program?.startDate ?? today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await trainingApi.saveProgram({ id: program?.id, name, description: description || null, startDate: start });
      onSaved(saved.id);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <Dialog title={program ? 'Edit program' : 'New training program'} description="The three days follow one another from the start date: Day 1 Initial Training, Day 2 Practical Training, Day 3 Final Training and Assessment." onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Program name" required htmlFor="tp-name"><input id="tp-name" className={inputCls} value={name} maxLength={160} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Start date (Day 1)" required htmlFor="tp-start"><input id="tp-start" type="date" className={inputCls} value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="Description" htmlFor="tp-desc"><textarea id="tp-desc" rows={2} className={inputCls} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={busy || name.trim().length < 2 || !start}>{busy ? 'Saving…' : program ? 'Save program' : 'Create program'}</button></div>
      </form>
    </Dialog>
  );
};

const DayConfig: React.FC<{ programId: string; day: TrainingDayConfig; trainers: TrainingEmployee[]; onSaved: () => void }> = ({ programId, day, trainers, onSaved }) => {
  const [title, setTitle] = useState(day.title);
  const [topics, setTopics] = useState(day.topics.join('\n'));
  const [trainerName, setTrainerName] = useState(day.trainerName ?? '');
  const [trainerId, setTrainerId] = useState(day.trainerId ?? '');
  const [criteria, setCriteria] = useState(day.criteria.map(c => ({ name: c.name, max: String(c.max) })));
  const [pass, setPass] = useState(day.passPercent ? String(day.passPercent) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await trainingApi.saveDay(programId, day.dayNo, {
        title, topics: topics.split('\n').map(t => t.trim()).filter(Boolean), trainerName: trainerName || null, trainerId: trainerId || null,
        criteria: criteria.filter(c => c.name.trim()).map(c => ({ name: c.name.trim(), max: Number(c.max) })), passPercent: pass ? Number(pass) : null
      });
      setMsg({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    } finally {
      setBusy(false);
    }
  };
  const profiles = trainers.filter(t => !t.employeeKey.startsWith('HR:'));
  return (
    <Card className="p-4">
      <form onSubmit={save} className="space-y-3" aria-label={DAY_NAME[day.dayNo]} noValidate>
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-extrabold text-slate-900">{DAY_NAME[day.dayNo]}</h4><span className="text-xs text-slate-500">{fmtDay(day.date)}</span></div>
        <Field label="Title" htmlFor={`d${day.dayNo}-title`}><input id={`d${day.dayNo}-title`} className={inputCls} value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></Field>
        <Field label="Topics (one per line)" htmlFor={`d${day.dayNo}-topics`}><textarea id={`d${day.dayNo}-topics`} rows={3} className={inputCls} value={topics} onChange={e => setTopics(e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Trainer (name)" htmlFor={`d${day.dayNo}-tn`}><input id={`d${day.dayNo}-tn`} className={inputCls} value={trainerName} maxLength={160} onChange={e => setTrainerName(e.target.value)} /></Field>
          <Field label="Trainer's CRM login (can record this day)" htmlFor={`d${day.dayNo}-tid`}>
            <select id={`d${day.dayNo}-tid`} className={inputCls} value={trainerId} onChange={e => setTrainerId(e.target.value)}><option value="">HR records this day</option>{profiles.map(t => <option key={t.employeeKey} value={t.employeeKey}>{t.name}</option>)}</select></Field>
        </div>
        <div>
          <div className="text-xs font-medium text-slate-600 mb-1">Assessment criteria</div>
          {criteria.map((c, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <input aria-label={`Criterion ${i + 1} name`} className={inputCls} placeholder="Criterion, e.g. Quiz" value={c.name} maxLength={120} onChange={e => setCriteria(criteria.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input aria-label={`Criterion ${i + 1} maximum score`} className={`${inputCls} !w-24`} inputMode="decimal" placeholder="Max" value={c.max} onChange={e => setCriteria(criteria.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
              <button type="button" className={btn.secondary} onClick={() => setCriteria(criteria.filter((_, j) => j !== i))} aria-label={`Remove criterion ${i + 1}`}>×</button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btn.secondary} onClick={() => setCriteria([...criteria, { name: '', max: '10' }])}><Plus className="w-3.5 h-3.5" /> Add criterion</button>
            <label className="text-xs text-slate-600 flex items-center gap-1.5">Pass mark % <input aria-label="Pass mark percent" className={`${inputCls} !w-20`} inputMode="numeric" value={pass} onChange={e => setPass(e.target.value)} /></label>
          </div>
        </div>
        {msg && (msg.ok ? <p role="status" className="text-xs text-emerald-700">{msg.text}</p> : <ErrorBanner message={msg.text} />)}
        <div className="flex justify-end"><button type="submit" className={btn.secondary} disabled={busy}>{busy ? 'Saving…' : `Save Day ${day.dayNo}`}</button></div>
      </form>
    </Card>
  );
};

const ProgramView: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const [p, setP] = useState<TrainingProgramDetail | null>(null);
  const [employees, setEmployees] = useState<TrainingEmployee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [enroll, setEnroll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setError(null); setP(await trainingApi.program(id)); } catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { trainingApi.employees().then(setEmployees, () => undefined); }, []);
  const cancel = async () => {
    if (!p) return;
    try { await trainingApi.cancelProgram(p.id, !p.isCancelled); await load(); } catch (e) { setError(errText(e)); }
  };
  return (
    <section className="space-y-5" aria-label="Training program">
      <button type="button" className={btn.secondary} onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" /> All programs</button>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!p && !error && <Spinner />}
      {p && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-extrabold text-slate-900">{p.name}</h2>
                <p className="text-sm text-slate-600 mt-0.5">{fmtDay(p.startDate)} – {fmtDay(p.endDate)}{p.owner ? ` · Responsible: ${p.owner}` : ''}</p>
                {p.description && <p className="text-sm text-slate-500 mt-1 max-w-2xl">{p.description}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2"><Pill tone={PHASE[p.phase].tone}>{PHASE[p.phase].label}</Pill>
                <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>Edit / reschedule</button>
                <button type="button" className={p.isCancelled ? btn.secondary : btn.danger} onClick={() => void cancel()}>{p.isCancelled ? 'Reopen program' : 'Cancel program'}</button></div>
            </div>
          </Card>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 mb-2">The three days</h3>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">{p.days.map(d => <DayConfig key={d.dayNo} programId={p.id} day={d} trainers={employees} onSaved={() => void load()} />)}</div>
          </div>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-slate-900">Employees ({p.enrollments.length})</h3>
              <button type="button" className={btn.primary} onClick={() => setEnroll(true)} disabled={p.isCancelled}><Plus className="w-3.5 h-3.5" /> Enrol employees</button>
            </div>
            {p.enrollments.length === 0 ? <p className="p-8 text-center text-xs text-slate-500">Nobody is enrolled yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs min-w-[44rem]">
                <thead className="bg-slate-50 text-slate-500 text-left"><tr><th scope="col" className="px-4 py-2.5 font-semibold">Employee</th><th scope="col" className="px-3 py-2.5 font-semibold">Department</th><th scope="col" className="px-3 py-2.5 font-semibold">Days</th><th scope="col" className="px-3 py-2.5 font-semibold">Status</th><th scope="col" className="px-3 py-2.5"><span className="sr-only">Open</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">{p.enrollments.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="font-bold text-slate-900">{r.employeeName}</div><div className="text-[11px] text-slate-500">{[r.employeeCode, r.designation].filter(Boolean).join(' · ')}</div></td>
                    <td className="px-3 py-3 text-slate-700">{r.department ?? '–'}</td>
                    <td className="px-3 py-3"><DayChips days={r.days} /></td>
                    <td className="px-3 py-3"><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill></td>
                    <td className="px-3 py-3 text-right"><button type="button" className="text-xs font-bold text-indigo-700 hover:underline" onClick={() => setOpen(r.id)} aria-label={`Open the record of ${r.employeeName}`}>Open record</button></td>
                  </tr>))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
      {edit && p && <ProgramDialog program={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); }} />}
      {enroll && p && <EnrollDialog program={p} employees={employees} onClose={() => setEnroll(false)} onDone={() => { setEnroll(false); void load(); }} />}
      {open && <EnrollmentDialog id={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </section>
  );
};

const EnrollDialog: React.FC<{ program: TrainingProgramDetail; employees: TrainingEmployee[]; onClose: () => void; onDone: () => void }> = ({ program, employees, onClose, onDone }) => {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enrolled = useMemo(() => new Set(program.enrollments.map(e => e.employeeKey)), [program]);
  const shown = employees.filter(e => !enrolled.has(e.employeeKey) && (!q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase())));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await trainingApi.enroll(program.id, [...picked]); onDone(); } catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Dialog title="Enrol employees" description={`They join “${program.name}”. Their earlier trainings stay in their record.`} onClose={() => !busy && onClose()}>
      <div className="space-y-3">
        <input className={inputCls} placeholder="Search employees" aria-label="Search employees" value={q} onChange={e => setQ(e.target.value)} />
        <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
          {shown.length === 0 ? <li className="p-4 text-xs text-slate-500">No employee to enrol.</li> : shown.map(e => (
            <li key={e.employeeKey}><label className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
              <input type="checkbox" checked={picked.has(e.employeeKey)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(e.employeeKey)) n.delete(e.employeeKey); else n.add(e.employeeKey); return n; })} />
              <span className="flex-1 min-w-0"><span className="font-semibold text-slate-900">{e.name}</span> <span className="text-xs text-slate-500">{[e.designation, e.department].filter(Boolean).join(' · ')}</span></span></label></li>
          ))}
        </ul>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={btn.primary} onClick={() => void submit()} disabled={busy || picked.size === 0}>{busy ? 'Enrolling…' : `Enrol ${picked.size || ''}`.trim()}</button></div>
      </div>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
interface DayForm { attendance: TrainingAttendance | ''; topics: Set<string>; tasks: { title: string; done: boolean }[]; scores: Record<string, string>; feedback: string; remarks: string; report: string }
const formFrom = (d: TrainingEnrollmentDetail, day: number): DayForm => {
  const r = d.reports.find(x => x.dayNo === day);
  return {
    attendance: r?.attendance ?? '', topics: new Set(r?.topicsCompleted ?? []), tasks: r?.tasks ?? [],
    scores: Object.fromEntries((r?.scores ?? []).map(s => [s.criterion, String(s.score)])), feedback: r?.feedback ?? '', remarks: r?.trainerRemarks ?? '', report: r?.report ?? ''
  };
};

const EnrollmentDialog: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const [d, setD] = useState<TrainingEnrollmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setError(null); setD(await trainingApi.enrollment(id)); } catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const changed = () => { onChanged(); void load(); };
  return (
    <Dialog title={d ? d.employeeName : 'Training record'} description={d ? `${[d.employeeCode, d.designation, d.department].filter(Boolean).join(' · ')} · ${d.program} (${fmtDay(d.startDate)} – ${fmtDay(d.endDate)})` : undefined} onClose={onClose} wide>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!d && !error && <Spinner />}
      {d && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3"><Pill tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Pill><DayChips days={d.days} />
            <span className="text-xs text-slate-500">{d.preview.daysCompleted} of 3 days complete · assessment {d.preview.assessmentPercent === null ? 'Insufficient data' : `${d.preview.assessmentPercent}%`}</span></div>
          {[1, 2, 3].map(n => <DayReportForm key={n} d={d} day={n} onSaved={changed} />)}
          <ReviewForm d={d} onSaved={changed} />
          {d.consolidated && (
            <section aria-label="Consolidated report" className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
              <h3 className="text-sm font-extrabold text-slate-900">Consolidated report</h3>
              <p className="text-xs text-slate-500">Made {d.consolidatedAt ? new Date(d.consolidatedAt).toLocaleString('en-IN') : ''} from the three day reports.</p>
              <ul className="text-xs text-slate-700 space-y-1">
                {d.consolidated.days.map(x => <li key={x.day}><b>Day {x.day}</b>: {x.attendance ? ATTENDANCE[x.attendance] : 'no attendance recorded'}; topics {x.topicsCompleted}/{x.topicsPlanned}; tasks {x.tasksDone}/{x.tasksTotal}; assessment {x.assessmentPercent === null ? 'Insufficient data' : `${x.assessmentPercent}% (${x.assessmentResult})`}</li>)}
              </ul>
              {d.consolidated.missing.length > 0 && <p className="text-xs text-amber-800"><b>Missing:</b> {d.consolidated.missing.join('; ')}</p>}
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
};

const DayReportForm: React.FC<{ d: TrainingEnrollmentDetail; day: number; onSaved: () => void }> = ({ d, day, onSaved }) => {
  const cfg = d.programConfig.days.find(x => x.dayNo === day)!;
  const status = d.days.find(x => x.dayNo === day)!;
  const [f, setF] = useState<DayForm>(() => formFrom(d, day));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const can = d.canReport[String(day) as '1' | '2' | '3'];
  const future = status.date > new Date().toISOString().slice(0, 10);
  const absent = f.attendance === 'ABSENT' || f.attendance === 'EXCUSED';
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await trainingApi.saveReport(d.id, day, {
        attendance: f.attendance || null, topicsCompleted: [...f.topics], tasks: f.tasks.filter(t => t.title.trim()),
        scores: cfg.criteria.filter(c => f.scores[c.name] !== undefined && f.scores[c.name] !== '').map(c => ({ criterion: c.name, score: Number(f.scores[c.name]) })),
        feedback: f.feedback || null, trainerRemarks: f.remarks || null, report: f.report || null
      });
      setMsg({ ok: true, text: res.completed ? 'Saved. Day complete.' : 'Saved. The day is not complete yet: it needs attendance and something recorded' + (day === 3 ? ', and the assessment.' : '.') });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={DAY_NAME[day]} className="rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">{DAY_NAME[day]}</h3>
        <span className="text-xs text-slate-500 flex items-center gap-2">{fmtDay(status.date)}{cfg.trainerName ? ` · Trainer: ${cfg.trainerName}` : ''}{status.completed ? <Pill tone="green">Complete</Pill> : status.overdue && !status.attendance ? <Pill tone="red">Not reported</Pill> : null}</span>
      </div>
      {future && <p className="text-xs text-slate-500">This day takes place on {fmtDay(status.date)}. It can be reported once it has taken place.</p>}
      {!can && <p className="text-xs text-amber-800">Only HR staff or this day's trainer can record this report.</p>}
      <form onSubmit={save} className="space-y-3" noValidate>
        <fieldset disabled={!can || future || busy} className="space-y-3">
          <Field label="Attendance" htmlFor={`att-${day}`}>
            <select id={`att-${day}`} className={`${inputCls} sm:max-w-xs`} value={f.attendance} onChange={e => setF({ ...f, attendance: e.target.value as TrainingAttendance | '' })}>
              <option value="">Not recorded</option>{(Object.keys(ATTENDANCE) as TrainingAttendance[]).map(a => <option key={a} value={a}>{ATTENDANCE[a]}</option>)}</select></Field>
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Topics covered</div>
            {cfg.topics.length === 0 ? <p className="text-xs text-slate-500">No topics are configured for this day (set them in the program).</p> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">{cfg.topics.map(t => (
                <label key={t} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={absent} checked={f.topics.has(t)} onChange={() => setF(s => { const n = new Set(s.topics); if (n.has(t)) n.delete(t); else n.add(t); return { ...s, topics: n }; })} /> {t}</label>))}</div>)}
          </div>
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Tasks and activities</div>
            {f.tasks.map((t, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <input type="checkbox" aria-label={`Task ${i + 1} done`} disabled={absent} checked={t.done} onChange={e => setF({ ...f, tasks: f.tasks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
                <input aria-label={`Task ${i + 1}`} className={inputCls} value={t.title} maxLength={200} onChange={e => setF({ ...f, tasks: f.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <button type="button" className={btn.secondary} onClick={() => setF({ ...f, tasks: f.tasks.filter((_, j) => j !== i) })} aria-label={`Remove task ${i + 1}`}>×</button>
              </div>))}
            <button type="button" className={btn.secondary} onClick={() => setF({ ...f, tasks: [...f.tasks, { title: '', done: false }] })}><Plus className="w-3.5 h-3.5" /> Add task</button>
          </div>
          {cfg.criteria.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">Assessment{cfg.passPercent ? ` (pass mark ${cfg.passPercent}%)` : ''}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{cfg.criteria.map(c => (
                <label key={c.name} className="flex items-center justify-between gap-2 text-sm">{c.name} <span className="flex items-center gap-1.5"><input aria-label={`Score for ${c.name}`} className={`${inputCls} !w-20`} inputMode="decimal" disabled={absent} value={f.scores[c.name] ?? ''} onChange={e => setF({ ...f, scores: { ...f.scores, [c.name]: e.target.value } })} /><span className="text-xs text-slate-500">/ {c.max}</span></span></label>))}</div>
            </div>
          )}
          <Field label="Feedback" htmlFor={`fb-${day}`}><textarea id={`fb-${day}`} rows={2} className={inputCls} maxLength={2000} value={f.feedback} onChange={e => setF({ ...f, feedback: e.target.value })} /></Field>
          <Field label="Trainer remarks" htmlFor={`tr-${day}`}><textarea id={`tr-${day}`} rows={2} className={inputCls} maxLength={2000} value={f.remarks} onChange={e => setF({ ...f, remarks: e.target.value })} /></Field>
          <Field label={`Day ${day} report`} htmlFor={`rp-${day}`}><textarea id={`rp-${day}`} rows={2} className={inputCls} maxLength={4000} value={f.report} onChange={e => setF({ ...f, report: e.target.value })} /></Field>
        </fieldset>
        {msg && (msg.ok ? <p role="status" className="text-xs text-emerald-700">{msg.text}</p> : <ErrorBanner message={msg.text} />)}
        {can && !future && <div className="flex justify-end"><button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Saving…' : `Save Day ${day} report`}</button></div>}
      </form>
    </section>
  );
};

const ReviewForm: React.FC<{ d: TrainingEnrollmentDetail; onSaved: () => void }> = ({ d, onSaved }) => {
  const [s, setS] = useState({ strengths: d.strengths ?? '', improvements: d.improvements ?? '', remarks: d.trainerRemarks ?? '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try { await trainingApi.review(d.id, { strengths: s.strengths || null, improvements: s.improvements || null, trainerRemarks: s.remarks || null }); setMsg({ ok: true, text: 'Saved.' }); onSaved(); }
    catch (err) { setMsg({ ok: false, text: errText(err) }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 p-4" aria-label="Overall review" noValidate>
      <h3 className="text-sm font-extrabold text-slate-900">Overall review</h3>
      <Field label="Strengths" htmlFor="rv-s"><textarea id="rv-s" rows={2} className={inputCls} maxLength={2000} value={s.strengths} onChange={e => setS({ ...s, strengths: e.target.value })} /></Field>
      <Field label="Areas needing improvement" htmlFor="rv-i"><textarea id="rv-i" rows={2} className={inputCls} maxLength={2000} value={s.improvements} onChange={e => setS({ ...s, improvements: e.target.value })} /></Field>
      <Field label="Trainer remarks" htmlFor="rv-r"><textarea id="rv-r" rows={2} className={inputCls} maxLength={2000} value={s.remarks} onChange={e => setS({ ...s, remarks: e.target.value })} /></Field>
      {msg && (msg.ok ? <p role="status" className="text-xs text-emerald-700">{msg.text}</p> : <ErrorBanner message={msg.text} />)}
      <div className="flex justify-end"><button type="submit" className={btn.secondary} disabled={busy}>{busy ? 'Saving…' : 'Save review'}</button></div>
    </form>
  );
};
