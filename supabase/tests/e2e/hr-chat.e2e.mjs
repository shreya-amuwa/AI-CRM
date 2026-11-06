// HR in the company chat, in real browsers signed in at the same time (local stack with the Realtime stand-in): the HR Recruiter's sidebar has
// Communication > Chat; the Recruiter finds a Sales Team Member with the Department filter, writes; the Team Member's own Chat shows the SAME
// conversation live, unread, and replies; the reply reaches the Recruiter without a reload. The HR Assistant's menu has Chat too and does not see
// the pair's conversation. Passwords are made up per run. See supabase/tests/e2e/README.md (run-hr-chat.sh).
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const GATEWAY = process.env.E2E_GATEWAY || 'http://localhost:54400';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0]?.id;
const call = async (who, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); const j = await r.json(); return { status: r.status, ...j }; };

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
const pages = [];
const fail = async m => {
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${OUT}/hr-chat-fail-${i}.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
const until = async (fn, ms = 20000) => { for (const t = Date.now(); Date.now() - t < ms;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 300)); } return null; };
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));

// ------------------------------------------------------------------ fixture through the real API: HR Recruiter, HR Assistant, a Sales Team Member
const sa = await idOf('root@amuwa.com');
const hr = (await q(`select id from departments where slug = 'hr'`))[0].id;
let hrTeam = (await q(`select id from teams where department_id = $1 order by created_at limit 1`, [hr]))[0]?.id;
if (!hrTeam) hrTeam = (await q(`insert into teams (department_id, name, division) values ($1, 'General', 'GENERAL') returning id`, [hr]))[0].id;
const wab = (await q(`select id, name from departments where slug = 'wabastore'`))[0];
const salesTeam = (await q(`select id from teams where department_id = $1 and division = 'SALES' order by created_at limit 1`, [wab.id]))[0].id;
const tag = crypto.randomBytes(3).toString('hex');
const details = d => ({ designation: d, joiningDate: '2025-01-10', dateOfBirth: '1995-05-05', bloodGroup: 'A+', contactNumber: '+91 98111 22222', emergencyContact: '+91 98765 43210' });
const mk = async (email, name, teamId, designation) => {
  const r = await call(sa, 'POST', '/users', { email, fullName: name, role: 'TEAM_MEMBER', teamId, ...(designation ? { details: details(designation) } : {}) });
  if (!r.success) await fail(`fixture ${email}: ${JSON.stringify(r.error)}`);
  return r.data.id;
};
const REC = `rec.${tag}@amuwa.com`, ASST = `asst.${tag}@amuwa.com`, TM = `tm.${tag}@amuwa.com`;
const REC_NAME = `Simran Chat ${tag}`, TM_NAME = `Ravi Sales ${tag}`;
const recId = await mk(REC, REC_NAME, hrTeam, 'HR Recruiter');
await mk(ASST, `Asha Chat ${tag}`, hrTeam, 'HR Assistant');
const tmId = await mk(TM, TM_NAME, salesTeam, null);
await q(`update public.chat_settings set internal_mode = 'STANDARD' where id`);

const signIn = async (email, viewport = { width: 1440, height: 900 }) => {
  const pw = secret();
  await fetch(GATEWAY + '/auth/v1/user', { method: 'PUT', headers: { authorization: `Bearer ${sign({ sub: await idOf(email), role: 'authenticated' })}`, apikey: process.env.SUPABASE_ANON_KEY || '', 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${email} pageerror: ${e.message}`));
  pages.push(p);
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pw);
  await p.locator('form button[type="submit"]').click();
  return p;
};
const sectionOf = async (nav, label) => nav.evaluate((n, l) => [...n.children].find(g => (g.querySelector('button[aria-expanded], div')?.textContent ?? '').trim().toLowerCase() === l.toLowerCase())?.innerText ?? '', label);

// ------------------------------------------------------------------ 1. the HR Recruiter: Communication > Chat
const rec = await signIn(REC);
await rec.waitForURL(/\/hr-recruiter\/dashboard\//, { timeout: 25000 }).catch(() => fail('the Recruiter did not reach the recruiter dashboard'));
const rnav = rec.getByRole('navigation', { name: /HR Recruiter navigation pages/ });
await rnav.waitFor({ timeout: 15000 });
const comm = await sectionOf(rnav, 'Communication');
await expect(/Chat/.test(comm) && /Notifications/.test(comm), 'HR Recruiter sidebar: a Communication section with Chat and Notifications', comm);
await expect((await rnav.getByRole('button', { name: 'Vacancies' }).count()) === 1 && (await rnav.getByRole('button', { name: 'Recruitment Reports' }).count()) === 1, 'the recruitment pages are still there');
await rnav.getByRole('button', { name: /^Chat/ }).click();
await rec.waitForURL(/\/chat$/, { timeout: 10000 }).catch(() => undefined);
await rec.getByRole('button', { name: 'New', exact: true }).waitFor({ timeout: 20000 }).catch(() => fail('the Chat page did not open for the Recruiter'));
ok('the HR Recruiter opens the company Chat page');

// ------------------------------------------------------------------ 2. find the Sales Team Member through the Department filter and write
await rec.getByRole('button', { name: 'New', exact: true }).click();
const deptSel = rec.getByTestId('chat-department-filter');
await deptSel.waitFor({ timeout: 10000 });
const deptCount = (await q(`select count(*)::int n from departments where facet_of is null`))[0].n;
await expect((await deptSel.locator('option').count()) === deptCount + 1, 'the New message dialog offers every department as a filter');
await deptSel.selectOption(wab.id);
await rec.getByPlaceholder(/Search by name/).fill(TM_NAME);
const person = rec.getByRole('listitem').filter({ hasText: TM_NAME });
await person.waitFor({ timeout: 15000 }).catch(() => fail('the Team Member was not found with the department filter'));
await expect(/Wabastore|Sales/i.test(await person.innerText()), 'the contact shows their department', await person.innerText());
await rec.screenshot({ path: `${OUT}/hr-chat-1-new-message.png` });
await person.click();
const recMsg = rec.getByRole('textbox', { name: 'Message', exact: true });
await recMsg.waitFor({ timeout: 15000 });
const HELLO = `Hello from HR recruitment ${tag}`;
await recMsg.fill(HELLO);
await rec.getByRole('button', { name: 'Send message' }).click();
await expect(!!(await until(async () => (await rec.getByRole('log', { name: 'Messages' }).getByText(HELLO).count()) > 0)), "the Recruiter's message shows in the conversation");

// ------------------------------------------------------------------ 3. the Team Member, in their own dashboard, sees the same conversation live and replies
const tm = await signIn(TM);
await tm.waitForSelector('nav button', { timeout: 25000 }).catch(() => fail('the Team Member did not reach a dashboard'));
await tm.locator('nav button').filter({ hasText: /^Chat/ }).first().click();
const conv = tm.getByRole('list', { name: 'Chats' }).getByRole('button').filter({ hasText: REC_NAME });
await conv.waitFor({ timeout: 20000 }).catch(() => fail("the conversation with the Recruiter is not in the Team Member's chat list"));
await expect(/1/.test(await conv.innerText()), "it is shown as unread in the Team Member's list", await conv.innerText());
await conv.click();
await expect(!!(await until(async () => (await tm.getByRole('log', { name: 'Messages' }).getByText(HELLO).count()) > 0)), "the Team Member reads the Recruiter's message in the same conversation");
const REPLY = `Thanks HR, noted ${tag}`;
await tm.getByRole('textbox', { name: 'Message', exact: true }).fill(REPLY);
await tm.getByRole('button', { name: 'Send message' }).click();
await tm.screenshot({ path: `${OUT}/hr-chat-2-team-member.png` });

// ------------------------------------------------------------------ 4. the reply reaches the Recruiter without a reload
await expect(!!(await until(async () => (await rec.getByRole('log', { name: 'Messages' }).getByText(REPLY).count()) > 0, 25000)), 'the reply appears for the Recruiter live (no reload)');
await rec.screenshot({ path: `${OUT}/hr-chat-3-recruiter.png` });
const conversations = await q(`select c.id, (select count(*)::int from chat_messages m where m.conversation_id = c.id and m.kind = 'TEXT') n from chat_conversations c
                                where c.kind = 'DIRECT' and c.direct_key = least($1::text, $2::text) || ':' || greatest($1::text, $2::text)`, [recId, tmId]);
await expect(conversations.length === 1 && conversations[0].n === 2, 'one conversation for the pair in the database, with exactly the two messages (no duplicates)', conversations);

// ------------------------------------------------------------------ 5. the HR Assistant: Chat in the HR menu, and no view of the pair's conversation
const asst = await signIn(ASST);
await asst.waitForSelector('text=Human Resources', { timeout: 25000 }).catch(() => fail('the HR Assistant did not reach the HR dashboard'));
const anavText = await asst.locator('aside').first().innerText();
await expect(/COMMUNICATION/i.test(anavText) && /Chat/.test(anavText), 'HR Assistant sidebar: Communication with Chat', anavText);
await asst.locator('aside button').filter({ hasText: /^Chat/ }).first().click();
await asst.getByRole('button', { name: 'New', exact: true }).waitFor({ timeout: 20000 }).catch(() => fail('the Chat page did not open for the HR Assistant'));
await asst.waitForTimeout(1500);
await expect((await asst.getByRole('list', { name: 'Chats' }).getByText(TM_NAME).count()) === 0 && (await asst.getByText(HELLO).count()) === 0, "the HR Assistant does not see the Recruiter's conversation");
const peek = await call(await idOf(ASST), 'GET', `/chat/conversations/${conversations[0].id}/messages`);
await expect(peek.status === 404 || peek.status === 403, 'and the API refuses it when asked directly by id', peek.status);

// ------------------------------------------------------------------ 6. the HR Admin Head (Department Head of HR): Communication > Chat, and a chat with the Team Member
let head = (await q(`select p.email from profiles p join departments d on d.id = p.department_id where d.slug = 'hr' and p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head and p.status = 'ACTIVE' limit 1`))[0]?.email;
if (!head) {
  head = `hrhead.${tag}@amuwa.com`;
  const r = await call(sa, 'POST', '/users', { email: head, fullName: `Hema Head ${tag}`, role: 'DEPARTMENT_HEAD', departmentId: hr, details: details('HR Admin Head') });
  if (!r.success) await fail(`fixture HR Admin Head: ${JSON.stringify(r.error)}`);
}
const hd = await signIn(head);
await hd.waitForSelector('text=Human Resources', { timeout: 25000 }).catch(() => fail('the HR Admin Head did not reach the HR dashboard'));
const hnavText = await hd.locator('aside').first().innerText();
await expect(/COMMUNICATION/i.test(hnavText) && /Chat/.test(hnavText), 'HR Admin Head sidebar: Communication with Chat', hnavText);
await hd.locator('aside button').filter({ hasText: /^Chat/ }).first().click();
await hd.getByRole('button', { name: 'New', exact: true }).click({ timeout: 20000 });
await hd.getByPlaceholder(/Search by name/).fill(TM_NAME);
await hd.getByRole('listitem').filter({ hasText: TM_NAME }).click({ timeout: 15000 });
const HEAD_MSG = `Welcome to the team ${tag}`;
await hd.getByRole('textbox', { name: 'Message', exact: true }).fill(HEAD_MSG);
await hd.getByRole('button', { name: 'Send message' }).click();
await expect(!!(await until(async () => (await tm.getByRole('list', { name: 'Chats' }).getByText(HEAD_MSG).count()) > 0 || (await tm.getByRole('list', { name: 'Chats' }).getByRole('button').count()) >= 2, 25000)),
  "the HR Admin Head's message reaches the Team Member's chat list live");
await expect(errors.length === 0, 'no page errors', errors);

console.log(`\nHR CHAT BROWSER CHECKS PASSED (${step})`);
await browser.close();
await db.end();
