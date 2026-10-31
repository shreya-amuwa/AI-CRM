import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import type { DepartmentReportBox } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { btn, Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { notifyReportsChanged } from './reportEvents';
import { ReviewInbox } from './ReviewInbox';
import { TeamLeadBoxView } from './TeamLeadBoxView';
import { Chip, PeriodBar, periodLabel, presetPeriod, timeLabel, type Period } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * The Department Head's team reports: the Team Leads' own reports waiting for the head's decision, one expandable box per Team Lead of the
 * department (loaded from the database, nothing hard-coded) and the consolidated department box, from which the head sends the package for
 * the period to the Operations Head. Only Team Member reports that their Team Lead approved are included; pending ones stay pending.
 */
export const DepartmentReports: React.FC<{ reloadKey: number; onOpen: (id: string) => void }> = ({ reloadKey, onOpen }) => {
  const [period, setPeriod] = useState<Period>(() => presetPeriod('WEEK'));
  const [data, setData] = useState<DepartmentReportBox | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');

  const load = useCallback(() => {
    setError('');
    workReportsApi.department(period.from, period.to).then(d => { setData(d); setNote(n => n || d.package.note || ''); }, e => { setData(null); setError(errText(e)); });
  }, [period.from, period.to]);
  useEffect(() => { setNote(''); setSent(''); }, [period.from, period.to]);
  useEffect(load, [load, reloadKey]);

  const totals = useMemo(() => {
    const t = { leads: 0, members: 0, submitted: 0, approved: 0, pending: 0, revision: 0, rejected: 0, leadReports: 0 };
    for (const b of data?.teams ?? []) {
      t.leads += 1; t.members += b.totalMembers; t.submitted += b.counts.submitted; t.approved += b.counts.approved;
      t.pending += b.counts.pending; t.revision += b.counts.revision; t.rejected += b.counts.rejected; t.leadReports += b.leadReports.length;
    }
    return t;
  }, [data]);

  const send = async () => {
    setSending(true);
    setError('');
    setSent('');
    try {
      await workReportsApi.submitPackage({ from: period.from, to: period.to, periodType: period.type, note: note.trim() || undefined });
      notifyReportsChanged();
      setSent('The department package was sent to the Operations Head.');
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <ReviewInbox title="Team Lead reports awaiting your decision" emptyText="No Team Lead report is waiting for you." period={period} reloadKey={reloadKey} onOpen={onOpen} />

      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Team reports</h2>
            <p className="text-xs text-slate-500">{data ? <>{data.department ?? 'Your department'} - one box per Team Lead</> : 'One box per Team Lead of your department.'}</p>
          </div>
          <PeriodBar value={period} onChange={setPeriod} />
        </div>
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}
        {!data && !error ? <Spinner /> : null}
        {data ? (
          data.teams.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No Team Leads are set up in your department yet.</p> : (
            <div className="space-y-3" data-testid="department-boxes">
              {data.teams.map(b => <TeamLeadBoxView key={b.leadId} box={b} onOpen={onOpen} />)}
            </div>
          )
        ) : null}
      </Card>

      {data ? (
        <Card className="p-5" >
          <section aria-label="Consolidated department report" data-testid="consolidated-box">
            <h2 className="text-base font-bold text-slate-900">Consolidated department report</h2>
            <p className="text-xs text-slate-500 mb-3">{data.department} - {periodLabel(period.from, period.to)}. A preview of what the Operations Head receives.</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Chip label="Team Leads" value={totals.leads} />
              <Chip label="Team Members" value={totals.members} />
              <Chip label="Team Lead reports" value={totals.leadReports} tone="info" />
              <Chip label="member reports included (approved)" value={totals.approved} tone="good" />
              <Chip label="pending - not included" value={totals.pending} tone={totals.pending ? 'warn' : 'neutral'} />
              {totals.revision ? <Chip label="returned for revision" value={totals.revision} tone="warn" /> : null}
              {totals.rejected ? <Chip label="rejected" value={totals.rejected} tone="bad" /> : null}
            </div>
            <ul className="mb-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              {data.teams.map(b => (
                <li key={b.leadId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="font-semibold text-slate-800">{b.lead} <span className="font-normal text-slate-500">- {b.team ?? 'No team'}</span></span>
                  <span className="text-xs text-slate-600">{b.leadReports.length ? 'Own report in' : 'Own report missing'} - {b.counts.approved} approved - {b.counts.pending} pending</span>
                </li>
              ))}
            </ul>
            {totals.pending > 0 ? <p className="mb-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">{totals.pending} Team Member report{totals.pending === 1 ? ' is' : 's are'} still waiting for a Team Lead. They stay pending and are not part of this package.</p> : null}
            <label htmlFor="dept-observations" className="block text-xs font-semibold text-slate-700 mb-1">Department-level observations</label>
            <textarea id="dept-observations" className={`${inputCls} min-h-24`} value={note} maxLength={4000} onChange={e => setNote(e.target.value)} disabled={sending} placeholder="What the Operations Head should know about this period." />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className={btn.primary} onClick={() => void send()} disabled={sending}>
                <Send className="w-3.5 h-3.5" aria-hidden="true" /> {sending ? 'Sending...' : data.package.status === 'SUBMITTED' ? 'Update and resend package' : 'Send package to Operations Head'}
              </button>
              {data.package.status === 'SUBMITTED' ? <span className="text-xs text-emerald-700">Sent {timeLabel(data.package.submittedAt)} by {data.package.submittedBy}</span> : <span className="text-xs text-slate-500">Not sent yet for this period.</span>}
              {sent ? <span role="status" className="text-xs text-emerald-700">{sent}</span> : null}
            </div>
          </section>
        </Card>
      ) : null}
    </div>
  );
};
