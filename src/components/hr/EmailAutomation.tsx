import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Cake, CalendarCheck, CheckCircle2, ChevronDown, Mail, PartyPopper, PlayCircle, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { hrApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { fmtDay } from '../../lib/support';
import type { HrAutomationCard, HrDataIssue, HrEmailCards, HrEmailDataIssue, HrEmailHistory, HrEmailKind, HrEmailOverview, HrEmailStatus, HrProbationCycle } from '../../../shared/contracts';
import { btn, Card, ErrorBanner, inputCls, Pill, selectCls, Spinner, type Tone } from '../team-member/pipeline/shared';

/**
 * HR dashboard > Email Automation. Watches the automatic e-mails (birthday, work anniversary, probation reminders, employment
 * confirmation): whether sending is on, the upcoming confirmations (HR / the Department Head approve them here - nothing is
 * confirmed automatically), the e-mail history with failures and retries, and the employees whose dates are missing.
 * Loaded when the page opens and after each action; there is no polling.
 */
const KIND_LABEL: Record<HrEmailKind, string> = {
  BIRTHDAY: 'Birthday greeting',
  ANNIVERSARY: 'Work anniversary',
  PROBATION_REMINDER_EMPLOYEE: 'Probation reminder (employee)',
  PROBATION_REMINDER_HR: 'Probation reminder (HR)',
  PROBATION_OVERDUE_HR: 'Confirmation overdue (HR)',
  CONFIRMATION_EMPLOYEE: 'Confirmation (employee)',
  CONFIRMATION_HR: 'Confirmation notice (HR)'
};
const STATUS_TONE: Record<HrEmailStatus, Tone> = { SENT: 'green', PENDING: 'indigo', SENDING: 'indigo', RETRY: 'orange', FAILED: 'red', SKIPPED: 'slate', DRY_RUN: 'slate' };
const STATUS_LABEL: Record<HrEmailStatus, string> = { SENT: 'Sent', PENDING: 'Pending', SENDING: 'Sending', RETRY: 'Will retry', FAILED: 'Failed', SKIPPED: 'Skipped', DRY_RUN: 'Not sent (dry run)' };
const ISSUE_LABEL: Record<HrDataIssue, string> = {
  NO_VALID_EMAIL: 'No valid e-mail',
  NO_DATE_OF_BIRTH: 'No date of birth',
  NO_JOINING_DATE: 'No joining date',
  JOINING_DATE_IN_THE_FUTURE: 'Joining date is in the future'
};
const MODE_TEXT = {
  live: { tone: 'green' as Tone, label: 'Sending e-mails', detail: 'Automatic e-mails are sent to employees and HR.' },
  dry_run: { tone: 'orange' as Tone, label: 'Dry run', detail: 'E-mails are prepared and logged but NOT sent. Set AUTOMATION_MODE=live on the server to send them.' },
  off: { tone: 'red' as Tone, label: 'Off', detail: 'Nothing is prepared or sent (AUTOMATION_MODE=off).' }
};

type Tab = 'confirmations' | 'history' | 'upcoming' | 'data';
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; alert?: boolean }> = ({ label, value, hint, alert }) => (
  <Card className={`p-4 ${alert ? 'border-rose-200 bg-rose-50/40' : ''}`}>
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 text-2xl font-extrabold ${alert ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div>
    {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
  </Card>
);


const nine = (d: string) => `${fmtDay(d)}, 9:00 AM`;
const names = (n: { names: string[] }) => `${n.names.slice(0, 2).join(', ')}${n.names.length > 2 ? ` +${n.names.length - 2} more` : ''}`;

/** One automation: is it on, how many e-mails went out, what happens next, what the last run did and what the e-mail says. */
const AutomationCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  what: string;
  cards: HrEmailCards;
  data: HrAutomationCard;
  next: string;
  templates: HrEmailCards['templates'][keyof HrEmailCards['templates']];
  children?: React.ReactNode;
}> = ({ icon, title, what, cards, data, next, templates, children }) => {
  const [open, setOpen] = useState(false);
  const mode = cards.settings.mode;
  const status = mode === 'live' ? { tone: 'green' as Tone, text: 'Active' } : mode === 'dry_run' ? { tone: 'orange' as Tone, text: 'Active (dry run, not sending)' } : { tone: 'red' as Tone, text: 'Inactive' };
  return (
    <Card className="p-4"><section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-indigo-600">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">{what}</p>
          <div className="mt-1.5"><Pill tone={status.tone}>{status.text}</Pill></div>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 py-2"><dd className="text-lg font-extrabold text-slate-900">{data.sent}</dd><dt className="text-[10px] uppercase tracking-wide text-slate-500">Sent</dt></div>
        <div className="rounded-lg bg-slate-50 py-2"><dd className="text-lg font-extrabold text-slate-900">{data.waiting}</dd><dt className="text-[10px] uppercase tracking-wide text-slate-500">Waiting</dt></div>
        <div className={`rounded-lg py-2 ${data.failed ? 'bg-rose-50' : 'bg-slate-50'}`}><dd className={`text-lg font-extrabold ${data.failed ? 'text-rose-700' : 'text-slate-900'}`}>{data.failed}</dd><dt className="text-[10px] uppercase tracking-wide text-slate-500">Failed</dt></div>
      </dl>
      <div className="text-xs space-y-1.5">
        <div><span className="font-semibold text-slate-700">Next execution: </span><span className="text-slate-600">{mode === 'off' ? 'Paused (automation is off)' : next}</span></div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-slate-700">Last execution: </span>
          {data.last ? (
            <>
              <Pill tone={STATUS_TONE[data.last.status]}>{STATUS_LABEL[data.last.status]}</Pill>
              <span className="text-slate-500">{when(data.last.at)}</span>
              {data.last.error && <span className="basis-full text-[11px] text-rose-700">{data.last.error}</span>}
            </>
          ) : <span className="text-slate-500">Nothing has run yet</span>}
        </div>
      </div>
      {children}
      <div>
        <button type="button" className="text-xs font-bold text-indigo-700 inline-flex items-center gap-1" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" /> {open ? 'Hide' : 'Preview'} e-mail template
        </button>
        {open && (
          <div className="mt-2 space-y-3">
            {templates.map(t => (
              <div key={t.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t.label} · to {t.to.toLowerCase()} · sample data</div>
                <div className="mt-1 text-xs font-bold text-slate-900 break-words">{t.subject}</div>
                <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-slate-700">{t.text}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
      </section>
    </Card>
  );
};

const AutomationCards: React.FC<{ cards: HrEmailCards }> = ({ cards }) => {
  const nextConfirmation = cards.confirmation.upcoming.find(u => !u.reminderSent);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start" role="group" aria-label="The three automations">
      <AutomationCard
        icon={<Cake className="w-5 h-5" aria-hidden="true" />} title="Birthday Emails" what="On the employee's birthday, at 9:00 AM." cards={cards} data={cards.birthday}
        next={cards.birthday.next ? `${nine(cards.birthday.next.date)} · ${names(cards.birthday.next)}` : 'No birthday on record'} templates={cards.templates.BIRTHDAY}
      />
      <AutomationCard
        icon={<PartyPopper className="w-5 h-5" aria-hidden="true" />} title="Work Anniversary Emails" what="On each work anniversary (from the joining date), at 9:00 AM." cards={cards} data={cards.anniversary}
        next={cards.anniversary.next ? `${nine(cards.anniversary.next.date)} · ${names(cards.anniversary.next)}` : 'No anniversary coming up'} templates={cards.templates.ANNIVERSARY}
      />
      <AutomationCard
        icon={<CalendarCheck className="w-5 h-5" aria-hidden="true" />} title="Employee Confirmation Reminders" what="Seven days before the six-month confirmation date: to the employee and to HR." cards={cards} data={cards.confirmation}
        next={nextConfirmation ? `${nine(nextConfirmation.reminderDate < cards.today ? cards.today : nextConfirmation.reminderDate)} · ${nextConfirmation.name} (confirmation due ${fmtDay(nextConfirmation.confirmationDate)})` : 'No confirmation is coming up'}
        templates={cards.templates.CONFIRMATION}
      >
        <div className="text-xs">
          <div className="font-semibold text-slate-700 mb-1">Upcoming confirmation reminders</div>
          {cards.confirmation.upcoming.length === 0 ? <p className="text-slate-500">None right now.</p> : (
            <ul className="space-y-1">
              {cards.confirmation.upcoming.slice(0, 5).map(u => (
                <li key={`${u.name}-${u.confirmationDate}`} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1">
                  <span className="truncate text-slate-800">{u.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-500">{u.reminderSent ? 'Reminder sent' : `Reminder ${fmtDay(u.reminderDate)}`} · due {fmtDay(u.confirmationDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AutomationCard>
    </div>
  );
};

export const EmailAutomation: React.FC = () => {
  const [overview, setOverview] = useState<HrEmailOverview | null>(null);
  const [cycles, setCycles] = useState<HrProbationCycle[] | null>(null);
  const [issues, setIssues] = useState<HrEmailDataIssue[] | null>(null);
  const [history, setHistory] = useState<HrEmailHistory | null>(null);
  const [cards, setCards] = useState<HrEmailCards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('confirmations');
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<HrEmailStatus | ''>('');
  const [kindFilter, setKindFilter] = useState<HrEmailKind | ''>('');
  const [offset, setOffset] = useState(0);
  const PAGE = 25;

  const loadHistory = useCallback(
    () =>
      hrApi.emailHistory({ status: statusFilter || undefined, kind: kindFilter || undefined, limit: PAGE, offset }).then(
        h => setHistory(h),
        e => setError(errText(e, 'Could not load the e-mail history.'))
      ),
    [statusFilter, kindFilter, offset]
  );

  // Each section loads on its own: one that fails shows its own message and does not blank the others.
  const loadAll = useCallback(async () => {
    setError(null);
    const parts = await Promise.allSettled([hrApi.emailOverview(), hrApi.probation(), hrApi.emailDataIssues(), hrApi.emailCards()]);
    const [o, c, i, k] = parts;
    const failed: string[] = [];
    if (o.status === 'fulfilled') setOverview(o.value); else failed.push(`the summary (${errText(o.reason, 'failed')})`);
    if (c.status === 'fulfilled') setCycles(c.value); else failed.push(`the confirmations (${errText(c.reason, 'failed')})`);
    if (i.status === 'fulfilled') setIssues(i.value); else { setIssues(prev => prev ?? []); failed.push(`the dates to fix (${errText(i.reason, 'failed')})`); }
    if (k.status === 'fulfilled') setCards(k.value); else failed.push(`the automation cards (${errText(k.reason, 'failed')})`);
    if (failed.length) setError(`Could not load ${failed.join('; ')}.`);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const refresh = async () => { await Promise.all([loadAll(), loadHistory()]); };
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await refresh();
    } catch (e) {
      setError(errText(e, 'That did not work. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  if (!overview && !error) return <Spinner label="Loading e-mail automation…" />;
  const mode = overview ? MODE_TEXT[overview.settings.mode] : null;
  const pending = (cycles || []).filter(c => c.status === 'PENDING');
  const sent30 = overview?.last30Days.SENT ?? 0;
  const failedCount = overview?.queue.failed ?? 0;

  const tabBtn = (t: Tab, label: string, count?: number) => (
    <button
      key={t}
      type="button"
      onClick={() => setTab(t)}
      aria-current={tab === t ? 'page' : undefined}
      className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {label}{count ? <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${tab === t ? 'bg-white/25' : 'bg-slate-200 text-slate-700'}`}>{count}</span> : null}
    </button>
  );

  return (
    <section className="space-y-5" aria-label="Email automation">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><Mail className="w-5 h-5 text-indigo-600" /> Email Automation</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Birthday and work anniversary greetings, probation reminders and employment confirmation e-mails. They are prepared every morning from the
            employee records; nothing is confirmed automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={() => void refresh()} disabled={!!busy}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          <button type="button" className={btn.primary} disabled={!!busy || overview?.settings.mode === 'off'}
            onClick={() => void act('run', () => hrApi.runEmailAutomation(), 'The check ran. Anything due today has been prepared (and sent, if sending is on).')}>
            <PlayCircle className="w-3.5 h-3.5" /> {busy === 'run' ? 'Running…' : 'Run the check now'}
          </button>
        </div>
      </header>

      {error && <ErrorBanner message={error} onRetry={() => void refresh()} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {notice}</div>}

      {overview && mode && (
        <>
          <Card className="p-4 flex flex-wrap items-center gap-3">
            <Pill tone={mode.tone}>{mode.label}</Pill>
            <span className="text-xs text-slate-600 flex-1 min-w-[16rem]">{mode.detail}</span>
            {overview.settings.mode === 'live' && !overview.settings.emailConfigured && (
              <span className="text-xs font-semibold text-rose-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> The e-mail service is not set up on the server, so messages wait in the queue.</span>
            )}
            {overview.settings.testMode && <Pill tone="orange">Test mode: only test addresses are e-mailed</Pill>}
            <span className="text-[11px] text-slate-500">
              {overview.lastRun ? `Last check: ${when(overview.lastRun.ranAt)}` : 'The daily check has not run yet.'}
            </span>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Sent (30 days)" value={sent30} hint={`${overview.queue.pending} waiting to be sent`} />
            <Stat label="Failed" value={failedCount} hint={overview.queue.retrying ? `${overview.queue.retrying} will retry` : 'none waiting to retry'} alert={failedCount > 0} />
            <Stat label="Confirmations due" value={overview.confirmations.pending} hint={`${overview.confirmations.dueWithin7Days} within 7 days`} />
            <Stat label="Overdue confirmations" value={overview.confirmations.overdue} hint="need HR action" alert={overview.confirmations.overdue > 0} />
          </div>
        </>
      )}

      {cards && <AutomationCards cards={cards} />}

      <div className="flex flex-wrap gap-1 p-1 bg-slate-50 border border-slate-200 rounded-xl w-fit" role="tablist" aria-label="Email automation sections">
        {tabBtn('confirmations', 'Probation confirmations', pending.length)}
        {tabBtn('history', 'Email history')}
        {tabBtn('upcoming', 'Upcoming', overview?.upcoming.length)}
        {tabBtn('data', 'Dates to fix', issues?.length)}
      </div>

      {tab === 'confirmations' && (
        <ConfirmationsTab cycles={cycles} busy={busy} act={act} />
      )}

      {tab === 'history' && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
            <select aria-label="Filter by status" className={selectCls} value={statusFilter} onChange={e => { setStatusFilter(e.target.value as HrEmailStatus | ''); setOffset(0); }}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as HrEmailStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <select aria-label="Filter by type" className={selectCls} value={kindFilter} onChange={e => { setKindFilter(e.target.value as HrEmailKind | ''); setOffset(0); }}>
              <option value="">All types</option>
              {(Object.keys(KIND_LABEL) as HrEmailKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <span className="text-[11px] text-slate-500 ml-auto">{history ? `${history.total} e-mail${history.total === 1 ? '' : 's'}` : ''}</span>
          </div>
          {!history ? <Spinner /> : history.items.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-500">No e-mails yet. They appear here as soon as one is prepared.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">E-mail</th><th className="px-3 py-2 font-semibold">To</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">Details</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.items.map(i => (
                    <tr key={i.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDay(i.eventDate)}</td>
                      <td className="px-3 py-2"><div className="font-semibold text-slate-800">{KIND_LABEL[i.kind]}</div><div className="text-slate-500">{i.employeeName}</div></td>
                      <td className="px-3 py-2 text-slate-600">{i.recipientName && i.recipientName !== i.recipientEmail ? <div>{i.recipientName}</div> : null}<div className="text-slate-500 break-all">{i.recipientEmail || '–'}</div></td>
                      <td className="px-3 py-2"><Pill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Pill></td>
                      <td className="px-3 py-2 text-slate-600 max-w-xs">
                        {i.status === 'SENT' ? `Sent ${when(i.sentAt)}` : i.error ? <span className="text-rose-700">{i.error}</span> : i.status === 'RETRY' ? `Next try ${when(i.nextAttemptAt)}` : i.status === 'PENDING' ? `Due ${when(i.sendAfter)}` : ''}
                        {i.attempts > 1 ? <div className="text-[11px] text-slate-400">{i.attempts} attempts</div> : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {i.status === 'FAILED' && (
                          <button type="button" className={btn.secondary} disabled={busy === i.id} onClick={() => void act(i.id, () => hrApi.retryEmail(i.id), 'The e-mail will be sent again.')}>
                            <RotateCcw className="w-3.5 h-3.5" /> Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {history && history.total > PAGE && (
            <div className="flex items-center justify-between p-3 border-t border-slate-100 text-xs">
              <button type="button" className={btn.secondary} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <span className="text-slate-500">{offset + 1}–{Math.min(offset + PAGE, history.total)} of {history.total}</span>
              <button type="button" className={btn.secondary} disabled={offset + PAGE >= history.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          )}
        </Card>
      )}

      {tab === 'upcoming' && (
        <Card className="overflow-hidden">
          {overview && overview.upcoming.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-500">No birthdays or work anniversaries in the next 14 days.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(overview?.upcoming || []).map((u, i) => (
                <li key={`${u.kind}-${u.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  <span className="w-28 text-slate-600">{fmtDay(u.date)}</span>
                  <span className="font-semibold text-slate-800 flex-1">{u.name}</span>
                  <Pill tone={u.kind === 'BIRTHDAY' ? 'indigo' : 'green'}>{u.kind === 'BIRTHDAY' ? 'Birthday' : `Work anniversary · ${u.years} year${u.years === 1 ? '' : 's'}`}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'data' && <DataIssuesTab issues={issues} busy={busy} act={act} />}
    </section>
  );
};

// ---------------------------------------------------------------------------------------------------------------------
type Act = (key: string, fn: () => Promise<unknown>, done: string) => Promise<void>;

const ConfirmationsTab: React.FC<{ cycles: HrProbationCycle[] | null; busy: string | null; act: Act }> = ({ cycles, busy, act }) => {
  const [open, setOpen] = useState<{ id: string; mode: 'approve' | 'close' } | null>(null);
  const [effective, setEffective] = useState('');
  const [note, setNote] = useState('');
  if (!cycles) return <Spinner />;
  const rows = cycles;
  if (!rows.length) {
    return <Card className="p-8 text-center text-xs text-slate-500">No probation confirmations right now. They appear here for employees who joined in the last six months.</Card>;
  }
  const dueText = (c: HrProbationCycle) =>
    c.daysLeft > 1 ? `in ${c.daysLeft} days` : c.daysLeft === 1 ? 'tomorrow' : c.daysLeft === 0 ? 'today' : `${-c.daysLeft} day${c.daysLeft === -1 ? '' : 's'} overdue`;
  const start = (c: HrProbationCycle, mode: 'approve' | 'close') => { setOpen({ id: c.id, mode }); setEffective(c.probationEnd); setNote(''); };

  return (
    <Card className="overflow-hidden">
      <p className="px-4 py-3 text-[11px] text-slate-500 border-b border-slate-100">
        Probation is six months from the joining date. A reminder goes to the employee and HR seven days before it ends. The employee is confirmed only when
        HR (the HR lead), their Department Head or the Super Admin approves it here; the confirmation e-mails are sent after that approval.
      </p>
      <ul className="divide-y divide-slate-100">
        {rows.map(c => (
          <li key={c.id} className="px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[12rem] flex-1">
                <div className="font-bold text-slate-900 text-sm">{c.employeeName}</div>
                <div className="text-slate-500">{c.employeeCode}{c.department ? ` · ${c.department}` : ''}</div>
              </div>
              <div className="text-slate-600 w-28"><div className="text-[11px] text-slate-400">Joined</div>{fmtDay(c.joiningDate)}</div>
              <div className="text-slate-600 w-48"><div className="text-[11px] text-slate-400">Probation ends</div>{fmtDay(c.probationEnd)}{c.status === 'PENDING' && <span className={`ml-1.5 font-semibold ${c.daysLeft < 0 ? 'text-rose-700' : c.daysLeft <= 7 ? 'text-orange-700' : 'text-slate-500'}`}>({dueText(c)})</span>}</div>
              <div className="w-44">
                {c.status === 'PENDING' ? <Pill tone={c.daysLeft < 0 ? 'red' : c.daysLeft <= 7 ? 'orange' : 'indigo'}>{c.daysLeft < 0 ? 'Overdue' : 'Confirmation due'}</Pill>
                  : c.status === 'APPROVED' ? <Pill tone="green">Confirmed {c.effectiveDate ? `· ${fmtDay(c.effectiveDate)}` : ''}</Pill> : <Pill tone="slate">Closed</Pill>}
                {c.status !== 'PENDING' && <div className="text-[11px] text-slate-400 mt-0.5">{c.approvedBy ? `${c.approvedBy}, ` : ''}{c.approvedAt ? when(c.approvedAt) : ''}</div>}
              </div>
              {c.status === 'PENDING' && (
                <div className="flex gap-2">
                  {c.canDecide ? (
                    <>
                      <button type="button" className={btn.green} onClick={() => start(c, 'approve')}><CheckCircle2 className="w-3.5 h-3.5" /> Approve confirmation</button>
                      <button type="button" className={btn.secondary} onClick={() => start(c, 'close')}><XCircle className="w-3.5 h-3.5" /> Close</button>
                    </>
                  ) : <span className="text-[11px] text-slate-400">Approved by the HR lead or the Department Head</span>}
                </div>
              )}
            </div>
            {c.note && c.status !== 'PENDING' && <div className="mt-1 text-[11px] text-slate-500">Note: {c.note}</div>}
            {open?.id === c.id && (
              <form
                className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 grid gap-3 sm:grid-cols-[auto_1fr_auto] items-end"
                onSubmit={e => {
                  e.preventDefault();
                  const run = open.mode === 'approve'
                    ? () => hrApi.confirmProbation(c.id, { effectiveDate: effective || undefined, note: note.trim() || undefined })
                    : () => hrApi.dismissProbation(c.id, note.trim());
                  void act(c.id, run, open.mode === 'approve'
                    ? `${c.employeeName} is confirmed. The confirmation e-mails are sent to the employee and HR${c.daysLeft > 0 ? ` on ${fmtDay(c.probationEnd)}` : ''}.`
                    : `${c.employeeName}'s confirmation was closed without e-mails.`).then(() => setOpen(null));
                }}
              >
                {open.mode === 'approve' && (
                  <label className="text-[11px] font-semibold text-slate-600">Effective date
                    <input type="date" className={`${inputCls} mt-1`} value={effective} min={c.joiningDate} onChange={e => setEffective(e.target.value)} required />
                  </label>
                )}
                <label className="text-[11px] font-semibold text-slate-600">{open.mode === 'approve' ? 'Note (optional)' : 'Reason (required)'}
                  <input className={`${inputCls} mt-1`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} required={open.mode === 'close'} minLength={open.mode === 'close' ? 3 : undefined}
                    placeholder={open.mode === 'approve' ? 'e.g. reviewed with the Department Head' : 'e.g. confirmed earlier, on paper'} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className={open.mode === 'approve' ? btn.green : btn.primary} disabled={busy === c.id}>{open.mode === 'approve' ? 'Confirm employee' : 'Close it'}</button>
                  <button type="button" className={btn.secondary} onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
};

const DataIssuesTab: React.FC<{ issues: HrEmailDataIssue[] | null; busy: string | null; act: Act }> = ({ issues, busy, act }) => {
  const [dates, setDates] = useState<Record<string, { dob?: string; joining?: string }>>({});
  if (!issues) return <Spinner />;
  if (!issues.length) {
    return <Card className="p-8 text-center text-xs text-emerald-700"><CheckCircle2 className="w-5 h-5 mx-auto mb-1" /> Every active employee has an e-mail address, a date of birth and a joining date.</Card>;
  }
  return (
    <Card className="overflow-hidden">
      <p className="px-4 py-3 text-[11px] text-slate-500 border-b border-slate-100">
        These employees cannot receive some automatic e-mails until the missing information is filled in. A joining date is needed for anniversaries and probation; the real date of birth for birthdays.
      </p>
      <ul className="divide-y divide-slate-100">
        {issues.map(i => {
          const d = dates[i.employeeKey] || {};
          const needsDob = i.issues.includes('NO_DATE_OF_BIRTH');
          const needsJoin = i.issues.includes('NO_JOINING_DATE') || i.issues.includes('JOINING_DATE_IN_THE_FUTURE');
          return (
            <li key={i.employeeKey} className="px-4 py-3 text-xs flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <div className="font-bold text-slate-900 text-sm">{i.name}</div>
                <div className="text-slate-500">{i.department || 'No department'}{i.email ? ` · ${i.email}` : ''}</div>
                <div className="mt-1 flex flex-wrap gap-1">{i.issues.map(x => <Pill key={x} tone="orange">{ISSUE_LABEL[x]}</Pill>)}</div>
              </div>
              {needsDob && (
                <label className="text-[11px] font-semibold text-slate-600">Date of birth
                  <input type="date" className={`${inputCls} mt-1`} max={new Date().toISOString().slice(0, 10)} value={d.dob || ''} onChange={e => setDates({ ...dates, [i.employeeKey]: { ...d, dob: e.target.value } })} />
                </label>
              )}
              {needsJoin && (
                <label className="text-[11px] font-semibold text-slate-600">Joining date
                  <input type="date" className={`${inputCls} mt-1`} value={d.joining || ''} onChange={e => setDates({ ...dates, [i.employeeKey]: { ...d, joining: e.target.value } })} />
                </label>
              )}
              {(needsDob || needsJoin) && (
                <button type="button" className={btn.primary} disabled={busy === i.employeeKey || (!d.dob && !d.joining)}
                  onClick={() => void act(i.employeeKey, () => hrApi.setEmployeeDates({ employeeKey: i.employeeKey, dateOfBirth: d.dob || undefined, joiningDate: d.joining || undefined }), `${i.name}'s dates were saved.`)}>
                  Save
                </button>
              )}
              {i.issues.includes('NO_VALID_EMAIL') && !needsDob && !needsJoin && <span className="text-[11px] text-slate-500">Add a valid e-mail address in the employee's profile.</span>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
