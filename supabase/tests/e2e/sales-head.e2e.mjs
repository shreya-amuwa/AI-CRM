// The Sales Department Head dashboard in real browsers against the local stack (Postgres + PostgREST + gateway + the web app):
//   - the Sales head opens their own dashboard with the menu in the agreed order; the Support head keeps the Department Head dashboard
//   - Lead Assign: an Excel sheet is read, the columns matched, rows checked (invalid / duplicate listed), confirmed and given to the Telecaller, who sees the contacts
//   - Sheet Upload (its own menu entry, the same upload): real .xlsx, .xls and .csv files given to a Sales Team Member and the Team Lead as leads
//     in their pipeline, the upload history with its status and failed rows, and the leads in the member's and the Team Lead's own dashboards
//   - Lead List (filters, search, detail, an unassigned enquiry), Daily Tasks, Performance, Reports (Team Lead / Team Member), Income, Notices, Team, Chat, Notifications
//   - nothing of the Support team is shown, and a phone-sized window has no sideways scrolling
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import JSZip from 'jszip';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Sales Department Head browser test did not run'); process.exit(0); }

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
  await current?.screenshot({ path: `${OUT}/sales-head-fail.png`, fullPage: true }).catch(() => {});
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

// A minimal .xlsx (a real zip) with the given rows, written for the test.
const xlsx = async (rows, name) => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cell = (v, r, c) => {
    const ref = String.fromCharCode(65 + c) + (r + 1);
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : v === null || v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  };
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', sheet);
  const path = `${OUT}/${name}`;
  fs.writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
};

// ------------------------------------------------------------------ fixture (made through the API, as the Super Admin)
const root = await idOf('root@amuwa.com');
const wab = (await api(root, 'GET', '/departments')).find(d => d.slug === 'wabastore');
const teams = await api(root, 'GET', `/teams?departmentId=${wab.id}`);
const salesTeam = teams.find(t => t.name === 'Sales');
const delivery = teams.find(t => t.name === 'Delivery');
const mk = async (email, fullName, extra) => {
  const pw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
  PASSWORDS[email] = pw;
  return api(root, 'POST', '/users', { email, fullName, password: pw, ...extra });
};
const head = await mk('sales.head@amuwa.com', 'Sana Sales-Head', { role: 'DEPARTMENT_HEAD', departmentId: wab.id, headDivision: 'SALES' });
await mk('apurva.tele@amuwa.com', 'Apurva Telecaller', { role: 'TEAM_MEMBER', teamId: salesTeam.id, salesSubRole: 'TELECALLER' });
// Support data that must never show up on the Sales dashboard
const supportOwner = await idOf('tm.delivery@amuwa.com');
await db.query(`insert into customers (owner_id, name, phone, email, lifecycle_stage, lead_temperature) values ($1, 'Support Only Customer', '+919000000001', 'support.only@example.com', 'CUSTOMER', null)`, [supportOwner]);
await db.query(`insert into crm_leads (id, name, phone, department, sub_department) values ('e2e-inbound-1', 'Inbound Ivan', '+919000000077', 'wabastore', 'sales')`);
const rahul = await idOf('rahul@amuwa.com');
await db.query(`insert into customers (owner_id, name, phone, email, lifecycle_stage, lead_temperature, call_status, lead_source) values ($1, 'Existing Hot Lead', '+919000000010', 'hot.lead@example.com', 'LEAD', 'HOT', 'INTERESTED', 'Website'), ($1, 'Existing Cold Lead', '+919000000011', null, 'LEAD', 'COLD', 'PENDING', 'Referral')`, [rahul]);
const headRow = (await q(`select default_dashboard, head_division from profiles where email = 'sales.head@amuwa.com'`))[0];
await expect(headRow.default_dashboard === 'sales-department-head' && headRow.head_division === 'SALES', 'fixture: a Sales Department Head, a Telecaller, Support data and an unassigned enquiry', headRow);

// ------------------------------------------------------------------ 1. routing and the menu
const sh = await login('sales.head@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await sh.waitForURL(/\/sales-head\/dashboard\//, { timeout: 15000 }).catch(() => fail('the Sales head did not land on /sales-head/dashboard/…: ' + sh.url()));
ok('the Sales Department Head opens the Sales Department Head dashboard');
let labels = await menuLabels(sh);
const expectedTop = ['Attendance', 'Overview', 'Leads', 'Sheet Upload', 'My Leads', 'Field Visits', 'Assign Task', 'Daily Tasks', 'Performance Management', 'Top Performers & Rankings', 'Department Income', 'Sales Reports', 'Daily Reports', 'Telecaller Sheets', 'Service Prices', 'Client Notices', 'Team Members & Access', 'Raise an Issue', 'Chat', 'Notification Center'];
await expect(JSON.stringify(labels.filter(l => expectedTop.includes(l))) === JSON.stringify(expectedTop) && labels.length === expectedTop.length, 'the menu is in the agreed order', labels);
await sh.locator('aside nav button').filter({ hasText: /^\s*Leads\s*$/ }).first().click();
labels = await menuLabels(sh);
const li = labels.indexOf('Leads');
await expect(labels[li + 1] === 'Lead List' && labels[li + 2] === 'Lead Assign' && labels[li + 3] === 'Sheet Upload', 'Leads opens Lead List and Lead Assign; Sheet Upload follows', labels);
await expect(/Sales overview/i.test(await text(sh)), 'Overview is the first page');
await sh.screenshot({ path: `${OUT}/sh-1-overview.png`, fullPage: true });

const dhPage = await login('dh@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
const dhLabels = await menuLabels(dhPage);
await expect(dhLabels.includes('Assign') && dhLabels.includes('Team Activity') && !dhLabels.includes('Lead Assign') && !dhLabels.includes('Leads'), 'the Support Department Head keeps the Department Head dashboard, unchanged', dhLabels);
await dhPage.goto(BASE + `/sales-head/dashboard/${head.id}`);
await until(async () => !/\/sales-head\//.test(dhPage.url())) || await fail('the Support head could open the Sales head URL: ' + dhPage.url());
await dhPage.locator('aside nav button').first().waitFor({ timeout: 15000 });
const dhAgain = await menuLabels(dhPage);
await expect(!/\/sales-head\//.test(dhPage.url()) && dhAgain.includes('Assign') && !dhAgain.includes('Lead Assign'), 'and cannot open the Sales Department Head URL (sent back to their own dashboard)', { url: dhPage.url(), dhAgain });
await dhPage.context().close();

// ------------------------------------------------------------------ 2. Overview
const total = (await q(`select count(*)::int n from customers c join teams t on t.id = c.team_id where t.division = 'SALES' and c.lifecycle_stage = 'LEAD'`))[0].n;
await page(sh, 'Overview');
await sh.getByTestId('stat-total-leads').waitFor({ timeout: 15000 });
const shown = Number(await sh.getByTestId('stat-total-leads').innerText());
await expect(shown >= total + 1 && Number(await sh.getByTestId('stat-hot-leads').innerText()) >= 1, 'Overview: the numbers come from the Sales records (leads and the unassigned enquiry)', { shown, total });
await expect(!/Support Only|Delivery|Mohan Member|Dina Delivery/.test(await text(sh)), 'Overview: nothing from the Support team');
await expect(Number(await sh.getByTestId('stat-pending-assignment').innerText()) >= 1, 'Overview: the unassigned enquiry is counted as pending assignment');

// ------------------------------------------------------------------ 3. Lead Assign: the sheet goes to the Telecaller
await page(sh, 'Lead Assign');
await sh.locator('#la-assignee').waitFor({ timeout: 15000 });
const options = await sh.locator('#la-assignee option').allInnerTexts();
await expect(['Apurva Telecaller', 'Rahul Mehta', 'Neha Shah', 'Lead Person'].every(n => options.some(o => o.includes(n))) && !options.some(o => /Mohan|Rina|Dina|Tara Consultant/.test(o)),
  'Lead Assign: the Sales Telecaller, Team Members and Team Lead can be chosen (no Support person)', options);
const apurva = await idOf('apurva.tele@amuwa.com');
await sh.locator('#la-assignee').selectOption(apurva);
const sheet = await xlsx([
  ['Party', 'Company Name', 'Mobile', 'E-mail', 'Notes'],
  ['Anil Kumar', 'Kumar Traders', 9811200001, 'anil@kumar.example', 'Met at stall'],
  ['Bina Shah', '', '9811200002', '', ''],
  ['', 'No Name Co', '9811200003', '', ''],
  ['Bad Phone', '', 'abc', '', ''],
  ['Anil Again', '', '98112 00001', '', ''],
  ['Existing Hot Lead', '', '+919000000010', '', '']
], 'fair.xlsx');
await sh.locator('#la-file').setInputFiles(sheet);
await sh.getByText('Column mapping').first().waitFor({ timeout: 15000 });
await expect(/choose a column for Contact Name/.test(await sh.locator('summary').first().innerText()), 'Lead Assign: an unknown heading ("Party") is reported so it can be mapped');
await sh.getByLabel('Column for Contact Name').selectOption({ label: 'Party' });
await sh.getByTestId('preview-valid').waitFor({ timeout: 15000 });
await expect((await sh.getByTestId('preview-valid').innerText()) === '2' && (await sh.getByTestId('preview-invalid').innerText()) === '2' && (await sh.getByTestId('preview-duplicates').innerText()) === '2', 'Lead Assign: the preview counts valid, invalid and duplicate rows');
const body = await text(sh);
await expect(/Row 4 \(invalid\)/.test(body) && /Row 5 \(invalid\)/.test(body) && /Row 6 \(duplicate\)/.test(body) && /Row 7 \(duplicate\)/.test(body) && /already in the CRM/.test(body), 'Lead Assign: every problem row is listed with its reason');
await expect((await q(`select count(*)::int n from telecaller_contacts where assigned_to = $1`, [apurva]))[0].n === 0, 'Lead Assign: the preview saved nothing');
await sh.screenshot({ path: `${OUT}/sh-2-lead-assign-preview.png`, fullPage: true });
await sh.getByRole('button', { name: /Review and give 2 contacts to Apurva Telecaller/ }).click();
await expect((await sh.getByTestId('confirm-name').innerText()) === 'Apurva Telecaller' && /Telecaller/.test(await sh.getByTestId('confirm-role').innerText()), 'Lead Assign: the confirmation names the Telecaller');
await sh.getByRole('button', { name: 'Confirm and assign' }).click();
await until(async () => (await q(`select 1 from sales_lead_sheets where file_name = 'fair.xlsx'`)).length);
const given = await q(`select name, call_status from telecaller_contacts where assigned_to = $1 order by name`, [apurva]);
await expect(given.length === 2 && given.every(c => c.call_status === 'PENDING') && given[0].name === 'Anil Kumar', 'Lead Assign: the two valid contacts are in the Telecaller\'s list, still to call', given);
await expect((await q(`select count(*)::int n from customers where name in ('Anil Kumar', 'Bina Shah')`))[0].n === 0, 'Lead Assign: no lead is made behind the Telecaller\'s back');
await sh.getByText(/2 contacts from fair.xlsx were given to Apurva Telecaller/).waitFor({ timeout: 15000 }).catch(() => fail('no success message'));
const hist = (await q(`select s.uploaded_by, s.valid_count, s.invalid_count, s.duplicate_count, s.mode, p.email from sales_lead_sheets s join profiles p on p.id = s.uploaded_by where file_name = 'fair.xlsx'`))[0];
await expect(hist.email === 'sales.head@amuwa.com' && hist.valid_count === 2 && hist.invalid_count === 2 && hist.duplicate_count === 2 && hist.mode === 'TELECALLER', 'Lead Assign: the upload is recorded with who uploaded it and the counts', hist);
await expect(/fair\.xlsx/.test(await text(sh)) && /Sana Sales-Head/.test(await text(sh)) && /2 to call/.test(await text(sh)), 'Lead Assign: the history lists the sheet, who uploaded it and what is still to call');
// the same file again
await sh.locator('#la-file').setInputFiles(sheet);
await sh.getByLabel('Column for Contact Name').selectOption({ label: 'Party' });
await sh.getByTestId('preview-valid').waitFor({ timeout: 15000 });
await expect(/already been uploaded and assigned/.test(await text(sh)) && await sh.getByRole('button', { name: /Review and give/ }).isDisabled(), 'Lead Assign: the same file cannot be imported twice');
await sh.getByRole('button', { name: 'Cancel' }).click();
// an old .xls file
fs.writeFileSync(`${OUT}/old.xls`, 'x');
await sh.locator('#la-file').setInputFiles(`${OUT}/old.xls`);
await sh.getByText(/Choose an Excel \(\.xlsx, \.xls\) or CSV file/).first().waitFor({ timeout: 10000 }).catch(() => fail('a file named .xls that is no workbook was not refused'));
ok('Lead Assign: a file named .xls that is no workbook is refused with what to do');
// the Telecaller sees the contacts in their Tasks
const tele = await login('apurva.tele@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await tele.locator('aside nav button').filter({ hasText: /^\s*Tasks\s*$/ }).first().click();
await tele.getByText('Anil Kumar').first().waitFor({ timeout: 20000 }).catch(() => fail('the Telecaller does not see the contact in their Tasks'));
ok('the Telecaller sees the contacts in their own Tasks');
await tele.context().close();
current = sh;

// ------------------------------------------------------------------ 3b. Sheet Upload: .xlsx, .xls and .csv as leads for a Team Member and the Team Lead
await page(sh, 'Sheet Upload');
await sh.getByRole('heading', { name: 'Sheet Upload' }).waitFor({ timeout: 15000 }).catch(() => fail('Sheet Upload did not open its page'));
await expect(/\/sheet-upload$/.test(sh.url()) && await sh.locator('#la-file').getAttribute('accept') === '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv',
  'Sheet Upload: its own page and address; .xlsx, .xls and .csv files can be chosen');
await expect(/fair\.xlsx/.test(await text(sh)), 'Sheet Upload: the same upload history as Lead Assign');
const rahulId = await idOf('rahul@amuwa.com'), nehaId = await idOf('neha@amuwa.com'), leadId = await idOf('lead@amuwa.com');
const give = async (who, file, fileName) => {
  await sh.locator('#la-assignee').selectOption(who);
  await sh.locator('#la-file').setInputFiles(file);
  await sh.getByTestId('preview-valid').waitFor({ timeout: 20000 }).catch(() => fail(`${fileName}: no preview`));
  const valid = Number(await sh.getByTestId('preview-valid').innerText());
  await sh.getByRole('button', { name: /Review and give \d+ leads to/ }).click();
  await sh.getByRole('button', { name: 'Confirm and assign' }).click();
  await sh.getByText(new RegExp(`${valid} leads from ${fileName.replace('.', '\\.')} are now in`)).waitFor({ timeout: 20000 }).catch(() => fail(`${fileName}: no success message`));
  return valid;
};
// an .xlsx to a Sales Team Member
const memberXlsx = await xlsx([
  ['Customer Name', 'Company Name', 'Phone Number', 'Email', 'Remarks'],
  ['Kiran Upload', 'Kiran Stores', 9822300001, 'kiran@stores.example', 'Wants a WhatsApp demo'],
  ['Lata Upload', '', '98223 00002', '', ''],
  ['', 'Nameless Co', '9822300003', '', ''],
  ['Existing Cold Lead', '', '+919000000011', '', '']
], 'member-leads.xlsx');
await expect(await give(rahulId, memberXlsx, 'member-leads.xlsx') === 2, 'Sheet Upload (.xlsx): 2 valid leads given to the Team Member');
let made = await q(`select name, owner_id, lifecycle_stage from customers where name in ('Kiran Upload', 'Lata Upload') order by name`);
await expect(made.length === 2 && made.every(c => c.owner_id === rahulId && c.lifecycle_stage === 'LEAD'), 'Sheet Upload (.xlsx): the leads are in Rahul\'s pipeline', made);
// a .csv to the Team Lead
fs.writeFileSync(`${OUT}/tl-leads.csv`, 'Customer Name,Mobile Number,Email\r\n"Mehta, Uday",+91 98223 00010,uday@example.com\r\nVinay Upload,9822300011,not-an-email\r\n');
await expect(await give(leadId, `${OUT}/tl-leads.csv`, 'tl-leads.csv') === 1, 'Sheet Upload (.csv): the valid lead is given to the Team Lead');
await expect((await q(`select owner_id from customers where name = 'Mehta, Uday'`))[0]?.owner_id === leadId, 'Sheet Upload (.csv): a quoted name with a comma is one lead, owned by the Team Lead');
// a real .xls (Excel 97-2003) workbook to another Team Member
const xlsB64 = fs.readFileSync('supabase/tests/sheet_fixtures.ts', 'utf8').match(/'([A-Za-z0-9+/=]+)'/g).map(x => x.slice(1, -1)).join('');
fs.writeFileSync(`${OUT}/contacts.xls`, Buffer.from(xlsB64, 'base64'));
await expect(await give(nehaId, `${OUT}/contacts.xls`, 'contacts.xls') === 229, 'Sheet Upload (.xls): 229 of the 230 contacts are valid and given to Neha');
await expect((await q(`select count(*)::int n from customers where owner_id = $1 and lead_source = 'Excel sheet'`, [nehaId]))[0].n === 229
  && (await q(`select name from customers where phone = '9876500001'`))[0]?.name === 'Zoë Fernandes', 'Sheet Upload (.xls): the leads are made, accents and all');
await sh.screenshot({ path: `${OUT}/sh-2b-sheet-upload.png`, fullPage: true });
// the history: who got it, the status, the failed rows
const histText = await sh.getByRole('region', { name: 'Uploaded sheets' }).innerText().catch(async () => text(sh));
await expect(/contacts\.xls/.test(histText) && /Imported/.test(histText) && /Team Member · leads in their pipeline/.test(histText) && /Team Lead · leads in their pipeline/.test(histText),
  'Sheet Upload: the history lists each upload with who got it and its status');
await sh.getByRole('button', { name: 'View the 2 rows left out of member-leads.xlsx' }).click();
const failedRows = await sh.getByTestId('failed-rows').innerText();
await expect(/Invalid: The contact name is missing/.test(failedRows) && /Duplicate: This person is already in the CRM/.test(failedRows) && /Existing Cold Lead/.test(failedRows) && /9822300003/.test(failedRows),
  'Sheet Upload: the failed rows of a sheet open later, with their reason and values', failedRows);
await sh.screenshot({ path: `${OUT}/sh-2c-failed-rows.png` });
await sh.keyboard.press('Escape');
// the leads where the people work: the member's and the Team Lead's own dashboards
const rahulPage = await login('rahul@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await rahulPage.locator('aside nav button').filter({ hasText: /^\s*Leads\s*$/ }).first().click();
if (!(await rahulPage.getByText('Kiran Upload').count())) await rahulPage.locator('aside nav button').filter({ hasText: /^\s*Leads\s*$/ }).last().click();
// his own leads (the department's other leads stay read-only under "Department Leads", as for every lead)
await rahulPage.locator('main').getByRole('button', { name: /^My Leads/ }).first().click().catch(() => rahulPage.locator('main').getByRole('tab', { name: /^My Leads/ }).first().click());
await rahulPage.getByText('Kiran Upload').first().waitFor({ timeout: 20000 }).catch(() => fail('Rahul does not see the uploaded lead in his own leads'));
const mine = await rahulPage.locator('main').innerText();
await expect(/Lata Upload/.test(mine) && !/Mehta, Uday|Contact person 1\d\d Sharma/.test(mine), 'Sheet Upload: the uploaded leads are under Rahul\'s own leads; the Team Lead\'s and Neha\'s are not his');
await rahulPage.context().close();
const tlPage = await login('lead@amuwa.com', { width: 1440, height: 900 }, 'aside nav button');
await tlPage.locator('aside nav button').filter({ hasText: /^\s*My Leads\s*$/ }).first().click();
await tlPage.locator('aside nav button').filter({ hasText: /^\s*Leads\s*$/ }).last().click();
await tlPage.getByText('Mehta, Uday').first().waitFor({ timeout: 20000 }).catch(() => fail('the Team Lead does not see the uploaded lead in My Leads'));
ok('Sheet Upload: the Team Lead sees the lead in their own My Leads');
await tlPage.context().close();
current = sh;

// ------------------------------------------------------------------ 4. Lead List
await page(sh, 'Lead List');
await sh.getByRole('tab', { name: /Hot Leads/ }).waitFor({ timeout: 15000 });
await sh.getByRole('tab', { name: /Hot Leads/ }).click();
await sh.waitForFunction(() => [...document.querySelectorAll('[data-temperature]')].length > 0 && [...document.querySelectorAll('[data-temperature]')].every(e => e.getAttribute('data-temperature') === 'HOT'), null, { timeout: 15000 }).catch(() => fail('the Hot filter shows other leads'));
ok('Lead List: the Hot filter shows Hot leads only (red badges)');
const hot = await sh.locator('[data-temperature="HOT"]').first().evaluate(e => getComputedStyle(e).color);
await expect(/^rgb\(\s*(1[5-9]\d|2\d\d)\s*,\s*[0-9]{1,2}\s*,/.test(hot) || /^rgb\(\s*1[5-9]\d/.test(hot), 'Lead List: Hot is red', hot);
await sh.getByRole('tab', { name: /All Leads/ }).click();
await sh.getByLabel('Search leads').fill('hot lead');
await sh.getByText('Existing Hot Lead').first().waitFor({ timeout: 15000 });
await expect(await until(async () => (await sh.locator('tbody tr').count()) === 1), 'Lead List: search finds the lead');
await expect(/Rahul Mehta/.test(await sh.locator('tbody tr').first().innerText()), 'Lead List: it shows who owns the lead');
await sh.getByLabel('Search leads').fill('');
await sh.getByRole('button', { name: 'View Existing Hot Lead' }).click().catch(async () => { await sh.getByLabel('Search leads').fill('hot lead'); await sh.getByRole('button', { name: 'View Existing Hot Lead' }).click(); });
await sh.getByRole('dialog').waitFor({ timeout: 15000 });
await sh.getByText('Latest follow-up details').waitFor({ timeout: 15000 });
await expect(/Website/.test(await sh.getByRole('dialog').innerText()) && /Latest follow-up details/.test(await sh.getByRole('dialog').innerText()), 'Lead List: the detail shows the lead and its follow-up history');
await sh.keyboard.press('Escape');
await sh.getByLabel('Search leads').fill('');
await sh.getByRole('tab', { name: /Unassigned/ }).click();
await sh.getByText('Inbound Ivan').first().waitFor({ timeout: 15000 });
await sh.getByRole('button', { name: 'Assign Inbound Ivan' }).click();
await sh.getByRole('dialog').locator('select').selectOption({ label: (await sh.getByRole('dialog').locator('select option').allInnerTexts()).find(o => /Neha Shah/.test(o)) });
await sh.getByRole('button', { name: 'Assign lead' }).click();
await until(async () => (await q(`select 1 from customers where name = 'Inbound Ivan'`)).length);
await expect((await q(`select p.full_name from customers c join profiles p on p.id = c.owner_id where c.name = 'Inbound Ivan'`))[0].full_name === 'Neha Shah', 'Lead List: an unassigned enquiry is assigned to a team member');
await expect(!/Support Only Customer/.test(await text(sh)), 'Lead List: no Support customer');
await sh.screenshot({ path: `${OUT}/sh-3-lead-list.png`, fullPage: true });

// ------------------------------------------------------------------ 5. Daily Tasks
await page(sh, 'Daily Tasks');
await sh.getByRole('button', { name: /New task/ }).click();
const lead = await idOf('lead@amuwa.com');
await sh.getByRole('dialog').locator('select').first().selectOption(lead);
await sh.getByRole('dialog').getByPlaceholder(/Call every Hot lead/).fill('Call the Expo leads');
await sh.getByRole('dialog').locator('input[type="date"]').fill('2020-01-02');
await sh.getByRole('button', { name: 'Create task' }).click();
await sh.getByText('Call the Expo leads').first().waitFor({ timeout: 15000 }).catch(() => fail('the new task is not listed'));
ok('Daily Tasks: a task is created for a Sales Team Lead');
await sh.getByRole('tab', { name: /Overdue/ }).click();
await sh.getByText('Call the Expo leads').first().waitFor({ timeout: 15000 });
await expect(/overdue/i.test(await sh.locator('tbody').innerText()), 'Daily Tasks: it is shown as overdue');
await sh.reload();
await sh.getByText('Call the Expo leads').first().waitFor({ timeout: 20000 }).catch(() => fail('the task is gone after a refresh'));
ok('Daily Tasks: the task is still there after a refresh');
const taskOptions = await (async () => { await sh.getByRole('button', { name: /New task/ }).click(); const o = await sh.getByRole('dialog').locator('select').first().locator('option').allInnerTexts(); await sh.keyboard.press('Escape'); return o; })();
await expect(!taskOptions.some(o => /Dina Delivery/.test(o)), 'Daily Tasks: Support Team Leads cannot be chosen', taskOptions);

// ------------------------------------------------------------------ 6. Performance
await page(sh, 'Performance Management');
await sh.getByRole('button', { name: 'Open Rahul Mehta' }).waitFor({ timeout: 20000 });
await expect(!/Mohan Member|Rina Rao|Dina Delivery|Tara Consultant/.test(await text(sh)), 'Performance: only Sales people have a card');
await sh.screenshot({ path: `${OUT}/sh-4-performance.png`, fullPage: true });
await sh.getByRole('button', { name: 'Open Rahul Mehta' }).click();
await sh.getByText('Assigned leads').first().waitFor({ timeout: 15000 });
await sh.getByRole('heading', { name: 'Lead status' }).waitFor({ timeout: 15000 });
await expect(/Existing Hot Lead/.test(await text(sh)) && /Follow-up history/.test(await text(sh)), 'Performance: opening a person shows their leads, activity and follow-ups');
await sh.getByRole('button', { name: /Performance report/ }).click();
await sh.getByRole('button', { name: /Back|All employees|Generate|Refresh/ }).first().waitFor({ timeout: 20000 }).catch(() => fail('the performance report did not open'));
ok('Performance: the AI-assisted performance report opens for the person');

// ------------------------------------------------------------------ 7. Reports
await page(sh, 'Sales Reports');
await sh.locator('#sr-who').waitFor({ timeout: 15000 });
await sh.locator('#sr-who').selectOption('TEAM_LEAD');
await sh.getByText('Team Lead report').first().waitFor({ timeout: 15000 });
await expect(/Lead Person/.test(await text(sh)) && !/Dina Delivery/.test(await text(sh)), 'Reports: the Team Lead report lists Sales Team Leads only');
await sh.locator('#sr-who').selectOption('TEAM_MEMBER');
await sh.getByText('Team Member report').first().waitFor({ timeout: 15000 });
await expect(/Rahul Mehta/.test(await text(sh)) && !/Mohan Member|Rina Rao/.test(await text(sh)), 'Reports: switching to Team Member lists Sales Team Members only');
const [download] = await Promise.all([sh.waitForEvent('download'), sh.getByRole('button', { name: /Export CSV/ }).click()]);
await expect(/sales-team-member-report/.test(download.suggestedFilename()), 'Reports: the report exports to CSV');

// ------------------------------------------------------------------ 8. Income, Notices, Team, Chat, Notifications
await page(sh, 'Department Income');
await sh.getByTestId('income-gross').waitFor({ timeout: 15000 });
await expect(/Not recorded for Sales/.test(await sh.getByTestId('income-expenses').innerText()), 'Income: gross income is shown; expenses and net are an honest empty state, not dummy totals');
await page(sh, 'Client Notices');
await sh.getByText(/notice/i).first().waitFor({ timeout: 15000 });
ok('Client Notices opens');
await page(sh, 'Team Members & Access');
await sh.locator('#staff-panel-members').getByText('Rahul Mehta').first().waitFor({ timeout: 15000 });
const shTabs = (await sh.locator('[role="tablist"][aria-label="Team Member Management"] [role="tab"]').allInnerTexts()).map(t => t.trim());
// (the employee approval tabs came with the multi-level approval work; a Department Head still has no Access Control tab)
await expect(shTabs[0] === 'Add Team Member' && shTabs[1] === 'Team Members' && !shTabs.some(t => /Access Control/.test(t)), 'Team Members & Access: Add Team Member and Team Members first, no Access Control for a Department Head', shTabs);
await expect(!/Mohan Member|Rina Rao|Dina Delivery|Tara Consultant|Dev Head/.test(await text(sh)), 'Team Members & Access: Sales people only (not the Support team or the Support head)');
await sh.locator('[data-testid="tab-add"]').click();
await sh.locator('#staff-role').waitFor({ timeout: 15000 });
const roleOptions = await sh.locator('#staff-role option').allInnerTexts();
await expect(!roleOptions.some(o => /Department Head/i.test(o)), 'Team Members & Access: a Department Head cannot be created from here', roleOptions);
await sh.locator('#staff-role').selectOption('TEAM_MEMBER');
const teamOptions = await sh.locator('select').filter({ has: sh.locator('option', { hasText: 'Select team…' }) }).first().locator('option').allInnerTexts();
await expect(teamOptions.some(o => /Sales/.test(o)) && !teamOptions.some(o => /Support|Delivery/.test(o)), 'Team Members & Access: only Sales teams can be chosen', teamOptions);
await page(sh, 'Chat');
await sh.waitForTimeout(1000);
await expect(!/Mohan Member|Rina Rao|Dina Delivery/.test(await sh.locator('main').innerText()), 'Chat opens without Support people');
await page(sh, 'Notification Center');
await sh.getByText(/notification/i).first().waitFor({ timeout: 15000 });
ok('Notification Center opens');

// ------------------------------------------------------------------ 9. layouts
for (const [name, size] of [['tablet', { width: 820, height: 1100 }], ['phone', { width: 390, height: 844 }]]) {
  const p = await login('sales.head@amuwa.com', size, 'main');
  await p.getByTestId('stat-total-leads').waitFor({ timeout: 20000 });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect(overflow <= 1, `${name}: the Overview has no sideways scrolling`, overflow);
  await page(p, 'Leads').catch(() => {});
  await p.locator('aside nav button').filter({ hasText: /^\s*Lead List\s*$/ }).first().click();
  await p.getByRole('tab', { name: /All Leads/ }).waitFor({ timeout: 15000 });
  const o2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect(o2 <= 1, `${name}: the Lead List has no sideways scrolling`, o2);
  await page(p, 'Sheet Upload');
  await p.locator('#la-file').waitFor({ timeout: 15000 });
  const o3 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect(o3 <= 1 && await p.locator('#la-file').isVisible(), `${name}: Sheet Upload fits the screen (the history table scrolls inside its card)`, o3);
  await p.screenshot({ path: `${OUT}/sh-6-sheet-upload-${name}.png`, fullPage: true });
  await p.screenshot({ path: `${OUT}/sh-5-${name}.png`, fullPage: true });
  await p.context().close();
}

await expect(errors.length === 0, 'no console errors or page errors in any window', errors);
await browser.close();
await db.end();
console.log(`=== ${step} SALES DEPARTMENT HEAD BROWSER CHECKS PASSED ===`);
