import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NoticePopupHost } from '../../../src/components/notices/NoticePopupHost';
import './withAppFeedback';

/**
 * The real company-notice popup host with the CRM API answered in the page, like the database: GET /notices/pending returns the notices this employee has not
 * acknowledged (Urgent first, then Important, then Normal, the oldest first), POST /notices/:id/acknowledge removes one for good (the server keeps it across reloads:
 * window.__server survives a remount). window.__publish(notice) is a manager publishing: the notice is added to the server and the bell gets its notification, as
 * Realtime would deliver it. window.__calls records every request.
 */
const w = window as any;
w.__calls = [];
w.__bell = [];
const iso = (minAgo: number) => new Date(Date.parse('2030-01-01T09:00:00Z') - minAgo * 60000).toISOString();
const base = (id: string, priority: string, title: string, minAgo: number, extra: Record<string, unknown> = {}) => ({
  id, reference: `NTC-2030-${id}`, title, body: `Full text of ${title}.\nSecond line of the notice.`, category: 'POLICY', priority, status: 'PUBLISHED', expired: false,
  publishAt: iso(minAgo), expiresAt: null, releasedAt: iso(minAgo), updatedAt: iso(minAgo), version: 1, publisherId: 'mgr1', publisherName: 'Ashish Sinha', publisherRole: 'CRM_TEAM',
  audience: { type: 'COMPANY', departments: [], roles: [], employees: [], departmentNames: [] }, isRecipient: true, read: false, readAt: null, canManage: false, recipientCount: 0, readCount: 0,
  acknowledged: false, acknowledgedAt: null, acknowledgedCount: 0, attachments: [], ...extra
});
const RANK: Record<string, number> = { URGENT: 0, IMPORTANT: 1, NORMAL: 2 };
const seed = () => [
  base('n-normal', 'NORMAL', 'Weekly team meeting moved', 300),
  base('n-urgent', 'URGENT', 'Office closed on Friday', 100, { attachments: [{ id: 'f1', name: 'holiday-list.pdf', mime: 'application/pdf', size: 20480 }] }),
  base('n-important', 'IMPORTANT', 'New leave policy', 200)
];
if (!w.__server) w.__server = { items: seed(), failAck: false };
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, body, search: url.search });
  const p = url.pathname.replace('/api/v1', '');
  const s = w.__server;
  if (p === '/notices/pending') {
    if (s.offline) return json({ code: 'INTERNAL', message: 'down' }, 500);
    const items = [...s.items].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.publishAt.localeCompare(b.publishAt));
    return json({ pending: items.length, items });
  }
  const ack = p.match(/^\/notices\/([^/]+)\/acknowledge$/);
  if (ack && method === 'POST') {
    if (s.failAck) return json({ code: 'INTERNAL', message: 'The notice could not be saved right now.' }, 500);
    // like the database: the notice was deleted while it was on screen
    if (s.deletedIds?.includes(ack[1])) { s.items = s.items.filter((x: any) => x.id !== ack[1]); return json({ code: 'NOT_FOUND', message: 'Notice not found.' }, 404); }
    s.items = s.items.filter((x: any) => x.id !== ack[1]);
    return json({ noticeId: ack[1], acknowledged: true, acknowledgedAt: new Date().toISOString(), pending: s.items.length });
  }
  if (p.match(/^\/employee\/issue-attachments\/[^/]+\/url$/)) return json({ url: 'https://files.example.com/holiday-list.pdf' });
  return json({ code: 'NOT_FOUND', message: `No stand-in for ${method} ${p}` }, 404);
};
w.__publish = (notice: any) => {
  w.__server.items.push(notice);
  w.__bell = [{ id: `bell-${notice.id}`, type: 'COMPANY_NOTICE', isRead: false, entityType: 'company_notice', entityId: notice.id }, ...w.__bell];
  window.dispatchEvent(new Event('stub:bell'));
};
w.__notice = base;
let root: Root | null = null;
w.mount = (opts: { signedOut?: boolean } = {}) => {
  w.__profile = opts.signedOut ? null : { id: 'emp1', fullName: 'Asha Rao', role: 'TEAM_MEMBER', status: 'ACTIVE' };
  root?.unmount();
  root = createRoot(document.getElementById('root')!);
  root.render(<div style={{ minHeight: '100vh' }}><p>The CRM page behind the popup</p><NoticePopupHost /></div>);
};
w.unmount = () => { root?.unmount(); root = null; };
