import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientChats } from '../../../src/components/chat/ClientChats';

/**
 * The real "My clients" chat tab with the shared Support desk (20270129000100), the CRM API answered in the page like the database:
 * the signed-in Support employee is the Relationship Manager of Mine Traders only; the desk also lists Beta Foods (RM Priya Shah, the client wrote last, nobody
 * handling) and Gamma Textiles (RM Rahul Verma, Rahul is handling it now). Taking over / releasing is answered like chat_set_handling; sending a message makes
 * the sender the handler. window.__calls records every request; window.__opts switches things (an empty desk, a refused handling call).
 */
const w = window as any;
w.__calls = [];
w.__opts = {};
const ME = '00000000-0000-4000-8000-000000000001';
const PRIYA = '00000000-0000-4000-8000-000000000002';
const RAHUL = '00000000-0000-4000-8000-000000000003';
const names: Record<string, string> = { [ME]: 'Asha Rao', [PRIYA]: 'Priya Shah', [RAHUL]: 'Rahul Verma' };
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
const client = (n: number, business: string, person: string, rm: string | null, rmName: string | null, role: string, unread: number, preview: string, ago: number, awaiting: boolean, handler: any) => ({
  customerId: `00000000-0000-4000-8000-00000000c0${n}`, name: person, business, code: `CUS-0000${n}`, channel: 'RM', conversationId: `00000000-0000-4000-8000-00000000f0${n}`,
  lastMessageAt: iso(ago), lastMessagePreview: preview, lastSenderName: awaiting ? person : (rmName ?? 'Support'), unread, hasLogin: true, role, groupName: null,
  rm: rm ? { id: rm, name: rmName } : null, handler, awaitingReply: awaiting, shared: true
});
const handlers: Record<string, any> = {
  '3': { id: RAHUL, name: 'Rahul Verma', at: iso(2), active: true, me: false }
};
const desk = () => [
  client(1, 'Mine Traders', 'Mina Joshi', ME, 'Asha Rao', 'Relationship Manager', 0, 'Thanks, noted', 40, false, handlers['1'] ?? null),
  client(2, 'Beta Foods', 'Bhavin Shah', PRIYA, 'Priya Shah', 'Support desk', 2, 'Is my invoice ready?', 12, true, handlers['2'] ?? null),
  client(3, 'Gamma Textiles', 'Gita Rao', RAHUL, 'Rahul Verma', 'Support desk', 0, 'Sent the catalogue', 5, false, handlers['3'] ?? null)
];
const mine = () => desk().filter(c => c.role !== 'Support desk').map(({ rm, handler, awaitingReply, shared, lastSenderName, ...c }) => c);
const msgs: Record<string, any[]> = {};
const convMsgs = (id: string) => (msgs[id] ??= [{
  id: `${id}-m1`, conversationId: id, seq: 1, mine: false, senderKind: 'CLIENT', senderName: 'Bhavin Shah', senderLabel: 'Client', kind: 'TEXT', body: 'Is my invoice ready?',
  attachments: [], clientMsgId: null, createdAt: iso(12), replyTo: null, deleted: false, encrypted: false, mentions: [], reactions: []
}]);
const conversation = (c: any) => {
  const list = convMsgs(c.conversationId);
  const last = list[list.length - 1];
  return {
    id: c.conversationId, kind: 'CLIENT', channel: 'RM', access: 'STAFF', canWrite: true, title: c.business, members: null, isAdmin: false, assigned: true,
    customer: { id: c.customerId, name: c.name, business: c.business, code: c.code, hasLogin: true }, team: { teamMember: c.rm ? { id: c.rm.id, name: c.rm.name, position: null } : null, teamLead: null },
    handler: c.handler, lastSeq: last.seq, lastMessageAt: last.createdAt, lastMessagePreview: last.body, lastSenderName: last.senderName, unread: c.unread, readSeq: 0, peerReadSeq: null, createdAt: iso(1000)
  };
};
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, query: url.search, body });
  const p = url.pathname.replace('/api/v1', '');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const matches = (c: any) => !q || `${c.business} ${c.name} ${c.code}`.toLowerCase().includes(q);
  if (p === '/chat/settings') return json({ mode: 'STANDARD' });
  if (p === '/chat/keys/status') return json({ hasKey: false });
  if (p === '/chat/unread') return json({ total: 0, conversations: [] });
  if (p === '/chat/my-clients') return json(mine().filter(matches));
  if (p === '/chat/desk-clients') return json(w.__opts.noDesk ? [] : desk().filter(matches));
  const cust = p.match(/^\/chat\/customers\/([^/]+)(\/support-group)?$/);
  if (cust) {
    if (cust[2]) return json({ code: 'NOT_FOUND', message: 'No group.' }, 404);
    const c = desk().find(x => x.customerId === cust[1]);
    return c ? json(conversation(c)) : json({ code: 'NOT_FOUND', message: 'Conversation not found.' }, 404);
  }
  const conv = p.match(/^\/chat\/conversations\/([^/]+)(\/.*)?$/);
  if (conv) {
    const id = conv[1];
    const c = desk().find(x => x.conversationId === id)!;
    const rest = conv[2] || '';
    if (!rest) return json(conversation(c));
    if (rest === '/handling') {
      if (w.__opts.refuseHandling) return json({ code: 'FORBIDDEN', message: 'You cannot handle this conversation.' }, 403);
      const n = id.slice(-1);
      handlers[n] = body.action === 'TAKE' ? { id: ME, name: 'Asha Rao', at: new Date().toISOString(), active: true, me: true } : null;
      return json(handlers[n]);
    }
    if (rest === '/messages' && method === 'GET') {
      const list = convMsgs(id);
      return json({ messages: list, hasMore: false, lastSeq: list[list.length - 1].seq, deletedIds: [] });
    }
    if (rest === '/messages' && method === 'POST') {
      const list = convMsgs(id);
      const m = { id: `${id}-m${list.length + 1}`, conversationId: id, seq: list.length + 1, mine: true, senderKind: 'STAFF', senderName: 'Asha Rao', senderLabel: 'Support Team', kind: 'TEXT', body: body.body,
        attachments: [], clientMsgId: body.clientMsgId ?? null, createdAt: new Date().toISOString(), replyTo: null, deleted: false, encrypted: false, mentions: [], reactions: [] };
      list.push(m);
      handlers[id.slice(-1)] = { id: ME, name: 'Asha Rao', at: new Date().toISOString(), active: true, me: true };
      return json(m, 201);
    }
    if (rest === '/read' || rest === '/delivered') return json(null);
    if (rest === '/receipts') return json([]);
    if (rest === '/keys') return json([]);
    if (rest === '/client-team') return json([]);
  }
  return json({ code: 'NOT_FOUND', message: `No stand-in for ${method} ${p}` }, 404);
};

w.mount = (opts: { noDesk?: boolean; refuseHandling?: boolean } = {}) => {
  w.__opts = opts;
  w.__profile = { id: ME, fullName: 'Asha Rao', role: 'TEAM_MEMBER', status: 'ACTIVE' };
  createRoot(document.getElementById('root')!).render(
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ClientChats active onUnreadChange={() => undefined} />
    </div>
  );
};
