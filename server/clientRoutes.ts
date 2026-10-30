import type { ClientProfile } from '../shared/contracts.js';
import { createUserClient } from './db/supabase.js';
import { AppError, fromDatabaseError } from './http/errors.js';
import { enforce, userBuckets, type BucketResult } from './http/rateLimit.js';
import type { ApiRequest, HandlerResult } from './http/types.js';
import { extractBearerToken } from './auth/authenticate.js';
import { createServices, type Services } from './services/index.js';
import { AuthAdminRepository } from './repositories/AuthAdminRepository.js';
import { clientNewPasswordSchema } from '../shared/validation.js';
import { parse } from './http/validate.js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The client dashboard API (mounted at /api/v1/client). A client signs in with the Supabase Auth login the
 * Technical Consultant created. Every route below works for that client's OWN records only: no customer id is
 * accepted from the request, the database works it out from the login. A staff login (or no login) is refused.
 */
export interface ClientContext {
  req: ApiRequest;
  params: Record<string, string>;
  db: SupabaseClient;
  me: ClientProfile;
  services: Services;
}
export type ClientHandler = (ctx: ClientContext) => Promise<HandlerResult>;

export interface ClientRouteDef {
  method: 'GET' | 'POST' | 'DELETE';
  /** Relative to /client. */
  path: string;
  handler: ClientHandler;
}

const ok = <T>(data: T, status = 200): HandlerResult => ({ status, data });

/**
 * The client chooses their own password. Works before anything else (the only route that does) while a temporary password is in force, and
 * after the "Forgot password?" link. The new password is put on the sign-in by the server, so it cannot be skipped: it must differ from the
 * password that signs in right now (the temporary one), and only then is the temporary password retired in the database. Never logged or returned.
 */
async function changeClientPassword(c: ClientContext): Promise<HandlerResult> {
  await enforce([{ key: `pwchange:${c.me.customerId}`, limit: 10, window: 900 }], 'memory');
  const { password } = parse(clientNewPasswordSchema, c.req.body);
  const userId = c.me.loginId;
  if (!userId) throw new AppError('INTERNAL', 'Could not find your sign-in.');
  const admin = new AuthAdminRepository();
  if (await admin.passwordSignsIn(c.me.loginEmail, password)) {
    throw new AppError('VALIDATION_ERROR', 'Choose a different password from the one you were given.');
  }
  await admin.setClientPassword(userId, password);
  await admin.clientPasswordChanged(userId);
  return ok({ changed: true });
}

export const clientRoutes: ClientRouteDef[] = [
  { method: 'GET', path: '/me', handler: async c => ok(c.me) },
  { method: 'POST', path: '/password', handler: changeClientPassword },
  { method: 'GET', path: '/overview', handler: async c => ok(await c.services.client.overview()) },
  { method: 'GET', path: '/journey', handler: async c => ok(await c.services.client.journey()) },
  { method: 'GET', path: '/subscription', handler: async c => ok(await c.services.client.subscriptions()) },
  { method: 'GET', path: '/services', handler: async c => ok(await c.services.client.services()) },
  { method: 'GET', path: '/billing', handler: async c => ok(await c.services.client.billing()) },
  { method: 'GET', path: '/service-progress', handler: async c => ok(await c.services.client.serviceProgress()) },
  { method: 'GET', path: '/campaigns', handler: async c => ok(await c.services.client.campaigns()) },
  { method: 'GET', path: '/catalog', handler: async c => ok(await c.services.client.catalog()) },
  { method: 'GET', path: '/service-requests', handler: async c => ok(await c.services.client.serviceRequests()) },
  { method: 'POST', path: '/service-requests', handler: async c => ok(await c.services.client.requestService(c.req.body), 201) },
  { method: 'DELETE', path: '/service-requests/:id', handler: async c => (await c.services.client.cancelServiceRequest(c.params.id), ok(null)) },
  { method: 'GET', path: '/plans', handler: async c => ok(await c.services.client.plans()) },
  { method: 'POST', path: '/plan-requests', handler: async c => ok(await c.services.client.requestPlan(c.req.body), 201) },
  { method: 'GET', path: '/invoices', handler: async c => ok(await c.services.client.invoices()) },
  { method: 'GET', path: '/invoices/:id/url', handler: async c => ok(await c.services.client.invoiceUrl(c.params.id, c.req.query)) },
  { method: 'GET', path: '/tickets', handler: async c => ok(await c.services.client.tickets()) },
  { method: 'POST', path: '/tickets', handler: async c => ok(await c.services.client.createTicket(c.req.body), 201) },
  { method: 'GET', path: '/tickets/:id', handler: async c => ok(await c.services.client.ticket(c.params.id)) },
  { method: 'POST', path: '/tickets/:id/replies', handler: async c => ok(await c.services.client.replyTicket(c.params.id, c.req.body), 201) },
  { method: 'POST', path: '/tickets/:id/messages', handler: async c => ok(await c.services.client.sendTicketMessage(c.params.id, c.req.body), 201) },
  { method: 'GET', path: '/tickets/:id/attachments', handler: async c => ok(await c.services.ticketFiles.forTicket(c.params.id)) },
  { method: 'POST', path: '/tickets/uploads', handler: async c => ok(await c.services.ticketFiles.beginUpload(c.req.body), 201) },
  { method: 'POST', path: '/tickets/uploads/:id/complete', handler: async c => ok(await c.services.ticketFiles.completeUpload(c.params.id)) },
  { method: 'POST', path: '/tickets/uploads/:id/abort', handler: async c => ok(await c.services.ticketFiles.abortUpload(c.params.id)) },
  { method: 'GET', path: '/tickets/attachments/:id/url', handler: async c => ok(await c.services.ticketFiles.attachmentUrl(c.params.id, c.req.query)) },
  { method: 'POST', path: '/tickets/:id/seen', handler: async c => ok(await c.services.client.ticketSeen(c.params.id)) },
  { method: 'GET', path: '/calendar', handler: async c => ok(await c.services.client.calendar(c.req.query)) },
  { method: 'GET', path: '/documents', handler: async c => ok(await c.services.client.documents()) },
  { method: 'POST', path: '/documents/uploads', handler: async c => ok(await c.services.client.beginDocumentUpload(c.req.body), 201) },
  { method: 'POST', path: '/documents/uploads/:id/complete', handler: async c => ok(await c.services.client.completeDocumentUpload(c.params.id)) },
  { method: 'POST', path: '/documents/uploads/:id/abort', handler: async c => ok(await c.services.client.abortDocumentUpload(c.params.id)) },
  { method: 'POST', path: '/documents/details', handler: async c => ok(await c.services.client.saveDetail(c.req.body)) },
  { method: 'GET', path: '/documents/:id/url', handler: async c => ok(await c.services.client.documentUrl(c.params.id, c.req.query)) },
  { method: 'GET', path: '/chat', handler: async c => ok(await c.services.chat.clientView(c.req.query)) },
  { method: 'GET', path: '/chat/messages', handler: async c => ok(await c.services.chat.clientMessages(c.req.query)) },
  { method: 'POST', path: '/chat/messages', handler: async c => ok(await c.services.chat.clientSend(c.req.body), 201) },
  { method: 'POST', path: '/chat/read', handler: async c => ok(await c.services.chat.clientMarkRead(c.req.body)) },
  { method: 'GET', path: '/chat/unread', handler: async c => ok(await c.services.chat.unread()) },
  { method: 'POST', path: '/chat/uploads', handler: async c => ok(await c.services.chat.clientBeginUpload(c.req.body), 201) },
  { method: 'POST', path: '/chat/uploads/:id/complete', handler: async c => ok(await c.services.chat.completeUpload(c.params.id)) },
  { method: 'POST', path: '/chat/uploads/:id/abort', handler: async c => ok(await c.services.chat.abortUpload(c.params.id)) },
  { method: 'GET', path: '/chat/attachments/:id/url', handler: async c => ok(await c.services.chat.attachmentUrl(c.params.id, c.req.query)) },
  { method: 'GET', path: '/announcements', handler: async c => ok(await c.services.client.announcements()) },
  { method: 'POST', path: '/announcements/:id/dismiss', handler: async c => ok(await c.services.client.dismissAnnouncement(c.params.id, c.req.body)) },
  { method: 'GET', path: '/notifications', handler: async c => ok(await c.services.client.notifications(c.req.query)) },
  { method: 'POST', path: '/notifications/read', handler: async c => ok(await c.services.client.markRead(c.req.body)) }
];

/** Verifies the login belongs to a client (one database call that also loads their profile) and applies the rate limit. */
export async function authenticateClient(authorizationHeader: string | undefined): Promise<{ db: SupabaseClient; me: ClientProfile; limit: BucketResult }> {
  const token = extractBearerToken(authorizationHeader);
  const db = createUserClient(token);
  const { data, error, status } = await db.rpc('client_me');
  if (error) {
    if (status === 401 || /jwt|jws|token/i.test(error.message) || error.code === 'PGRST301') {
      throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
    if (!status) throw new AppError('SERVICE_UNAVAILABLE', 'The server could not reach Supabase.');
    throw fromDatabaseError(error);
  }
  const me = data as ClientProfile;
  const limit = await enforce(userBuckets(`client:${me.customerId}`, 'default'), 'memory');
  return { db, me, limit };
}

export const clientServices = (db: SupabaseClient): Services => createServices(db);
export const clientRouteMatchers = clientRoutes.map(r => new RegExp(`^/client${r.path.replace(/:[^/]+/g, '[^/]+')}$`));
