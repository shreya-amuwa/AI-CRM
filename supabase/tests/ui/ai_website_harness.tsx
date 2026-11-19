import React from 'react';
import { createRoot } from 'react-dom/client';
import { AddLeadView, EditLeadView } from '../../../src/components/team-member/pipeline/LeadForms';

/**
 * The real Add Lead and Edit Lead screens with the CRM API answered in the page (every request is recorded in window.__calls), so the
 * browser test checks exactly what the AI Website onboarding section sends. The stand-in keeps one record per lead, like the database.
 */
type Call = { method: string; path: string; body?: any };
const w = window as any;
const calls: Call[] = [];
w.__calls = calls;
w.__saved = [];
const leadId = '00000000-0000-4000-8000-0000000000b1';
let record: any = null;
let lead: any = {
  id: leadId, name: 'Kavya Nair', company: 'Nair Bakes', phone: '+91 98470 12345', whatsapp: null, email: 'kavya@nairbakes.example', city: 'Kochi', address: null,
  businessCategory: 'Restaurant / Food', leadSource: 'Walk-in', leadStatus: 'NEW', lifecycleStage: 'LEAD', services: ['AI_CALLING'], nextFollowUpAt: null, notes: null,
  expectedBudget: null, dealAmount: null, paymentWorkflow: 'NONE', owner: { id: 'u1', fullName: 'Sales Person' }, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z',
  documents: [], documentTypes: [], activities: [], conversations: [], checklist: [], handover: null
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: url.pathname, body });
  const p = url.pathname.replace('/api/v1', '');
  const save = (b: any) => {
    record = { customerId: leadId, ...b, email: b.email || null, googleMapsLink: b.onGoogleMaps ? b.googleMapsLink || null : null,
      businessTypeOther: b.businessType === 'Other' ? b.businessTypeOther : null, createdAt: '', updatedAt: '', updatedBy: null };
  };
  if (p === '/pipeline/services') return json([{ code: 'AI_WEBSITE', name: 'AI Website', category: 'Messaging & AI' }, { code: 'AI_CALLING', name: 'AI Calling', category: 'Messaging & AI' }]);
  if (p === '/pipeline/leads' && method === 'POST') { if (body.aiWebsiteOnboarding) save(body.aiWebsiteOnboarding); return json({ id: leadId, name: body.name }, 201); }
  if (p === `/pipeline/customers/${leadId}` && method === 'GET') return json({ ...lead, aiWebsiteOnboarding: record });
  if (p === `/pipeline/leads/${leadId}` && method === 'PATCH') {
    const { aiWebsiteOnboarding, ...rest } = body;
    lead = { ...lead, ...rest };
    if (aiWebsiteOnboarding) save(aiWebsiteOnboarding);
    return json(lead);
  }
  return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
};

const root = () => createRoot(document.getElementById('root')!);
w.mountAdd = () => root().render(<div className="p-3"><AddLeadView onCancel={() => undefined} onSaved={id => w.__saved.push(id)} /></div>);
w.mountEdit = (withRecord: boolean) => {
  if (withRecord) {
    lead = { ...lead, services: ['AI_WEBSITE'] };
    record = { customerId: leadId, clientName: 'Kavya Nair', mobile: '9847012345', email: 'kavya@nairbakes.example', businessName: 'Nair Bakes', onGoogleMaps: true,
      googleMapsLink: 'https://maps.app.goo.gl/nairbakes', city: 'Kochi', businessType: 'Restaurant / Food', businessTypeOther: null, createdAt: '', updatedAt: '', updatedBy: null };
  }
  root().render(<div className="p-3"><EditLeadView id={leadId} onBack={() => undefined} onMovedToPotential={() => undefined} /></div>);
};
