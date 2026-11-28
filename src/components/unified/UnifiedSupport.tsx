import React, { useState } from 'react';
import { useWorkTasks } from '../../lib/workTasks';
import { useSupportInvoices, useTickets } from '../../lib/support';
import { CustomerProfile, CustomersPage } from '../support-member/CustomersPage';
import { AddCustomerPage } from '../support-member/AddCustomerPage';
import { TicketsPage } from '../support-member/TicketsPage';
import { toast } from '../feedback/AppFeedback';

/**
 * International / Reseller, Support section for a Team Member: the customers they own and the tickets they raise or are given, with the same pages and
 * the same database rules as a Support Team Member (the member sees only their own; the database decides, never this component). The Team Lead and the
 * Department Head use SupportLeadCustomers / SupportLeadTickets, which already read the team's and the department's records.
 */
export const UnifiedMemberCustomers: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [view, setView] = useState<{ type: 'list' } | { type: 'add' } | { type: 'profile'; id: string }>({ type: 'list' });
  if (view.type === 'add') {
    return <AddCustomerPage people={tasks.people} onCancel={() => setView({ type: 'list' })} onCreated={name => { toast.success(`Customer added successfully: ${name}.`); setView({ type: 'list' }); }} />;
  }
  if (view.type === 'profile') {
    return <CustomerProfile customerId={view.id} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setView({ type: 'list' })} />;
  }
  return (
    <CustomersPage mode="member" tickets={tickets} tasks={tasks} onOpenCustomer={id => setView({ type: 'profile', id })}
      onAddCustomer={() => setView({ type: 'add' })} />
  );
};

export const UnifiedMemberTickets: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [customerId, setCustomerId] = useState<string | null>(null);
  if (customerId) {
    return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setCustomerId(null)} />;
  }
  return <TicketsPage mode="member" data={tickets} people={tasks.people} teams={tasks.teams} onOpenCustomer={setCustomerId} />;
};
