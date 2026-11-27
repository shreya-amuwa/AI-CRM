// The "Lead tags" page of the Managing Director and the CEOs, with a stubbed API: the list (chip, "Counts as", "Leads"), New tag, the
// stage-change warning, read-only rows, a FORBIDDEN answer shown inline, and no sideways scroll at 360px.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the lead tags browser test did not run'); process.exit(0); }
const stub = new URL('./ui/staff_forgot_stubs.ts', import.meta.url).pathname;
const built = await build({
  entryPoints: ['supabase/tests/ui/lead_tags_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({}) }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

const tag = (o) => ({ id: 't', label: 'Tag', colour: 'slate', stage: 'NEW', scope: 'COMPANY', departmentIds: [], retired: false, seed: false, leadCount: 0, canManage: true, ...o });
const TAGS = [
  tag({ id: 't1', label: 'Fresh', stage: 'NEW', seed: true, leadCount: 12 }),
  tag({ id: 't2', label: 'Called twice', colour: 'blue', stage: 'CONTACTED', scope: 'DEPARTMENTS', departmentIds: ['d-sales'], leadCount: 5 }),
  tag({ id: 't3', label: 'Company wide hot', colour: 'red', stage: 'READY_TO_BUY', leadCount: 3, canManage: false })
];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { success: true, data: body } : body) });

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const posts = [];
  let forbid = false;
  await page.route('**/lead-tags**', async r => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill(json(TAGS));
    const body = JSON.parse(req.postData() || '{}');
    posts.push({ url: req.url(), body });
    if (forbid) return r.fulfill(json({ success: false, error: { code: 'FORBIDDEN', message: "Only the Managing Director or the department's CEO can manage lead tags." } }, 403));
    return r.fulfill(json(tag({ id: 'new', ...body })));
  });
  await page.goto(base);
  await page.evaluate(() => window.mountMd());
  await page.getByText('Called twice').first().waitFor();
  const row = page.getByTestId('tag-row-t2');
  const text = await row.innerText();
  check(/Called twice/.test(text) && /Contacted/.test(text) && /5/.test(text), 'the page lists a tag with its chip, "Counts as" and "Leads"', text);
  check(await page.getByText('Counts as').first().isVisible() && await page.getByText('Leads', { exact: true }).first().isVisible(), 'the table has "Counts as" and "Leads" columns');
  check(await page.getByTestId('tag-edit-t3').count() === 0 && await page.getByTestId('tag-retire-t3').count() === 0, 'a row with canManage false has no edit or retire button');
  check(await page.getByTestId('tag-edit-t2').count() === 1 && await page.getByTestId('tag-retire-t2').count() === 1, 'a manageable row has edit and retire buttons');
  check(await page.getByTestId('tag-retire-t1').count() === 0, 'a basic (seed) tag cannot be retired');

  // New tag
  await page.getByRole('button', { name: 'New tag' }).click();
  await page.getByLabel('Label').fill('Follow up Friday');
  await page.getByTestId('colour-violet').click();
  await page.getByLabel('Counts as').selectOption('INTERESTED');
  await page.getByLabel('Sales One').check();
  await page.getByRole('button', { name: 'Save tag' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="tag-form"]'));
  check(posts.length === 1 && JSON.stringify(posts[0].body) === JSON.stringify({ label: 'Follow up Friday', colour: 'violet', stage: 'INTERESTED', departmentIds: ['d-sales'] }),
    '"New tag" posts {label, colour, stage, departmentIds}', posts);

  // Stage change warning
  await page.getByTestId('tag-edit-t2').click();
  check(await page.getByText(/This moves \d+ leads? to/).count() === 0, 'no warning while the stage is unchanged');
  await page.getByLabel('Counts as').selectOption('READY_TO_BUY');
  check(await page.getByText('This moves 5 leads to Ready to buy.').isVisible(), 'changing a stage shows "This moves N leads to <stage>." before saving');
  check(posts.length === 1, 'nothing is sent before Save');

  // FORBIDDEN inline
  forbid = true;
  await page.getByRole('button', { name: 'Save tag' }).click();
  await page.getByText("Only the Managing Director or the department's CEO can manage lead tags.").waitFor();
  check(await page.getByTestId('tag-form').isVisible() && await page.getByRole('alert').count() >= 1, 'a FORBIDDEN answer is shown inline, the page stays');
  forbid = false;
  await page.getByRole('button', { name: 'Cancel' }).click();

  // CEO: department list limited, company-wide not offered
  const p2 = await ctx.newPage();
  await p2.route('**/lead-tags**', r => r.fulfill(json(TAGS)));
  await p2.goto(base);
  await p2.evaluate(() => window.mountCeo());
  await p2.getByText('Called twice').first().waitFor();
  await p2.getByRole('button', { name: 'New tag' }).click();
  check(await p2.getByLabel('International').count() === 0 && await p2.getByLabel('Sales One').count() === 1, 'a CEO can only pick the departments they run');
  await p2.close();

  // 360px
  const m = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const p3 = await m.newPage();
  await p3.route('**/lead-tags**', r => r.fulfill(json(TAGS)));
  await p3.goto(base);
  await p3.evaluate(() => window.mountMd());
  await p3.getByTestId('tag-card-t2').waitFor();
  check(await p3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 360px (list)');
  await p3.getByRole('button', { name: 'New tag' }).click();
  await p3.getByTestId('tag-form').waitFor();
  check(await p3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 360px (form)');
  check(await p3.getByTestId('tag-card-t2').isVisible() && await p3.getByTestId('tag-row-t2').count() === 0, 'cards are shown below sm');
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== LEAD TAGS BROWSER TESTS PASSED (${passed}) ===`);
