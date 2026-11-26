import React from 'react';
import { UserPlus } from 'lucide-react';
import { EmployeeRequestForm } from './EmployeeRequestForm';
import { EmployeeRequestsPanel } from './EmployeeRequestsPanel';
import { HrPageHeader } from '../hr/hrUi';

/** HR: ask for an employee and follow every request. Nobody is active until the right approver decides. */
export const HrEmployeeRequestsPage: React.FC = () => (
  <div className="space-y-5 w-full">
    <HrPageHeader
      icon={UserPlus}
      title="Employee Requests"
      subtitle="Ask for an CEO, Department Head, Team Lead or Team Member. An employee you add needs approval: a Team Member or Team Lead goes to the Department Head, a Department Head to the CEO who owns the department, an CEO to the Managing Director. The account is active only after they approve."
    />
    <EmployeeRequestForm />
    <EmployeeRequestsPanel view="hr" title="Requests you sent" />
  </div>
);
