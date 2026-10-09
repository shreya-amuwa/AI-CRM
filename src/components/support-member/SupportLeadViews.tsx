import React, { useState } from 'react';
import { useWorkTasks } from '../../lib/workTasks';
import { useSupportInvoices, useTickets } from '../../lib/support';
import { CustomerProfile, CustomersPage } from './CustomersPage';
import { AddCustomerPage } from './AddCustomerPage';
import { TicketsPage } from './TicketsPage';
import { InvoiceRequests } from './InvoiceRequests';

/** Team Lead (Support team): the team's tickets — assign, reassign, monitor, escalate. */
export const SupportLeadTickets: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [customerId, setCustomerId] = useState<string | null>(null);
  if (customerId) {
    return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setCustomerId(null)} />;
  }
  return (
    <div className="space-y-6">
      <TicketsPage mode="manager" data={tickets} people={tasks.people} onOpenCustomer={setCustomerId} />
      <InvoiceRequests canRequest={false} onOpenCustomer={setCustomerId} />
    </div>
  );
};

/** Team Lead (Support team): every customer the team handles, including the ones members add. */
export const SupportLeadCustomers: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const [view, setView] = useState<{ type: 'list' } | { type: 'add' } | { type: 'profile'; id: string }>({ type: 'list' });
  const [notice, setNotice] = useState<string | null>(null);
  if (view.type === 'add') {
    return <AddCustomerPage people={tasks.people} onCancel={() => setView({ type: 'list' })} onCreated={name => {
          setNotice(`${name} was added.`);
          setView({ type: 'list' });
        }} />;
  }
  if (view.type === 'profile') {
    return (
      <CustomerProfile customerId={view.id} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setView({ type: 'list' })} />
    );
  }
  return (
    <CustomersPage
      mode="supervisor"
      notice={notice}
      tickets={tickets}
      tasks={tasks}
      onOpenCustomer={id => setView({ type: 'profile', id })}
      onAddCustomer={() => {
        setNotice(null);
        setView({ type: 'add' });
      }}
    />
  );
};
