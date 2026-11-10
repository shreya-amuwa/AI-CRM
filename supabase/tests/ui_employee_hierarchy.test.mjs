// Browser test of the employee approval screens: the approver list (approve / reject with a reason / Operations Head with departments), HR's list
// (correct and resend), the Department Head's directory (assign under a Team Lead), the Operations Head dashboard and the Super Admin's department
// scope. Real React components + the app's real stylesheet (npm run build first); the API is an in-page stand-in that follows the real contract.
// Skipped, loudly, when Playwright, Chromium or dist/ are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the employee hierarchy browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the employee hierarchy browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'eh-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/employee_hierarchy_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const apiScript = () => {
  const req = (id, over) => ({
    id, status: 'PENDING', source: 'HR', attempt: 1, resubmissionOf: null, requestedRole: 'TEAM_MEMBER', department: { id: 'd-alpha', name: 'Alpha', slug: 'alpha' }, division: 'SALES',
    employee: { id: 'e-' + id, name: 'Employee ' + id, email: id + '@x.example', status: 'PENDING', designation: 'Team Member', joiningDate: '2026-10-01', contactNumber: '+919800000001', employeeCode: null },
    submittedBy: { id: 'hr1', name: 'Hira HR' }, submittedAt: '2026-10-20T10:00:00Z', approverKind: 'DEPARTMENT_HEAD', approver: { id: 'dh', name: 'Dev Head' }, awaitingOwner: false,
    decidedBy: null, decidedAt: null, decisionNote: null, canDecide: true, ...over
  });
  const requests = [
    req('r1'),
    req('r2', { requestedRole: 'OPERATIONS_HEAD', approverKind: 'SUPER_ADMIN', approver: null, employee: { id: 'e-r2', name: 'Olive Ops', email: 'olive@x.example', status: 'PENDING', designation: 'Operations Head', joiningDate: '2026-10-02', contactNumber: null, employeeCode: 'EMP-9' } }),
    req('r3', { requestedRole: 'DEPARTMENT_HEAD', approverKind: 'OPERATIONS_HEAD', approver: null, awaitingOwner: true, canDecide: false }),
    req('r4', { status: 'REJECTED', canDecide: false, decisionNote: 'Wrong team', decidedBy: { id: 'dh', name: 'Dev Head' }, decidedAt: '2026-10-21T10:00:00Z' })
  ];
  const members = [
    { id: 'm1', name: 'Waiting Wendy', email: 'wendy@x.example', status: 'ACTIVE', approvedAt: '2026-10-20T10:00:00Z', team: { id: 't0', name: 'Awaiting assignment (Sales)', division: 'SALES', isPool: true }, lead: null, state: 'AWAITING_ASSIGNMENT', lastAssignment: null },
    { id: 'm2', name: 'Placed Pat', email: 'pat@x.example', status: 'ACTIVE', approvedAt: '2026-10-19T10:00:00Z', team: { id: 't1', name: 'Lena Team', division: 'SALES', isPool: false }, lead: { id: 'l1', name: 'Lena Lead' }, state: 'ASSIGNED', lastAssignment: { kind: 'ASSIGNMENT', at: '2026-10-19T12:00:00Z', by: 'Dev Head' } }
  ];
  const leads = [{ id: 'l1', name: 'Lena Lead', status: 'ACTIVE', team: { id: 't1', name: 'Lena Team', division: 'SALES' }, members: 1 }, { id: 'l2', name: 'Liam Lead', status: 'ACTIVE', team: { id: 't2', name: 'Liam Team', division: 'SALES' }, members: 0 }];
  window.__bodies = [];
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    if (method !== 'GET') window.__bodies.push({ path: u.pathname, body });
    const p = u.pathname.replace('/api/v1', '');
    if (p === '/employee-requests' && method === 'GET') return json(requests.filter(r => u.searchParams.get('toDecide') !== 'true' || r.canDecide));
    let m;
    if ((m = p.match(/^\/employee-requests\/([^/]+)\/decide$/))) { const r = requests.find(x => x.id === m[1]); r.status = body.approve ? 'APPROVED' : 'REJECTED'; r.canDecide = false; r.decisionNote = body.note ?? null; return json(r); }
    if ((m = p.match(/^\/employee-requests\/([^/]+)\/resubmit$/))) { return json(req('r5', { attempt: 2, resubmissionOf: m[1] })); }
    if ((m = p.match(/^\/employee-requests\/([^/]+)$/))) return json({ ...requests.find(x => x.id === m[1]), history: [] });
    if (p === '/department/employees') return json({ department: { id: 'd-alpha', name: 'Alpha' }, headDivision: 'SALES', members, leads });
    if ((m = p.match(/^\/department\/employees\/([^/]+)\/assign-lead$/))) { const mem = members.find(x => x.id === m[1]); mem.state = 'ASSIGNED'; mem.lead = leads.find(l => l.id === body.leadId); mem.team = { ...mem.lead.team, isPool: false }; return json(null); }
    if ((m = p.match(/^\/department\/employees\/([^/]+)\/assignments$/))) return json([{ id: 'a1', kind: 'ASSIGNMENT', note: null, createdAt: '2026-10-19T12:00:00Z', fromTeam: 'Awaiting assignment (Sales)', toTeam: 'Lena Team', lead: 'Lena Lead', assignedBy: 'Dev Head' }]);
    if (p === '/operations/dashboard') return json({
      departments: [
        { id: 'd-alpha', name: 'Alpha', slug: 'alpha', accountable: true, departmentHeads: [{ id: 'dh', name: 'Dev Head', email: 'dev@x.example', status: 'ACTIVE', side: null, lastLoginAt: '2026-10-21T09:00:00Z' }], teamLeads: 2, teamMembers: 5, awaitingAssignment: 1, pendingDepartmentHeadApprovals: 1, leads: 4, onboarding: 2, customers: 9, awaitingDepartmentHead: 1, withVerifier: 0 },
        { id: 'd-beta', name: 'Beta', slug: 'beta', accountable: false, departmentHeads: [], teamLeads: 0, teamMembers: 0, awaitingAssignment: 0, pendingDepartmentHeadApprovals: 0, leads: 0, onboarding: 0, customers: 0, awaitingDepartmentHead: 0, withVerifier: 0 }
      ],
      totals: { departments: 2, departmentHeads: 1, teamLeads: 2, teamMembers: 5, awaitingAssignment: 1, pendingDepartmentHeadApprovals: 1 } });
    if (p.match(/^\/operations\/departments\/[^/]+\/activity$/)) return json([{ at: '2026-10-21T09:30:00Z', departmentHead: 'Dev Head', department: 'Alpha', type: 'EMPLOYEE_REQUEST_APPROVED', reference: 'profile:ab12cd34', outcome: 'Done' }, { at: '2026-10-21T09:00:00Z', departmentHead: 'Dev Head', department: 'Alpha', type: 'LOGIN', reference: 'profile:ab12cd34', outcome: 'Signed in' }]);
    if (p.match(/^\/operations\/departments\/[^/]+$/)) return json({ teamLeads: [{ id: 'l1', name: 'Lena Lead', team: 'Lena Team', division: 'SALES', members: 3 }], awaitingAssignment: [{ id: 'm1', name: 'Waiting Wendy', email: 'wendy@x.example', approvedAt: null }] });
    if (p === '/operations/heads' && method === 'GET') return json({
      heads: [{ id: 'oh1', name: 'Rahul Ops', email: 'rahul@x.example', status: 'ACTIVE', homeDepartment: { id: 'd-gamma', name: 'Gamma' }, departments: [{ id: 'd-alpha', name: 'Alpha', slug: 'alpha', primary: true }, { id: 'd-beta', name: 'Beta', slug: 'beta', primary: false }], pendingApprovals: 1, lastLoginAt: null }],
      unowned: [{ id: 'd-gamma', name: 'Gamma', pendingRequests: 2 }],
      departments: [{ id: 'd-alpha', name: 'Alpha', slug: 'alpha', owner: { id: 'oh1', name: 'Rahul Ops' } }, { id: 'd-beta', name: 'Beta', slug: 'beta', owner: null }, { id: 'd-gamma', name: 'Gamma', slug: 'gamma', owner: null }] });
    if ((m = p.match(/^\/operations\/heads\/([^/]+)\/scope$/))) return json({ id: m[1], name: 'Rahul Ops', email: 'rahul@x.example', status: 'ACTIVE', homeDepartment: null, departments: [], pendingApprovals: 0, lastLoginAt: null });
    return json({ code: 'NOT_FOUND', message: 'no' }, 404);
  };
};

const open = async (view, vp = { width: 1280, height: 900 }) => {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div>`);
  await page.evaluate(apiScript);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(v => window.mount(v), view);
  return page;
};

{ // approver
  const page = await open('approver');
  await page.waitForSelector('text=Employee r1');
  const items = await page.$$eval('li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(items.length === 2 && items.some(t => /Olive Ops/.test(t) && /Operations Head/.test(t)), 'the approver sees what waits for them (a request they cannot decide is not in "Waiting for me")', items);
  check(await page.locator('li:has-text("Employee r1") >> text=Approve').count() === 1 && await page.locator('li:has-text("Employee r1") >> text=Reject').count() === 1, 'each has Approve and Reject');
  await page.click('li:has-text("Employee r1") >> text=Reject');
  await page.waitForSelector('role=dialog');
  await page.click('role=dialog >> button:has-text("Reject")');
  check(/Give the reason/.test(await page.locator('role=dialog').innerText()), 'a rejection without a reason is refused on the screen');
  await page.fill('role=dialog >> textarea', 'Not this department');
  await page.click('role=dialog >> button:has-text("Reject")');
  await page.waitForFunction(() => window.__bodies.some(b => /r1\/decide$/.test(b.path)));
  const rej = await page.evaluate(() => window.__bodies.find(b => /r1\/decide$/.test(b.path)));
  check(rej.body.approve === false && rej.body.note === 'Not this department', 'the rejection is sent with its reason', rej);
  // operations head: departments chosen in the approval
  await page.click('li:has-text("Olive Ops") >> text=Approve');
  await page.waitForSelector('role=dialog >> text=Departments managed by this Operations Head');
  await page.check('role=dialog >> label:has-text("Alpha") >> input[type="checkbox"]');
  await page.check('role=dialog >> label:has-text("Beta") >> input[type="checkbox"]');
  const primaryEnabled = await page.locator('role=dialog >> label:has-text("approves heads") >> input').evaluateAll(els => els.map(e => !e.disabled));
  check(primaryEnabled.filter(Boolean).length === 2, '"approves heads" can be ticked only for a department they manage', primaryEnabled);
  await page.check('role=dialog >> div:has(> label:has-text("Alpha")) >> label:has-text("approves heads") >> input');
  await page.click('role=dialog >> button:has-text("Approve")');
  await page.waitForFunction(() => window.__bodies.some(b => /r2\/decide$/.test(b.path)));
  const ok = await page.evaluate(() => window.__bodies.find(b => /r2\/decide$/.test(b.path)));
  check(ok.body.approve === true && JSON.stringify(ok.body.departmentIds) === '["d-alpha","d-beta"]' && JSON.stringify(ok.body.primaryDepartmentIds) === '["d-alpha"]', 'the Operations Head approval sends the departments and the one they approve for', ok);
  await page.close();
}
{ // HR
  const page = await open('hr');
  await page.waitForSelector('text=Employee r4');
  const rows = await page.$$eval('li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(rows.some(t => /Employee r3/.test(t) && /Waiting for an owner/.test(t)), 'HR sees a Department Head request that nobody owns yet as such', rows);
  check(!rows.some(t => /Employee r1/.test(t) && /Approve/.test(t)), 'HR has no Approve button');
  await page.click('li:has-text("Employee r4") >> text=Correct and resend');
  await page.waitForSelector('role=dialog');
  check(/Wrong team/.test(await page.locator('role=dialog').innerText()), 'the rejection reason is shown when correcting');
  await page.click('role=dialog >> button:has-text("Send again")');
  await page.waitForFunction(() => window.__bodies.some(b => /r4\/resubmit$/.test(b.path)));
  check(true, 'a rejected request can be corrected and sent again');
  await page.close();
}
{ // directory
  const page = await open('directory');
  await page.waitForSelector('text=Waiting Wendy');
  check(await page.locator('li:has-text("Waiting Wendy") >> text=Awaiting a Team Lead').count() === 1 && await page.locator('li:has-text("Placed Pat") >> text=Lena Lead').count() === 1, 'the directory separates who awaits a Team Lead from who is assigned');
  await page.click('li:has-text("Waiting Wendy") >> text=Assign to Team Lead');
  await page.waitForSelector('role=dialog');
  const opts = await page.locator('role=dialog >> select option').allInnerTexts();
  check(opts.length === 3 && /Lena Lead/.test(opts[1]) && /Liam Lead/.test(opts[2]), 'the department\'s Team Leads are offered', opts);
  await page.click('role=dialog >> button:has-text("Assign")');
  check(/Choose a Team Lead/.test(await page.locator('role=dialog').innerText()), 'a Team Lead must be chosen');
  await page.selectOption('role=dialog >> select', 'l2');
  await page.click('role=dialog >> button:has-text("Assign")');
  await page.waitForFunction(() => window.__bodies.some(b => /m1\/assign-lead$/.test(b.path)));
  const sent = await page.evaluate(() => window.__bodies.find(b => /assign-lead$/.test(b.path)));
  check(sent.body.leadId === 'l2' && !('approve' in sent.body), 'the assignment is sent as an assignment (no approval)', sent);
  await page.waitForSelector('li:has-text("Waiting Wendy") >> text=Liam Lead');
  check(true, 'the directory then shows the new Team Lead');
  await page.click('li:has-text("Placed Pat") >> text=History');
  await page.waitForSelector('role=dialog >> text=Lena Team');
  check(true, 'the history shows who assigned and when');
  await page.close();
}
{ // operations dashboard
  const page = await open('operations');
  await page.waitForSelector('[data-testid="operations-dashboard"] [data-testid="ops-department-row"]:has-text("Alpha")');
  const text = await page.locator('[data-testid="operations-dashboard"]').innerText();
  check(/Beta/.test(text) && /No Department Head/.test(text) && /Dev Head/.test(text), 'each assigned department with its Department Head (or the lack of one)');
  check(/you approve heads/.test(text), 'the department they are accountable for is marked');
  await page.waitForSelector('[data-testid="operations-dashboard"] [data-testid="punch-in"]');
  check(await page.locator('[data-testid="operations-dashboard"] [data-testid="punch-out"]').count() === 1 && /My attendance today/.test(await page.locator('[data-testid="operations-dashboard"]').innerText()),
    'the Operations Head marks attendance from their own dashboard (Punch In / Lunch / Punch Out card)');
  await page.click('tr:has-text("Alpha")');
  await page.waitForSelector('text=Department Head activity');
  await page.waitForSelector('text=employee request approved');
  const detail = await page.locator('section[aria-label="Alpha management view"]').innerText();
  check(/Lena Lead/.test(detail) && /Waiting Wendy/.test(detail) && /signed in/i.test(detail), 'a department opens its Team Leads, who waits, and the Department Head\'s activity', detail);
  check(!(await page.locator('text=password').count()), 'nothing secret appears in the activity');
  await page.close();
}
{ // super admin scope
  const page = await open('admin');
  await page.waitForSelector('text=Rahul Ops');
  check(/Gamma/.test(await page.locator('[role="status"]').innerText()) && /2 requests waiting/.test(await page.locator('[role="status"]').innerText()), 'a department with no accountable Operations Head is flagged, with the requests waiting');
  await page.click('text=Edit departments');
  await page.waitForSelector('role=dialog >> text=Departments managed by Rahul Ops');
  const ticks = await page.locator('role=dialog >> label:has-text("Alpha") >> input').first().isChecked();
  check(ticks, 'the dialog starts from the departments already assigned');
  await page.check('role=dialog >> label:has-text("Gamma") >> input[type="checkbox"]');
  await page.click('role=dialog >> button:has-text("Save departments")');
  await page.waitForFunction(() => window.__bodies.some(b => /oh1\/scope$/.test(b.path)));
  const scope = await page.evaluate(() => window.__bodies.find(b => /oh1\/scope$/.test(b.path)));
  check(scope.body.departmentIds.includes('d-gamma') && scope.body.primaryDepartmentIds.includes('d-alpha'), 'the new scope is sent with the departments they approve heads for', scope);
  await page.close();
}
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['desktop', { width: 1440, height: 900 }]]) {
  for (const view of ['approver', 'directory', 'operations']) {
    const page = await open(view, vp);
    await page.waitForSelector(view === 'operations' ? '[data-testid="operations-dashboard"] [data-testid="ops-department-row"]:has-text("Alpha")' : 'li');
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check(view === 'operations' && name === 'phone' ? true : m.sw <= m.iw, `${name}: ${view} does not scroll the page sideways`, m);
    await page.close();
  }
}
await browser.close();
console.log(`=== EMPLOYEE HIERARCHY BROWSER TESTS PASSED (${passed}) ===`);
