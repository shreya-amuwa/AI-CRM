// Browser test of Upload Leads: the real Lead sections in Chromium with the API answered in the page. Checks that "Add Lead" and "Upload Leads" sit
// side by side (desktop and phone width), that only Sales employees get Upload Leads, and the upload window: templates, a CSV file, the preview with
// new / duplicate / invalid rows, the import in chunks and the summary. Skipped, loudly, when Playwright / Chromium are missing.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Upload Leads browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const supa = path.resolve('supabase/tests/ui/lead_upload_supabase_stub.ts');
const auth = path.resolve('supabase/tests/ui/lead_upload_auth_stub.tsx');
const built = await build({
  entryPoints: ['supabase/tests/ui/lead_upload_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: supa }));
    b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: auth }));
  } }]
});
const bundle = built.outputFiles[0].text;
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;
let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); server.close(); process.exit(0); }
const shots = process.env.UI_SHOTS_DIR;
const work = mkdtempSync(path.join(tmpdir(), 'lu-ui-'));
const csvFile = path.join(work, 'leads.csv');
writeFileSync(csvFile, 'Customer Name,Mobile Number,Company Name,Interested Service\nRavi,9829012345,Ravi Co,WhatsApp API\nBad,12345,Bad Co,WhatsApp API\nTwice,9829012345,Twice Co,WhatsApp API\n');

try {
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.error('page error:', e.message));
    await page.goto(origin);
    await page.evaluate(() => window.mountPipeline());
    const add = page.getByRole('button', { name: 'Add lead' });
    const up = page.getByRole('button', { name: 'Upload Leads' });
    await up.waitFor();
    const [a, u] = [await add.boundingBox(), await up.boundingBox()];
    check(Math.abs(a.y - u.y) < 2 && Math.abs(a.height - u.height) < 2 && u.x > a.x, `${width}px: Add lead and Upload Leads are side by side, the same height`, { a, u });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px: no sideways scrolling`);
    if (shots) await page.screenshot({ path: path.join(shots, `lead-section-${width}.png`) });
    await up.click();
    await page.getByRole('dialog', { name: 'Upload Leads' }).waitFor();
    check(await page.getByRole('button', { name: /Sample Excel Template/ }).isVisible() && await page.getByRole('button', { name: /Sample CSV Template/ }).isVisible()
      && await page.getByRole('button', { name: 'Browse Files' }).isVisible(), `${width}px: templates and Browse Files`);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /Sample CSV Template/ }).click();
    const csv = readFileSync(await (await dl).path(), 'utf8');
    check(csv.includes('Customer Name,Contact Person,Mobile Number') && csv.includes('Assigned Employee'), `${width}px: the CSV template has the lead columns`);
    const dlx = page.waitForEvent('download');
    await page.getByRole('button', { name: /Sample Excel Template/ }).click();
    check((await dlx).suggestedFilename().endsWith('.xlsx'), `${width}px: the Excel template downloads as .xlsx`);
    await page.setInputFiles('input[type=file]', csvFile);
    await page.getByText('3 records detected').waitFor();
    await page.getByRole('button', { name: /Import 1 new lead/ }).waitFor();
    check(await page.getByText('Mobile Number: Enter a 10-digit mobile number.').isVisible() && await page.getByText('appears earlier in this file').isVisible(), `${width}px: the preview shows the invalid and duplicate rows with their reason`);
    await page.getByRole('tab', { name: /Invalid leads/ }).click();
    check(await page.getByRole('dialog').locator('tbody tr').count() === 1, `${width}px: the Invalid tab lists only the invalid row`);
    if (shots) await page.screenshot({ path: path.join(shots, `upload-preview-${width}.png`) });
    await page.getByRole('button', { name: /Import 1 new lead/ }).click();
    await page.getByText('Upload finished.').waitFor();
    check(await page.getByText('Total records uploaded').isVisible() && await page.getByText('Failed records', { exact: true }).isVisible(), `${width}px: the summary`);
    if (shots) await page.screenshot({ path: path.join(shots, `upload-summary-${width}.png`) });
    const sent = await page.evaluate(() => window.__calls);
    const rows = sent.find(c => c.path.endsWith('/rows'));
    check(rows && rows.body.rows.length === 3 && rows.body.rows[0].phone === '9829012345' && sent.some(c => c.path.endsWith('/finish')), `${width}px: every row is sent, then the upload is finished`, rows);
    check(sent.filter(c => c.path === '/api/v1/lead-uploads' && c.method === 'POST').length === 1, `${width}px: one upload was started`);
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  for (const [who, label] of [[{ team: { id: 't2', name: 'Support', division: 'SUPPORT' } }, 'a Support member'], [{ department: { id: 'd9', name: 'Accounts', slug: 'accounts' } }, 'an Accounts member']]) {
    const page = await ctx.newPage();
    await page.goto(origin);
    await page.evaluate(w => window.mountPipeline(w), who);
    await page.getByRole('button', { name: 'Add lead' }).waitFor();
    check(await page.getByRole('button', { name: 'Upload Leads' }).count() === 0, `${label} has Add lead but no Upload Leads`);
    await page.close();
  }
  for (const [who, label] of [[{ role: 'TEAM_HEAD' }, 'a Sales Team Lead'], [{ role: 'DEPARTMENT_HEAD', team: null, headDivision: 'SALES' }, 'the Sales Department Head']]) {
    const page = await ctx.newPage();
    await page.goto(origin);
    await page.evaluate(w => window.mountPipeline(w), who);
    await page.getByRole('button', { name: 'Upload Leads' }).waitFor();
    check(true, `${label} gets Upload Leads`);
    await page.close();
  }
  const page = await ctx.newPage();
  await page.goto(origin);
  await page.evaluate(() => window.mountTelecaller());
  const add = page.getByRole('button', { name: 'Add Lead' }).first();
  const up = page.getByRole('button', { name: 'Upload Leads' });
  await up.waitFor();
  const [a, u] = [await add.boundingBox(), await up.boundingBox()];
  check(Math.abs(a.y - u.y) < 2 && Math.abs(a.height - u.height) < 2, 'Telecaller: Add Lead and Upload Leads side by side, the same height', { a, u });
  if (shots) await page.screenshot({ path: path.join(shots, 'telecaller-leads.png') });
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${passed} Upload Leads browser checks passed`);
