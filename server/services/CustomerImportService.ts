import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerDataImportError, CustomerDataImportLogin, CustomerDataImportResult } from '../../shared/contracts.js';
import { clientForgotPasswordSchema, customerDataImportSchema, uuidSchema } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { automationSettings, liveChannels } from '../automations/config.js';
import { sendEmail } from '../automations/providers.js';
import { renderClientPasswordEmail, type ClientPasswordMailData } from '../automations/templates.js';
import { hasServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import { unwrap } from '../repositories/base.js';

interface ImportRpcResult {
  committed: boolean;
  errors: CustomerDataImportError[];
  summary: CustomerDataImportResult['summary'];
  newLogins: { customerId: string; email: string; name: string; businessName?: string }[];
}

/** Where the "Set your password" link lands: APP_URL (or the Vercel domain), else the page the request came from. */
function setPasswordUrl(origin: string | undefined): string {
  const base = automationSettings().appUrl ?? safeOrigin(origin);
  if (!base) throw new AppError('SERVICE_UNAVAILABLE', 'Set APP_URL on the server so the set-password link can point to the CRM.');
  return `${base}/client/set-password`;
}
function safeOrigin(origin: string | undefined): string | null {
  try {
    const u = new URL(origin ?? '');
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.origin : null;
  } catch {
    return null;
  }
}

/** Sends one client e-mail, or says why it was not sent (the team can send it again later). */
async function sendClientMail(to: { email: string; name: string }, data: ClientPasswordMailData): Promise<{ sent: boolean; detail?: string }> {
  const s = automationSettings();
  if (s.mode !== 'live') return { sent: false, detail: 'E-mails are switched off on the server (AUTOMATION_MODE is not "live").' };
  if (!liveChannels(s).includes('EMAIL')) return { sent: false, detail: 'E-mail sending is not set up on the server.' };
  if (s.testRecipients && !s.testRecipients.emails.has(to.email.toLowerCase())) {
    return { sent: false, detail: 'Test mode: only the test recipients get e-mails.' };
  }
  const r = await sendEmail(s, to, renderClientPasswordEmail(data));
  return r.ok ? { sent: true } : { sent: false, detail: r.detail ?? 'The e-mail could not be sent.' };
}

/**
 * Excel import of existing customers (Support Team Member, Team Lead, Department Head) and the client's
 * "Set your password" e-mail. The database checks every row and who may import for whom; this layer creates
 * the Supabase Auth logins (service key) once the data is saved, and e-mails the link from meta@amuwa.com.
 */
export class CustomerImportService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly authAdmin: AuthAdminRepository = new AuthAdminRepository()
  ) {}

  async importExisting(actor: Actor, body: unknown, origin?: string): Promise<CustomerDataImportResult> {
    const input = parse(customerDataImportSchema, body);
    if (input.commit && hasServiceClient()) setPasswordUrl(origin); // fail before saving when the link cannot be made
    const res = unwrap(await this.db.rpc('import_customer_data', { p_data: input.data, p_commit: input.commit })) as ImportRpcResult;
    const out: CustomerDataImportResult = { committed: res.committed, errors: res.errors ?? [], summary: res.summary, logins: [] };
    if (!res.committed) {
      out.logins = (res.newLogins ?? []).map(l => ({ ...l, login: 'FAILED', mail: 'NOT_SENT', detail: 'Created when the file is saved.' }));
      return out;
    }
    for (const l of res.newLogins ?? []) out.logins.push(await this.createLogin(actor, l, origin));
    return out;
  }

  /** The team sends the "Set your password" e-mail again (e.g. the link expired). */
  async sendPasswordEmail(id: string, origin?: string): Promise<{ email: string; sent: boolean; detail?: string }> {
    const customerId = parse(uuidSchema, id);
    const t = unwrap(await this.db.rpc('client_login_invite_target', { p_customer: customerId })) as { email: string; name: string; businessName: string };
    if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'Client logins are not set up on the server.');
    const link = await this.authAdmin.passwordLink(t.email, setPasswordUrl(origin));
    const r = await sendClientMail({ email: t.email, name: t.name }, { name: t.name, businessName: t.businessName, loginEmail: t.email, link, kind: 'WELCOME' });
    return { email: t.email, ...r };
  }

  private async createLogin(actor: Actor, l: ImportRpcResult['newLogins'][number], origin?: string): Promise<CustomerDataImportLogin> {
    const base = { customerId: l.customerId, email: l.email, name: l.name, businessName: l.businessName };
    if (!hasServiceClient()) return { ...base, login: 'FAILED', mail: 'NOT_SENT', detail: 'Client logins are not set up on the server.' };
    let userId: string;
    try {
      // a random password nobody knows: the client sets their own from the e-mailed link
      userId = await this.authAdmin.createClientUser({ email: l.email, password: randomBytes(24).toString('base64url'), customerId: l.customerId, provisionedBy: actor.id });
    } catch (e) {
      return { ...base, login: 'FAILED', mail: 'NOT_SENT', detail: e instanceof AppError ? e.message : 'Could not create the login.' };
    }
    try {
      unwrap(await this.db.rpc('record_imported_client_login', { p_customer: l.customerId, p_user_id: userId, p_email: l.email }));
    } catch (e) {
      await this.authAdmin.deleteUser(userId).catch(() => undefined);
      return { ...base, login: 'FAILED', mail: 'NOT_SENT', detail: e instanceof AppError ? e.message : 'Could not save the login.' };
    }
    try {
      const link = await this.authAdmin.passwordLink(l.email, setPasswordUrl(origin));
      const r = await sendClientMail({ email: l.email, name: l.name }, { name: l.name, businessName: l.businessName, loginEmail: l.email, link, kind: 'WELCOME' });
      return { ...base, login: 'CREATED', mail: r.sent ? 'SENT' : 'NOT_SENT', detail: r.detail };
    } catch (e) {
      return { ...base, login: 'CREATED', mail: 'NOT_SENT', detail: e instanceof AppError ? e.message : 'The e-mail could not be sent.' };
    }
  }
}

/**
 * "Forgot password?" on the client sign-in page (no login). Always answers the same way, so nobody can find
 * out which e-mails have a login; the link is sent only to a client login.
 */
export async function clientForgotPassword(body: unknown, origin?: string): Promise<{ ok: true }> {
  const { email } = parse(clientForgotPasswordSchema, body);
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE');
  const authAdmin = new AuthAdminRepository();
  const login = await authAdmin.clientLoginForReset(email);
  if (login) {
    try {
      const link = await authAdmin.passwordLink(login.email, setPasswordUrl(origin));
      const r = await sendClientMail({ email: login.email, name: login.name }, { name: login.name, businessName: login.businessName, loginEmail: login.email, link, kind: 'RESET' });
      if (!r.sent) console.warn('[api] client reset e-mail not sent', r.detail);
    } catch (e) {
      console.warn('[api] client reset link failed', (e as Error)?.message);
    }
  }
  return { ok: true };
}
