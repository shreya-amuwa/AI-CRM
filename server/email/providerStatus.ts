import { automationSettings, type AutomationSettings } from '../automations/config.js';
import { signRequest } from '../storage/sigv4.js';
import { configuredProviders, providerRoute, sesProductionEnabled, type ProviderName } from './routing.js';

/**
 * What the deployment's e-mail settings say (Email Management → Providers), without any secret: whether a key is set (never the key),
 * the SES region and approval switch, the route and why a provider is left out. And a real check per provider, on request only:
 *   Resend: GET /domains (a full-access key lists the domains and their verification; a sending-only key is refused, which is reported as such)
 *   SES:    GET /v2/email/account (production access or sandbox, sending enabled, the 24-hour quota and what was sent)
 *   SMTP:   no network check here (sending a message is the only real test): its last real success comes from the e-mail log.
 * Nothing here claims a provider is healthy without one of these answers or a real accepted e-mail.
 */
export interface ProviderDiagnostics {
  route: ProviderName[];
  intended: ProviderName | null;
  excluded: { provider: ProviderName; reason: string }[];
  fallback: boolean;
  sesProductionEnabled: boolean;
  configured: Record<'resend' | 'ses' | 'smtp', boolean>;
  sesRegion: string | null;
  sesRegionExplicit: boolean;
  sesConfigurationSet: boolean;
  smtpHost: string | null;
  fromEmail: string;
  replyTo: string;
  globalCc: number;
  globalBcc: number;
  resendWebhookSecret: boolean;
  orderFromEnv: string | null;
}

export function providerDiagnostics(s: AutomationSettings = automationSettings(), env: NodeJS.ProcessEnv = process.env): ProviderDiagnostics {
  const route = providerRoute(s, env);
  const configured = configuredProviders(s);
  return {
    route: route.order, intended: route.intended, excluded: route.excluded, fallback: s.email.smtpFallback === true,
    sesProductionEnabled: sesProductionEnabled(env),
    configured: { resend: configured.includes('resend'), ses: configured.includes('ses'), smtp: configured.includes('smtp') },
    sesRegion: s.email.ses?.region ?? null, sesRegionExplicit: !!env.SES_REGION?.trim(), sesConfigurationSet: !!s.email.ses?.configurationSet,
    smtpHost: s.email.smtp?.host ?? null, fromEmail: s.email.fromEmail, replyTo: s.email.replyTo,
    globalCc: s.email.cc.length, globalBcc: s.email.bcc.length,
    resendWebhookSecret: !!env.RESEND_WEBHOOK_SECRET?.trim(), orderFromEnv: env.EMAIL_PROVIDER_ORDER?.trim() || null
  };
}

export interface ProviderCheck {
  provider: 'resend' | 'ses' | 'smtp';
  ok: boolean;
  checkedAt: string;
  summary: string;
  details: Record<string, unknown>;
}

const now = () => new Date().toISOString();

export async function checkProvider(provider: string, s: AutomationSettings = automationSettings(),
  fetchImpl: typeof fetch = fetch): Promise<ProviderCheck> {
  if (provider === 'resend') {
    if (!s.email.apiKey || s.email.provider === 'brevo') return { provider, ok: false, checkedAt: now(), summary: 'No Resend key is set (EMAIL_API_KEY).', details: {} };
    try {
      const res = await fetchImpl(`${(s.email.apiBaseUrl ?? 'https://api.resend.com').replace(/\/+$/, '')}/domains`, {
        headers: { authorization: `Bearer ${s.email.apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000)
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { name?: string; status?: string; region?: string }[]; name?: string; message?: string };
      if (res.ok) {
        const domains = (body.data ?? []).map(d => ({ name: d.name, status: d.status, region: d.region }));
        const sending = s.email.fromEmail.split('@')[1]?.toLowerCase();
        const mine = domains.find(d => d.name?.toLowerCase() === sending);
        return { provider, ok: mine?.status === 'verified', checkedAt: now(), details: { domains },
          summary: mine ? `The key works. ${sending} is ${mine.status} in Resend.` : `The key works, but ${sending ?? 'the sender domain'} is not added in Resend.` };
      }
      if (res.status === 401 && /restricted/i.test(`${body.name} ${body.message}`)) {
        return { provider, ok: true, checkedAt: now(), details: { status: 401 },
          summary: 'The key is a sending-only key (correct for production): it cannot list domains, so domain verification is not checked here. Check it in the Resend dashboard.' };
      }
      return { provider, ok: false, checkedAt: now(), details: { status: res.status }, summary: `Resend refused the key (HTTP ${res.status}${body.name ? ` ${body.name}` : ''}).` };
    } catch {
      return { provider, ok: false, checkedAt: now(), details: {}, summary: 'Resend could not be reached.' };
    }
  }
  if (provider === 'ses') {
    const ses = s.email.ses;
    if (!ses) return { provider, ok: false, checkedAt: now(), summary: 'No SES keys are set (SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY).', details: {} };
    const url = `${(s.email.apiBaseUrl ?? `https://email.${ses.region}.amazonaws.com`).replace(/\/+$/, '')}/v2/email/account`;
    try {
      const headers = signRequest({ method: 'GET', url, service: 'ses', region: ses.region, accessKeyId: ses.accessKeyId, secretAccessKey: ses.secretAccessKey, headers: {}, body: '' });
      delete headers.host;
      const res = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => ({}))) as {
        ProductionAccessEnabled?: boolean; SendingEnabled?: boolean; EnforcementStatus?: string;
        SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number }; message?: string
      };
      if (!res.ok) {
        return { provider, ok: false, checkedAt: now(), details: { status: res.status, region: ses.region },
          summary: `SES refused the check in ${ses.region} (HTTP ${res.status}). Check the keys and that the identity is verified in this region.` };
      }
      const production = body.ProductionAccessEnabled === true;
      return {
        provider, ok: production && body.SendingEnabled === true, checkedAt: now(),
        details: { region: ses.region, productionAccess: production, sendingEnabled: body.SendingEnabled === true, enforcement: body.EnforcementStatus ?? null,
                   max24HourSend: body.SendQuota?.Max24HourSend ?? null, maxSendRate: body.SendQuota?.MaxSendRate ?? null, sentLast24Hours: body.SendQuota?.SentLast24Hours ?? null },
        summary: !production
          ? `SES (${ses.region}) is in the SANDBOX: it only sends to verified addresses. Keep EMAIL_SES_PRODUCTION_ENABLED off until AWS grants production access.`
          : body.SendingEnabled ? `SES (${ses.region}) has production access and sending is enabled.` : `SES (${ses.region}) has production access but sending is paused.`
      };
    } catch {
      return { provider, ok: false, checkedAt: now(), details: { region: ses.region }, summary: `SES (${ses.region}) could not be reached.` };
    }
  }
  if (provider === 'smtp') {
    return { provider, ok: !!s.email.smtp, checkedAt: now(), details: { host: s.email.smtp?.host ?? null },
      summary: s.email.smtp ? 'SMTP is configured. Its health is shown by its last real accepted e-mail (no test message is sent from here).' : 'SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS).' };
  }
  return { provider: 'smtp', ok: false, checkedAt: now(), summary: 'Unknown provider.', details: {} };
}
