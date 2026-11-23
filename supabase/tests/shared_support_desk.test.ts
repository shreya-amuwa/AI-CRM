/**
 * The shared Support desk (migration 20270129000100), the parts that need no database: the desk list filters and the row text, the "handling" request schema, and that
 * the new routes are wired through the same controller -> service -> repository layers as every other chat route. The database rules are in
 * supabase/tests/shared_client_support_access_test.sql.
 */
import { readFileSync } from 'node:fs';
import type { ChatDeskClient, ChatHandler } from '../../shared/contracts.js';
import { chatHandlingSchema } from '../../shared/validation.js';
import { deskSub, filterDesk, handlerName, isMineOnDesk } from '../../src/components/chat/deskView.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const handler = (o: Partial<ChatHandler> = {}): ChatHandler => ({ id: 'h', name: 'Rahul Verma', at: '2030-01-01T10:00:00Z', active: true, me: false, ...o });
let n = 0;
const client = (o: Partial<ChatDeskClient> = {}): ChatDeskClient => ({
  customerId: `c${++n}`, name: `Person ${n}`, business: `Business ${n}`, code: `CUS-${n}`, conversationId: `v${n}`, lastMessageAt: null, lastMessagePreview: null, unread: 0, hasLogin: true, channel: 'RM',
  role: 'Support desk', groupName: null, rm: { id: 'rm', name: 'Priya Shah' }, handler: null, lastSenderName: null, awaitingReply: false, shared: true, ...o
});

const mine = client({ role: 'Relationship Manager' });
const lead = client({ role: 'Team Lead' });
const unread = client({ unread: 3 });
const waiting = client({ awaitingReply: true, lastSenderName: 'Bhavin' });
const handled = client({ handler: handler() });
const lapsed = client({ handler: handler({ active: false }) });
const all = [mine, lead, unread, waiting, handled, lapsed];

check(filterDesk(all, 'ALL').length === 6, 'All keeps every customer');
check(filterDesk(all, 'UNREAD').map(c => c.customerId).join() === unread.customerId, 'Unread keeps only customers with unread messages');
check(filterDesk(all, 'AWAITING').map(c => c.customerId).join() === waiting.customerId, 'Awaiting reply keeps only customers who wrote last');
check(filterDesk(all, 'HANDLING').map(c => c.customerId).join() === handled.customerId, 'Being handled keeps only an ACTIVE hold (a lapsed one is not "being handled")');
check(filterDesk(all, 'MINE').map(c => c.customerId).join() === [mine.customerId, lead.customerId].join(), 'Mine keeps the customers the person is the Relationship Manager or Team Lead of');
check(isMineOnDesk(mine) && isMineOnDesk(lead) && !isMineOnDesk(unread), 'a customer reachable only through the desk is not "mine"');

check(handlerName(null) === '' && handlerName(handler({ active: false })) === '', 'nobody is shown as handling when there is no hold or it has lapsed');
check(handlerName(handler()) === 'Rahul Verma' && handlerName(handler({ me: true })) === 'you', 'the handler is named, and "you" for the person themself');

check(deskSub(waiting) === `${waiting.name} - RM: Priya Shah - Awaiting reply`, 'a row says who the Relationship Manager is and that the client is waiting', deskSub(waiting));
check(deskSub(handled) === `${handled.name} - RM: Priya Shah - Handling: Rahul Verma`, 'a row says who is handling it', deskSub(handled));
check(deskSub(client({ rm: null })).includes('RM: not assigned'), 'a customer without a Relationship Manager says so');
check(deskSub(client({ lastSenderName: 'Priya Shah' })).includes('Last reply: Priya Shah'), 'with nobody handling, the last responder is shown');

check(chatHandlingSchema.safeParse({ action: 'TAKE' }).success && chatHandlingSchema.safeParse({ action: 'RELEASE' }).success, 'the handling request accepts TAKE and RELEASE');
check(!chatHandlingSchema.safeParse({ action: 'STEAL' }).success && !chatHandlingSchema.safeParse({}).success, 'and nothing else');
check(!chatHandlingSchema.safeParse({ action: 'TAKE', userId: 'someone-else' }).success, 'the browser cannot name who is handling: the schema is strict (the server uses the signed-in person)');

const routes = readFileSync('server/routes.ts', 'utf8');
check(/path: '\/chat\/desk-clients', handler: chat\.deskClients/.test(routes) && /path: '\/chat\/conversations\/:id\/handling', handler: chat\.setHandling, options: S/.test(routes), 'the desk list and the handling call are routes (the write is rate-limited like the other writes)');
const repo = readFileSync('server/repositories/ChatRepository.ts', 'utf8');
check(/'chat_desk_clients'/.test(repo) && /'chat_set_handling'/.test(repo), 'they call the database functions, which decide who may');
const controller = readFileSync('server/controllers/index.ts', 'utf8');
check(/deskClients: .*svc\(ctx\)\.chat\.deskClients/.test(controller) && /setHandling: .*svc\(ctx\)\.chat\.setHandling\(ctx\.params\.id, ctx\.req\.body\)/.test(controller), 'the controller passes only the conversation id and the body (no role, no user id)');
console.log(`=== SHARED SUPPORT DESK UNIT TESTS PASSED (${passed}) ===`);
