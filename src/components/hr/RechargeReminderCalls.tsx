import React, { useCallback, useEffect, useState } from 'react';
import { PhoneCall, RefreshCw } from 'lucide-react';
import { reminderCallsApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import type { ReminderCallList, ReminderCallRow } from '../../../shared/contracts';
import type { REMINDER_CALL_FILTERS } from '../../../shared/validation';
import { btn, Card, ErrorBanner, Pill, Spinner, type Tone } from '../team-member/pipeline/shared';
import { HrPageHeader, hrBtn } from './hrUi';

/**
 * HR dashboard > Recharge Reminder Calls (Super Admin and HR staff; the database refuses anyone else).
 * The BolifyAI calls placed 7, 5 and 1 day before a customer's panel expires. Read only: the server decides and places the calls every morning
 * by itself; nothing here can call a customer. "Submitted" means BolifyAI took the request; only a call result from BolifyAI makes it "Completed".
 */
type Filter = (typeof REMINDER_CALL_FILTERS)[number];
const FILTERS: { id: Filter; label: string; count: keyof ReminderCallList['counts'] }[] = [
  { id: 'ALL', label: 'All', count: 'all' },
  { id: 'STAGE_7', label: '7-day', count: 'stage7' },
  { id: 'STAGE_5', label: '5-day', count: 'stage5' },
  { id: 'STAGE_1', label: '1-day', count: 'stage1' },
  { id: 'PENDING', label: 'Pending', count: 'pending' },
  { id: 'SUBMITTED', label: 'Submitted', count: 'submitted' },
  { id: 'FAILED', label: 'Failed', count: 'failed' },
  { id: 'COMPLETED', label: 'Completed', count: 'completed' },
  { id: 'SKIPPED', label: 'Skipped / cancelled', count: 'skipped' }
];
const PAGE = 50;

const STATUS: Record<ReminderCallRow['status'], { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Pending', tone: 'slate' },
  RETRY: { label: 'Pending (retry)', tone: 'orange' },
  DRY_RUN: { label: 'Pending (dry run, not called)', tone: 'slate' },
  PROCESSING: { label: 'Processing', tone: 'indigo' },
  ACCEPTED: { label: 'Submitted', tone: 'indigo' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' },
  SKIPPED: { label: 'Skipped', tone: 'orange' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' }
};
const OUTCOME: Record<NonNullable<ReminderCallRow['callOutcome']>, string> = {
  COMPLETED: 'Answered', NOT_ANSWERED: 'Not answered', BUSY: 'Busy', FAILED: 'Call failed'
};

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
/** A calendar date (YYYY-MM-DD) as "20 Nov 2026": formatted as UTC so it never moves by a day. */
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');
/** A timestamp (stored in UTC) shown in India time. */
const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '–');
const daysLeft = (n: number) => (n < 0 ? `expired ${-n} day${n === -1 ? '' : 's'} ago` : n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'}`);

function responseText(r: ReminderCallRow): string {
  const parts: string[] = [];
  if (r.responseCode) parts.push(`HTTP ${r.responseCode}`);
  if (r.response?.message) parts.push(r.response.message);
  if (r.callId) parts.push(`call ${r.callId}`);
  if (r.callOutcome) parts.push(OUTCOME[r.callOutcome] + (r.callDurationSeconds != null ? ` (${r.callDurationSeconds} s)` : ''));
  return parts.join(' · ') || '–';
}

export const RechargeReminderCalls: React.FC = () => {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReminderCallList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return reminderCallsApi
      .list({ filter, page, pageSize: PAGE })
      .then(setData, e => setError(errText(e, 'Could not load the reminder calls.')))
      .finally(() => setLoading(false));
  }, [filter, page]);
  useEffect(() => { void load(); }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <section className="space-y-4" aria-label="Recharge reminder calls">
      <HrPageHeader as="h2" icon={PhoneCall} title="Recharge Reminder Calls"
        subtitle={<>BolifyAI AI calls placed automatically 7, 5 and 1 day before a customer's panel expires (India dates, 10:00 to 19:00 IST). Only customers with a live panel,
            a valid mobile number and call consent are called, never twice for the same reminder. <b>Submitted</b> means BolifyAI accepted the request; it becomes
            <b> Completed</b> only when BolifyAI reports the call result.
          {data?.lastSchedule && <span className="block text-[11px] text-slate-400 mt-1">Last daily run: {ist(data.lastSchedule.ranAt)} · {data.lastSchedule.created} new, {data.lastSchedule.cancelled} withdrawn</span>}</>}
        actions={<button type="button" className={hrBtn.secondary} onClick={() => void load()} disabled={loading} aria-label="Refresh the reminder calls">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>} />

      <div role="tablist" aria-label="Filter the reminder calls" className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
            onClick={() => { setFilter(f.id); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filter === f.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {f.label}{data ? <span className="ml-1 tabular-nums opacity-80">({data.counts[f.count] ?? 0})</span> : null}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <Card className="overflow-hidden">
        {loading && !data ? <Spinner label="Loading the reminder calls…" /> : !data || data.rows.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">{error ? 'Nothing to show.' : 'No reminder calls in this view yet.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">Customer</th>
                  <th scope="col" className="px-3 py-2">Phone</th>
                  <th scope="col" className="px-3 py-2">Panel / service</th>
                  <th scope="col" className="px-3 py-2">Expiry date</th>
                  <th scope="col" className="px-3 py-2">Days left</th>
                  <th scope="col" className="px-3 py-2">Reminder</th>
                  <th scope="col" className="px-3 py-2">Scheduled</th>
                  <th scope="col" className="px-3 py-2">Submitted</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">BolifyAI response</th>
                  <th scope="col" className="px-3 py-2">Failure / skip reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map(r => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2"><div className="font-semibold text-slate-800">{r.customer}</div>{r.company && <div className="text-slate-400">{r.company}</div>}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.phone ?? <span className="text-rose-600">No valid mobile</span>}</td>
                    <td className="px-3 py-2">{r.serviceName}{r.planName ? <span className="text-slate-400"> · {r.planName}</span> : null}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{day(r.expiryDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{daysLeft(r.daysLeft)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.stage}-day</td>
                    <td className="px-3 py-2 whitespace-nowrap">{day(r.scheduledDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{ist(r.submittedAt)}</td>
                    <td className="px-3 py-2"><Pill tone={STATUS[r.status]?.tone ?? 'slate'}>{STATUS[r.status]?.label ?? r.status}</Pill>{r.attempts > 1 && <div className="text-[10px] text-slate-400 mt-1">{r.attempts} attempts</div>}</td>
                    <td className="px-3 py-2 max-w-[220px] break-words text-slate-600">{responseText(r)}</td>
                    <td className="px-3 py-2 max-w-[260px] break-words text-slate-600">{r.reason ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.total > PAGE && (
        <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-xs">
          <button type="button" className={btn.secondary} disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className="tabular-nums text-slate-500">Page {page} of {pages}</span>
          <button type="button" className={btn.secondary} disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)}>Next</button>
        </nav>
      )}
    </section>
  );
};
