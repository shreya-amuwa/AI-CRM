import type { AutomationSettings } from '../automations/config.js';

/**
 * Which providers may send, in which order (docs/EMAIL_MANAGEMENT.md, "Provider routing"). Read from the deployment's settings on every
 * send, so a change needs no code change:
 *
 *   EMAIL_PROVIDER=resend              the primary provider, as before
 *   EMAIL_FALLBACK=on|off              the backup providers (default on), as before
 *   EMAIL_PROVIDER_ORDER=resend,ses,smtp   optional: the full order (Phase B, e.g. ses,resend,smtp once SES is approved)
 *   EMAIL_SES_PRODUCTION_ENABLED=true  Amazon SES may be used as a general provider (only after AWS granted production access)
 *
 * Phase A (now): resend, smtp. SES is left out of any order until EMAIL_SES_PRODUCTION_ENABLED=true: a sandboxed SES account only sends to
 * verified addresses, so it must not become a fallback for real recipients. The one exception keeps existing set-ups working: an explicit
 * EMAIL_PROVIDER=ses with no EMAIL_PROVIDER_ORDER is still honoured as the primary, exactly as before.
 * The Super Admin may reorder the providers this returns (Email Management); they can never add one the deployment has not configured
 * or enabled here.
 */
export type ProviderName = 'resend' | 'ses' | 'smtp' | 'brevo';
const NAMES: ProviderName[] = ['resend', 'ses', 'smtp', 'brevo'];

const on = (v: string | undefined) => ['true', 'on', '1', 'yes'].includes((v ?? '').trim().toLowerCase());

export function sesProductionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.EMAIL_SES_PRODUCTION_ENABLED);
}

/** The providers whose credentials are set. */
export function configuredProviders(s: AutomationSettings): ProviderName[] {
  const e = s.email;
  return NAMES.filter(p => (p === 'resend' && !!e.apiKey && e.provider !== 'brevo') || (p === 'brevo' && !!e.apiKey && e.provider === 'brevo')
    || (p === 'ses' && !!e.ses) || (p === 'smtp' && !!e.smtp));
}

export function parseOrder(raw: string | undefined): ProviderName[] | null {
  const list = (raw ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return null;
  const out: ProviderName[] = [];
  for (const x of list) {
    if (!NAMES.includes(x as ProviderName) || out.includes(x as ProviderName)) return null; // a typo never routes mail somewhere unexpected
    out.push(x as ProviderName);
  }
  return out;
}

export interface Route {
  /** the order to try, configured and eligible only */
  order: ProviderName[];
  /** the provider meant to send first (may be missing from `order` when it is not set up: then the first available one is a fallback) */
  intended: ProviderName | null;
  /** why providers were left out (diagnostics) */
  excluded: { provider: ProviderName; reason: 'NOT_CONFIGURED' | 'SES_NOT_APPROVED' | 'FALLBACK_OFF' }[];
}

export function providerRoute(s: AutomationSettings, env: NodeJS.ProcessEnv = process.env): Route {
  const explicit = parseOrder(env.EMAIL_PROVIDER_ORDER);
  const primary = s.email.provider;
  // automationSettings() sets this from EMAIL_FALLBACK (default on); a settings object built by hand without it means off, as before
  const fallbackOn = s.email.smtpFallback === true;
  let wanted: ProviderName[];
  if (explicit) wanted = explicit;
  else if (!primary) wanted = [];
  else if (primary === 'smtp' || primary === 'brevo') wanted = [primary];
  else wanted = [primary, ...(sesProductionEnabled(env) && primary === 'resend' ? (['ses'] as ProviderName[]) : []), 'smtp'];
  // EMAIL_FALLBACK=off: only the intended provider; nothing else may send in its place
  if (!fallbackOn) wanted = wanted.slice(0, 1);
  const configured = configuredProviders(s);
  const excluded: Route['excluded'] = [];
  const order: ProviderName[] = [];
  wanted.forEach((p, i) => {
    const legacySesPrimary = p === 'ses' && !explicit && primary === 'ses' && i === 0;
    if (p === 'ses' && !sesProductionEnabled(env) && !legacySesPrimary) excluded.push({ provider: p, reason: 'SES_NOT_APPROVED' });
    else if (!configured.includes(p)) excluded.push({ provider: p, reason: 'NOT_CONFIGURED' });
    else order.push(p);
  });
  // SES keys are set but SES is not approved for general sending: say so (Email Management shows it)
  if (configured.includes('ses') && !order.includes('ses') && !excluded.some(x => x.provider === 'ses')) {
    excluded.push({ provider: 'ses', reason: sesProductionEnabled(env) ? 'FALLBACK_OFF' : 'SES_NOT_APPROVED' });
  }
  if (!fallbackOn && (explicit ?? []).length > 1) excluded.push(...(explicit ?? []).slice(1).map(provider => ({ provider, reason: 'FALLBACK_OFF' as const })));
  return { order, intended: wanted[0] ?? null, excluded };
}

export const PROVIDER_LABEL: Record<ProviderName, string> = { resend: 'Resend', ses: 'SES', smtp: 'SMTP', brevo: 'Brevo' };
