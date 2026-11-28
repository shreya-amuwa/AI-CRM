import React from 'react';
import { createRoot } from 'react-dom/client';
import { LeadTagsPage } from '../../../src/components/leadTags/LeadTagsPage';
import { ceoLeadTagDepartments } from '../../../src/components/leadTags/ceoDepartments';
import './withAppFeedback';

const DEPTS = [{ id: 'd-sales', name: 'Sales One' }, { id: 'd-intl', name: 'International' }];
(window as any).mountMd = () => createRoot(document.getElementById('root')!).render(<LeadTagsPage departments={DEPTS} canCompanyWide />);
(window as any).mountCeo = () => createRoot(document.getElementById('root')!).render(<LeadTagsPage departments={[DEPTS[0]!]} canCompanyWide={false} />);
// the scope objects as my_department_scopes returns them: a Sales CEO's departments, a whole-department one, and a Support-only one (the Wabatalk facet)
const scope = (o: any) => ({ iconName: null, accentColor: null, isHome: false, ...o });
const SCOPES = [
  scope({ id: 's-sales', slug: 'sales-one', name: 'Sales One', dataDepartmentId: 'd-sales', dataSlug: 'sales-one', divisions: ['SALES'], wholeDepartment: false }),
  scope({ id: 's-whole', slug: 'intl', name: 'International', dataDepartmentId: 'd-intl', dataSlug: 'intl', divisions: [], wholeDepartment: true }),
  scope({ id: 'f-waba', slug: 'wabatalk', name: 'Wabatalk', dataDepartmentId: 'd-dtalk', dataSlug: 'd-talk', divisions: ['SUPPORT'], wholeDepartment: false })
];
(window as any).mountScopes = () => createRoot(document.getElementById('root')!).render(<LeadTagsPage departments={ceoLeadTagDepartments(SCOPES as any)} canCompanyWide={false} />);
