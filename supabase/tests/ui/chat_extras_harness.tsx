import React from 'react';
import { createRoot } from 'react-dom/client';
import { InternalChats } from '../../../src/components/chat/InternalChats';

/**
 * The real internal chat (list, thread, composer) with the CRM API answered in the page, like the database: one group (me, Priya Shah,
 * Rahul Verma) and one direct chat; @mentions are kept only for group members; one reaction per person and message; Delete Inbox empties the list.
 * window.__calls records every request; window.__serverReact(emoji, who) changes a reaction "on the server" (then the test fires the Realtime event).
 */
const w = window as any;
w.__calls = [];
const ME = '00000000-0000-4000-8000-000000000001';
const PRIYA = '00000000-0000-4000-8000-000000000002';
const RAHUL = '00000000-0000-4000-8000-000000000003';
const OUTSIDER = '00000000-0000-4000-8000-000000000009';
const GROUP = '00000000-0000-4000-8000-0000000000a1';
const DM = '00000000-0000-4000-8000-0000000000d1';
w.__ids = { ME, PRIYA, RAHUL, OUTSIDER, GROUP, DM };
const names: Record<string, string> = { [ME]: 'Asha Rao', [PRIYA]: 'Priya Shah', [RAHUL]: 'Rahul Verma', [OUTSIDER]: 'Outside Person' };
const now = Date.now();
let seq = 0;
const msg = (conv: string, body: string, from: string, minutesAgo: number) => ({
  id: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`, conversationId: conv, seq, mine: from === ME, senderKind: 'STAFF', senderName: names[from],
  senderLabel: null, kind: 'TEXT', body, attachments: [], clientMsgId: null, createdAt: new Date(now - minutesAgo * 60000).toISOString(), replyTo: null,
  deleted: false, encrypted: false, mentions: [] as any[], reactions: [] as any[]
});
// 40 older messages in the group, so a message a notification points at is on an EARLIER page
const groupMsgs: any[] = [];
groupMsgs.push(msg(GROUP, 'The message you were tagged in, @Asha Rao', PRIYA, 300));
groupMsgs[0].mentions = [{ id: ME, name: 'Asha Rao', me: true }];
for (let i = 0; i < 40; i++) groupMsgs.push(msg(GROUP, `Older group message ${i + 1}`, i % 2 ? RAHUL : PRIYA, 200 - i));
groupMsgs.push(msg(GROUP, 'Can someone check the report?', PRIYA, 5));
const dmMsgs: any[] = [msg(DM, 'Hello Asha', PRIYA, 30)];
w.__focusMessage = groupMsgs[0].id;
w.__lastGroupMessage = groupMsgs[groupMsgs.length - 1].id;
const reactions = new Map<string, Map<string, string>>(); // message -> person -> emoji
const reactionsJson = (id: string) => {
  const by = new Map<string, string[]>();
  for (const [person, emoji] of reactions.get(id) ?? new Map()) by.set(emoji, [...(by.get(emoji) ?? []), person]);
  return [...by.entries()].map(([emoji, people]) => ({ emoji, count: people.length, mine: people.includes(ME), people: people.map(p => ({ id: p, name: names[p], me: p === ME })) }));
};
const setReaction = (id: string, person: string, emoji: string | null) => {
  const m = reactions.get(id) ?? new Map<string, string>();
  if (emoji) m.set(person, emoji); else m.delete(person);
  reactions.set(id, m);
};
w.__serverReact = (emoji: string | null, who: string) => setReaction(w.__lastGroupMessage, who, emoji);
let cleared = false;
const member = (id: string, role = 'MEMBER') => ({ id, name: names[id], role, position: null, label: 'Team Member', department: 'Wabastore', me: id === ME });
const conversation = (id: string) => {
  const list = id === GROUP ? groupMsgs : dmMsgs;
  const last = list[list.length - 1];
  return {
    id, kind: id === GROUP ? 'GROUP' : 'DIRECT', access: 'MEMBER', canWrite: true, title: id === GROUP ? 'Design review' : 'Priya Shah', customer: null, team: null,
    members: id === GROUP ? [member(ME, 'ADMIN'), member(PRIYA), member(RAHUL)] : [member(ME), member(PRIYA)], isAdmin: id === GROUP, assigned: null,
    lastSeq: last.seq, lastMessageAt: last.createdAt, lastMessagePreview: last.body, lastSenderName: last.senderName, unread: 0, readSeq: last.seq, peerReadSeq: null,
    createdAt: new Date(now - 86400000).toISOString()
  };
};
const withReactions = (m: any) => ({ ...m, reactions: reactionsJson(m.id) });
const json = (data: unknown, code = 200) => new Response(JSON.stringify(code < 400 ? { success: true, data } : { success: false, error: data }), { status: code, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  w.__calls.push({ method, path: url.pathname, query: url.search, body });
  const p = url.pathname.replace('/api/v1', '');
  if (p === '/chat/settings') return json({ mode: 'STANDARD' });
  if (p === '/chat/keys/status') return json({ hasKey: false });
  if (p === '/chat/unread') return json({ total: 0, conversations: [] });
  if (p === '/chat/internal') return json(cleared ? [] : [conversation(GROUP), conversation(DM)]);
  if (p === '/chat/inbox/clear') { cleared = true; return json({ scope: 'MINE', conversations: 2, messages: 43 }); }
  if (p === '/chat/inbox/purge') {
    if (w.__profile.role !== 'SUPER_ADMIN') return json({ code: 'FORBIDDEN', message: 'Only the Super Admin can delete the whole chat history.' }, 403);
    if (body.confirm !== 'DELETE ALL CHATS') return json({ code: 'VALIDATION_ERROR', message: 'Type DELETE ALL CHATS to confirm.' }, 422);
    cleared = true; return json({ scope: 'ALL_INTERNAL', conversations: 2, messages: 43, filesRemoved: 0, filesPending: 0 });
  }
  const conv = p.match(/^\/chat\/conversations\/([^/]+)(\/.*)?$/);
  if (conv) {
    const id = conv[1];
    const list = id === GROUP ? groupMsgs : dmMsgs;
    const rest = conv[2] || '';
    if (!rest) return json(conversation(id));
    if (rest === '/messages' && method === 'GET') {
      const before = Number(url.searchParams.get('before')) || null;
      const after = Number(url.searchParams.get('after')) || null;
      const limit = Number(url.searchParams.get('limit')) || 30;
      if (after) return json({ messages: list.filter(m => m.seq > after).map(withReactions), hasMore: false, lastSeq: list[list.length - 1].seq, deletedIds: [] });
      const older = list.filter(m => !before || m.seq < before);
      const page = older.slice(-limit);
      return json({ messages: page.map(withReactions), hasMore: older.length > page.length, lastSeq: list[list.length - 1].seq, deletedIds: [] });
    }
    if (rest === '/messages' && method === 'POST') {
      const m = msg(id, body.body, ME, 0);
      const bad = (body.mentions ?? []).filter((x: string) => id !== GROUP || ![PRIYA, RAHUL].includes(x));
      if (!bad.length) m.mentions = (body.mentions ?? []).map((x: string) => ({ id: x, name: names[x], me: false }));
      list.push(m);
      return json({ ...m, ...(bad.length ? { mentionWarning: 'You can only tag members of this group.' } : {}) }, 201);
    }
    if (rest === '/reactions') return json(Object.fromEntries((url.searchParams.get('ids') || '').split(',').filter(Boolean).map(x => [x, reactionsJson(x)])));
    if (rest === '/read' || rest === '/delivered') return json(null);
    if (rest === '/receipts') return json([]);
    if (rest === '/keys') return json([]);
  }
  const react = p.match(/^\/chat\/messages\/([^/]+)\/reaction$/);
  if (react) { setReaction(react[1], ME, body.emoji); return json({ messageId: react[1], reactions: reactionsJson(react[1]) }); }
  return json({ code: 'NOT_FOUND', message: `No stand-in for ${method} ${p}` }, 404);
};

w.mount = (opts: { role?: string; conversationId?: string; messageId?: string } = {}) => {
  w.__profile = { id: ME, fullName: 'Asha Rao', role: opts.role ?? 'TEAM_MEMBER', status: 'ACTIVE' };
  createRoot(document.getElementById('root')!).render(
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <InternalChats active initialId={opts.conversationId ?? null} initialMessageId={opts.messageId ?? null} onUnreadChange={() => undefined} />
    </div>
  );
};
