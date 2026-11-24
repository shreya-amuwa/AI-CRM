import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Award, Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Crown, Medal, Pencil, Plus, Rocket, Search,
  ShieldCheck, Sparkles, Star, Trash2, Trophy, Undo2, Users
} from 'lucide-react';
import { hrAwardsApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { officeToday } from '../../lib/officeTime';
import { awardNominateSchema } from '../../../shared/validation';
import type {
  HrAwardCard, HrAwardCode, HrAwardDetail, HrAwardNominee, HrAwardNomineeType, HrAwardOptions, HrAwardStatus, HrAwardWinner, HrAwardsOverview
} from '../../../shared/contracts';
import { Dialog, ErrorBanner, Field, inputCls, Spinner } from '../team-member/pipeline/shared';
import { HrEmptyState, HrPageHeader, HrSectionTitle, hrBtn, hrCard } from './hrUi';

/**
 * HR dashboard > Award Management > Awards (migration 20270203000100).
 * Seven monthly awards. For the chosen month HR adds any number of nominees (employees, teams or departments picked from the CRM),
 * edits or removes them, and declares one or more winners (confirmed before saving; revocable, with a reason). Every month is kept
 * separately, so earlier months stay as they were. Everything is read from and saved to the database; the database decides who may
 * (HR staff and the Super Admin).
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
const TYPE_NOUN: Record<HrAwardNomineeType, string> = { INDIVIDUAL: 'employee', TEAM: 'team', DEPARTMENT: 'department' };
const STATUS_LABEL: Record<HrAwardStatus, string> = { NO_NOMINEES: 'No nominees yet', NOMINATIONS_OPEN: 'Nominations open', WINNERS_DECLARED: 'Winner declared' };
const STATUS_STYLE: Record<HrAwardStatus, string> = {
  NO_NOMINEES: 'bg-slate-100 text-slate-600',
  NOMINATIONS_OPEN: 'bg-blue-50 text-blue-700',
  WINNERS_DECLARED: 'bg-emerald-50 text-emerald-700'
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const currentMonth = () => officeToday().slice(0, 7);
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
};
const MIN_MONTH = '2020-01';
const maxMonth = () => shiftMonth(currentMonth(), 12);
const clampMonth = (m: string) => (m < MIN_MONTH ? MIN_MONTH : m > maxMonth() ? maxMonth() : m);
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
const designationOrTeam = (x: { nomineeType: HrAwardNomineeType; designation: string | null; teamName: string | null; departmentName: string | null }) =>
  x.nomineeType === 'INDIVIDUAL'
    ? [x.designation, x.teamName].filter(Boolean).join(' · ') || '—'
    : x.nomineeType === 'TEAM' ? 'Team' : 'Department';

const StatusPill: React.FC<{ status: HrAwardStatus }> = ({ status }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLE[status]}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${status === 'WINNERS_DECLARED' ? 'bg-emerald-500' : status === 'NOMINATIONS_OPEN' ? 'bg-blue-500' : 'bg-slate-400'}`} aria-hidden="true" />
    {STATUS_LABEL[status]}
  </span>
);

const AwardIcon: React.FC<{ code: HrAwardCode; size?: 'md' | 'lg' }> = ({ code, size = 'md' }) => {
  const Icon = AWARD_ICON[code] ?? Award;
  return (
    <span className={`${size === 'lg' ? 'w-12 h-12' : 'w-10 h-10'} rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0`} aria-hidden="true">
      <Icon className={size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'} />
    </span>
  );
};

interface Props {
  onToast?: (message: string) => void;
  /** Each increase opens the Add Nominee form with the award to choose ("Nominate Star Award"). */
  nominateSignal?: number;
}

type AwardRef = { code: HrAwardCode; name: string; nomineeType: HrAwardNomineeType };

export const AwardsManagement: React.FC<Props> = ({ onToast, nominateSignal = 0 }) => {
  const [month, setMonth] = useState<string>(currentMonth);
  const [overview, setOverview] = useState<HrAwardsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<HrAwardCode | null>(null);
  const [nominating, setNominating] = useState(false);
  // bumped after a nomination made from the header, so an open award page reloads too
  const [detailVersion, setDetailVersion] = useState(0);

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

  // "Nominate Star Award" (in the Award Management bar): open the form, not on the first render
  const seenSignal = useRef(nominateSignal);
  useEffect(() => {
    if (nominateSignal !== seenSignal.current) {
      seenSignal.current = nominateSignal;
      setNominating(true);
    }
  }, [nominateSignal]);

  const toast = (m: string) => onToast?.(m);
  const awards: AwardRef[] = overview?.awards.map(a => ({ code: a.code, name: a.name, nomineeType: a.nomineeType })) ?? [];
  const historyMonths = useMemo(() => new Set(overview?.history.map(h => h.month) ?? []), [overview]);

  const nominateDialog = nominating && awards.length > 0 && (
    <AddNomineeDialog
      awards={awards}
      initialCode={openCode ?? awards[0].code}
      initialMonth={month}
      chooseAward
      onClose={() => setNominating(false)}
      onSaved={(d, name, again) => {
        toast(`${name} nominated for ${d.award.name} – ${d.monthLabel}.`);
        if (!again) setNominating(false);
        if (d.month !== month) setMonth(d.month); else void loadOverview();
        setDetailVersion(v => v + 1);
      }}
    />
  );

  if (openCode) {
    return (
      <>
        <AwardDetailView
          key={detailVersion}
          code={openCode}
          month={month}
          historyMonths={historyMonths}
          onMonthChange={setMonth}
          onBack={() => { setOpenCode(null); void loadOverview(); }}
          onToast={toast}
        />
        {nominateDialog}
      </>
    );
  }

  const totals = overview?.awards.reduce((t, a) => ({ nominees: t.nominees + a.nominees, winners: t.winners + a.winners, decided: t.decided + (a.winners > 0 ? 1 : 0) }),
    { nominees: 0, winners: 0, decided: 0 });

  return (
    <div className="space-y-5">
      <section className={`${hrCard} p-4 sm:p-5`}>
        <HrPageHeader
          as="h2"
          icon={Trophy}
          title="Employee Recognition & Awards"
          subtitle="Recognising outstanding performance, leadership, teamwork and professional excellence across Amuwa Corporation."
          actions={<MonthSwitcher month={month} onChange={setMonth} highlight={historyMonths} />}
        />
        {overview && totals && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <p className="text-[13px] text-slate-600">
              <span className="font-semibold text-slate-900">{overview.monthLabel}:</span>{' '}
              {totals.nominees} nominee{totals.nominees === 1 ? '' : 's'} · {totals.winners} winner{totals.winners === 1 ? '' : 's'} ·{' '}
              {totals.decided} of {overview.awards.length} awards decided
            </p>
            {overview.history.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" aria-label="Award history">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 shrink-0 mr-1">Award history</span>
                {overview.history.slice(0, 8).map(h => (
                  <button
                    key={h.month}
                    type="button"
                    onClick={() => setMonth(h.month)}
                    aria-pressed={h.month === month}
                    title={`${h.monthLabel}: ${h.nominees} nominees, ${h.winners} winners`}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                      h.month === month ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
                    }`}
                  >
                    {h.monthLabel} · {h.winners} winner{h.winners === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {error && <ErrorBanner message={error} onRetry={() => void loadOverview()} />}
      {loading && !overview ? (
        <Spinner label="Loading awards…" />
      ) : overview ? (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {overview.awards.map(a => (
            <AwardCard key={a.code} award={a} monthLabel={overview.monthLabel} onManage={() => setOpenCode(a.code)} />
          ))}
        </div>
      ) : null}
      {nominateDialog}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Month and year
// ---------------------------------------------------------------------------
/** Previous month, the month shown (opens a month/year picker), next month. Months that have award records carry a dot. */
const MonthSwitcher: React.FC<{ month: string; onChange: (m: string) => void; highlight?: Set<string> }> = ({ month, onChange, highlight }) => {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setYear(Number(month.slice(0, 4))); }, [open, month]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const max = maxMonth();
  const now = currentMonth();
  return (
    <div className="flex items-center gap-2" ref={box}>
      <div className="relative flex items-center rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <button type="button" onClick={() => onChange(prev)} disabled={prev < MIN_MONTH} aria-label="Previous month"
          className="h-9 w-9 flex items-center justify-center text-slate-600 hover:bg-slate-50 rounded-l-lg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Award month: ${monthLabel(month)}. Choose another month`}
          className="h-9 min-w-[150px] px-3 flex items-center justify-center gap-2 border-x border-slate-200 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
          <CalendarDays className="w-4 h-4 text-blue-600" aria-hidden="true" />
          <span>{monthLabel(month)}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onChange(next)} disabled={next > max} aria-label="Next month"
          className="h-9 w-9 flex items-center justify-center text-slate-600 hover:bg-slate-50 rounded-r-lg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
          <ChevronRight className="w-4 h-4" />
        </button>
        {open && (
          <div role="dialog" aria-label="Choose the award month" className="absolute right-0 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 top-full mt-2 z-30 w-64 rounded-xl border border-slate-200 bg-white shadow-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <button type="button" className={hrBtn.icon} onClick={() => setYear(y => y - 1)} disabled={year <= 2020} aria-label="Previous year"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-bold text-slate-900">{year}</span>
              <button type="button" className={hrBtn.icon} onClick={() => setYear(y => y + 1)} disabled={`${year + 1}-01` > max} aria-label="Next year"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS.map((m, i) => {
                const value = `${year}-${String(i + 1).padStart(2, '0')}`;
                const selected = value === month;
                const disabled = value < MIN_MONTH || value > max;
                return (
                  <button key={m} type="button" disabled={disabled} aria-pressed={selected} aria-label={monthLabel(value)}
                    onClick={() => { onChange(value); setOpen(false); }}
                    className={`relative h-9 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                      selected ? 'bg-blue-600 text-white' : value === now ? 'border border-blue-200 text-blue-700 hover:bg-blue-50' : 'text-slate-700 hover:bg-slate-100'
                    }`}>
                    {m}
                    {highlight?.has(value) && !selected && <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" /> Has award records</span>
              <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => { onChange(now); setOpen(false); }}>This month</button>
            </div>
          </div>
        )}
      </div>
      {month !== now && (
        <button type="button" className={`${hrBtn.ghost} hidden sm:inline-flex`} onClick={() => onChange(now)}>This month</button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Award cards
// ---------------------------------------------------------------------------
const AwardCard: React.FC<{ award: HrAwardCard; monthLabel: string; onManage: () => void }> = ({ award, monthLabel: label, onManage }) => (
  <article className={`${hrCard} p-5 flex flex-col h-full hover:border-blue-200 hover:shadow-md transition-all`} aria-label={award.name}>
    <div className="flex items-start justify-between gap-3">
      <AwardIcon code={award.code} />
      <StatusPill status={award.status} />
    </div>
    {/* two lines kept for every title, so the cards line up whatever the award's name */}
    <h3 className="mt-3.5 text-[15px] font-semibold text-slate-900 leading-snug min-h-[2.6em] line-clamp-2">{award.name}</h3>
    <p className="mt-1 text-xs text-slate-500 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> {label}</p>

    <dl className="mt-4 grid grid-cols-2 rounded-lg border border-slate-200 divide-x divide-slate-200">
      <div className="px-3.5 py-2.5">
        <dt className="text-[11px] font-medium text-slate-500">Nominees</dt>
        <dd className="text-xl font-bold text-slate-900 leading-tight">{award.nominees}</dd>
      </div>
      <div className="px-3.5 py-2.5">
        <dt className="text-[11px] font-medium text-slate-500">Winners</dt>
        <dd className={`text-xl font-bold leading-tight ${award.winners ? 'text-amber-700' : 'text-slate-900'}`}>{award.winners}</dd>
      </div>
    </dl>

    <p className={`mt-3 h-5 text-xs flex items-center gap-1.5 min-w-0 ${award.winnerNames.length ? 'text-amber-800' : 'text-slate-400'}`}>
      <Trophy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate" title={award.winnerNames.join(', ') || undefined}>
        {award.winnerNames.length ? award.winnerNames.join(', ') : 'No winner declared yet'}
      </span>
    </p>

    <div className="mt-auto pt-4">
      <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{TYPE_LABEL[award.nomineeType]} nominees</span>
        <button type="button" onClick={onManage} className={`${hrBtn.secondary} text-blue-700 hover:text-blue-800`} aria-label={`Manage ${award.name}`}>
          Manage Award <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  </article>
);

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
  code: HrAwardCode; month: string; historyMonths: Set<string>; onMonthChange: (m: string) => void; onBack: () => void; onToast: (m: string) => void;
}> = ({ code, month, historyMonths, onMonthChange, onBack, onToast }) => {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={hrBtn.secondary}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All awards
        </button>
        <MonthSwitcher month={month} onChange={onMonthChange} highlight={historyMonths} />
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !detail ? <Spinner label="Loading the award…" /> : detail && (
        <>
          {/* A. Award overview */}
          <section aria-labelledby="award-overview" className={`${hrCard} p-4 sm:p-5`}>
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <AwardIcon code={code} size="lg" />
                <div className="min-w-0">
                  <p id="award-overview" className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Award overview</p>
                  <h2 className="text-lg sm:text-xl font-bold font-heading text-slate-900 leading-tight">{detail.award.name}</h2>
                  <p className="text-[13px] text-slate-500 mt-0.5">{detail.monthLabel} · {TYPE_LABEL[detail.award.nomineeType]} nominees</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={hrBtn.primary} onClick={() => setAction({ kind: 'add' })}>
                  <Plus className="w-4 h-4" aria-hidden="true" /> Add Nominee
                </button>
                <button type="button" className={hrBtn.secondary} disabled={!declarable.length} onClick={() => setAction({ kind: 'declare', preselect: [] })}
                  title={declarable.length ? undefined : detail.nominees.length ? 'Every nominee is already a winner' : 'Add nominees first'}>
                  <Trophy className="w-4 h-4 text-amber-600" aria-hidden="true" /> Declare Winner
                </button>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-px rounded-lg border border-slate-200 bg-slate-200 overflow-hidden">
              <Stat label="Award period" value={detail.monthLabel} />
              <Stat label="Total nominees" value={String(detail.totalNominees)} />
              <Stat label="Total winners" value={String(detail.totalWinners)} tone={detail.totalWinners ? 'amber' : undefined} />
              <div className="px-4 py-3 bg-white">
                <dt className="text-[11px] font-medium text-slate-500">Award status</dt>
                <dd className="mt-1.5"><StatusPill status={detail.status} /></dd>
              </div>
            </dl>
          </section>

          <div className="grid grid-cols-1 2xl:grid-cols-3 gap-5 items-start">
            {/* B. Nominees */}
            <section aria-labelledby="award-nominees" className={`${hrCard} p-4 sm:p-5 space-y-4 2xl:col-span-2`}>
              <HrSectionTitle id="award-nominees" icon={Users} title="Nominees" count={detail.nominees.length}
                actions={detail.nominees.length > 0 && (
                  <button type="button" className={hrBtn.ghost} onClick={() => setAction({ kind: 'add' })}><Plus className="w-4 h-4" aria-hidden="true" /> Add</button>
                )} />
              {!detail.nominees.length ? (
                <HrEmptyState icon={Award} title={`No nominees for ${detail.monthLabel} yet`}
                  hint="Add as many nominees as you need, then declare one or more winners."
                  action={<button type="button" className={hrBtn.primary} onClick={() => setAction({ kind: 'add' })}><Plus className="w-4 h-4" aria-hidden="true" /> Add Nominee</button>} />
              ) : (
                <>
                  {/* a table on wider screens */}
                  <div className="hidden md:block overflow-x-auto -mx-4 sm:-mx-5">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-y border-slate-200">
                          <th scope="col" className="py-2.5 pl-4 sm:pl-5 pr-3 font-semibold">Nominee</th>
                          <th scope="col" className="py-2.5 pr-3 font-semibold">Department</th>
                          <th scope="col" className="py-2.5 pr-3 font-semibold">Designation / team</th>
                          <th scope="col" className="py-2.5 pr-3 font-semibold">Nomination reason</th>
                          <th scope="col" className="py-2.5 pr-3 font-semibold whitespace-nowrap">Nominated on</th>
                          <th scope="col" className="py-2.5 pr-3 font-semibold">Status</th>
                          <th scope="col" className="py-2.5 pr-4 sm:pr-5 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detail.nominees.map(n => (
                          <tr key={n.id} className={`align-top ${n.status === 'WINNER' ? 'bg-amber-50/40' : 'hover:bg-slate-50/60'}`}>
                            <td className="py-3 pl-4 sm:pl-5 pr-3">
                              <p className="font-semibold text-slate-900">{n.name}</p>
                              <p className="text-[11px] text-slate-400">{TYPE_LABEL[n.nomineeType]}</p>
                            </td>
                            <td className="py-3 pr-3 text-slate-700">{n.departmentName || '—'}</td>
                            <td className="py-3 pr-3 text-slate-700">{designationOrTeam(n)}</td>
                            <td className="py-3 pr-3 text-slate-700 max-w-[280px]">
                              <p className="line-clamp-2 break-words" title={n.reason}>{n.reason}</p>
                              {n.remarks && <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-1 break-words" title={n.remarks}>Remarks: {n.remarks}</p>}
                            </td>
                            <td className="py-3 pr-3 text-slate-700 whitespace-nowrap">{fmtDate(n.nominatedAt)}</td>
                            <td className="py-3 pr-3"><NomineeStatus status={n.status} /></td>
                            <td className="py-3 pr-4 sm:pr-5 text-right whitespace-nowrap">
                              <NomineeActions nominee={n} onAction={setAction} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* cards on a phone */}
                  <ul className="md:hidden space-y-2.5">
                    {detail.nominees.map(n => (
                      <li key={n.id} className={`rounded-lg border p-3.5 ${n.status === 'WINNER' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 text-sm">{n.name}</p>
                            <p className="text-xs text-slate-500">{[n.departmentName, designationOrTeam(n)].filter(x => x && x !== '—').join(' · ')}</p>
                          </div>
                          <NomineeStatus status={n.status} />
                        </div>
                        <p className="mt-2 text-[13px] text-slate-700 break-words">{n.reason}</p>
                        {n.remarks && <p className="mt-1 text-xs text-slate-500 break-words">Remarks: {n.remarks}</p>}
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">Nominated {fmtDate(n.nominatedAt)}</span>
                          <NomineeActions nominee={n} onAction={setAction} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {/* C. Winners: set apart from the nominees with a quiet gold treatment */}
            <section aria-labelledby="award-winners" className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 sm:p-5 space-y-3">
              <HrSectionTitle id="award-winners" icon={Trophy} title="Winners" count={detail.winners.length} tone="amber" />
              {!detail.winners.length ? (
                <p className="text-[13px] text-amber-900/70">
                  No winner declared for {detail.monthLabel} yet.{declarable.length ? ' Use "Declare Winner" to choose one or more nominees.' : ''}
                </p>
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-1 gap-3">
                  {detail.winners.map(w => (
                    <li key={w.id} className="rounded-lg bg-white border border-amber-200 p-4">
                      <div className="flex items-start gap-3">
                        <span className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0" aria-hidden="true"><Medal className="w-4 h-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900">{w.name}</p>
                          <p className="text-xs text-slate-500">{[w.departmentName, w.nomineeType === 'INDIVIDUAL' ? w.teamName : null].filter(Boolean).join(' · ') || '—'}</p>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div><dt className="text-slate-500">Award period</dt><dd className="font-semibold text-slate-800">{detail.monthLabel}</dd></div>
                        <div><dt className="text-slate-500">Declared on</dt><dd className="font-semibold text-slate-800">{fmtDate(w.declaredAt)}</dd></div>
                      </dl>
                      <p className="mt-2 text-xs text-slate-700 break-words"><span className="text-slate-500">Remarks: </span>{w.remarks || '—'}</p>
                      <div className="mt-3 pt-3 border-t border-amber-100 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">{w.declaredBy ? `Declared by ${w.declaredBy}` : ''}</span>
                        <div className="flex gap-1.5">
                          <button type="button" className={hrBtn.icon} onClick={() => setAction({ kind: 'winnerRemarks', winner: w })} aria-label={`Edit remarks for ${w.name}`} title="Edit remarks">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" className={`${hrBtn.icon} text-rose-600 hover:text-rose-700 hover:bg-rose-50`} onClick={() => setAction({ kind: 'revoke', winner: w })} aria-label={`Revoke ${w.name} as winner`} title="Revoke">
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {detail.revokedWinners.length > 0 && (
                <div>
                  <button type="button" className="text-xs font-semibold text-amber-800 hover:underline" onClick={() => setShowRevoked(v => !v)} aria-expanded={showRevoked}>
                    {showRevoked ? 'Hide' : 'Show'} revoked declarations ({detail.revokedWinners.length})
                  </button>
                  {showRevoked && (
                    <ul className="mt-2 space-y-1.5">
                      {detail.revokedWinners.map(w => (
                        <li key={w.id} className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
                          <span className="font-semibold line-through">{w.name}</span> — declared {fmtDate(w.declaredAt)}, revoked {fmtDate(w.revokedAt)}
                          {w.revokedBy ? ` by ${w.revokedBy}` : ''}: {w.revokeReason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {detail && action?.kind === 'add' && (
        <AddNomineeDialog awards={[detail.award]} initialCode={detail.award.code} initialMonth={detail.month} onClose={() => setAction(null)} onSaved={(d, name, again) => {
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

const NomineeStatus: React.FC<{ status: HrAwardNominee['status'] }> = ({ status }) =>
  status === 'WINNER'
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold whitespace-nowrap"><Trophy className="w-3 h-3" aria-hidden="true" /> Winner</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold whitespace-nowrap">Nominated</span>;

const NomineeActions: React.FC<{ nominee: HrAwardNominee; onAction: (a: Action) => void }> = ({ nominee: n, onAction }) => (
  <div className="inline-flex gap-1.5">
    {n.status !== 'WINNER' && (
      <button type="button" className={`${hrBtn.icon} text-amber-600 hover:text-amber-700`} onClick={() => onAction({ kind: 'declare', preselect: [n.id] })} aria-label={`Declare ${n.name} a winner`} title="Declare winner">
        <Trophy className="w-3.5 h-3.5" />
      </button>
    )}
    <button type="button" className={hrBtn.icon} onClick={() => onAction({ kind: 'edit', nominee: n })} aria-label={`Edit nomination of ${n.name}`} title="Edit">
      <Pencil className="w-3.5 h-3.5" />
    </button>
    <button type="button" className={`${hrBtn.icon} text-rose-600 hover:text-rose-700 hover:bg-rose-50`} onClick={() => onAction({ kind: 'remove', nominee: n })} aria-label={`Remove ${n.name}`} title="Remove">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  </div>
);

const Stat: React.FC<{ label: string; value: string; tone?: 'amber' }> = ({ label, value, tone }) => (
  <div className="px-4 py-3 bg-white">
    <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
    <dd className={`mt-0.5 text-base font-bold ${tone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</dd>
  </div>
);

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
interface PickItem { id: string; name: string; meta: string; departmentName: string | null; teamName: string | null; designation: string | null; members?: number }

const yearsAround = () => {
  const max = Number(maxMonth().slice(0, 4));
  return Array.from({ length: max - 2020 + 1 }, (_, i) => max - i);
};

const AddNomineeDialog: React.FC<{
  awards: AwardRef[];
  initialCode: HrAwardCode;
  initialMonth: string;
  /** opened from "Nominate Star Award": the award is chosen in the form */
  chooseAward?: boolean;
  onClose: () => void;
  onSaved: (d: HrAwardDetail, name: string, again: boolean) => void;
}> = ({ awards, initialCode, initialMonth, chooseAward = false, onClose, onSaved }) => {
  const [code, setCode] = useState<HrAwardCode>(initialCode);
  const award = awards.find(a => a.code === code) ?? awards[0];
  const type = award.nomineeType;
  const noun = TYPE_NOUN[type];
  const [options, setOptions] = useState<HrAwardOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [entityId, setEntityId] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [month, setMonth] = useState(initialMonth);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    hrAwardsApi.options().then(o => live && setOptions(o)).catch(err => live && setOptionsError(errorMessage(err)));
    return () => { live = false; };
  }, []);
  // who is already nominated for this award in the chosen month (they cannot be picked again)
  const loadTaken = useCallback(async () => {
    try {
      const d = await hrAwardsApi.detail(code, month);
      setTaken(new Set(d.nominees.map(n => n.entityId)));
    } catch {
      setTaken(new Set()); // the server still refuses a duplicate with a clear message
    }
  }, [code, month]);
  useEffect(() => { void loadTaken(); }, [loadTaken]);

  const items: PickItem[] = useMemo(() => {
    if (!options) return [];
    if (type === 'INDIVIDUAL') {
      return options.employees.map(e => ({ id: e.id, name: e.name, meta: [e.designation, e.departmentName, e.teamName].filter(Boolean).join(' · '),
        departmentName: e.departmentName, teamName: e.teamName, designation: e.designation }));
    }
    if (type === 'TEAM') {
      return options.teams.map(t => ({ id: t.id, name: t.name, meta: `${t.departmentName} · ${t.members} member${t.members === 1 ? '' : 's'}`,
        departmentName: t.departmentName, teamName: t.name, designation: null, members: t.members }));
    }
    return options.departments.map(d => ({ id: d.id, name: d.name, meta: `${d.members} member${d.members === 1 ? '' : 's'}`, departmentName: d.name, teamName: null, designation: null, members: d.members }));
  }, [options, type]);
  const q = search.trim().toLowerCase();
  const shown = items.filter(i => !q || i.name.toLowerCase().includes(q) || i.meta.toLowerCase().includes(q)).slice(0, 100);
  const chosen = items.find(i => i.id === entityId) ?? null;

  const changeAward = (next: HrAwardCode) => {
    const nextType = awards.find(a => a.code === next)?.nomineeType;
    setCode(next);
    if (nextType !== type) { setEntityId(''); setSearch(''); }
  };
  const [y, m] = month.split('-');

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
      const d = await hrAwardsApi.nominate(code, parsed.data);
      onSaved(d, chosen?.name ?? 'The nominee', again);
      if (again) {
        setTaken(new Set(d.nominees.map(n => n.entityId)));
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
    <Dialog title={chooseAward ? 'Nominate Star Award' : `Add Nominee — ${award.name}`}
      description="Choose from the CRM's records. You can add as many nominees as you need." onClose={onClose} size="xl" persistent={saving}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(false); }} noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* left: what and who */}
          <div className="space-y-3.5">
            {chooseAward && (
              <Field label="Award" required htmlFor="award-choose">
                <select id="award-choose" className={inputCls} value={code} onChange={e => changeAward(e.target.value as HrAwardCode)}>
                  {awards.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                </select>
              </Field>
            )}
            <fieldset>
              <legend className="block text-xs font-medium text-slate-600 mb-1">Nominee type *</legend>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-100" role="radiogroup" aria-label="Nominee type">
                {(['INDIVIDUAL', 'TEAM', 'DEPARTMENT'] as const).map(t => (
                  <label key={t} className={`text-center px-2 py-1.5 rounded-md text-xs font-semibold ${
                    t === type ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-400 cursor-not-allowed'}`}>
                    <input type="radio" name="nominee-type" className="sr-only" checked={t === type} disabled={t !== type} readOnly />
                    {TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{award.name} takes {TYPE_LABEL[type].toLowerCase()} nominees.</p>
            </fieldset>

            <Field label={`Nominee (${noun})`} required htmlFor="award-nominee-search" error={fieldErrors.entityId}>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input id="award-nominee-search" className={`${inputCls} pl-9`} placeholder={`Search ${noun}s${type === 'INDIVIDUAL' ? ' by name, department or designation' : ''}`}
                  value={search} onChange={e => setSearch(e.target.value)} autoComplete="off" />
              </div>
            </Field>
            {optionsError && <ErrorBanner message={optionsError} />}
            {!options && !optionsError ? <Spinner label={`Loading ${noun}s…`} /> : options && (
              <ul role="listbox" aria-label={`Choose the ${noun}`} className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {!shown.length && <li className="p-3 text-xs text-slate-500">{items.length ? `No ${noun} matches “${search}”.` : `There are no ${noun}s in the CRM yet.`}</li>}
                {shown.map(i => {
                  const isTaken = taken.has(i.id);
                  const selected = i.id === entityId;
                  return (
                    <li key={i.id} role="option" aria-selected={selected} aria-disabled={isTaken}>
                      <button type="button" disabled={isTaken} onClick={() => setEntityId(i.id)}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                        <span className="flex-1 min-w-0">
                          <span className="font-semibold text-slate-900">{i.name}</span>
                          {isTaken && <span className="ml-2 text-[10px] font-bold text-blue-700">Already nominated</span>}
                          {i.meta && <span className="block text-[11px] text-slate-500 truncate">{i.meta}</span>}
                        </span>
                        {selected && <Check className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* right: the chosen nominee (from the CRM), the month and why */}
          <div className="space-y-3.5">
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5" aria-live="polite">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Selected nominee</p>
              {chosen ? (
                <>
                  <p className="mt-1 text-sm font-bold text-slate-900" data-testid="nominee-name">{chosen.name}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {type !== 'DEPARTMENT' && <><dt className="text-slate-500">Department</dt><dd className="text-slate-800 font-medium" data-testid="nominee-department">{chosen.departmentName || '—'}</dd></>}
                    {type === 'INDIVIDUAL' && <><dt className="text-slate-500">Team</dt><dd className="text-slate-800 font-medium">{chosen.teamName || '—'}</dd></>}
                    {type === 'INDIVIDUAL' && <><dt className="text-slate-500">Designation</dt><dd className="text-slate-800 font-medium" data-testid="nominee-designation">{chosen.designation || '—'}</dd></>}
                    {type !== 'INDIVIDUAL' && <><dt className="text-slate-500">Active members</dt><dd className="text-slate-800 font-medium">{chosen.members ?? '—'}</dd></>}
                  </dl>
                </>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Choose the {noun} from the list. {type === 'INDIVIDUAL' ? 'Their department, team and designation come from the CRM.' : 'Its details come from the CRM.'}</p>
              )}
            </div>
            <fieldset>
              <legend className="block text-xs font-medium text-slate-600 mb-1">Award month and year *</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="sr-only" htmlFor="award-nominee-month">Month</label>
                <select id="award-nominee-month" className={inputCls} value={m}
                  onChange={e => setMonth(clampMonth(`${y}-${e.target.value}`))}>
                  {MONTHS_LONG.map((name, i) => {
                    const v = String(i + 1).padStart(2, '0');
                    return <option key={v} value={v} disabled={`${y}-${v}` > maxMonth()}>{name}</option>;
                  })}
                </select>
                <label className="sr-only" htmlFor="award-nominee-year">Year</label>
                <select id="award-nominee-year" className={inputCls} value={y} onChange={e => setMonth(clampMonth(`${e.target.value}-${m}`))}>
                  {yearsAround().map(yy => <option key={yy} value={String(yy)}>{yy}</option>)}
                </select>
              </div>
              {fieldErrors.month && <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.month}</p>}
              {month !== initialMonth && <p className="mt-1 text-[11px] text-blue-700">This nominee will be added to {monthLabel(month)}.</p>}
            </fieldset>
            <Field label="Reason for nomination" required htmlFor="award-nominee-reason" error={fieldErrors.reason}>
              <textarea id="award-nominee-reason" className={`${inputCls} min-h-[84px]`} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="What did they achieve this month?" aria-invalid={!!fieldErrors.reason} />
            </Field>
            <Field label="Supporting remarks" htmlFor="award-nominee-remarks" error={fieldErrors.remarks}>
              <textarea id="award-nominee-remarks" className={`${inputCls} min-h-[60px]`} maxLength={2000} value={remarks} onChange={e => setRemarks(e.target.value)}
                placeholder="Optional: feedback, numbers, who recommended them" />
            </Field>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}
        <div className="pt-3 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className={hrBtn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={hrBtn.secondary} onClick={() => void submit(true)} disabled={saving}>Save &amp; add another</button>
          <button type="submit" className={hrBtn.primary} disabled={saving}>{saving ? 'Saving…' : 'Add nominee'}</button>
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
    <Dialog title={`Edit nomination — ${nominee.name}`} description="To nominate someone else, remove this nominee and add the new one." onClose={onClose} size="lg" persistent={saving}>
      <form className="space-y-3.5" onSubmit={submit}>
        <Field label="Reason for nomination" required htmlFor="award-edit-reason">
          <textarea id="award-edit-reason" className={`${inputCls} min-h-[96px]`} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        <Field label="Supporting remarks" htmlFor="award-edit-remarks">
          <textarea id="award-edit-remarks" className={`${inputCls} min-h-[64px]`} maxLength={2000} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" className={hrBtn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={hrBtn.primary} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Dialog>
  );
};

/** Choose one or more nominees and the remarks, then confirm before anything is saved. */
const DeclareWinnersDialog: React.FC<{ detail: HrAwardDetail; preselect: string[]; onClose: () => void; onSaved: (d: HrAwardDetail, count: number) => void }> = ({
  detail, preselect, onClose, onSaved
}) => {
  const candidates = detail.nominees.filter(n => n.status !== 'WINNER');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect));
  const [remarks, setRemarks] = useState('');
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allPicked = candidates.length > 0 && candidates.every(c => picked.has(c.id));
  const chosen = candidates.filter(c => picked.has(c.id));
  const review = (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked.size) { setError('Choose at least one nominee to declare a winner.'); return; }
    setError(null);
    setStep('confirm');
  };
  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await hrAwardsApi.declareWinners([...picked], remarks.trim() || undefined), picked.size);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };
  const n = picked.size;
  return (
    <Dialog title={step === 'choose' ? `Declare Winner — ${detail.award.name}` : 'Confirm winner declaration'}
      description={step === 'choose' ? `${detail.monthLabel}. Choose one or more nominees; each is recorded as a separate winner.` : undefined}
      onClose={onClose} size="lg" persistent={saving}>
      {step === 'choose' ? (
        <form className="space-y-3.5" onSubmit={review}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{n} of {candidates.length} selected</span>
            {candidates.length > 1 && (
              <button type="button" className="text-xs font-semibold text-blue-700 hover:underline"
                onClick={() => setPicked(allPicked ? new Set() : new Set(candidates.map(c => c.id)))}>
                {allPicked ? 'Clear selection' : 'Select all'}
              </button>
            )}
          </div>
          <fieldset className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
            <legend className="sr-only">Nominees</legend>
            {candidates.map(c => (
              <label key={c.id} className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${picked.has(c.id) ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="checkbox" className="mt-0.5 accent-amber-600" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="text-xs min-w-0">
                  <span className="font-semibold text-slate-900 block text-[13px]">{c.name}</span>
                  <span className="text-slate-500">{[c.departmentName, designationOrTeam(c)].filter(x => x && x !== '—').join(' · ')}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="Winner remarks" htmlFor="award-winner-remarks">
            <textarea id="award-winner-remarks" className={`${inputCls} min-h-[64px]`} maxLength={2000} value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Optional: why they won" />
          </Field>
          {error && <ErrorBanner message={error} />}
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button type="button" className={hrBtn.secondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={hrBtn.primary} disabled={!n}>
              Review {n || ''} winner{n === 1 ? '' : 's'} <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3.5">
          <p className="text-[13px] text-slate-700">
            You are declaring <strong>{n} winner{n === 1 ? '' : 's'}</strong> for <strong>{detail.award.name}</strong> – {detail.monthLabel}:
          </p>
          <ul className="rounded-lg border border-amber-200 bg-amber-50/50 divide-y divide-amber-100">
            {chosen.map(c => (
              <li key={c.id} className="px-3.5 py-2 flex items-center gap-2 text-[13px]">
                <Trophy className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                <span className="font-semibold text-slate-900">{c.name}</span>
                <span className="text-xs text-slate-500 truncate">{c.departmentName}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-600"><span className="text-slate-500">Winner remarks: </span>{remarks.trim() || '—'}</p>
          <p className="text-[11px] text-slate-500">The other nominees stay nominees. A declaration can be revoked later, with a reason.</p>
          {error && <ErrorBanner message={error} />}
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button type="button" className={hrBtn.secondary} onClick={() => setStep('choose')} disabled={saving}>
              <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Back
            </button>
            <button type="button" className={`${hrBtn.primary} !bg-amber-600 hover:!bg-amber-700`} onClick={() => void confirm()} disabled={saving}>
              <Trophy className="w-4 h-4" aria-hidden="true" /> {saving ? 'Declaring…' : `Confirm ${n} winner${n === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
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
      <form className="space-y-3.5" onSubmit={submit}>
        <Field label={label} required={required} htmlFor="award-reason-text">
          <textarea id="award-reason-text" className={`${inputCls} min-h-[72px]`} maxLength={max} value={text} onChange={e => setText(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" className={hrBtn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={danger ? `${hrBtn.primary} !bg-rose-600 hover:!bg-rose-700` : hrBtn.primary} disabled={saving}>
            {saving ? 'Saving…' : confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default AwardsManagement;
