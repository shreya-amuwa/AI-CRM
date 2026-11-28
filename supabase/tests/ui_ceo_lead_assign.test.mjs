// Browser test of Lead Assign for a Sales CEO and a Department Head (20270303000100), at desktop and phone width: the CEO sees the Sales
// Department Heads first (with their department) and can narrow the list to one department, the request names only the recipient (never a
// department), the confirmation shows the department and the note; a Department Head sees the sheets given to them (by whom, when, open
// leads) and forwards them. The page is the real component; the API is a fake. Uses the sample-sheets harness (mountLeadAssign, makeSheet).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the CEO lead assign browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/sample_sheets_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

const PEOPLE = [
  { id: 'h1', name: 'Asha Head', team: null, teamId: null, role: 'Department Head', kind: 'DEPARTMENT_HEAD', subRole: null, mode: 'LEADS', openContacts: 0, openLeads: 4, departmentId: 'd1', department: 'M Pillar' },
  { id: 'h2', name: 'Bala Head', team: null, teamId: null, role: 'Department Head', kind: 'DEPARTMENT_HEAD', subRole: null, mode: 'LEADS', openContacts: 0, openLeads: 0, departmentId: 'd2', department: 'Whatsbox' },
  { id: 't1', name: 'Chetan Lead', team: 'Sales', teamId: 'tm1', role: 'Team Lead', kind: 'TEAM_LEAD', subRole: null, mode: 'LEADS', openContacts: 0, openLeads: 2, departmentId: 'd1', department: 'M Pillar' }
];
let mode = 'ceo';
let failCommit = false;
let calls = [];
let received = [];
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const rowsOf = body => (body.rows || []).map(r => ({ row: r.row, name: r.name, company: r.company || null, phone: r.phone, email: r.email || null, remarks: r.remarks || null }));
function api(req, res, body) {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  calls.push({ method: req.method, path: p, body });
  if (p === '/sales-head/lead-assignees') return ok(res, mode === 'ceo' ? PEOPLE : PEOPLE.filter(x => x.role !== 'Department Head' && x.departmentId === 'd1'));
  if (p === '/sales-head/sheets' && req.method === 'GET') return ok(res, []);
  if (p === '/sales-head/received-sheets') return ok(res, received);
  if (p === '/sales-head/received-sheets/r1/assignees') return ok(res, [{ id: 't1', name: 'Chetan Lead', team: 'Sales', role: 'Team Lead', openLeads: 2 }]);
  if (p === '/sales-head/received-sheets/r1/forward') { received = [{ ...received[0], openWithMe: 1, forwarded: 2 }]; return ok(res, { moved: body.count ?? 3, assignee: { id: 't1', name: 'Chetan Lead', role: 'Team Lead' } }); }
  if (p === '/sales-head/sheets' && req.method === 'POST' && body.commit && failCommit) {
    failCommit = false;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'duplicate key value violates unique constraint "lead_sheets_pkey"' } }));
  }
  if (p === '/sales-head/sheets' && req.method === 'POST') {
    const a = PEOPLE.find(x => x.id === body.assigneeId);
    return ok(res, { committed: !!body.commit, sheetId: body.commit ? 's1' : null, mode: 'LEADS', alreadyAssigned: false,
      assignee: { id: a.id, name: a.name, role: a.role, team: a.team, departmentId: a.departmentId, department: a.department }, issues: [],
      summary: { rows: body.rows.length, valid: body.rows.length, invalid: 0, duplicates: 0 }, preview: rowsOf(body) });
  }
  if (/\/sales-head\/sheets\/s1\/source$/.test(p)) return ok(res, { stored: true, size: 10 });
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `no fake for ${req.method} ${p}` } }));
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined));
    return;
  }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
const tmp = mkdtempSync(path.join(tmpdir(), 'ceo-ui-'));

let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });

    // ---- the CEO
    mode = 'ceo'; calls = []; received = [];
    await page.goto(base);
    await page.evaluate(() => window.mountLeadAssign());
    await page.locator('#la-assignee').waitFor();
    const groups = await page.locator('#la-assignee optgroup').evaluateAll(gs => gs.map(g => g.label));
    check(groups[0] === 'Department Heads' && groups.includes('Team Leads'), `${label}: the CEO sees the Department Heads first`, groups);
    const headText = await page.locator('#la-assignee option[value="h1"]').innerText();
    check(/Asha Head · Department Head · M Pillar \(4 open leads\)/.test(headText), `${label}: a head is shown with their department and open leads`, headText);
    await page.locator('#la-dept').selectOption('d2');
    const left = await page.locator('#la-assignee option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
    check(left.length === 1 && left[0] === 'h2', `${label}: the department choice narrows the list`, left);
    await page.locator('#la-dept').selectOption('');
    await page.locator('#la-assignee').selectOption('h1');
    check(/Sales Department Head of M Pillar/.test(await page.getByTestId('assign-mode').innerText()), `${label}: what happens is explained for a Department Head`);
    await page.locator('#la-note').fill('Expo leads');
    const b64 = await page.evaluate(() => window.makeSheet([['Contact Name', 'Company Name', 'Phone Number', 'Email', 'Remarks'], ['Ravi Kumar', 'RK Traders', '9811100001', '', ''], ['Sita Devi', '', '9811100002', '', '']]));
    const file = path.join(tmp, `ceo-${label}.xlsx`);
    writeFileSync(file, Buffer.from(b64, 'base64'));
    await page.locator('#la-file').setInputFiles(file);
    await page.getByRole('button', { name: /Review and give 2 leads to Asha Head/ }).click();
    check(await page.getByTestId('confirm-department').innerText() === 'M Pillar' && await page.getByText('Expo leads').last().isVisible(), `${label}: the confirmation shows the department and the note`);
    // a failure first (Phase 1): an error toast in plain words, never the database text; nothing is shown as assigned
    failCommit = true;
    await page.getByRole('button', { name: 'Confirm and assign' }).click();
    await page.getByTestId('toast-error').getByText('The sheet could not be assigned. Nothing was changed.').waitFor();
    check(await page.getByText(/unique constraint|lead_sheets_pkey/).count() === 0 && await page.getByTestId('toast-success').count() === 0,
      `${label}: a failed assignment shows a clear error toast, no database text and no success`);
    await page.getByRole('button', { name: /Review and give 2 leads to Asha Head/ }).click();
    await page.getByRole('button', { name: 'Confirm and assign' }).click();
    await page.getByRole('status').filter({ hasText: /2 leads/ }).waitFor();
    check(await page.getByTestId('toast-error').count() === 0, `${label}: trying again turns into the success toast`);
    const commit = calls.filter(c => c.method === 'POST' && c.path === '/sales-head/sheets' && c.body.commit).at(-1);
    check(commit && commit.body.assigneeId === 'h1' && !('departmentId' in commit.body), `${label}: the request names the recipient only (the server decides the department)`, commit?.body);

    // ---- the Department Head
    mode = 'head'; calls = [];
    received = [{ id: 'r1', fileName: 'expo.xlsx', note: null, assignedAt: '2027-03-03T05:00:00Z', assignedBy: 'Kiran CEO', assignedByRole: 'CEO', departmentId: 'd1', department: 'M Pillar', valid: 3, openWithMe: 3, forwarded: 0, converted: 0 }];
    await page.goto(base);
    await page.evaluate(() => window.mountLeadAssign());
    await page.getByTestId('received-sheets').waitFor();
    const row = await page.getByTestId('received-sheets').innerText();
    check(/Assigned by Kiran CEO \(CEO\)/.test(row) && /3 open with you/.test(row), `${label}: the head sees who assigned the sheet and the open leads`, row);
    check(!(await page.locator('#la-assignee optgroup[label="Department Heads"]').count()), `${label}: a head is not offered Department Heads`);
    await page.getByRole('button', { name: 'Forward leads' }).click();
    await page.getByRole('dialog').getByRole('combobox').selectOption('t1');
    await page.getByRole('dialog').getByRole('textbox').fill('2');
    await page.getByRole('dialog').getByRole('button', { name: 'Forward', exact: true }).click();
    await page.getByTestId('toast-success').getByText(/2 leads of expo.xlsx forwarded successfully to Chetan Lead/).waitFor();
    const fw = calls.find(c => c.path === '/sales-head/received-sheets/r1/forward');
    check(fw && fw.body.assigneeId === 't1' && fw.body.count === 2, `${label}: forwarding sends the member and the number`, fw?.body);
    check(/1 open with you · 2 forwarded/.test(await page.getByTestId('received-sheets').innerText()), `${label}: the list is refreshed`);

    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(wide <= 1, `${label}: no sideways scrolling`, wide);
    check(errors.length === 0, `${label}: no script errors and no browser dialogs`, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} CEO LEAD ASSIGN BROWSER CHECKS PASSED ===`);
