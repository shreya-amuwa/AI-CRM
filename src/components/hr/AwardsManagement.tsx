import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Award, Building2, CalendarDays, ChevronLeft, ChevronRight, Crown, Medal, Pencil, Plus, Rocket, Search,
  ShieldCheck, Sparkles, Star, Trash2, Trophy, Undo2, Users
} from 'lucide-react';
import { hrAwardsApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { officeToday } from '../../lib/officeTime';
import { awardNominateSchema } from '../../../shared/validation';
import type { HrAwardCard, HrAwardCode, HrAwardDetail, HrAwardNominee, HrAwardNomineeType, HrAwardOptions, HrAwardStatus, HrAwardWinner, HrAwardsOverview } from '../../../shared/contracts';
import { btn, Card, Dialog, ErrorBanner, Field, inputCls, Pill, Spinner } from '../team-member/pipeline/shared';

/**
 * HR dashboard > Award Management > Awards (migration 20270203000100).
 * Seven monthly awards. For the chosen month HR adds any number of nominees (employees, teams or departments picked from the CRM),
 * edits or removes them, and declares one or more winners (revocable, with a reason). Every month is kept separately, so earlier months
 * stay as they were. Everything is read from and saved to the database; the database decides who may (HR staff and the Super Admin).
 */

const AWARD_ICON: Record<HrAwardCode, React.ComponentType<{ className?: string }>> = {
  PROFESSIONALISM_EXCELLENCE: ShieldCheck,
  RISING_STAR: Rocket,
  PLAYER: Star,
  EMERGING_LEADER: Sparkles,
  DEPARTMENT: Building2,
  TEAM: Users,
  BUSINESS_ICON: Crown
};
const TYPE_LABEL: Record<HrAwardNomineeType, string> = { INDIVIDUAL: 'Individual', TEAM: 'Team', DEPARTMENT: 'Department' };
const STATUS_LABEL: Record<HrAwardStatus, string> = { NO_NOMINEES: 'No nominees yet', NOMINATIONS_OPEN: 'Nominations open', WINNERS_DECLARED: 'Winner declared' };
const STATUS_TONE: Record<HrAwardStatus, 'slate' | 'indigo' | 'green'> = { NO_NOMINEES: 'slate', NOMINATIONS_OPEN: 'indigo', WINNERS_DECLARED: 'green' };

const currentMonth = () => officeToday().slice(0, 7);
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
const subline = (x: { nomineeType: HrAwardNomineeType; designation: string | null; teamName: string | null; departmentName: string | null }) =>
  x.nomineeType === 'INDIVIDUAL'
    ? [x.designation, x.teamName].filter(Boolean).join(' · ') || '—'
    : x.nomineeType === 'TEAM' ? `Team · ${x.departmentName ?? '—'}` : 'Department';

interface Props {
  onToast?: (message: string) => void;
}

export const AwardsManagement: React.FC<Props> = ({ onToast }) => {
  const [month, setMonth] = useState<string>(currentMonth);
  const [overview, setOverview] = useState<HrAwardsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<HrAwardCode | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await hrAwardsApi.overview(month));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const toast = (m: string) => onToast?.(m);

  if (openCode) {
    return (
      <AwardDetailView
        code={openCode}
        month={month}
        onMonthChange={setMonth}
        onBack={() => { setOpenCode(null); void loadOverview(); }}
        onToast={toast}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h4 className="text-base font-bold text-slate-900 font-heading flex items-center gap-2">
              <Trophy className="w-5 h-5 text-blue-600" /> Awards
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">Monthly employee recognition: add nominees, then declare one or more winners for each award.</p>
          </div>
          <MonthPicker month={month} onChange={setMonth} />
        </div>
        {!!overview?.history.length && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Award history</span>
            {overview.history.map(h => (
              <button
                key={h.month}
                type="button"
                onClick={() => setMonth(h.month)}
                aria-pressed={h.month === month}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  h.month === month ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                {h.monthLabel} · {h.winners} winner{h.winners === 1 ? '' : 's'}
              </button>
            ))}
          </div>
        )}
      </Card>

      {error && <ErrorBanner message={error} onRetry={() => void loadOverview()} />}
      {loading && !overview ? (
        <Spinner label="Loading awards…" />
      ) : overview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {overview.awards.map(a => (
            <AwardCard key={a.code} award={a} monthLabel={overview.monthLabel} onManage={() => setOpenCode(a.code)} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const MonthPicker: React.FC<{ month: string; onChange: (m: string) => void }> = ({ month, onChange }) => (
  <div className="flex items-center gap-2">
    <button type="button" className={btn.secondary} onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
      <ChevronLeft className="w-4 h-4" />
    </button>
    <label className="sr-only" htmlFor="award-month">Award month and year</label>
    <input
      id="award-month"
      type="month"
      value={month}
      min="2020-01"
      max={shiftMonth(currentMonth(), 12)}
      onChange={e => e.target.value && onChange(e.target.value)}
      className={`${inputCls} w-44`}
    />
    <button type="button" className={btn.secondary} onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
      <ChevronRight className="w-4 h-4" />
    </button>
    {month !== currentMonth() && (
      <button type="button" className={btn.secondary} onClick={() => onChange(currentMonth())}>This month</button>
    )}
  </div>
);

const AwardCard: React.FC<{ award: HrAwardCard; monthLabel: string; onManage: () => void }> = ({ award, monthLabel: label, onManage }) => {
  const Icon = AWARD_ICON[award.code] ?? Award;
  return (
    <Card className="p-5 flex flex-col justify-between hover:border-blue-300 hover:shadow-md transition-all">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <Pill tone={STATUS_TONE[award.status]}>{STATUS_LABEL[award.status]}</Pill>
        </div>
        <h5 className="mt-3 text-sm font-bold text-slate-900">{award.name}</h5>
        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {label}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Nominees</p>
            <p className="text-lg font-bold text-slate-900">{award.nominees}</p>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-2.5">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">Winners</p>
            <p className="text-lg font-bold text-amber-800">{award.winners}</p>
          </div>
        </div>
        {award.winnerNames.length > 0 && (
          <p className="mt-2 text-xs text-amber-800 flex items-start gap-1">
            <Trophy className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{award.winnerNames.join(', ')}</span>
          </p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">{TYPE_LABEL[award.nomineeType]} nominees</p>
      </div>
      <button type="button" onClick={onManage} className={`${btn.primary} mt-4 w-full !bg-blue-600 hover:!bg-blue-700`} aria-label={`Manage ${award.name}`}>
        Manage Award <ChevronRight className="w-4 h-4" />
      </button>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// One award in one month
// ---------------------------------------------------------------------------
type Action =
  | { kind: 'add' }
  | { kind: 'edit'; nominee: HrAwardNominee }
  | { kind: 'remove'; nominee: HrAwardNominee }
  | { kind: 'declare'; preselect: string[] }
  | { kind: 'winnerRemarks'; winner: HrAwardWinner }
  | { kind: 'revoke'; winner: HrAwardWinner };

const AwardDetailView: React.FC<{
  code: HrAwardCode; month: string; onMonthChange: (m: string) => void; onBack: () => void; onToast: (m: string) => void;
}> = ({ code, month, onMonthChange, onBack, onToast }) => {
  const [detail, setDetail] = useState<HrAwardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await hrAwardsApi.detail(code, month));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [code, month]);
  useEffect(() => { void load(); }, [load]);

  const Icon = AWARD_ICON[code] ?? Award;
  const declarable = detail?.nominees.filter(n => n.status !== 'WINNER') ?? [];
  const done = (d: HrAwardDetail, message: string) => {
    // the server returns the award as saved; show that (and its month, when the nominee was added to another month)
    if (d.month !== month) onMonthChange(d.month);
    setDetail(d);
    setAction(null);
    onToast(message);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={btn.secondary}>
          <ArrowLeft className="w-4 h-4" /> All awards
        </button>
        <MonthPicker month={month} onChange={onMonthChange} />
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !detail ? <Spinner label="Loading the award…" /> : detail && (
        <>
          {/* A. Award overview */}
          <Card className="p-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Award overview</p>
                  <h4 className="text-lg font-bold text-slate-900">{detail.award.name}</h4>
                  <p className="text-xs text-slate-500">{detail.monthLabel} · {TYPE_LABEL[detail.award.nomineeType]} nominees</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={`${btn.primary} !bg-blue-600 hover:!bg-blue-700`} onClick={() => setAction({ kind: 'add' })}>
                  <Plus className="w-4 h-4" /> Add Nominee
                </button>
                <button type="button" className={btn.secondary} disabled={!declarable.length} onClick={() => setAction({ kind: 'declare', preselect: [] })}
                  title={declarable.length ? undefined : 'Add nominees first'}>
                  <Trophy className="w-4 h-4 text-amber-600" /> Declare Winner
                </button>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Award period" value={detail.monthLabel} />
              <Stat label="Total nominees" value={String(detail.totalNominees)} />
              <Stat label="Total winners" value={String(detail.totalWinners)} tone="amber" />
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <dt className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Award status</dt>
                <dd className="mt-1"><Pill tone={STATUS_TONE[detail.status]}>{STATUS_LABEL[detail.status]}</Pill></dd>
              </div>
            </dl>
          </Card>

          {/* B. Nominees */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" /> Nominees <span className="text-xs font-semibold text-slate-500">({detail.nominees.length})</span>
              </h5>
              <button type="button" className={btn.secondary} onClick={() => setAction({ kind: 'add' })}>
                <Plus className="w-3.5 h-3.5" /> Add Nominee
              </button>
            </div>
            {!detail.nominees.length ? (
              <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl">
                <Award className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 mt-2">No nominees for {detail.monthLabel} yet</p>
                <p className="text-xs text-slate-500">Add as many nominees as you need, then declare one or more winners.</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-xs min-w-[760px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3 font-semibold">Nominee</th>
                      <th className="py-2 pr-3 font-semibold">Department</th>
                      <th className="py-2 pr-3 font-semibold">Designation / team</th>
                      <th className="py-2 pr-3 font-semibold">Nomination reason</th>
                      <th className="py-2 pr-3 font-semibold">Nominated on</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.nominees.map(n => (
                      <tr key={n.id} className={`border-b border-slate-50 align-top ${n.status === 'WINNER' ? 'bg-amber-50/50' : ''}`}>
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-slate-900">{n.name}</p>
                          <p className="text-[11px] text-slate-400">{TYPE_LABEL[n.nomineeType]}</p>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-700">{n.departmentName || '—'}</td>
                        <td className="py-2.5 pr-3 text-slate-700">{subline(n)}</td>
                        <td className="py-2.5 pr-3 text-slate-700 max-w-[260px]">
                          <p className="whitespace-pre-wrap break-words">{n.reason}</p>
                          {n.remarks && <p className="mt-1 text-[11px] text-slate-500 whitespace-pre-wrap break-words">Remarks: {n.remarks}</p>}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-700 whitespace-nowrap">{fmtDate(n.nominatedAt)}</td>
                        <td className="py-2.5 pr-3">
                          {n.status === 'WINNER'
                            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold"><Trophy className="w-3 h-3" /> Winner</span>
                            : <Pill tone="indigo">Nominated</Pill>}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex gap-1.5">
                            {n.status !== 'WINNER' && (
                              <button type="button" className={btn.secondary} onClick={() => setAction({ kind: 'declare', preselect: [n.id] })} aria-label={`Declare ${n.name} a winner`} title="Declare winner">
                                <Trophy className="w-3.5 h-3.5 text-amber-600" />
                              </button>
                            )}
                            <button type="button" className={btn.secondary} onClick={() => setAction({ kind: 'edit', nominee: n })} aria-label={`Edit nomination of ${n.name}`} title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className={btn.danger} onClick={() => setAction({ kind: 'remove', nominee: n })} aria-label={`Remove ${n.name}`} title="Remove">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {/* C. Winners: clearly separated from the nominees (gold) */}
          <section aria-labelledby="award-winners" className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 space-y-3">
            <h5 id="award-winners" className="text-sm font-bold text-amber-900 flex items-center gap-2">
              <Trophy className="w-4 h-4" /> Winners <span className="text-xs font-semibold text-amber-700">({detail.winners.length})</span>
            </h5>
            {!detail.winners.length ? (
              <p className="text-xs text-amber-800/80">No winner declared for {detail.monthLabel} yet.{detail.nominees.length ? ' Use "Declare Winner" to choose one or more nominees.' : ''}</p>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {detail.winners.map(w => (
                  <li key={w.id} className="rounded-xl bg-white border border-amber-200 p-4 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0"><Medal className="w-4 h-4" /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{w.name}</p>
                          <p className="text-xs text-slate-500 truncate">{[w.departmentName, w.nomineeType === 'INDIVIDUAL' ? w.teamName : null].filter(Boolean).join(' · ') || '—'}</p>
                        </div>
                      </div>
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold uppercase tracking-wide">Winner</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-slate-500">Award period</dt><dd className="font-semibold text-slate-800">{detail.monthLabel}</dd></div>
                      <div><dt className="text-slate-500">Declared on</dt><dd className="font-semibold text-slate-800">{fmtDate(w.declaredAt)}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-slate-600"><span className="text-slate-500">Remarks: </span>{w.remarks || '—'}</p>
                    {w.declaredBy && <p className="mt-1 text-[11px] text-slate-400">Declared by {w.declaredBy}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={btn.secondary} onClick={() => setAction({ kind: 'winnerRemarks', winner: w })} aria-label={`Edit remarks for ${w.name}`}>
                        <Pencil className="w-3.5 h-3.5" /> Edit remarks
                      </button>
                      <button type="button" className={btn.danger} onClick={() => setAction({ kind: 'revoke', winner: w })} aria-label={`Revoke ${w.name} as winner`}>
                        <Undo2 className="w-3.5 h-3.5" /> Revoke
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {detail.revokedWinners.length > 0 && (
              <div>
                <button type="button" className="text-[11px] font-semibold text-amber-800 underline" onClick={() => setShowRevoked(v => !v)} aria-expanded={showRevoked}>
                  {showRevoked ? 'Hide' : 'Show'} revoked declarations ({detail.revokedWinners.length})
                </button>
                {showRevoked && (
                  <ul className="mt-2 space-y-1.5">
                    {detail.revokedWinners.map(w => (
                      <li key={w.id} className="text-xs text-slate-600 bg-white/70 border border-slate-200 rounded-lg px-3 py-2">
                        <span className="font-semibold line-through">{w.name}</span> — declared {fmtDate(w.declaredAt)}, revoked {fmtDate(w.revokedAt)}
                        {w.revokedBy ? ` by ${w.revokedBy}` : ''}: {w.revokeReason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

        </>
      )}

      {detail && action?.kind === 'add' && (
        <AddNomineeDialog detail={detail} onClose={() => setAction(null)} onSaved={(d, name, again) => {
          if (d.month !== month) onMonthChange(d.month);
          setDetail(d);
          onToast(`${name} nominated for ${d.award.name} – ${d.monthLabel}.`);
          if (!again) setAction(null);
        }} />
      )}
      {action?.kind === 'edit' && (
        <EditNomineeDialog nominee={action.nominee} onClose={() => setAction(null)} onSaved={d => done(d, `Nomination of ${action.nominee.name} updated.`)} />
      )}
      {action?.kind === 'remove' && (
        <ReasonDialog
          title={`Remove ${action.nominee.name}?`}
          description="The nominee is removed from this award and month. The nomination stays in the history."
          label="Reason (optional)" required={false} confirm="Remove nominee" danger
          onClose={() => setAction(null)}
          onConfirm={async reason => done(await hrAwardsApi.removeNominee(action.nominee.id, reason), `${action.nominee.name} removed from the nominees.`)}
        />
      )}
      {detail && action?.kind === 'declare' && (
        <DeclareWinnersDialog detail={detail} preselect={action.preselect} onClose={() => setAction(null)}
          onSaved={(d, count) => done(d, `${count} winner${count === 1 ? '' : 's'} declared for ${d.award.name} – ${d.monthLabel}.`)} />
      )}
      {action?.kind === 'winnerRemarks' && (
        <ReasonDialog
          title={`Winner remarks: ${action.winner.name}`}
          label="Winner remarks" required={false} initial={action.winner.remarks ?? ''} confirm="Save remarks" max={2000}
          onClose={() => setAction(null)}
          onConfirm={async remarks => done(await hrAwardsApi.updateWinner(action.winner.id, remarks), 'Winner remarks saved.')}
        />
      )}
      {action?.kind === 'revoke' && (
        <ReasonDialog
          title={`Revoke ${action.winner.name} as winner?`}
          description="The winner declaration is withdrawn and kept on record with your reason. The nominee stays a nominee and can be declared again."
          label="Reason for revoking" required confirm="Revoke winner" danger
          onClose={() => setAction(null)}
          onConfirm={async reason => done(await hrAwardsApi.revokeWinner(action.winner.id, reason), `${action.winner.name} is no longer a declared winner.`)}
        />
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: 'amber' }> = ({ label, value, tone }) => (
  <div className={`rounded-xl p-3 border ${tone === 'amber' ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
    <dt className={`text-[10px] uppercase tracking-wider font-semibold ${tone === 'amber' ? 'text-amber-700' : 'text-slate-500'}`}>{label}</dt>
    <dd className={`mt-1 text-base font-bold ${tone === 'amber' ? 'text-amber-800' : 'text-slate-900'}`}>{value}</dd>
  </div>
);

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
interface PickItem { id: string; name: string; meta: string; departmentName: string | null; teamName: string | null; designation: string | null }

const AddNomineeDialog: React.FC<{ detail: HrAwardDetail; onClose: () => void; onSaved: (d: HrAwardDetail, name: string, again: boolean) => void }> = ({ detail, onClose, onSaved }) => {
  const type = detail.award.nomineeType;
  const [options, setOptions] = useState<HrAwardOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [current, setCurrent] = useState<HrAwardDetail>(detail);
  const [search, setSearch] = useState('');
  const [entityId, setEntityId] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [month, setMonth] = useState(detail.month);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    hrAwardsApi.options().then(o => live && setOptions(o)).catch(err => live && setOptionsError(errorMessage(err)));
    return () => { live = false; };
  }, []);

  const items: PickItem[] = useMemo(() => {
    if (!options) return [];
    if (type === 'INDIVIDUAL') {
      return options.employees.map(e => ({ id: e.id, name: e.name, meta: [e.designation, e.departmentName, e.teamName].filter(Boolean).join(' · '),
        departmentName: e.departmentName, teamName: e.teamName, designation: e.designation }));
    }
    if (type === 'TEAM') {
      return options.teams.map(t => ({ id: t.id, name: t.name, meta: `${t.departmentName} · ${t.members} member${t.members === 1 ? '' : 's'}`,
        departmentName: t.departmentName, teamName: t.name, designation: null }));
    }
    return options.departments.map(d => ({ id: d.id, name: d.name, meta: `${d.members} member${d.members === 1 ? '' : 's'}`, departmentName: d.name, teamName: null, designation: null }));
  }, [options, type]);
  // the nominees already in the chosen month (only known for the month on screen)
  const taken = useMemo(() => new Set(month === current.month ? current.nominees.map(n => n.entityId) : []), [current, month]);
  const q = search.trim().toLowerCase();
  const shown = items.filter(i => !q || i.name.toLowerCase().includes(q) || i.meta.toLowerCase().includes(q)).slice(0, 100);
  const chosen = items.find(i => i.id === entityId) ?? null;
  const noun = type === 'INDIVIDUAL' ? 'employee' : type === 'TEAM' ? 'team' : 'department';

  const submit = async (again: boolean) => {
    if (saving) return;
    const parsed = awardNominateSchema.safeParse({ month, nomineeType: type, entityId, reason, remarks });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setError(null);
    try {
      const d = await hrAwardsApi.nominate(detail.award.code, parsed.data);
      onSaved(d, chosen?.name ?? 'The nominee', again);
      if (again) {
        setCurrent(d);
        setEntityId('');
        setReason('');
        setRemarks('');
        setSearch('');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title={`Add Nominee — ${detail.award.name}`} description="Choose from the CRM's records. You can add as many nominees as you need." onClose={onClose} wide persistent={saving}>
      <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={e => { e.preventDefault(); void submit(false); }}>
        <div className="space-y-3">
          <fieldset>
            <legend className="block text-xs font-medium text-slate-600 mb-1">Nominee type *</legend>
            <div className="flex gap-2" role="radiogroup">
              {(['INDIVIDUAL', 'TEAM', 'DEPARTMENT'] as const).map(t => (
                <label key={t} className={`flex-1 text-center px-3 py-2 rounded-xl border text-xs font-semibold ${
                  t === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'}`}>
                  <input type="radio" name="nominee-type" className="sr-only" checked={t === type} disabled={t !== type} readOnly />
                  {TYPE_LABEL[t]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{detail.award.name} takes {TYPE_LABEL[type].toLowerCase()} nominees.</p>
          </fieldset>

          <Field label={`Nominee (${noun})`} required htmlFor="award-nominee-search" error={fieldErrors.entityId}>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input id="award-nominee-search" className={`${inputCls} pl-9`} placeholder={`Search ${noun}s by name${type === 'INDIVIDUAL' ? ', department or designation' : ''}`}
                value={search} onChange={e => setSearch(e.target.value)} autoComplete="off" />
            </div>
          </Field>
          {optionsError && <ErrorBanner message={optionsError} />}
          {!options && !optionsError ? <Spinner label={`Loading ${noun}s…`} /> : (
            <ul role="listbox" aria-label={`Choose the ${noun}`} className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              {!shown.length && <li className="p-3 text-xs text-slate-500">No {noun} matches “{search}”.</li>}
              {shown.map(i => {
                const isTaken = taken.has(i.id);
                return (
                  <li key={i.id} role="option" aria-selected={i.id === entityId} aria-disabled={isTaken}>
                    <button type="button" disabled={isTaken} onClick={() => setEntityId(i.id)}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${i.id === entityId ? 'bg-blue-50' : 'hover:bg-slate-50'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                      <span className="font-semibold text-slate-900">{i.name}</span>
                      {isTaken && <span className="ml-2 text-[10px] font-bold text-blue-700">Already nominated</span>}
                      {i.meta && <span className="block text-[11px] text-slate-500">{i.meta}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nominee name" htmlFor="award-nominee-name">
              <input id="award-nominee-name" className={inputCls} value={chosen?.name ?? ''} placeholder={`Choose the ${noun}`} readOnly />
            </Field>
            <Field label="Department" htmlFor="award-nominee-dept">
              <input id="award-nominee-dept" className={inputCls} value={chosen?.departmentName ?? ''} readOnly />
            </Field>
            {type !== 'DEPARTMENT' && (
              <Field label="Team" htmlFor="award-nominee-team">
                <input id="award-nominee-team" className={inputCls} value={chosen?.teamName ?? ''} readOnly />
              </Field>
            )}
            {type === 'INDIVIDUAL' && (
              <Field label="Designation" htmlFor="award-nominee-designation">
                <input id="award-nominee-designation" className={inputCls} value={chosen?.designation ?? ''} readOnly />
              </Field>
            )}
          </div>
          <Field label="Award month and year" required htmlFor="award-nominee-month" error={fieldErrors.month}>
            <input id="award-nominee-month" type="month" className={inputCls} value={month} min="2020-01" max={shiftMonth(currentMonth(), 12)}
              onChange={e => setMonth(e.target.value)} />
          </Field>
          {month !== detail.month && month && (
            <p className="text-[11px] text-blue-700">This nominee will be added to {monthLabel(month)}.</p>
          )}
          <Field label="Reason for nomination" required htmlFor="award-nominee-reason" error={fieldErrors.reason}>
            <textarea id="award-nominee-reason" className={`${inputCls} min-h-[88px]`} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="What did they achieve this month?" aria-invalid={!!fieldErrors.reason} />
          </Field>
          <Field label="Supporting remarks" htmlFor="award-nominee-remarks" error={fieldErrors.remarks}>
            <textarea id="award-nominee-remarks" className={`${inputCls} min-h-[64px]`} maxLength={2000} value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Optional: feedback, numbers, who recommended them" />
          </Field>
        </div>

        {error && <div className="md:col-span-2"><ErrorBanner message={error} /></div>}
        <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={btn.secondary} onClick={() => void submit(true)} disabled={saving}>Save &amp; add another</button>
          <button type="submit" className={`${btn.primary} !bg-blue-600 hover:!bg-blue-700`} disabled={saving}>{saving ? 'Saving…' : 'Add nominee'}</button>
        </div>
      </form>
    </Dialog>
  );
};

const EditNomineeDialog: React.FC<{ nominee: HrAwardNominee; onClose: () => void; onSaved: (d: HrAwardDetail) => void }> = ({ nominee, onClose, onSaved }) => {
  const [reason, setReason] = useState(nominee.reason);
  const [remarks, setRemarks] = useState(nominee.remarks ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (reason.trim().length < 3) { setError('Enter the reason for the nomination (at least 3 characters).'); return; }
    setSaving(true);
    setError(null);
    try {
      onSaved(await hrAwardsApi.updateNominee(nominee.id, { reason: reason.trim(), remarks: remarks.trim() || null }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog title={`Edit nomination — ${nominee.name}`} description="To nominate someone else, remove this nominee and add the new one." onClose={onClose} persistent={saving}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Reason for nomination" required htmlFor="award-edit-reason">
          <textarea id="award-edit-reason" className={`${inputCls} min-h-[88px]`} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        <Field label="Supporting remarks" htmlFor="award-edit-remarks">
          <textarea id="award-edit-remarks" className={`${inputCls} min-h-[64px]`} maxLength={2000} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={`${btn.primary} !bg-blue-600 hover:!bg-blue-700`} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Dialog>
  );
};

const DeclareWinnersDialog: React.FC<{ detail: HrAwardDetail; preselect: string[]; onClose: () => void; onSaved: (d: HrAwardDetail, count: number) => void }> = ({
  detail, preselect, onClose, onSaved
}) => {
  const candidates = detail.nominees.filter(n => n.status !== 'WINNER');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect));
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!picked.size) { setError('Choose at least one nominee to declare a winner.'); return; }
    setSaving(true);
    setError(null);
    try {
      onSaved(await hrAwardsApi.declareWinners([...picked], remarks.trim() || undefined), picked.size);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog title={`Declare Winner — ${detail.award.name}`} description={`${detail.monthLabel}. Choose one or more nominees; each is recorded as a separate winner.`} onClose={onClose} persistent={saving}>
      <form className="space-y-3" onSubmit={submit}>
        <fieldset className="space-y-1.5 max-h-64 overflow-y-auto">
          <legend className="sr-only">Nominees</legend>
          {candidates.map(n => (
            <label key={n.id} className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${picked.has(n.id) ? 'border-amber-300 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <input type="checkbox" className="mt-0.5 accent-amber-600" checked={picked.has(n.id)} onChange={() => toggle(n.id)} />
              <span className="text-xs">
                <span className="font-semibold text-slate-900 block">{n.name}</span>
                <span className="text-slate-500">{[n.departmentName, subline(n)].filter(x => x && x !== '—').join(' · ')}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Winner remarks" htmlFor="award-winner-remarks">
          <textarea id="award-winner-remarks" className={`${inputCls} min-h-[64px]`} maxLength={2000} value={remarks} onChange={e => setRemarks(e.target.value)}
            placeholder="Optional: why they won" />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={`${btn.primary} !bg-amber-600 hover:!bg-amber-700`} disabled={saving || !picked.size}>
            <Trophy className="w-4 h-4" /> {saving ? 'Declaring…' : `Declare ${picked.size || ''} winner${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

/** A confirmation with one text field (remove a nominee, revoke a winner, winner remarks). */
const ReasonDialog: React.FC<{
  title: string; description?: string; label: string; required: boolean; confirm: string; danger?: boolean; initial?: string; max?: number;
  onClose: () => void; onConfirm: (text: string) => Promise<void>;
}> = ({ title, description, label, required, confirm, danger, initial = '', max = 500, onClose, onConfirm }) => {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (required && text.trim().length < 3) { setError('Enter the reason (at least 3 characters).'); return; }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(text.trim());
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };
  return (
    <Dialog title={title} description={description} onClose={onClose} persistent={saving}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label={label} required={required} htmlFor="award-reason-text">
          <textarea id="award-reason-text" className={`${inputCls} min-h-[72px]`} maxLength={max} value={text} onChange={e => setText(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={danger ? `${btn.danger} !bg-rose-600 !text-white hover:!bg-rose-700` : `${btn.primary} !bg-blue-600 hover:!bg-blue-700`} disabled={saving}>
            {saving ? 'Saving…' : confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default AwardsManagement;
