// Browser test of the Department Head assignment field of "Add Team Member": chips, disabled departments, the payload, and the layout on phone / tablet / desktop widths.
// Real React component + the app's real stylesheet (dist/ must be built: npm run build). Skipped, loudly, when Playwright, Chromium or dist/ are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the department assignment browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the department assignment browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');

const work = mkdtempSync(path.join(tmpdir(), 'hd-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/head_departments_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const open = async (vp, multi = true) => {
  const page = await browser.newPage({ viewport: vp });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(m => window.mount(m), multi);
  await page.waitForSelector('[data-testid="head-departments"]');
  return page;
};
const plan = async page => JSON.parse(await page.textContent('#plan'));

{
  const page = await open({ width: 1280, height: 900 });
  check((await plan(page)).ok === false, 'no function chosen yet: nothing can be saved');
  await page.selectOption('#staff-head-division', 'SUPPORT');
  check(await page.isDisabled('[data-testid="head-dept-wabastar"]'), 'a department with no Support team cannot be ticked');
  check(await page.isDisabled('[data-testid="head-dept-dtalk"]'), "D Talk's Support is not offered under D Talk");
  check(!(await page.isDisabled('[data-testid="head-dept-wabatalk"]')), 'Wabatalk can be ticked for a Support head');
  await page.check('[data-testid="head-dept-whatsbox"]');
  await page.check('[data-testid="head-dept-wabatalk"]');
  const chips = await page.$$eval('[aria-label="Selected departments"] li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(chips.length === 3 && /Wabastore/.test(chips[0]) && /Whatsbox/.test(chips[1]) && /Wabatalk/.test(chips[2]), 'the chosen departments show as chips, home first', chips);
  let p = await plan(page);
  check(p.ok && p.departmentId === 'wabastore' && p.headDivision === 'SUPPORT' && p.additionalAccess.length === 2, 'the form would send the home department and two more Support pairs', p);
  await page.click('[aria-label="Make Whatsbox the home department"]');
  p = await plan(page);
  check(p.ok && p.departmentId === 'whatsbox', 'another department can be made the home department', p);
  await page.click('[aria-label="Remove Wabatalk"]');
  p = await plan(page);
  check(p.ok && p.additionalAccess.length === 1, 'removing a chip removes the department', p);
  await page.click('[aria-label="Remove Whatsbox"]');
  await page.click('[aria-label="Remove Wabastore"]');
  check((await plan(page)).ok === false && /at least one/i.test((await plan(page)).error), 'with nothing selected the form refuses to save');
  await page.selectOption('#staff-head-division', 'BOTH');
  await page.check('[data-testid="head-dept-mpillar"]');
  p = await plan(page);
  check(p.ok && p.departmentId === 'mpillar' && !p.headDivision && p.additionalAccess.map(a => a.division).sort().join() === 'SALES,SUPPORT', 'one person for both functions: both pairs, no side', p);
  await page.close();
}
{
  // a plain Department Head works in one department: choosing another replaces the choice; a facet of the same department (Wabatalk) stays
  const page = await open({ width: 1280, height: 900 }, false);
  await page.selectOption('#staff-head-division', 'SUPPORT');
  await page.check('[data-testid="head-dept-whatsbox"]');
  let chips = await page.$$eval('[aria-label="Selected departments"] li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(chips.length === 1 && /Whatsbox/.test(chips[0]), 'a Department Head: choosing another department replaces the choice (one department)', chips);
  check(/one department/i.test(await page.textContent('[data-testid="head-departments"]')), 'and the field says a Department Head works in one department');
  await page.selectOption('#staff-head-division', 'BOTH');
  await page.check('[data-testid="head-dept-dtalk"]');
  await page.check('[data-testid="head-dept-wabatalk"]');
  chips = await page.$$eval('[aria-label="Selected departments"] li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(chips.length === 2 && /D Talk/.test(chips[0]) && /Wabatalk/.test(chips[1]), 'one person for Sales and Support of D Talk: D Talk and its Support side Wabatalk together', chips);
  const p = JSON.parse(await page.textContent('#plan'));
  check(p.ok && p.departmentId === 'dtalk' && p.additionalAccess.map(a => `${a.departmentId}:${a.division}`).sort().join() === 'dtalk:SALES,wabatalk:SUPPORT', 'the plan stays inside D Talk', p);
  await page.close();
}
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await open(vp);
  await page.selectOption('#staff-head-division', 'SUPPORT');
  for (const id of ['whatsbox', 'wabatalk', 'mpillar']) await page.check(`[data-testid="head-dept-${id}"]`);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, `${name}: no sideways scrolling`, m);
  const cols = await page.$$eval('[data-testid="head-departments"] fieldset > div > label', ls => new Set(ls.map(l => Math.round(l.getBoundingClientRect().left))).size);
  check(name === 'phone' ? cols === 1 : cols === 2, `${name}: ${name === 'phone' ? 'one' : 'two'} column(s) of departments`, cols);
  await page.close();
}
await browser.close();
console.log(`=== DEPARTMENT ASSIGNMENT BROWSER TESTS PASSED (${passed}) ===`);
