// Browser test of the client dashboard's onboarding journey: the timeline, the sections that are visibly closed (and stay closed when
// their address is typed), the stage-based chat, and the layout on phone / desktop. The real ClientApp and the app's real stylesheet
// (npm run build first); the Supabase client and the API are stand-ins that follow the real contract. The stand-in API also records every
// request, so the test can prove that a closed section asks the server for nothing. Skipped, loudly, when Playwright, Chromium or dist/
// are missing.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the client journey browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the client journey browser test did not run'); process.exit(0); }
// the dashboard's own stylesheet is a separate chunk of the build: use every stylesheet of the build
const css = readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n');

const stub = path.resolve('supabase/tests/ui/client_journey_supabase_stub.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/client_journey_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

/** The stand-in server. `scenario` decides where the client is in the journey. */
const server = (scenario) => {
  const GATED = ['/client/services', '/client/campaigns', '/client/catalog', '/client/service-requests', '/client/plans', '/client/tickets', '/client/calendar'];
  const person = (name, position) => ({ name, position });
  const stage = (key, status, extra = {}) => ({ key, status, current: false, ...extra });
  const done = scenario === 'done';
  // 'team': the customer's services are verified by our own team, not by Meta (a newer server sends external:false, the service's own progress and a figure)
  const team = scenario === 'team';
  const meta = scenario === 'docs' ? 'DOCUMENTS_REQUIRED' : scenario === 'rejected' ? 'REJECTED' : scenario === 'progress' || team ? 'IN_PROGRESS' : done || scenario === 'rm' ? 'COMPLETED' : 'PENDING';
  const metaDone = meta === 'COMPLETED';
  const closedReason = !metaDone ? 'Available after Meta verification is completed.' : 'Available after service setup is completed.';
  const open = done;
  const sec = (enabled, reason) => ({ enabled, reason: enabled ? null : reason });
  const access = {
    overview: sec(true), journey: sec(true), subscription: sec(true), documents: sec(true), invoices: sec(true), chat: sec(true), notifications: sec(true), docs: sec(true),
    services: sec(open, closedReason), campaigns: sec(open, closedReason), calendar: sec(open, closedReason),
    tickets: sec(done, !metaDone ? 'Available after Meta verification is completed.' : 'Available after your Relationship Manager is assigned.'),
    explore: sec(done, 'Available after onboarding is completed.'), plans: sec(done, 'Available after onboarding is completed.')
  };
  const stages = [
    stage('PAYMENT', 'COMPLETED', { completedAt: '2026-10-20T09:00:00Z', accountCreatedAt: '2026-10-20T09:05:00Z', accountEmail: 'client@example.com' }),
    stage('META_VERIFICATION', metaDone ? 'COMPLETED' : meta === 'DOCUMENTS_REQUIRED' ? 'ACTION_REQUIRED' : meta === 'REJECTED' ? 'REJECTED' : meta === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING', {
      required: true, ...(team ? { external: false, title: 'Verification by our team' } : {}), metaStatus: meta, startedAt: meta === 'PENDING' ? null : '2026-10-21T09:00:00Z', completedAt: metaDone ? '2026-10-25T09:00:00Z' : null,
      feedback: meta === 'DOCUMENTS_REQUIRED' ? '1 document was sent back for correction.' : meta === 'REJECTED' ? 'Meta asked for a clearer business proof' : null,
      updatedAt: '2026-10-22T09:00:00Z',
      outstanding: meta === 'DOCUMENTS_REQUIRED' ? [{ code: 'CUSTOMER_NAME', label: 'Business name proof', status: 'REJECTED', note: 'The name does not match the certificate' }] : [],
      verifier: person('Vera Verifier', 'Technical Consultant') }),
    stage('RELATIONSHIP_MANAGER', done ? 'COMPLETED' : metaDone ? 'IN_PROGRESS' : 'PENDING', { required: true, completedAt: done ? '2026-10-26T09:00:00Z' : null,
      manager: done ? person('Ravi Manager', 'Relationship Manager') : null, teamLead: done ? person('Tara Lead', 'Team Lead') : null }),
    stage('SERVICE_SETUP', done ? 'COMPLETED' : 'PENDING', { completedAt: done ? '2026-10-28T09:00:00Z' : null, services: [
      { code: 'AI_CALLING', name: 'AI Calling', category: 'Messaging & AI', status: done ? 'READY' : 'PENDING', waitingFor: done ? null : metaDone ? 'Relationship Manager assignment' : team ? 'Verification by our team' : 'Meta verification', readyAt: done ? '2026-10-28T09:00:00Z' : null, note: null,
        ...(team ? { track: 'TECHNICAL', headline: 'Verification by our team', percent: 40, actionRequired: true } : {}) }] }),
    stage('COMPLETED', done ? 'COMPLETED' : 'PENDING', { completedAt: done ? '2026-10-28T09:00:00Z' : null })
  ];
  const cur = done ? 'COMPLETED' : metaDone ? (scenario === 'rm' ? 'RELATIONSHIP_MANAGER' : 'SERVICE_SETUP') : 'META_VERIFICATION';
  stages.forEach(s => { s.current = s.key === cur; });
  const journey = {
    stage: cur, completed: done, completedAt: done ? '2026-10-28T09:00:00Z' : null, stages,
    ...(team ? { progress: { done: 2, total: 5, percent: 40 } } : {}),
    chat: { active: metaDone ? 'RM' : 'META', channels: [
      { channel: 'META', label: 'Meta verification', open: !metaDone, visible: true, with: person('Vera Verifier', 'Technical Consultant') },
      { channel: 'RM', label: 'Relationship Manager', open: done, visible: metaDone, with: done ? person('Ravi Manager', 'Relationship Manager') : null }] },
    access
  };
  window.__calls = [];
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  const me = { customerId: 'c1', name: 'Asha Client', businessName: 'Asha Traders', email: 'client@example.com', phone: '9820000000', segment: 'SMB', status: 'ACTIVE', department: 'Wabastore', loginEmail: 'client@example.com', clientSince: '2026-10-20T09:00:00Z' };
  const conversation = (channel) => ({
    id: `conv-${channel}`, kind: 'CLIENT', channel, access: 'CLIENT', canWrite: channel === 'META' ? !metaDone : done, title: channel === 'META' ? 'Meta verification' : 'Your Amuwa team',
    blockReason: channel === 'META' ? (metaDone ? 'Meta verification is completed. This conversation is closed; your Relationship Manager continues with you.' : null) : (done ? null : 'Your team has not been assigned yet.'),
    customer: null, team: channel === 'RM' ? { teamMember: done ? person('Ravi Manager', null) : null, teamLead: done ? person('Tara Lead', null) : null } : null,
    verifier: person('Vera Verifier', 'Technical Consultant'), members: null, isAdmin: false, assigned: true, lastSeq: 1, lastMessageAt: '2026-10-22T09:00:00Z', lastMessagePreview: 'Hello', lastSenderName: 'Vera',
    unread: 0, readSeq: 1, peerReadSeq: 1, createdAt: '2026-10-21T09:00:00Z' });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const p = u.pathname.replace('/api/v1', '');
    window.__calls.push(`${(init.method || 'GET').toUpperCase()} ${p}${u.search}`);
    if (p === '/client/me') return json(me);
    if (p === '/client/journey') return json(journey);
    if (p === '/client/subscription') return json([done
      ? { service: 'AI_CALLING', serviceName: 'AI Calling', plan: 'Growth', durationLabel: '6 months', status: 'ACTIVE', panelCreated: true, panelCreatedOn: '2026-10-09', startedOn: '2026-10-10', expiresOn: '2027-04-10', daysLeft: 163,
          messages: { total: 20000, used: 5000, remaining: 15000, percent: 25, asOf: '2026-10-29', reported: true }, messageCredits: 20000 }
      : { service: 'AI_CALLING', serviceName: 'AI Calling', plan: 'Growth', durationLabel: '6 months', status: 'NOT_STARTED', panelCreated: false, panelCreatedOn: null, startedOn: null, expiresOn: null, daysLeft: null,
          messages: { total: 20000, used: 0, remaining: 20000, percent: 0, asOf: null, reported: false }, messageCredits: 20000 }]);
    if (GATED.includes(p) || p.startsWith('/client/tickets')) {
      // the server refuses a closed section
      const key = p.includes('ticket') ? 'tickets' : p.includes('plan') ? 'plans' : p.includes('catalog') || p.includes('service-requests') ? 'explore' : p.includes('calendar') ? 'calendar' : p.includes('campaign') ? 'campaigns' : 'services';
      if (!access[key].enabled) return json({ code: 'FORBIDDEN', message: access[key].reason }, 403);
      return json(p === '/client/plans' ? { current: null, available: [] } : []);
    }
    if (p === '/client/documents') return json({ items: [], summary: { total: 0, provided: 0, verified: 0, needed: 0 } });
    if (p === '/client/invoices') return json([]);
    if (p === '/client/notifications') return json({ items: [], unread: 0 });
    if (p === '/client/announcements') return json([]);
    if (p === '/client/chat/unread') return json({ total: 0, internal: 0, clients: 0, review: 0 });
    if (p === '/client/chat') {
      const channel = u.searchParams.get('channel') || (metaDone ? 'RM' : 'META');
      return json({ conversation: conversation(channel), page: { messages: [], hasMore: false, lastSeq: 1 } });
    }
    if (p === '/client/chat/messages') return json({ messages: [], hasMore: false, lastSeq: 1 });
    return json({ code: 'NOT_FOUND', message: 'no' }, 404);
  };
};

const open = async (scenario, vp, route = '/client/dashboard/overview') => {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
  // every address on localhost is the same page (the app routes itself); nothing else is fetched
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'localhost') return r.abort();
    return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>` });
  });
  await page.goto(`http://localhost${route}`);
  await page.evaluate(server, scenario);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.mount());
  await page.waitForSelector('.cd-main', { timeout: 8000 });
  return page;
};
const calls = page => page.evaluate(() => window.__calls);

// ---- a new client: Meta verification pending
{
  const page = await open('pending', { width: 1280, height: 900 });
  await page.waitForSelector('text=Onboarding journey');
  const items = await page.$$eval('.cd-nav-item', els => els.map(e => ({ label: e.querySelector('.lbl, span')?.textContent?.replace(/\s+/g, ' ').trim(), disabled: e.getAttribute('aria-disabled') === 'true', text: e.textContent.replace(/\s+/g, ' ').trim() })));
  const closed = items.filter(i => i.disabled).map(i => i.text);
  for (const name of ['My Services', 'Campaigns', 'Explore Services', 'Monthly Plans', 'Calendar', 'Tickets']) {
    check(closed.some(t => t.startsWith(name) && /Available after/.test(t)), `${name} stays visible, disabled, with its reason`, closed);
  }
  for (const name of ['Overview', 'Onboarding Journey', 'Documents', 'Invoices', 'Chat', 'Notification Center']) {
    check(items.some(i => i.text.startsWith(name) && !i.disabled), `${name} is open`, items.map(i => i.text));
  }
  check(await page.isVisible('.cd-jr-hero'), 'the overview carries the journey summary');
  check(/Meta verification/.test(await page.textContent('.cd-jr-hero')), 'which names the current stage');
  // clicking a closed item goes nowhere and says why
  const pathBefore = new URL(page.url()).pathname;
  await page.click('.cd-nav-item.locked:has-text("Tickets")', { force: true });
  check(await page.isVisible('.cd-lock-note') && /Tickets/.test(await page.textContent('.cd-lock-note')) && new URL(page.url()).pathname === pathBefore,
    'clicking a closed item stays on the page and shows why');
  const before = await calls(page);
  check(!before.some(c => /\/client\/(services|campaigns|tickets|plans|catalog|calendar)/.test(c)), 'the overview asked the server for no closed section', before);
  // typing the address of a closed section
  await page.evaluate(() => { history.pushState({}, '', '/client/dashboard/tickets'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('text=Tickets is not open yet');
  const typed = await calls(page);
  check(/Available after Meta verification/.test(await page.textContent('.cd-locked-page')) && !typed.some(c => c.startsWith('GET /client/tickets')), 'a typed address of a closed section shows the explanation and requests no data', typed);
  await page.evaluate(() => { history.pushState({}, '', '/client/dashboard/services'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('text=My Services is not open yet');
  check(!(await calls(page)).some(c => c.startsWith('GET /client/services')), 'nor does My Services');
  await page.close();
}

// ---- the journey page
{
  const page = await open('docs', { width: 1280, height: 900 }, '/client/dashboard/journey');
  await page.waitForSelector('.cd-jr');
  const stages = await page.$$eval('.cd-jr-step', els => els.map(e => ({ status: e.getAttribute('data-status'), current: e.getAttribute('data-current') === 'true', text: e.textContent.replace(/\s+/g, ' ').trim() })));
  check(stages.length === 5, 'five stages are listed', stages.map(s => s.status));
  check(stages[0].status === 'COMPLETED' && /Payment confirmed/.test(stages[0].text) && /client@example.com/.test(stages[0].text), 'stage 1 shows the confirmation, its date and the account');
  check(stages[1].status === 'ACTION_REQUIRED' && stages[1].current && /Documents required/.test(stages[1].text), 'stage 2 is current and says documents are required');
  check(/1 document was sent back/.test(stages[1].text) && /Business name proof/.test(stages[1].text) && /does not match the certificate/.test(stages[1].text), 'with the verifier\'s feedback and the exact item and note');
  check(/Vera Verifier/.test(stages[1].text) && await page.isVisible('.cd-jr-step:nth-child(2) button:has-text("Message")'), 'the verifier is shown with a way to message them');
  check(stages[2].status === 'PENDING' && /assigned after Meta verification/.test(stages[2].text) && !/Ravi/.test(stages[2].text), 'the Relationship Manager stage waits and shows nobody');
  check(stages[3].status === 'PENDING' && /Waiting for Meta verification/.test(stages[3].text), 'each service waits for what it needs');
  check(stages[4].status === 'PENDING', 'and onboarding is not complete');
  check(await page.getAttribute('.cd-jr-bar', 'aria-valuenow') === '20', 'the progress bar shows one stage of five');
  // the Documents button leads to the documents page
  await page.click('.cd-jr-step:nth-child(2) button:has-text("Open documents")');
  check(new URL(page.url()).pathname === '/client/dashboard/documents', 'the button opens the documents page');
  await page.close();
}
for (const [scenario, label, status] of [['rejected', 'Rejected', 'REJECTED'], ['progress', 'In progress', 'IN_PROGRESS'], ['pending', 'Pending', 'PENDING']]) {
  const page = await open(scenario, { width: 1280, height: 900 }, '/client/dashboard/journey');
  await page.waitForSelector('.cd-jr');
  const t = await page.textContent('.cd-jr-step:nth-child(2)');
  check(await page.getAttribute('.cd-jr-step:nth-child(2)', 'data-status') === status && t.includes(label), `Meta verification shows "${label}"`, t);
  if (scenario === 'rejected') check(/clearer business proof/.test(t), 'a rejection shows its feedback');
  await page.close();
}

// ---- chat: the Meta Verifier first
{
  const page = await open('progress', { width: 1280, height: 900 }, '/client/dashboard/chat');
  await page.waitForSelector('.ch-head');
  const c = await calls(page);
  check(c.some(x => x.startsWith('GET /client/chat') && x.includes('channel=META')) && !c.some(x => x.includes('channel=RM')), 'before verification is complete the chat opens with the Meta Verifier and never asks for the other channel', c);
  check(/Meta verification/.test(await page.textContent('.ch-head')) && /Vera Verifier/.test(await page.textContent('.ch-head')), 'the header names the Meta Verifier');
  check(await page.$('.cd-chat-tabs') === null, 'there is one conversation to choose from');
  await page.close();
}
// ---- chat: after verification the history stays and the Relationship Manager takes over
{
  const page = await open('rm', { width: 1280, height: 900 }, '/client/dashboard/chat');
  await page.waitForSelector('.cd-chat-tabs');
  const tabs = await page.$$eval('.cd-chat-tab', els => els.map(e => ({ text: e.textContent.trim(), selected: e.getAttribute('aria-selected') === 'true' })));
  check(tabs.length === 2 && tabs[1].selected && /Meta verification/.test(tabs[0].text) && /closed/.test(tabs[0].text), 'two conversations: Meta verification (closed) and the Relationship Manager (current)', tabs);
  await page.click('.cd-chat-tab:has-text("Meta verification")');
  await page.waitForFunction(() => /Meta verification is completed/.test(document.body.innerText));
  check(true, 'the Meta conversation is still readable and says it is closed');
  await page.close();
}

// ---- My Subscription before the panel is active
{
  const page = await open('pending', { width: 1280, height: 900 }, '/client/dashboard/subscription');
  await page.waitForSelector('text=Subscription Not Started');
  const t = (await page.textContent('.cd-main')).replace(/\s+/g, ' ');
  check(/Your subscription will begin once document verification is completed and your panel has been successfully created and activated\./.test(t), 'My Subscription: the "not started" message is shown before the panel is active');
  check(/Subscription duration6 months/.test(t) && /Subscription start dateNot started/.test(t) && /Subscription expiry dateCalculated once it starts/.test(t) && /Panel creation statusPending/.test(t), 'with the duration, and no start or expiry date', t);
  check(/Total message credits20,000/.test(t) && /Usage percentage0%/.test(t), 'and the message credits');
  check((await page.$$eval('.cd-nav-item', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()))).some(x => /My Subscription/.test(x)), 'the sidebar lists My Subscription, and it is not locked');
  await page.close();
}

// ---- completed: nothing is closed
{
  const page = await open('done', { width: 1280, height: 900 });
  await page.waitForSelector('.cd-nav-item');
  check((await page.$$('.cd-nav-item.locked')).length === 0, 'after onboarding every section is open');
  check(await page.$('.cd-jr-hero') === null, 'and the overview no longer carries the journey card');
  await page.evaluate(() => { history.pushState({}, '', '/client/dashboard/journey'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('.cd-jr');
  check(/Your onboarding is complete/.test(await page.textContent('.cd-jr-summary')) && await page.getAttribute('.cd-jr-bar', 'aria-valuenow') === '100', 'the journey page shows the completion');
  check(/Ravi Manager/.test(await page.textContent('.cd-jr')) && /Ready since/.test(await page.textContent('.cd-jr')), 'with the Relationship Manager and the ready service');
  await page.evaluate(() => { history.pushState({}, '', '/client/dashboard/subscription'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('text=Subscription Active');
  const t = (await page.textContent('.cd-main')).replace(/\s+/g, ' ');
  check(/started on 10 Oct 2026 and runs until 10 Apr 2027 \(163 days left\)/.test(t), 'My Subscription: active, with the actual start date, the calculated expiry and the days left', t);
  check(/Panel creation date9 Oct 2026/.test(t) && /Messages used5,000/.test(t) && /Remaining messages15,000/.test(t) && /Usage percentage25%/.test(t), 'with the panel date and the message usage');
  await page.close();
}

// ---- layout
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['tablet', { width: 820, height: 1000 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await open('docs', vp, '/client/dashboard/journey');
  await page.waitForSelector('.cd-jr');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, `${name}: the journey does not scroll sideways`, m);
  if (name === 'phone') {
    const tabs = await page.$$eval('.cd-tabbar button', els => els.map(e => e.textContent.trim()));
    check(tabs.join('|').includes('Journey') && tabs.join('|').includes('Documents') && tabs.every(t => !/Services|Tickets|Campaigns/.test(t)), 'phone: the bottom bar offers only what is open while onboarding', tabs);
  }
  await page.close();
}
// ---- a customer whose services our own team verifies (not Meta), and one service's own progress
{
  const page = await open('team', { width: 1280, height: 900 }, '/client/dashboard/journey');
  await page.waitForSelector('.cd-jr');
  const stages = await page.$$eval('.cd-jr-step', els => els.map(e => ({ status: e.getAttribute('data-status'), current: e.getAttribute('data-current') === 'true', text: e.textContent.replace(/\s+/g, ' ').trim() })));
  check(/Verification by our team/.test(stages[1].text) && !/Meta/.test(stages[1].text.replace(/Verification by our team/g, '')), 'a customer verified by our own team is not told it waits for Meta', stages[1].text);
  check(/Verification by our team/.test(await page.textContent('.cd-jr-summary')) && !/Meta Verifier/.test(await page.textContent('.cd-jr-summary')), 'the summary says the same');
  check(stages[3].status === 'PENDING' && /Waiting for Verification by our team/.test(stages[3].text) && /40% of its steps done/.test(stages[3].text), 'the service shows what it waits for and its own progress', stages[3].text);
  check(/We need something from you for this service/.test(stages[3].text), 'and that the customer must act');
  check(await page.getAttribute('.cd-jr-bar', 'aria-valuenow') === '40', 'the overall bar follows the server\'s figure from the services\' steps, not the stage count');
  await page.close();
}
await browser.close();
console.log(`=== CLIENT JOURNEY BROWSER TESTS PASSED (${passed}) ===`);
