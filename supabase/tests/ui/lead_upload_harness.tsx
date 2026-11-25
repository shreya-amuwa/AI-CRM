import React from 'react';
import { createRoot } from 'react-dom/client';
import { LeadsView } from '../../../src/components/team-member/pipeline/LeadsView';
import { LeadsPage } from '../../../src/components/telecaller/LeadsPage';
import './withAppFeedback';

/**
 * The real Lead sections (the shared Pipeline Leads list and the Telecaller Leads page) with the CRM API answered in the page, so the browser test
 * can check the two buttons, the upload window and exactly what is sent. window.__calls records every request.
 */
type Call = { method: string; path: string; body?: any };
const calls: Call[] = [];
const w = window as any;
w.__calls = calls;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
const batch = (o: Record<string, unknown> = {}) => ({ id: '00000000-0000-4000-8000-0000000000b1', fileName: 'leads.csv', fileType: 'CSV', status: 'PROCESSING', totalRows: 3, processedRows: 0,
  created: 0, duplicates: 0, invalid: 0, failed: 0, createdAt: new Date().toISOString(), completedAt: null, ...o });
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: url.pathname, body });
  const p = url.pathname.replace('/api/v1', '');
  if (p === '/pipeline/services') return json([{ code: 'WHATSAPP_API', name: 'WhatsApp API', category: 'Messaging & AI', requirements: [] }]);
  if (p === '/lead-uploads' && method === 'GET') return json([]);
  if (p === '/lead-uploads/check') {
    return json({ rows: body.rows.map((r: any) => (r.phone === '12345' ? { row: r.row, outcome: 'INVALID', message: 'Mobile Number: Enter a 10-digit mobile number.' }
      : r.name === 'Twice' ? { row: r.row, outcome: 'DUPLICATE', message: 'This mobile number or e-mail appears earlier in this file.' } : { row: r.row, outcome: 'NEW', ownerName: 'Asha Sales' })),
      summary: { total: body.rows.length, new: 1, duplicates: 1, invalid: 1 } });
  }
  if (p === '/lead-uploads' && method === 'POST') return json(batch(), 201);
  if (p.endsWith('/rows')) return json({ batch: batch({ processedRows: 3 }), results: [] });
  if (p.endsWith('/finish')) return json(batch({ status: 'COMPLETED', processedRows: 3, created: 1, duplicates: 1, invalid: 1, completedAt: new Date().toISOString() }));
  if (p === '/lead-scope/counts') return json({ all: 0, mine: 0, department: 0, toAccounts: 0, returned: 0 });
  if (p.startsWith('/pipeline/inbound')) return json({ items: [], total: 0, page: 1, pageSize: 10 });
  if (p === '/telecaller/leads' || p === '/lead-scope') return json({ items: [], total: 0, page: 1, pageSize: 20, sources: [], statusCounts: {} });
  return json({ items: [], total: 0, page: 1, pageSize: 10 });
};

const profile = (o: Record<string, unknown>) => ({ id: 'me', fullName: 'Asha Sales', email: 'asha@amuwa.com', role: 'TEAM_MEMBER', status: 'ACTIVE',
  department: { id: 'd1', name: 'Wabastore', slug: 'wabastore' }, team: { id: 't1', name: 'Sales', division: 'SALES' }, headDivision: null, defaultDashboard: null, ...o });
const root = () => createRoot(document.getElementById('root')!);
w.mountPipeline = (who: Record<string, unknown> = {}) => {
  w.__profile = profile(who);
  root().render(<div className="p-4"><LeadsView counts={null} showInbound={false} onAdd={() => (w.__added = true)} onEdit={() => undefined} /></div>);
};
w.mountTelecaller = () => {
  w.__profile = profile({ salesSubRole: 'TELECALLER' });
  root().render(<div className="p-4"><LeadsPage onChanged={() => undefined} /></div>);
};
