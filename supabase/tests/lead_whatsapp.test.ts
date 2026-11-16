/**
 * The lead welcome WhatsApp (server/leads/whatsapp.ts): the request to Wabastore carries the approved template with its parameters in the
 * template's order, dry run sends nothing, live needs the approved template and a connected Wabastore, outcomes are recorded as they happened,
 * the routes that assign leads send at once, and a delivery report reaches the lead message when it is not an invoice's. A stub database and a
 * fake fetch stand in: nothing real is sent.
 */
import {
  WabastoreLeadSender, assignsLeads, leadVariableValue, leadWhatsAppDelivery, leadWhatsAppMode, leadWhatsAppPayload, leadWhatsAppSender,
  runLeadWhatsApp, applyLeadDeliveryReport, type LeadWhatsAppJob, type LeadWhatsAppSender
} from '../../server/leads/whatsapp.js';
import { leadWhatsAppSettingsSchema } from '../../shared/validation.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const job = (over: Partial<LeadWhatsAppJob> = {}): LeadWhatsAppJob => ({
  id: 'd-1', attempts: 1, customerId: 'c-1', leadName: 'Ravi Joshi', leadCompany: 'Joshi Sweets', salesPersonName: 'Priya Shah', salesPersonPhone: '98765 43210',
  to: '+919820000123', template: { name: 'lead_welcome', language: 'en', approved: true, variables: ['LEAD_NAME', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE'] }, ...over
});

// ---------------------------------------------------------------- modes
check(leadWhatsAppMode({} as any) === 'dry_run' && leadWhatsAppMode({ AUTOMATION_MODE_LEAD_WHATSAPP: 'live' } as any) === 'live' && leadWhatsAppMode({ AUTOMATION_MODE_LEAD_WHATSAPP: 'yes' } as any) === 'dry_run',
  'the default mode is dry run; an unknown value is never live');
check(leadWhatsAppMode({ AUTOMATION_MODE: 'live' } as any) === 'live' && leadWhatsAppMode({ AUTOMATION_MODE: 'live', AUTOMATION_MODE_LEAD_WHATSAPP: 'off' } as any) === 'off',
  'without its own variable it follows AUTOMATION_MODE; its own variable wins');
check(!leadWhatsAppDelivery({ AUTOMATION_MODE_LEAD_WHATSAPP: 'live' } as any).ready && /WABASTORE_WEBHOOK_URL/.test(leadWhatsAppDelivery({ AUTOMATION_MODE_LEAD_WHATSAPP: 'live' } as any).note),
  'live without Wabastore is not ready, and says what is missing');
check(leadWhatsAppDelivery({ AUTOMATION_MODE_LEAD_WHATSAPP: 'live', WABASTORE_WEBHOOK_URL: 'https://wabastore.example.test/send' } as any).ready, 'live with Wabastore is ready');
check(leadWhatsAppSender({} as any) === null && leadWhatsAppSender({ WABASTORE_WEBHOOK_URL: 'https://wabastore.example.test/send' } as any) instanceof WabastoreLeadSender,
  'there is a sender only when Wabastore is connected');

// ---------------------------------------------------------------- the payload
{
  const p = leadWhatsAppPayload(job()) as any;
  check(p.reference === 'lead-whatsapp:d-1' && p.to === '+919820000123' && p.template === 'lead_welcome' && p.language === 'en', 'the request names the message, the number and the approved template');
  check(JSON.stringify(p.parameters) === JSON.stringify(['Ravi Joshi', 'Priya Shah', '+91 9876543210']), "the parameters follow the template's variable order, the phone written to be dialled", p.parameters);
  check(p.variables.leadCompany === 'Joshi Sweets' && p.variables.salesPersonName === 'Priya Shah', 'the same values are also sent by name');
  const q = leadWhatsAppPayload(job({ leadName: '  ', leadCompany: null, salesPersonName: null, salesPersonPhone: null, template: { name: 'x', language: 'en', approved: true, variables: ['LEAD_NAME', 'LEAD_COMPANY', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE'] } })) as any;
  check(q.parameters.every((v: string) => v.trim().length > 0), 'a missing value is never sent empty (WhatsApp refuses an empty parameter)', q.parameters);
  check(leadVariableValue(job({ salesPersonPhone: '022-1234' }), 'SALES_PERSON_PHONE') === '022-1234', 'a landline is kept as typed');
}

// ---------------------------------------------------------------- the settings input
check(leadWhatsAppSettingsSchema.safeParse({ enabled: true, templateName: 'lead_welcome', templateLanguage: 'en', templateApproved: true, variables: ['LEAD_NAME'] }).success, 'settings: a valid save');
check(!leadWhatsAppSettingsSchema.safeParse({ enabled: true, templateApproved: true, variables: ['LEAD_EMAIL'] }).success, 'settings: only the known CRM values fill a variable');
check(!leadWhatsAppSettingsSchema.safeParse({ enabled: true, templateApproved: true, variables: [], extra: 1 }).success, 'settings: unknown fields are refused');

// ---------------------------------------------------------------- the routes that assign leads send at once
check(assignsLeads('POST', '/pipeline/leads') && assignsLeads('PATCH', '/pipeline/leads/abc') && assignsLeads('POST', '/sales-head/sheets') && assignsLeads('POST', '/sales-head/leads/x/assign')
  && assignsLeads('POST', '/telecaller/lists') && assignsLeads('POST', '/lead-uploads/abc/rows') && assignsLeads('POST', '/ba/leads') && assignsLeads('POST', '/customers/import') && assignsLeads('POST', '/field-visits/lead-queue/x/assign'),
  'creating, assigning, uploading and importing leads send the welcome message at once');
check(!assignsLeads('GET', '/pipeline/leads') && !assignsLeads('POST', '/meetings') && !assignsLeads('POST', '/sales-head/sheets/x/source'), 'reads and unrelated routes do not');

// ---------------------------------------------------------------- the driver
function stubDb(batches: LeadWhatsAppJob[][]) {
  const finished: any[] = [];
  const claims: any[] = [];
  const db: any = {
    rpc: async (fn: string, args: any) => {
      if (fn === 'lead_whatsapp_claim') { claims.push(args); return { data: batches.shift() ?? [], error: null }; }
      if (fn === 'lead_whatsapp_finish') { finished.push(args); return { data: { status: args.p_outcome }, error: null }; }
      if (fn === 'lead_whatsapp_status_update') { return { data: { matched: args.p_ref === 'wamid.L1' }, error: null }; }
      return { data: null, error: { message: 'unexpected ' + fn } };
    }
  };
  return { db, finished, claims };
}
const never: LeadWhatsAppSender = { send: async () => { throw new Error('must not send'); } };
{
  const s = stubDb([[job()]]);
  const r = await runLeadWhatsApp({ db: s.db, mode: 'dry_run', sender: never });
  check(r.dryRun === 1 && s.finished[0].p_outcome === 'DRY_RUN' && s.claims[0].p_mode === 'dry_run', 'dry run: logged, nothing sent', r);
  check(/^Dry run - not sent/.test(s.finished[0].p_detail) && !s.finished[0].p_detail.includes('9820000123'), 'the dry-run note masks the number');
}
{
  const s = stubDb([[job()]]);
  const r = await runLeadWhatsApp({ db: s.db, mode: 'off', sender: never });
  check(r.claimed === 0 && s.claims.length === 0, 'off: nothing is even claimed');
}
{
  const s = stubDb([[job()]]);
  const r = await runLeadWhatsApp({ db: s.db, mode: 'live', sender: null });
  check(r.mode === 'off' && r.claimed === 0 && /WABASTORE_WEBHOOK_URL/.test(r.note ?? ''), 'live without Wabastore: nothing claimed, and it says why', r);
}
{
  const s = stubDb([[job({ template: { name: 'lead_welcome', language: 'en', approved: false, variables: ['LEAD_NAME'] } })]]);
  const r = await runLeadWhatsApp({ db: s.db, mode: 'live', sender: never });
  check(r.skipped === 1 && /not approved/.test(s.finished[0].p_detail), 'live: a template that is not approved is never sent');
}
{
  let given: LeadWhatsAppJob | null = null;
  const s = stubDb([[job()]]);
  const r = await runLeadWhatsApp({ db: s.db, mode: 'live', sender: { send: async j => ((given = j), { outcome: 'ACCEPTED', detail: 'ok', code: 200, ref: 'wamid.L1' }) } });
  check(r.accepted === 1 && s.finished[0].p_ref === 'wamid.L1' && given !== null, 'live: accepted, with the provider reference', r);
}
{
  const outcomes = ['ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED'] as const;
  let n = 0;
  const s = stubDb([[job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' }), job({ id: 'd' })]]);
  const r = await runLeadWhatsApp({ db: s.db, mode: 'live', sender: { send: async () => ({ outcome: outcomes[n++], detail: 'x' }) } });
  check(r.accepted === 1 && r.retrying === 1 && r.failed === 1 && r.skipped === 1, 'each outcome is recorded as it happened', r);
}
{
  const s = stubDb([[job()]]);
  const r = await runLeadWhatsApp({ db: s.db, mode: 'live', sender: { send: async () => { throw new TypeError('boom'); } } });
  check(r.retrying === 1 && s.finished[0].p_outcome === 'RETRY', 'a sender that throws is retried, not lost');
}
{
  const r = await runLeadWhatsApp({ db: { rpc: async () => ({ data: null, error: { message: 'db down' } }) } as any, mode: 'dry_run' });
  check(r.error?.includes('db down') && r.claimed === 0, 'a database error is reported, never thrown');
}

// ---------------------------------------------------------------- Wabastore: the request it receives
{
  const calls: any[] = [];
  const saved = { ...process.env };
  delete process.env.AUTOMATION_TEST_RECIPIENTS;
  const sender = new WabastoreLeadSender(async (url, init) => (calls.push({ url, init }), new Response(JSON.stringify({ id: 'wamid.W1' }), { status: 200 })),
    { WABASTORE_WEBHOOK_URL: 'https://wabastore.example.test/send', WABASTORE_API_KEY: 'k-123' } as any);
  const out = await sender.send(job());
  const body = JSON.parse(calls[0].init.body);
  check(out.outcome === 'ACCEPTED' && out.ref === 'wamid.W1' && calls[0].url === 'https://wabastore.example.test/send' && calls[0].init.headers.authorization === 'Bearer k-123',
    'Wabastore receives the message with its key, and its reference is kept', out);
  check(body.template === 'lead_welcome' && body.parameters[0] === 'Ravi Joshi', 'the body is the lead welcome payload');
  process.env.AUTOMATION_TEST_RECIPIENTS = '9000000000';
  const blocked = await sender.send(job());
  check(blocked.outcome === 'SKIPPED' && calls.length === 1, 'AUTOMATION_TEST_RECIPIENTS: other numbers are never sent to');
  Object.assign(process.env, saved);
  if (!saved.AUTOMATION_TEST_RECIPIENTS) delete process.env.AUTOMATION_TEST_RECIPIENTS;
}

// ---------------------------------------------------------------- delivery reports
{
  const s = stubDb([]);
  check((await applyLeadDeliveryReport('wamid.L1', 'read', null, s.db)).matched && !(await applyLeadDeliveryReport('wamid.other', 'read', null, s.db)).matched,
    'a delivery report is matched by the provider reference');
}

console.log(`=== ${passed} LEAD WHATSAPP CHECKS PASSED ===`);
