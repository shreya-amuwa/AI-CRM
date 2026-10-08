import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, KeyRound, Search, UserCheck } from 'lucide-react';
import type {
  ChecklistItem,
  CustomerDocument,
  HandoverStage,
  Paginated,
  PipelineCustomer,
  PipelineCustomerDetail,
  Profile
} from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { documentsApi, pipelineApi, usersApi } from '../../lib/api/endpoints';
import {
  Avatar,
  btn,
  Card,
  Dialog,
  ErrorBanner,
  Field,
  inputCls,
  longDate,
  money,
  notifyPipelineChanged,
  Pager,
  Pill,
  selectCls,
  ServiceChips,
  Spinner,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog
} from '../team-member/pipeline/shared';

type BoardRole = 'DEPARTMENT_HEAD' | 'TEAM_HEAD' | 'TEAM_MEMBER';

const TABS: Record<BoardRole, { key: HandoverStage; label: string }[]> = {
  DEPARTMENT_HEAD: [
    { key: 'DEPARTMENT_HEAD', label: 'To assign' },
    { key: 'TEAM_LEAD', label: 'With team lead' },
    { key: 'TEAM_MEMBER', label: 'With team member' }
  ],
  TEAM_HEAD: [
    { key: 'TEAM_LEAD', label: 'To assign' },
    { key: 'TEAM_MEMBER', label: 'Assigned' }
  ],
  TEAM_MEMBER: [{ key: 'TEAM_MEMBER', label: 'My clients' }]
};

const COPY: Record<BoardRole, { title: string; subtitle: string; empty: string }> = {
  DEPARTMENT_HEAD: {
    title: 'Client hand-overs',
    subtitle: 'Customers the Technical Consultant has verified. Pass each one to a Team Lead of your department.',
    empty: 'No verified customers yet. They appear here once the Technical Consultant sends them to you.'
  },
  TEAM_HEAD: {
    title: 'Client hand-overs',
    subtitle: 'Customers your Department Head passed to you. Assign each one to a member of your team.',
    empty: 'Nothing has been passed to you yet.'
  },
  TEAM_MEMBER: {
    title: 'My clients',
    subtitle: 'Verified customers your Team Lead assigned to you.',
    empty: 'No client has been assigned to you yet.'
  }
};

const STAGE_PILL: Record<HandoverStage, { label: string; tone: 'indigo' | 'orange' | 'green' | 'slate' }> = {
  CONSULTANT: { label: 'With consultant', tone: 'slate' },
  DEPARTMENT_HEAD: { label: 'Waiting for a team lead', tone: 'orange' },
  TEAM_LEAD: { label: 'Waiting for a team member', tone: 'indigo' },
  TEAM_MEMBER: { label: 'Assigned', tone: 'green' }
};

const PAGE_SIZE = 9;

export const HandoverBoard: React.FC<{ role: BoardRole }> = ({ role }) => {
  const tabs = TABS[role];
  const copy = COPY[role];
  const { byCode } = useServiceCatalog();
  const [tab, setTab] = useState<HandoverStage>(tabs[0].key);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [acting, setActing] = useState<PipelineCustomer | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);
  const { profile } = useAuth();
  // A Team Lead / Team Member only works with the customers handed to them personally.
  const mine = role === 'TEAM_HEAD' ? 'TEAM_LEAD' : role === 'TEAM_MEMBER' ? 'TEAM_MEMBER' : undefined;

  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    Promise.all([
      pipelineApi.list({ stage: 'ONBOARDING', handover: tab, handoverMine: mine, search: debounced || undefined, page, pageSize: PAGE_SIZE, sort: 'newest' }),
      Promise.all(tabs.map(t => pipelineApi.list({ stage: 'ONBOARDING', handover: t.key, handoverMine: mine, page: 1, pageSize: 1 }).then(r => [t.key, r.total] as const)))
    ])
      .then(([list, c]) => {
        if (n !== seq.current) return;
        setData(list);
        setCounts(Object.fromEntries(c));
      })
      .catch(e => n === seq.current && setError(errorMessage(e)))
      .finally(() => n === seq.current && setLoading(false));
  }, [tab, debounced, page, tabs, mine]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [tab, debounced]);
  usePipelineRealtime(load);

  // Names for the "with …" lines (the list only carries ids).
  useEffect(() => {
    if (role === 'TEAM_MEMBER') return;
    usersApi.list({ pageSize: 100, status: 'ACTIVE' }).then(
      r => setPeople(new Map(r.items.map(p => [p.id, p.fullName]))),
      () => undefined
    );
  }, [role]);

  if (openId) {
    return (
      <HandoverDetail
        id={openId}
        role={role}
        onBack={() => setOpenId(null)}
        onAct={c => setActing(c)}
        actingOpen={!!acting}
        onChanged={() => {
          setActing(null);
          load();
        }}
        acting={acting}
        onCloseAct={() => setActing(null)}
      />
    );
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">{copy.title}</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5 max-w-2xl">{copy.subtitle}</p>
        </div>
        <label className="relative w-full md:w-72 shrink-0">
          <span className="sr-only">Search clients</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search client or business"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
      </div>

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Hand-over status" className="flex flex-wrap gap-1.5">
          {tabs.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                {t.label} <span className={active ? 'text-slate-300' : 'text-slate-400'}>{counts[t.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading clients…" />
      ) : data && data.items.length === 0 ? (
        <Card className="py-12 text-center text-sm text-slate-500">{debounced ? 'No clients match.' : copy.empty}</Card>
      ) : (
        <ul className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {data?.items.map(c => {
            const stage = c.onboarding?.handoverStage ?? 'DEPARTMENT_HEAD';
            const lead = c.onboarding?.teamLeadId ? people.get(c.onboarding.teamLeadId) : null;
            const member = c.onboarding?.teamMemberId ? people.get(c.onboarding.teamMemberId) : null;
            const canAct = (role === 'DEPARTMENT_HEAD' && (stage === 'DEPARTMENT_HEAD' || stage === 'TEAM_LEAD')) || (role === 'TEAM_HEAD' && (stage === 'TEAM_LEAD' || stage === 'TEAM_MEMBER') && c.onboarding?.teamLeadId === profile?.id);
            return (
              <li key={c.id}>
                <Card className="p-4 h-full flex flex-col">
                  <div className="flex items-start gap-3">
                    <Avatar name={c.company || c.name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-900 text-sm">{c.company || c.name}</div>
                      <div className="text-xs text-slate-500">
                        {c.name}
                        {c.city ? ` · ${c.city}` : ''}
                      </div>
                    </div>
                    <Pill tone={STAGE_PILL[stage].tone}>{STAGE_PILL[stage].label}</Pill>
                  </div>
                  <div className="mt-3">
                    <ServiceChips codes={c.services} catalog={byCode} max={3} />
                  </div>
                  <div className="mt-3 text-xs text-slate-600 space-y-0.5">
                    {c.onboarding?.toDepartmentHeadAt && <div>Verified {longDate(c.onboarding.toDepartmentHeadAt)}</div>}
                    {stage !== 'DEPARTMENT_HEAD' && <div>Team Lead: {lead || '—'}</div>}
                    {stage === 'TEAM_MEMBER' && <div>Team Member: {member || '—'}</div>}
                  </div>
                  <div className="mt-auto pt-4 flex items-center justify-between gap-2 border-t border-slate-100 mt-4">
                    <span className="font-bold text-slate-900 text-sm">{money(c.dealAmount)}</span>
                    <div className="flex items-center gap-2">
                      {canAct && (
                        <button type="button" className={btn.primary} onClick={() => setActing(c)} aria-label={`${role === 'DEPARTMENT_HEAD' ? 'Pass to a team lead' : 'Assign to a team member'}: ${c.company || c.name}`}>
                          <UserCheck className="w-3.5 h-3.5" /> {role === 'DEPARTMENT_HEAD' ? (stage === 'DEPARTMENT_HEAD' ? 'Pass to Team Lead' : 'Change Team Lead') : stage === 'TEAM_LEAD' ? 'Assign to member' : 'Reassign'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenId(c.id)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700"
                        aria-label={`Open ${c.company || c.name}`}
                      >
                        Open <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.total > PAGE_SIZE && (
        <Card>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="clients" onPage={setPage} />
        </Card>
      )}

      {acting && (
        <AssignDialog
          role={role === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD' : 'TEAM_HEAD'}
          customer={acting}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            notifyPipelineChanged();
            load();
          }}
        />
      )}
    </div>
  );
};

/** Pick a Team Lead (Department Head) or a Team Member (Team Lead) and hand the customer over. */
const AssignDialog: React.FC<{ role: 'DEPARTMENT_HEAD' | 'TEAM_HEAD'; customer: PipelineCustomer; onClose: () => void; onDone: () => void }> = ({
  role,
  customer,
  onClose,
  onDone
}) => {
  const { profile } = useAuth();
  const [options, setOptions] = useState<Profile[] | null>(null);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toLead = role === 'DEPARTMENT_HEAD';

  useEffect(() => {
    usersApi
      .list(
        toLead
          ? { role: 'TEAM_HEAD', status: 'ACTIVE', departmentId: profile?.departmentId || undefined, pageSize: 100 }
          : { role: 'TEAM_MEMBER', status: 'ACTIVE', teamId: profile?.teamId || undefined, pageSize: 100 }
      )
      .then(
        r => setOptions(r.items.filter(p => (toLead ? p.role === 'TEAM_HEAD' : p.role === 'TEAM_MEMBER' && p.teamId === profile?.teamId))),
        e => setError(errorMessage(e))
      );
  }, [toLead, profile?.departmentId, profile?.teamId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick) return setError(toLead ? 'Choose a Team Lead.' : 'Choose a Team Member.');
    setBusy(true);
    setError(null);
    try {
      if (toLead) await pipelineApi.passToTeamLead(customer.id, pick, note.trim() || null);
      else await pipelineApi.assignToTeamMember(customer.id, pick, note.trim() || null);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={toLead ? 'Pass to a Team Lead' : 'Assign to a Team Member'}
      description={`${customer.company || customer.name} — ${toLead ? 'the Team Lead then assigns it to a member of their team.' : 'the Team Member can then see the client and its details.'}`}
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label={toLead ? 'Team Lead' : 'Team Member'} required htmlFor="handover-pick">
          <select id="handover-pick" className={selectCls} value={pick} onChange={e => setPick(e.target.value)} disabled={!options}>
            <option value="">{options ? 'Choose…' : 'Loading…'}</option>
            {options?.map(p => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.team ? ` · ${p.team.name}` : ''}
              </option>
            ))}
          </select>
        </Field>
        {options && options.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            {toLead ? 'This department has no active Team Lead yet. Create one in Team Members & Access.' : 'Your team has no active Team Member yet.'}
          </p>
        )}
        <Field label="Note (optional)" htmlFor="handover-note">
          <textarea id="handover-note" rows={2} maxLength={1000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.primary} disabled={busy || !pick}>
            {busy ? 'Saving…' : toLead ? 'Pass to Team Lead' : 'Assign'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Read-only client details
// ---------------------------------------------------------------------------
const HandoverDetail: React.FC<{
  id: string;
  role: BoardRole;
  onBack: () => void;
  onAct: (c: PipelineCustomer) => void;
  actingOpen: boolean;
  acting: PipelineCustomer | null;
  onCloseAct: () => void;
  onChanged: () => void;
}> = ({ id, role, onBack, onAct, acting, onCloseAct, onChanged }) => {
  const { byCode } = useServiceCatalog();
  const { profile } = useAuth();
  const [c, setC] = useState<PipelineCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    pipelineApi.get(id).then(
      d => {
        setC(d);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [id]);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  const items = useMemo(() => (c?.checklist || []).filter(i => !(i.optional && !i.entry)), [c]);

  if (error && !c) return <ErrorBanner message={error} onRetry={load} />;
  if (!c) return <Spinner label="Loading client…" />;
  const h = c.handover;
  const stage = h?.stage ?? 'DEPARTMENT_HEAD';
  const canAct = (role === 'DEPARTMENT_HEAD' && (stage === 'DEPARTMENT_HEAD' || stage === 'TEAM_LEAD')) || (role === 'TEAM_HEAD' && (stage === 'TEAM_LEAD' || stage === 'TEAM_MEMBER') && h?.teamLead?.id === profile?.id);

  return (
    <div className="space-y-5 max-w-6xl">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {COPY[role].title}
      </button>

      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar name={c.company || c.name} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900">{c.company || c.name}</h1>
              <p className="text-xs text-slate-500">{[c.name, c.phone, c.email, c.city].filter(Boolean).join(' · ')}</p>
              <div className="mt-2">
                <ServiceChips codes={c.services} catalog={byCode} max={6} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={STAGE_PILL[stage].tone}>{STAGE_PILL[stage].label}</Pill>
            {canAct && (
              <button type="button" className={btn.primary} onClick={() => onAct(c)}>
                <UserCheck className="w-3.5 h-3.5" /> {role === 'DEPARTMENT_HEAD' ? 'Pass to Team Lead' : 'Assign to member'}
              </button>
            )}
          </div>
        </div>
        <dl className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <Tile label="Deal amount" value={money(c.dealAmount)} />
          <Tile label="Sales owner" value={c.owner?.fullName || '—'} />
          <Tile label="Team Lead" value={h?.teamLead?.fullName || '—'} />
          <Tile label="Team Member" value={h?.teamMember?.fullName || '—'} />
        </dl>
        {h?.note && (
          <p className="mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <b>Note:</b> {h.note}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-slate-900">Verified documents &amp; details</h2>
          <p className="text-xs text-slate-500 mb-3">Collected by sales and authorized by the Technical Consultant. View only.</p>
          <ul className="space-y-2">
            {items.map(item => (
              <ReadOnlyItem key={item.code} item={item} customer={c} />
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="w-4 h-4 text-blue-600" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-900">Client panel login</h2>
          </div>
          {h?.clientAccount ? (
            <dl className="text-sm">
              <dt className="text-xs text-slate-500">E-mail</dt>
              <dd className="font-mono text-slate-900 break-all">{h.clientAccount.email}</dd>
              <dt className="text-xs text-slate-500 mt-2">Created</dt>
              <dd className="text-slate-800">{longDate(h.clientAccount.createdAt)}</dd>
              <p className="mt-3 text-[11px] text-slate-500">The client signs in to the mobile app with this e-mail and the password set by the Technical Consultant.</p>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">No login yet.</p>
          )}
        </Card>
      </div>

      {acting && (
        <AssignDialog role={role === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD' : 'TEAM_HEAD'} customer={acting} onClose={onCloseAct} onDone={() => { notifyPipelineChanged(); load(); onChanged(); }} />
      )}
    </div>
  );
};

const Tile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3 py-2 rounded-xl border border-slate-200">
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd className="font-semibold text-slate-900 mt-0.5 break-words">{value}</dd>
  </div>
);

const ReadOnlyItem: React.FC<{ item: ChecklistItem; customer: PipelineCustomerDetail }> = ({ item, customer }) => {
  const [error, setError] = useState<string | null>(null);
  const entry = item.entry;
  const doc: CustomerDocument | null = item.kind === 'FILE' ? customer.documents.find(d => d.id === entry?.documentId) || null : null;
  const value = !entry ? 'Not provided' : item.kind === 'FILE' ? doc?.originalFileName || 'File' : item.kind === 'YES_NO' ? (entry.value === 'YES' ? 'Yes' : 'No') : item.kind === 'AMOUNT' ? money(Number(entry.value)) : entry.value || '—';
  const view = async () => {
    if (!doc) return;
    setError(null);
    const win = window.open('', '_blank');
    try {
      const { url } = await documentsApi.url(doc.id, 'view');
      if (win) {
        win.opener = null;
        win.location.href = url;
      }
    } catch (e) {
      win?.close();
      setError(errorMessage(e));
    }
  };
  return (
    <li className="p-3 rounded-xl border border-slate-200 bg-slate-50/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">{item.label}</div>
          <div className="text-xs text-slate-600 break-words whitespace-pre-line">{value}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {entry?.status === 'VERIFIED' && <Pill tone="green">Authorized</Pill>}
          {doc && (
            <button type="button" className={btn.secondary} onClick={view} aria-label={`View ${item.label}`}>
              <Eye className="w-3.5 h-3.5" /> View
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </li>
  );
};
