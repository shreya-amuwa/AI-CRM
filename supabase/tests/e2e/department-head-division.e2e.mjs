// Sales and Support Department Heads in a real browser against the local stack:
//   - the Super Admin's "Add Team Member" form offers Sales / Support when the role is Department Head (and not for other roles)
//   - a Sales head is created next to the department's existing head; the side that is taken cannot be picked again
//   - the Super Admin labels the earlier head Support in the list
//   - the new head signs in to the Department Head dashboard
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Department Head side browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3050';
const OUT = process.argv[2] || '.';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/dh-division-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
const login = async (email, ready) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000 }).catch(() => fail(`${email} did not reach the expected page (${ready})`));
  return p;
};

const sa = await login('root@amuwa.com', 'button:has-text("Add Team Member")');
const saMenu = (await sa.locator('aside nav button').allInnerTexts()).map(t => t.trim());
await expect(saMenu.includes('Departments') && saMenu.includes('Team Members') && !saMenu.some(t => /workflow/i.test(t)), 'the Super Admin menu has no Company Workflow', saMenu);
await sa.getByRole('button', { name: 'Add Team Member' }).click();
await sa.locator('#add-staff-department').waitFor({ timeout: 15000 });
await sa.locator('#add-staff-department').selectOption({ label: 'Wabastore' });
await sa.locator('#staff-role').waitFor({ timeout: 15000 });

await sa.locator('#staff-role').selectOption('TEAM_MEMBER');
await expect((await sa.locator('#staff-head-division').count()) === 0, 'the Sales / Support choice is not shown for a Team Member');
await sa.locator('#staff-role').selectOption('DEPARTMENT_HEAD');
await sa.locator('#staff-head-division').waitFor({ timeout: 5000 }).catch(() => fail('the Sales / Support choice does not show for a Department Head'));
const options = await sa.locator('#staff-head-division option').allInnerTexts();
await expect(options.some(o => /Sales Department Head/.test(o)) && options.some(o => /Support Department Head/.test(o)), 'the form offers a Sales and a Support Department Head', options);
await expect((await sa.locator('select').filter({ has: sa.locator('option', { hasText: 'Select team…' }) }).count()) === 0, 'a Department Head still has no team to choose');

const pw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
PASSWORDS['sales.head@amuwa.com'] = pw;
await sa.getByPlaceholder('e.g. Kunal Sharma').fill('Sales Head');
await sa.getByPlaceholder('kunal@amuwa.com').fill('sales.head@amuwa.com');
await sa.getByPlaceholder('min. 10 characters').fill(pw);
await sa.locator('input[type="date"]').first().fill('2025-01-10');
await sa.locator('input[type="date"]').nth(1).fill('1990-05-05');
await sa.locator('select').filter({ has: sa.locator('option', { hasText: 'A+' }) }).first().selectOption('A+');
await sa.getByPlaceholder('+91 98765 43210').fill('+91 98765 43210');
await expect(await sa.getByRole('button', { name: /Create|Add team member|Add member/i }).last().isDisabled(), 'creating is blocked until Sales or Support is chosen');
await sa.locator('#staff-head-division').selectOption('SALES');
await expect(/Sales Department Head Dashboard/.test(await sa.locator('[data-testid="team-member-management"]').innerText()), '"Will open: Sales Department Head Dashboard"');
await sa.screenshot({ path: `${OUT}/dh-division-form.png`, fullPage: true });
await sa.getByRole('button', { name: /Create|Add team member|Add member/i }).last().click();
const until = async (fn, ms = 15000) => { for (const t = Date.now(); Date.now() - t < ms;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } return null; };
await until(async () => (await q(`select 1 from profiles where email = 'sales.head@amuwa.com'`)).length) || await fail('the Sales Department Head was not created');
const head = (await q(`select role, head_division, default_dashboard, team_id from profiles where email = 'sales.head@amuwa.com'`))[0];
await expect(head && head.role === 'DEPARTMENT_HEAD' && head.head_division === 'SALES' && head.default_dashboard === 'sales-department-head' && head.team_id === null, 'the Sales Department Head is stored next to the existing head', head);
const two = (await q(`select count(*)::int n from profiles p join departments d on d.id = p.department_id where d.slug = 'wabastore' and p.role = 'DEPARTMENT_HEAD'`))[0].n;
await expect(two === 2, 'Wabastore now has two Department Heads', two);

// The Sales side is taken now.
await sa.locator('#staff-head-division').waitFor({ timeout: 5000 });
await sa.waitForFunction(() => [...document.querySelectorAll('#staff-head-division option')].some(o => o.disabled && /Sales/.test(o.textContent || '')), null, { timeout: 10000 })
  .catch(() => fail('the Sales side is still offered after a Sales head exists'));
const after = await sa.locator('#staff-head-division option').allInnerTexts();
await expect(after.some(o => /Sales Department Head \(taken by Sales Head\)/.test(o)), 'the Sales side shows who holds it', after);
await expect(await sa.locator('#staff-head-division option[value="SUPPORT"]').isEnabled(), 'the Support side is still free (the earlier head has no side yet)');

// Label the earlier head Support in the list.
const label = sa.getByLabel('Sales or Support side of Dev Head');
await label.waitFor({ timeout: 15000 }).catch(() => fail('the side selector is missing on the earlier head'));
await label.selectOption('SUPPORT');
await sa.waitForFunction(() => document.body.innerText.includes('Dev Head is now the Support Department Head'), null, { timeout: 15000 }).catch(() => fail('no confirmation after labelling the earlier head'));
await until(async () => (await q(`select 1 from profiles where email = 'dh@amuwa.com' and head_division = 'SUPPORT'`)).length);
const dev = (await q(`select head_division from profiles where email = 'dh@amuwa.com'`))[0];
await expect(dev.head_division === 'SUPPORT', 'the earlier head is now the Support Department Head', dev);
await sa.waitForFunction(() => [...document.querySelectorAll('#staff-head-division option')].every(o => o.disabled || !o.value), null, { timeout: 10000 })
  .catch(() => fail('both sides should now be taken'));
ok('both sides are taken, so a third head cannot be started from the form');
await sa.screenshot({ path: `${OUT}/dh-division-list.png`, fullPage: true });

// The new head signs in to the Department Head dashboard.
const dh = await login('sales.head@amuwa.com', 'nav button');
await expect(/Team Members & Access/.test(await dh.locator('nav').innerText()), 'the Sales Department Head opens the Department Head dashboard');
await dh.screenshot({ path: `${OUT}/dh-division-sales-head.png`, fullPage: true });

await expect(errors.length === 0, 'no page errors', errors);
await browser.close();
await db.end();
console.log('ALL DEPARTMENT HEAD SIDE BROWSER CHECKS PASSED');
