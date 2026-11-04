// Company-readable internal chat (migration 20261224000200), real browsers against the local stack (run-chat-readable.sh).
// Two people sign in on browsers that never held a secure-messaging key (= new devices) and chat at once: no "Turn on secure messaging",
// no recovery passphrase, no "could not be set up" bar, no locked composer. An older encrypted message in the same chat is shown as not
// available here without blocking anything. Somebody outside the chat cannot read it. Staff passwords come from E2E_PASSWORDS.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const OUT = process.argv[2] || '.';
const TW = process.env.E2E_TAILWIND_FILE ? fs.readFileSync(process.env.E2E_TAILWIND_FILE) : null;
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const call = async (who, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/chat-readable-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
const expect = (c, m) => (c ? ok(m) : fail(m));
const wait = async (p, sel, m, t = 15000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
const login = async email => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });   // a fresh browser profile: no key on this "device"
  if (TW) await ctx.route(/cdn\.tailwindcss\.com/, r => r.fulfill({ body: TW, contentType: 'application/javascript' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector('nav button:has-text("Chat")', { timeout: 20000, state: 'attached' }).catch(async () => { current = p; await fail(`${email} did not reach a dashboard with Chat`); });
  return p;
};
const menuItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const openChat = async p => { await menuItem(p, 'Chat').click(); await wait(p, '.ch-page', 'the Chat page did not open'); await p.getByRole('tab', { name: /Messages/ }).click().catch(() => {}); };
const send = async (p, text) => { const box = p.getByLabel('Message', { exact: true }); await box.fill(text); await box.press('Enter'); };
const noSecureBarriers = async (p, who) => {
  await new Promise(r => setTimeout(r, 2500));   // give a would-be key set-up time to fail and show its bar
  const text = await p.locator('.ch-page').innerText();
  await expect(!/could not be set up|Turn on secure messaging|recovery passphrase|Unlock secure messaging|not available in this browser/i.test(text)
    && await p.locator('[data-testid="secure-list-bar"], [data-testid="secure-turn-on"], [data-testid="secure-pass"]').count() === 0,
    `${who}: no secure-messaging bar, button or passphrase anywhere in Chat`);
};

await q(`update public.chat_settings set internal_mode = 'STANDARD'`);
const mohan = await idOf('tm.delivery@amuwa.com'), rina = await idOf('tm2.delivery@amuwa.com'), dina = await idOf('tl.delivery@amuwa.com'), dh = await idOf('dh@amuwa.com');
await q(`delete from public.chat_user_keys where profile_id = any($1)`, [[mohan, rina]]);   // nobody has a key: as on a new device

// an older end-to-end encrypted message already in their direct chat (an envelope nobody here can open)
const dm = (await call(mohan, 'POST', '/chat/direct', { profileId: rina })).data.id;
await q(`with c as (update public.chat_conversations set last_seq = last_seq + 1, last_message_at = now(), last_message_preview = 'Encrypted message' where id = $1 returning last_seq)
         insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, kind, body, client_msg_id, attachments, encrypted, e2ee)
         select $1, c.last_seq, $2, 'STAFF', 'Mohan Member', 'TEXT', '', gen_random_uuid(), '[]', true,
                jsonb_build_object('v', 1, 'sv', 1, 'iv', 'AAAAAAAAAAAAAAAA', 'ct', 'b3BhcXVlIG9sZCBtZXNzYWdl', 'wraps', jsonb_build_array(jsonb_build_object('to', $3::text, 'kv', 1, 'enc', repeat('A', 88), 'w', repeat('W', 24))))
           from c`, [dm, mohan, rina]);

const M = await login('tm.delivery@amuwa.com');
const R = await login('tm2.delivery@amuwa.com');
await openChat(M);
await noSecureBarriers(M, 'Mohan');
await M.locator('.ch-item', { hasText: 'Rina Rao' }).click();
await wait(M, '.ch-head h2:has-text("Rina Rao")', 'the direct chat did not open');
await wait(M, '[data-testid="message-undecryptable"]', 'the older encrypted message is not shown as such');
await expect(/end-to-end encrypted/.test(await M.locator('[data-testid="message-undecryptable"]').first().innerText()), 'the older encrypted message is shown as not available on this device (not an empty bubble)');
await expect(await M.getByLabel('Message', { exact: true }).isEnabled(), 'and the composer is open anyway');
await send(M, 'Hello from a brand new browser');
await wait(M, '.ch-row.mine .ch-bubble:has-text("brand new browser")', 'Mohan’s message is not shown');
await openChat(R);
await noSecureBarriers(R, 'Rina');
await R.locator('.ch-item', { hasText: 'Mohan Member' }).click();
await wait(R, '.ch-bubble:has-text("brand new browser")', 'Rina does not receive it');
ok('Rina, on another new browser, receives it');
await send(R, 'Got it, thanks');
await wait(M, '.ch-bubble:has-text("Got it, thanks")', 'the reply does not arrive live');
ok('the reply arrives live in Mohan’s browser');
await M.screenshot({ path: `${OUT}/chat-readable-mohan.png` });

// a group with three people, also without keys
await M.getByRole('button', { name: /New/ }).click();
await M.getByRole('tab', { name: 'Group' }).click();
await M.getByLabel('Group name').fill('Readable team');
await M.getByLabel('Find a colleague').fill('Rina');
await M.locator('.ch-modal .ch-person', { hasText: 'Rina Rao' }).click();
await M.getByLabel('Find a colleague').fill('Dina');
await M.locator('.ch-modal .ch-person', { hasText: 'Dina Delivery' }).click();
await M.getByRole('button', { name: 'Create group' }).click();
await wait(M, '.ch-head h2:has-text("Readable team")', 'the group did not open');
await send(M, 'Team update without any key');
await wait(R, '.ch-item:has-text("Readable team")', 'the group does not reach Rina');
await R.locator('.ch-item', { hasText: 'Readable team' }).click();
await wait(R, '.ch-bubble:has-text("Team update without any key")', 'the group message is not shown to Rina');
ok('a group message works without keys too, and reaches the members live');

// what the database holds, and who can read it
const rows = await q(`select encrypted, body from public.chat_messages where conversation_id = $1 order by seq`, [dm]);
await expect(rows.filter(r => !r.encrypted).map(r => r.body).join('|') === 'Hello from a brand new browser|Got it, thanks' && rows.filter(r => r.encrypted).length === 1,
  'stored: the two new messages readable, the older encrypted one untouched');
await expect((await q(`select count(*)::int n from public.chat_user_keys where profile_id = any($1)`, [[mohan, rina]]))[0].n === 0, 'no key was made for either of them');
const outsider = await call(dh, 'GET', `/chat/conversations/${dm}/messages`);
await expect([403, 404].includes(outsider.status), 'a Department Head outside the conversation cannot read it');
const stranger = await call(dina, 'GET', `/chat/conversations/${dm}/messages`);
await expect([403, 404].includes(stranger.status), 'nor can a colleague who is not in it');
await expect(errors.length === 0, 'no page errors in either browser');
console.log(`=== CHAT (COMPANY-READABLE) BROWSER TESTS PASSED (${step}) ===`);
await browser.close(); await db.end();
