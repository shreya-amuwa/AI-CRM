import React from 'react';
import { createRoot } from 'react-dom/client';
import { AddLeadView } from '../../../src/components/team-member/pipeline/LeadForms';
import { VisitTrackingPanel } from '../../../src/components/field-visit/VisitTrackingPanel';
import { ActiveFieldVisits } from '../../../src/components/field-visit/ActiveFieldVisits';
import type { LeadVisit } from '../../../shared/contracts';

/**
 * The real Field Visit screens with the CRM API answered in the page (fetch is replaced; every request is recorded in window.__calls),
 * so the browser test can check exactly what the form and the tracker send.
 */
type Call = { method: string; path: string; body?: any };
const calls: Call[] = [];
const w = window as any;
w.__calls = calls;
w.__saved = [];
let points = 0;
let last: any = null;
let stopped = false;
const visitId = '00000000-0000-4000-8000-0000000000aa';
const state = (extra: Record<string, unknown> = {}) => ({
  visitId, visitStatus: 'IN_PROGRESS', trackingStatus: stopped ? 'STOPPED' : 'ACTIVE', trackingStartedAt: new Date().toISOString(), trackingStoppedAt: null,
  stopReason: stopped ? 'STOPPED_BY_EMPLOYEE' : null, issue: null, issueAt: null, lastLocation: last, points, ...extra
});
const board = () => ({
  date: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), serverTime: new Date().toISOString(),
  items: [
    { ...state(), employee: { id: 'e1', fullName: 'Field Person', phone: null }, department: 'Wabastore', team: 'Sales', teamLead: 'Team Lead One',
      lead: { id: 'l1', name: 'Asha', company: 'Asha Stores', address: 'MG Road' }, purpose: 'Demo', visitDate: '2026-11-06', startedAt: new Date(Date.now() - 600_000).toISOString(),
      completedAt: null, checkin: null,
      lastLocation: { latitude: 18.52, longitude: 73.85, accuracyMeters: 14, recordedAt: new Date(Date.now() - 30_000).toISOString() }, points: 4, trackingStatus: 'ACTIVE' },
    { ...state(), visitId: 'v2', employee: { id: 'e2', fullName: 'Quiet Person', phone: null }, department: 'Wabastore', team: 'Sales', teamLead: null,
      lead: { id: 'l2', name: 'Ravi', company: null, address: null }, purpose: 'Follow-up', visitDate: '2026-11-06', startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      completedAt: null, checkin: null,
      lastLocation: { latitude: 18.5, longitude: 73.8, accuracyMeters: 30, recordedAt: new Date(Date.now() - 20 * 60_000).toISOString() }, points: 2, trackingStatus: 'ACTIVE' }
  ]
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: url.pathname, body });
  const p = url.pathname.replace('/api/v1', '');
  if (p === '/pipeline/services') return json([{ code: 'AI_CALLING', name: 'AI Calling', category: 'Messaging & AI' }]);
  if (p === '/pipeline/leads' && method === 'POST') {
    await new Promise(r => setTimeout(r, 400)); // a slow network: a second click must not make a second lead
    return json({ id: `lead-${body.clientRequestId}`, name: body.name, company: body.company, leadSource: body.leadSource }, 201);
  }
  if (p === `/field-visits/${visitId}/tracking/start`) { stopped = false; points += 1; last = body; return json(state()); }
  if (p === `/field-visits/${visitId}/tracking/points`) { points += body.points.length; last = body.points[body.points.length - 1]; return json(state({ saved: body.points.length })); }
  if (p === `/field-visits/${visitId}/tracking/stop`) { stopped = true; return json(state()); }
  if (p === `/field-visits/${visitId}/tracking/issue`) return json(state({ issue: body.issue }));
  if (p === `/field-visits/${visitId}/tracking`) return json({ ...state(), locations: last ? [last] : [], events: [] });
  if (p === '/field-visits/tracking/board') return json(board());
  if (p.startsWith('/field-visits/') && p.endsWith('/tracking')) return json({ ...board().items[0], locations: [board().items[0].lastLocation], events: [{ event: 'STARTED', at: new Date().toISOString() }] });
  return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
};

const visit: LeadVisit = {
  id: visitId, leadId: 'l1', leadName: 'Asha', company: 'Asha Stores', phone: null, visitDate: '2026-11-06', plannedTime: null, address: 'MG Road', purpose: 'Demo',
  status: 'IN_PROGRESS', notes: null, outcome: null, requirements: null, nextSteps: null, nextFollowUp: null, cancelReason: null, startedAt: new Date().toISOString(),
  completedAt: null, gpsCaptured: false, checkinLat: null, checkinLng: null, checkinAccuracyM: null, checkinAt: null, locationNote: null, assignedBy: null, assignmentId: null,
  employee: { id: 'e1', fullName: 'Field Person' }, taskId: null, trackingStatus: 'OFF', trackingStartedAt: null, trackingStoppedAt: null, createdAt: '', updatedAt: ''
};

const root = () => createRoot(document.getElementById('root')!);
w.mountLead = (source = 'Field visit') =>
  root().render(<div className="p-3"><AddLeadView defaultSource={source} onCancel={() => undefined} onSaved={id => w.__saved.push(id)} /></div>);
w.mountTracking = () => root().render(<div className="p-3"><VisitTrackingPanel visit={visit} /></div>);
w.mountBoard = () => root().render(<div className="p-3"><ActiveFieldVisits audience="manager" /></div>);
