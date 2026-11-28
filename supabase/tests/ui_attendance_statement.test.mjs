// Browser test of HR > Attendance Statement & Export (docs/hr-dashboard-upgrade.md, Phase 2), desktop and phone: presets fill the dates, an
// invalid range is refused before the request, Apply sends the filters, the cards and the three views show, sorting asks the server, and the
// export (after an in-app confirmation) fetches every page and downloads a real .xlsx (named sheets, dates, codes) / .csv (BOM, formula-safe).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the attendance statement browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/attendance_statement_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

const emp = (i, status) => ({ date: `2026-11-0${(i % 7) + 1}`, profileId: 'p1', employeeCode: '0042', name: i === 0 ? '=HYPERLINK("x")' : 'Asha Verma', department: 'Wabastore', team: 'Sales',
  designation: 'Telecaller', employmentType: 'Full-Time', accountStatus: 'ACTIVE', biometricId: 'B-7', status, scheduled: true, shiftStart: '10:00', shiftEnd: '19:00',
  punchIn: status === 'ABSENT' ? null : '2026-11-02T04:40:00Z', punchOut: status === 'MISSING_PUNCH_OUT' || status === 'ABSENT' ? null : '2026-11-02T13:30:00Z',
  lunchStart: null, lunchEnd: null, breaks: 0, breakMinutes: status === 'PRESENT' ? 30 : null, grossMinutes: status === 'PRESENT' ? 530 : null, netMinutes: status === 'PRESENT' ? 500 : null,
  lateMinutes: 0, earlyMinutes: 0, leave: null, holiday: null, correction: null, incomplete: status === 'MISSING_PUNCH_OUT', source: status === 'ABSENT' ? null : 'CRM' });
const ALL = Array.from({ length: 7 }, (_, i) => emp(i, i === 3 ? 'MISSING_PUNCH_OUT' : i === 5 ? 'ABSENT' : 'PRESENT'));
const summary = { employees: 1, employeeDays: 7, scheduledDays: 6, presentDays: 5, absentDays: 1, approvedLeaveDays: 0, halfDays: 0, lateArrivals: 0, earlyDepartures: 0,
  missingPunches: 1, netMinutes: 2500, breakMinutes: 150, averageNetMinutes: 500 };
let calls = [];
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
function api(req, res, body) {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  calls.push({ method: req.method, path: p, body });
  if (p === '/hr/attendance-statement/options') return ok(res, { departments: [{ id: 'd1', name: 'Wabastore' }], teams: [{ id: 't1', name: 'Sales', departmentId: 'd1' }],
    employees: [{ id: 'p1', name: 'Asha Verma', departmentId: 'd1', teamId: 't1', active: true, designation: 'Telecaller' }, { id: 'p2', name: 'Old Leaver', departmentId: 'd1', teamId: 't1', active: false, designation: null }],
    designations: ['Telecaller'], shifts: ['10:00'], organization: 'Amuwa Corporation', timeZone: 'Asia/Kolkata', canExport: true });
  if (p === '/hr/attendance-statement') {
    const rows = body.view === 'SUMMARY' ? [{ profileId: 'p1', employeeCode: '0042', name: 'Asha Verma', department: 'Wabastore', team: 'Sales', designation: 'Telecaller', employmentType: 'Full-Time',
      scheduledDays: 6, presentDays: 5, absentDays: 1, leaveDays: 0, halfDays: 0, lateArrivals: 0, earlyDepartures: 0, missingPunches: 1, netMinutes: 2500, breakMinutes: 150, averageNetMinutes: 500 }]
      : body.view === 'REGISTER' ? [{ profileId: 'p1', employeeCode: '0042', name: 'Asha Verma', department: 'Wabastore', days: Object.fromEntries(ALL.map(r => [r.date, r.status === 'ABSENT' ? 'A' : r.status === 'MISSING_PUNCH_OUT' ? 'MP' : 'P'])) }]
      : ALL;
    return ok(res, { from: body.from, to: body.to, view: body.view, timeZone: 'Asia/Kolkata', today: '2026-11-28', summary, total: rows.length, page: 1, pageSize: 50, rows });
  }
  if (p === '/hr/attendance-statement/export') {
    const rows = body.offset === 0 ? ALL.slice(0, 5) : body.offset === 5000 ? ALL.slice(5) : [];
    return ok(res, { type: body.type, total: 7, offset: body.offset, rows, generatedAt: '2026-11-28T06:00:00Z', generatedBy: 'Payal HR', organization: 'Amuwa Corporation', timeZone: 'Asia/Kolkata' });
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `no fake for ${req.method} ${p}` } }));
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) { let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined)); return; }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true, timezoneId: 'America/Los_Angeles' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
    calls = [];
    await page.goto(base);
    await page.evaluate(() => window.mountStatement());
    await page.getByTestId('statement-cards').waitFor();
    check(/Scheduled working days \(employee-days\)\s*6/.test(await page.getByTestId('statement-cards').innerText()) && /Missing punch records\s*1/.test(await page.getByTestId('statement-cards').innerText()),
      `${label}: the summary cards`);
    await page.getByTestId('preset').selectOption('LAST_WEEK');
    const from = await page.getByTestId('from').inputValue(), to = await page.getByTestId('to').inputValue();
    check(/^\d{4}-\d{2}-\d{2}$/.test(from) && new Date(to).getTime() - new Date(from).getTime() === 6 * 86_400_000, `${label}: "Last week" fills seven days (India calendar, even in a US browser)`, [from, to]);
    await page.getByTestId('from').fill('2026-11-10');
    await page.getByTestId('to').fill('2026-11-01');
    check(/From Date must not be later than To Date/.test(await page.getByTestId('range-problem').innerText()) && await page.getByTestId('apply').isDisabled(), `${label}: an invalid range is refused before any request`);
    await page.getByTestId('from').fill('2026-11-01');
    await page.getByTestId('to').fill('2026-11-07');
    await page.getByTestId('pick-employees').locator('summary').click();
    await page.getByTestId('pick-employees').getByRole('checkbox').first().check();
    await page.getByTestId('apply').click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(150);
    const req = calls.filter(c => c.path === '/hr/attendance-statement').at(-1);
    check(req.body.from === '2026-11-01' && req.body.to === '2026-11-07' && req.body.profileIds.includes('p1') && req.body.view === 'DAILY', `${label}: Apply sends the dates and the employees`, req.body);
    check(/Missing/.test(await page.getByTestId('statement-table').innerText()), `${label}: a missing Punch Out is marked`);
    await page.getByTestId('statement-table').getByRole('button', { name: /Net/ }).click();
    await page.waitForTimeout(150);
    check(calls.filter(c => c.path === '/hr/attendance-statement').at(-1).body.sort === 'hours', `${label}: sorting asks the server (whole data set)`);
    await page.getByRole('tab', { name: 'Monthly register' }).click();
    await page.getByText('Legend: P = Present').waitFor();
    check(await page.locator('td[aria-label$=": Missing Punch"]').count() === 1, `${label}: the register has accessible codes and a legend`);
    await page.getByRole('tab', { name: 'Employee summary' }).click();
    await page.getByText('41h 40m').first().waitFor();
    // export: Excel, every page, a real workbook
    await page.getByRole('button', { name: 'Export Attendance' }).click();
    await page.getByTestId('export-dialog').waitFor();
    const dl = page.waitForEvent('download');
    await page.getByTestId('export-go').click();
    await page.getByRole('dialog').filter({ hasText: 'Export the attendance?' }).getByRole('button', { name: 'Export', exact: true }).click();
    const file = await dl;
    check(/^attendance-detailed-2026-11-01-to-2026-11-07\.xlsx$/.test(file.suggestedFilename()), `${label}: the file is named after the report and dates`, file.suggestedFilename());
    const zip = await JSZip.loadAsync(readFileSync(await file.path()));
    const wb = await zip.file('xl/workbook.xml').async('string');
    const sheet = await zip.file('xl/worksheets/sheet2.xml').async('string');
    check(/name="Report Summary"/.test(wb) && /name="Detailed Attendance"/.test(wb), `${label}: Report Summary and Detailed Attendance sheets`);
    check((sheet.match(/<row /g) || []).length === 8 && sheet.includes('>0042<') && sheet.includes(`'=HYPERLINK`) && sheet.includes('autoFilter'),
      `${label}: all 7 rows from both pages, the code kept as text, the formula neutralised, filterable headers`);
    check(calls.filter(c => c.path === '/hr/attendance-statement/export').length === 2, `${label}: the export fetched every page`);
    await page.getByText(/downloaded successfully \(7 rows\)/).first().waitFor();
    // CSV: reconciliation
    await page.getByRole('button', { name: 'Export Attendance' }).click();
    await page.getByLabel('CSV (.csv)').check();
    await page.getByLabel('Biometric reconciliation report').check();
    const dl2 = page.waitForEvent('download');
    await page.getByTestId('export-go').click();
    await page.getByRole('dialog').filter({ hasText: 'Export the attendance?' }).getByRole('button', { name: 'Export', exact: true }).click();
    const csv = readFileSync(await (await dl2).path());
    const text = csv.toString('utf8');
    check(csv[0] === 0xef && csv[1] === 0xbb && csv[2] === 0xbf && /Biometric Employee ID/.test(text) && text.includes('0042,B-7,') && text.includes('10:10'),
      `${label}: the reconciliation CSV (UTF-8 BOM, biometric id, India times)`, text.slice(0, 300));
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(wide <= 1, `${label}: no sideways page scrolling (tables scroll in their box)`, wide);
    check(errors.length === 0, `${label}: no script errors and no browser dialogs`, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} ATTENDANCE STATEMENT BROWSER CHECKS PASSED ===`);
