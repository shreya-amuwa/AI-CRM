// Subscription terms (what Sales may enter) and the panel activation e-mail. No database: the schema is the one the page and the API share.
import { subscriptionTermsSchema, leadCreateSchema, subscriptionActivationSchema, subscriptionCorrectionSchema, subscriptionRenewalSchema } from '../../shared/validation.js';
import { renderSubscriptionActivatedEmail, longDate } from '../../server/automations/templates.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const base = { plan: 'Growth', durationCode: '6M', amount: 12000 };

check(subscriptionTermsSchema.safeParse(base).success, 'plan, a standard duration and an amount are enough');
for (const c of ['1M', '2M', '3M', '6M', '1Y', '2Y']) check(subscriptionTermsSchema.safeParse({ ...base, durationCode: c }).success, `${c} is accepted`);
check(!subscriptionTermsSchema.safeParse({ ...base, durationCode: '5M' }).success, 'an unknown duration is refused');
check(!subscriptionTermsSchema.safeParse({ plan: 'Growth', amount: 1 }).success, 'the duration is required');
check(!subscriptionTermsSchema.safeParse({ durationCode: '6M', amount: 1 }).success, 'the plan is required');
check(!subscriptionTermsSchema.safeParse({ plan: 'Growth', durationCode: '6M' }).success, 'the amount is required');
check(!subscriptionTermsSchema.safeParse({ ...base, amount: '' }).success, 'an empty amount is not zero');
check(subscriptionTermsSchema.safeParse({ ...base, durationCode: 'CUSTOM', customMonths: '5' }).success, 'a custom duration in months');
check(subscriptionTermsSchema.safeParse({ ...base, durationCode: 'CUSTOM', customDays: 45 }).success, 'a custom duration in days');
check(!subscriptionTermsSchema.safeParse({ ...base, durationCode: 'CUSTOM' }).success, 'a custom duration needs months or days');
check(!subscriptionTermsSchema.safeParse({ ...base, durationCode: 'CUSTOM', customMonths: 2, customDays: 10 }).success, 'but not both');
check(!subscriptionTermsSchema.safeParse({ ...base, customMonths: 2 }).success, 'custom months are for the custom duration only');
check(!subscriptionTermsSchema.safeParse({ ...base, durationCode: 'CUSTOM', customDays: 0 }).success && !subscriptionTermsSchema.safeParse({ ...base, durationCode: 'CUSTOM', customMonths: 121 }).success, 'custom limits (1-3650 days, 1-120 months)');
check(!subscriptionTermsSchema.safeParse({ ...base, messageCredits: -1 }).success && !subscriptionTermsSchema.safeParse({ ...base, messageCredits: 1.5 }).success, 'message credits are whole and not negative');
check(subscriptionTermsSchema.safeParse({ ...base, messageCredits: '', panel: '' }).success, 'credits and panel are optional');
for (const k of ['startedOn', 'expiresOn', 'startDate', 'expiryDate', 'activationDate', 'panelCreatedOn', 'renewsOn']) {
  check(!subscriptionTermsSchema.safeParse({ ...base, [k]: '2026-11-10' }).success, `Sales cannot send ${k}`);
}

const lead = { name: 'A', company: 'A Co', phone: '9811100999', leadSource: 'Walk-in', services: ['AI_CALLING'] };
check(leadCreateSchema.safeParse({ ...lead, subscriptions: [{ service: 'AI_CALLING', ...base }] }).success, 'a lead carries the subscription of each service');
check(!leadCreateSchema.safeParse({ ...lead, subscriptions: [{ service: 'AI_CALLING', ...base, startedOn: '2026-11-10' }] }).success, 'and no date');
check(!leadCreateSchema.safeParse({ ...lead, subscriptions: [{ service: 'AI_CALLING', ...base }, { service: 'AI_CALLING', ...base }] }).success, 'one subscription per service');

check(subscriptionActivationSchema.safeParse({ activationDate: '2026-11-10', panelCreatedOn: '2026-11-09' }).success, 'the activation takes the activation date and the panel creation date');
check(!subscriptionActivationSchema.safeParse({ activationDate: '10/11/2026' }).success, 'in YYYY-MM-DD');
check(!subscriptionActivationSchema.safeParse({ activationDate: '2026-11-10', expiresOn: '2027-05-10' }).success, 'the expiry is never part of it (it is calculated)');
check(!subscriptionCorrectionSchema.safeParse({ activationDate: '2026-11-10' }).success && subscriptionCorrectionSchema.safeParse({ activationDate: '2026-11-10', reason: 'Wrong day recorded' }).success, 'a correction needs a reason');
check(subscriptionRenewalSchema.safeParse({ paymentId: crypto.randomUUID(), terms: { durationCode: '1Y' } }).success && !subscriptionRenewalSchema.safeParse({ paymentId: 'x' }).success, 'a renewal names the payment');
check(!subscriptionRenewalSchema.safeParse({ paymentId: crypto.randomUUID(), terms: { durationCode: '1Y', expiresOn: '2030-01-01' } }).success, 'and never an expiry date');

check(longDate('2026-11-10') === '10 Nov 2026' && longDate('2027-05-10') === '10 May 2027', 'dates in the e-mail read 10 Nov 2026');
const mail = renderSubscriptionActivatedEmail({
  name: 'Meera', businessName: 'Meera Traders', serviceName: 'WhatsApp API', plan: 'Growth', durationLabel: '6 months', startedOn: '2026-11-10', expiresOn: '2027-05-10',
  messageCredits: 50000, panel: 'Wabastore', panelUrl: 'https://chat.example.com/login', loginEmail: 'meera@example.com', loginUrl: 'https://crm.example.com/client/login',
  setPasswordLink: 'https://crm.example.com/auth/verify?token=abc'
});
check(mail.subject.includes('WhatsApp API panel is active'), 'the subject names the panel');
for (const piece of ['Growth', '6 months', '10 Nov 2026', '10 May 2027', '50,000', 'https://chat.example.com/login', 'Set your password', 'meera@example.com']) {
  check(mail.html.includes(piece), `the e-mail carries ${piece}`);
}
check(!/<b>Password:/i.test(mail.html) && !/<b>Password:/i.test(mail.text), 'it never carries a password');
const plain = renderSubscriptionActivatedEmail({ name: 'Meera', serviceName: 'AI Calling', startedOn: '2026-11-10', expiresOn: '2027-05-10', loginUrl: 'https://crm.example.com/client/login', loginEmail: 'meera@example.com' });
check(!plain.html.includes('Set your password') && plain.html.includes('https://crm.example.com/client/login') && !plain.html.includes('Message limit'), 'without a link it points to the sign-in page, and without credits it shows no limit');
check(!mail.html.includes('<script') && renderSubscriptionActivatedEmail({ name: '<b>x</b>', serviceName: 'S', startedOn: '2026-11-10', expiresOn: '2027-05-10', loginUrl: 'https://x.test' }).html.includes('&lt;b&gt;x&lt;/b&gt;'), 'names are escaped');

console.log(`=== SUBSCRIPTION TERMS TESTS PASSED (${passed}) ===`);
