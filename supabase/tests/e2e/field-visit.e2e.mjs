// Field Visit inside the Sales member dashboards in real browsers against the local stack (Postgres + PostgREST + gateway + the web app):
//   - Telecaller, Business Associate and Sales Team Member get a Field Visit group (10 pages) inside their own dashboard - no separate dashboard
//   - Overview numbers and the ten filters come from the database; Add Lead reuses the dashboard's own form (lead source "Field visit")
//   - schedule, start (location denied -> never marked as captured; location granted -> recorded), outcome with follow-up, per-lead history
//   - the Sales Department Head assigns a lead for a visit (the lead keeps its owner); the employee sees priority and instructions, cannot change it
//   - Support members and Team Leads have no Field Visit; the Accounts workflow is untouched; a phone-sized window has no sideways scrolling
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Field Visit browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3050';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const sign = p => {
  const e = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p });
  return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`;
};
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const api = async (who, method, path, body) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!j.success) throw new Error(`${method} ${path} ${JSON.stringify(j)}`);
  return j.data;
};

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/field-visit-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
const until = async (fn, ms = 15000) => { for (const t = Date.now(); Date.now() - t < ms;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } return null; };
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  return p;
};
const login = async (email, viewport, ready) => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000 }).catch(() => fail(`${email} did not reach the expected page (${ready})`));
  return p;
};
const menuLabels = p => p.locator('aside nav button').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
const page = async (p, label) => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 350)); }
  await p.locator('aside nav button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
};
const text = p => p.locator('main').innerText();

// a browser that is allowed to share its position (the others are not: headless Chromium then refuses the request)
const loginGeo = async (email, ready) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['geolocation'], geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 25 } });
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
const notice = (p, msg) => p.getByTestId('visit-notice').filter({ hasText: msg }).waitFor({ timeout: 20000 }).catch(() => fail(`no confirmation "${msg}"`));
const statIs = async (p, id, n) => !!(await until(async () => (await p.getByTestId(`stat-${id}`).innerText().catch(() => '')).trim() === String(n)));
const rawStatus = async (who, method, path, body) => (await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).status;
const NAV_ORDER = ['Field Visit Overview', 'Department Head Assigned Leads', 'Add Lead', 'All Leads', 'My Leads', 'Department Leads', 'To Accounts', 'Returned by Accounts', 'My Field Visits', 'Visit History'];
const fvNav = async (p, label) => { await p.locator('aside nav button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click(); };
const groupOf = async p => { const l = await menuLabels(p); const i = l.indexOf('Field Visit'); return i < 0 ? null : l.slice(i + 1, i + 1 + NAV_ORDER.length); };
const noSideways = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const todayIST = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const inDays = n => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

// ------------------------------------------------------------------ fixture
const root = await idOf('root@amuwa.com');
const wab = (await api(root, 'GET', '/departments')).find(d => d.slug === 'wabastore');
const salesTeam = (await api(root, 'GET', `/teams?departmentId=${wab.id}`)).find(t => t.name === 'Sales');
const mk = async (email, fullName, extra) => {
  const pw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
  PASSWORDS[email] = pw;
  return api(root, 'POST', '/users', { email, fullName, password: pw, ...extra });
};
const head = await mk('sales.head@amuwa.com', 'Sana Sales-Head', { role: 'DEPARTMENT_HEAD', departmentId: wab.id, headDivision: 'SALES' });
const tele = await mk('fv.tele@amuwa.com', 'Fiona Telecaller', { role: 'TEAM_MEMBER', teamId: salesTeam.id, salesSubRole: 'TELECALLER' });
const ba = await mk('fv.ba@amuwa.com', 'Bina Associate', { role: 'TEAM_MEMBER', teamId: salesTeam.id, salesSubRole: 'BUSINESS_ASSOCIATE' });
const rahul = await idOf('rahul@amuwa.com');
await q(`insert into customers (owner_id, name, company, phone, lifecycle_stage, lead_temperature, call_status, lead_source) values ($1, 'Rahul Lead One', 'Rahul Traders', '+919000000021', 'LEAD', 'WARM', 'INTERESTED', 'Website'), ($2, 'Tele Accounts Lead', 'Accounts Co', '+919000000022', 'LEAD', 'HOT', 'INTERESTED', 'Website')`, [rahul, tele.id]);
await q(`update customers set payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' where name = 'Tele Accounts Lead'`);
const rahulLead = (await q(`select id from customers where name = 'Rahul Lead One'`))[0].id;
await expect(true, 'fixture: a Sales Department Head, a Telecaller, a Business Associate, a Sales member and leads');

// ------------------------------------------------------------------ 1. Telecaller: the group is inside the existing dashboard
const t1 = await login('fv.tele@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await t1.waitForURL(/\/telecaller\/dashboard\//, { timeout: 15000 }).catch(() => fail('the Telecaller did not land on /telecaller/dashboard/…: ' + t1.url()));
let labels = await menuLabels(t1);
await expect(['Home', 'Tasks', 'Leads', 'Field Visit'].every(l => labels.includes(l)), 'Telecaller: the existing menu is kept and Field Visit is added', labels);
await fvNav(t1, 'Field Visit');
await expect(JSON.stringify(await groupOf(t1)) === JSON.stringify(NAV_ORDER), 'Telecaller: Field Visit opens the ten pages in the agreed order', await groupOf(t1));
await fvNav(t1, 'Field Visit Overview');
await t1.getByTestId('fv-overview').waitFor({ timeout: 15000 });
await expect(/\/telecaller\/dashboard\//.test(t1.url()), 'Telecaller: Field Visit is a page of the same dashboard (no separate dashboard)', t1.url());
const cards = ['Total Assigned Leads', 'My Leads', "Today's Scheduled Visits", 'Completed Field Visits', 'Pending Field Visits', 'Follow-ups Required'];
const overviewText = await text(t1);
await expect(cards.every(c => overviewText.includes(c)), 'Overview: the six cards', cards.filter(c => !overviewText.includes(c)));
await expect((await t1.locator('button[data-testid^="fv-filter-"]').count()) === 10, 'Overview: ten filters');
await t1.getByTestId('fv-filter-ALL').waitFor();
await t1.getByTestId('fv-lead-table').waitFor({ timeout: 15000 }).catch(() => {});
const counted = n => t1.getByTestId(`fv-count-${n}`).innerText().then(Number);
await expect((await counted('MINE')) === 1 && (await counted('TO_ACCOUNTS')) === 1 && (await counted('DEPARTMENT')) === 1 && (await counted('ALL')) === 2, 'Overview: the filter numbers are the database numbers (own, department, with Accounts)', { mine: await counted('MINE'), dept: await counted('DEPARTMENT'), acc: await counted('TO_ACCOUNTS') });
await t1.screenshot({ path: `${OUT}/fv-1-overview.png`, fullPage: true });

// Add Lead: the dashboard's own form, source "Field visit"
await fvNav(t1, 'Add Lead');
const dlg = t1.getByRole('dialog');
await dlg.waitFor({ timeout: 10000 });
await expect((await dlg.locator('#lead-source').inputValue()) === 'Field visit', 'Add Lead: the lead source starts as "Field visit" (the lead came from a field visit)');
await dlg.locator('#lead-name').fill('Kavya Field Lead');
await dlg.locator('#lead-company').fill('Kavya Stores');
await dlg.locator('#lead-phone').fill('9811234570');
await dlg.locator('#lead-address').fill('5 Brigade Road, Bengaluru');
await dlg.locator('[aria-label="Interested service"] button').first().click();
await dlg.getByRole('radio', { name: 'Warm' }).click();
await dlg.getByRole('button', { name: 'Add Lead' }).dblclick();
await t1.getByTestId('fv-page-MINE').waitFor({ timeout: 15000 }).catch(() => fail('Add Lead: the My Leads page did not open after saving'));
await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Kavya Field Lead' }).waitFor({ timeout: 15000 }).catch(() => fail('Add Lead: the new lead is not in My Leads'));
const added = await q(`select lead_source, owner_id, lifecycle_stage from customers where name = 'Kavya Field Lead'`);
await expect(added.length === 1 && added[0].lead_source === 'Field visit' && added[0].owner_id === tele.id && added[0].lifecycle_stage === 'LEAD', 'Add Lead: one lead was saved (a double click makes no duplicate), owned by the Telecaller, source Field visit', added);
await fvNav(t1, 'Field Visit Overview');
await t1.getByTestId('fv-count-MINE').waitFor({ timeout: 10000 });
await expect((await counted('MINE')) === 2, 'Add Lead: the counters include the new lead without a manual refresh');
await t1.locator('aside nav button').filter({ hasText: /^\s*Leads\s*$/ }).first().click();
await t1.locator('tbody tr', { hasText: 'Kavya Field Lead' }).first().waitFor({ timeout: 15000 }).catch(() => fail("the lead added from Field Visit is not in the dashboard's own Leads page"));
ok("Add Lead: the same lead shows in the dashboard's own Leads page (one record, no second form)");

// Schedule a visit
await fvNav(t1, 'My Leads');
const row = t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Kavya Field Lead' });
await row.getByTestId('fv-schedule').click();
const sd = t1.getByRole('dialog');
await sd.getByRole('button', { name: 'Schedule visit' }).click();
await expect(/Enter the purpose/.test(await sd.innerText()), 'Schedule: the purpose is required');
await sd.locator('#visit-date').fill(inDays(-1));
await sd.locator('#visit-purpose').fill('Demo at the shop');
await sd.getByRole('button', { name: 'Schedule visit' }).click();
await expect(/cannot be in the past/.test(await sd.innerText()), 'Schedule: a past date is refused');
await sd.locator('#visit-date').fill(todayIST);
await sd.locator('#visit-time').fill('15:30');
await sd.getByRole('button', { name: 'Schedule visit' }).dblclick();
await notice(t1, 'The visit was scheduled.');
await expect((await q(`select count(*)::int n from lead_visits v join customers c on c.id = v.lead_id where c.name = 'Kavya Field Lead'`))[0].n === 1, 'Schedule: a double click makes one visit');
await row.getByText('Scheduled').first().waitFor({ timeout: 15000 }).catch(() => fail('Schedule: the row did not show the visit status'));
ok('Schedule: the row shows Scheduled without a manual refresh');
await fvNav(t1, 'Field Visit Overview');
await t1.getByTestId('fv-filter-VISIT_SCHEDULED').click();
await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Kavya Field Lead' }).waitFor({ timeout: 15000 }).catch(() => fail('Filter Visit Scheduled does not list the lead'));
await expect(await statIs(t1, 'today-s-scheduled-visits', 1), "Overview: Today's Scheduled Visits is 1");
ok('Filters: Visit Scheduled lists the lead');
await t1.getByTestId('fv-filter-VISIT_COMPLETED').click();
await t1.getByText('No visit is completed').waitFor({ timeout: 10000 });
ok('Filters: Visit Completed is empty until a visit is finished (empty state)');

// Start: location refused -> never marked as captured
await fvNav(t1, 'My Field Visits');
const vrow = t1.locator('[data-testid="fv-visit-row"]', { hasText: 'Kavya Field Lead' });
await vrow.getByTestId('fv-start').click();
// this browser refuses the position (a person pressing "Block" in the permission prompt)
await t1.evaluate(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1, message: 'User denied Geolocation' }); });
await t1.getByTestId('visit-start-gps').click();
await t1.getByTestId('visit-gps-denied').waitFor({ timeout: 20000 }).catch(() => fail('Start: a refused location was not explained'));
await expect(/denied|Could not read|not available/i.test(await t1.getByTestId('visit-gps-denied').innerText()), 'Start: a refused location is explained and nothing was started');
await expect((await q(`select v.status from lead_visits v join customers c on c.id = v.lead_id where c.name = 'Kavya Field Lead'`))[0].status === 'SCHEDULED', 'Start: the visit is still Scheduled after the refusal');
await t1.screenshot({ path: `${OUT}/fv-2-gps-denied.png` });
await t1.getByTestId('visit-start-nogps').click();
await notice(t1, 'The visit has started.');
const started = (await q(`select v.status, v.gps_captured, v.checkin_lat from lead_visits v join customers c on c.id = v.lead_id where c.name = 'Kavya Field Lead'`))[0];
await expect(started.status === 'IN_PROGRESS' && started.gps_captured === false && started.checkin_lat === null, 'Start without location: In Progress and NOT marked as GPS captured', started);
await t1.getByTestId('fv-location').filter({ hasText: 'Location not captured' }).first().waitFor({ timeout: 15000 }).catch(() => fail('Start without location: the page does not say "Location not captured"'));
ok('Start without location: the page says "Location not captured"');

// Outcome with a follow-up
await vrow.getByTestId('fv-complete').click();
const od = t1.getByRole('dialog');
await od.getByRole('radio', { name: 'Follow-up Required' }).click();
await od.locator('#visit-outcome').fill('Owner wants a quotation');
await od.getByRole('button', { name: 'Save outcome' }).click();
await expect(/Enter the next follow-up date/.test(await od.innerText()), 'Outcome: a follow-up needs its date');
await od.locator('#visit-requirements').fill('Google Business Profile and ads');
await od.locator('#visit-next-steps').fill('Send the quotation');
await od.locator('#visit-followup').fill(inDays(2));
await od.getByRole('button', { name: 'Save outcome' }).click();
await notice(t1, 'The visit outcome was saved.');
const done = (await q(`select v.status, v.outcome, v.next_follow_up::text d, (c.next_follow_up_at at time zone 'Asia/Kolkata')::date::text lead_d, c.payment_workflow from lead_visits v join customers c on c.id = v.lead_id where c.name = 'Kavya Field Lead'`))[0];
await expect(done.status === 'FOLLOW_UP_REQUIRED' && done.outcome === 'Owner wants a quotation' && done.d === inDays(2) && done.lead_d === inDays(2) && done.payment_workflow === 'NONE', 'Outcome: saved with the follow-up, the lead follow-up date follows, the Accounts workflow is untouched', done);
await fvNav(t1, 'Visit History');
await t1.locator('[data-testid="fv-visit-row"]', { hasText: 'Kavya Field Lead' }).waitFor({ timeout: 15000 }).catch(() => fail('Visit History does not list the finished visit'));
await expect(/Owner wants a quotation/.test(await text(t1)) && /Send the quotation/.test(await text(t1)), 'Visit History: shows the outcome and next steps');
await fvNav(t1, 'Field Visit Overview');
await t1.getByTestId('fv-filter-FOLLOW_UP').click();
await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Kavya Field Lead' }).waitFor({ timeout: 15000 }).catch(() => fail('Filter Follow-up Required does not list the lead'));
ok('Filters: Follow-up Required lists the lead');
// a second visit: the first stays as it was
await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Kavya Field Lead' }).getByTestId('fv-schedule').click();
const sd2 = t1.getByRole('dialog');
await sd2.locator('#visit-date').fill(inDays(2));
await sd2.locator('#visit-purpose').fill('Quotation visit');
await sd2.getByRole('button', { name: 'Schedule visit' }).click();
await notice(t1, 'The visit was scheduled.');
await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Kavya Field Lead' }).getByRole('button', { name: 'History' }).click();
await t1.getByTestId('visit-history-item').first().waitFor({ timeout: 10000 });
await expect((await t1.getByTestId('visit-history-item').count()) === 2 && /Owner wants a quotation/.test(await t1.getByTestId('visit-history-dialog').innerText()), 'History: both visits of the lead are kept, the first unchanged');
await t1.keyboard.press('Escape');
// Filters that open Accounts: untouched
await fvNav(t1, 'To Accounts');
await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Tele Accounts Lead' }).waitFor({ timeout: 15000 }).catch(() => fail('To Accounts does not list the lead that is with Accounts'));
ok('To Accounts: lists the lead that is with Accounts');
await fvNav(t1, 'Returned by Accounts');
await t1.getByText('Accounts has not returned any lead').waitFor({ timeout: 10000 });
ok('Returned by Accounts: empty state');
await fvNav(t1, 'Department Leads');
await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Rahul Lead One' }).waitFor({ timeout: 15000 }).catch(() => fail('Department Leads does not list a colleague\'s lead'));
await expect((await t1.locator('[data-testid="fv-lead-row"]', { hasText: 'Rahul Lead One' }).getByTestId('fv-schedule').count()) === 0, "Department Leads: a colleague's lead is read-only (no Schedule visit)");
await fvNav(t1, 'All Leads');
await t1.getByTestId('fv-page-ALL').waitFor();
await t1.locator('input[aria-label="Search leads"]').fill('rahul');
await expect(!!(await until(async () => (await t1.locator('[data-testid="fv-lead-row"]').count()) === 1)), 'All Leads: search narrows the table');
await t1.screenshot({ path: `${OUT}/fv-3-all-leads.png`, fullPage: true });

// ------------------------------------------------------------------ 2. The Sales Department Head assigns a lead for a visit
const sh = await login('sales.head@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await sh.locator('aside nav button').filter({ hasText: /^\s*Leads\s*$/ }).first().click();
await page(sh, 'Lead List');
await sh.locator('tbody tr', { hasText: 'Rahul Lead One' }).first().waitFor({ timeout: 15000 });
await sh.locator('tbody tr', { hasText: 'Rahul Lead One' }).first().getByTestId('assign-visit').click();
const ad = sh.getByRole('dialog');
await ad.locator('#visit-assignee').waitFor({ timeout: 10000 });
const assigneeOptions = await ad.locator('#visit-assignee option').allInnerTexts();
await expect(assigneeOptions.some(o => /Bina Associate/.test(o) && /Business Associate/.test(o)) && assigneeOptions.some(o => /Fiona Telecaller/.test(o)), 'Assign: Telecallers, Business Associates and Sales members of the department are offered', assigneeOptions);
await expect(!assigneeOptions.some(o => /Mohan|Dina|Tara/.test(o)), 'Assign: nobody from Support is offered');
await ad.locator('#visit-assignee').selectOption(ba.id);
await ad.locator('#visit-priority').selectOption('HIGH');
await ad.locator('#visit-instructions').fill('Collect the GST certificate and meet the owner');
await ad.getByRole('button', { name: 'Assign for visit' }).click();
await sh.getByText(/was assigned to Bina Associate for a field visit/).waitFor({ timeout: 15000 }).catch(() => fail('Assign: no confirmation'));
const asg = (await q(`select a.assigned_to, a.priority, a.status, c.owner_id from lead_visit_assignments a join customers c on c.id = a.lead_id where c.name = 'Rahul Lead One'`))[0];
await expect(asg.assigned_to === ba.id && asg.priority === 'HIGH' && asg.status === 'ACTIVE' && asg.owner_id === rahul, 'Assign: saved for the Business Associate and the lead keeps its owner', asg);
await sh.screenshot({ path: `${OUT}/fv-4-assign.png` });

// ------------------------------------------------------------------ 3. The Business Associate (allowed to share a position)
const b1 = await loginGeo('fv.ba@amuwa.com', 'aside nav button');
await b1.waitForURL(/\/business-associate\/dashboard\//, { timeout: 15000 }).catch(() => fail('the Business Associate did not land on /business-associate/dashboard/…: ' + b1.url()));
labels = await menuLabels(b1);
await expect(['Home', 'Tasks', 'Leads', 'Quotation', 'Demo Schedule', 'Scope of Project', 'Field Visit'].every(l => labels.includes(l)), 'Business Associate: the existing menu is kept and Field Visit is added', labels);
await fvNav(b1, 'Field Visit');
await expect(JSON.stringify(await groupOf(b1)) === JSON.stringify(NAV_ORDER), 'Business Associate: the same ten pages', await groupOf(b1));
await fvNav(b1, 'Department Head Assigned Leads');
const arow = b1.getByTestId('fv-assigned-row').filter({ hasText: 'Rahul Lead One' });
await arow.waitFor({ timeout: 15000 }).catch(() => fail('the assigned lead is not shown to the Business Associate'));
const atext = await arow.innerText();
await expect((await b1.locator('aside nav [aria-current="page"]').count()) === 1 && /Department Head Assigned Leads/.test(await b1.locator('aside nav [aria-current="page"]').innerText()), 'Business Associate: exactly the opened Field Visit page is highlighted in the menu (Home is not)');
await expect(/High priority/.test(atext) && /Sana Sales-Head/.test(atext) && /Collect the GST certificate/.test(atext) && /Rahul Mehta/.test(atext), 'Assigned Leads: priority, assigned by, instructions and the lead owner are shown', atext);
await expect((await b1.getByRole('button', { name: /withdraw|reassign|change assignment/i }).count()) === 0, 'Assigned Leads: the employee has no control to change the assignment');
await b1.screenshot({ path: `${OUT}/fv-5-assigned.png`, fullPage: true });
await fvNav(b1, 'Field Visit Overview');
await expect((await statIs(b1, 'total-assigned-leads', 1)) && (await statIs(b1, 'pending-field-visits', 1)), 'Overview: Total Assigned Leads and Pending Field Visits are 1');
await b1.getByTestId('fv-filter-DH_ASSIGNED').click();
const brow = b1.locator('[data-testid="fv-lead-row"]', { hasText: 'Rahul Lead One' });
await brow.waitFor({ timeout: 15000 });
await expect(/Sana Sales-Head/.test(await brow.innerText()), 'Overview: the table shows who assigned the lead');
await brow.getByTestId('fv-schedule').click();
const bd = b1.getByRole('dialog');
await bd.locator('#visit-date').fill(todayIST);
await bd.locator('#visit-purpose').fill('Collect GST certificate');
await bd.getByRole('button', { name: 'Schedule visit' }).click();
await notice(b1, 'The visit was scheduled.');
await fvNav(b1, 'My Field Visits');
await b1.locator('[data-testid="fv-visit-row"]', { hasText: 'Rahul Lead One' }).getByTestId('fv-start').click();
await b1.getByTestId('visit-start-gps').click();
await notice(b1, 'The visit has started.');
const gps = (await q(`select v.status, v.gps_captured, v.checkin_lat, v.checkin_lng, v.assigned_by from lead_visits v join customers c on c.id = v.lead_id where c.name = 'Rahul Lead One'`))[0];
await expect(gps.status === 'IN_PROGRESS' && gps.gps_captured === true && Math.abs(gps.checkin_lat - 12.9716) < 0.001 && Math.abs(gps.checkin_lng - 77.5946) < 0.001 && gps.assigned_by === head.id, 'Start with location: the position the device gave is recorded, flagged as captured by the device, linked to the Department Head', gps);
await b1.getByTestId('fv-location').filter({ hasText: 'Location captured by the device' }).first().waitFor({ timeout: 15000 }).catch(() => fail('Start with location: the page does not say the location was captured by the device'));
await expect(!/verified/i.test(await text(b1)), 'Start with location: described as captured by the device, never as verified');
await b1.locator('[data-testid="fv-visit-row"]', { hasText: 'Rahul Lead One' }).getByTestId('fv-complete').click();
const bo = b1.getByRole('dialog');
await bo.locator('#visit-outcome').fill('Certificate collected');
await bo.getByRole('button', { name: 'Save outcome' }).click();
await notice(b1, 'The visit outcome was saved.');
const bdone = (await q(`select v.status, c.owner_id, (c.next_follow_up_at is null) no_fu from lead_visits v join customers c on c.id = v.lead_id where c.name = 'Rahul Lead One'`))[0];
await expect(bdone.status === 'COMPLETED' && bdone.owner_id === rahul, 'Outcome: Completed, and the lead still belongs to its owner', bdone);
// Rahul (the lead owner) does not see the visit of the Business Associate as his own
// the Business Associate cannot plan visits for other leads of the department
await expect((await rawStatus(ba.id, 'POST', '/field-visits', { leadId: (await q(`select id from customers where name = 'Tele Accounts Lead'`))[0].id, visitDate: todayIST, purpose: 'x' })) === 404, "permissions: a Business Associate cannot plan a visit for a colleague's lead that was not assigned to them");

// withdraw the assignment
await sh.locator('tbody tr', { hasText: 'Rahul Lead One' }).first().getByTestId('assign-visit').click();
sh.once('dialog', d => d.accept());
await sh.getByRole('button', { name: 'Withdraw assignment' }).click();
await sh.getByText(/assignment of Rahul Lead One was withdrawn/).waitFor({ timeout: 15000 }).catch(() => fail('Withdraw: no confirmation'));
await b1.reload();
await fvNav(b1, 'Department Head Assigned Leads');
await b1.getByText('Nothing assigned to you').waitFor({ timeout: 15000 }).catch(() => fail('Withdraw: the assigned list is not empty after the withdrawal'));
ok('Withdraw: the lead leaves the Business Associate\'s assigned list; their finished visit stays in the history');
await fvNav(b1, 'Visit History');
await b1.locator('[data-testid="fv-visit-row"]', { hasText: 'Rahul Lead One' }).waitFor({ timeout: 15000 }).catch(() => fail('Visit History lost the finished visit'));

// ------------------------------------------------------------------ 4. The Sales Team Member (existing sales dashboard)
const r1 = await login('rahul@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
labels = await menuLabels(r1);
await expect(['Home', 'My Leads', 'Business Associate', 'Field Visit', 'My Customers'].every(l => labels.includes(l)), 'Sales Team Member: the existing menu is kept and Field Visit is added', labels);
await fvNav(r1, 'Field Visit');
await expect(JSON.stringify(await groupOf(r1)) === JSON.stringify(NAV_ORDER), 'Sales Team Member: the same ten pages', await groupOf(r1));
await fvNav(r1, 'Field Visit Overview');
await r1.getByTestId('fv-overview').waitFor({ timeout: 15000 });
await expect(!/telecaller|business-associate/.test(r1.url()), 'Sales Team Member: Field Visit stays in the Sales member dashboard', r1.url());
const rcount = n => r1.getByTestId(`fv-count-${n}`).innerText().then(Number);
await r1.getByTestId('fv-count-MINE').waitFor({ timeout: 10000 });
await expect((await rcount('MINE')) === 1, 'Sales Team Member: My Leads counts only their own lead', await rcount('MINE'));
await fvNav(r1, 'My Field Visits');
await r1.getByText('No visit is planned').waitFor({ timeout: 15000 }).catch(() => fail("a Sales member sees visits that are not theirs"));
ok("Sales Team Member: another person's visits are not shown");
await fvNav(r1, 'Add Lead');
await r1.locator('#lead-name').waitFor({ timeout: 10000 });
await expect((await r1.locator('#lead-leadSource').inputValue().catch(async () => r1.locator('select').filter({ hasText: 'Field visit' }).first().inputValue())) === 'Field visit', 'Sales Team Member: Add Lead is the dashboard\'s own form with the source "Field visit" chosen');
await r1.screenshot({ path: `${OUT}/fv-6-member-add.png`, fullPage: true });

// ------------------------------------------------------------------ 5. Permissions
const consult = await idOf('tm.delivery@amuwa.com');
const teamLead = await idOf('lead@amuwa.com');
await expect((await rawStatus(consult, 'GET', '/field-visits/overview')) === 403 && (await rawStatus(teamLead, 'GET', '/field-visits/overview')) === 403, 'permissions: a Support member and a Team Lead have no Field Visit (the API refuses them)');
await expect((await rawStatus(tele.id, 'POST', '/field-visits/assignments', { leadId: rahulLead, assigneeId: ba.id, priority: 'LOW' })) === 403, 'permissions: an employee cannot assign visits');
const sup = await login('tm.delivery@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await expect(!(await menuLabels(sup)).includes('Field Visit'), "permissions: a Support member's menu has no Field Visit");
const tl = await login('lead@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await expect(!(await menuLabels(tl)).includes('Field Visit'), "permissions: a Team Lead's menu has no Field Visit");
const dhp = await login('dh@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await expect(!(await menuLabels(dhp)).includes('Field Visit'), "permissions: the Department Head's dashboard is unchanged (no Field Visit)");

// ------------------------------------------------------------------ 6. Phone and tablet
for (const [name, size] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
  const ph = await login('fv.tele@amuwa.com', size, 'main');
  await ph.goto(BASE + `/telecaller/dashboard/${tele.id}/field-visit`);
  await ph.getByTestId('fv-overview').waitFor({ timeout: 20000 });
  await ph.getByTestId('fv-lead-table').waitFor({ timeout: 15000 }).catch(() => {});
  await expect(await noSideways(ph), `${name}: Field Visit Overview has no sideways page scrolling`);
  await ph.goto(BASE + `/telecaller/dashboard/${tele.id}/field-visit-my-visits`);
  await ph.getByTestId('fv-my-visits').waitFor({ timeout: 20000 });
  await expect(await noSideways(ph), `${name}: My Field Visits has no sideways page scrolling`);
  if (name === 'phone') await ph.screenshot({ path: `${OUT}/fv-7-phone.png`, fullPage: true });
}

await expect(errors.length === 0, 'no page error or console error in any browser', errors.slice(0, 5));
await browser.close();
console.log(`=== ${step} FIELD VISIT BROWSER CHECKS PASSED ===`);
process.exit(0);
