/** The chat live feed under load: ONE Realtime channel per tab for every badge and list, the membership feed limited to the person,
 *  reloads spread over a few seconds (not all screens at once), closed with the last listener; and the "ticks changed" broadcast. */
import { chatLiveHub, setChatLiveClientForTests } from '../../src/lib/chat/useChatLive.js';
import { onReceipt, setReceiptClientForTests, signalReceipt } from '../../src/lib/chat/receiptSignal.js';

let passed = 0;
const check = (ok: unknown, label: string, extra?: unknown) => { if (!ok) { console.error(`FAILED: ${label}`, extra ?? ''); process.exit(1); } passed++; console.log(`ok - ${label}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Ch { topic: string; filters: any[]; handlers: ((p?: any) => void)[]; sent: any[]; status?: (s: string) => void }
const opened: Ch[] = [];
const removed: string[] = [];
const fake: any = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me-1' } } } }) },
  channel(topic: string) {
    const existing = opened.find(c => c.topic === topic && !removed.includes(topic));
    const ch: Ch = existing ?? { topic, filters: [], handlers: [], sent: [] };
    if (!existing) opened.push(ch);
    const api: any = {
      on(_t: string, f: any, h: () => void) { ch.filters.push(f); ch.handlers.push(h); return api; },
      subscribe(cb?: (s: string) => void) { ch.status = cb; setTimeout(() => cb?.('SUBSCRIBED'), 5); return api; },
      send(m: any) { ch.sent.push(m); return Promise.resolve('ok'); },
      _ch: ch
    };
    return api;
  },
  async removeChannel(api: any) { removed.push(api._ch.topic); }
};
setChatLiveClientForTests(fake);
setReceiptClientForTests(fake);

// --- the shared feed
let a = 0, b = 0, c = 0;
const la = () => { a++; }, lb = () => { b++; }, lc = () => { c++; };
chatLiveHub.add(la); chatLiveHub.add(lb); chatLiveHub.add(lc);
await sleep(30);
const live = opened.filter(ch => ch.topic.startsWith('chat-live-'));
check(live.length === 1, 'three badges / lists share ONE Realtime channel', live.map(x => x.topic));
check(live[0].filters.some(f => f.table === 'chat_members' && f.filter === 'profile_id=eq.me-1'), 'membership changes: only the person\'s own rows', live[0].filters);
const t0 = Date.now();
live[0].handlers[0](); live[0].handlers[0](); live[0].handlers[1]();
await sleep(150);
check(a === 0, 'a change is not reloaded in the same instant (spread over a few seconds)');
await sleep(3200);
check(a === 1 && b === 1 && c === 1, 'three events in a burst: each listener reloads once', { a, b, c, ms: Date.now() - t0 });
chatLiveHub.remove(la); chatLiveHub.remove(lb);
check(chatLiveHub.channelOpen && removed.length === 0, 'still open while a listener remains');
chatLiveHub.remove(lc);
check(!chatLiveHub.channelOpen && removed.includes(live[0].topic), 'closed with the last listener');

// --- "the ticks changed" broadcast
let heard = 0;
const stop = onReceipt('conv-1', () => { heard++; });
const rc = opened.find(ch => ch.topic === 'chat-receipts:conv-1')!;
check(!!rc && rc.filters.some(f => f.event === 'receipt'), 'the open conversation listens to its own receipts topic');
signalReceipt('conv-1');
await sleep(30);
check(rc.sent.length === 1 && rc.sent[0].type === 'broadcast' && rc.sent[0].event === 'receipt' && JSON.stringify(rc.sent[0].payload) === '{}',
  'reporting "delivered" / "seen" sends a broadcast that carries nothing (no database write)', rc.sent);
rc.handlers[0]();
check(heard === 1, 'the sender\'s open conversation hears it');
stop();
await sleep(5100);
check(removed.includes('chat-receipts:conv-1'), 'the receipts channel is closed when nobody uses it any more');
console.log(`=== CHAT LIVE TESTS PASSED (${passed}) ===`);
