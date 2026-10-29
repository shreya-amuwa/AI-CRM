/**
 * Client Panel URL: the rules (shared with the page and the database), the panel-link e-mail, and where the customer's own URL is used on the
 * "Status Completed" messages. A local server stands in for the e-mail provider and the WhatsApp webhook: nothing real is sent.
 */
import http from 'node:http';
import type net from 'node:net';
import { checkPanelUrl } from '../../shared/panelUrl.js';
import { processJob, type ClaimedJob } from '../../server/automations/dispatcher.js';
import { automationSettings } from '../../server/automations/config.js';
import { type ClientStage } from '../../server/automations/rules.js';
import { renderPanelLinkEmail } from '../../server/automations/templates.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// ---- the rules ------------------------------------------------------------------------------------------------------------------------
const url = (v: string | null) => { const r = checkPanelUrl(v); return r.ok ? r.url : `ERR:${r.message}`; };
check(url('  HTTPS://Panel.Example.com/Login ') === 'https://panel.example.com/Login', 'host lower-cased, path kept, spaces trimmed');
check(url('https://chat.wabastore.shop/login') === 'https://chat.wabastore.shop/login', 'a plain panel address is kept');
check(url('https://panel.example.com:8443/app?lang=en') === 'https://panel.example.com:8443/app?lang=en', 'a port and a harmless query are fine');
check(url('') === null && url(null) === null && url('   ') === null, 'empty clears');
for (const [bad, why] of [
  ['http://panel.example.com/login', 'http'],
  ['panel.example.com/login', 'a bare address'],
  ['javascript:alert(1)', 'a script address'],
  ['ftp://panel.example.com/', 'another scheme'],
  ['https://user:pass@panel.example.com/', 'credentials in the address'],
  ['https://panel.example.com/login?token=abc', 'a token'],
  ['https://panel.example.com/login?password=abc', 'a password'],
  ['https://panel.example.com/login?api_key=abc', 'an api key'],
  ['https://panel.example.com/a b', 'a space'],
  ['https://localhost/login', 'localhost'],
  ['https://192.168.1.10/login', 'an IP address'],
  ['https://panel.internal/login', 'an internal name'],
  ['https://nodot/login', 'a host without a dot'],
  [`https://${'a'.repeat(600)}.com`, 'too long']
] as const) check(url(bad).startsWith('ERR:'), `refused: ${why}`, url(bad));

// ---- the panel-link e-mail ------------------------------------------------------------------------------------------------------------
const mail = renderPanelLinkEmail({ name: 'Asha', businessName: 'Asha Stores', serviceName: 'WhatsApp API', panel: 'Panel X', panelUrl: 'https://panel.example.com/login?a=1&b=2', account: 'asha@example.com' });
check(/Your WhatsApp API panel link/.test(mail.subject), 'subject names the service', mail.subject);
check(mail.html.includes('href="https://panel.example.com/login?a=1&amp;b=2"') && mail.text.includes('https://panel.example.com/login'), 'the link is in both parts, escaped in the HTML');
check(!/password:/i.test(mail.html) && !/password:/i.test(mail.text), 'no password in the e-mail');
const xss = renderPanelLinkEmail({ name: '<b>x</b>', serviceName: 'S', panelUrl: 'https://panel.example.com/"><script>alert(1)</script>' });
check(!xss.html.includes('<script>') && !xss.html.includes('<b>x</b>'), 'everything is HTML-escaped');

// ---- the dispatcher -------------------------------------------------------------------------------------------------------------------
const mails: any[] = [];
const hooks: any[] = [];
let mailStatus = 200;
const srv = http.createServer((req, res) => {
  let raw = '';
  req.on('data', d => (raw += d));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url?.endsWith('/emails')) {
      mails.push(body);
      res.writeHead(mailStatus, { 'content-type': 'application/json' });
      res.end(mailStatus === 200 ? '{"id":"m1"}' : '{"error":"down"}');
    } else {
      hooks.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }
  });
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}`;
Object.assign(process.env, { AUTOMATION_MODE: 'live', EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'test-key', EMAIL_API_BASE_URL: base, EMAIL_FROM: 'CRM <crm@example.com>', WHATSAPP_WEBHOOK_URL: `${base}/wa`, WHATSAPP_SOURCE: 'AI CRM' });
delete process.env.AUTOMATION_TEST_RECIPIENTS;

const customer = { id: 'c-1', name: 'Asha', company: 'Asha Stores', email: 'asha@example.com', whatsapp: '9819900011', departmentSlug: 'wabastore', department: 'Wabastore', website: 'https://asha.example', loginEmail: 'asha@example.com', panelUrl: 'https://panel.example.com/login' };
const job = (stage: ClientStage, channel: 'EMAIL' | 'WHATSAPP', extra: Partial<ClaimedJob> = {}, cust: Partial<typeof customer> = {}): ClaimedJob => ({
  id: `j-${stage}-${channel}`, channel, stage, attempts: 0, context: {}, secret: null, customer: { ...customer, ...cust }, ...extra
});
const link = (ctx: Record<string, string>, cust: Partial<typeof customer> = {}) => job('PANEL_LINK', 'EMAIL', { context: { service: 'WHATSAPP_API', serviceName: 'WhatsApp API', panel: 'Panel X', account: 'asha@example.com', ...ctx } }, cust);

let s = automationSettings();
let o = await processJob(s, link({ panelUrl: 'https://panel.example.com/login' }));
check(o.outcome === 'SENT' && mails.length === 1, 'PANEL_LINK: one e-mail is sent', { o, n: mails.length });
check(mails[0].to[0] === 'asha@example.com' && mails[0].html.includes('https://panel.example.com/login') && !/password:/i.test(mails[0].html), 'to the customer, with the link and no password');

mails.length = 0;
o = await processJob(s, link({ panelUrl: 'http://panel.example.com/login' }));
check(o.outcome === 'FAILED' && mails.length === 0, 'a stored URL that is not HTTPS is never sent', o);
o = await processJob(s, link({ panelUrl: 'https://panel.example.com/login' }, { email: null as any }));
check(o.outcome === 'FAILED' && /e-mail address/.test(o.detail) && mails.length === 0, 'a customer without an e-mail address gets nothing, and it is recorded as not sent', o);
o = await processJob({ ...s, mode: 'dry_run' }, link({ panelUrl: 'https://panel.example.com/login' }));
check(o.outcome === 'SKIPPED' && /Dry run/.test(o.detail) && mails.length === 0, 'dry run sends nothing');
process.env.AUTOMATION_TEST_RECIPIENTS = 'someone.else@example.com';
o = await processJob(automationSettings(), link({ panelUrl: 'https://panel.example.com/login' }));
check(o.outcome === 'SKIPPED' && mails.length === 0, 'test mode: a non-test recipient gets nothing');
delete process.env.AUTOMATION_TEST_RECIPIENTS;
o = await processJob(s, job('PANEL_LINK', 'WHATSAPP', { context: { panelUrl: 'https://panel.example.com/login' } }));
check(o.outcome === 'SKIPPED' && hooks.length === 0, 'the panel link is never a WhatsApp message');
mailStatus = 503;
o = await processJob(s, link({ panelUrl: 'https://panel.example.com/login' }));
check(o.outcome === 'RETRY', 'a provider outage is retried, not reported as sent', o);
mailStatus = 200;

// the Status Completed e-mail uses the customer's own URL, then the department's
mails.length = 0;
o = await processJob(s, job('COMPLETED', 'EMAIL'));
check(o.outcome === 'SENT' && mails[0].html.includes('https://panel.example.com/login') && !mails[0].html.includes('chat.wabastore.shop'), 'COMPLETED e-mail: the customer\'s own panel URL is used');
mails.length = 0;
o = await processJob(s, job('COMPLETED', 'EMAIL', {}, { panelUrl: null as any }));
check(o.outcome === 'SENT' && mails[0].html.includes('https://chat.wabastore.shop/login'), 'COMPLETED e-mail: without one, the department\'s sign-in page');
mails.length = 0;
o = await processJob(s, job('COMPLETED', 'EMAIL', {}, { panelUrl: 'http://evil.example.com' }));
check(o.outcome === 'SENT' && mails[0].html.includes('chat.wabastore.shop') && !mails[0].html.includes('evil.example.com'), 'COMPLETED e-mail: an unsafe stored value is ignored');
mails.length = 0;
o = await processJob(s, job('COMPLETED', 'EMAIL', {}, { panelUrl: null as any, departmentSlug: 'other', department: 'Other' }));
check(o.outcome === 'SKIPPED' && mails.length === 0, 'COMPLETED e-mail: no URL anywhere, nothing is sent');

// WhatsApp: only Status Completed carries panel_url; nothing else changes
hooks.length = 0;
await processJob(s, job('COMPLETED', 'WHATSAPP'));
check(hooks.length === 1 && hooks[0].panel_url === 'https://panel.example.com/login' && hooks[0].status === 'Status Completed' && hooks[0].stage_code === 'COMPLETED', 'COMPLETED WhatsApp: the panel URL travels with the message');
for (const stage of ['WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'WEBSITE_READY'] as ClientStage[]) {
  hooks.length = 0;
  await processJob(s, job(stage, 'WHATSAPP'));
  check(hooks.length === 1 && !('panel_url' in hooks[0]), `${stage} WhatsApp: no panel_url field`);
}
hooks.length = 0;
await processJob(s, job('COMPLETED', 'WHATSAPP', {}, { panelUrl: 'http://evil.example.com' }));
check(hooks.length === 1 && !('panel_url' in hooks[0]), 'an unsafe stored value is never posted');

srv.close();
console.log(`\n${passed} checks passed`);
