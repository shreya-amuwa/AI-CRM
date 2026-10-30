import React from 'react';
import { EmployeeRequestForm } from './EmployeeRequestForm';
import { EmployeeRequestsPanel } from './EmployeeRequestsPanel';

/** HR: ask for an employee and follow every request. Nobody is active until the right approver decides. */
export const HrEmployeeRequestsPage: React.FC = () => (
  <div className="space-y-6 w-full">
    <div>
      <h1 className="text-2xl font-bold font-heading text-slate-900">Employee Requests</h1>
      <p className="text-sm text-slate-500 mt-0.5">Ask for an Operations Head, Department Head, Team Lead or Team Member. The request goes to the approver for that role and the account is active only after they approve.</p>
    </div>
    <EmployeeRequestForm mode="hr" />
    <EmployeeRequestsPanel view="hr" title="Requests you sent" />
  </div>
);
