/**
 * How long set-password and reset links work, as the e-mails and pages say it: 24 hours. The lifetime itself is Supabase Auth's "Email OTP
 * expiry" setting (hosted: Authentication -> Email; self-hosted: GOTRUE_MAILER_OTP_EXP), which must be 86400 seconds (docs/PASSWORD_LINKS.md).
 */
export const LINK_LIFETIME_HOURS = 24;
export function linkLifetimeText(): string {
  return `The link works once and for ${LINK_LIFETIME_HOURS} hours.`;
}
