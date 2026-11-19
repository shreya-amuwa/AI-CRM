// Browser test of the AI Website client onboarding section of Add Lead and Edit Lead: it appears only while AI Website is ticked, starts from
// the customer details, checks every field before anything is sent, sends one block with the lead, and is shown again (and edited) on the
// lead. Real React components, real Chromium; the CRM API is answered in the page (supabase/tests/ui/ai_website_harness.tsx).
// Skipped, loudly, when Playwright / Chromium are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the AI Website onboarding browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'aiw-ui-'));
execFileSync('npx', ['esbuild', 'supabase/tests/ui/ai_website_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${path.join(work, 'app.js')}`,
  '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(path.join(work, 'app.js'), 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const open = async (mount, arg, viewport = { width: 1280, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  // a real origin, so the app's API client (relative /api/v1 URLs) works; the page answers the API itself
  await page.route('http://aiw.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://aiw.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([m, a]) => window[m](a), [mount, arg]);
  return page;
};
const section = '[data-testid="ai-website-onboarding"]';
const posts = page => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET'));
const terms = async (page, code) => {
  await page.fill(`#terms-${code}-plan`, 'Starter');
  await page.selectOption(`#terms-${code}-duration`, { index: 1 });
  await page.fill(`#terms-${code}-amount`, '3999');
};

try {
  // ---- Add lead
  {
    const page = await open('mountAdd');
    await page.waitForSelector('text=AI Website');
    await page.fill('#lead-name', 'Kavya Nair');
    await page.fill('#lead-company', 'Nair Bakes');
    await page.fill('#lead-phone', '+91 98470 12345');
    await page.fill('#lead-city', 'Kochi');
    check(!(await page.isVisible(section)), 'no AI Website section before the service is chosen');
    await page.getByText('AI Calling', { exact: true }).first().click();
    check(!(await page.isVisible(section)), 'another service shows no AI Website section');
    await page.getByText('AI Website', { exact: true }).first().click();
    await page.waitForSelector(section);
    check(true, 'choosing AI Website shows the section at once');
    check(await page.inputValue('#aiw-clientName') === 'Kavya Nair' && await page.inputValue('#aiw-businessName') === 'Nair Bakes'
      && await page.inputValue('#aiw-mobile') === '9847012345' && await page.inputValue('#aiw-city') === 'Kochi' && await page.inputValue('#aiw-email') === '',
      'it starts from the customer details already typed (nothing invented: the empty e-mail stays empty)');
    check(!(await page.isVisible('#aiw-googleMapsLink')), 'the Google Maps link appears only after "Yes"');
    const labels = await page.$$eval(`${section} label, ${section} legend`, ls => ls.map(l => l.textContent.trim()));
    check(labels.includes('Client name *') && labels.includes('Mobile number *') && labels.includes('Email (optional)') && labels.includes('Business name *')
      && labels.some(l => /Google Maps\?\s*\*/.test(l)) && labels.includes('City *') && labels.includes('Type of business *'), 'required and optional fields are marked', labels);
    check(await page.isVisible('text=Basic client details') && await page.isVisible('text=Business details'), 'the section has its two groups');

    // unticking hides it, ticking again brings back what was typed
    await page.fill('#aiw-clientName', 'Kavya N.');
    await page.getByText('AI Website', { exact: true }).first().click();
    check(!(await page.isVisible(section)), 'unticking AI Website hides the section');
    await page.getByText('AI Website', { exact: true }).first().click();
    await page.waitForSelector(section);
    check(await page.inputValue('#aiw-clientName') === 'Kavya N.', 'ticking it again keeps what was typed');

    // validation before anything is sent
    await terms(page, 'AI_CALLING');
    await terms(page, 'AI_WEBSITE');
    await page.fill('#aiw-mobile', '12345');
    await page.fill('#aiw-email', 'not-an-email');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#aiw-mobile-error');
    check(/10-digit/.test(await page.innerText('#aiw-mobile-error')), 'a wrong mobile number is shown under the field');
    check(/valid e-mail/i.test(await page.innerText('#aiw-email-error')), 'a wrong e-mail is shown under the field');
    check(/Google Maps/.test(await page.innerText('#aiw-onGoogleMaps-error')), 'the Google Maps answer is required');
    check(/type of business/i.test(await page.innerText('#aiw-businessType-error')), 'the type of business is required');
    check((await posts(page)).length === 0, 'nothing is sent while a field is wrong');

    await page.fill('#aiw-mobile', '98470 12345');
    await page.fill('#aiw-email', '');
    await page.click('[data-testid="aiw-maps-yes"]');
    await page.fill('#aiw-googleMapsLink', 'https://maps.app.goo.gl/nairbakes');
    await page.selectOption('#aiw-businessType', 'Other');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#aiw-businessTypeOther-error');
    check(/Type the type of business/.test(await page.innerText('#aiw-businessTypeOther-error')), '"Other" asks which type');
    await page.fill('#aiw-businessTypeOther', 'Home bakery');
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 5000 });
    const sent = (await posts(page)).find(c => c.path.endsWith('/pipeline/leads'));
    check(sent && sent.body.services.includes('AI_WEBSITE') && sent.body.aiWebsiteOnboarding?.clientName === 'Kavya N.' && sent.body.aiWebsiteOnboarding.mobile === '9847012345'
      && sent.body.aiWebsiteOnboarding.onGoogleMaps === true && sent.body.aiWebsiteOnboarding.googleMapsLink === 'https://maps.app.goo.gl/nairbakes'
      && sent.body.aiWebsiteOnboarding.businessType === 'Other' && sent.body.aiWebsiteOnboarding.businessTypeOther === 'Home bakery' && sent.body.aiWebsiteOnboarding.email === null,
      'the lead is sent once, with its AI Website details', sent?.body);
    check((await posts(page)).length === 1, 'one request (no separate client record)');
    await page.close();
  }
  // ---- a lead with another service only
  {
    const page = await open('mountAdd');
    await page.waitForSelector('text=AI Calling');
    await page.fill('#lead-name', 'Ravi');
    await page.fill('#lead-company', 'Ravi Stores');
    await page.fill('#lead-phone', '9847012346');
    await page.getByText('AI Calling', { exact: true }).first().click();
    await terms(page, 'AI_CALLING');
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 5000 });
    const sent = (await posts(page)).find(c => c.path.endsWith('/pipeline/leads'));
    check(sent && !('aiWebsiteOnboarding' in sent.body), 'another service sends no AI Website details', sent?.body);
    await page.close();
  }
  // ---- Edit lead: the saved details are shown and edited
  {
    const page = await open('mountEdit', true);
    await page.waitForSelector(section);
    check(await page.inputValue('#aiw-clientName') === 'Kavya Nair' && await page.inputValue('#aiw-googleMapsLink') === 'https://maps.app.goo.gl/nairbakes'
      && await page.$eval('#aiw-businessType', s => s.value) === 'Restaurant / Food', 'the lead page shows the saved details');
    check(!(await page.isVisible('[data-testid="aiw-not-saved"]')), 'and does not ask for them again');
    await page.click('[data-testid="aiw-maps-no"]');
    check(!(await page.isVisible('#aiw-googleMapsLink')), '"No" hides the link');
    await page.fill('#aiw-city', 'Thrissur');
    await page.click('button:has-text("Save changes")');
    await page.waitForFunction(() => window.__calls.some(c => c.method === 'PATCH'), null, { timeout: 5000 });
    const patch = (await posts(page)).find(c => c.method === 'PATCH');
    check(patch.body.aiWebsiteOnboarding?.city === 'Thrissur' && patch.body.aiWebsiteOnboarding.onGoogleMaps === false && patch.body.aiWebsiteOnboarding.googleMapsLink === '',
      'saving sends the changed details with the lead', patch.body);
    await page.waitForFunction(() => document.querySelector('#aiw-city')?.value === 'Thrissur');
    check(true, 'the saved change is shown again after reloading the lead');
    await page.close();
  }
  // ---- Edit lead: AI Website newly chosen on a lead without details
  {
    const page = await open('mountEdit', false);
    await page.waitForSelector('text=AI Website');
    check(!(await page.isVisible(section)), 'a lead without AI Website shows no section');
    await page.getByText('AI Website', { exact: true }).first().click();
    await page.waitForSelector(section);
    check(await page.isVisible('[data-testid="aiw-not-saved"]') && await page.inputValue('#aiw-clientName') === 'Kavya Nair', 'choosing it on the lead page shows the section, started from the lead');
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector('#aiw-onGoogleMaps-error');
    check(!(await posts(page)).some(c => c.method === 'PATCH'), 'the new service is not saved without its details');
    await page.close();
  }
  // ---- mobile width
  {
    const page = await open('mountAdd', undefined, { width: 360, height: 740 });
    await page.waitForSelector('text=AI Website');
    await page.getByText('AI Website', { exact: true }).first().click();
    await page.waitForSelector(section);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, w: document.querySelector('#aiw-city').getBoundingClientRect().width }));
    check(m.sw <= m.iw && m.w > 200, 'phone width: the section fits and its fields are full width', m);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== AI WEBSITE ONBOARDING BROWSER TESTS PASSED (${passed}) ===`);
