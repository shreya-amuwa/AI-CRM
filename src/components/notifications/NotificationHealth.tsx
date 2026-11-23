import React, { useCallback, useEffect, useState } from 'react';
import { Activity, BellRing, ChevronDown, ChevronRight, RefreshCw, Send } from 'lucide-react';
import type { NotificationHealthDetail, NotificationHealthEmployee, NotificationHealthReport, NotificationHealthStatus } from '../../../shared/contracts';
import { notificationsApi } from '../../lib/api/endpoints';
import { ApiError, errorMessage } from '../../lib/api/client';
import { useDepartments } from '../../context/DepartmentContext';

/**
 * Notification Health (Super Admin → Notification Health; HR → Attendance → Notification health). Real data only: what the scheduler did,
 * what each push service answered and what each browser reported. "Accepted" means the push service took the notification; it does not
 * prove the phone showed it or made a sound. No device address, key or message text is shown; nobody's punch location either.
 */
const card = 'rounded-2xl border border-slate-200 bg-white p-4';
const btn = 'inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = `${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const field = 'h-9 px-2 rounded-xl border border-slate-200 text-sm bg-white';
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never';

export const STATUS_INFO: Record<NotificationHealthStatus, { label: string; tone: string; reason: string; action: string }> = {
  READY: { label: 'Ready', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200', reason: 'A device accepted a push in the last 14 days and nothing failed since.', action: 'None.' },
  SETUP_REQUIRED: { label: 'Setup required', tone: 'bg-amber-50 text-amber-800 border-amber-200', reason: 'A device is registered but no push was accepted in the last 14 days.', action: 'Send a test notification and ask the employee to confirm it appeared.' },
  NOTIFICATIONS_BLOCKED: { label: 'Notifications blocked', tone: 'bg-red-50 text-red-800 border-red-200', reason: 'The employee’s browser reported notifications as blocked, and no device is registered.', action: 'Ask the employee to allow notifications for the CRM site (Attendance → Reminders → Notification troubleshooting).' },
  DEVICE_NOT_REGISTERED: { label: 'Device not registered', tone: 'bg-red-50 text-red-800 border-red-200', reason: 'No active device: notifications were never turned on, or every device expired or was removed.', action: 'Ask the employee to tap “Turn on notifications” on their phone and laptop.' },
  PUSH_UNAVAILABLE: { label: 'Push configuration unavailable', tone: 'bg-red-50 text-red-800 border-red-200', reason: 'The server has no working VAPID key pair: reminders reach the bell only.', action: 'Set VAPID_PRIVATE_KEY and VAPID_SUBJECT (and a matching VAPID_PUBLIC_KEY) on the Worker.' },
  DELIVERY_FAILED: { label: 'Delivery failed', tone: 'bg-red-50 text-red-800 border-red-200', reason: 'The last push to this employee was refused or failed after its retries.', action: 'Open the row for the error code; ask the employee to remove the device and turn notifications on again.' },
  RETRY_PENDING: { label: 'Retry pending', tone: 'bg-amber-50 text-amber-800 border-amber-200', reason: 'A push service was busy or unreachable; the CRM will try again automatically.', action: 'None yet. If it keeps failing it becomes “Delivery failed”.' },
  REMINDERS_DISABLED: { label: 'Reminders disabled by employee', tone: 'bg-slate-100 text-slate-700 border-slate-200', reason: 'The employee switched attendance reminders off.', action: 'None (their choice). Talk to them if reminders are required.' },
  COMPANY_PAUSED: { label: 'Company reminders paused', tone: 'bg-slate-100 text-slate-700 border-slate-200', reason: 'Reminders are switched off for the company or paused for today.', action: 'Attendance → Reminders → Company reminder times.' }
};
const ISSUES: { value: string; label: string }[] = [
  ...(Object.keys(STATUS_INFO) as NotificationHealthStatus[]).map(k => ({ value: k, label: STATUS_INFO[k].label })),
  { value: 'REMINDER_MISSING', label: 'Reminder not generated as expected' },
  { value: 'SOUND_UNKNOWN', label: 'Device sound status unknown' }
];
const SOUND_LABEL = { CONFIRMED: 'Confirmed by employee', AUDIO_ENABLED: 'Sound allowed in browser', AUDIO_LOCKED: 'Browser has not allowed sound yet', UNKNOWN: 'Device sound status unknown' } as const;
const SCHEDULER_TONE = { HEALTHY: 'text-emerald-700', DELAYED: 'text-amber-700', NOT_RUNNING: 'text-red-700' } as const;
const SCHEDULER_LABEL = { HEALTHY: 'Healthy', DELAYED: 'Delayed (no good run in 15 minutes)', NOT_RUNNING: 'Not running (no good run in the last hour)' } as const;

const Tile: React.FC<{ label: string; value: number | string; tone?: string; onClick?: () => void }> = ({ label, value, tone = 'text-slate-900', onClick }) => {
  const inner = <><span className={`block text-2xl font-extrabold ${tone}`}>{value}</span><span className="block text-xs text-slate-600">{label}</span></>;
  return onClick
    ? <button type="button" onClick={onClick} className={`${card} text-left hover:border-blue-300`}>{inner}</button>
    : <div className={card}>{inner}</div>;
};

const Detail: React.FC<{ id: string }> = ({ id }) => {
  const [d, setD] = useState<NotificationHealthDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { notificationsApi.healthEmployee(id).then(setD, e => setError(errorMessage(e))); }, [id]);
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!d) return <p role="status" className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-3 text-xs">
      <div>
        <h4 className="font-extrabold text-slate-900 mb-1">Devices</h4>
        {d.devices.length === 0 ? <p className="text-slate-500">No device has ever been registered.</p> : (
          <ul className="space-y-1">{d.devices.map(x => (
            <li key={x.id}><span className="font-semibold">{x.label || 'A device'}</span> · {x.active ? 'active' : `off${x.deactivatedReason === 'EXPIRED_AT_PUSH_SERVICE' ? ' (expired at the push service)' : ''}`}
              <span className="block text-slate-500">added {when(x.createdAt)} · accepted {when(x.lastSuccessAt)}{x.lastFailureAt ? ` · failed ${when(x.lastFailureAt)} (${x.lastFailureCode ?? '?'})` : ''}{x.testConfirmedAt ? ` · test confirmed ${when(x.testConfirmedAt)}` : ''}</span></li>
          ))}</ul>
        )}
        <h4 className="font-extrabold text-slate-900 mt-2 mb-1">What the browsers reported</h4>
        {d.browsers.length === 0 ? <p className="text-slate-500">Nothing reported yet (the employee has not opened the CRM since this was added).</p> : (
          <ul className="space-y-1">{d.browsers.map((b, i) => (
            <li key={i}>{b.label || 'Browser'}{b.standalone ? ' (installed app)' : ''}: permission {b.permission}, notifications {b.pushState}, sound {b.audioState} <span className="text-slate-500">· {when(b.checkedAt)}</span></li>
          ))}</ul>
        )}
      </div>
      <div className="lg:col-span-2">
        <h4 className="font-extrabold text-slate-900 mb-1">Last deliveries</h4>
        {d.deliveries.length === 0 ? <p className="text-slate-500">No push was queued for this employee in the last 30 days.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full">
            <thead><tr className="text-left text-slate-500"><th className="pr-2">Queued</th><th className="pr-2">What</th><th className="pr-2">Device</th><th className="pr-2">Status</th><th className="pr-2">Tries</th><th>Code</th></tr></thead>
            <tbody>{d.deliveries.map(x => (
              <tr key={x.id} className="border-t border-slate-100">
                <td className="pr-2 whitespace-nowrap">{when(x.createdAt)}</td>
                <td className="pr-2">{x.kind === 'TEST' ? 'Test' : `${(x.reminderKind ?? '').replace('_', ' ').toLowerCase()}${x.step ? ' (follow-up)' : ''}`}</td>
                <td className="pr-2">{x.device ?? '-'}</td>
                <td className="pr-2">{x.status === 'ACCEPTED_BY_PUSH_SERVICE' ? 'Accepted by push service' : x.status.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="pr-2">{x.attempts}</td>
                <td>{x.statusCode ?? x.error ?? ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
};

const EmployeeRow: React.FC<{ e: NotificationHealthEmployee }> = ({ e }) => {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const info = STATUS_INFO[e.status];
  const test = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await notificationsApi.healthTest(e.profileId);
      setNote(!r.pushConfigured ? { ok: false, text: 'Push is not configured on the server.' }
        : r.devices === 0 ? { ok: false, text: 'No active device to test.' }
        : { ok: r.sent > 0, text: `Accepted by the push service for ${r.sent} of ${r.devices} device(s)${r.retry ? `, ${r.retry} will be retried` : ''}${r.failed + r.gone ? `, ${r.failed + r.gone} failed` : ''}. Ask the employee whether it appeared.` });
    } catch (err) {
      setNote({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <>
      <tr className="align-top border-t border-slate-100" data-testid="health-row">
        <th scope="row" className="px-2 py-2 text-left font-semibold">
          <button type="button" className="inline-flex items-start gap-1 text-left hover:text-blue-700" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />}
            <span>{e.name}<span className="block text-[11px] font-normal text-slate-500">{e.designation || e.role.replace('_', ' ').toLowerCase()}</span></span>
          </button>
        </th>
        <td className="px-2 py-2">{e.department ?? '-'}</td>
        <td className="px-2 py-2 whitespace-nowrap text-xs">{e.remindersEnabled ? `${e.effective.punchIn} · ${e.effective.lunch} · ${e.effective.punchOut}` : 'off'}
          {e.noReminderToday && <span className="block text-slate-500">{e.onLeave ? 'On leave today' : 'No reminder due today'}</span>}
          {e.reminderMissing && <span className="block font-semibold text-red-700">Reminder not generated as expected</span>}</td>
        <td className="px-2 py-2 text-center">{e.activeDevices}</td>
        <td className="px-2 py-2"><span data-testid="health-status" className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${info.tone}`}>{info.label}</span>
          {e.retryPending > 0 && e.status !== 'RETRY_PENDING' && <span className="block text-[11px] text-amber-700">{e.retryPending} retry pending</span>}</td>
        <td className="px-2 py-2 whitespace-nowrap text-xs">{when(e.lastAcceptedAt)}</td>
        <td className="px-2 py-2 text-xs">{e.lastFailureAt ? <>{when(e.lastFailureAt)}{e.lastFailureCode ? <span className="block text-slate-500">{e.lastFailureCode}</span> : null}</> : '-'}</td>
        <td className="px-2 py-2 text-xs">{SOUND_LABEL[e.soundStatus]}</td>
        <td className="px-2 py-2">
          {confirming ? (
            <span className="inline-flex flex-wrap gap-1">
              <button type="button" className={secondary} disabled={busy} onClick={() => void test()}>{busy ? 'Sending…' : 'Send'}</button>
              <button type="button" className={secondary} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" className={secondary} disabled={e.activeDevices === 0} onClick={() => setConfirming(true)}
              aria-label={`Send a test notification to ${e.name}`} title={e.activeDevices === 0 ? 'No active device' : 'The employee sees in their bell that HR sent a test'}>
              <Send className="w-3.5 h-3.5" aria-hidden="true" /> Test
            </button>
          )}
        </td>
      </tr>
      {(open || note) && (
        <tr><td colSpan={9} className="px-2 pb-3 bg-slate-50/60">
          {note && <p role={note.ok ? 'status' : 'alert'} className={`pt-2 text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`}>{note.text}</p>}
          {open && (
            <div className="pt-2 space-y-2">
              <p className="text-xs text-slate-700"><span className="font-semibold">Why:</span> {info.reason} <span className="font-semibold">What to do:</span> {info.action}</p>
              <Detail id={e.profileId} />
            </div>
          )}
        </td></tr>
      )}
    </>
  );
};

export const NotificationHealth: React.FC = () => {
  const { departments } = useDepartments();
  const [filters, setFilters] = useState<{ departmentId: string; role: string; issue: string }>({ departmentId: '', role: '', issue: '' });
  const [report, setReport] = useState<NotificationHealthReport | null>(null);
  const [error, setError] = useState<{ forbidden: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await notificationsApi.health({
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}), ...(filters.role ? { role: filters.role } : {}), ...(filters.issue ? { issue: filters.issue } : {})
      }));
    } catch (e) {
      setError({ forbidden: e instanceof ApiError && (e.status === 403 || e.code === 'FORBIDDEN'), text: errorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  const s = report?.summary;
  const sch = report?.scheduler;
  const setIssue = (issue: string) => setFilters(f => ({ ...f, issue }));
  return (
    <div className="space-y-4" data-testid="notification-health">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Notification Health</h1>
          <p className="mt-1 text-sm text-slate-600">Whether each employee can receive Punch In, Lunch, Resume Work and Punch Out reminders. “Accepted” means the push service took the notification, not that the device showed it or made a sound.</p>
        </div>
        <button type="button" className={secondary} disabled={loading} onClick={() => void load()}><RefreshCw className="w-4 h-4" aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error.forbidden ? 'Only the Super Admin and HR can see Notification Health.' : error.text}
        </p>
      )}
      {report && sch && s && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <section className={card} aria-label="Scheduler">
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><Activity className="w-4 h-4" aria-hidden="true" /> Reminder scheduler</h2>
              <p className={`mt-1 text-sm font-bold ${SCHEDULER_TONE[sch.health]}`} data-testid="scheduler-health">{SCHEDULER_LABEL[sch.health]}</p>
              <p className="text-xs text-slate-600">Last successful run {when(sch.lastSuccessAt)} · last run {when(sch.lastRunAt)}{sch.lastRunOk === false ? ` (failed${sch.lastError ? `: ${sch.lastError}` : ''})` : ''} · {sch.runs24h} runs, {sch.failedRuns24h} failed in 24 h</p>
              <p className="mt-1 text-xs text-slate-600">Last 24 h: {sch.last24h.generated} reminders generated, {sch.last24h.attempted} pushes attempted, {sch.last24h.accepted} accepted by push services, {sch.last24h.failed} failed, {sch.last24h.retry} to retry, {sch.last24h.gone} expired devices, {sch.last24h.noDevice} reminders with no device.</p>
              {sch.health === 'NOT_RUNNING' && <p className="mt-1 text-xs text-red-700">Check on Cloudflare that SCHEDULED_ENABLED is "true", CRON_SECRET is set and the "*/5 * * * *" cron runs on the production Worker.</p>}
              {report.pushConfigured === false && <p className="mt-1 text-xs text-red-700">Push is not configured on the server (VAPID keys): reminders reach the CRM bell only.</p>}
            </section>
            <section className={card} aria-label="Today and the queue">
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><BellRing className="w-4 h-4" aria-hidden="true" /> Today and the delivery queue</h2>
              <p className="mt-1 text-xs text-slate-600">Today: {report.todayReminders.generated} reminders, {report.todayReminders.bellWritten} written to the bell, {report.todayReminders.noDevice} with no device{report.todayReminders.pushOff ? `, ${report.todayReminders.pushOff} with push off` : ''}.</p>
              <p className="mt-1 text-xs text-slate-600">Queue: {report.queue.pending} pending, {report.queue.retryPending} waiting to retry. Last 24 h: {report.queue.accepted24h} accepted, {report.queue.failed24h} failed, {report.queue.expired24h} expired, {report.queue.cancelled24h} cancelled (the action was already done or the device changed).</p>
            </section>
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
            <Tile label="Active eligible employees" value={s.eligible} onClick={() => setIssue('')} />
            <Tile label="Reminders enabled" value={s.remindersEnabled} />
            <Tile label="Reminders disabled" value={s.remindersDisabled} onClick={() => setIssue('REMINDERS_DISABLED')} />
            <Tile label="With an active device" value={s.withDevice} />
            <Tile label="No registered device" value={s.withoutDevice} tone={s.withoutDevice ? 'text-red-700' : undefined} onClick={() => setIssue('DEVICE_NOT_REGISTERED')} />
            <Tile label="Recent push failures" value={s.recentFailures} tone={s.recentFailures ? 'text-red-700' : undefined} onClick={() => setIssue('DELIVERY_FAILED')} />
            <Tile label="Reminders not generated" value={s.reminderMissing} tone={s.reminderMissing ? 'text-red-700' : undefined} onClick={() => setIssue('REMINDER_MISSING')} />
          </div>
        </>
      )}
      <section className={card} aria-label="Employees">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-xs font-semibold text-slate-600">Department
            <select className={`${field} block mt-1`} value={filters.departmentId} onChange={e => setFilters(f => ({ ...f, departmentId: e.target.value }))}>
              <option value="">All departments</option>
              {departments.map(d => <option key={d.dbId} value={d.dbId}>{d.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Role
            <select className={`${field} block mt-1`} value={filters.role} onChange={e => setFilters(f => ({ ...f, role: e.target.value }))}>
              <option value="">All roles</option>
              <option value="DEPARTMENT_HEAD">Department Head</option>
              <option value="TEAM_HEAD">Team Lead</option>
              <option value="TEAM_MEMBER">Team Member</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Issue
            <select className={`${field} block mt-1`} value={filters.issue} onChange={e => setIssue(e.target.value)}>
              <option value="">Every status</option>
              {ISSUES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </label>
        </div>
        {!report && !error && <p role="status" className="text-sm text-slate-500">Loading…</p>}
        {report && report.employees.length === 0 && <p className="text-sm text-slate-500">No employee matches these filters.</p>}
        {report && report.employees.length > 0 && (
          <div className="relative overflow-x-auto"><table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500">
              <th className="px-2 py-1">Employee</th><th className="px-2 py-1">Department</th><th className="px-2 py-1">Reminders (In · Lunch · Out)</th>
              <th className="px-2 py-1">Devices</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Last accepted</th><th className="px-2 py-1">Last failure</th>
              <th className="px-2 py-1">Sound</th><th className="px-2 py-1"><span className="sr-only">Test</span></th>
            </tr></thead>
            <tbody>{report.employees.map(e => <EmployeeRow key={e.profileId} e={e} />)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
};

export default NotificationHealth;
