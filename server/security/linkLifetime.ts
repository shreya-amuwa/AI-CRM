/**
 * How long set-password and reset links work, as the e-mails say it. The lifetime itself is Supabase Auth's "Email OTP expiry" setting
 * (hosted: Authentication -> Email; self-hosted: GOTRUE_MAILER_OTP_EXP), whose maximum is 24 hours; AUTH_LINK_HOURS must match it
 * (docs/PASSWORD_LINKS.md).
 */
export function linkLifetimeHours(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AUTH_LINK_HOURS);
  return Number.isInteger(n) && n >= 1 && n <= 24 ? n : 24;
}
export function linkLifetimeText(env: NodeJS.ProcessEnv = process.env): string {
  const h = linkLifetimeHours(env);
  return `The link works once and for ${h} hour${h === 1 ? '' : 's'}.`;
}
