// Chat, real browsers against the local stack (Postgres + PostgREST + gateway with the Realtime shim + the web app).
// Client chat (client, Team Member, Team Lead, Department Head review) and internal chat (DMs, groups, attachments).
// See supabase/tests/e2e/README.md for how to run it. No credentials live in this file: staff passwords come from
// E2E_PASSWORDS (a JSON object e-mail -> password, for the accounts your fixture created) and the two client logins use
// passwords made up at run time; phone numbers are generated.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000', GW = process.env.E2E_GATEWAY || 'http://localhost:54400';
const OUT = process.argv[2] || '.';
// the web app loads Tailwind from a CDN; offline machines can point E2E_TAILWIND_FILE at a local copy
const TW = process.env.E2E_TAILWIND_FILE ? fs.readFileSync(process.env.E2E_TAILWIND_FILE) : null;
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const randomPhone = () => `+91 9${crypto.randomInt(0, 1e9).toString().padStart(9, '0').replace(/^(\d{4})(\d{5})$/, '$1 $2')}`;
const ANON = process.env.SUPABASE_ANON_KEY || 'x';
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool(); // PGHOST / PGPORT / PGUSER / PGDATABASE from the environment
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const call = async (token, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); const j = await r.json(); return { status: r.status, ...j }; };
const denied = st => [401, 403, 404].includes(st);
const as = who => sign({ sub: who, role: 'authenticated' });
const api = async (who, method, path, body) => { const j = await call(as(who), method, path, body); if (!j.success) throw new Error(path + JSON.stringify(j)); return j.data; };
const signIn = async (email, password) => (await (await fetch(`${GW}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password }) })).json());

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/chat-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
const expect = (c, m) => (c ? ok(m) : fail(m));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  if (TW) await ctx.route(/cdn\.tailwindcss\.com/, r => r.fulfill({ body: TW, contentType: 'application/javascript' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  p.ctx = ctx;
  return p;
};
const staffLogin = async (email, viewport) => {
  const password = pwOf(email);
  const p = await open(viewport);
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(password);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector('nav button:has-text("Chat")', { timeout: 20000 }).catch(async () => { current = p; await fail(`${email} did not reach a dashboard with Chat in the menu`); });
  return p;
};
const wait = async (p, sel, m, t = 12000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
const gone = async (p, sel, m, t = 12000) => { current = p; await p.waitForSelector(sel, { state: 'detached', timeout: t }).catch(() => fail(m)); };
// Chat is a page in the dashboard's own menu (not a pop-up); on a phone the menu is behind the hamburger
const menuItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const openChat = async p => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 400)); }
  await menuItem(p, 'Chat').click();
  await wait(p, '.ch-page', 'the Chat page did not open');
};
const closeChat = async p => { await menuItem(p, 'Overview').click(); await gone(p, '.ch-page', 'the Chat page did not close'); };
const chatBadge = (p, n) => p.waitForFunction(k => [...document.querySelectorAll('nav button')].some(b => new RegExp(`^Chat\\s*${k}$`).test(b.innerText.replace(/\s+/g, ' ').trim())), n, { timeout: 12000 });
const send = async (p, text) => { const box = p.getByLabel('Message', { exact: true }); await box.fill(text); await box.press('Enter'); };
const bubble = (p, text) => p.locator('.ch-bubble', { hasText: text });
const sendBtnEnabled = p => p.getByRole('button', { name: 'Send message' }).isEnabled();

// ------------------------------------------------------------------ fixture: two clients with their teams
const rahul = await idOf('rahul@amuwa.com'), arun = await idOf('acc.member@amuwa.com'), tara = await idOf('consultant@amuwa.com');
const tm = await idOf('tm.delivery@amuwa.com'), tm2 = await idOf('tm2.delivery@amuwa.com'), tl = await idOf('tl.delivery@amuwa.com'), dh = await idOf('dh@amuwa.com');
const mk = async (name, company, phone, services, amount) => {
  const l = await api(rahul, 'POST', '/pipeline/leads', { name, company, phone, leadSource: 'Walk-in', services, notes: 'Wants to buy.' });
  await api(rahul, 'POST', `/pipeline/customers/${l.id}/send-to-accounts`, { amount });
  await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/payments`, { type: 'PART', amount: amount / 2, method: 'CASH', verify: true });
  await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/payment-confirmed`, { note: 'ok' });
  await q(`update customer_onboarding set forwarded_to_support_at = now(), stage = 'SETUP', sent_to_accounts_at = now(), accounts_confirmed_at = now() where customer_id = $1`, [l.id]);
  return l.id;
};
const CLIENT_A = { email: 'anil@acharya.example.com', password: secret() }, CLIENT_B = { email: 'bhavna@bose.example.com', password: secret() };
const A = await mk('Anil Acharya', 'Acharya Traders', randomPhone(), ['AI_CALLING'], 40000);
const B = await mk('Bhavna Bose', 'Bose Clinic', randomPhone(), ['META_ADS_MANAGEMENT'], 30000);
await api(tara, 'POST', `/pipeline/customers/${A}/client-account`, CLIENT_A);
await api(tara, 'POST', `/pipeline/customers/${B}/client-account`, CLIENT_B);
await q(`update customer_onboarding set team_member_id = $2, team_lead_id = $3 where customer_id = $1`, [A, tm, tl]);
await q(`update customer_onboarding set team_member_id = $2, team_lead_id = $3 where customer_id = $1`, [B, tm2, tl]);
ok('fixture: Acharya Traders is looked after by Mohan (Team Member) and Dina (Team Lead); Bose Clinic by Rina and Dina');

// ------------------------------------------------------------------ everyone signs in
const C = await open();
await C.goto(BASE + '/client/login');
await C.getByLabel('E-mail').fill('anil@acharya.example.com');
await C.getByLabel('Password', { exact: true }).fill(CLIENT_A.password);
await C.getByRole('button', { name: 'Sign in' }).click();
await wait(C, 'h1.cd-page-title', 'client did not sign in');
const M = await staffLogin('tm.delivery@amuwa.com');
const L = await staffLogin('tl.delivery@amuwa.com');
const D = await staffLogin('dh@amuwa.com');
const R = await staffLogin('tm2.delivery@amuwa.com');
ok('a client, a Team Member, a Team Lead, a Department Head and a second Team Member are signed in in separate browsers');

// ------------------------------------------------------------------ client: the Chat tab
current = C;
await C.locator('.cd-side button', { hasText: 'Chat' }).click();
await wait(C, '.cd-chat-card', 'Chat tab did not open');
await wait(C, '.ch-head h2:has-text("Your Amuwa team")', 'team header missing');
await wait(C, '.ch-head-main p:has-text("Mohan Member")', 'the team names did not load');
const head = await C.locator('.ch-head').innerText();
await expect(/Mohan Member \(Team Member\)/.test(head) && /Dina Delivery \(Team Lead\)/.test(head), 'the client chat header names the assigned Team Member and Team Lead');
await expect(!/Dev Head|Rina/.test(await C.locator('body').innerText()), 'no Department Head or other employee is shown to the client');
await wait(C, '.ch-empty', 'empty state missing');
await expect(await C.getByText('Start the conversation').count() === 1, 'empty conversation shows a friendly empty state');
await C.screenshot({ path: `${OUT}/chat-client-empty.png` });

// staff side is already looking: Mohan opens "My clients" before the client writes anything
await openChat(M);
await M.getByRole('tab', { name: /My clients/ }).click();
await wait(M, '.ch-item:has-text("Acharya Traders")', 'Mohan does not see his client');
await expect(await M.locator('.ch-item', { hasText: 'Bose Clinic' }).count() === 0, 'Mohan sees only his own client (not Bose Clinic)');
await M.locator('.ch-item', { hasText: 'Acharya Traders' }).click();
await wait(M, '.ch-empty', 'staff thread should be empty');

// the client writes: Enter sends
await send(C, 'Hello, I need help with my campaign');
await wait(C, '.ch-row.mine:not(.pending) .ch-bubble:has-text("Hello, I need help with my campaign")', 'own message not shown');
const first = (await q(`select m.* from chat_messages m join chat_conversations c on c.id = m.conversation_id where c.customer_id = $1`, [A]));
await expect(first.length === 1 && first[0].sender_kind === 'CLIENT' && Number(first[0].seq) === 1, 'the message is stored once, as a CLIENT message, with seq 1');
const convA = (await q(`select id from chat_conversations where customer_id = $1`, [A]))[0].id;
await wait(M, '.ch-bubble:has-text("Hello, I need help with my campaign")', "Mohan's open chat did not receive the message without a refresh");
ok("Mohan's open chat shows the client's message live (no refresh)");
const sgeo = await M.evaluate(() => { const r = document.querySelector('.ch-page').getBoundingClientRect(); return { h: r.height, w: r.width, vh: window.innerHeight, vw: window.innerWidth, popup: !!document.querySelector('.ch-overlay, [role="dialog"][aria-label="Chat"]') }; });
await expect(!sgeo.popup && sgeo.h > sgeo.vh - 140 && sgeo.w > sgeo.vw - 320, `employee chat is a full page in the dashboard (not a pop-up): ${Math.round(sgeo.w)} x ${Math.round(sgeo.h)} of ${sgeo.vw} x ${sgeo.vh}`);
await wait(C, '.ch-row.mine svg[aria-label="Seen"]', 'the client does not see the Seen tick');
ok('the client sees the message as Seen once the Team Member has it on screen');

// Dina (chat closed): badge appears live, one bell notification only
await chatBadge(L, 1).catch(() => fail("Dina's Chat menu item did not show 1 unread live"));
ok("Dina's Chat menu item shows 1 unread without a refresh");
await send(C, 'Also, can you check my invoice?');
await chatBadge(L, 2).catch(() => fail('second unread did not arrive'));
const bells = await q(`select count(*)::int n from notifications where recipient_id = $1 and type = 'CHAT_CLIENT_MESSAGE'`, [tl]);
await expect(bells[0].n === 1, 'Dina gets one in-app notification for an unread run of messages, not one per message');

// Mohan replies; the client sees it live with the right label
await send(M, "Hi Anil, I'm on it");
await wait(C, '.ch-row.theirs .ch-bubble:has-text("Hi Anil, I\'m on it")', 'reply did not reach the client live');
const reply = await C.locator('.ch-row.theirs .ch-bubble', { hasText: "I'm on it" }).innerText();
await expect(/Mohan Member/.test(reply) && /Team Member/.test(reply), 'the client sees who answered: name and "Team Member"');
// WhatsApp-style layout: my messages on the right, the team's on the left, and the chat fills the page
const geo = await C.evaluate(() => {
  const body = document.querySelector('.ch-body').getBoundingClientRect();
  const mine = document.querySelector('.ch-row.mine .ch-bubble').getBoundingClientRect();
  const theirs = document.querySelector('.ch-row.theirs .ch-bubble').getBoundingClientRect();
  const card = document.querySelector('.cd-chat-card').getBoundingClientRect();
  return { bodyLeft: body.left, bodyRight: body.right, mineRight: mine.right, theirsLeft: theirs.left, cardH: card.height, vh: window.innerHeight };
});
await expect(geo.bodyRight - geo.mineRight < 90 && geo.theirsLeft - geo.bodyLeft < 90, `my messages sit on the right edge and the team's on the left (mine ends ${Math.round(geo.bodyRight - geo.mineRight)}px from the right, theirs starts ${Math.round(geo.theirsLeft - geo.bodyLeft)}px from the left)`);
await expect(geo.cardH > geo.vh - 120, `the client chat fills the page (${Math.round(geo.cardH)}px of ${geo.vh}px)`);
await C.screenshot({ path: `${OUT}/chat-client-conversation.png` });

// unread badge on the client's sidebar while on another page
await C.locator('.cd-side button', { hasText: 'Overview' }).click();
await wait(C, 'h1.cd-page-title', 'overview');
await send(M, 'Let me know your preferred time for a call.');
await wait(C, '.cd-side button:has-text("Chat") .cd-nav-count', "client's Chat nav badge did not appear live");
ok("the client's Chat item shows an unread count while they are on another page");
const clientBell = await q(`select count(*)::int n from client_notifications where customer_id = $1 and entity_type = 'chat'`, [A]);
await expect(clientBell[0].n === 1, 'one Notification Center entry for the unread run (no per-message spam)');
await C.locator('.cd-side button', { hasText: 'Chat' }).click();
await wait(C, '.ch-bubble:has-text("preferred time")', 'message not shown after opening');
await gone(C, '.cd-side button:has-text("Chat") .cd-nav-count', 'the badge stays after reading');
ok('opening the chat clears the badge (read = it was on screen)');

// Team Lead joins in
await openChat(L);
await L.getByRole('tab', { name: /My clients/ }).click();
await L.locator('.ch-item', { hasText: 'Acharya Traders' }).click();
await wait(L, '.ch-bubble:has-text("preferred time")', 'Dina does not see the shared conversation history');
await send(L, 'Dina here, I will join the call.');
await wait(C, '.ch-bubble:has-text("Dina here")', 'Team Lead reply not live');
await expect(/Team Lead/.test(await C.locator('.ch-bubble', { hasText: 'Dina here' }).innerText()), 'the Team Lead is labelled "Team Lead"');
await wait(M, '.ch-bubble:has-text("Dina here")', 'Mohan does not see the Team Lead reply live');
ok('Team Member and Team Lead see one shared conversation with the client, live');

// ------------------------------------------------------------------ Department Head: review only
await openChat(D);
await wait(D, '[role="tab"]:has-text("Client conversations")', 'the Department Head has no review tab');
await D.getByRole('tab', { name: /Client conversations/ }).click();
await wait(D, '.ch-item:has-text("Acharya Traders")', 'review list is empty');
await expect(await D.locator('.ch-item', { hasText: 'Bose Clinic' }).count() === 0, 'a conversation that has not started is not listed');
await D.locator('.ch-item', { hasText: 'Acharya Traders' }).click();
await wait(D, '.ch-bubble:has-text("Dina here")', 'review thread did not load');
await expect(await D.getByLabel('Message', { exact: true }).count() === 0 && await D.getByRole('button', { name: 'Send message' }).count() === 0, 'the review screen has no message box and no send button');
await expect(/Review only/.test(await D.locator('.ch-locked').innerText()), 'the screen says it is review only');
const audit = await q(`select count(*)::int n from audit_logs where action = 'CLIENT_CHAT_REVIEWED' and actor_id = $1 and entity_id = $2`, [dh, convA]);
await expect(audit[0].n === 1, 'opening the conversation is written to the audit log');
await D.screenshot({ path: `${OUT}/chat-dh-review.png` });
await send(C, 'Thanks both!');
await wait(D, '.ch-bubble:has-text("Thanks both!")', 'the reviewer does not get live updates');
ok('the Department Head reads the client chat live, read only');
// the database and API refuse it even when the screen is bypassed
const attempt = await call(as(dh), 'POST', `/chat/conversations/${convA}/messages`, { body: 'I am the head', clientMsgId: crypto.randomUUID(), attachmentIds: [] });
await expect(attempt.status === 403 && !attempt.success, `a Department Head sending through the API directly is refused (${attempt.status})`);
const upl = await call(as(dh), 'POST', `/chat/conversations/${convA}/uploads`, { fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
await expect(upl.status === 403, 'a reviewer cannot start an upload either');
await expect((await q(`select count(*)::int n from chat_members where conversation_id = $1 and profile_id = $2`, [convA, dh]))[0].n === 0, 'the Department Head is not a participant of the conversation');
await expect((await q(`select count(*)::int n from chat_messages where conversation_id = $1 and body = 'I am the head'`, [convA]))[0].n === 0, 'nothing was written');
await closeChat(D);

// ------------------------------------------------------------------ isolation
const bose = (await signIn(CLIENT_B.email, CLIENT_B.password)).access_token;
const boseView = await call(bose, 'GET', '/client/chat');
await expect(boseView.success && boseView.data.page.messages.length === 0 && boseView.data.conversation.team.teamMember.name === 'Rina Rao', "another client's chat is their own: empty, and with their own team");
await expect(denied((await call(bose, 'GET', `/chat/conversations/${convA}/messages`)).status), "a client cannot read another client's conversation by id");
await expect(denied((await call(bose, 'GET', '/chat/internal')).status), 'a client cannot reach the employees\' chat list');
await expect(denied((await call(bose, 'GET', '/chat/directory?q=a')).status), 'a client cannot search employees');
await expect((await call(bose, 'POST', '/client/chat/messages', { body: 'hi', clientMsgId: crypto.randomUUID(), attachmentIds: [], conversationId: convA })).status === 422, 'a client cannot name a conversation: extra fields are refused');
const outsider = await call(as(rahul), 'GET', `/chat/conversations/${convA}`);
await expect(denied(outsider.status), 'an employee who does not look after the client cannot open the chat');
await expect(denied((await call(as(rahul), 'GET', `/chat/customers/${A}`)).status), 'or open it through the customer');
await expect(denied((await call(as(tm2), 'GET', `/chat/conversations/${convA}/messages`)).status), "another department member's team cannot read it either");
ok('isolation holds through the API');

// ------------------------------------------------------------------ failures, retry, no duplicates
current = C;
let blocked = true;
await C.route('**/api/v1/client/chat/messages', async route => {
  if (route.request().method() !== 'POST' || !blocked) return route.continue();
  await route.fetch();           // the server stores it ...
  await route.abort('failed');   // ... but the answer never arrives
});
await send(C, 'Please call me back');
await wait(C, '.ch-row.pending[data-state="failed"]', 'a failed send should be shown as Not sent');
await expect((await q(`select count(*)::int n from chat_messages where body = 'Please call me back'`))[0].n === 1, 'the server did store it once');
blocked = false;
await C.getByRole('button', { name: 'Retry' }).click();
await gone(C, '.ch-row.pending', 'pending bubble remains after retry');
await expect((await q(`select count(*)::int n from chat_messages where body = 'Please call me back'`))[0].n === 1 && await bubble(C, 'Please call me back').count() === 1, 'Retry did not create a duplicate (same client message id), one bubble on screen');
await C.context().setOffline(true);
await send(C, 'Sent while offline');
await wait(C, '.ch-row.pending[data-state="failed"]', 'offline send should fail visibly');
await C.context().setOffline(false);
await C.getByRole('button', { name: 'Retry' }).click();
await gone(C, '.ch-row.pending', 'offline retry stays pending');
await expect((await q(`select count(*)::int n from chat_messages where body = 'Sent while offline'`))[0].n === 1, 'a message that failed offline is delivered once after Retry');

// the reconnect catch-up: messages sent while the client is offline arrive when the network is back
await C.context().setOffline(true);
await send(M, 'You will get this when you are back');
await new Promise(r => setTimeout(r, 800));
await expect(await bubble(C, 'when you are back').count() === 0, 'an offline client does not have the message yet');
await C.context().setOffline(false);
await wait(C, '.ch-bubble:has-text("when you are back")', 'the client did not catch up after the network returned', 20000);
ok('after the connection returns, the client catches up on what they missed');

// ------------------------------------------------------------------ long history
const sendMany = async (who, conv, n, prefix) => {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })]);
    await c.query(`select public.chat_send_message($1, $2 || g, gen_random_uuid(), null, array[]::uuid[]) from generate_series(1, $3) g`, [conv, prefix, n]);
    await c.query('commit');
  } finally { c.release(); }
};
await sendMany(tm, convA, 45, 'history ');
await sendMany(tl, convA, 40, 'lead history ');
await C.reload();
await wait(C, '.ch-bubble:has-text("lead history 40")', 'history did not load');
const firstPage = await C.locator('.ch-body .ch-row').count();
await expect(firstPage <= 40 && await C.getByRole('button', { name: /Load earlier messages/ }).count() === 1, `the newest messages load first (${firstPage}), with a button for earlier ones`);
await C.getByRole('button', { name: /Load earlier messages/ }).click();
await C.waitForFunction(n => document.querySelectorAll('.ch-body .ch-row').length > n, firstPage, { timeout: 10000 }).catch(() => fail('older messages did not load'));
await expect(await C.locator('.ch-body .ch-row').count() > firstPage, 'earlier messages were added above');
const ids = await C.locator('.ch-row[data-seq]').evaluateAll(els => els.map(e => e.getAttribute('data-seq')));
await expect(new Set(ids).size === ids.length, 'no message is shown twice');
await C.screenshot({ path: `${OUT}/chat-client-history.png` });

// ------------------------------------------------------------------ internal chat: direct messages
current = M;
await M.getByRole('tab', { name: /Messages/ }).click();
await wait(M, '.ch-list-empty:has-text("No chats yet")', 'Mohan should have no internal chats yet');
await M.getByRole('button', { name: /New/ }).click();
await M.getByLabel('Find a colleague').fill('Rina');
await wait(M, '.ch-modal .ch-person:has-text("Rina Rao")', 'directory search finds nobody');
const dirText = await M.locator('.ch-modal').innerText();
await expect(!/@|\+91|salary|phone/i.test(dirText), 'the directory shows names and roles only (no e-mail, phone or other private details)');
await M.locator('.ch-modal .ch-person', { hasText: 'Rina Rao' }).click();
await wait(M, '.ch-head h2:has-text("Rina Rao")', 'the direct chat did not open');
await send(M, 'Can you cover my queue after lunch?');
await wait(M, '.ch-row.mine .ch-bubble:has-text("cover my queue")', 'DM not shown');
await chatBadge(R, 1).catch(() => fail("Rina's Chat menu item did not show 1 unread live"));
ok("Rina's Chat menu item shows the new direct message live");
await openChat(R);
await wait(R, '.ch-item.unread:has-text("Mohan Member")', 'unread conversation not highlighted');
await expect(/1/.test(await R.locator('.ch-item', { hasText: 'Mohan Member' }).locator('.ch-count').innerText()), 'the list shows an unread count and the preview');
await R.locator('.ch-item', { hasText: 'Mohan Member' }).click();
await wait(R, '.ch-bubble:has-text("cover my queue")', 'DM not loaded for Rina');
await wait(M, '.ch-row.mine svg[aria-label="Seen"]', 'Mohan does not see Seen live');
ok('Mohan sees the direct message as Seen once Rina has it on screen');
await send(R, 'Sure, no problem.');
await wait(M, '.ch-bubble:has-text("no problem")', 'reply not live');
await expect((await q(`select count(*)::int n from chat_conversations where kind = 'DIRECT'`))[0].n === 1, 'one direct conversation exists between the two');
// asking for it again does not create a second one
await M.getByRole('button', { name: /New/ }).click();
await M.getByLabel('Find a colleague').fill('Rina');
await M.locator('.ch-modal .ch-person', { hasText: 'Rina Rao' }).click();
await wait(M, '.ch-bubble:has-text("no problem")', 'reopened direct chat lost history');
await expect((await q(`select count(*)::int n from chat_conversations where kind = 'DIRECT'`))[0].n === 1, 'starting a chat with the same person again reopens the same conversation');

// attachments
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync('/tmp/chat-test.png', png);
fs.writeFileSync('/tmp/chat-test.exe', Buffer.from('MZ binary'));
fs.writeFileSync('/tmp/chat-big.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5.5 * 1024 * 1024, 0x20)]));
fs.writeFileSync('/tmp/chat-fake.png', Buffer.from('this is not a png'));
await M.locator('input[type="file"]').setInputFiles('/tmp/chat-test.exe');
await wait(M, '.ch-error:has-text("cannot be sent")', 'an executable should be refused');
await M.locator('input[type="file"]').setInputFiles('/tmp/chat-big.pdf');
await wait(M, '.ch-error:has-text("5 MB")', 'a big file should be refused');
await M.locator('input[type="file"]').setInputFiles('/tmp/chat-fake.png');
await wait(M, '.ch-error:has-text("not a real PNG")', 'a renamed text file should be refused');
ok('the composer refuses a wrong type, an oversize file and a file whose content is not what its name says');
await M.locator('input[type="file"]').setInputFiles('/tmp/chat-test.png');
await wait(M, '.ch-staged li:not(.busy):has-text("chat-test.png")', 'the upload did not finish');
await send(M, 'Here is the screenshot');
await wait(R, '.ch-file:has-text("chat-test.png")', 'attachment not shown to Rina');
const [tab] = await Promise.all([R.context().waitForEvent('page'), R.locator('.ch-file', { hasText: 'chat-test.png' }).click()]);
await tab.waitForLoadState().catch(() => {});
await new Promise(r => setTimeout(r, 800));
const fileUrl = tab.url();
await expect(/\/storage\/v1\/object\/sign\/chat-attachments\//.test(fileUrl) && /token=/.test(fileUrl), `the file opens through a short-lived signed link (${fileUrl.split('?')[0].replace(GW, '')})`);
await tab.close();
const attRow = (await q(`select id, status, storage_path from chat_attachments order by created_at desc limit 1`))[0];
await expect(attRow.status === 'READY' && !/public/.test(attRow.storage_path), 'the file is stored privately, marked ready');
const stranger = await call(as(rahul), 'GET', `/chat/attachments/${attRow.id}/url?action=view`);
await expect(denied(stranger.status), 'someone outside the conversation cannot get a link to the file');
const pub = await fetch(`${GW}/storage/v1/object/public/chat-attachments/${attRow.storage_path}`);
await expect(pub.status >= 400, 'there is no public URL for the file');

// ------------------------------------------------------------------ groups
await M.getByRole('button', { name: /New/ }).click();
await M.getByRole('tab', { name: 'Group' }).click();
await M.getByLabel('Group name').fill('Delivery crew');
await M.getByLabel('Find a colleague').fill('Rina');
await M.locator('.ch-modal .ch-person', { hasText: 'Rina Rao' }).click();
await M.getByLabel('Find a colleague').fill('Dina');
await M.locator('.ch-modal .ch-person', { hasText: 'Dina Delivery' }).click();
await M.getByRole('button', { name: 'Create group' }).click();
await wait(M, '.ch-head h2:has-text("Delivery crew")', 'the group did not open');
await send(M, 'Stand-up at 10');
await wait(R, '.ch-item:has-text("Delivery crew")', "Rina's list did not show the new group live");
await R.locator('.ch-item', { hasText: 'Delivery crew' }).click();
await wait(R, '.ch-bubble:has-text("Stand-up at 10")', 'group message not shown');
await expect(/Mohan Member/.test(await R.locator('.ch-bubble', { hasText: 'Stand-up at 10' }).innerText()), 'group messages show the sender');
await expect((await q(`select count(*)::int n from chat_members where conversation_id = (select id from chat_conversations where title = 'Delivery crew') and left_at is null`))[0].n === 3, 'the group has three members');
await M.screenshot({ path: `${OUT}/chat-employee-group.png` });

// Rina is a member, not an admin: she cannot manage the group
await R.getByRole('button', { name: 'Group details' }).click();
await wait(R, '.ch-modal', 'group details');
await expect(await R.getByRole('button', { name: /Rename/ }).count() === 0 && await R.getByRole('button', { name: /Remove .* from the group/ }).count() === 0, 'a plain member sees no admin controls');
await R.keyboard.press('Escape');
const grp = (await q(`select id from chat_conversations where title = 'Delivery crew'`))[0].id;
const sneaky = await call(as(tm2), 'POST', `/chat/groups/${grp}/members`, { profileIds: [rahul] });
await expect(sneaky.status === 403, 'and the server refuses a member who tries to add people anyway');
await expect(!(await q(`select 1 from chat_members where conversation_id = $1 and profile_id = $2`, [grp, rahul])).length, 'nobody was added');

// admin removes Rina, with a confirmation; her open screen reacts live
await M.getByRole('button', { name: 'Group details' }).click();
await M.getByRole('button', { name: 'Remove Rina Rao from the group' }).click();
await wait(M, '[role="alertdialog"]', 'removing a member should ask for confirmation');
await M.getByRole('button', { name: 'Remove', exact: true }).click();
await wait(R, '.ch-state:has-text("not available"), .ch-pane-empty:has-text("not available")', "Rina's open group did not close live after she was removed");
ok('removing a member takes the group away from their open screen at once');
const afterRemoval = await call(as(tm2), 'GET', `/chat/conversations/${grp}/messages`);
await expect(denied(afterRemoval.status), 'and the server no longer gives her the messages');
await M.keyboard.press('Escape');
await send(M, 'Rina is out, rest of us carry on');
await expect((await q(`select count(*)::int n from chat_messages where conversation_id = $1 and kind = 'SYSTEM'`, [grp]))[0].n >= 2, 'the group history records who was added and removed');

// Dina leaves
await openChat(L).catch(() => {});
await L.getByRole('tab', { name: /Messages/ }).click().catch(() => {});
await wait(L, '.ch-item:has-text("Delivery crew")', 'Dina sees the group');
await L.locator('.ch-item', { hasText: 'Delivery crew' }).click();
await L.getByRole('button', { name: 'Group details' }).click();
await L.getByRole('button', { name: 'Leave group' }).click();
await wait(L, '[role="alertdialog"]', 'leaving should ask for confirmation');
await L.locator('[role="alertdialog"]').getByRole('button', { name: 'Leave group' }).click();
await gone(L, '.ch-item:has-text("Delivery crew")', 'the group should disappear for someone who left');
await wait(M, '.ch-system:has-text("Dina Delivery left the group")', 'the others should see that she left');
ok('leaving a group asks first, removes it from your list, and tells the others');

// ------------------------------------------------------------------ mobile
const phone = await staffLogin('tm.delivery@amuwa.com', { width: 390, height: 780 });
await openChat(phone);
await phone.screenshot({ path: `${OUT}/chat-mobile-list.png` });
await expect(await phone.locator('.ch-detail:visible').count() === 0, 'on a phone the list is shown alone');
await phone.locator('.ch-item', { hasText: 'Rina Rao' }).click();
await wait(phone, '.ch-thread', 'thread');
await expect(await phone.locator('.ch-list-panel:visible').count() === 0, 'opening a chat replaces the list');
await phone.screenshot({ path: `${OUT}/chat-mobile-thread.png` });
const phoneGeo = await phone.evaluate(() => ({ composerBottom: document.querySelector('.ch-composer').getBoundingClientRect().bottom, vh: window.innerHeight, over: document.documentElement.scrollWidth > window.innerWidth + 1 }));
await expect(phoneGeo.composerBottom <= phoneGeo.vh + 1 && !phoneGeo.over, `on a phone the message box stays on screen and nothing scrolls sideways (box bottom ${Math.round(phoneGeo.composerBottom)} of ${phoneGeo.vh})`);
await phone.getByRole('button', { name: 'Back to chats' }).click();
await wait(phone, '.ch-list-panel', 'back to the list');
const pc = await open({ width: 390, height: 780 });
await pc.goto(BASE + '/client/login');
await pc.getByLabel('E-mail').fill('anil@acharya.example.com');
await pc.getByLabel('Password', { exact: true }).fill(CLIENT_A.password);
await pc.getByRole('button', { name: 'Sign in' }).click();
await wait(pc, 'h1.cd-page-title', 'mobile client sign in');
await pc.goto(BASE + '/client/dashboard/chat');
await wait(pc, '.ch-composer', 'mobile client chat');
await pc.screenshot({ path: `${OUT}/chat-mobile-client.png` });
await expect(await pc.evaluate(() => { const bar = document.querySelector('.cd-tabbar'); const limit = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : window.innerHeight; return document.querySelector('.ch-composer').getBoundingClientRect().bottom <= limit + 1; }), "on a phone the client's message box is not hidden behind the tab bar")
const overflow = await pc.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await expect(!overflow, 'the client chat fits a phone screen with no sideways scrolling');

// Shift+Enter makes a new line instead of sending
current = C;
const box = C.getByLabel('Message', { exact: true });
await box.fill('line one');
await box.press('Shift+Enter');
await box.type('line two');
await expect((await box.inputValue()) === 'line one\nline two' && await bubble(C, 'line two').count() === 0, 'Shift+Enter adds a new line without sending');
await box.press('Enter');
await wait(C, '.ch-bubble:has-text("line two")', 'multi-line message not sent');

// reply to a message: the quote travels with it
current = C;
await C.locator('.ch-row.theirs', { hasText: 'lead history 40' }).last().hover();
await C.getByRole('button', { name: 'Reply to Dina Delivery' }).last().click();
await wait(C, '.ch-replying:has-text("lead history 40")', 'the reply bar did not appear');
await send(C, 'Thanks, noted');
await wait(C, '.ch-quote:has-text("lead history 40")', 'the quote is not shown on the sender\'s screen');
current = M;
await M.getByRole('tab', { name: /My clients/ }).click();
await M.locator('.ch-item', { hasText: 'Acharya Traders' }).click();
await wait(M, '.ch-bubble:has-text("Thanks, noted") .ch-quote:has-text("lead history 40")', 'the quote did not reach the Team Member');
await expect((await q(`select reply_to is not null r from chat_messages where body = 'Thanks, noted'`))[0].r, 'a reply is stored with the message it answers');
const crossReply = await call(bose, 'POST', '/client/chat/messages', { body: 'sneaky', clientMsgId: crypto.randomUUID(), attachmentIds: [], replyTo: (await q(`select id from chat_messages where body = 'lead history 40'`))[0].id });
await expect(!crossReply.success, 'a client cannot reply to a message from a conversation that is not theirs');

await expect(errors.length === 0, 'no page errors or console errors in any browser' + (errors.length ? ' ' + JSON.stringify(errors.slice(0, 3)) : ''));
await browser.close();
await db.end();
console.log('all chat browser checks passed');
