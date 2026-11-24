/**
 * Why a provider did not take an e-mail, in one vocabulary for Resend, Amazon SES and SMTP, and what may be done about it
 * (docs/EMAIL_MANAGEMENT.md, "Failure classification"). The router (server/automations/providers.ts) uses `failover` to decide
 * whether the next provider may be tried and `outcome` to decide what to record.
 *
 * Never fail over when the e-mail itself is the problem (an invalid or suppressed recipient, refused content, an attachment too large):
 * every provider would refuse it, and a different provider must never be used to get around a suppression. Never fail over after an
 * ambiguous timeout either: the first provider may already have accepted the e-mail, and a second copy must not go out.
 */
export type EmailErrorCategory =
  | 'QUOTA_DAILY' | 'QUOTA_MONTHLY' | 'RATE_LIMIT' | 'AUTH_INVALID' | 'DOMAIN_UNVERIFIED' | 'SES_SANDBOX' | 'ACCOUNT_SUSPENDED'
  | 'INVALID_RECIPIENT' | 'SUPPRESSED' | 'TIMEOUT' | 'NETWORK' | 'TEMPORARY' | 'INVALID_CONTENT' | 'ATTACHMENT_TOO_LARGE'
  | 'NOT_CONFIGURED' | 'IDEMPOTENT_CONFLICT';

/** ACCEPTED: the provider took it. UNKNOWN_ACCEPTANCE: we do not know (a timeout). REJECTED: definitely not sent. RETRYABLE: not sent, try later. */
export type AttemptOutcome = 'ACCEPTED' | 'REJECTED' | 'RETRYABLE' | 'UNKNOWN_ACCEPTANCE' | 'SKIPPED';

export interface Classified {
  category: EmailErrorCategory;
  /** the next provider may be tried for this e-mail */
  failover: boolean;
  /** this e-mail may be tried again later (by the same queue) */
  retry: boolean;
  outcome: AttemptOutcome;
}

const C = (category: EmailErrorCategory, failover: boolean, retry: boolean, outcome: AttemptOutcome = retry ? 'RETRYABLE' : 'REJECTED'): Classified =>
  ({ category, failover, retry, outcome });

export const TIMEOUT_RESULT: Classified = C('TIMEOUT', false, true, 'UNKNOWN_ACCEPTANCE');
export const NETWORK_RESULT: Classified = C('NETWORK', true, true);
export const NOT_CONFIGURED: Classified = C('NOT_CONFIGURED', true, false);

/** A fetch that threw: a timeout (unknown: maybe accepted) or a connection that never reached the provider (definitely not sent). */
export function classifyThrown(err: unknown): Classified {
  const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  return timeout ? TIMEOUT_RESULT : NETWORK_RESULT;
}

/** Resend's answer (status and its JSON `name` / `message`). */
export function classifyResend(status: number, name: string, message: string): Classified {
  const text = `${name} ${message}`.toLowerCase();
  if (status === 429) {
    if (/daily_quota_exceeded|daily quota/.test(text)) return C('QUOTA_DAILY', true, true);
    if (/monthly_quota_exceeded|monthly quota/.test(text)) return C('QUOTA_MONTHLY', true, true);
    if (/quota/.test(text)) return C('QUOTA_DAILY', true, true);
    return C('RATE_LIMIT', true, true);
  }
  if (status === 401) return C('AUTH_INVALID', true, true);
  if (status === 403) return /domain|verif|not allowed to send/.test(text) ? C('DOMAIN_UNVERIFIED', true, true) : C('AUTH_INVALID', true, true);
  if (status === 409) return /concurrent/.test(text) ? C('IDEMPOTENT_CONFLICT', false, true) : C('IDEMPOTENT_CONFLICT', false, false);
  if (status === 413 || /attachment.*(size|large)|too large|payload/.test(text)) return C('ATTACHMENT_TOO_LARGE', false, false);
  if (status === 422 || status === 400) {
    if (/suppress/.test(text)) return C('SUPPRESSED', false, false);
    if (/email|address|recipient|`to`|\bto\b/.test(text) && !/from/.test(text)) return C('INVALID_RECIPIENT', false, false);
    if (/from|domain/.test(text) && /verif|domain/.test(text)) return C('DOMAIN_UNVERIFIED', true, true);
    return C('INVALID_CONTENT', false, false);
  }
  if (status >= 500 || status === 408) return C('TEMPORARY', true, true);
  return C('INVALID_CONTENT', false, false);
}

/** Amazon SES API v2's answer (status, the x-amzn-errortype name and the message). */
export function classifySes(status: number, name: string, message: string): Classified {
  const text = message.toLowerCase();
  if (name === 'AccountSuspendedException' || name === 'SendingPausedException') return C('ACCOUNT_SUSPENDED', true, true);
  if (status === 429 || name === 'TooManyRequestsException' || name === 'LimitExceededException' || name === 'ThrottlingException') {
    // "Maximum sending rate exceeded" is throttling; "Daily message quota exceeded" is the 24-hour quota
    return /rate/.test(text) ? C('RATE_LIMIT', true, true) : /quota|daily|24.?hour/.test(text) ? C('QUOTA_DAILY', true, true) : C('RATE_LIMIT', true, true);
  }
  // a configuration set (or other SES resource) that does not exist is our setup, not the e-mail: another provider may send it
  if (name === 'NotFoundException') return C('NOT_CONFIGURED', true, true);
  if (name === 'MessageRejected' || name === 'MailFromDomainNotVerifiedException' || name === 'BadRequestException') {
    // the sandbox only sends to verified recipients; a sender or domain not verified IN THIS REGION reads the same (a region mismatch)
    if (/not verified/.test(text) && /(recipient|to address|destination)/.test(text)) return C('SES_SANDBOX', true, true);
    if (/not verified|identit|not authori[sz]ed|mail from/.test(text) || name === 'MailFromDomainNotVerifiedException') return C('DOMAIN_UNVERIFIED', true, true);
    if (/size|too large|exceed/.test(text)) return C('ATTACHMENT_TOO_LARGE', false, false);
    if (/address|recipient|destination|email/.test(text)) return C('INVALID_RECIPIENT', false, false);
    return C('INVALID_CONTENT', false, false);
  }
  if (status === 401 || status === 403 || /signature|security token|access denied|not authori[sz]ed|invalidclienttokenid/i.test(`${name} ${message}`)) {
    return C('AUTH_INVALID', true, true);
  }
  if (status >= 500) return C('TEMPORARY', true, true);
  return C('INVALID_CONTENT', false, false);
}

/** SMTP reply codes. 535/534/530: the mailbox sign-in (our setup). 552: too large. 550/553: the recipient. 4xx: temporary. */
export function classifySmtp(code: number | null): Classified {
  if (code === null) return NETWORK_RESULT;
  if (code === 535 || code === 534 || code === 530) return C('AUTH_INVALID', true, true);
  if (code === 552) return C('ATTACHMENT_TOO_LARGE', false, false);
  if (code === 550 || code === 551 || code === 553 || code === 501) return C('INVALID_RECIPIENT', false, false);
  if (code >= 400 && code < 500) return C('TEMPORARY', true, true);
  if (code >= 500) return C('INVALID_CONTENT', false, false);
  return C('TEMPORARY', true, true);
}
