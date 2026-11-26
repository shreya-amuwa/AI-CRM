// Browser test of the sample sheets on the two contact-sheet uploads (Sheet Upload of the Sales Department Head, Telecaller Sheets of the Department
// Head): the sample download is offered, the downloaded file has the headings and a first row of placeholders (no real name), uploading it back says
// it only holds the sample row, and a sample row inside a real sheet is skipped. The pages are the real components; the API is a fake.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the sample sheet browser test did not run'); process.exit(0); }
const JSZip = require('jszip');
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/sample_sheets_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API ---------------------------------------------------------------------------------------------------------------------------
let calls = [];
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const rowsOf = body => (body.rows || []).map(r => ({ row: r.row, name: r.name, company: r.company || null, phone: r.phone, email: r.email || null, remarks: r.remarks || null }));
function api(req, res, body) {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  calls.push({ method: req.method, path: p, body });
  if (p === '/telecaller/assignable') return ok(res, [{ id: 't1', name: 'Test Telecaller', team: 'Sales', departmentId: 'd1', openContacts: 0 }]);
  if (p === '/telecaller/lists' && req.method === 'GET') return ok(res, []);
  if (p === '/telecaller/lists' && req.method === 'POST') return ok(res, { committed: false, listId: null, alreadyAssigned: false, errors: [], summary: { rows: body.rows.length, valid: body.rows.length, invalid: 0 }, preview: rowsOf(body) });
  if (p === '/sales-head/lead-assignees') return ok(res, [{ id: 'p1', name: 'Test Telecaller', team: 'Sales', teamId: 't1', role: 'Team Member', subRole: 'TELECALLER', mode: 'TELECALLER', openContacts: 0 }]);
  if (p === '/sales-head/sheets' && req.method === 'GET') return ok(res, []);
  if (p === '/sales-head/sheets' && req.method === 'POST') {
    return ok(res, { committed: false, sheetId: null, mode: 'TELECALLER', alreadyAssigned: false, assignee: { id: 'p1', name: 'Test Telecaller', role: 'Team Member', team: 'Sales' }, issues: [],
      summary: { rows: body.rows.length, valid: body.rows.length, invalid: 0, duplicates: 0 }, preview: rowsOf(body) });
  }
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
const REAL = ['Siddhesh', 'Patil', 'Priya', 'Rahul', 'Galaxy', 'Ravi', 'Asha', 'Verma', 'Sharma'];
const HEAD = ['Contact Name', 'Company Name', 'Phone Number', 'Email', 'Remarks'];
const SAMPLE = ['Contact_Name', 'Company_Name', '9000000000', 'name@example.com', 'Remarks'];
const tmp = mkdtempSync(path.join(tmpdir(), 'sample-ui-'));
const xlsxText = async file => {
  const zip = await JSZip.loadAsync(readFileSync(file));
  return zip.file('xl/worksheets/sheet1.xml').async('string');
};

let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const download = async name => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
      const file = path.join(tmp, `${label}-${dl.suggestedFilename()}`);
      await dl.saveAs(file);
      return { file, name: dl.suggestedFilename() };
    };

    // ================== Telecaller Sheets (Excel only)
    calls = [];
    await page.goto(base);
    await page.evaluate(() => window.mountContacts());
    await page.getByTestId('sample-sheet').waitFor();
    check(await page.getByRole('button', { name: 'Sample Excel sheet' }).isVisible() && !(await page.getByRole('button', { name: 'Sample CSV' }).count()), `${label}: Telecaller Sheets offers the sample as Excel (the only file type it takes)`);
    const rt = await page.evaluate(() => window.roundTrip());
    check(JSON.stringify(rt.rows[0]) === JSON.stringify(HEAD) && JSON.stringify(rt.rows[1]) === JSON.stringify(SAMPLE) && rt.parsed.problem && rt.parsed.sampleSkipped === true, `${label}: the sample, read back with the real Excel reader, has the headings and the placeholder row, and the reader sees it as the sample`, rt);
    const dl = await download('Sample Excel sheet');
    const xml = await xlsxText(dl.file);
    check(dl.name === 'Contact sheet sample.xlsx' && [...HEAD, ...SAMPLE].every(t => xml.includes(`>${t}</t>`)), `${label}: the downloaded file is "Contact sheet sample.xlsx" with the headings and the placeholder row`, dl.name);
    check(REAL.every(w => !xml.includes(w)), `${label}: no real name is in the downloaded file`);

    await page.locator('#cs-file').setInputFiles(dl.file);
    await page.getByText(/only has the sample row/).waitFor();
    check(!(await page.getByTestId('preview-rows').count()) && !calls.some(c => c.method === 'POST'), `${label}: uploading the untouched sample says it only has the sample row; nothing is checked or assigned`);

    const withReal = await page.evaluate(rows => window.makeSheet(rows), [HEAD, SAMPLE, ['Test_Lead_One', 'Test_Company', '9811234561', '', 'first call']]);
    await page.locator('#cs-file').setInputFiles({ name: 'my-contacts.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(withReal, 'base64') });
    await page.getByTestId('preview-rows').waitFor();
    const post = calls.filter(c => c.method === 'POST' && c.path === '/telecaller/lists').at(-1);
    check(post && post.body.rows.length === 1 && post.body.rows[0].name === 'Test_Lead_One' && post.body.rows[0].row === 3, `${label}: a sheet with the sample row and a real contact sends only the real contact (Excel row 3)`, post?.body);
    check(await page.getByTestId('sample-skipped').isVisible(), `${label}: and says the sample row was skipped`);

    // ================== Sheet Upload (Excel or CSV)
    calls = [];
    await page.goto(base);
    await page.evaluate(() => window.mountLeadAssign());
    await page.getByTestId('sample-sheet').waitFor();
    check(await page.getByRole('button', { name: 'Sample Excel sheet' }).isVisible() && await page.getByRole('button', { name: 'Sample CSV' }).isVisible(), `${label}: Sheet Upload offers the sample as Excel and as CSV (it takes both)`);
    const csvDl = await download('Sample CSV');
    const csv = readFileSync(csvDl.file, 'utf8');
    check(csvDl.name === 'Contact sheet sample.csv' && csv.replace(/^﻿/, '') === `${HEAD.join(',')}\r\n${SAMPLE.join(',')}` && REAL.every(w => !csv.includes(w)), `${label}: the CSV sample is the headings and the placeholder row`, csv);
    await page.locator('#la-file').setInputFiles(csvDl.file);
    await page.getByText(/only has the sample row/).waitFor();
    check(!calls.some(c => c.method === 'POST'), `${label}: uploading the untouched CSV sample says it only has the sample row; nothing is checked`);
    writeFileSync(path.join(tmp, 'real.csv'), `${HEAD.join(',')}\r\n${SAMPLE.join(',')}\r\nTest_Lead_Two,Test_Company,9811234562,,\r\n`);
    await page.locator('#la-file').setInputFiles(path.join(tmp, 'real.csv'));
    await page.getByTestId('preview-rows').waitFor();
    const post2 = calls.filter(c => c.method === 'POST' && c.path === '/sales-head/sheets').at(-1);
    check(post2 && post2.body.rows.length === 1 && post2.body.rows[0].name === 'Test_Lead_Two', `${label}: a CSV with the sample row and a real contact sends only the real contact`, post2?.body);
    check(await page.getByTestId('sample-skipped').isVisible(), `${label}: and says the sample row was skipped`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: nothing runs off the screen`);
    await ctx.close();
  }
  console.log(`=== ${passed} SAMPLE SHEET BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
