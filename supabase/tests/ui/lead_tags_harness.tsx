import React from 'react';
import { createRoot } from 'react-dom/client';
import { LeadTagsPage } from '../../../src/components/leadTags/LeadTagsPage';
import './withAppFeedback';

const DEPTS = [{ id: 'd-sales', name: 'Sales One' }, { id: 'd-intl', name: 'International' }];
(window as any).mountMd = () => createRoot(document.getElementById('root')!).render(<LeadTagsPage departments={DEPTS} canCompanyWide />);
(window as any).mountCeo = () => createRoot(document.getElementById('root')!).render(<LeadTagsPage departments={[DEPTS[0]!]} canCompanyWide={false} />);
