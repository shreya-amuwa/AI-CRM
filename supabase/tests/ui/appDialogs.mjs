// Browser tests: answer the CRM's own confirmation / input dialogs (src/components/feedback/AppFeedback.tsx) the way page.on('dialog',
// d => d.accept(value)) answered the browser's confirm() / prompt() before they were replaced. Every dialog shown is recorded (its title,
// description and details) in window.__appDialogs, read with appDialogs(page). Works before page.goto (installed for each new page) and on a page already open.
function install({ value, accept }) {
    if (window.__appDialogsInstalled) return;
    window.__appDialogsInstalled = true;
    window.__appDialogs = [];
    const setValue = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const seen = new WeakSet();
    const answer = () => {
      for (const box of document.querySelectorAll('[data-testid="confirm-dialog"], [data-testid="input-dialog"]')) {
        if (seen.has(box)) continue;
        seen.add(box);
        window.__appDialogs.push(box.innerText.replace(/\s+/g, ' ').trim());
        setTimeout(() => {
          if (!accept) { box.querySelector('button')?.click(); return; }
          const typed = box.querySelector('input:not([type=file]), textarea');
          if (typed) {
            const want = box.dataset.testid === 'confirm-dialog' ? (box.innerText.match(/Type (.+?) to confirm/) || [])[1] ?? '' : value;
            setValue(typed, want);
          }
          setTimeout(() => box.querySelector('[data-testid="confirm-dialog-confirm"], [data-testid="input-dialog-confirm"]')?.click(), 30);
        }, 30);
      }
    };
    new MutationObserver(answer).observe(document, { childList: true, subtree: true });
}
export async function answerAppDialogs(page, { value = '', accept = true } = {}) {
  await page.addInitScript(install, { value, accept }); // pages loaded from now on
  await page.evaluate(install, { value, accept });      // the page already open
}
export const appDialogs = page => page.evaluate(() => window.__appDialogs || []);
