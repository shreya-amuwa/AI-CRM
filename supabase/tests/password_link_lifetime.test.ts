/**
 * Every e-mail with a set-password or reset link says how long it works: 24 hours (the Auth "Email OTP expiry" setting must be 86400 s:
 * docs/PASSWORD_LINKS.md), and how to get a new one. No more "for a limited time" / "expires soon".
 */
import { LINK_LIFETIME_HOURS, linkLifetimeText } from '../../server/security/linkLifetime.js';
import { renderWelcomeEmail } from '../../server/automations/welcomeTemplates.js';
import { renderClientPasswordEmail, renderSubscriptionActivatedEmail } from '../../server/automations/templates.js';
import { renderStaffResetEmail } from '../../server/services/StaffPasswordService.js';
import { renderAuthEmail } from '../../server/automations/authEmailHook.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
check(LINK_LIFETIME_HOURS === 24 && linkLifetimeText() === 'The link works once and for 24 hours.', 'links work for 24 hours');

const says = (label: string, body: string) => {
  check(body.includes('24 hours') && !/limited time|expires soon/i.test(body), `${label} says the link works for 24 hours`, body.slice(0, 400));
};
const w = renderWelcomeEmail({ name: 'Asha', loginId: 'asha@amuwa.example', loginUrl: 'https://crm.example/', setupUrl: 'https://crm.example/set-password?x', logoUrl: 'https://crm.example/l.png', supportEmail: 'hr@amuwa.example' });
says('the staff welcome e-mail', w.html + w.text);
const r = renderStaffResetEmail({ name: 'Asha', link: 'https://crm.example/set-password?purpose=reset' });
says('the staff reset e-mail', r.html + r.text);
for (const kind of ['WELCOME', 'ONBOARDING', 'RESET'] as const) {
  const c = renderClientPasswordEmail({ kind, name: 'Ravi', businessName: 'Ravi Stores', loginEmail: 'ravi@shop.example', link: 'https://crm.example/client/set-password?x' } as any);
  says(`the client ${kind.toLowerCase()} e-mail`, c.html + c.text);
}
const s = renderSubscriptionActivatedEmail({ name: 'Ravi', serviceName: 'WhatsApp', startedOn: '2026-11-01', expiresOn: '2027-11-01', loginUrl: 'https://crm.example/client', setPasswordLink: 'https://crm.example/client/set-password?x' } as any);
says('the "subscription active" e-mail with a set-password link', s.html + s.text);
const hook = renderAuthEmail({ user: { email: 'asha@example.com', user_metadata: { candidate_portal: true } }, email_data: { token: '1', token_hash: 'h', redirect_to: 'https://careers.example/reset', email_action_type: 'recovery' } } as any, 'https://p.supabase.example')!;
says('the candidate reset e-mail (sent through the Auth hook)', hook.html + hook.text);
console.log(`=== PASSWORD LINK LIFETIME CHECKS PASSED (${passed}) ===`);
