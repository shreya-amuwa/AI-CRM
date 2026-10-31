/**
 * Onboarding messages: every stage maps to ONE e-mail and ONE WhatsApp status, and the two always come from the same stage.
 * The customer's e-mail and the WhatsApp payload are produced for the same job; a pending-verification event can never produce the completed
 * wording (e-mail subject or WhatsApp `status`). A local server stands in for the WhatsApp webhook: nothing real is sent.
 */
import http from 'node:http';
import type net from 'node:net';
import { processJob, type ClaimedJob } from '../../server/automations/dispatcher.js';
import { automationSettings, whatsappStatus } from '../../server/automations/config.js';
import { STAGE_LABEL, type ClientStage } from '../../server/automations/rules.js';
import { renderEmail } from '../../server/automations/templates.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const hits: any[] = [];
const srv = http.createServer((req, res) => {
  let raw = '';
  req.on('data', d => (raw += d));
  req.on('end', () => {
    hits.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
Object.assign(process.env, { AUTOMATION_MODE: 'live', WHATSAPP_WEBHOOK_URL: `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}/wa`, WHATSAPP_SOURCE: 'AI CRM' });
delete process.env.AUTOMATION_TEST_RECIPIENTS;

// the router's exact expectations (what the Automation Builder must match on)
const EXPECTED: Record<string, { status: string; subject: RegExp }> = {
  WEBSITE_PENDING: { status: 'Website Pending', subject: /^Mini Website for Your Business/ },
  UNDER_REVIEW: { status: 'Under Review', subject: /^Documents Received – Under Review/ },
  META_VERIFICATION: { status: 'Meta Verification', subject: /^Meta Verification In Progress/ },
  COMPLETED: { status: 'Status Completed', subject: /^Meta Verification Completed – Panel Access Details/ },
  WEBSITE_READY: { status: 'Website Ready', subject: /^Your Mini Website is Ready/ }
};

const customer = { id: 'c-1', name: 'Test Client', company: 'Test Co', email: 'test.client@example.com', whatsapp: '9819900011', departmentSlug: 'wabastore', department: 'Wabastore', website: 'https://test.example', loginEmail: 'test.client@example.com' };
const job = (stage: ClientStage, channel: 'EMAIL' | 'WHATSAPP'): ClaimedJob => ({ id: `j-${stage}-${channel}`, channel, stage, attempts: 0, context: {}, secret: null, customer });

const stages = Object.keys(EXPECTED) as ClientStage[];
const s = automationSettings();
const baseMail = { name: 'Test Client', email: 'x@example.com', department: 'Wabastore', panelUrl: 'https://panel.example/login', userId: 'u', hasLogin: true, websiteCreated: false, website: 'https://test.example' };

for (const stage of stages) {
  const want = EXPECTED[stage];
  check(STAGE_LABEL[stage] === want.status, `${stage}: the WhatsApp status is "${want.status}"`, STAGE_LABEL[stage]);
  check(want.subject.test(renderEmail(stage as Exclude<ClientStage, 'ACCOUNTS_PAYMENT'>, baseMail).subject), `${stage}: the e-mail subject matches`, renderEmail(stage as any, baseMail).subject);
  hits.length = 0;
  const o = await processJob(s, job(stage, 'WHATSAPP'));
  check(o.outcome === 'SENT' && hits.length === 1, `${stage}: exactly one WhatsApp request is posted`, { o, hits: hits.length });
  check(hits[0].status === want.status && hits[0].stage_code === stage && hits[0].automation === 'Client Onboarding', `${stage}: the request carries that stage's status and its fixed stage_code`, hits[0]);
  check(hits[0].event_key === `crm|c-1|${want.status.toLowerCase()}|919819900011`, `${stage}: the event key is per stage`, hits[0].event_key);
}

// the statuses must be distinct, and none may be contained in another one's text (a router that matches "contains" cannot confuse them)
const statuses = [...stages, 'ACCOUNT_CREATED' as ClientStage].map(st => STAGE_LABEL[st]);
check(new Set(statuses).size === statuses.length, 'every stage has its own status');
const lower = statuses.map(x => x.toLowerCase());
const overlaps = lower.flatMap((a, i) => lower.filter((b, j) => i !== j && a.includes(b)).map(b => `${a} ⊃ ${b}`));
check(overlaps.length === 0, 'no status contains another status (safe even for a "contains" router rule)', overlaps);

// a pending-verification event can never dispatch the completed wording
hits.length = 0;
await processJob(s, job('META_VERIFICATION', 'WHATSAPP'));
const pending = hits[0];
check(!/complet/i.test(pending.status) && pending.stage_code !== 'COMPLETED', 'META_VERIFICATION never posts a completed status');
check(!/complet/i.test(renderEmail('META_VERIFICATION', baseMail).subject), 'META_VERIFICATION never has the completed e-mail subject');
check(!/successfully completed/i.test(renderEmail('META_VERIFICATION', baseMail).html) && !/Password:/i.test(renderEmail('META_VERIFICATION', baseMail).html), 'META_VERIFICATION e-mail has no completion wording and no credentials');
check(/User ID/.test(renderEmail('COMPLETED', baseMail).html) && !/User ID/.test(renderEmail('UNDER_REVIEW', baseMail).html), 'only the completion e-mail names the login');
for (const stage of stages) check(!/Password:/i.test(renderEmail(stage as any, baseMail).html) && !/Password:/i.test(renderEmail(stage as any, baseMail).text), `${stage}: no e-mail carries a password`);
const noLogin = renderEmail('COMPLETED', { ...baseMail, hasLogin: false }).html;
check(!/User ID/.test(noLogin) && /separate e-mail/.test(noLogin), 'with no login yet the completed e-mail does not pretend there is one');

// the completed e-mail has no sign-in / password explanation (the set-password e-mail is where that belongs)
{
  const done = renderEmail('COMPLETED', baseMail);
  for (const [kind, body] of [['html', done.html], ['text', done.text]] as const) {
    check(/successfully completed/i.test(body) && /User ID/.test(body) && body.includes(baseMail.panelUrl) && body.includes(baseMail.userId), `the completed e-mail (${kind}) still says it succeeded and names the panel and the user ID`);
    check(!/Sign in with the password/i.test(body) && !/Set your password/i.test(body) && !/Forgot password/i.test(body), `the completed e-mail (${kind}) has no sign-in or password paragraph`);
  }
  check(/team|contact/i.test(done.html) && /Amuwa Corporation/.test(done.html), 'the completed e-mail keeps the team contact and the signature');
  const evil = renderEmail('COMPLETED', { ...baseMail, name: '<script>alert(1)</script>' }).html;
  check(!evil.includes('<script>alert(1)'), 'a customer name is still escaped in the completed e-mail');
}

// "account created" is its own event: its own status and stage code, and the WhatsApp never carries a password
hits.length = 0;
const acc = await processJob(s, job('ACCOUNT_CREATED', 'WHATSAPP'));
check(acc.outcome === 'SENT' && hits.length === 1 && hits[0].status === 'Account Created' && hits[0].stage_code === 'ACCOUNT_CREATED' && hits[0].event_key === 'crm|c-1|account created|919819900011',
  'ACCOUNT_CREATED: one WhatsApp request with its own status and stage code', hits[0]);
check(!/password/i.test(JSON.stringify(hits[0])), 'and it carries no password');
check(!/complet/i.test(hits[0].status), 'and never the completed wording');

// the e-mail and the WhatsApp for the same stage are produced by the same job stage: switching the channel changes nothing about the stage
for (const stage of stages) {
  hits.length = 0;
  await processJob(s, job(stage, 'WHATSAPP'));
  check(hits[0].stage_code === stage, `${stage}: the WhatsApp request is for the same stage as its e-mail job`);
}

// the router's status text can be re-aligned with one environment variable per stage; the defaults are untouched and a pending stage can never
// be given the completed wording
for (const stage of [...stages, 'ACCOUNT_CREATED' as ClientStage]) check(whatsappStatus(stage, {}) === STAGE_LABEL[stage], `${stage}: with nothing set, the status is the default "${STAGE_LABEL[stage]}"`);
check(whatsappStatus('META_VERIFICATION', { WHATSAPP_STATUS_META_VERIFICATION: ' Meta Verification In Progress ' }) === 'Meta Verification In Progress', 'an override replaces the pending status (trimmed)');
check(whatsappStatus('META_VERIFICATION', { WHATSAPP_STATUS_META_VERIFICATION: 'Meta Verification Completed' }) === 'Meta Verification', 'a completed wording on the pending stage is ignored');
check(whatsappStatus('UNDER_REVIEW', { WHATSAPP_STATUS_UNDER_REVIEW: 'Verification complete' }) === 'Under Review', 'and so for every stage that is not the completed one');
check(whatsappStatus('COMPLETED', { WHATSAPP_STATUS_COMPLETED: 'Verification Completed' }) === 'Verification Completed', 'only the completed stage may carry it');
check(whatsappStatus('META_VERIFICATION', { WHATSAPP_STATUS_META_VERIFICATION: 'x'.repeat(61) }) === 'Meta Verification' && whatsappStatus('META_VERIFICATION', { WHATSAPP_STATUS_META_VERIFICATION: '' }) === 'Meta Verification', 'an empty or over-long value is ignored');
process.env.WHATSAPP_STATUS_META_VERIFICATION = 'Meta Verification In Progress';
hits.length = 0;
await processJob(automationSettings(), job('META_VERIFICATION', 'WHATSAPP'));
check(hits.length === 1 && hits[0].status === 'Meta Verification In Progress' && hits[0].stage_code === 'META_VERIFICATION' && hits[0].event_key === 'crm|c-1|meta verification in progress|919819900011',
  'the posted request follows the override, and the stage code and the e-mail do not change', hits[0]);
check(/^Meta Verification In Progress/.test(renderEmail('META_VERIFICATION', baseMail).subject), 'the e-mail for that stage is unchanged');
delete process.env.WHATSAPP_STATUS_META_VERIFICATION;

srv.close();
console.log(`\n${passed} checks passed`);
