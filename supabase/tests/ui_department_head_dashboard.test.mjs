// Browser test of the Department Head dashboard pages (migration 20270125000100): the Overview statistics, Team Attendance, Leads (and Add lead), Customers
// (and the customer panel) and Invoices (and the invoice detail), at desktop and phone width. The database is answered in the page by a stand-in that applies the
// filters, search and paging; the test also checks what is SENT: never a department, a role or a user id (the database works those out).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Department Head dashboard browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/department_head_stubs.ts');
const authStub = path.resolve('supabase/tests/ui/department_head_auth_stub.tsx');
const notifStub = path.resolve('supabase/tests/ui/department_head_notifications_stub.tsx');
const built = await build({
  entryPoints: ['supabase/tests/ui/department_head_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: authStub })); b.onResolve({ filter: /context\/NotificationContext$/ }, () => ({ path: notifStub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
const lastCall = (page, fn) => page.evaluate(f => [...window.__calls].reverse().find(c => c.fn === f)?.args, fn);
const callsOf = (page, fn) => page.evaluate(f => window.__calls.filter(c => c.fn === f).map(c => c.args), fn);
const SENT_OK = /^p_(date|status|search|limit|offset|source|from|to|customer)$/;
const seed = (page, fn) => page.evaluate(fn);
const iso = (h, m) => { const d = new Date(); d.setUTCHours(h, m, 0, 0); return d.toISOString(); };
const DATA = () => {
  const s = window.__state;
  const today = s.today;
  const row = (id, name, designation, status, extra = {}) => ({ profileId: id, name, role: 'TEAM_MEMBER', designation, team: 'Sales A', date: today, status, punchIn: null, punchOut: null, workedMinutes: null, leave: null, ...extra });
  s.attendance = [
    row('a1', 'Mia Member', 'Support Executive', 'PRESENT', { punchIn: (() => { const d = new Date(); d.setUTCHours(4, 15, 0, 0); return d.toISOString(); })(), workedMinutes: 190 }),
    row('a2', 'Ravi Kumar', 'Sales Associate', 'PRESENT', { punchIn: (() => { const d = new Date(); d.setUTCHours(3, 30, 0, 0); return d.toISOString(); })(), punchOut: (() => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); return d.toISOString(); })(), workedMinutes: 510 }),
    row('a3', 'Nina Shah', 'Senior Executive', 'ABSENT'),
    row('a4', 'Omar Khan', 'Telecaller', 'ON_LEAVE', { leave: { id: 'l1', type: 'FULL_DAY', halfDayShift: null } }),
    ...Array.from({ length: 21 }, (_, i) => row(`f${i}`, `Filler ${String(i + 1).padStart(2, '0')}`, 'Executive', 'PRESENT', { punchIn: new Date().toISOString(), workedMinutes: 60 }))
  ];
  s.owners = [
    { id: '00000000-0000-4000-8000-0000000000d1', name: 'Dev Head', team: null, role: 'Myself', designation: 'Department Head' },
    { id: '00000000-0000-4000-8000-0000000000a1', name: 'Tara Lead', team: 'Sales A', role: 'Team Lead', designation: 'Team Lead' },
    { id: '00000000-0000-4000-8000-0000000000b1', name: 'Tom Member', team: 'Sales A', role: 'Team Member', designation: null }
  ];
  const lead = (id, name, company, state, source, extra = {}) => ({ id, code: `CUS-${id}`, name, company, phone: '9000000001', email: null, city: null, state, stage: 'LEAD', leadStatus: 'NEW', source, nextFollowUpAt: null, expectedBudget: null, owner: { id: 'tl1', name: 'Tara Lead' }, services: [{ code: 'AI_CALLING', name: 'AI Calling' }], createdAt: '2026-11-10T10:00:00Z', ...extra });
  s.leads = [lead('1', 'Aarav Shah', 'Aarav Stores', 'NEW', 'Walk-in'), lead('2', 'Bina Rao', 'Blue Bakery', 'IN_PROGRESS', 'Referral'), lead('3', 'Chet Nair', 'Cedar Cafe', 'CONVERTED', null)];
  const cust = (id, name, company, status, extra = {}) => ({ id, code: `CUS-${id}`, name, company, phone: '9100000001', email: `${id}@example.com`, city: 'Pune', status, lifecycleStage: 'CUSTOMER', department: 'Wabastore Sales',
    relationshipManager: { id: 'rm', name: 'Rina Manager' }, services: [{ code: 'AI_CALLING', name: 'AI Calling' }, { code: 'META_ADS', name: 'Meta Ads' }], pendingInvoices: 0, createdAt: '2026-10-05T10:00:00Z', ...extra });
  s.customers = [cust('c1', 'Alpha One', 'Alpha Traders', 'ACTIVE', { pendingInvoices: 1 }), cust('c2', 'Alpha Two', 'Alpha Foods', 'INACTIVE'), cust('c3', 'Gamma Three', 'Gamma Works', 'ACTIVE')];
  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
  s.invoices = [
    { id: 'i1', number: 'INV-1', kind: 'UPLOADED', customerId: 'c1', customer: 'Alpha Traders', contact: 'Alpha One', amount: 1000, status: 'Paid', overdue: false, issueDate: d(-30), dueDate: d(-20), paidAt: null, paidAmount: 1000, outstanding: 0, services: ['WhatsApp API'], hasDocument: true },
    { id: 'i2', number: 'INV-2', kind: 'UPLOADED', customerId: 'c1', customer: 'Alpha Traders', contact: 'Alpha One', amount: 2000, status: 'Pending', overdue: true, issueDate: d(-10), dueDate: d(-2), paidAt: null, paidAmount: 0, outstanding: 2000, services: ['AI Calling'], hasDocument: true },
    { id: 'i3', number: 'INV-3', kind: 'GENERATED', customerId: 'c2', customer: 'Alpha Foods', contact: 'Alpha Two', amount: 4000, status: 'Pending', overdue: false, issueDate: d(-1), dueDate: d(20), paidAt: null, paidAmount: 0, outstanding: 4000, services: ['Meta Ads', 'Extra'], hasDocument: true }
  ];
};
try {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const open = async (name, props) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(base);
    await p.evaluate(DATA);
    return p;
  };

  // ================= Overview statistics
  let page = await open();
  await page.evaluate(() => window.mount('stats'));
  await page.getByTestId('dept-stats').waitFor();
  check(await page.getByText('Wabastore Sales').isVisible() && await page.getByTestId('ov-employees').innerText() === '25' && await page.getByTestId('ov-present').innerText() === '23'
        && await page.getByTestId('ov-absent').innerText() === '1' && await page.getByTestId('ov-leave').innerText() === '1', 'the Overview shows the department name, employees, present, absent and on leave today');
  check(await page.getByTestId('ov-rate').innerText() === '95.8%', 'the attendance percentage is present out of those not on leave (23 of 24)');
  check(await page.getByTestId('ov-customers').innerText() === '3' && await page.getByTestId('ov-leads').innerText() === '3' && await page.getByTestId('ov-invoices').innerText() === '3', 'customers, leads and invoices are counted');
  await page.getByRole('button', { name: /Open Team Attendance/ }).click();
  check(await page.evaluate(() => window.__went) === 'team-attendance', 'the attendance card leads to Team Attendance');
  await page.getByRole('button', { name: 'View' }).nth(1).click();
  check(await page.evaluate(() => window.__went) === 'leads', 'and the leads card to Leads');
  await page.close();
  page = await open();
  await page.evaluate(() => { window.__state.fail.head_dashboard_overview = 'FORBIDDEN: Only a Department Head can see this.'; window.mount('stats'); });
  await page.getByText(/Department statistics are not available/).waitFor();
  check(await page.getByRole('button', { name: 'Try again' }).isVisible(), 'when the statistics cannot be loaded the Overview says so and offers Try again (the rest of the Overview is not blocked)');
  await page.close();

  // ================= Team Attendance
  page = await open();
  await page.evaluate(() => { window.__state.delay = 400; window.mount('attendance'); });
  check(await page.getByText('Loading attendance…').isVisible(), 'a loading state is shown while the register loads');
  await page.getByTestId('attendance-rows').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="attendance-rows"] tr').length > 1);
  await page.evaluate(() => { window.__state.delay = 0; });
  check(await page.getByTestId('att-employees').innerText() === '25' && await page.getByTestId('att-present').innerText() === '23' && await page.getByTestId('att-absent').innerText() === '1' && await page.getByTestId('att-leave').innerText() === '1' && await page.getByTestId('att-rate').innerText() === '95.8%',
    'the summary cards: employees, present, absent, on leave and the attendance rate');
  const rowOf = name => page.getByTestId('attendance-rows').locator('tr', { hasText: name });
  check(await rowOf('Mia Member').getByText('Present').isVisible() && /9:45\s?am/i.test(await rowOf('Mia Member').innerText()) && await rowOf('Mia Member').getByText('Working').isVisible() && await rowOf('Mia Member').getByText('Support Executive').isVisible(),
    'a row shows the name, designation, status, the punch-in time and "Working" while there is no punch-out');
  check(/9:00\s?am/i.test(await rowOf('Ravi Kumar').innerText()) && /5:30\s?pm/i.test(await rowOf('Ravi Kumar').innerText()) && /8h 30m/.test(await rowOf('Ravi Kumar').innerText()), 'punch-in, punch-out and the time worked are shown');
  check(await rowOf('Nina Shah').getByText('Absent').isVisible() && await rowOf('Omar Khan').getByText('On leave').isVisible() && await rowOf('Omar Khan').getByText('Full day').isVisible(), 'absent and on-leave employees are told apart, with the leave type');
  check(await page.getByTestId('attendance-rows').locator('tr').count() === 20 && await page.getByText(/Showing 1–20 of 25 employees/).isVisible(), 'the register is paged (20 of 25)');
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="attendance-rows"] tr').length === 5);
  check((await lastCall(page, 'head_attendance_list')).p_offset === 20, 'the next page asks for the next 20');
  await page.getByRole('tab', { name: /^Absent/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="attendance-rows"] tr').length === 1);
  check(await rowOf('Nina Shah').isVisible() && (await lastCall(page, 'head_attendance_list')).p_status === 'ABSENT' && (await lastCall(page, 'head_attendance_list')).p_offset === 0, 'the Absent filter lists absent people and goes back to the first page');
  await page.getByRole('tab', { name: /^On leave/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="attendance-rows"] tr').length === 1 && document.body.innerText.includes('Omar Khan'));
  await page.getByRole('tab', { name: /^Present/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="attendance-rows"] tr').length === 20);
  check((await lastCall(page, 'head_attendance_list')).p_status === 'PRESENT', 'the Present filter');
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByPlaceholder('Search name or designation').fill('telecaller');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="attendance-rows"] tr').length === 1 && document.body.innerText.includes('Omar Khan'));
  check((await lastCall(page, 'head_attendance_list')).p_search === 'telecaller', 'search finds an employee by designation');
  await page.getByPlaceholder('Search name or designation').fill('nobody here');
  await page.getByText('No employees match').waitFor();
  check(true, 'no match: an empty state');
  await page.getByPlaceholder('Search name or designation').fill('');
  // a past date
  const past = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toLocaleDateString('en-CA'); });
  await page.getByLabel('Attendance date').fill(past);
  await page.waitForFunction(d => window.__calls.some(c => c.fn === 'head_attendance_list' && c.args.p_date === d), past);
  check(await page.getByRole('button', { name: 'Today' }).isEnabled() && (await page.getByLabel('Attendance date').getAttribute('max')) === await page.evaluate(() => window.__state.today), 'a past date is requested; the date picker stops at today');
  await page.getByRole('button', { name: 'Today' }).click();
  await page.waitForFunction(() => { const c = window.__calls.filter(x => x.fn === 'head_attendance_list'); return c[c.length - 1].args.p_date === null; });
  check(true, 'Today returns to today');
  await page.evaluate(() => { window.__state.fail.head_attendance_list = 'FORBIDDEN: Only a Department Head can see this.'; });
  await page.getByRole('tab', { name: /^Absent/ }).click();
  await page.getByRole('alert').getByText(/Only a Department Head/).waitFor();
  await page.evaluate(() => { window.__state.fail = {}; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  check(true, 'a refusal is shown with Try again, and recovers');
  for (const c of await callsOf(page, 'head_attendance_list')) check(Object.keys(c).every(k => SENT_OK.test(k)), 'attendance requests carry only date, status, search and paging', c);
  await page.close();

  // ================= Leads
  page = await open();
  await page.evaluate(() => window.mount('leads'));
  await page.getByTestId('lead-rows').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lead-row"]').length === 3);
  check(await page.getByTestId('lead-total').innerText() === '3' && await page.getByTestId('lead-new').innerText() === '1' && await page.getByTestId('lead-progress').innerText() === '1' && await page.getByTestId('lead-converted').innerText() === '1' && await page.getByTestId('lead-lost').innerText() === '0',
    'lead summary: total, new, in progress, converted and lost');
  check(await page.getByTestId('lead-rows').getByText('Aarav Stores').isVisible() && await page.getByTestId('lead-rows').getByText('Walk-in').isVisible() && await page.getByTestId('lead-rows').getByText('Not recorded').isVisible(), 'rows show the lead, its source (or "Not recorded"), owner and status');
  await page.getByRole('tab', { name: /^In progress/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lead-row"]').length === 1);
  check(await page.getByText('Blue Bakery').isVisible(), 'the status filter');
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByLabel('Lead source').selectOption('Referral');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lead-row"]').length === 1);
  check((await lastCall(page, 'head_lead_list')).p_source === 'Referral', 'the source filter');
  await page.getByLabel('Lead source').selectOption('');
  await page.getByPlaceholder('Search name, company or phone').fill('cedar');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lead-row"]').length === 1 && document.body.innerText.includes('Cedar Cafe'));
  check(true, 'search by company');
  await page.getByPlaceholder('Search name, company or phone').fill('zzz');
  await page.getByText('No leads match').waitFor();
  check(true, 'no match: an empty state');
  await page.getByPlaceholder('Search name, company or phone').fill('');
  // Add lead: the CRM's own form with a Lead owner choice
  await page.getByTestId('add-lead').click();
  await page.getByRole('heading', { name: 'Lead owner' }).waitFor();
  const opts = await page.getByLabel('Assign this lead to').locator('option').allInnerTexts();
  check(opts.length === 3 && /Myself/.test(opts[0]) && /Tara Lead · Team Lead · Sales A/.test(opts[1]) && /Tom Member/.test(opts[2]), 'Add lead opens the existing lead form with a "Lead owner" choice: the head first, then the people the database offered', opts);
  check(await page.getByLabel('Customer Name *').isVisible() && await page.getByLabel('Business name *').isVisible() && await page.getByLabel('Mobile number *').isVisible(), 'and every field of the existing lead form');
  await page.getByLabel('Assign this lead to').selectOption('00000000-0000-4000-8000-0000000000a1');
  await page.getByLabel('Customer Name *').fill('Dhruv Mehta');
  await page.getByLabel('Business name *').fill('Dhruv Traders');
  await page.getByLabel('Mobile number *').fill('9876501234');
  await page.getByRole('checkbox', { name: /AI Calling/ }).first().click();
  const src = page.locator('#lead-leadSource');
  await src.click();
  await page.getByRole('option', { name: 'Referral' }).first().click().catch(async () => { await src.fill('Referral'); });
  await page.getByLabel('Subscription plan *').fill('Growth');
  await page.getByLabel('Subscription duration *').selectOption({ index: 1 });
  await page.getByLabel('Subscription amount (₹) *').fill('12000');
  await page.getByRole('button', { name: 'Save lead' }).click();
  await page.getByText('Lead added to your department.').waitFor();
  const made = await page.evaluate(() => window.__created[0]);
  check(made && made.ownerId === '00000000-0000-4000-8000-0000000000a1' && made.name === 'Dhruv Mehta' && made.services.join() === 'AI_CALLING' && !('departmentId' in made) && !('department' in made) && !('role' in made), 'the lead is created through the existing endpoint with the chosen owner and no department, role or user id', made);
  check(await page.getByTestId('lead-total').isVisible(), 'and the page returns to the list');
  await page.close();

  // ================= My Leads > Add lead (the Sales Department Head's own pipeline): a Department Head has no team, so the form asks who owns the lead,
  // with Myself chosen first; the request carries the owner (it once carried none and the server answered "Choose a lead owner who belongs to a team")
  page = await open();
  await page.evaluate(() => { window.__profile = { id: '00000000-0000-4000-8000-0000000000d1', role: 'DEPARTMENT_HEAD', fullName: 'Dev Head', teamId: null }; window.mountMyLeadsAdd(); });
  await page.getByRole('heading', { name: 'Lead owner' }).waitFor();
  const myOpts = await page.getByLabel('Assign this lead to').locator('option').allInnerTexts();
  check(/Myself \(Department Head\)/.test(myOpts[0]) && myOpts.length === 3 && await page.getByLabel('Assign this lead to').inputValue() === '00000000-0000-4000-8000-0000000000d1',
    'My Leads: a Department Head\'s Add lead offers Myself (chosen) and their Team Leads / Team Members', myOpts);
  await page.getByLabel('Customer Name *').fill('Pooja');
  await page.getByLabel('Business name *').fill('Pops Studio');
  await page.getByLabel('Mobile number *').fill('7208285641');
  await page.getByRole('checkbox', { name: /AI Calling/ }).first().click();
  const mySrc = page.locator('#lead-leadSource');
  await mySrc.click();
  await page.getByRole('option', { name: 'Referral' }).first().click().catch(async () => { await mySrc.fill('Referral'); });
  await page.getByLabel('Subscription plan *').fill('Growth');
  await page.getByLabel('Subscription duration *').selectOption({ index: 1 });
  await page.getByLabel('Subscription amount (₹) *').fill('12000');
  const createdBefore = await page.evaluate(() => window.__created.length);
  await page.getByRole('button', { name: 'Save lead' }).click();
  await page.waitForFunction(n => window.__created.length > n, createdBefore);
  const sentMine = await page.evaluate(() => window.__created[window.__created.length - 1]);
  check(sentMine.ownerId === '00000000-0000-4000-8000-0000000000d1', 'My Leads: the lead is sent with the Department Head as its owner', sentMine);
  await page.close();
  page = await open();
  await page.evaluate(() => { window.__profile = { id: 'tl-1', role: 'TEAM_HEAD', fullName: 'Tara Lead', teamId: 't1' }; window.mountMyLeadsAdd(); });
  await page.getByLabel('Customer Name *').waitFor();
  check(await page.getByRole('heading', { name: 'Lead owner' }).count() === 0, 'My Leads: a Team Lead\'s Add lead is unchanged (they own what they add)');
  await page.close();

  // ================= Add lead: the same form as the Team Lead's, a refreshed list and statistics, and one lead per submit
  page = await open();
  await page.evaluate(() => window.mountTlForm());
  await page.getByLabel('Customer Name *').waitFor();
  const labelsOf = () => page.evaluate(() => [...document.querySelectorAll('label')].map(l => (l.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).sort());
  const tlLabels = await labelsOf();
  check(tlLabels.length > 12 && tlLabels.includes('Customer Name *') && tlLabels.includes('Mobile number *') && tlLabels.includes('Lead source *'), 'the Team Lead\'s lead form (reference) has its fields', tlLabels.length);
  await page.close();
  page = await open();
  await page.evaluate(() => window.mount('leads'));
  await page.getByTestId('add-lead').waitFor();
  check(await page.getByTestId('add-lead').isVisible(), 'the Add lead button is on the Leads page, next to the lead statistics');
  await page.getByTestId('add-lead').click();
  await page.getByLabel('Customer Name *').waitFor();
  const dhLabels = await labelsOf();
  const extra = dhLabels.filter(l => !tlLabels.includes(l));
  const missing = tlLabels.filter(l => !dhLabels.includes(l));
  check(missing.length === 0 && extra.length === 1 && /Assign this lead to/.test(extra[0]), 'the Department Head\'s form has every field of the Team Lead\'s form, plus only the lead owner choice', { missing, extra });
  // validation is the Team Lead's validation
  await page.getByRole('button', { name: 'Save lead' }).click();
  await page.getByText('Please fix the highlighted fields.').waitFor();
  check(await page.getByText('Customer name is required.').isVisible() && await page.evaluate(() => window.__created.length) === 0, 'saving an empty form shows the same validation and sends nothing');
  const before = await page.evaluate(() => window.__state.leads.length);
  await page.getByLabel('Assign this lead to').selectOption('00000000-0000-4000-8000-0000000000a1');
  await page.getByLabel('Customer Name *').fill('Esha Kapoor');
  await page.getByLabel('Business name *').fill('Esha Boutique');
  await page.getByLabel('Mobile number *').fill('9812345678');
  await page.getByRole('checkbox', { name: /AI Calling/ }).first().click();
  const src2 = page.locator('#lead-leadSource');
  await src2.click();
  await page.getByRole('option', { name: 'Referral' }).first().click();
  await page.getByLabel('Subscription plan *').fill('Growth');
  await page.getByLabel('Subscription duration *').selectOption({ index: 1 });
  await page.getByLabel('Subscription amount (₹) *').fill('12000');
  // a double click on Save: one lead
  await page.getByRole('button', { name: 'Save lead' }).dblclick();
  await page.getByText('Lead added to your department.').waitFor();
  const sent = await page.evaluate(() => window.__created);
  check(sent.length >= 1 && new Set(sent.map(b => b.clientRequestId)).size === 1 && sent[0].clientRequestId, 'a double click sends the same request id every time (the server makes one lead for it)', sent.length);
  check(await page.evaluate(() => window.__state.leads.length) === before + 1, 'and exactly one lead was created');
  check(await page.getByTestId('lead-rows').getByText('Esha Boutique').isVisible(), 'the new lead is in the list at once, without a reload');
  check(await page.getByTestId('lead-total').innerText() === String(before + 1) && await page.getByTestId('lead-new').innerText() === '2', 'the lead statistics went up (total and new)');
  check(await page.getByTestId('add-lead').isVisible() && await page.getByRole('dialog').count() === 0, 'the form closed and the page is back on the list');
  check(await page.evaluate(() => { const b = window.__created[0]; return !('departmentId' in b) && !('department' in b) && !('role' in b) && b.ownerId === '00000000-0000-4000-8000-0000000000a1'; }), 'the request carries the chosen owner and no department or role');
  await page.close();
  // an error from the server (here: an owner outside the head's department) is shown, the form stays open and a retry works
  page = await open();
  await page.evaluate(() => window.mount('leads'));
  await page.getByTestId('add-lead').click();
  await page.getByLabel('Customer Name *').waitFor();
  await page.getByLabel('Customer Name *').fill('Farah Ali');
  await page.getByLabel('Business name *').fill('Farah Studio');
  await page.getByLabel('Mobile number *').fill('9823456789');
  await page.getByRole('checkbox', { name: /AI Calling/ }).first().click();
  await page.locator('#lead-leadSource').click();
  await page.getByRole('option', { name: 'Walk-in' }).first().click();
  await page.getByLabel('Subscription plan *').fill('Growth');
  await page.getByLabel('Subscription duration *').selectOption({ index: 1 });
  await page.getByLabel('Subscription amount (₹) *').fill('9000');
  await page.evaluate(() => { window.__failCreate = 'FORBIDDEN: You cannot assign customers to this user.'; });
  await page.getByRole('button', { name: 'Save lead' }).click();
  await page.getByText(/cannot assign customers to this user/).waitFor();
  check(await page.getByLabel('Customer Name *').inputValue() === 'Farah Ali' && await page.evaluate(() => window.__created.length) === 0 && await page.getByText('Lead added to your department.').count() === 0,
    'a refusal from the server is shown, the form keeps what was typed and no lead was made');
  await page.getByRole('button', { name: 'Save lead' }).click();
  await page.getByText('Lead added to your department.').waitFor();
  check(await page.getByTestId('lead-rows').getByText('Farah Studio').isVisible(), 'and Save again then works');
  await page.close();
  // phone
  const pm = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  page = await pm.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(DATA);
  await page.evaluate(() => window.mount('leads'));
  await page.getByTestId('lead-rows').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'the Leads page fits a phone (the table scrolls inside its card)');
  await page.evaluate(() => window.mount('attendance'));
  await page.getByTestId('attendance-rows').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'so does Team Attendance');
  await page.evaluate(() => window.mount('customers'));
  await page.getByTestId('customer-rows').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Customers');
  await page.evaluate(() => window.mount('invoices'));
  await page.getByTestId('invoice-rows').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'and Invoices');
  await pm.close();

  // ================= Customers
  page = await open();
  await page.evaluate(() => window.mount('customers'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="customer-row"]').length === 3);
  check(await page.getByTestId('cust-total').innerText() === '3' && await page.getByTestId('cust-active').innerText() === '2' && await page.getByTestId('cust-inactive').innerText() === '1' && await page.getByTestId('cust-new').innerText() === '2' && await page.getByTestId('cust-pending').innerText() === '1',
    'customer summary: total, active, new, inactive, with pending invoices');
  check(await page.getByTestId('customer-rows').getByText('Alpha Traders').isVisible() && await page.getByTestId('customer-rows').getByText('Rina Manager').first().isVisible() && await page.getByTestId('customer-rows').getByText('AI Calling +1').first().isVisible(),
    'rows show the customer, relationship manager, services, status and creation date');
  await page.getByPlaceholder('Search customer name or company').fill('foods');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="customer-row"]').length === 1);
  check(await page.getByText('Alpha Foods').first().isVisible(), 'search by company');
  await page.getByPlaceholder('Search customer name or company').fill('');
  await page.getByRole('tab', { name: /^Inactive/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="customer-row"]').length === 1);
  check((await lastCall(page, 'head_customer_list')).p_status === 'INACTIVE', 'the status filter');
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="customer-row"]').length === 3);
  await page.getByRole('button', { name: 'Open customer Alpha Traders' }).click();
  const cp = page.getByTestId('customer-panel');
  await cp.waitFor();
  check(await cp.getByText('Rina Manager').isVisible() && await cp.getByText('Tara Lead').isVisible() && await cp.getByText('AI Calling').first().isVisible() && await cp.getByText('Meta Ads').first().isVisible() && await cp.getByText('Referral').isVisible(),
    'the customer panel shows the relationship manager, team, services purchased and where the customer came from');
  check(await cp.getByText('Template rejected').isVisible(), 'and the customer\'s support tickets');
  check(await cp.getByText('₹3,000').first().isVisible() && await cp.getByText('₹2,000').first().isVisible(), 'the invoice and payment summary: invoiced, paid and outstanding');
  await cp.getByRole('button', { name: 'Open invoice INV-2' }).click();
  await page.getByRole('heading', { name: /Invoice INV-2/ }).waitFor();
  check(await page.getByRole('button', { name: /Mark as paid|Confirm payment|Cancel invoice|Replace/i }).count() === 0, 'an invoice opens in the existing read-only detail, with no payment or accounting action');
  await page.getByRole('dialog', { name: /Invoice INV-2/ }).getByRole('button', { name: /close/i }).first().click();
  check(await page.getByRole('button', { name: 'Open full customer record' }).isVisible(), 'the existing customer record can be opened from the panel');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /Hand-overs/ }).click();
  await page.waitForFunction(() => window.__calls.some(c => c.fn === 'head_customer_directory'));
  check(true, 'the previous Customers page (hand-overs and tickets) is still there, unchanged');
  for (const c of [...await callsOf(page, 'head_customer_list'), ...await callsOf(page, 'head_customer_detail')]) check(Object.keys(c).every(k => SENT_OK.test(k)), 'customer requests carry only search, status, paging and the customer id', c);
  await page.close();

  // ================= Invoices
  page = await open();
  await page.evaluate(() => window.mount('invoices'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 3);
  check(await page.getByTestId('inv-count').innerText() === '3' && await page.getByTestId('inv-paid').innerText() === '1' && await page.getByTestId('inv-pending').innerText() === '2' && await page.getByTestId('inv-overdue').innerText() === '1', 'invoice summary: total, paid, pending and overdue');
  const inv = name => page.getByTestId('invoice-rows').locator('tr', { hasText: name });
  check(await inv('INV-1').getByText('Paid').isVisible() && await inv('INV-2').getByText('Overdue').isVisible() && await inv('INV-3').getByText('Pending').isVisible(), 'each invoice shows Paid, Pending or Overdue');
  check(/₹2,000/.test(await inv('INV-2').innerText()) && /AI Calling/.test(await inv('INV-2').innerText()) && /Alpha Traders/.test(await inv('INV-2').innerText()), 'a row shows the customer, service, amount, paid and outstanding amounts');
  await page.getByRole('tab', { name: /^Paid/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 1);
  await page.getByRole('tab', { name: /^Overdue/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 1 && document.body.innerText.includes('INV-2'));
  check((await lastCall(page, 'head_invoice_list')).p_status === 'OVERDUE', 'the Paid and Overdue filters');
  await page.getByRole('tab', { name: /^Pending/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 2);
  await page.getByRole('tab', { name: /^All invoices/ }).click();
  await page.getByPlaceholder('Search invoice number or customer').fill('foods');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 1 && document.body.innerText.includes('INV-3'));
  check(true, 'search by customer');
  await page.getByPlaceholder('Search invoice number or customer').fill('');
  const range = await page.evaluate(() => { const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); }; return { from: d(-12), to: d(0) }; });
  await page.getByLabel('Invoice date from').fill(range.from);
  await page.getByLabel('Invoice date to').fill(range.to);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 2);
  const rc = await lastCall(page, 'head_invoice_list');
  check(rc.p_from === range.from && rc.p_to === range.to, 'the date range', rc);
  await page.getByLabel('Invoice date to').fill(range.from.slice(0, 8) + '01');
  await page.getByText('The end date is before the start date.').waitFor();
  check(true, 'an end date before the start date is refused in the page');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 3);
  await page.getByRole('button', { name: 'Open invoice INV-2' }).click();
  await page.getByRole('heading', { name: /Invoice INV-2/ }).waitFor();
  check(await page.getByText('Alpha Traders').first().isVisible() && await page.getByRole('button', { name: /Mark as paid|Confirm payment|Cancel invoice|Replace/i }).count() === 0, 'opening an invoice shows its details and offers no accounting action');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__state.invoices = []; });
  await page.getByPlaceholder('Search invoice number or customer').fill('x');
  await page.getByText('No invoices match').waitFor();
  check(true, 'no match: an empty state');
  for (const c of await callsOf(page, 'head_invoice_list')) check(Object.keys(c).every(k => SENT_OK.test(k)), 'invoice requests carry only search, status, dates and paging', c);
  await page.close();


  // ================= The real dashboard: the new pages are reachable, and only for the heads they are for
  const dash = async profile => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(base);
    await p.evaluate(DATA);
    await p.evaluate(pr => { window.__profile = pr; localStorage.clear(); window.mountDashboard(); }, profile);
    await p.getByRole('navigation').first().waitFor();
    return p;
  };
  const base_ = { role: 'DEPARTMENT_HEAD', department: { slug: 'wabastore', name: 'Wabastore' }, departmentId: 'd1', headDivision: 'SALES', isOperationsHead: false };
  page = await dash(base_);
  const nav = () => page.getByRole('navigation');
  check(await nav().getByRole('button', { name: 'Leads', exact: true }).isVisible() && await nav().getByRole('button', { name: 'Customers', exact: true }).isVisible() && await nav().getByRole('button', { name: 'Invoices', exact: true }).isVisible() && await nav().getByRole('button', { name: 'Team Attendance', exact: true }).isVisible(),
    'a Sales Department Head\'s navigation has Leads, Customers, Invoices and Team Attendance');
  check(await nav().getByRole('button', { name: 'Assign Task', exact: true }).isVisible() && await nav().getByRole('button', { name: 'Work Updates', exact: true }).isVisible() && await nav().getByRole('button', { name: 'Team Members & Access', exact: true }).isVisible(),
    'the existing pages are still in the navigation');
  await page.getByTestId('dept-stats').waitFor();
  check(await page.getByTestId('ov-employees').isVisible(), 'the Overview now starts with the department statistics');
  await nav().getByRole('button', { name: 'Team Attendance', exact: true }).click();
  await page.getByRole('heading', { name: 'Team Attendance' }).waitFor();
  await nav().getByRole('button', { name: 'Leads', exact: true }).click();
  await page.getByRole('heading', { name: 'Leads', exact: true }).waitFor();
  await nav().getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('heading', { name: 'Customers', exact: true }).waitFor();
  await nav().getByRole('button', { name: 'Invoices', exact: true }).click();
  await page.getByRole('heading', { name: 'Invoices', exact: true }).waitFor();
  check(true, 'each new page opens from the navigation');
  await page.close();
  page = await dash({ ...base_, headDivision: 'SUPPORT' });
  check(await nav().getByRole('button', { name: 'Leads', exact: true }).isVisible() && await nav().getByRole('button', { name: 'Invoices', exact: true }).isVisible() && await nav().getByRole('button', { name: 'Team Attendance', exact: true }).isVisible(), 'a Support-side head has Leads (with Add lead), Invoices and Team Attendance too');
  await page.close();
  page = await dash({ ...base_, department: { slug: 'accounts', name: 'Accounts' }, headDivision: null });
  check(await nav().getByRole('button', { name: 'Leads', exact: true }).count() === 0 && await nav().getByRole('button', { name: 'Invoices', exact: true }).count() === 0, 'the Accounts head\'s navigation is unchanged apart from Team Attendance: no Leads and no Invoices page (they have their own)');
  await page.close();

  // the Overview's "Add lead" opens the same form
  page = await dash(base_);
  await page.getByTestId('dept-stats').waitFor();
  await page.getByRole('button', { name: 'Add lead' }).click();
  await page.getByRole('heading', { name: 'Lead owner' }).waitFor();
  check(await page.getByLabel('Customer Name *').isVisible(), 'the Overview\'s Add lead opens the lead form on the Leads page');
  await nav().getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('heading', { name: 'Customers', exact: true }).waitFor();
  await nav().getByRole('button', { name: 'Leads', exact: true }).click();
  await page.getByTestId('add-lead').waitFor();
  check(await page.getByRole('heading', { name: 'Lead owner' }).count() === 0, 'and coming back to Leads later starts on the list, not on the form');
  await page.close();

  check(errors.length === 0, 'no script errors', errors);
  console.log(`=== ${passed} DEPARTMENT HEAD DASHBOARD BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
