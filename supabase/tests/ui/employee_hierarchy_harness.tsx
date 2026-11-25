import React from 'react';
import { createRoot } from 'react-dom/client';
import { DepartmentContext } from '../../../src/context/DepartmentContext';
import { EmployeeRequestsPanel } from '../../../src/components/employees/EmployeeRequestsPanel';
import { DepartmentEmployeeDirectoryPanel } from '../../../src/components/employees/DepartmentEmployeeDirectory';
import { OperationsDashboard } from '../../../src/components/operations/OperationsDashboard';
import { OperationsHeadsAdminPanel } from '../../../src/components/employees/OperationsHeadsAdmin';
import './withAppFeedback';

const departments = [
  { id: 'alpha', dbId: 'd-alpha', name: 'Alpha' }, { id: 'beta', dbId: 'd-beta', name: 'Beta' }, { id: 'gamma', dbId: 'd-gamma', name: 'Gamma' }
] as any;
const ctx: any = { departments, allDepartments: departments, loading: false, getDepartment: () => undefined, addDepartment: async () => ({ ok: false }), deleteDepartment: async () => ({ ok: false }), refreshDepartments: async () => undefined };

const views: Record<string, React.ReactNode> = {
  approver: <EmployeeRequestsPanel view="approver" />,
  hr: <EmployeeRequestsPanel view="hr" />,
  directory: <DepartmentEmployeeDirectoryPanel />,
  operations: <OperationsDashboard />,
  admin: <OperationsHeadsAdminPanel />
};
(window as any).mount = (view: string) => createRoot(document.getElementById('root')!).render(<DepartmentContext.Provider value={ctx}><div className="p-3 max-w-6xl">{views[view]}</div></DepartmentContext.Provider>);
