// HR documents in a real browser against the local stack (Postgres + PostgREST + gateway + the web app):
//   an HR Admin Head picks an employee, sees the HR record's details, edits what may be edited, sees the server's PDF, generates it, downloads
//   it and finds it again; the NDA works the same way; an employee who has not left is blocked; the Offer Letter is filled from the record, its
//   wording can be edited for one letter, and a new master template version changes new letters but never one already issued; the sidebar's
//   Employee Letters section opens each letter.
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the dashboard browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3010', GW = process.env.E2E_GATEWAY || 'http://localhost:54410';
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
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const api = async (who, method, path, body) => {
  const r = await call(sign({ sub: who, role: 'authenticated' }), method, path, body);
  if (!r.json.success) throw new Error(`${method} ${path} ${JSON.stringify(r.json)}`);
  return r.json.data;
};

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/hr-documents-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m) => (c ? ok(m) : fail(m));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
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
  await p.waitForSelector(ready, { timeout: 25000 }).catch(() => fail(`${email} did not reach the expected dashboard (${ready})`));
  return p;
};
const navItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const menu = async (p, label) => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 350)); }
  await navItem(p, label).click();
};
const text = p => p.locator('main').innerText();
const num = s => Number(String(s).replace(/[^0-9.-]/g, ''));




import { PDFDocument, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';
import fs from 'node:fs';
const pdfText = async bytes => {
  const doc = await PDFDocument.load(bytes);
  let text = '';
  for (const page of doc.getPages()) {
    const c = page.node.Contents();
    for (const ref of (c instanceof PDFArray ? c.asArray() : [page.node.get(PDFName.of('Contents'))])) {
      const raw = Buffer.from(decodePDFRawStream(doc.context.lookup(ref)).decode()).toString('latin1');
      for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text += Buffer.from(m[1], 'hex').toString('latin1');
      for (const m of raw.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) text += m[1].replace(/\\(.)/g, '$1');
    }
  }
  return { pages: doc.getPageCount(), text: text.replace(/\s+/g, '') };
};
const previewBytes = async p => Buffer.from(await p.evaluate(async () => {
  const src = document.querySelector('iframe[title$="preview"]')?.getAttribute('src');
  if (!src) return [];
  return Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer()));
}));
const waitPreview = async (p, matcher, label) => {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const b = await previewBytes(p);
    if (b.length > 1000) { const t = await pdfText(b); if (matcher(t)) return t; }
    await p.waitForTimeout(400);
  }
  return fail(`the preview never showed: ${label}`);
};

// ------------------------------------------------------------------ fixture: an HR Admin Head and employee records
const root = await idOf('root@amuwa.com');
const hrDept = (await api(root, 'GET', '/departments')).find(d => d.slug === 'hr');
const hrPw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
await api(root, 'POST', '/users', { email: 'hr.head@amuwa.com', fullName: 'Payal HR', password: hrPw, role: 'DEPARTMENT_HEAD', departmentId: hrDept.id,
  details: { designation: 'HR Admin Head', joiningDate: '2026-01-05', dateOfBirth: '1990-05-06', bloodGroup: 'B+', contactNumber: '+91 91234 56789', emergencyContact: '+91 98765 43210' } });
PASSWORDS['hr.head@amuwa.com'] = hrPw;
const insert = (id, name, status, joining, left, designation) =>
  q(`insert into hr_employees (id, name, email, designation, department_id, status, joining_date, data) values ($1, $2, $3, $4, 'wabastore', $5, $6, $7::jsonb)`,
    [id, name, `${id.toLowerCase()}@example.com`, designation, status, joining, left ? JSON.stringify({ leftDate: left }) : '{}']);
await insert('E2E-PRIYA', 'Priya Sharma', 'Left', '2026-05-04', '2026-09-17', 'Business Development Executive');
await insert('E2E-RAHUL', 'Rahul Mehta', 'Left', '2023-02-13', '2025-12-31', 'Support Executive');
await insert('E2E-ANITA', 'Anita Working', 'Full-Time', '2024-01-08', null, 'Sales Executive');
const rowsOf = key => q(`select * from hr_documents where employee_key = $1 order by created_at`, [key]);
const today = (await q(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))[0].d;

const p = await login('hr.head@amuwa.com', { width: 1440, height: 900 }, '#app-sidebar');
await p.locator('#app-sidebar').getByText('Dashboard', { exact: true }).first().click();
await p.getByText('Experience Letter Management').first().click({ timeout: 15000 }).catch(() => fail('the Experience Letter Management card was not found'));
await p.waitForSelector('[data-testid="hr-doc-studio-EXPERIENCE"]', { timeout: 20000 }).catch(() => fail('the Experience Letter studio did not open'));
const studio = p.locator('[data-testid="hr-doc-studio-EXPERIENCE"]');
await expect(!/Rahul Deshmukh|Alexander Wright|AMU\/EXP/.test(await studio.innerText()), 'no sample data is shown');
const genBtn = studio.getByRole('button', { name: /Generate PDF/ });
const dlBtn = studio.getByRole('button', { name: 'Download PDF', exact: true });
const dlTop = studio.getByRole('button', { name: 'Download the PDF from the preview' });
const printBtn = studio.getByRole('button', { name: 'Print the preview' });
await expect(await genBtn.isDisabled() && await dlBtn.isDisabled() && await dlTop.isDisabled() && await printBtn.isDisabled(), 'Generate, Download and Print are off until an employee is chosen');

// ---- employee with the details on record
await studio.getByLabel('Employee *').selectOption('HR:E2E-PRIYA');
await studio.getByText('From the HR record').waitFor({ timeout: 20000 });
let rec = await studio.locator('[aria-label="From the HR record"]').innerText();
await expect(/E2E-PRIYA/.test(rec) && /04-05-2026/.test(rec) && /17-09-2026/.test(rec) && /4 months, 14 days/.test(rec) && /Left/.test(rec), 'the record\'s employee ID, joining date, last working date, status and the employment duration are shown');
await expect(await studio.getByLabel('Employee name *').inputValue() === 'Priya Sharma' && await studio.getByLabel('Designation *').inputValue() === 'Business Development Executive'
  && await studio.getByLabel('Last working date *').inputValue() === '2026-09-17' && await studio.getByLabel('Letter date *').inputValue() === today && await studio.getByLabel('Signed by *').inputValue() === 'Aarti Kalange', 'the form is filled from the record (name, designation, last working date, today, the template signatory)');
await expect(await studio.getByLabel('Date of joining').isDisabled(), 'the joining date is read-only (it comes from the record)');
await expect(await genBtn.isDisabled(), 'Generate stays off until the title is chosen');
await expect(/Choose Mr\./.test(await studio.innerText()), 'and says why');
await studio.getByLabel('Title *', { exact: true }).selectOption('Miss', { timeout: 8000 }).catch(() => fail('the Title field is not usable'));
let t = await waitPreview(p, x => x.text.includes('MissPriyaSharmawasemployed'), 'Miss Priya Sharma was employed');
await expect(t.pages === 1 && t.text.includes('04thMay2026') && t.text.includes('17thSeptember2026') && t.text.includes('BusinessDevelopmentExecutive') && t.text.includes('Duringhertenure') && t.text.includes('Date:' + today.split('-').reverse().join('/')),
  'the preview is the Experience Letter with the name, designation, dates, today\'s date and "her"');
await expect(await printBtn.isEnabled() && await dlTop.isEnabled(), 'Print and Download PDF are on once the preview is shown');
await p.screenshot({ path: `${OUT}/hrdoc-1-experience.png`, fullPage: true });

// ---- an edit is what the document shows
await studio.getByLabel('Designation *').fill('Senior Business Development Executive');
t = await waitPreview(p, x => x.text.includes('SeniorBusinessDevelopmentExecutive'), 'the edited designation');
await expect(true, 'an edited designation reaches the preview');
await studio.getByLabel('Last working date *').fill('2026-01-01');
await expect(/before the joining date/.test(await studio.innerText()) && await genBtn.isDisabled(), 'a last working date before the joining date is explained and cannot be generated');
await studio.getByLabel('Last working date *').fill('2026-09-17');
await studio.getByLabel('Employee name *').fill('Priya <b>Sharma');
await expect(/letters, spaces/.test(await studio.innerText()) && await genBtn.isDisabled(), 'a name with markup is explained and cannot be generated');
await studio.getByLabel('Employee name *').fill('Priya Sharma');
await waitPreview(p, x => x.text.includes('MissPriyaSharmawasemployed') && x.text.includes('SeniorBusiness'), 'the corrected form');

// ---- generate, then download
await genBtn.click();
await studio.getByText(/Saved to Priya Sharma's record/).waitFor({ timeout: 20000 }).catch(() => fail('generating did not finish'));
let docs = await rowsOf('HR:E2E-PRIYA');
await expect(docs.length === 1 && docs[0].doc_type === 'EXPERIENCE' && docs[0].employee_code === 'E2E-PRIYA' && docs[0].fields.designation === 'Senior Business Development Executive' && docs[0].fields.joiningDate === '2026-05-04', 'one document is stored against the employee (type, code, printed values, record joining date)');
const [download] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), dlBtn.click()]);
const file = `${OUT}/downloaded-priya.pdf`;
await download.saveAs(file);
const got = fs.readFileSync(file);
const gotText = await pdfText(got);
await expect(download.suggestedFilename() === `Experience-Letter-Priya-Sharma-${today}.pdf` && gotText.text.includes('MissPriyaSharmawasemployed') && gotText.text.includes('SeniorBusinessDevelopmentExecutive')
  && crypto.createHash('sha256').update(got).digest('hex') === docs[0].sha256, 'the downloaded PDF is the stored file: named after the employee, with the edits, and byte for byte the recorded one');
await expect(/Experience Letter/.test(await studio.getByText('Documents generated for Priya Sharma').locator('..').innerText()) && await studio.getByRole('button', { name: /Download Experience Letter of Priya Sharma/ }).count() === 1, 'the generated document is listed under the employee for later');
await p.screenshot({ path: `${OUT}/hrdoc-2-generated.png`, fullPage: true });

// ---- Download PDF from the preview after an edit: the edited letter is stored first (never the older file), then downloaded
await studio.getByLabel('Designation *').fill('Team Lead Business Development');
await waitPreview(p, x => x.text.includes('TeamLeadBusinessDevelopment'), 'the second edit');
await expect(!/Saved to Priya/.test(await studio.innerText()), 'after an edit the earlier file is no longer offered as the current one');
const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), dlTop.click()]);
await dl2.saveAs(`${OUT}/downloaded-priya-2.pdf`);
const t2 = await pdfText(fs.readFileSync(`${OUT}/downloaded-priya-2.pdf`));
docs = await rowsOf('HR:E2E-PRIYA');
await expect(t2.text.includes('TeamLeadBusinessDevelopment') && !t2.text.includes('SeniorBusiness') && docs.length === 2, 'Download PDF on the preview stores the edited letter and downloads exactly that one');
const [dl3] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), dlTop.click()]);
await dl3.saveAs(`${OUT}/downloaded-priya-3.pdf`);
await expect((await rowsOf('HR:E2E-PRIYA')).length === 2, 'downloading again does not store a duplicate');
await p.evaluate(() => { window.__printed = 0; const f = document.querySelector('iframe[title$="preview"]'); f.contentWindow.print = () => { window.__printed++; }; });
await printBtn.click();
await expect(await p.evaluate(() => window.__printed) === 1, 'Print prints the preview');

// ---- another employee: nothing carries over
await studio.getByLabel('Employee *').selectOption('HR:E2E-RAHUL');
await studio.locator('[aria-label="From the HR record"]').getByText('E2E-RAHUL').waitFor({ timeout: 20000 });
await expect(await studio.getByLabel('Employee name *').inputValue() === 'Rahul Mehta' && await studio.getByLabel('Designation *').inputValue() === 'Support Executive' && await studio.getByLabel('Title *', { exact: true }).inputValue() === ''
  && await studio.getByLabel('Last working date *').inputValue() === '2025-12-31', 'another employee loads their own details and the title is asked again');
await expect(/Documents generated for Rahul Mehta/.test(await studio.innerText()) && !/Priya/.test(await studio.locator('ul').last().innerText().catch(() => '')), 'and their list does not show Priya\'s document');
await studio.getByLabel('Title *', { exact: true }).selectOption('Mr.');
await studio.getByLabel('Letter date *').fill('2026-01-02');
t = await waitPreview(p, x => x.text.includes('Mr.RahulMehtawasemployed'), 'Mr. Rahul Mehta');
await expect(t.text.includes('13thFebruary2023') && t.text.includes('31stDecember2025') && t.text.includes('Duringhistenure') && !t.text.includes('Priya') && t.text.includes('Date:02/01/2026'), 'his letter has his own dates and "his", with nothing of Priya\'s');
await genBtn.click();
await studio.getByText(/Saved to Rahul Mehta's record/).waitFor({ timeout: 20000 });
await expect((await rowsOf('HR:E2E-RAHUL')).length === 1 && (await rowsOf('HR:E2E-PRIYA')).length === 2 && (await rowsOf('HR:E2E-PRIYA')).every(d => d.employee_key === 'HR:E2E-PRIYA'), 'each employee has exactly their own documents');

// ---- an employee who has not left
await studio.getByLabel('Employee *').selectOption('HR:E2E-ANITA');
await studio.getByText('This letter cannot be made yet').waitFor({ timeout: 20000 });
await expect(/Mark the employee as Left/.test(await studio.innerText()) && await genBtn.isDisabled() && !await studio.getByLabel('Designation *').count(), 'an employee who is still working cannot get an Experience Letter, and the form says what to do');

// ---- the NDA
await p.locator('main').getByRole('button', { name: 'NDA Letter' }).click();
const nda = p.locator('[data-testid="hr-doc-studio-NDA"]');
await nda.waitFor({ timeout: 20000 });
await nda.getByLabel('Employee *').selectOption('HR:E2E-ANITA');
await nda.getByLabel('Employee name (as printed) *').waitFor({ timeout: 20000 });
await expect(await nda.getByLabel('Agreement date *').inputValue() === today && await nda.getByLabel('Employee name (as printed) *').inputValue() === 'Anita Working', 'the NDA form is filled: today and the employee\'s name');
t = await waitPreview(p, x => x.text.includes('AnitaWorking') && x.text.includes('acknowledgeandacceptthesame'), 'the NDA with the name');
await expect(t.pages === 5 && t.text.includes('Date:' + today.split('-').reverse().join('-')) && !/Riddhi|Bhonka/i.test(t.text) && t.text.includes('ACKNOWLEDGETHAT'), 'the NDA preview is the five-page official template with the date and the name, and nothing of its sample');
await nda.getByLabel('Agreement date *').fill('2026-10-05');
await waitPreview(p, x => x.text.includes('Date:05-10-2026'), 'the edited agreement date');
await p.screenshot({ path: `${OUT}/hrdoc-3-nda.png`, fullPage: true });
await nda.getByRole('button', { name: /Generate PDF/ }).click();
await nda.getByText(/Saved to Anita Working's record/).waitFor({ timeout: 20000 }).catch(() => fail('the NDA was not generated'));
docs = await rowsOf('HR:E2E-ANITA');
await expect(docs.length === 1 && docs[0].doc_type === 'NDA' && docs[0].fields.letterDate === '2026-10-05', 'the NDA is stored against the employee');
const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), nda.getByRole('button', { name: /Download PDF/ }).click()]);
await d2.saveAs(`${OUT}/downloaded-nda.pdf`);
const nd = await pdfText(fs.readFileSync(`${OUT}/downloaded-nda.pdf`));
await expect(nd.pages === 5 && nd.text.includes('Date:05-10-2026') && nd.text.includes('AnitaWorking') && /^NDA-Anita-Working-2026-10-05\.pdf$/.test(d2.suggestedFilename()), 'the NDA downloads as the five-page file');

// ---- the Offer Letter: filled from the record, the wording edited for this letter only, generated and downloaded
await q(`update hr_employees set monthly_salary = '25000' where id = 'E2E-ANITA'`);
await p.locator('main').getByRole('button', { name: 'Offer Letter' }).click();
const off = p.locator('[data-testid="hr-doc-studio-OFFER"]');
await off.waitFor({ timeout: 20000 }).catch(() => fail('the Offer Letter studio did not open'));
await expect(!/Rahul Deshmukh|Compensation & Appointment|AMU\/OL/.test(await text(p)), 'the Offer Letter shows no sample data');
await off.getByLabel('Employee *').selectOption('HR:E2E-ANITA');
await off.getByLabel('Salary *').waitFor({ timeout: 20000 }).catch(() => fail('the Offer Letter form did not open'));
await expect(await off.getByLabel('Employee name *').inputValue() === 'Anita Working' && await off.getByLabel('Designation *').inputValue() === 'Sales Executive'
  && await off.getByLabel('Date of joining *').inputValue() === '2024-01-08' && await off.getByLabel('Salary *').inputValue() === '₹25,000/- per month'
  && await off.getByLabel('Employment type *').inputValue() === 'Full-Time' && await off.getByLabel('Letter date *').inputValue() === today && await off.getByLabel('Signed by *').inputValue() === 'Miss Aarti Kalange',
  'the Offer Letter form is filled from the HR record (name, designation, joining date, salary) with the letter\'s usual terms');
await off.getByLabel('Reporting to *').fill('');
await expect(await off.getByRole('button', { name: /Generate PDF/ }).isDisabled(), 'a missing reporting manager blocks generating');
await off.getByLabel('Reporting to *').fill('Team Leader');
t = await waitPreview(p, x => x.text.includes('AnitaWorking') && x.text.includes('08thJanuary2024'), 'the Offer Letter with the record values');
await expect(t.pages <= 2 && t.text.includes('SalesExecutive') && t.text.includes('25,000/-permonth') && t.text.includes('ReportingTo:TeamLeader') && !t.text.includes('{') && !/Lokesh|Patil/.test(t.text),
  'the Offer Letter preview has the employee\'s values on the letterhead and nothing of the sample');
await off.getByText("Edit the letter's wording").click();
await off.getByLabel('Sign-off').fill('Yours sincerely, Amuwa Corporation,');
t = await waitPreview(p, x => x.text.includes('Yourssincerely,AmuwaCorporation,'), 'the edited sign-off');
await expect(/Edited for this letter/.test(await off.innerText()), 'the form says the wording was edited for this letter');
await p.screenshot({ path: `${OUT}/hrdoc-5-offer.png`, fullPage: true });
await off.getByRole('button', { name: /Generate PDF/ }).click();
await off.getByText(/Saved to Anita Working's record/).waitFor({ timeout: 20000 }).catch(() => fail('the Offer Letter was not generated'));
let offerRow = (await rowsOf('HR:E2E-ANITA')).find(d => d.doc_type === 'OFFER');
await expect(offerRow && offerRow.fields.templateVersion === 1 && offerRow.fields.content.signOff === 'Yours sincerely, Amuwa Corporation,' && offerRow.fields.salary === '₹25,000/- per month',
  'the Offer Letter is stored against the employee with its wording and template version');
const [d3] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), off.getByRole('button', { name: 'Download PDF', exact: true }).click()]);
await d3.saveAs(`${OUT}/downloaded-offer.pdf`);
const od = await pdfText(fs.readFileSync(`${OUT}/downloaded-offer.pdf`));
await expect(d3.suggestedFilename() === `Offer-Letter-Anita-Working-${today}.pdf` && od.text.includes('Yourssincerely,AmuwaCorporation,') && od.text.includes('AnitaWorking'), 'the Offer Letter downloads as the stored file');
await expect(/Issued · template v1/.test(await off.innerText()) && /Offer Letter/.test(await off.getByText('Documents generated for Anita Working').locator('..').innerText()), 'the history lists the issued Offer Letter with its template version');
const tplBefore = (await q(`select count(*)::int as n from hr_letter_templates where doc_type = 'OFFER'`))[0].n;
await expect(tplBefore === 1, 'editing one letter did not change the master template');

// ---- the master template: a new version for new letters; the issued letter keeps its wording
await p.locator('main').getByRole('button', { name: 'Master template', exact: true }).click();
const tpl = p.locator('[data-testid="template-manager-OFFER"]');
await tpl.waitFor({ timeout: 20000 }).catch(() => fail('the master template did not open'));
await expect(/Current version v1/.test(await tpl.innerText()), 'the master template shows version 1');
await tpl.getByLabel('Sign-off').fill('Regards, Amuwa Corporation,');
await tpl.getByLabel('What changed (optional)').fill('New sign-off');
await tpl.getByRole('button', { name: 'Save as version 2' }).click();
await tpl.getByText('Current version').filter({ hasText: 'v2' }).waitFor({ timeout: 20000 }).catch(() => fail('version 2 was not saved'));
await expect(/New sign-off/.test(await tpl.innerText()), 'version 2 is saved and listed with its note');
await tpl.getByRole('button', { name: 'View version 1' }).click();
await expect(await tpl.locator('[data-testid="template-version-view"]').getByLabel('Sign-off').inputValue() === 'For Amuwa Corporation,', 'version 1 stays readable, unchanged');
await p.screenshot({ path: `${OUT}/hrdoc-6-template.png`, fullPage: true });
offerRow = (await q(`select fields from hr_documents where id = $1`, [offerRow.id]))[0];
await expect(offerRow.fields.content.signOff === 'Yours sincerely, Amuwa Corporation,' && offerRow.fields.templateVersion === 1, 'the issued Offer Letter keeps its own wording after the master changes');
await p.locator('main').getByRole('button', { name: 'Generate & issue', exact: true }).click();
const off2 = p.locator('[data-testid="hr-doc-studio-OFFER"]');
await off2.getByLabel('Employee *').selectOption('HR:E2E-ANITA');
await off2.getByLabel('Reporting to *').waitFor({ timeout: 20000 });
await off2.getByLabel('Reporting to *').fill('Team Leader');
await waitPreview(p, x => x.text.includes('Regards,AmuwaCorporation,') && x.text.includes('AnitaWorking'), 'a new letter with version 2');
await expect(/Master template v2/.test(await off2.innerText()), 'a new letter starts from version 2');

// ---- the sidebar: Employee Letters
const side = p.locator('#app-sidebar');
await expect(/Employee Letters/i.test(await side.innerText()), 'the HR menu has an Employee Letters section');
await side.getByRole('button', { name: 'Experience Letter', exact: true }).click();
await p.locator('[data-testid="hr-doc-studio-EXPERIENCE"]').waitFor({ timeout: 20000 }).catch(() => fail('Experience Letter in the menu did not open the letter'));
await side.getByRole('button', { name: 'NDA Letter', exact: true }).click();
await p.locator('[data-testid="hr-doc-studio-NDA"]').waitFor({ timeout: 20000 }).catch(() => fail('NDA Letter in the menu did not open the letter'));
await side.getByRole('button', { name: 'Offer Letter', exact: true }).click();
await p.locator('[data-testid="hr-doc-studio-OFFER"]').waitFor({ timeout: 20000 }).catch(() => fail('Offer Letter in the menu did not open the letter'));
await expect(true, 'NDA, Offer and Experience Letter in the menu each open their letter');

// ---- someone who is not HR staff
const neha = await idOf('neha@amuwa.com');
const denied = await call(sign({ sub: neha, role: 'authenticated' }), 'GET', '/hr/documents');
await expect(denied.status === 403, 'a sales member is refused by the API (403)');

// ---- a phone: nothing overflows sideways
await p.setViewportSize({ width: 390, height: 800 });
await p.locator('main').getByRole('button', { name: 'Experience Letter' }).click();
await p.locator('[data-testid="hr-doc-studio-EXPERIENCE"]').waitFor();
await expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'a phone: the page does not scroll sideways');
await p.screenshot({ path: `${OUT}/hrdoc-4-phone.png` });
await expect(!errors.length, 'no page or console errors', errors);
console.log(`=== ALL HR DOCUMENT BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
process.exit(0);
