/**
 * Onboarding messages: every stage maps to ONE e-mail and ONE WhatsApp status, and the two always come from the same stage.
 * The customer's e-mail and the WhatsApp payload are produced for the same job; a pending-verification event can never produce the completed
 * wording (e-mail subject or WhatsApp `status`). A local server stands in for the WhatsApp webhook: nothing real is sent.
 */
import http from 'node:http';
import type net from 'node:net';
import { processJob, type ClaimedJob } from '../../server/automations/dispatcher.js';
import { automationSettings } from '../../server/automations/config.js';
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
const baseMail = { name: 'Test Client', email: 'x@example.com', department: 'Wabastore', panelUrl: 'https://panel.example/login', userId: 'u', password: 'p', websiteCreated: false, website: 'https://test.example' };

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
const statuses = stages.map(st => STAGE_LABEL[st]);
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
check(/Password:/.test(renderEmail('COMPLETED', baseMail).html) && !/Password:/.test(renderEmail('UNDER_REVIEW', baseMail).html), 'only the completion e-mail carries login details');

// the e-mail and the WhatsApp for the same stage are produced by the same job stage: switching the channel changes nothing about the stage
for (const stage of stages) {
  hits.length = 0;
  await processJob(s, job(stage, 'WHATSAPP'));
  check(hits[0].stage_code === stage, `${stage}: the WhatsApp request is for the same stage as its e-mail job`);
}

srv.close();
console.log(`\n${passed} checks passed`);
