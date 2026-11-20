// Browser test of the chat enhancements: @mentions in a group (the list of members, picking one, the highlight, the tag sent; nobody outside
// the group offered), reactions (add, change, remove, who reacted, and a colleague's reaction arriving live), Delete Inbox (the confirmation
// and its wording; the Super Admin's company-wide delete needs the typed confirmation), and opening a group on the message a notification
// points at. Real React components and the app's stylesheet, real Chromium; the CRM API is answered in the page
// (supabase/tests/ui/chat_extras_harness.tsx). Skipped, loudly, without Playwright.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the chat browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'chx-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/chat_extras_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/chat_extras_auth_stub.ts') }));
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const appCss = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';
const chatCss = readFileSync('src/components/chat/chat.css', 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const open = async (opts = {}, viewport = { width: 1280, height: 900 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.route('http://chx.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + appCss + chatCss + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://chx.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(o => window.mount(o), opts);
  return page;
};
const posts = (page, re) => page.evaluate(src => window.__calls.filter(c => c.method === 'POST' && new RegExp(src).test(c.path)), re.source);
const openGroup = async page => {
  await page.getByText('Design review').first().click();
  await page.locator('[data-testid="chat-message"]').filter({ hasText: 'Can someone check the report?' }).waitFor();
};

try {
  // ---- @mentions
  {
    const page = await open();
    await openGroup(page);
    const box = page.getByLabel('Message', { exact: true });
    await box.click();
    await box.type('Thanks @pr');
    await page.waitForSelector('[data-testid="mention-list"]');
    const offered = await page.$$eval('[data-testid="mention-option"]', os => os.map(o => o.textContent.trim()));
    check(offered.join('|') === '@Priya Shah', 'typing "@pr" lists the matching group member', offered);
    await box.fill('');
    await box.type('@');
    await page.waitForSelector('[data-testid="mention-list"]');
    const all = await page.$$eval('[data-testid="mention-option"]', os => os.map(o => o.textContent.trim()));
    check(all.includes('@Priya Shah') && all.includes('@Rahul Verma') && !all.some(t => /Asha|Outside/.test(t)), 'only the members of this group are offered (not me, not an outsider)', all);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    check(await box.inputValue() === '@Rahul Verma ', 'Enter picks the highlighted member and writes "@Rahul Verma "', await box.inputValue());
    await box.type('and @Pri');
    await page.click('[data-testid="mention-option"]:has-text("Priya Shah")');
    await box.type('please look');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="chat-mention"]:has-text("@Priya Shah")');
    const sent = (await posts(page, /\/messages$/)).pop();
    const IDS = await page.evaluate(() => window.__ids);
    check(sent && sent.body.mentions.length === 2 && sent.body.mentions.includes(IDS.PRIYA) && sent.body.mentions.includes(IDS.RAHUL),
      'the message is sent with both tags', sent?.body);
    const marks = await page.$$eval('[data-testid="chat-mention"]', ms => ms.map(m => m.textContent));
    check(marks.includes('@Priya Shah') && marks.includes('@Rahul Verma'), 'the tagged names are highlighted in the sent message', marks);
    // a tag removed from the text is not sent
    await box.type('@Rah');
    await page.keyboard.press('Enter');
    await box.fill('never mind');
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=never mind');
    const last = (await posts(page, /\/messages$/)).pop();
    check(last && !last.body.mentions?.length, 'a tag whose "@Name" was deleted from the text is not sent', last?.body);
    check((await page.$$('[data-testid="mention-list"]')).length === 0, 'the list is closed after sending');
    await page.close();
  }
  // ---- a direct chat offers no @ list
  {
    const page = await open();
    await page.getByText('Priya Shah', { exact: true }).first().click();
    await page.waitForSelector('text=Hello Asha');
    await page.getByLabel('Message', { exact: true }).type('@P');
    check((await page.$$('[data-testid="mention-list"]')).length === 0, 'a direct chat has no @ list');
    await page.close();
  }
  // ---- reactions
  {
    const page = await open();
    await openGroup(page);
    const row = page.locator('[data-testid="chat-message"]').filter({ hasText: 'Can someone check the report?' });
    await row.hover();
    await row.locator('[data-testid="react-button"]').click();
    await page.waitForSelector('[data-testid="react-menu"]');
    const emojis = await page.$$eval('[data-testid="react-menu"] button', bs => bs.map(b => b.textContent.trim()));
    check(emojis.join(' ') === '👍 ❤️ 😂 😮 😢 🙏', 'the six reactions are offered', emojis);
    await page.click('[data-testid="react-menu"] button[data-emoji="👍"]');
    await row.locator('[data-testid="chat-reaction"][data-emoji="👍"]').waitFor();
    check(/1/.test(await row.locator('[data-testid="chat-reaction"][data-emoji="👍"]').innerText()) && await row.locator('.ch-reaction.mine').count() === 1, 'my 👍 shows below the message with its count');
    await row.locator('[data-testid="react-button"]').click();
    await page.click('[data-testid="react-menu"] button[data-emoji="😂"]');
    await row.locator('[data-testid="chat-reaction"][data-emoji="😂"]').waitFor();
    check(await row.locator('[data-testid="chat-reaction"][data-emoji="👍"]').count() === 0, 'changing it replaces my reaction (one per person)');
    // a colleague reacts elsewhere: the server changes, Realtime tells this screen
    await page.evaluate(() => { window.__serverReact('😂', window.__ids.PRIYA); window.__fireRealtime('chat_message_reactions'); });
    await page.waitForFunction(() => /2/.test(document.querySelector('[data-testid="chat-reaction"][data-emoji="😂"]')?.textContent || ''));
    check(true, 'a colleague\'s reaction arrives live: 😂 2, without a refresh');
    await row.locator('[data-testid="chat-reactions-who"]').click();
    await page.waitForSelector('[data-testid="reactions-who"]');
    const who = await page.innerText('[data-testid="reactions-who"]');
    check(/You/.test(who) && /Priya Shah/.test(who), 'who reacted is listed', who);
    await page.click('button:has-text("Close")');
    await row.locator('[data-testid="chat-reaction"][data-emoji="😂"]').click();
    await page.waitForFunction(() => /1/.test(document.querySelector('[data-testid="chat-reaction"][data-emoji="😂"]')?.textContent || ''));
    check(await row.locator('.ch-reaction.mine').count() === 0, 'pressing my reaction removes it');
    const sentReactions = await posts(page, /\/reaction$/);
    check(sentReactions.map(c => c.body.emoji).join(',') === '👍,😂,', 'each change went to the server (👍, then 😂, then removed)', sentReactions.map(c => c.body));
    await page.close();
  }
  // ---- Delete Inbox (a Team Member: mine only)
  {
    const page = await open();
    await page.waitForSelector('text=Design review');
    await page.click('[data-testid="inbox-menu-button"]');
    check(await page.isVisible('[data-testid="inbox-delete-mine"]') && !(await page.isVisible('[data-testid="inbox-delete-all"]')), 'a Team Member is offered "Delete inbox" only (not the company-wide delete)');
    await page.click('[data-testid="inbox-delete-mine"]');
    const dialog = await page.innerText('[role="dialog"]');
    check(/entire history of every direct chat and group/.test(dialog) && /for you only/.test(dialog) && /cannot be undone/.test(dialog), 'the confirmation says the whole inbox history is removed', dialog);
    await page.click('button:has-text("Cancel")');
    check((await posts(page, /inbox/)).length === 0, 'Cancel deletes nothing');
    await page.click('[data-testid="inbox-menu-button"]');
    await page.click('[data-testid="inbox-delete-mine"]');
    await page.click('[data-testid="inbox-confirm"]');
    await page.waitForSelector('[data-testid="inbox-done"]');
    check((await posts(page, /\/chat\/inbox\/clear$/)).length === 1, 'confirming asks the server once');
    check(await page.isVisible('text=No chats yet') && !(await page.isVisible('text=Design review')), 'the inbox is empty at once');
    await page.close();
  }
  // ---- Delete all chat history (the Super Admin): the typed confirmation
  {
    const page = await open({ role: 'SUPER_ADMIN' });
    await page.waitForSelector('text=Design review');
    await page.click('[data-testid="inbox-menu-button"]');
    await page.click('[data-testid="inbox-delete-all"]');
    check(await page.$eval('[data-testid="inbox-confirm"]', b => b.disabled), 'the company-wide delete stays disabled until DELETE ALL CHATS is typed');
    await page.fill('[data-testid="inbox-confirm-text"]', 'DELETE ALL CHATS');
    await page.click('[data-testid="inbox-confirm"]');
    await page.waitForSelector('[data-testid="inbox-done"]');
    const sent = (await posts(page, /\/chat\/inbox\/purge$/)).pop();
    check(sent?.body.confirm === 'DELETE ALL CHATS' && /for everybody/.test(await page.innerText('[data-testid="inbox-done"]')), 'the Super Admin deletes every internal chat; the confirmation goes to the server', sent?.body);
    await page.close();
  }
  // ---- a mention notification opens the group on that message (on an earlier page)
  {
    const page = await open({ conversationId: '00000000-0000-4000-8000-0000000000a1', messageId: null });
    const focus = await page.evaluate(() => window.__focusMessage);
    await page.close();
    const p2 = await open({ conversationId: '00000000-0000-4000-8000-0000000000a1', messageId: focus });
    await p2.waitForSelector('.ch-row.ch-focus');
    check(await p2.$eval('.ch-row.ch-focus', e => e.textContent.includes('The message you were tagged in')), 'the notification opens the group, loads the earlier page and highlights the message');
    check(await p2.$eval('.ch-row.ch-focus [data-testid="chat-mention"]', e => e.className.includes('me')), 'my own name is highlighted differently');
    await p2.close();
  }
  // ---- phone width
  {
    const page = await open({}, { width: 360, height: 740 });
    await openGroup(page);
    const row = page.locator('[data-testid="chat-message"]').filter({ hasText: 'Can someone check the report?' });
    await row.locator('[data-testid="react-button"]').click();
    const m = await page.evaluate(() => {
      const menu = document.querySelector('[data-testid="react-menu"]').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, left: menu.left, right: menu.right };
    });
    check(m.sw <= m.iw + 1 && m.left >= 0 && m.right <= m.iw + 1, 'phone width: the reaction picker fits on screen', m);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== CHAT MENTIONS, REACTIONS AND INBOX BROWSER TESTS PASSED (${passed}) ===`);
