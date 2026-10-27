/**
 * Expiry reminders by e-mail and WhatsApp (server/automations/subscriptionMessages.ts): the wording is filled with escaped values, the Wabastore
 * request and its outcomes, the staging allow-list, and the queue driver in dry run / live (against a stub database, no network).
 */
import {
  WabastoreSender, fillTemplate, messageMode, renderReminderEmail, renderReminderWhatsApp, runSubscriptionMessages, wabastoreConfig, wabastorePayload, wabastoreSender,
  type ReminderMessage, type WabastoreFetch
} from '../../server/automations/subscriptionMessages.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const msg = (over: Partial<ReminderMessage> = {}): ReminderMessage => ({
  id: 'rem-1', channel: 'EMAIL', attempts: 1, stage: 7, expiryDate: '2027-03-17', daysLeft: 7, to: 'meera@joshi.example', customerId: 'c1', name: 'Meera Joshi', firstName: 'Meera',
  company: 'Joshi Sweets', serviceCode: 'AI_CALLING', serviceName: 'AI Calling', planName: 'Gold',
  template: { subject: 'Your {{service}} expires in {{daysLeft}} days', body: 'Dear {{name}},\n\nYour {{service}} for {{company}} ends on {{expiryDate}}.', providerTemplate: null, approved: true },
  ...over
});

// modes
check(messageMode('EMAIL', {} as any) === 'dry_run' && messageMode('WHATSAPP', {} as any) === 'dry_run', 'the default mode is dry run');
check(messageMode('EMAIL', { AUTOMATION_MODE_SUB_EMAIL: 'live' } as any) === 'live' && messageMode('EMAIL', { AUTOMATION_MODE_SUB_EMAIL: 'off' } as any) === 'off', 'each channel has its own switch');
check(messageMode('WHATSAPP', { AUTOMATION_MODE_SUB_EMAIL: 'live' } as any) === 'dry_run', '... the e-mail switch does not turn WhatsApp on');
check(messageMode('EMAIL', { AUTOMATION_MODE_SUB_EMAIL: 'banana' } as any) === 'dry_run', 'an unknown value is a dry run, never live');

// wording
check(fillTemplate('Hi {{ name }} {{nothing}}!', { name: 'A' }) === 'Hi A !', 'a placeholder is filled; an unknown one is left out, not printed');
const mail = renderReminderEmail(msg());
check(mail.subject === 'Your AI Calling expires in 7 days', 'the subject is filled', mail.subject);
check(mail.html.includes('<p>Dear Meera Joshi,</p>') && mail.html.includes('ends on 17 March 2027'), 'the body is filled, the date written out', mail.html);
check(mail.text.includes('Dear Meera Joshi,') && !mail.text.includes('<'), 'a plain-text version exists');
const evil = renderReminderEmail(msg({ name: '<script>alert(1)</script>', company: 'A & B', template: { subject: 'Hi {{name}}\r\nBcc: x@y.z', body: 'Dear {{name}} of {{company}}', providerTemplate: null, approved: true } }));
check(!evil.html.includes('<script>') && evil.html.includes('&lt;script&gt;') && evil.html.includes('A &amp; B'), 'customer values are HTML-escaped in the body');
check(!/[\r\n]/.test(evil.subject), 'a line break cannot be smuggled into the subject');
check(renderReminderEmail(msg({ company: null })).html.includes('for Amuwa Corporation'), 'a missing company falls back to the company name');
check(renderReminderEmail(msg({ template: { subject: null, body: 'x', providerTemplate: null, approved: true } })).subject.length > 0, 'a missing subject still has one');
check(renderReminderWhatsApp(msg({ channel: 'WHATSAPP', to: '+919820000123', template: { subject: null, body: 'Hi {{firstName}} {{name}}, {{service}} ends {{expiryDate}}', providerTemplate: null, approved: true } })) === 'Hi  Meera Joshi, AI Calling ends 17 March 2027',
  'the WhatsApp text is plain (unknown placeholder dropped)');

// Wabastore request
check(wabastoreConfig({} as any).webhookUrl === null && wabastoreSender({} as any) === null, 'no WABASTORE_WEBHOOK_URL: no sender');
check(wabastoreConfig({ WABASTORE_WEBHOOK_URL: 'http://x.example.test/y' } as any).webhookUrl === null, 'plain http is refused');
check(wabastoreConfig({ WABASTORE_WEBHOOK_URL: 'http://localhost:9/y' } as any).webhookUrl !== null, 'http is allowed for a local test server');
check(wabastoreSender({ WABASTORE_WEBHOOK_URL: 'https://api.wabastore.example/send' } as any) !== null, 'the sender exists once the address is set');
const wm = msg({ channel: 'WHATSAPP', to: '+919820000123', template: { subject: null, body: 'Hi {{name}}', providerTemplate: 'expiry_7', approved: true } });
const payload = wabastorePayload(wm);
check(payload.to === '+919820000123' && payload.template === 'expiry_7' && payload.reference === 'subscription-reminder:rem-1' && payload.text === 'Hi Meera Joshi', 'the payload names the number, the approved template, a reference and the text', payload);
check(!JSON.stringify(payload).includes('meera@joshi'), 'and carries no e-mail address or other contact data');

const cfg = (over: Partial<ReturnType<typeof wabastoreConfig>> = {}) => ({ ...wabastoreConfig({ WABASTORE_WEBHOOK_URL: 'https://api.wabastore.example/send' } as any), ...over });
const fake = (status: number, body = '', onCall?: (url: string, init: any) => void): WabastoreFetch => async (url, init) => {
  onCall?.(url, init);
  return { status, text: async () => body };
};
let seen: any = null;
const ok = await new WabastoreSender(cfg({ apiKey: 'k-123' }), fake(200, '{"id":"wamid.42"}', (u, i) => (seen = { u, i }))).send(wm);
check(ok.outcome === 'ACCEPTED' && ok.ref === 'wamid.42' && ok.code === 200, 'a 2xx is accepted, with the provider\'s reference', ok);
check(seen.u === 'https://api.wabastore.example/send' && seen.i.headers.authorization === 'Bearer k-123', 'the key is sent as a bearer token');
check((await new WabastoreSender(cfg(), fake(503)).send(wm)).outcome === 'RETRY', 'busy / unavailable is retried');
check((await new WabastoreSender(cfg(), fake(429)).send(wm)).outcome === 'RETRY', 'a rate limit is retried');
const refused = await new WabastoreSender(cfg(), fake(400, '{"echo":"+919820000123 Hi Meera"}')).send(wm);
check(refused.outcome === 'FAILED' && !refused.detail.includes('9820000123') && !refused.detail.includes('Meera'), 'a refused request is not retried, and the answer (which may echo the message) is not stored', refused);
check((await new WabastoreSender(cfg(), async () => { throw new Error('down'); }).send(wm)).outcome === 'RETRY', 'a network failure is retried');
let called = false;
const bad = await new WabastoreSender(cfg(), fake(200, '', () => (called = true))).send({ ...wm, to: '+9112345' });
check(bad.outcome === 'FAILED' && !called, 'a bad number never reaches the webhook');
check((await new WabastoreSender(cfg({ webhookUrl: null }), fake(200)).send(wm)).outcome === 'FAILED', 'without an address nothing is sent');
process.env.AUTOMATION_TEST_RECIPIENTS = '9000000001';
called = false;
const staged = await new WabastoreSender(cfg(), fake(200, '', () => (called = true))).send(wm);
check(staged.outcome === 'SKIPPED' && !called, 'staging allow-list: a number that is not listed is skipped');
delete process.env.AUTOMATION_TEST_RECIPIENTS;

// the queue driver, against a stub database
function stubDb(batches: ReminderMessage[][]) {
  const finished: any[] = [];
  const claims: any[] = [];
  const schedules: any[] = [];
  const db: any = {
    rpc: async (fn: string, args: any) => {
      if (fn === 'sub_reminder_schedule') {
        schedules.push(args);
        return { data: { created: 0, cancelled: 0 }, error: null };
      }
      if (fn === 'sub_message_claim') {
        claims.push(args);
        return { data: batches.shift() ?? [], error: null };
      }
      if (fn === 'sub_message_finish') {
        finished.push(args);
        return { data: { status: args.p_outcome }, error: null };
      }
      return { data: null, error: { message: 'unexpected ' + fn } };
    }
  };
  return { db, finished, claims, schedules };
}
{
  const s = stubDb([[msg(), msg({ id: 'rem-2' })]]);
  const r = await runSubscriptionMessages('EMAIL', { db: s.db, mode: 'dry_run', sender: { send: async () => { throw new Error('must not send'); } } });
  check(r.claimed === 2 && r.dryRun === 2 && s.finished.every(f => f.p_outcome === 'DRY_RUN'), 'dry run: claimed, logged, never sent', r);
  check(s.finished.every(f => /^Dry run - not sent/.test(f.p_detail) && !f.p_detail.includes('meera@joshi') && f.p_detail.includes('m***@joshi.example')), 'the dry-run note masks the address');
  check(s.claims[0].p_channel === 'EMAIL' && s.claims[0].p_mode === 'dry_run', 'the claim names the channel and the mode');
  check(s.schedules.length === 1 && JSON.stringify(s.schedules[0].p_channels) === '["EMAIL"]', 'each run schedules only its own channel');
}
{
  const s = stubDb([[msg(), msg({ id: 'rem-2' }), msg({ id: 'rem-3' }), msg({ id: 'rem-4' })]]);
  const outcomes = ['ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED'] as const;
  let n = 0;
  const r = await runSubscriptionMessages('EMAIL', { db: s.db, mode: 'live', sender: { send: async () => ({ outcome: outcomes[n++], detail: 'x' }) } });
  check(r.accepted === 1 && r.retrying === 1 && r.failed === 1 && r.skipped === 1, 'live: every outcome is recorded', r);
}
{
  const s = stubDb([[msg({ template: { subject: 's', body: 'b', providerTemplate: null, approved: false } })]]);
  let sent = false;
  const r = await runSubscriptionMessages('EMAIL', { db: s.db, mode: 'live', sender: { send: async () => ((sent = true), { outcome: 'ACCEPTED', detail: '' }) } });
  check(!sent && r.skipped === 1, 'live: wording that is not approved is never sent, even if it reaches the driver');
}
{
  const s = stubDb([[msg()]]);
  const r = await runSubscriptionMessages('EMAIL', { db: s.db, mode: 'live', sender: { send: async () => { throw new Error('boom'); } } });
  check(r.retrying === 1, 'a sender that throws leads to a retry, not a crash', r);
}
{
  const s = stubDb([[msg()]]);
  const r = await runSubscriptionMessages('WHATSAPP', { db: s.db, mode: 'live', sender: null });
  check(r.mode === 'off' && !s.claims.length && /WABASTORE_WEBHOOK_URL/.test(r.note ?? ''), 'live without a provider: nothing claimed, nothing sent, and it says why', r);
  const e = await runSubscriptionMessages('EMAIL', { db: s.db, mode: 'live', sender: null });
  check(e.mode === 'off' && /EMAIL_PROVIDER/.test(e.note ?? ''), '... the same for e-mail');
  const off = await runSubscriptionMessages('EMAIL', { db: s.db, mode: 'off' });
  check(off.claimed === 0 && !s.claims.length, 'off: nothing happens');
}
{
  const db: any = { rpc: async () => ({ data: null, error: { message: 'db down' } }) };
  const r = await runSubscriptionMessages('EMAIL', { db, mode: 'dry_run' });
  check(r.error?.includes('db down'), 'a database error is reported, not thrown', r);
}
console.log(`\n${passed} checks passed`);
