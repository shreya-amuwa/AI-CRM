import React from 'react';
import { createRoot } from 'react-dom/client';
import { HeadAttendancePage } from '../../../src/components/department-head/HeadAttendancePage';
import { HeadLeadsPage } from '../../../src/components/department-head/HeadLeadsPage';
import { HeadCustomersPage } from '../../../src/components/department-head/HeadCustomersPage';
import { HeadInvoicesPage } from '../../../src/components/department-head/HeadInvoicesPage';
import { HeadDeptStats } from '../../../src/components/department-head/HeadDeptStats';
import { pipelineApi, invoicesApi } from '../../../src/lib/api/endpoints';

const w = window as any;
w.__created = [];
// the CRM's own lead creation and service list: replaced by in-page ones so the test sees exactly what the form sends
(pipelineApi as any).services = async () => [{ code: 'AI_CALLING', name: 'AI Calling', description: '', sortOrder: 1, requirements: [], active: true }];
(pipelineApi as any).createLead = async (body: any) => { w.__created.push(body); return { id: 'new-lead', name: body.name }; };
(pipelineApi as any).counts = async () => ({});
(invoicesApi as any).get = async (id: string) => {
  const i = w.__state.invoices.find((x: any) => x.id === id);
  return { id: i.id, number: i.number, kind: 'UPLOADED', customerId: i.customerId, customer: i.customer, contact: i.customer, customerCode: 'CUS-1', department: 'Wabastore Sales', issueDate: i.issueDate, dueDate: i.dueDate, subtotal: i.amount, discount: 0, tax: 0, total: i.amount,
    status: i.status, paidAt: null, items: [], note: null, reference: null, file: null, generated: null, addonRequestId: null, issuedBy: 'Accounts', issuedAt: i.issueDate, createdAt: i.issueDate };
};

const root = () => createRoot(document.getElementById('root')!);
w.mount = (page: string, props: any = {}) => {
  const el = page === 'attendance' ? <HeadAttendancePage /> : page === 'leads' ? <HeadLeadsPage /> : page === 'customers' ? <HeadCustomersPage {...props} /> : page === 'invoices' ? <HeadInvoicesPage /> : <HeadDeptStats go={p => (w.__went = p)} />;
  root().render(<div className="p-4 max-w-6xl">{el}</div>);
};

// the real Department Head dashboard (navigation and routing of the new pages); the signed-in person is window.__profile
import { DepartmentHeadDashboard } from '../../../src/components/tasks/DepartmentHeadDashboard';
w.mountDashboard = () => root().render(<DepartmentHeadDashboard />);
