// Browser test of the "Same as mobile number" checkbox: real React component, real Chromium, real typing.
// Needs Playwright with Chromium (not a project dependency); it is skipped, loudly, when they are not installed.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the WhatsApp checkbox browser test did not run'); process.exit(0); }

const work = mkdtempSync(path.join(tmpdir(), 'wa-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/whatsapp_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
} catch (e) {
  console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]);
  process.exit(0);
}
const open = async (props) => {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(p => window.mount(p), props);
  return page;
};
const wa = page => page.locator('#wa');
const saved = page => page.locator('#saved').innerText();

try {
  // 1. tick first, then type the mobile number: the WhatsApp field follows every keystroke
  let page = await open({});
  await page.check('#wa-same');
  check(await wa(page).inputValue() === '', 'ticked with no mobile number: the WhatsApp number is empty');
  check(await wa(page).evaluate(e => e.readOnly), 'and it cannot be typed into while it follows the mobile number');
  await page.fill('#mobile', '9321664464');
  check(await wa(page).inputValue() === '9321664464', 'typing the mobile number fills the WhatsApp number');
  await page.fill('#mobile', '+91 98765 43210');
  check(await wa(page).inputValue() === '+91 98765 43210', 'changing the mobile number updates the WhatsApp number (format kept as typed)');
  check(await saved(page) === '+91 98765 43210', 'the value that would be saved is the mobile number');
  // 2. untick: stops following, keeps what it showed, becomes editable
  await page.uncheck('#wa-same');
  check(await wa(page).inputValue() === '+91 98765 43210', 'unticking keeps the number it showed');
  check(!(await wa(page).evaluate(e => e.readOnly)), 'and the WhatsApp number can be edited on its own');
  await page.fill('#wa', '9000000001');
  await page.fill('#mobile', '9111111111');
  check(await wa(page).inputValue() === '9000000001', 'a manually typed WhatsApp number is not overwritten by a later mobile change');
  check(await saved(page) === '9000000001', 'and that number is what would be saved');
  // 3. ticking again copies the current mobile number and syncs again
  await page.check('#wa-same');
  check(await wa(page).inputValue() === '9111111111', 'ticking again shows the current mobile number');
  await page.fill('#mobile', '9222222222');
  check(await wa(page).inputValue() === '9222222222', 'and follows it again');
  await page.close();

  // 4. typing in the WhatsApp field itself (when it can be edited) never ticks the box
  page = await open({ initialPhone: '9321664464' });
  await page.fill('#wa', '9333333333');
  check(!(await page.isChecked('#wa-same')), 'a WhatsApp number typed by hand leaves the box unticked');
  check(await saved(page) === '9333333333', 'and is saved as typed');
  await page.fill('#wa', '');
  check(await saved(page) === 'null', 'an empty WhatsApp number is saved as nothing');
  await page.close();

  // 5. editing an existing record
  page = await open({ edit: true, initialPhone: '9321664464', initialWhatsapp: '' });
  check(await page.isChecked('#wa-same'), 'edit: a record with no WhatsApp number starts ticked');
  page.close();
  page = await open({ edit: true, initialPhone: '9321664464', initialWhatsapp: '+91 93216 64464' });
  check(await page.isChecked('#wa-same'), 'edit: the same number written differently starts ticked');
  await page.close();
  page = await open({ edit: true, initialPhone: '9321664464', initialWhatsapp: '9000000001' });
  check(!(await page.isChecked('#wa-same')), 'edit: a different WhatsApp number starts unticked');
  check(await wa(page).inputValue() === '9000000001', 'edit: and shows the saved number');
  await page.fill('#mobile', '9444444444');
  check(await wa(page).inputValue() === '9000000001', 'edit: changing the mobile number leaves a separate WhatsApp number alone');
  await page.close();
  console.log(`=== ALL WHATSAPP CHECKBOX BROWSER TESTS PASSED (${passed}) ===`);
} finally {
  await browser.close();
}
