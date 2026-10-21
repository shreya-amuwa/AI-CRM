import { StagedFiles, TicketFileButton, useTicketFiles } from '../tickets/TicketFiles';
import { staffTicketFiles } from '../tickets/staffTransport';
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Person, TeamRef } from '../../lib/workTasks';
import {
  fmtWhen,
  isAwaitingReply,
  isTicketOpen,
  isTicketOverdue,
  ticketApi,
  ticketSlaApi,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  useCustomerOptions,
  type SupportTicket,
  type TicketCategory,
  type TicketData,
  type TicketPriority,
  type TicketSla
} from '../../lib/support';
import { ErrorBanner, FormField, inputClass, Loading, Modal, PageHeader } from './SupportParts';
import { personName, TicketPane, TicketWorkspace } from './TicketChat';

interface TicketsPageProps {
  /** member: own tickets; manager: the team's / department's tickets (team lead, department head). */
  mode: 'member' | 'manager';
  data: TicketData;
  people: Person[];
  /** Team names for the ticket list and header (optional). */
  teams?: TeamRef[];
  onOpenCustomer?: (customerId: string) => void;
}

/** Customer tickets as conversations: inbox, chat and details. Managers also get counts and the team's workload. */
export const TicketsPage: React.FC<TicketsPageProps> = ({ mode, data, people, teams, onOpenCustomer }) => {
  const { profile } = useAuth();
  const [creating, setCreating] = useState(false);
  const [slaOpen, setSlaOpen] = useState(false);
  const tickets = data.tickets;
  const count = (fn: (t: SupportTicket) => boolean) => tickets.filter(fn).length;

  const byMember = useMemo(() => {
    const map = new Map<string, SupportTicket[]>();
    tickets.forEach(t => map.set(t.assigneeId || 'none', [...(map.get(t.assigneeId || 'none') || []), t]));
    return [...map.entries()].map(([id, list]) => ({
      id,
      name: id === 'none' ? 'Unassigned' : personName(people, id),
      open: list.filter(t => isTicketOpen(t.status)).length,
      overdue: list.filter(t => isTicketOverdue(t)).length,
      escalated: list.filter(t => isTicketOpen(t.status) && (t.status === 'ESCALATED' || t.escalationLevel !== 'RM')).length,
      resolved: list.filter(t => !isTicketOpen(t.status)).length,
      resolvedByThem: id === 'none' ? 0 : tickets.filter(t => t.resolvedBy === id).length,
      total: list.length
    }));
  }, [tickets, people]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={mode === 'member' ? 'Tickets' : 'Support Tickets'}
        subtitle={mode === 'member' ? 'Conversations with the customers you look after.' : 'Monitor, reply to, assign and escalate your team’s tickets.'}
        action={
          mode === 'manager' && (
            <div className="flex flex-wrap gap-2 self-start">
              <button
                type="button"
                onClick={() => setSlaOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50"
              >
                <Settings2 className="w-4 h-4" aria-hidden="true" /> SLA
              </button>
              {profile?.role !== 'DEPARTMENT_HEAD' && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" /> New ticket
                </button>
              )}
            </div>
          )
        }
      />
      {data.error && <ErrorBanner message={data.error} onRetry={() => void data.reload()} />}

      {mode === 'manager' && (
        <dl className="hidden md:flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 bg-white rounded-xl border border-slate-200/80 text-xs" aria-label="Ticket summary">
          {[
            ['Open', count(t => isTicketOpen(t.status)), 'text-blue-700', `${count(isAwaitingReply)} waiting for our reply`],
            ['In progress', count(t => t.status === 'IN_PROGRESS'), 'text-indigo-700', ''],
            ['Pending customer', count(t => t.status === 'WAITING_CUSTOMER'), 'text-amber-700', ''],
            ['Escalated', count(t => isTicketOpen(t.status) && (t.status === 'ESCALATED' || t.escalationLevel !== 'RM')), 'text-rose-700', ''],
            ['Overdue (SLA)', count(t => isTicketOverdue(t)), 'text-rose-700', ''],
            ['Resolved / closed', count(t => !isTicketOpen(t.status)), 'text-emerald-700', '']
          ].map(([label, value, tone, hint]) => (
            <div key={label as string} className="flex items-baseline gap-1.5">
              <dt className="text-slate-500">{label}</dt>
              <dd className={`text-base font-bold ${tone}`}>{value}</dd>
              {hint ? <span className="text-slate-400">({hint})</span> : null}
            </div>
          ))}
        </dl>
      )}

      <TicketWorkspace data={data} people={people} teams={teams} manager={mode === 'manager'} compactTop={mode === 'manager'} onOpenCustomer={onOpenCustomer} />

      {mode === 'manager' && byMember.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Workload by team member</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Relationship Manager</th>
                  <th className="py-2 px-3 font-semibold text-right">Open</th>
                  <th className="py-2 px-3 font-semibold text-right">Overdue</th>
                  <th className="py-2 px-3 font-semibold text-right">Escalated</th>
                  <th className="py-2 px-3 font-semibold text-right">Resolved / closed</th>
                  <th className="py-2 px-3 font-semibold text-right">Resolved by them</th>
                  <th className="py-2 pl-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {byMember.map(r => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-medium text-slate-800">{r.name}</td>
                    <td className="py-2 px-3 text-right">{r.open}</td>
                    <td className="py-2 px-3 text-right text-rose-700">{r.overdue}</td>
                    <td className="py-2 px-3 text-right text-rose-700">{r.escalated}</td>
                    <td className="py-2 px-3 text-right text-emerald-700">{r.resolved}</td>
                    <td className="py-2 px-3 text-right text-emerald-700">{r.resolvedByThem}</td>
                    <td className="py-2 pl-3 text-right">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {slaOpen && <SlaSettingsModal onClose={() => setSlaOpen(false)} />}
      {creating && (
        <NewTicketModal
          people={people}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void data.reload();
          }}
        />
      )}
    </div>
  );
};

/** Create a ticket, optionally for a fixed customer (from the customer profile). */
export const NewTicketModal: React.FC<{
  people: Person[];
  customerId?: string;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}> = ({ people, customerId, onClose, onCreated }) => {
  const { profile } = useAuth();
  const customers = useCustomerOptions();
  const [customer, setCustomer] = useState(customerId || '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>('GENERAL');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = useTicketFiles(staffTicketFiles, customer ? { customerId: customer } : {});
  // files belong to one customer: choosing another customer starts the list again
  useEffect(() => files.clear(), [customer]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLead = profile?.role === 'TEAM_HEAD';
  const team = people.filter(p => (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.status === 'ACTIVE' && p.teamId === profile?.teamId);
  const matches = customers
    .filter(c => {
      const q = customerQuery.trim().toLowerCase();
      return !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q);
    })
    .slice(0, 8);
  const chosen = customers.find(c => c.id === customer);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!customer) return setError('Choose the customer this ticket is for.');
    if (subject.trim().length < 3) return setError('Enter a subject (at least 3 characters).');
    if (files.busy) return setError('Wait for the files to finish uploading.');
    setBusy(true);
    try {
      const id = await ticketApi.create({ customerId: customer, subject: subject.trim(), description: description.trim(), category, priority, assigneeId: assignee || undefined, attachmentIds: files.ids });
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ticket.');
      setBusy(false);
    }
  };

  return (
    <Modal title="New ticket" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Customer" htmlFor="nt-customer" required>
          {customerId || chosen ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm">
              <span>
                <strong>{chosen?.name || 'Customer'}</strong> <span className="text-slate-400 font-mono text-xs">{chosen?.code}</span>
              </span>
              {!customerId && (
                <button type="button" className="text-xs text-blue-700 font-semibold" onClick={() => setCustomer('')}>
                  Change
                </button>
              )}
            </div>
          ) : (
            <div>
              <input
                id="nt-customer"
                value={customerQuery}
                onChange={e => setCustomerQuery(e.target.value)}
                placeholder="Search customer name, company or ID"
                className={inputClass}
                autoComplete="off"
              />
              <ul className="mt-1.5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-44 overflow-y-auto">
                {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">No customers found.</li>}
                {matches.map(c => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setCustomer(c.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{c.name}</span>
                      <span className="text-xs text-slate-400"> · {c.company || 'No company'} · </span>
                      <span className="text-xs text-slate-400 font-mono">{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FormField>
        <FormField label="Subject" htmlFor="nt-subject" required>
          <input id="nt-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} className={inputClass} placeholder="e.g. Templates stuck in review" />
        </FormField>
        <FormField label="Query or issue description" htmlFor="nt-desc">
          <textarea id="nt-desc" rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} className={inputClass} />
        </FormField>
        <div className="space-y-1.5">
          <div>{customer ? <TicketFileButton files={files} label /> : <p className="text-xs text-slate-500">Choose the customer first to attach files.</p>}</div>
          <StagedFiles files={files} hint={!!customer} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Category" htmlFor="nt-cat">
            <select id="nt-cat" value={category} onChange={e => setCategory(e.target.value as TicketCategory)} className={inputClass}>
              {(Object.keys(TICKET_CATEGORY_LABELS) as TicketCategory[]).map(c => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority" htmlFor="nt-pri">
            <select id="nt-pri" value={priority} onChange={e => setPriority(e.target.value as TicketPriority)} className={inputClass}>
              {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map(p => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {isLead && (
          <FormField label="Assign to" htmlFor="nt-assignee" hint="Leave empty to assign it to yourself.">
            <select id="nt-assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className={inputClass}>
              <option value="">Me</option>
              {team
                .filter(p => p.id !== profile?.id)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </select>
          </FormField>
        )}
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

/** One ticket's conversation and controls in a dialog (used where a ticket opens from another list). */
export const TicketDetail: React.FC<{
  ticket: SupportTicket;
  data: TicketData;
  people: Person[];
  teams?: TeamRef[];
  manager?: boolean;
  onClose: () => void;
  onOpenCustomer?: (customerId: string) => void;
  /** View only (e.g. a team lead reading another team's ticket on one of their customers). */
  readOnly?: boolean;
}> = ({ ticket, data, people, teams, onClose, onOpenCustomer, readOnly = false }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`${ticket.ticketNo} ${ticket.subject}`}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white sm:rounded-2xl shadow-2xl w-full max-w-4xl h-full sm:h-[88vh] overflow-hidden flex flex-col">
        <button type="button" onClick={onClose} className="absolute top-2.5 right-3 z-20 text-slate-400 hover:text-slate-700 text-xl leading-none px-1" aria-label="Close">
          ×
        </button>
        <TicketPane ticket={ticket} data={data} people={people} teams={teams} readOnly={readOnly} inModal onOpenCustomer={onOpenCustomer} />
      </div>
    </div>
  );
};

/** How long the Relationship Manager, then the Team Lead, may take to answer the customer. */
const SlaSettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [sla, setSla] = useState<TicketSla | null>(null);
  const [rmHours, setRmHours] = useState('');
  const [tlHours, setTlHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    ticketSlaApi.get().then(
      s => {
        setSla(s);
        setRmHours(String(+(s.rmMinutes / 60).toFixed(2)));
        setTlHours(String(+(s.tlMinutes / 60).toFixed(2)));
      },
      e => setError(e instanceof Error ? e.message : 'Could not load the SLA.')
    );
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const rm = Math.round(Number(rmHours) * 60);
    const tl = Math.round(Number(tlHours) * 60);
    if (!Number.isFinite(rm) || !Number.isFinite(tl) || rm < 5 || tl < 5) return setError('Enter the hours for each level (at least 5 minutes).');
    setBusy(true);
    setError(null);
    try {
      setSla(await ticketSlaApi.set(rm, tl));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the SLA.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Ticket SLA" onClose={onClose}>
      {!sla && !error ? (
        <Loading label="Loading SLA…" />
      ) : (
        <form onSubmit={save} className="space-y-4">
          <p className="text-xs text-slate-500">
            A customer ticket goes to the customer's Relationship Manager. If the customer has no answer in time, it moves to the Team Lead, and then to the
            Department Head. The clock restarts with every new customer message and stops when the team replies, asks the customer something or resolves the ticket.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Relationship Manager (hours)" htmlFor="sla-rm">
              <input id="sla-rm" type="number" min={0.1} step={0.25} value={rmHours} disabled={!sla?.canEdit} onChange={e => setRmHours(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="Then the Team Lead (hours)" htmlFor="sla-tl">
              <input id="sla-tl" type="number" min={0.1} step={0.25} value={tlHours} disabled={!sla?.canEdit} onChange={e => setTlHours(e.target.value)} className={inputClass} />
            </FormField>
          </div>
          {sla && (
            <p className="text-[11px] text-slate-400">
              {sla.scope === 'DEPARTMENT' ? 'Set for your department.' : 'The default for every department.'} Last changed {fmtWhen(sla.updatedAt)}.
              {!sla.canEdit && ' Only a Department Head or the Super Admin can change it.'}
            </p>
          )}
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-xs text-emerald-700" role="status">
              SLA saved. New deadlines use it from now on.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Close
            </button>
            {sla?.canEdit && (
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save SLA'}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
};
