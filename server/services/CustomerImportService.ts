import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerDataImportError, CustomerDataImportLogin, CustomerDataImportResult } from '../../shared/contracts.js';
import { clientAccountSchema, clientForgotPasswordSchema, customerDataImportSchema, uuidSchema } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { automationSettings, clientEmailSettings, liveChannels } from '../automations/config.js';
import { sendEmail } from '../automations/providers.js';
import { renderClientCredentialsEmail, renderClientPasswordEmail, type RenderedEmail } from '../automations/templates.js';
import { hasServiceClient } from '../db/supabase.js';
import { requestInfo } from '../http/context.js';
import { recordSecurityEvent } from '../security/events.js';
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
/** The client dashboard sign-in page (same base as the set-password link). */
function clientLoginUrl(origin: string | undefined): string {
  return setPasswordUrl(origin).replace(/\/client\/set-password$/, '/client/login');
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
async function sendClientMail(to: { email: string; name: string }, mail: RenderedEmail, customerId?: string): Promise<{ sent: boolean; detail?: string }> {
  const s = clientEmailSettings(automationSettings());
  if (s.mode !== 'live') return { sent: false, detail: 'E-mails are switched off on the server (AUTOMATION_MODE is not "live").' };
  if (!liveChannels(s).includes('EMAIL')) return { sent: false, detail: 'E-mail sending is not set up on the server.' };
  if (s.testRecipients && !s.testRecipients.emails.has(to.email.toLowerCase())) {
    return { sent: false, detail: 'Test mode: only the test recipients get e-mails.' };
  }
  // every e-mail sent here carries a set-password link or a password: never copied to anyone (CREDENTIALS), whatever EMAIL_CC / EMAIL_BCC say
  const r = await sendEmail(s, to, mail, undefined, { category: 'CREDENTIALS', application: 'CLIENT_PORTAL', template: 'client-login', ...(customerId ? { context: { customerId } } : {}) });
  return r.ok ? { sent: true } : { sent: false, detail: r.detail ?? 'The e-mail could not be sent.' };
}

type ImportRows = NonNullable<ReturnType<typeof customerDataImportSchema.parse>['data']['customers']>;

/**
 * The passwords the team typed for their clients (sheet "1 Customers", column "Client Password"). They are taken out of the rows
 * BEFORE the database sees the file, so no password reaches an RPC call, a log or the database as text; they live in this request's
 * memory only: Supabase Auth hashes it when the login is created, and the client's sign-in e-mail is sent with it straight away. A password needs a login e-mail: the "Client Login E-mail",
 * else the customer's own "E-mail". The same rules as a login made for a new customer apply.
 */
export function takeClientPasswords(rows: ImportRows | undefined): { rows: ImportRows | undefined; passwords: Map<string, string>; errors: CustomerDataImportError[] } {
  const passwords = new Map<string, string>();
  const errors: CustomerDataImportError[] = [];
  if (!rows) return { rows, passwords, errors };
  const out = rows.map(r => {
    const { loginPassword, ...rest } = r as Record<string, string | number | null | undefined>;
    const raw = loginPassword === null || loginPassword === undefined ? '' : String(loginPassword);
    if (raw.trim() === '') return rest as typeof r;
    const row = r.row;
    const fail = (message: string) => errors.push({ sheet: '1 Customers', row, message });
    const login = String(rest.loginEmail ?? rest.email ?? '').trim().toLowerCase();
    if (!login) {
      fail('A Client Password needs a Client Login E-mail (or the customer\'s E-mail) to sign in with.');
      return rest as typeof r;
    }
    // exactly what was typed: a space is a character of the password, never trimmed
    const check = clientAccountSchema.shape.password.safeParse(raw);
    if (!check.success) fail(check.error.issues[0]?.message ?? 'The Client Password is not valid.');
    else if (Buffer.byteLength(raw, 'utf8') > 72) fail('The Client Password is too long (72 characters at most).');
    else if (login.includes('@') && raw.toLowerCase() === login) fail('The Client Password cannot be the e-mail address.');
    else if (passwords.has(login)) fail('Another row uses the same Client Login E-mail.');
    else passwords.set(login, raw);
    return { ...rest, loginEmail: login } as unknown as typeof r;
  });
  return { rows: out, passwords, errors };
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
    const taken = takeClientPasswords(input.data.customers);
    const data = { ...input.data, customers: taken.rows };
    // a password that is not valid stops the save, like any other problem in the file (the rest is still checked and listed)
    const commit = input.commit && taken.errors.length === 0;
    if (commit && hasServiceClient()) setPasswordUrl(origin); // fail before saving when the link cannot be made
    const res = unwrap(await this.db.rpc('import_customer_data', { p_data: data, p_commit: commit })) as ImportRpcResult;
    const errors = [...taken.errors, ...(res.errors ?? [])];
    const out: CustomerDataImportResult = { committed: res.committed && taken.errors.length === 0, errors, summary: res.summary, logins: [] };
    if (!out.committed) {
      out.logins = (res.newLogins ?? []).map(l => ({
        ...l, login: 'FAILED', mail: 'NOT_SENT', passwordBy: taken.passwords.has(l.email.toLowerCase()) ? 'TEAM' : 'CLIENT',
        detail: 'Created when the file is saved.'
      }));
      return out;
    }
    const created = new Set<string>();
    for (const l of res.newLogins ?? []) {
      created.add(l.email.toLowerCase());
      out.logins.push(await this.createLogin(actor, l, origin, taken.passwords.get(l.email.toLowerCase())));
    }
    // a password for a customer who already had a login is not used (use "Forgot password?" or the set-password e-mail)
    const unused = [...taken.passwords.keys()].filter(e => !created.has(e));
    if (unused.length) out.passwordsNotUsed = unused;
    return out;
  }

  /**
   * The team (the relationship manager, Accounts) sends the "Set your password" e-mail again, e.g. the client did not set a password
   * within the link's 24 hours. The database checks who may and the limits first (one every 2 minutes and 5 a day per customer, 100 a
   * day per sender: 20270212000100), and records the send once the e-mail was accepted.
   */
  async sendPasswordEmail(actor: Actor, id: string, origin?: string): Promise<{ email: string; sent: boolean; detail?: string }> {
    const customerId = parse(uuidSchema, id);
    if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'Client logins are not set up on the server.');
    const t = unwrap(await this.db.rpc('client_password_link_begin', { p_customer: customerId })) as { email: string; name: string; businessName: string };
    const link = await this.authAdmin.passwordLink(t.email, setPasswordUrl(origin));
    const r = await sendClientMail({ email: t.email, name: t.name }, renderClientPasswordEmail({ name: t.name, businessName: t.businessName, loginEmail: t.email, link, kind: 'WELCOME' }), customerId);
    // only a link that went out counts towards the limits (a test-mode or failed e-mail uses nothing up)
    if (r.sent) unwrap(await this.db.rpc('client_password_link_sent', { p_customer: customerId }));
    // a password link was made for a client's login: who asked, for which customer (the address and the link are not recorded)
    const info = requestInfo.getStore();
    await recordSecurityEvent({
      action: 'CLIENT_PASSWORD_LINK_SENT', entityType: 'customer', entityId: customerId, actorId: actor.id, outcome: r.sent ? 'SUCCESS' : 'FAILURE',
      requestId: info?.requestId, ip: info?.ip, dedupeKey: `client-pwd-link:${customerId}:${Math.floor(Date.now() / 60_000)}`, metadata: { sent: r.sent }
    });
    return { email: t.email, ...r };
  }

  /** The "Client login" card: is there a login, did the client choose a password, the last link and when the next can be sent. */
  async clientLoginStatus(id: string): Promise<unknown> {
    return unwrap(await this.db.rpc('client_login_status', { p_customer: parse(uuidSchema, id) }));
  }

  /**
   * Creates the client's login after the customers were saved and e-mails them. Also used by the Google Sheet sync (SheetSyncService), which
   * records the login as the person who connected the sheet (`record`) and never has a team password.
   */
  async createLogin(actor: Pick<Actor, 'id'>, l: ImportRpcResult['newLogins'][number], origin?: string, teamPassword?: string,
    record: (customerId: string, userId: string, email: string) => Promise<unknown> = async (customerId, userId, email) =>
      unwrap(await this.db.rpc('record_imported_client_login', { p_customer: customerId, p_user_id: userId, p_email: email }))): Promise<CustomerDataImportLogin> {
    const base = { customerId: l.customerId, email: l.email, name: l.name, businessName: l.businessName };
    const passwordBy = teamPassword ? 'TEAM' : 'CLIENT';
    if (!hasServiceClient()) return { ...base, login: 'FAILED', mail: 'NOT_SENT', passwordBy, detail: 'Client logins are not set up on the server.' };
    let userId: string;
    try {
      // The password the team chose is hashed by Supabase Auth (the CRM keeps no copy of it; it goes to the client in one e-mail from memory).
      // Without one, a random password nobody knows: the client sets their own from the e-mailed link.
      userId = await this.authAdmin.createClientUser({ email: l.email, password: teamPassword ?? randomBytes(24).toString('base64url'), customerId: l.customerId, provisionedBy: actor.id });
    } catch (e) {
      return { ...base, login: 'FAILED', mail: 'NOT_SENT', passwordBy, detail: e instanceof AppError ? e.message : 'Could not create the login.' };
    }
    try {
      await record(l.customerId, userId, l.email);
    } catch (e) {
      await this.authAdmin.deleteUser(userId).catch(() => undefined);
      return { ...base, login: 'FAILED', mail: 'NOT_SENT', passwordBy, detail: e instanceof AppError ? e.message : 'Could not save the login.' };
    }
    if (teamPassword) {
      // who set a password for which customer (never the password)
      const info = requestInfo.getStore();
      await recordSecurityEvent({
        action: 'CLIENT_PASSWORD_SET_BY_TEAM', entityType: 'customer', entityId: l.customerId, actorId: actor.id, outcome: 'SUCCESS',
        requestId: info?.requestId, ip: info?.ip, dedupeKey: `client-pwd-team:${l.customerId}`, metadata: { via: 'excel_import' }
      }).catch(() => undefined);
      // The client gets their dashboard address, login e-mail and password in one e-mail, sent from memory right now. The CRM does not keep
      // the password, so this e-mail cannot be sent again; if it does not go out the team gives the client the password, or sends a set-password link.
      try {
        const r = await sendClientMail({ email: l.email, name: l.name }, renderClientCredentialsEmail({
          name: l.name, businessName: l.businessName, loginEmail: l.email, password: teamPassword, loginUrl: clientLoginUrl(origin)
        }));
        return { ...base, login: 'CREATED', mail: r.sent ? 'SENT' : 'NOT_SENT', passwordBy, detail: r.sent ? undefined : `${r.detail ?? 'The e-mail could not be sent.'} Give the client their password yourself.` };
      } catch (e) {
        return { ...base, login: 'CREATED', mail: 'NOT_SENT', passwordBy, detail: `${e instanceof AppError ? e.message : 'The e-mail could not be sent.'} Give the client their password yourself.` };
      }
    }
    try {
      const link = await this.authAdmin.passwordLink(l.email, setPasswordUrl(origin));
      const r = await sendClientMail({ email: l.email, name: l.name }, renderClientPasswordEmail({ name: l.name, businessName: l.businessName, loginEmail: l.email, link, kind: 'WELCOME' }));
      return { ...base, login: 'CREATED', mail: r.sent ? 'SENT' : 'NOT_SENT', passwordBy, detail: r.detail };
    } catch (e) {
      return { ...base, login: 'CREATED', mail: 'NOT_SENT', passwordBy, detail: e instanceof AppError ? e.message : 'The e-mail could not be sent.' };
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
  // The answer never tells the caller whether the address has a login; the log does (without the address).
  const info = requestInfo.getStore();
  await recordSecurityEvent({
    action: 'CLIENT_PASSWORD_RESET_REQUESTED', entityType: 'client_session', actorId: null, outcome: 'SUCCESS', requestId: info?.requestId, ip: info?.ip,
    dedupeKey: `client-reset:${info?.ip ?? 'unknown'}:${Math.floor(Date.now() / 300_000)}:${login ? 'match' : 'none'}`, metadata: { matched: !!login }
  });
  if (login) {
    try {
      const link = await authAdmin.passwordLink(login.email, setPasswordUrl(origin));
      const r = await sendClientMail({ email: login.email, name: login.name }, renderClientPasswordEmail({ name: login.name, businessName: login.businessName, loginEmail: login.email, link, kind: 'RESET' }));
      if (!r.sent) console.warn('[api] client reset e-mail not sent', r.detail);
    } catch (e) {
      console.warn('[api] client reset link failed', (e as Error)?.message);
    }
  }
  return { ok: true };
}
