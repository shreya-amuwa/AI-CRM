import React, { useState } from 'react';
import { useDeskTickets, type TicketData } from '../../lib/support';
import type { Person, TeamRef } from '../../lib/workTasks';
import { TicketsPage } from './TicketsPage';

interface Props {
  mode: 'member' | 'manager';
  data: TicketData;
  people: Person[];
  teams?: TeamRef[];
  onOpenCustomer?: (customerId: string) => void;
}

/**
 * The Tickets page of a Support employee, plus the shared Support desk (20270129000100) when they have one: the department's customer tickets they can read and
 * reply to while a colleague is away. The first view is their own tickets exactly as before. On the desk the same screens are used; changing the status, priority,
 * assignment or escalation stays with the people who could always do it (the screens hide those controls and the database refuses them).
 */
export const TicketsWithDesk: React.FC<Props> = props => {
  const desk = useDeskTickets(true);
  const [view, setView] = useState<'mine' | 'desk'>('mine');
  if (!desk.available) return <TicketsPage {...props} />;
  const tab = (id: 'mine' | 'desk', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      data-testid={`tickets-${id}-tab`}
      onClick={() => setView(id)}
      className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold ${view === id ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Which tickets" className="flex flex-wrap gap-2">
        {tab('mine', 'My tickets')}
        {tab('desk', `Support desk (${desk.tickets.length})`)}
      </div>
      {view === 'mine' ? (
        <TicketsPage {...props} />
      ) : (
        <TicketsPage mode="member" data={desk} people={props.people} teams={props.teams} onOpenCustomer={props.onOpenCustomer} />
      )}
    </div>
  );
};
