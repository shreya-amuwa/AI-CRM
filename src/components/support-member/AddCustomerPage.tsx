import React from 'react';
import { useAuth } from '../../context/AuthContext';
import type { Person } from '../../lib/workTasks';
import { customerApi } from '../../lib/support';
import { CustomerForm, emptyCustomerInput } from './CustomerForm';
import { PageHeader } from './SupportParts';

interface AddCustomerPageProps {
  people: Person[];
  /** After a customer is saved (back to the customer list). */
  onCreated: (customerName: string) => void;
  onCancel: () => void;
}

/** Validated form; saved straight to the CRM database (duplicates are refused there). */
export const AddCustomerPage: React.FC<AddCustomerPageProps> = ({ people, onCreated, onCancel }) => {
  const { profile } = useAuth();
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="Add Customer" subtitle="Register a new customer. Phone and e-mail are checked against existing customers so nobody is added twice." />
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6">
        <CustomerForm
          initial={emptyCustomerInput(profile?.id)}
          people={people}
          submitLabel="Save customer"
          idPrefix="ac"
          onCancel={onCancel}
          onSubmit={async input => {
            await customerApi.create(input);
            onCreated(input.name.trim());
          }}
        />
      </div>
    </div>
  );
};
