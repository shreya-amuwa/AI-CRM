import React, { useState } from 'react';
import { useWorkTasks } from '../../lib/workTasks';
import { useSupportInvoices, useTickets } from '../../lib/support';
import { CustomerProfile, CustomersPage } from './CustomersPage';
import { AddCustomerPage } from './AddCustomerPage';
import { TicketsPage } from './TicketsPage';

/** Team Lead (Support team): the team's tickets — assign, reassign, monitor, escalate. */
export const SupportLeadTickets: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [customerId, setCustomerId] = useState<string | null>(null);
  if (customerId) {
    return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setCustomerId(null)} />;
  }
  return <TicketsPage mode="manager" data={tickets} people={tasks.people} onOpenCustomer={setCustomerId} />;
};

/** Team Lead (Support team): every customer the team handles, including the ones members add. */
export const SupportLeadCustomers: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [view, setView] = useState<{ type: 'list' } | { type: 'add' } | { type: 'profile'; id: string }>({ type: 'list' });
  if (view.type === 'add') {
    return <AddCustomerPage people={tasks.people} onCancel={() => setView({ type: 'list' })} onCreated={id => setView({ type: 'profile', id })} />;
  }
  if (view.type === 'profile') {
    return (
      <CustomerProfile customerId={view.id} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setView({ type: 'list' })} />
    );
  }
  return (
    <CustomersPage
      mode="supervisor"
      tickets={tickets}
      tasks={tasks}
      onOpenCustomer={id => setView({ type: 'profile', id })}
      onAddCustomer={() => setView({ type: 'add' })}
    />
  );
};
