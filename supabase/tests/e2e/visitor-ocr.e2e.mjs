// The shop-photo text reader of Dispatch Field Visit, end to end in a real browser against the real app, API and database (local stack):
// a synthetic poster is uploaded, the text is really read (Tesseract in the browser), the fields are reviewed and corrected, the visit is saved,
// the saved record is read back from the database, a double click makes ONE visit, bad files give clear errors, and a phone-sized window works.
// Everything on the poster is made up. Screenshots and the poster go to the directory given as the first argument.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, this browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3030';
const OUT = process.argv[2] || '.';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const info = (k, v) => console.log(`   ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/visitor-ocr-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); await browser.close(); process.exit(1); };
const expect = (c, m) => (c ? ok(m) : fail(m));

// ------------------------------------------------------------------ the synthetic poster (nothing on it is real)
const POSTER = `${OUT}/synthetic-shop-poster.png`;
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await p.setContent(`<!doctype html><body style="margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111">
    <div style="padding:40px 60px;border:14px solid #0b3d91;margin:20px;height:760px;box-sizing:border-box">
      <div style="font-size:92px;font-weight:800;color:#0b3d91;line-height:1.05">SUNRISE MOBILE HUB</div>
      <div style="font-size:40px;margin-top:22px">Mobiles | Accessories | Recharge</div>
      <div style="font-size:42px;margin-top:40px">Shop No. 12, Gandhi Market, Sector 21</div>
      <div style="font-size:42px;margin-top:8px">Navi Mumbai 400703</div>
      <div style="font-size:60px;font-weight:700;margin-top:42px">Call: +91 90000 12345</div>
      <div style="font-size:38px;margin-top:30px">www.sunrisemobilehub.example</div>
    </div></body>`);
  await p.screenshot({ path: POSTER });
  await p.close();
  ok(`a synthetic poster was drawn (${fs.statSync(POSTER).size} bytes): SUNRISE MOBILE HUB, a made-up address and the number +91 90000 12345`);
}
const BLANK = `${OUT}/blank.png`;
{
  const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await p.setContent('<body style="margin:0;background:#fff"></body>');
  await p.screenshot({ path: BLANK });
  await p.close();
}
fs.writeFileSync(`${OUT}/not-a-photo.txt`, 'this is not an image');

const login = async (email, viewport, extra = {}) => {
  const ctx = await browser.newContext({ viewport, permissions: ['geolocation'], geolocation: { latitude: 19.033, longitude: 73.029 }, ...extra });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(PASSWORDS[email]);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector('nav button, aside button', { state: 'attached', timeout: 25000 }).catch(() => fail(`${email} did not reach a dashboard`));
  await new Promise(r => setTimeout(r, 600));
  return p;
};
const openFieldVisits = async p => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 400)); }
  await p.locator('nav button', { hasText: 'Field Visits' }).first().click();
  await p.getByRole('button', { name: /Start New Field Visit/ }).first().waitFor({ timeout: 15000 });
};
const startModal = async p => { await p.getByRole('button', { name: /Start New Field Visit/ }).first().click(); await p.waitForSelector('[data-testid="shop-scan"]', { timeout: 10000 }); };
const upload = async (p, file) => {
  const t0 = Date.now();
  await p.setInputFiles('[data-testid="shop-photo-input"]', file);
  return t0;
};
const waitResult = async p => { await p.waitForSelector('[data-testid="shop-scan-result"], [role="alert"]', { timeout: 120000 }); };
const val = (p, id) => p.inputValue(`[data-testid="${id}"]`);

const [{ n: customersBefore }] = await q('select count(*)::int n from customers');
const leadId = (await q(`select id from profiles where email = 'lead@amuwa.com'`))[0].id;
const visitsOf = async name => q(`select id, status, details, owner_id from field_visits where details->>'clientName' = $1 order by created_at`, [name]);

// ------------------------------------------------------------------ 1. desktop: open, upload, read, review, correct, save
{
  const p = await login('lead@amuwa.com', { width: 1440, height: 900 });
  await openFieldVisits(p);
  await startModal(p);
  await expect(await p.locator('input[data-testid="shop-photo-input"]').getAttribute('accept') === 'image/*', 'the upload control accepts images only (accept="image/*")');
  await p.screenshot({ path: `${OUT}/01-upload-interface.png` });
  ok('screenshot 1: the upload interface (Dispatch Field Visit with "Fill from a photo of the shop")');

  const t0 = await upload(p, POSTER);
  const sawStatus = await p.waitForSelector('[data-testid="shop-scan-status"]', { timeout: 15000 }).then(async el => { const t = await el.innerText(); await p.screenshot({ path: `${OUT}/02-processing.png` }); return t; }, () => null);
  await expect(sawStatus !== null, `the person sees a processing status while the photo is read ("${String(sawStatus).replace(/\s+/g, ' ')}")`);
  await waitResult(p);
  info('read time (ms)', Date.now() - t0);
  await expect(await p.locator('[data-testid="shop-scan-result"]').count() === 1, 'the text was really read and the result is shown');
  const read = { name: await val(p, 'visit-client-name'), address: await val(p, 'visit-client-address'), phone: await val(p, 'visit-client-contact') };
  info('fields read from the poster', read);
  await expect(/sunrise/i.test(read.name) && /mobile/i.test(read.name), 'the shop name was read from the poster');
  await expect(/12|gandhi|sector|navi/i.test(read.address), 'the address was read from the poster');
  await expect(/90000\s?12345/.test(read.phone.replace(/\s+/g, ' ').replace(/(\d)\s(\d)/g, '$1$2')) || /9000012345/.test(read.phone.replace(/\D/g, '')), 'the phone number was read from the poster');
  await expect(await p.locator('[data-testid="from-photo-name"], [data-testid="from-photo-address"], [data-testid="from-photo-phone"]').count() >= 2, 'each filled field says it was "Read from the photo" (a guess to check, not a verified fact)');
  await expect(await p.locator('img[alt="The shop photo that was read"]').count() === 1, 'a thumbnail of the photo that was read is shown');
  await p.screenshot({ path: `${OUT}/03-extracted-text-in-fields.png` });
  ok('screenshot 3: the extracted values in the form, each marked "Read from the photo"');

  // review and correct: the person fixes the name (a typed value is never overwritten by a later scan) and adds the purpose
  await p.fill('[data-testid="visit-client-name"]', 'Sunrise Mobile Hub (corrected by visitor)');
  await expect(await p.locator('[data-testid="from-photo-name"]').count() === 0, 'typing in a field removes its "Read from the photo" note: the value is now the person\'s own');
  await p.getByPlaceholder(/Enterprise WabaStore/).fill('Show the WhatsApp Business demo');
  await p.screenshot({ path: `${OUT}/04-reviewed-before-submit.png` });
  ok('screenshot 4: corrected and reviewed fields before submitting');

  // submit with a double click: ONE visit
  const submit = p.getByRole('button', { name: /Start Field Visit/ });
  await Promise.all([submit.click({ timeout: 3000 }).catch(() => undefined), submit.click({ timeout: 1500 }).catch(() => undefined)]);
  await p.waitForSelector('text=Field visit started for', { timeout: 15000 }).catch(() => fail('no confirmation after saving'));
  await new Promise(r => setTimeout(r, 1200));
  const saved = await visitsOf('Sunrise Mobile Hub (corrected by visitor)');
  info('rows saved for this visit', saved.length);
  await expect(saved.length === 1, 'a double click saved ONE field visit, not two');
  const d = saved[0].details;
  await expect(saved[0].owner_id === leadId && saved[0].status === 'In Transit', 'it belongs to the person who submitted it');
  await expect(d.clientName === 'Sunrise Mobile Hub (corrected by visitor)' && d.purpose === 'Show the WhatsApp Business demo', 'the corrected values (not the raw reading) are what was saved');
  await expect(d.clientAddress === read.address && d.clientContact === read.phone, 'the reviewed address and phone are saved as shown');
  await expect(d.shopDetails && typeof d.shopDetails.scanText === 'string' && /sunrise/i.test(d.shopDetails.scanText), 'the raw reading is kept with the visit (shopDetails.scanText) for audit');
  info('saved shopDetails', { ...d.shopDetails, scanText: String(d.shopDetails?.scanText).slice(0, 120) + '...' });
  await expect(d.currentLocation && typeof d.currentLocation.lat === 'number', 'the phone location was recorded with the visit');
  await p.screenshot({ path: `${OUT}/05-saved-record.png` });
  ok('screenshot 5: the saved visit in the list and its details');
  await p.context().close();
}

// ------------------------------------------------------------------ 2. failures give actionable messages, nothing is saved
{
  const p = await login('lead@amuwa.com', { width: 1440, height: 900 });
  await openFieldVisits(p);
  await startModal(p);
  await upload(p, `${OUT}/not-a-photo.txt`);
  await p.waitForSelector('[role="alert"]', { timeout: 10000 });
  const e1 = await p.locator('[data-testid="shop-scan"] [role="alert"]').innerText();
  await expect(/choose a photo/i.test(e1), `a file that is not an image is refused with a clear message ("${e1}")`);
  await p.screenshot({ path: `${OUT}/06-error-not-an-image.png` });
  await upload(p, BLANK);
  await waitResult(p);
  const e2 = await p.locator('[data-testid="shop-scan"] [role="alert"]').innerText().catch(() => '');
  await expect(/No readable text/i.test(e2), `a photo with no text says so and what to do ("${e2}")`);
  await p.screenshot({ path: `${OUT}/07-error-no-text.png` });
  await expect(await val(p, 'visit-client-name') === '', 'nothing was filled from an unreadable photo');
  await p.context().close();
  const [{ n }] = await q('select count(*)::int n from field_visits');
  await expect(n === 1, 'and nothing was saved by the failed attempts');
}

// ------------------------------------------------------------------ 3. a phone-sized window with a camera-style input
{
  const p = await login('lead@amuwa.com', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await openFieldVisits(p);
  await startModal(p);
  await expect(await p.locator('input[data-testid="shop-photo-input"]').getAttribute('capture') === 'environment', 'on a phone the control opens the rear camera (capture="environment")');
  await p.screenshot({ path: `${OUT}/08-mobile-upload-interface.png` });
  await upload(p, POSTER);
  await waitResult(p);
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  await expect(m.sw <= m.iw, `phone width: no sideways scrolling (${m.sw} <= ${m.iw})`);
  await expect(/sunrise/i.test(await val(p, 'visit-client-name')), 'phone: the poster is read there too');
  await p.screenshot({ path: `${OUT}/09-mobile-extracted.png` });
  await p.context().close();
}
const [{ n: customersAfter }] = await q('select count(*)::int n from customers');
info('customers / leads before and after', [customersBefore, customersAfter]);
await db.end();
await browser.close();
console.log(`=== VISITOR PHOTO READING BROWSER TESTS PASSED (${step}) ===`);
