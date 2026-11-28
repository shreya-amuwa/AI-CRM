import React from 'react';
import { createRoot } from 'react-dom/client';
import { AddLeadView, EditLeadView } from '../../../src/components/team-member/pipeline/LeadForms';
import { LeadsView } from '../../../src/components/team-member/pipeline/LeadsView';
import './withAppFeedback';

/** The real Add lead, lead page and Leads list; the browser test answers the CRM API (page.route) and records what is sent. */
const w = window as any;
w.__saved = [];
// the signed-in Sales team member (read by the Leads list's upload button)
w.__profile = { id: 'u1', fullName: 'Sales Person', role: 'TEAM_MEMBER', departmentId: 'd1', teamId: 't1' };
const root = () => createRoot(document.getElementById('root')!);
w.mountAdd = () => root().render(<div className="p-3"><AddLeadView onCancel={() => undefined} onSaved={id => w.__saved.push(id)} /></div>);
w.mountEdit = (id: string) => root().render(<div className="p-3"><EditLeadView id={id} onBack={() => undefined} onMovedToPotential={() => undefined} /></div>);
w.mountList = () => root().render(<div className="p-3"><LeadsView counts={null} showInbound={false} onAdd={() => undefined} onEdit={() => undefined} /></div>);
