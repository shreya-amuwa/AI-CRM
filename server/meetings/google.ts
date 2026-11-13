import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../automations/secrets.js';

/**
 * Google Calendar for each employee's OWN Google account (OAuth 2.0, "web server" flow).
 *
 *  - Scopes: only calendar.events (create / change / remove the events the CRM books) and calendar.freebusy (when the person is busy,
 *    never what their other events are), plus the e-mail address of the account (openid email).
 *  - The refresh token is encrypted with GOOGLE_TOKEN_KEY (AES-256-GCM) before it is stored; only the server can read it back.
 *  - The `state` of the sign-in is signed (HMAC with the same key) and expires after 10 minutes, so a callback can only finish a
 *    connection the same signed-in employee started.
 *
 * Configuration (server environment only): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY (32+ characters) and, optionally,
 * GOOGLE_REDIRECT_URI (default: <APP_URL>/api/v1/integrations/google/callback). See docs/MEETINGS_GOOGLE_CALENDAR.md.
 */

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 10_000;
const STATE_TTL_MS = 10 * 60_000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  tokenKey: string;
  redirectUri: string;
}

/** The Google set-up, or null when it is not configured (the Meetings page then explains how to switch it on). */
export function googleConfig(env: NodeJS.ProcessEnv = process.env, appUrl = 'https://crm.amuwacorporation.com'): GoogleConfig | null {
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  const tokenKey = (env.GOOGLE_TOKEN_KEY || '').trim();
  if (!clientId || !clientSecret || tokenKey.length < 32) return null;
  const explicit = (env.GOOGLE_REDIRECT_URI || '').trim();
  const redirectUri = /^https:\/\/[^\s]+$/.test(explicit) || /^http:\/\/localhost(:\d+)?\//.test(explicit)
    ? explicit
    : `${appUrl.replace(/\/+$/, '')}/api/v1/integrations/google/callback`;
  return { clientId, clientSecret, tokenKey, redirectUri };
}

/** Thrown when Google no longer accepts the stored access (revoked, expired, password changed): the person must connect again. */
export class GoogleAuthLostError extends Error {}
/** Any other refusal by Google; `retry` = worth trying again later. */
export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number, readonly retry: boolean) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// The signed state of a sign-in
// ---------------------------------------------------------------------------
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signState(profileId: string, key: string, now = Date.now()): string {
  const body = b64url(JSON.stringify({ p: profileId, e: now + STATE_TTL_MS }));
  const sig = createHmac('sha256', `state:${key}`).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** The employee who started this sign-in, or null when the state is forged, altered or expired. */
export function verifyState(state: string | null | undefined, key: string, now = Date.now()): string | null {
  if (!state || state.length > 600) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(createHmac('sha256', `state:${key}`).update(body).digest('base64url'));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { p?: string; e?: number };
    if (typeof v.p !== 'string' || typeof v.e !== 'number' || v.e < now) return null;
    return v.p;
  } catch {
    return null;
  }
}

export function authorizeUrl(cfg: GoogleConfig, profileId: string, loginHint?: string | null): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always hands out a refresh token, also when the person connected before
    include_granted_scopes: 'true',
    state: signState(profileId, cfg.tokenKey)
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `${AUTH_URL}?${q.toString()}`;
}

export const encryptToken = (token: string, cfg: GoogleConfig) => encryptSecret(token, `google:${cfg.tokenKey}`);
export const decryptToken = (enc: string, cfg: GoogleConfig) => decryptSecret(enc, `google:${cfg.tokenKey}`);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
type Fetch = typeof fetch;

async function call(f: Fetch, url: string, init: RequestInit): Promise<{ status: number; json: any; text: string }> {
  let res: Response;
  try {
    // 'manual', not 'error': Cloudflare Workers accept only 'follow' and 'manual'. Google's APIs never redirect; one that does is refused below.
    res = await f(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new GoogleApiError(`Google could not be reached: ${(err as Error).message?.slice(0, 120) ?? 'network error'}`, 0, true);
  }
  if (res.status >= 300 && res.status < 400) throw new GoogleApiError(`Google answered with an unexpected redirect (HTTP ${res.status}).`, res.status, false);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

function apiError(status: number, json: any, text: string, what: string): Error {
  const reason = json?.error?.message || json?.error_description || json?.error || text.slice(0, 160) || `HTTP ${status}`;
  if (status === 401 || json?.error === 'invalid_grant') return new GoogleAuthLostError(`${what}: ${reason}`);
  return new GoogleApiError(`${what}: ${String(reason).slice(0, 300)}`, status, status === 429 || status >= 500);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string;
  email: string | null;
  scopes: string;
}

/** The sign-in's one-time code for the tokens (and the account's e-mail, read from the ID token Google just handed over TLS). */
export async function exchangeCode(cfg: GoogleConfig, code: string, f: Fetch = fetch): Promise<ExchangedTokens> {
  const r = await call(f, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' })
  });
  if (r.status !== 200 || !r.json?.access_token) throw apiError(r.status, r.json, r.text, 'Google sign-in failed');
  if (!r.json.refresh_token) throw new GoogleApiError('Google did not grant offline access. Remove the CRM from your Google account permissions and connect again.', 400, false);
  const scopes = String(r.json.scope || '');
  if (!scopes.includes('calendar.events')) throw new GoogleApiError('Calendar access was not granted. Connect again and tick the calendar permission.', 400, false);
  let email: string | null = null;
  try {
    const payload = JSON.parse(Buffer.from(String(r.json.id_token || '').split('.')[1] || '', 'base64url').toString('utf8'));
    if (typeof payload?.email === 'string') email = payload.email.toLowerCase();
  } catch {
    /* no ID token */
  }
  return { refreshToken: r.json.refresh_token, accessToken: r.json.access_token, email, scopes };
}

/** A fresh access token (valid ~1 hour) from the stored refresh token. */
export async function refreshAccessToken(cfg: GoogleConfig, refreshToken: string, f: Fetch = fetch): Promise<string> {
  const r = await call(f, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' })
  });
  if (r.status !== 200 || !r.json?.access_token) throw apiError(r.status, r.json, r.text, 'Google refused the stored access');
  return r.json.access_token as string;
}

/** Ends the CRM's access at Google (best effort: the stored token is deleted either way). */
export async function revokeToken(token: string, f: Fetch = fetch): Promise<void> {
  await call(f, REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export interface BusyBlock {
  start: string;
  end: string;
}

/** When the person is busy in their Google Calendar (no titles, no details). */
export async function freeBusy(accessToken: string, calendarId: string, from: Date, to: Date, f: Fetch = fetch): Promise<BusyBlock[]> {
  const r = await call(f, `${API}/freeBusy`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }] })
  });
  if (r.status !== 200) throw apiError(r.status, r.json, r.text, 'Google free/busy failed');
  const cal = r.json?.calendars?.[calendarId];
  if (cal?.errors?.length) throw new GoogleApiError(`Google free/busy failed: ${cal.errors[0]?.reason ?? 'unknown'}`, 400, false);
  return (cal?.busy ?? []).filter((b: any) => typeof b?.start === 'string' && typeof b?.end === 'string').map((b: any) => ({ start: b.start, end: b.end }));
}

export interface CalendarMeeting {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  kindLabel: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: string;
  location: string | null;
  meetLink: string | null;
  hostEmail: string | null;
  version: number;
  attendees: { email: string | null; name: string | null; role: string; profileId: string | null }[];
}

/** The Google event of a CRM meeting: guests invited by Google, a Meet link created for "Google Meet" meetings. */
export function eventBody(m: CalendarMeeting, appUrl: string, withConference: boolean): Record<string, unknown> {
  const host = (m.hostEmail || '').toLowerCase();
  const seen = new Set<string>();
  const attendees = m.attendees
    .filter(a => a.email && a.email.toLowerCase() !== host)
    .filter(a => {
      const k = a.email!.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(a => ({ email: a.email!.toLowerCase(), ...(a.name ? { displayName: a.name } : {}), ...(a.role === 'OPTIONAL' ? { optional: true } : {}) }));
  const lines = [m.description?.trim(), `${m.kindLabel} · ${m.reference}`, `Booked through the Amuwa CRM: ${appUrl.replace(/\/+$/, '')}/?tab=meetings`].filter(Boolean);
  const location = m.mode === 'ONLINE_LINK' ? m.meetLink || m.location : m.mode === 'GOOGLE_MEET' ? m.location : m.location;
  return {
    summary: m.title,
    description: lines.join('\n\n'),
    start: { dateTime: m.startsAt, timeZone: m.timezone },
    end: { dateTime: m.endsAt, timeZone: m.timezone },
    ...(location ? { location } : {}),
    attendees,
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: true },
    extendedProperties: { private: { crmMeetingId: m.id } },
    ...(withConference
      ? { conferenceData: { createRequest: { requestId: `${m.id}-${m.version}`.slice(0, 64), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
      : {})
  };
}

export interface EventResult {
  eventId: string;
  meetLink: string | null;
}

const meetOf = (json: any): string | null => {
  const video = json?.conferenceData?.entryPoints?.find((e: any) => e?.entryPointType === 'video')?.uri;
  const link = json?.hangoutLink || video || null;
  return typeof link === 'string' && /^https:\/\//.test(link) ? link : null;
};

/** Creates the event (sendUpdates=all: Google e-mails the invitation to every guest). */
export async function insertEvent(accessToken: string, calendarId: string, body: Record<string, unknown>, f: Fetch = fetch): Promise<EventResult> {
  const r = await call(f, `${API}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.status !== 200 || !r.json?.id) throw apiError(r.status, r.json, r.text, 'Google could not create the event');
  return { eventId: r.json.id, meetLink: meetOf(r.json) };
}

/** Changes the event; null when it no longer exists at Google (deleted by hand): the caller then creates it again. */
export async function patchEvent(accessToken: string, calendarId: string, eventId: string, body: Record<string, unknown>, f: Fetch = fetch): Promise<EventResult | null> {
  const r = await call(f, `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.status === 404 || r.status === 410) return null;
  if (r.status !== 200) throw apiError(r.status, r.json, r.text, 'Google could not change the event');
  if (r.json?.status === 'cancelled') return null;
  return { eventId: r.json.id ?? eventId, meetLink: meetOf(r.json) };
}

/** Removes the event (Google tells the guests it is cancelled). Already gone counts as done. */
export async function deleteEvent(accessToken: string, calendarId: string, eventId: string, f: Fetch = fetch): Promise<void> {
  const r = await call(f, `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (r.status === 204 || r.status === 200 || r.status === 404 || r.status === 410) return;
  throw apiError(r.status, r.json, r.text, 'Google could not remove the event');
}
