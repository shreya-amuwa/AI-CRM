import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Headset, Plus, UserCheck, Users, UserRound } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { customerApi, fmtWhen, useSupportInvoices, useTickets } from '../../../lib/support';
import { useWorkTasks, type Person } from '../../../lib/workTasks';
import { singleTicketData, teamLeadApi, useTeamLeadDashboard, type TlCustomer, type TlDashboard, type TlTicket } from '../../../lib/teamLead';
import { CustomerForm, emptyCustomerInput } from '../../support-member/CustomerForm';
import { CustomerProfile } from '../../support-member/CustomersPage';
import { TicketDetail } from '../../support-member/TicketsPage';
import { ErrorBanner, Loading, Modal, TicketPriorityPill, TicketStatusPill } from '../../support-member/SupportParts';
import { EMPTY_CUSTOMER_FILTERS, TlCustomersSection, type CustomerFilters } from './TlCustomersSection';
import { EMPTY_TICKET_FILTERS, TlTicketsSection, type TicketFilters } from './TlTicketsSection';

/**
 * Team Leader dashboard. Everything comes from the database through functions
 * limited to the signed-in lead's scope (their team's customers plus the ones
 * the Department Head passed to them). No figures are made up on this page.
 */
export const TeamLeaderDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion(v => v + 1), []);
  const dash = useTeamLeadDashboard(version);
  const [customerFilters, setCustomerFilters] = useState<CustomerFilters>(EMPTY_CUSTOMER_FILTERS);
  const [ticketFilters, setTicketFilters] = useState<TicketFilters>(EMPTY_TICKET_FILTERS);
  const [adding, setAdding] = useState(false);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [openTicket, setOpenTicket] = useState<TlTicket | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const customersRef = useRef<HTMLDivElement>(null);
  const ticketsRef = useRef<HTMLDivElement>(null);

  const d = dash.data;
  const leadId = profile?.id || '';
  const leadName = profile?.fullName || d?.lead.fullName || 'Team Lead';
  // People for the reused customer form / ticket detail: me first, then my members.
  const people = useMemo<Person[]>(
    () => [
      { id: leadId, fullName: leadName, role: 'TEAM_HEAD', teamId: profile?.teamId || null, departmentId: profile?.departmentId || null, status: 'ACTIVE' },
      ...(d?.members || []).map(m => ({
        id: m.id,
        fullName: m.fullName,
        role: 'TEAM_MEMBER' as const,
        teamId: profile?.teamId || null,
        departmentId: profile?.departmentId || null,
        status: 'ACTIVE'
      }))
    ],
    [d?.members, leadId, leadName, profile?.teamId, profile?.departmentId]
  );

  const changed = (message: string) => {
    setNotice(message);
    bump();
  };
  const showCustomers = (f: Partial<CustomerFilters>) => {
    setCustomerFilters({ ...EMPTY_CUSTOMER_FILTERS, ...f });
    customersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const showTickets = (f: Partial<TicketFilters>) => {
    setTicketFilters({ ...EMPTY_TICKET_FILTERS, ...f });
    ticketsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (openCustomer) {
    return <CustomerDetail customerId={openCustomer} onBack={() => setOpenCustomer(null)} />;
  }

  const firstName = leadName.split(' ')[0];
  return (
    <div className="space-y-8 max-w-7xl">
      {/* A. Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">{d?.lead.teamName ? `${d.lead.teamName} team` : 'Your team'}</p>
          <h1 className="text-2xl font-bold font-heading text-slate-900 mt-0.5">Team Leader Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Hello {firstName}.{' '}
            {d
              ? d.totals.needsDecision
                ? `${d.totals.needsDecision} customer${d.totals.needsDecision === 1 ? '' : 's'} from your Department Head ${d.totals.needsDecision === 1 ? 'needs' : 'need'} an assignment decision.`
                : 'Here is how your customers and tickets are distributed.'
              : 'Loading your team overview…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setAdding(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Add Customer
        </button>
      </header>

      {notice && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800" role="status">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" className="text-emerald-700 text-xs font-semibold" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {dash.error && <ErrorBanner message={dash.error} onRetry={() => void dash.reload()} />}

      {/* B. KPIs */}
      {dash.loading && !d ? (
        <Loading label="Loading your dashboard…" />
      ) : d ? (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Users} label="Total customers" value={d.totals.customers} hint="Everyone you manage" onClick={() => showCustomers({})} />
            <Kpi icon={UserRound} label="My customers" value={d.totals.mine} hint="Handled by you" onClick={() => showCustomers({ assignment: 'MINE' })} />
            <Kpi icon={UserCheck} label="Team customers" value={d.totals.team} hint="Handled by your members" onClick={() => showCustomers({ assignment: 'TEAM' })} />
            <Kpi
              icon={Headset}
              label="Open tickets"
              value={d.totals.openTickets}
              hint={d.totals.urgentTickets ? `${d.totals.urgentTickets} high priority or escalated` : 'None high priority'}
              onClick={() => showTickets({})}
              accent={d.totals.urgentTickets > 0}
            />
          </section>

          {/* C + H. Portfolio and team workload */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Portfolio d={d} onShow={showCustomers} />
            <Workload d={d} onCustomers={id => showCustomers({ memberId: id })} onTickets={id => showTickets({ assigneeId: id })} />
          </div>

          {/* I. Needs attention + recent activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Attention
              d={d}
              onDecide={() => showCustomers({ assignment: 'DECISION' })}
              onOpenCustomer={setOpenCustomer}
              onUrgent={() => showTickets({})}
            />
            <Activity d={d} onOpenCustomer={setOpenCustomer} />
          </div>
        </>
      ) : null}

      {/* D. Customers */}
      <div ref={customersRef} className="scroll-mt-24">
        {d && (
          <TlCustomersSection
            filters={customerFilters}
            onFilters={setCustomerFilters}
            members={d.members}
            leadId={leadId}
            leadName={leadName}
            version={version}
            onOpenCustomer={c => setOpenCustomer(c.id)}
            onChanged={changed}
          />
        )}
      </div>

      {/* G. Tickets */}
      <div ref={ticketsRef} className="scroll-mt-24">
        {d && <TlTicketsSection filters={ticketFilters} onFilters={setTicketFilters} members={d.members} leadId={leadId} version={version} onOpenTicket={setOpenTicket} />}
      </div>

      {/* E. Add customer (existing create_support_customer: validation + duplicate checks) */}
      {adding && (
        <Modal title="Add customer" onClose={() => setAdding(false)} wide>
          <CustomerForm
            initial={emptyCustomerInput(leadId)}
            people={people}
            submitLabel="Add customer"
            idPrefix="tl-add"
            assigneeLabel="Assign to"
            assigneeHint="Keep it with you (default) or choose a member of your team."
            onCancel={() => setAdding(false)}
            onSubmit={async input => {
              await customerApi.create(input);
              setAdding(false);
              const who = !input.assigneeId || input.assigneeId === leadId ? 'kept with you' : `assigned to ${people.find(p => p.id === input.assigneeId)?.fullName || 'your team member'}`;
              changed(`${input.name.trim()} was added and ${who}.`);
            }}
          />
        </Modal>
      )}

      {openTicket && <TicketModal ticket={openTicket} people={people} onClose={() => setOpenTicket(null)} onChanged={bump} onOpenCustomer={id => {
        setOpenTicket(null);
        setOpenCustomer(id);
      }} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
const Kpi: React.FC<{ icon: React.ElementType; label: string; value: number; hint: string; onClick: () => void; accent?: boolean }> = ({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
  accent
}) => (
  <button
    type="button"
    onClick={onClick}
    className="text-left bg-white rounded-2xl border border-slate-200/80 p-4 hover:border-blue-200 hover:shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    aria-label={`${label}: ${value}. Show the list`}
  >
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="p-1.5 rounded-lg bg-slate-50 text-slate-500" aria-hidden="true">
        <Icon className="w-4 h-4" />
      </span>
    </div>
    <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
    <div className={`text-[11px] mt-0.5 ${accent ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{hint}</div>
  </button>
);

const Panel: React.FC<{ title: string; subtitle?: string; className?: string; children: React.ReactNode }> = ({ title, subtitle, className = '', children }) => (
  <section className={`bg-white rounded-2xl border border-slate-200/80 p-5 ${className}`} aria-label={title}>
    <h2 className="text-base font-bold text-slate-900">{title}</h2>
    {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

/** Who handles the portfolio: me / my members / still to decide, as one stacked bar. */
const Portfolio: React.FC<{ d: TlDashboard; onShow: (f: Partial<CustomerFilters>) => void }> = ({ d, onShow }) => {
  const parts = [
    { key: 'MINE' as const, label: 'Handled by you', value: d.totals.mine, bar: 'bg-blue-600', dot: 'bg-blue-600' },
    { key: 'TEAM' as const, label: 'Handled by team members', value: d.totals.team, bar: 'bg-sky-300', dot: 'bg-sky-300' },
    { key: 'DECISION' as const, label: 'Needs your decision', value: d.totals.needsDecision, bar: 'bg-amber-400', dot: 'bg-amber-400' }
  ];
  const total = d.totals.customers;
  return (
    <Panel title="Customer assignment" subtitle={`${total} customer${total === 1 ? '' : 's'} in your portfolio`}>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden flex" role="img" aria-label={parts.map(p => `${p.label}: ${p.value}`).join(', ')}>
        {total > 0 && parts.map(p => (p.value ? <div key={p.key} className={p.bar} style={{ width: `${(p.value / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-4 space-y-1">
        {parts.map(p => (
          <li key={p.key}>
            <button type="button" onClick={() => onShow({ assignment: p.key })} className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <span className={`w-2 h-2 rounded-full ${p.dot}`} aria-hidden="true" /> {p.label}
              </span>
              <span className="font-semibold text-slate-900">{p.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
};

const Workload: React.FC<{ d: TlDashboard; onCustomers: (id: string) => void; onTickets: (id: string) => void }> = ({ d, onCustomers, onTickets }) => (
  <Panel title="Team workload" subtitle="Customers and open tickets per team member" className="xl:col-span-2">
    {d.members.length === 0 ? (
      <p className="text-sm text-slate-500">Your team has no active members yet. Add them from Team Members &amp; Access.</p>
    ) : (
      <div className="relative overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
              <th scope="col" className="px-1 py-2 font-semibold">Team member</th>
              <th scope="col" className="px-2 py-2 font-semibold text-right">Customers</th>
              <th scope="col" className="px-2 py-2 font-semibold text-right">Open tickets</th>
              <th scope="col" className="px-2 py-2 font-semibold text-right hidden sm:table-cell">High priority</th>
              <th scope="col" className="px-1 py-2 font-semibold text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.members.map(m => (
              <tr key={m.id} className="border-b border-slate-50 last:border-0">
                <td className="px-1 py-2.5 font-semibold text-slate-800">{m.fullName}</td>
                <td className="px-2 py-2.5 text-right">{m.customers}</td>
                <td className="px-2 py-2.5 text-right">{m.openTickets}</td>
                <td className={`px-2 py-2.5 text-right hidden sm:table-cell ${m.urgentTickets ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{m.urgentTickets}</td>
                <td className="px-1 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => onCustomers(m.id)} className="text-xs font-semibold text-blue-700 hover:underline" aria-label={`View customers of ${m.fullName}`}>
                    Customers
                  </button>
                  <span className="text-slate-300 mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <button type="button" onClick={() => onTickets(m.id)} className="text-xs font-semibold text-blue-700 hover:underline" aria-label={`View tickets of ${m.fullName}`}>
                    Tickets
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Panel>
);

const Attention: React.FC<{ d: TlDashboard; onDecide: () => void; onOpenCustomer: (id: string) => void; onUrgent: () => void }> = ({ d, onDecide, onOpenCustomer, onUrgent }) => {
  const empty = !d.decisions.length && !d.alerts.length;
  return (
    <Panel title="Needs attention" subtitle="Assignment decisions and high-priority tickets">
      {empty ? (
        <p className="text-sm text-slate-500 inline-flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" /> Nothing needs you right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {d.decisions.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
              <button type="button" className="text-left min-w-0" onClick={() => onOpenCustomer(c.id)}>
                <span className="block text-sm font-semibold text-slate-900 truncate">{c.name}</span>
                <span className="block text-[11px] text-slate-500">Passed to you by the Department Head{c.passedAt ? ` · ${fmtWhen(c.passedAt)}` : ''}</span>
              </button>
              <button type="button" onClick={onDecide} className="text-xs font-bold text-amber-800 whitespace-nowrap inline-flex items-center gap-1">
                Decide <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {d.alerts.map(t => (
            <li key={t.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200">
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900 truncate">
                  <AlertTriangle className="w-3.5 h-3.5 inline text-rose-500 mr-1 -mt-0.5" aria-hidden="true" />
                  {t.subject}
                </span>
                <span className="block text-[11px] text-slate-500">
                  {t.ticketNo} · {t.customerName}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <TicketPriorityPill priority={t.priority} />
                <TicketStatusPill status={t.status} />
              </div>
            </li>
          ))}
          {d.alerts.length > 0 && (
            <li>
              <button type="button" onClick={onUrgent} className="text-xs font-semibold text-blue-700 hover:underline">
                See all open tickets
              </button>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
};

const ACTIVITY_LABEL: Record<string, string> = {
  CUSTOMER_CREATED: 'Customer added',
  CUSTOMER_REASSIGNED: 'Assignment changed',
  CUSTOMER_UPDATED: 'Customer updated',
  PASSED_TO_TEAM_LEAD: 'Passed to you by the Department Head',
  ASSIGNED_TO_TEAM_MEMBER: 'Assigned',
  TICKET_OPENED: 'Ticket opened',
  SENT_TO_DEPARTMENT_HEAD: 'Verified and sent to the Department Head'
};
const activityLabel = (type: string) =>
  ACTIVITY_LABEL[type] ||
  type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase());

const Activity: React.FC<{ d: TlDashboard; onOpenCustomer: (id: string) => void }> = ({ d, onOpenCustomer }) => (
  <Panel title="Recent activity" subtitle="Latest changes on your customers">
    {d.activity.length === 0 ? (
      <p className="text-sm text-slate-500">No activity yet.</p>
    ) : (
      <ol className="space-y-3">
        {d.activity.map(a => (
          <li key={a.id} className="flex gap-3">
            <span className="mt-1 w-7 h-7 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center shrink-0" aria-hidden="true">
              <Clock className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-slate-800">
                <span className="font-semibold">{activityLabel(a.type)}</span> ·{' '}
                <button type="button" className="text-blue-700 hover:underline" onClick={() => onOpenCustomer(a.customerId)}>
                  {a.customerName}
                </button>
              </p>
              {a.note && <p className="text-xs text-slate-500 truncate">{a.note}</p>}
              <p className="text-[11px] text-slate-400">
                {fmtWhen(a.occurredAt)}
                {a.actorName ? ` · ${a.actorName}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ol>
    )}
  </Panel>
);

/** The existing customer profile (details, communication, tickets, tasks, invoices). */
const CustomerDetail: React.FC<{ customerId: string; onBack: () => void }> = ({ customerId, onBack }) => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={onBack} />;
};

/** The existing ticket detail; view-only when the ticket belongs to another team (the server would refuse edits). */
const TicketModal: React.FC<{ ticket: TlTicket; people: Person[]; onClose: () => void; onChanged: () => void; onOpenCustomer: (id: string) => void }> = ({
  ticket,
  people,
  onClose,
  onChanged,
  onOpenCustomer
}) => {
  const [state, setState] = useState<{ data: Awaited<ReturnType<typeof teamLeadApi.ticket>>; error: string | null } | null>(null);
  const load = useCallback(async () => {
    try {
      setState({ data: await teamLeadApi.ticket(ticket.id, { name: ticket.customerName, code: ticket.customerCode }), error: null });
    } catch (e) {
      setState({ data: null, error: e instanceof Error ? e.message : 'Could not load the ticket.' });
    }
  }, [ticket.id, ticket.customerName, ticket.customerCode]);
  React.useEffect(() => {
    void load();
  }, [load]);

  if (!state) {
    return (
      <Modal title={`${ticket.ticketNo} · ${ticket.subject}`} onClose={onClose} wide>
        <Loading label="Loading ticket…" />
      </Modal>
    );
  }
  if (!state.data) {
    return (
      <Modal title={`${ticket.ticketNo} · ${ticket.subject}`} onClose={onClose} wide>
        <ErrorBanner message={state.error || 'This ticket is no longer available.'} onRetry={() => void load()} />
      </Modal>
    );
  }
  const names: Person[] = [
    ...people,
    ...(ticket.assigneeId && !people.some(p => p.id === ticket.assigneeId)
      ? [{ id: ticket.assigneeId, fullName: ticket.assigneeName || 'Team member', role: 'TEAM_MEMBER' as const, teamId: null, departmentId: null, status: 'ACTIVE' }]
      : [])
  ];
  const data = singleTicketData(state.data.ticket, state.data.updates, async () => {
    await load();
    onChanged();
  });
  return <TicketDetail ticket={state.data.ticket} data={data} people={names} manager={ticket.manageable} readOnly={!ticket.manageable} onClose={onClose} onOpenCustomer={onOpenCustomer} />;
};
