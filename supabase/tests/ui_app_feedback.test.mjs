// Browser test of the in-app feedback (src/components/feedback/AppFeedback.tsx), replacing alert() / confirm() / prompt(): focus goes to
// the safe button of a destructive dialog and comes back to the button that opened it; Escape and Cancel do nothing; a destructive dialog
// ignores a click outside; Tab stays inside; an action that fails keeps the dialog open with the error and runs once per click; a typed
// confirmation; a required reason; an empty optional reason vs cancel; two requests one after the other; toasts with live roles, no
// stacked copies, a bounded stack; desktop and phone (320 / 390 px) without sideways scrolling.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) { try { ({ chromium } = require(p)); break; } catch { /* next */ } }
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the feedback browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const built = await build({ entryPoints: ['supabase/tests/ui/app_feedback_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error', define: { 'import.meta.env': '{}' } });
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 860 }], ['phone 390', { width: 390, height: 780 }], ['phone 320', { width: 320, height: 640 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    let native = 0;
    page.on('dialog', d => { native++; d.dismiss(); });
    await page.goto(base);
    await page.evaluate(() => window.mount());
    const log = () => page.evaluate(() => window.__log || []);
    const dlg = page.locator('[data-testid="confirm-dialog"]');
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.id || '');

    // destructive: safe button first, Enter there does not delete, Escape cancels, a click outside does nothing
    await page.click('#destructive');
    await dlg.waitFor();
    check(await dlg.getAttribute('role') === 'alertdialog' && await dlg.getAttribute('aria-modal') === 'true' && await page.getByRole('alertdialog', { name: 'Delete this draft?' }).isVisible(),
      `${label}: a destructive question is an alert dialog with its own title (not "Are you sure?")`);
    await page.waitForTimeout(50);
    check(await focused() === 'Keep draft', `${label}: the safe button has the focus first`, await focused());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check(!(await dlg.count()) && (await log()).at(-1).destructive === false && await page.evaluate(() => window.mutations()) === 0, `${label}: Enter on the focused safe button cancels: nothing is deleted`);
    check(await focused() === 'Delete draft', `${label}: the focus returns to the button that asked`);
    await page.click('#destructive');
    await dlg.waitFor();
    await page.mouse.click(5, 5);
    await page.waitForTimeout(100);
    check(await dlg.count() === 1, `${label}: a click outside does not close a destructive dialog`);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    check(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="confirm-dialog"]')), `${label}: Tab stays inside the dialog`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check(!(await dlg.count()) && (await log()).at(-1).destructive === false, `${label}: Escape cancels`);
    await page.click('#destructive');
    await page.getByRole('button', { name: 'Delete draft' }).last().click();
    await page.waitForTimeout(100);
    check((await log()).at(-1).destructive === true && await page.evaluate(() => window.mutations()) === 1, `${label}: confirming runs the action once`);

    // an ordinary one: the confirm button has the focus, a click outside closes it ("no")
    await page.click('#normal');
    await dlg.waitFor();
    await page.waitForTimeout(50);
    check(await focused() === 'Release offer' && await dlg.getAttribute('role') === 'dialog', `${label}: an ordinary question focuses its confirm button`);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(100);
    check(!(await dlg.count()) && (await log()).at(-1).normal === false, `${label}: a click outside closes an ordinary question as "no"`);

    // the action fails: the dialog stays, shows why, a double click runs it once; then it works
    const before = await page.evaluate(() => window.mutations());
    await page.click('#retry');
    await dlg.waitFor();
    await page.getByTestId('confirm-dialog-confirm').dblclick();
    await dlg.getByRole('alert').waitFor();
    check(await dlg.getByText('The payment service did not answer.').isVisible() && await page.evaluate(() => window.mutations()) === before + 1,
      `${label}: a failure keeps the dialog open with the reason; a double click ran it once`);
    await page.getByTestId('confirm-dialog-confirm').click();
    check(await page.getByTestId('confirm-dialog-confirm').textContent() === 'Working…', `${label}: working while it runs`);
    await dlg.waitFor({ state: 'detached' });
    check((await log()).at(-1).retry === true, `${label}: trying again succeeds and closes it`);

    // typed confirmation
    await page.click('#typed');
    await dlg.waitFor();
    check(await page.getByTestId('confirm-dialog-confirm').isDisabled(), `${label}: a high-risk deletion needs the name typed first`);
    await dlg.locator('input').fill('Digitree');
    await page.getByTestId('confirm-dialog-confirm').click();
    await page.waitForTimeout(100);
    check((await log()).at(-1).typed === true, `${label}: then it can be confirmed`);

    // required reason; optional reason: empty vs cancel
    const inp = page.locator('[data-testid="input-dialog"]');
    await page.click('#reason');
    await inp.waitFor();
    await page.waitForTimeout(50);
    check(await page.evaluate(() => document.activeElement?.tagName) === 'TEXTAREA', `${label}: the reason field has the focus`);
    await page.getByTestId('input-dialog-confirm').click();
    check(await inp.getByText('This is required.').isVisible() && await inp.locator('textarea').getAttribute('aria-invalid') === 'true', `${label}: an empty required reason is refused inline`);
    await inp.locator('textarea').fill('Documents are missing');
    check(await inp.getByText('21/200').isVisible(), `${label}: the length is counted`);
    await page.getByTestId('input-dialog-confirm').click();
    await page.waitForTimeout(100);
    check((await log()).at(-1).reason === 'Documents are missing', `${label}: the reason is returned`);
    await page.click('#optional');
    await inp.waitFor();
    await page.getByTestId('input-dialog-confirm').click();
    await page.waitForTimeout(100);
    check((await log()).at(-1).optional === '', `${label}: an optional reason left empty is "" (submitted)`);
    await page.click('#optional');
    await inp.waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check((await log()).at(-1).optional === null, `${label}: cancelling is null, not an empty reason`);

    // two requests at once: one after the other
    await page.click('#two');
    await page.getByRole('dialog', { name: 'First question?' }).waitFor();
    check(await dlg.count() === 1, `${label}: one dialog at a time`);
    await page.getByTestId('confirm-dialog-confirm').click();
    await page.getByRole('dialog', { name: 'Second question?' }).waitFor();
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(100);
    const l = await log();
    check(l.some(x => x.first === true) && l.some(x => x.second === false), `${label}: the second follows the first, each with its own answer`);

    await page.click('#details');
    await dlg.waitFor();
    check(await dlg.getByText('Notes: call back').isVisible() && await dlg.locator('button').count() === 1, `${label}: details are shown with one Close button`);
    await dlg.getByRole('button', { name: 'Close', exact: true }).click();

    // toasts
    await page.click('#ok');
    await page.click('#ok');
    const okT = page.getByTestId('toast-success');
    check(await okT.count() === 1 && await okT.getAttribute('role') === 'status' && await okT.getByText('(×2)').isVisible(), `${label}: a success toast (announced politely); the same one again is not stacked`);
    await page.click('#err');
    check(await page.getByTestId('toast-error').getAttribute('role') === 'alert' && await page.getByTestId('toast-error').getByText('Error:').count() === 1,
      `${label}: an error is announced at once and says "Error" in words, not only in colour`);
    await page.click('#many');
    check(await page.locator('[data-testid^="toast-"]').count() === 4, `${label}: at most four toasts at a time`);
    const box = await page.locator('[data-testid^="toast-"]').first().boundingBox();
    check(viewport.width < 640 ? box.y < 120 : box.y > viewport.height / 2 && box.x > viewport.width / 2, `${label}: toasts sit ${viewport.width < 640 ? 'at the top on a phone' : 'bottom right'}`, box);
    await page.locator('[data-testid^="toast-"]').first().getByRole('button', { name: 'Dismiss notification' }).click();
    check(await page.locator('[data-testid^="toast-"]').count() === 3, `${label}: a toast can be closed`);

    // Phase 1: one request at a time, loading then success in the same toast, safe failure text, offline warning
    await page.evaluate(() => document.querySelectorAll('[data-testid^="toast-"] button[aria-label="Dismiss notification"]').forEach(b => b.click()));
    await page.click('#submit');
    await page.click('#submit', { force: true }).catch(() => undefined);
    const loadingT = page.getByTestId('toast-loading');
    check(await loadingT.count() === 1 && await loadingT.getAttribute('aria-busy') === 'true' && await loadingT.getByText('Saving lead…').count() === 1 && await page.locator('#submit').isDisabled(),
      `${label}: while saving, a loading toast and a disabled button`);
    await page.getByTestId('toast-success').getByText('Lead saved successfully.').waitFor();
    check(await page.evaluate(() => window.saves()) === 1 && await page.getByTestId('toast-loading').count() === 0, `${label}: a double click saved once; the loading toast became the success toast`);
    await page.click('#submit-fail');
    await page.getByTestId('toast-error').getByText('Unable to save lead.').waitFor();
    check(await page.getByText('violates unique constraint').count() === 0, `${label}: a failure shows the safe sentence, never the database text`);
    await page.context().setOffline(true);
    await page.getByText('You are offline').waitFor();
    check(await page.getByTestId('toast-warning').filter({ hasText: 'Internet connection unavailable' }).count() === 1, `${label}: going offline shows one persistent warning`);
    await page.context().setOffline(false);
    await page.getByText('Back online.').waitFor();
    check(await page.getByText('You are offline').count() === 0, `${label}: back online replaces it`);

    check(native === 0, `${label}: no browser dialog was ever shown`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scrolling`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    await page.close();
  }
  console.log(`=== ${passed} APP FEEDBACK BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
