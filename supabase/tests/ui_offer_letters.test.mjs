// Browser test of HR > Offer Letter Generation (role-based templates, migration 20270206000100): the dropdown "Select Employee Designation / Offer
// Letter Template" lists the five designations; choosing one loads its own fields (Technical Support has no title or reference, Customer Support
// asks for the title, Business Development Executive for the reference number) with the sample's own values and the employee's record; every
// field is editable and the live preview is re-requested after an edit; Generate stores the letter, Download / Regenerate work; Templates lists
// the five designations and the HR Admin Head saves a new version (the request names the version it replaces); an HR team member only views.
// Real React components, real Chromium; the CRM API is answered by the test (the server, database and PDFs are tested in the API test).
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Offer Letter browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'offer-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/offer_letters_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty' },
  plugins: [{ name: 'stubs', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/hr_awards_stubs.ts') })); } }]
});
const shared = path.join(work, 'offerTemplates.mjs');
await build({ entryPoints: ['shared/offerTemplates.ts'], bundle: true, format: 'esm', platform: 'node', outfile: shared, logLevel: 'error' });
const { INITIAL_OFFER_TEMPLATES } = await import(pathToFileURL(shared).href);
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

// --- the fake API
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const templates = INITIAL_OFFER_TEMPLATES.map((t, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`, key: t.key, designation: t.designation, description: t.description, sortOrder: t.sortOrder, active: true,
  updatedAt: '2026-11-24T00:00:00Z', versionCount: 1, issued: 0,
  current: { templateId: `00000000-0000-4000-8000-00000000000${i + 1}`, version: 1, letterhead: t.letterhead, sampleFile: null, letterheadFile: null, note: 'The supplied sample',
    createdBy: 'HR', createdAt: '2026-11-24T00:00:00Z', content: t.content }
}));
const calls = [];
let canManage = true;
let docs = [];
const ok = data => ({ status: 200, body: { success: true, data } });
function handle(method, url, body) {
  const p = url.pathname.replace(/^\/api\/v1/, '');
  calls.push({ method, path: p, body });
  if (p === '/hr/offer-templates' && method === 'GET') return ok({ canManage, templates });
  if (p === '/hr/offer-templates/letterheads') return ok(INITIAL_OFFER_TEMPLATES.map(t => ({ key: t.letterhead.builtin, label: `${t.designation} letterhead` })));
  if (p === '/hr/offer-templates/preview') return ok({ fileName: 'Template.pdf', pdfBase64: PDF });
  let m;
  if ((m = p.match(/^\/hr\/offer-templates\/([^/]+)$/)) && method === 'GET') {
    const t = templates.find(x => x.id === m[1]);
    return ok({ ...t, versions: [{ ...t.current, content: undefined, issued: 0 }] });
  }
  if ((m = p.match(/^\/hr\/offer-templates\/([^/]+)$/)) && method === 'POST') {
    const t = templates.find(x => x.id === m[1]);
    t.current = { ...t.current, version: t.current.version + 1, content: body.content, note: body.note };
    t.versionCount++;
    return { status: 201, body: { success: true, data: t } };
  }
  if (p === '/hr/documents/prefill') return ok({ employee: { key: url.searchParams.get('employeeKey'), code: 'HR-1', name: 'Ritika Offer', email: 'r@example.com', department: 'Wabastore',
    designation: 'Executive', joiningDate: '2026-12-01', lastWorkingDate: null, status: 'Full-Time', separated: false, monthlySalary: '18000', workingHours: null }, problems: [], ready: true, today: '2026-11-24', template: null, signatory: { name: 'x', title: 'y' } });
  if (p === '/hr/documents/preview') return ok({ fileName: 'Offer.pdf', pdfBase64: PDF });
  if (p === '/hr/documents' && method === 'POST') {
    const t = templates.find(x => x.id === body.fields.offerTemplateId);
    const d = { id: `00000000-0000-4000-9000-00000000000${docs.length + 1}`, type: 'OFFER', employeeKey: body.employeeKey, employeeCode: 'HR-1', employeeName: 'Ritika Offer',
      fileName: `Offer-Letter-${docs.length + 1}.pdf`, sizeBytes: 1000, fields: { templateDesignation: t.designation, templateVersion: body.fields.templateVersion }, generatedBy: 'HR', createdAt: new Date().toISOString() };
    docs = [d, ...docs];
    return { status: 201, body: { success: true, data: d } };
  }
  if (p === '/hr/documents' && method === 'GET') return ok(docs);
  if ((m = p.match(/^\/hr\/documents\/([^/]+)\/download$/))) return ok({ fileName: 'Offer.pdf', url: 'http://offer.test/file.pdf' });
  return ok([]);
}

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
const open = async (viewport = { width: 1366, height: 900 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://offer.test/api/v1/**', async route => {
    const req = route.request();
    const r = handle(req.method(), new URL(req.url()), req.postData() ? JSON.parse(req.postData()) : undefined);
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  await page.route('http://offer.test/file.pdf', route => route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(PDF, 'base64') }));
  await page.route('http://offer.test/', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://offer.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.mount());
  return page;
};
const fieldLabels = page => page.getByTestId('offer-fields').locator('label').evaluateAll(ls => ls.map(l => (l.childNodes[0]?.textContent ?? '').trim()));
const previewsFor = id => calls.filter(c => c.path === '/hr/documents/preview' && c.body?.fields?.offerTemplateId === id);

try {
  let page = await open();
  const select = page.getByLabel('Select Employee Designation / Offer Letter Template');
  await select.waitFor();
  const options = await select.locator('option').allInnerTexts();
  check(JSON.stringify(options.slice(1)) === JSON.stringify(['Technical Support', 'Customer Support', 'Business Development Executive', 'Sales Executive', 'AI Developer']),
    'the dropdown lists the five designations', options);

  // Technical Support: its own fields, the sample's values, the employee's record
  await select.selectOption({ label: 'Technical Support' });
  await page.getByLabel('Employee *').selectOption({ label: 'Ritika Offer – Executive' });
  await page.getByLabel(/^Employee name/).waitFor();
  await page.waitForFunction(() => document.querySelector('#offer-field-employeeName')?.value === 'Ritika Offer');
  let labels = await fieldLabels(page);
  check(labels.includes('Designation') && labels.includes('Reporting to') && labels.includes('Salary per month (₹)') && !labels.includes('Title') && !labels.includes('Reference number'),
    'Technical Support loads its own fields', labels);
  check(await page.locator('#offer-field-designation').inputValue() === 'Technical Support Executive' && await page.locator('#offer-field-reportingTo').inputValue() === 'Team Leader'
    && await page.locator('#offer-field-salary').inputValue() === '18000' && await page.locator('#offer-field-department').inputValue() === 'Wabastore'
    && await page.locator('#offer-field-joiningDate').inputValue() === '2026-12-01', 'the sample\'s values and the employee\'s record fill the fields');
  check(await page.getByTestId('offer-template-info').innerText().then(t => /template version 1/.test(t)), 'the template version is shown');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="offer-preview-frame"]'));
  const tech = templates[0];
  check(previewsFor(tech.id).length >= 1 && previewsFor(tech.id).at(-1).body.fields.values.salary === '18000', 'the live preview is the server\'s PDF of these values');
  const before = previewsFor(tech.id).length;
  await page.locator('#offer-field-salary').fill('21000');
  await page.waitForFunction(n => window.__n === undefined, before);
  await page.waitForTimeout(900);
  check(previewsFor(tech.id).length > before && previewsFor(tech.id).at(-1).body.fields.values.salary === '21000', 'editing a field updates the preview');
  await page.locator('#offer-field-salary').fill('21000.5');
  await page.getByText(/whole rupees/).first().waitFor();
  check(true, 'a wrong amount is explained at the field');
  await page.locator('#offer-field-salary').fill('21000');

  // generate, download, regenerate
  await page.getByRole('button', { name: 'Generate Offer Letter' }).click();
  await page.getByText(/Stored on Ritika Offer/).waitFor();
  const gen = calls.filter(c => c.path === '/hr/documents' && c.method === 'POST');
  check(gen.length === 1 && gen[0].body.type === 'OFFER' && gen[0].body.fields.offerTemplateId === tech.id && gen[0].body.fields.templateVersion === 1
    && gen[0].body.fields.values.salary === '21000' && !('content' in gen[0].body.fields), 'Generate stores the letter: the template, its version and the values (never the wording)');
  check(await page.getByRole('button', { name: 'Generated' }).isDisabled(), 'the same letter is not stored twice by a second click');
  await page.getByText('Offer letters issued to this employee').waitFor();
  check(await page.getByText(/Technical Support · template v1/).isVisible(), 'the employee\'s issued offer letters list the designation and version');
  await page.getByRole('button', { name: 'Regenerate Document' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Offer-Letter-2.pdf'));
  check(calls.filter(c => c.path === '/hr/documents' && c.method === 'POST').length === 2, 'Regenerate stores a new copy (the earlier one is kept)');
  await page.getByRole('button', { name: 'Download as PDF' }).click();
  await page.waitForTimeout(300);
  check(calls.some(c => /\/hr\/documents\/[^/]+\/download$/.test(c.path)), 'Download as PDF downloads the stored letter');
  await page.getByRole('button', { name: 'Edit Details' }).click();
  check(await page.evaluate(() => document.activeElement?.id) === 'offer-field-letterDate', 'Edit Details goes back to the fields');

  // Customer Support: the title (no guess), the name kept
  await select.selectOption({ label: 'Customer Support' });
  await page.locator('#offer-field-title').waitFor();
  labels = await fieldLabels(page);
  check(labels.includes('Title') && labels.includes('Signatory (Annexure A)') && !labels.includes('Reporting to') && !labels.includes('Reference number'),
    'Customer Support loads its own fields (the appointment letter)', labels);
  check(await page.locator('#offer-field-title').inputValue() === '' && await page.locator('#offer-field-designation').inputValue() === 'Customer Support Executive'
    && await page.locator('#offer-field-employeeName').inputValue() === 'Ritika Offer', 'the title is not guessed; the designation is the sample\'s; the name is kept');
  check(await page.getByText(/Complete the details to see the letter/).isVisible(), 'without the title there is no preview yet');
  await page.locator('#offer-field-title').selectOption('Ms.');
  await page.waitForTimeout(900);
  check(previewsFor(templates[1].id).at(-1)?.body.fields.values.title === 'Ms.', 'with the title the Customer Support letter previews');

  // Business Development Executive: the reference number
  await select.selectOption({ label: 'Business Development Executive' });
  await page.locator('#offer-field-refNo').waitFor();
  check(await page.locator('#offer-field-signatoryName').inputValue() === 'Reshma Wadhavane (CEO)' && await page.locator('#offer-field-designation').inputValue() === 'Business Development Executive',
    'Business Development Executive asks for the reference number and has its own signatory');
  for (const [label, designation] of [['Sales Executive', 'Sales Executive'], ['AI Developer', 'Ai Developer Intern']]) {
    await select.selectOption({ label });
    await page.waitForFunction(d => document.querySelector('#offer-field-designation')?.value === d, designation);
    check(true, `${label} loads its own designation ("${designation}")`);
  }
  check(await page.locator('#offer-field-department').inputValue() === 'Ai Studio', 'AI Developer keeps the sample\'s department (Ai Studio)');

  // Templates
  await page.getByRole('tab', { name: 'Templates by designation' }).click();
  await page.getByRole('list', { name: 'Offer letter templates' }).waitFor();
  check((await page.getByRole('list', { name: 'Offer letter templates' }).locator('> li').count()) === 5, 'Templates lists the five designations');
  await page.getByRole('button', { name: 'Manage the Sales Executive template' }).click();
  const markup = page.locator('#tpl-markup');
  await markup.waitFor();
  check((await markup.inputValue()).startsWith('= OFFER LETTER') && (await markup.inputValue()).includes('assigned territory'), 'the Sales Executive wording opens in the editor');
  await markup.fill((await markup.inputValue()).replace('Comply with all company policies', 'Comply with every company policy'));
  await page.getByLabel(/What changed/).fill('Updated responsibilities');
  await page.getByRole('button', { name: 'Save as version 2' }).click();
  await page.getByRole('button', { name: 'Save as version 3' }).waitFor();
  const save = calls.filter(c => /^\/hr\/offer-templates\/[^/]+$/.test(c.path) && c.method === 'POST').at(-1);
  check(save.body.baseVersion === 1 && save.body.designation === 'Sales Executive' && JSON.stringify(save.body.content).includes('Comply with every company policy') && save.body.note === 'Updated responsibilities',
    'the HR Admin Head saves version 2 (naming the version it replaces)');
  await markup.fill((await markup.inputValue()) + '\nBonus {bonus}');
  await page.getByText(/\{bonus\}, which is not a field/).waitFor();
  check(await page.getByRole('button', { name: 'Save as version 3' }).isDisabled(), 'a placeholder that is not a field blocks saving, with the reason');
  await page.close();

  // an HR team member: views only
  canManage = false;
  page = await open();
  await page.getByRole('tab', { name: 'Templates by designation' }).click();
  await page.getByRole('button', { name: 'View the Technical Support template' }).click();
  await page.locator('#tpl-markup').waitFor();
  check(await page.locator('#tpl-markup').isDisabled() && !(await page.getByRole('button', { name: /Save as version/ }).count()) && !(await page.getByRole('button', { name: /Add designation template/ }).count()),
    'an HR team member views templates but cannot change them');
  await page.close();

  // phone width
  page = await open({ width: 390, height: 844 });
  await page.getByLabel('Select Employee Designation / Offer Letter Template').selectOption({ label: 'Customer Support' });
  await page.locator('#offer-field-title').waitFor();
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1)
    .slice(0, 5).map(e => `${e.tagName}.${String(e.className).slice(0, 60)} ${Math.round(e.getBoundingClientRect().right)}`));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone', wide);
  await page.close();
  check(!errors.length, 'no page errors', errors);
  console.log(`=== ${passed} OFFER LETTER BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
}
