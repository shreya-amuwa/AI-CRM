// Operations Head creation, several departments on one account, the unified dashboard, and the Super Admin's controls, in a real browser against the
// local stack. The scenario of the task: create from the Super Admin form even though every selected department already has a Department Head; a second
// Operations Head; each signs in and sees only their own departments; add a department, remove one (access revoked); the Department Head rule still works.
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner) and the ones made up here; nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Operations Head browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3071';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const call = async (who, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); const j = await r.json(); return { status: r.status, ...j }; };
const apiOk = async (who, method, path, body) => { const j = await call(who, method, path, body); if (!j.success) throw new Error(path + JSON.stringify(j)); return j.data; };

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/ops-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
const until = async (fn, ms = 20000) => { for (const t = Date.now(); Date.now() - t < ms;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } return null; };
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.ctx = ctx;
  return p;
};
const signIn = async (email, ready) => {
  const p = await open();
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  if (ready === 'chooser-or-nav') await p.waitForFunction(() => document.body.innerText.includes('Choose a department') || !!document.querySelector('nav button'), null, { timeout: 25000 }).catch(() => fail(`${email} did not reach a dashboard`));
  else await p.waitForSelector(ready, { timeout: 25000 }).catch(() => fail(`${email} did not reach the expected page (${ready})`));
  return p;
};
// An Operations Head with several departments first chooses one to work in (their own), then opens the Operations Dashboard.
const operationsPage = async (email) => {
  const p = await signIn(email, 'chooser-or-nav');
  if (await p.getByText('Choose a department').count()) {
    await p.getByText('Open dashboard').first().click();
    await p.getByRole('button', { name: 'Operations Dashboard' }).first().waitFor({ timeout: 25000 }).catch(() => fail(`${email}: no Operations Dashboard entry after choosing a department`));
  }
  await p.getByRole('button', { name: 'Operations Dashboard' }).first().click();
  await p.waitForSelector('[data-testid="operations-dashboard"] [data-testid="ops-department-row"]', { timeout: 20000 }).catch(() => fail(`${email}: the Operations Dashboard did not show departments`));
  return p;
};
const rowNames = async p => (await p.locator('[data-testid="ops-department-row"] td:first-child').allInnerTexts()).map(t => t.replace(/\s*you approve heads\s*/i, '').trim()).sort();

// ------------------------------------------------------------------ fixture: a Department Head in every department the test uses
const sa = await idOf('root@amuwa.com');
const dep = async slug => (await q(`select id, name from departments where slug = $1`, [slug]))[0];
const D = { wab: await dep('wabastore'), acc: await dep('accounts'), dig: await dep('digitree'), hr: await dep('hr'), mp: await dep('mpillar'), wbx: await dep('whatsbox') };
const mkHead = async (slug, email, name) => { PASSWORDS[email] = secret(); await apiOk(sa, 'POST', '/users', { email, fullName: name, password: PASSWORDS[email], role: 'DEPARTMENT_HEAD', departmentId: D[slug].id }); };
await mkHead('dig', 'dh.digitree@amuwa.com', 'Digi Head');
await mkHead('hr', 'dh.hr@amuwa.com', 'Hari Head');
await mkHead('mp', 'dh.mpillar@amuwa.com', 'Mina Head');
const headsOf = async slug => (await q(`select count(*)::int n from profiles p join departments d on d.id = p.department_id where d.slug = $1 and p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head and p.status = 'ACTIVE'`, [slug]))[0].n;
await expect((await headsOf('wabastore')) === 1 && (await headsOf('accounts')) === 1 && (await headsOf('digitree')) === 1 && (await headsOf('hr')) === 1 && (await headsOf('mpillar')) === 1, 'fixture: every department that will be assigned already has a Department Head');

// ------------------------------------------------------------------ 1. the Super Admin creates the first Operations Head: Wabastore, Accounts, Digitree
const sup = await signIn('root@amuwa.com', 'button:has-text("Add Team Member")');
const createOps = async (name, email, departments) => {
  PASSWORDS[email] = secret();
  await sup.getByRole('button', { name: 'Add Team Member' }).click();
  await sup.locator('#staff-role').waitFor({ timeout: 15000 });
  await sup.locator('#staff-role').selectOption('OPERATIONS_HEAD');
  await sup.getByTestId('operations-departments').waitFor({ timeout: 5000 }).catch(() => fail('the department selector did not show for an Operations Head'));
  await expect((await sup.locator('#staff-head-division').count()) === 0, 'the Sales / Support choice of a Department Head is not shown for an Operations Head');
  await expect((await sup.getByTestId('operations-departments').locator('input[type="checkbox"]').count()) >= 6, 'the selector lists the departments as checkboxes (several can be ticked)');
  await sup.getByPlaceholder('e.g. Kunal Sharma').fill(name);
  await sup.getByPlaceholder('kunal@amuwa.com').fill(email);
  await sup.getByPlaceholder('min. 10 characters').fill(PASSWORDS[email]);
  await sup.locator('input[type="date"]').first().fill('2025-01-10');
  await sup.locator('input[type="date"]').nth(1).fill('1985-05-05');
  await sup.locator('select').filter({ has: sup.locator('option', { hasText: 'A+' }) }).first().selectOption('A+');
  await sup.getByTestId('member-contact-number').fill('+91 98111 22222');
  await sup.getByPlaceholder('+91 98765 43210').fill('+91 98765 43210');
  const submit = sup.getByRole('button', { name: /Create|Add team member|Add member/i }).last();
  await expect(await submit.isDisabled(), 'creating is blocked until at least one department is ticked');
  for (const d of departments) await sup.getByTestId(`ops-dept-${d.id}`).check();
  const summary = await sup.getByTestId('operations-departments-summary').innerText();
  await expect(departments.every(d => summary.includes(d.name)), 'the selected departments are shown clearly', summary);
  const text = await sup.locator('[data-testid="team-member-management"]').innerText();
  await expect(/Will open:\s*Operations Head Dashboard/.test(text), '"Will open: Operations Head Dashboard"');
  await expect(!/already has a .*Department Head/.test(text), 'no Department Head conflict warning although every ticked department already has a Department Head');
  await expect(await submit.isEnabled(), 'the Create Account button is enabled');
  await sup.screenshot({ path: `${OUT}/ops-form-${email.split('@')[0]}.png`, fullPage: true });
  await submit.click();
  const row = await until(async () => (await q(`select id, is_operations_head, status, role from profiles where email = $1`, [email]))[0]);
  if (!row) await fail(`the Operations Head ${email} was not created (the form said: ${(await sup.locator('[role="alert"]').allInnerTexts()).join(' | ')})`);
  return row;
};
const op1 = await createOps('Olive Ops', 'ops.one@amuwa.com', [D.wab, D.acc, D.dig]);
await expect(op1.is_operations_head && op1.status === 'ACTIVE' && op1.role === 'DEPARTMENT_HEAD', 'the first Operations Head was created successfully, without the Department Head conflict');
const assigned1 = (await q(`select d.slug from operations_head_departments o join departments d on d.id = o.department_id where o.profile_id = $1 order by d.slug`, [op1.id])).map(r => r.slug);
await expect(JSON.stringify(assigned1) === JSON.stringify(['accounts', 'digitree', 'wabastore']), 'the three departments are stored for the one account', assigned1);
await expect((await headsOf('wabastore')) === 1 && (await headsOf('accounts')) === 1 && (await headsOf('digitree')) === 1, 'and each department still has exactly its own Department Head');

// ------------------------------------------------------------------ 2. a second Operations Head: HR and M Pillar
await sup.waitForSelector('text=Team Member Added Successfully', { timeout: 15000 }).catch(() => undefined);
const op2 = await createOps('Omar Ops', 'ops.two@amuwa.com', [D.hr, D.mp]);
await expect(op2.is_operations_head && op2.id !== op1.id, 'the second Operations Head exists independently');
await expect((await q(`select count(*)::int n from profiles where email in ('ops.one@amuwa.com', 'ops.two@amuwa.com')`))[0].n === 2, 'two accounts, one per person');

// ------------------------------------------------------------------ 3. each signs in and sees only their own departments, on one dashboard
const p1 = await operationsPage('ops.one@amuwa.com');
const names1 = await rowNames(p1);
await expect(JSON.stringify(names1) === JSON.stringify([D.acc.name, D.dig.name, D.wab.name].sort()), 'the first Operations Head sees Wabastore, Accounts and Digitree in the same dashboard, and not HR or M Pillar', names1);
await p1.screenshot({ path: `${OUT}/ops-dashboard-one.png`, fullPage: true });
await p1.getByTestId('ops-department-filter').selectOption({ label: D.acc.name });
await expect((await rowNames(p1)).length === 1, 'the department filter narrows the dashboard to one department');
await p1.getByTestId('ops-department-filter').selectOption('');
await expect((await rowNames(p1)).length === 3, 'and the consolidated view returns');
const p2 = await operationsPage('ops.two@amuwa.com');
const names2 = await rowNames(p2);
await expect(JSON.stringify(names2) === JSON.stringify([D.hr.name, D.mp.name].sort()), 'the second sees only HR and M Pillar', names2);
await p2.ctx.close();

// ------------------------------------------------------------------ 4. the Super Admin adds a department to the first one, then removes one
const adminTab = async () => { await sup.getByRole('button', { name: 'Team Members', exact: true }).first().click().catch(() => {}); await sup.getByTestId('tab-operations').click(); await sup.waitForSelector('[aria-label="Operations Heads"]', { timeout: 15000 }); };
await adminTab();
const edit = async (email, mutate) => {
  const card = sup.locator('li', { hasText: email });
  await card.getByRole('button', { name: 'Edit departments' }).click();
  await sup.getByRole('dialog').waitFor({ timeout: 10000 });
  await mutate(sup.getByRole('dialog'));
  await sup.getByRole('button', { name: 'Save departments' }).click();
  await sup.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the departments dialog did not close'));
};
await edit('ops.one@amuwa.com', async dlg => { await dlg.locator('label', { hasText: D.wbx.name }).first().locator('input[type="checkbox"]').first().check(); });
await expect((await q(`select count(*)::int n from operations_head_departments where profile_id = $1`, [op1.id]))[0].n === 4, 'a fourth department was added to the same account');
await expect((await q(`select count(*)::int n from profiles where email = 'ops.one@amuwa.com'`))[0].n === 1, 'without creating another account');
await p1.getByRole('button', { name: 'Refresh' }).first().click();
await until(async () => (await rowNames(p1)).length === 4);
await expect((await rowNames(p1)).includes(D.wbx.name), 'the new department appears on the Operations Head\'s dashboard');
const digBefore = (await q(`select (select count(*)::int from profiles where department_id = $1) people, (select count(*)::int from customers where department_id = $1) customers`, [D.dig.id]))[0];
await edit('ops.one@amuwa.com', async dlg => { await dlg.locator('label', { hasText: D.dig.name }).first().locator('input[type="checkbox"]').first().uncheck(); });
await p1.getByRole('button', { name: 'Refresh' }).first().click();
await until(async () => (await rowNames(p1)).length === 3);
await expect(!(await rowNames(p1)).includes(D.dig.name), 'a removed department leaves the dashboard');
const gone = await call(op1.id, 'GET', `/operations/departments/${D.dig.id}`);
await expect(gone.status === 403 || gone.status === 404, 'and the API refuses it at once', gone.status);
const digAfter = (await q(`select (select count(*)::int from profiles where department_id = $1) people, (select count(*)::int from customers where department_id = $1) customers`, [D.dig.id]))[0];
await expect(JSON.stringify(digBefore) === JSON.stringify(digAfter) && (await headsOf('digitree')) === 1, 'removing it deleted nothing: the department, its Department Head, people and customers are all still there', [digBefore, digAfter]);
await p1.ctx.close();

// ------------------------------------------------------------------ 5. suspend and reactivate from the Operations Heads list
sup.on('dialog', d => d.accept());
const two = sup.locator('li', { hasText: 'ops.two@amuwa.com' });
await two.getByRole('button', { name: 'Suspend' }).click();
await until(async () => (await q(`select status from profiles where id = $1`, [op2.id]))[0].status === 'SUSPENDED');
await expect((await call(op2.id, 'GET', '/operations/dashboard')).status === 403, 'a suspended Operations Head has no dashboard');
await sup.locator('li', { hasText: 'ops.two@amuwa.com' }).getByRole('button', { name: 'Reactivate' }).click();
await until(async () => (await q(`select status from profiles where id = $1`, [op2.id]))[0].status === 'ACTIVE');
const back = await call(op2.id, 'GET', '/operations/dashboard');
await expect(back.status === 200 && back.data.departments.length >= 2, 'and gets the same departments back when reactivated');

// ------------------------------------------------------------------ 6. the Department Head rule and the existing Department Heads
const dup = await call(sa, 'POST', '/users', { email: 'dup.head@amuwa.com', fullName: 'Second head', password: secret(), role: 'DEPARTMENT_HEAD', departmentId: D.hr.id });
await expect(dup.status === 409 && /already has a Department Head/.test(dup.error.message), 'a second Department Head of a department is still refused', dup);
const dhHr = await signIn('dh.digitree@amuwa.com', 'nav button');
await expect(/Team Members & Access/.test(await dhHr.locator('nav').innerText()), 'the existing Department Head still signs in to their dashboard');
await dhHr.ctx.close();
const heads = await call(sa, 'GET', '/operations/heads');
await expect(heads.status === 200 && heads.data.heads.filter(h => /ops\.(one|two)@/.test(h.email)).length === 2, 'the Super Admin sees both Operations Heads and their departments');
await expect(errors.length === 0, 'no page errors', errors);
await browser.close();
await db.end();
console.log(`ALL ${step} OPERATIONS HEAD BROWSER CHECKS PASSED`);
