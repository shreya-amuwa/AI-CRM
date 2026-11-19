import {runCareerAutomation} from './automations/careerDispatcher.js';
import { CareerRepository } from './repositories/CareerRepository.js';
import { candidateRoutes } from './candidateRoutes.js';
import { finishGoogleConnect } from './meetings/connect.js';
import { answerBookingProposal, bookingPage, bookSlot, cancelBooking, viewBooking } from './meetings/publicBooking.js';
import { runMeetingsDispatch } from './meetings/worker.js';
import { createUserClient, getAnonClient } from './db/supabase.js';
import { extractBearerToken } from './auth/authenticate.js';
import { getRequestListener } from '@hono/node-server';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiResponse } from '../shared/contracts.js';
import { assertActive, authenticateRequest, type Actor } from './auth/authenticate.js';
import { ConfigurationError, getEnv } from './config/env.js';
import { healthCheck } from './health.js';
import { AppError, fromDatabaseError } from './http/errors.js';
import { parse } from './http/validate.js';
import { biometricPunchSchema, loginFailureReportSchema } from '../shared/validation.js';
import { enforce, ipBuckets, userBuckets, type BucketResult } from './http/rateLimit.js';
import type { ApiRequest, HttpMethod, RouteDef } from './http/types.js';
import { routes } from './routes.js';
import { automationSettings } from './automations/config.js';
import { authenticateClient, clientRouteMatchers, clientRoutes, clientServices } from './clientRoutes.js';
import { dispatchQuietly, runDispatch } from './automations/dispatcher.js';
import { resolveAttendancePlaces } from './automations/attendancePlaces.js';
import { runAttendanceReminders } from './automations/attendanceReminders.js';
import { messageIdFrom, pushChatMessage } from './automations/chatPush.js';
import { runWelcomeEmailDispatch, welcomeEmailQuietly } from './automations/welcomeDispatcher.js';
import { handleAuthEmailHook } from './automations/authEmailHook.js';
import { isPausedVercelCron } from './platform.js';
import { runDecisionEmailDispatch } from './recruitment/emailDispatcher.js';
import { runHrAutomation } from './automations/hrDispatcher.js';
import { financeMailQuietly, runFinanceMailDispatch } from './automations/financeDispatcher.js';
import { runPerformanceAutomation } from './performance/writer.js';
import { runTopPerformersAutomation } from './topPerformers/writer.js';
import { runReportAnalysisAutomation } from './reportAnalysis/writer.js';
import { runTrainingAutomation } from './automations/trainingDispatcher.js';
import { runSubscriptionReminders } from './automations/subscriptionReminders.js';
import { bolifyCallResult, bolifySender } from './automations/bolify.js';
import { runAllSubscriptionMessages } from './automations/subscriptionMessages.js';
import { applyDeliveryReport, normalizeProviderStatus, runInvoiceWhatsApp } from './invoices/whatsapp.js';
import { applyLeadDeliveryReport, assignsLeads, leadWhatsAppQuietly, runLeadWhatsApp } from './leads/whatsapp.js';
import { StorageRepository } from './repositories/StorageRepository.js';
import { timingSafeEqual } from 'node:crypto';
import { getServiceClient, hasServiceClient } from './db/supabase.js';
import { clientForgotPassword } from './services/CustomerImportService.js';
import { staffForgotPassword } from './services/StaffPasswordService.js';
import { registerCandidate } from './services/CandidateRegistrationService.js';
import { requestInfo } from './http/context.js';
import { deviceLabel, recordSecurityEvent, sessionClaims } from './security/events.js';
import { reportServerError } from './monitoring.js';
import { locateRequest, trustedClientIp } from './security/clientNetwork.js';
import { currentEdgeLimiter, emailKey, isDisposableEmail, isPortalServer, limitOf, turnstileRefused, verifiedPortalClient, verifyTurnstile, type TurnstileAction } from './security/abuse.js';
import { candidateGuardSchema } from '../shared/validation.js';
import { crocodialSyncQuietly } from './crocodial/sync.js';

export const API_PREFIX = '/api/v1';
const MAX_BODY_BYTES = 1_000_000;
const IMPORT_BODY_BYTES = 4_000_000;

type Env = { Variables: { requestId: string; actor?: Actor; db?: SupabaseClient; errorCode?: string } };

// ---------------------------------------------------------------------------
// App + global middleware
// ---------------------------------------------------------------------------
/** Only the shape of the two scope headers is checked here; whether the caller may use them is the database's decision. */
function requestedScope(department: string | undefined, division: string | undefined): { department?: string; division?: string } | undefined {
  const d = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(department ?? '') ? department!.toLowerCase() : undefined;
  const v = /^(SALES|SUPPORT)$/i.test(division ?? '') ? division!.toUpperCase() : undefined;
  return d || v ? { department: d, division: v } : undefined;
}

export const app = new Hono<Env>().basePath(API_PREFIX);

app.use('*', requestId());
// the request id (and caller address) follow the request into the database client, so audit rows can be tied back to it
app.use('*', (c, next) => requestInfo.run({ requestId: c.get('requestId'), ip: clientIp(c), scope: requestedScope(c.req.header('x-active-department'), c.req.header('x-active-division')) }, next));
app.use('*', accessLog());
app.use('*', securityAudit());
app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-site' }));
app.use(
  '*',
  cors({
    // Same-origin calls need no CORS; only explicitly allowed origins get headers.
    origin: origin => (allowedOrigins().includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Active-Department', 'X-Active-Division'],
    exposeHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 600
  })
);
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
const tooLarge = () => {
  throw new AppError('VALIDATION_ERROR', 'Request body is too large.');
};
const defaultBodyLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
// The Excel import of existing customers sends the whole workbook as JSON (up to 5000 rows); so does the Upload Leads preview.
const importBodyLimit = bodyLimit({ maxSize: IMPORT_BODY_BYTES, onError: tooLarge });
app.use('*', (c, next) => (relativePath(c) === '/customers/import-existing' || relativePath(c) === '/lead-uploads/check' ? importBodyLimit(c, next) : defaultBodyLimit(c, next)));
// Layer 1: coarse per-IP flood protection before any auth work. On the Worker: Cloudflare's rate limiter (counts across the edge location,
// not per isolate); elsewhere, or if it fails: the in-memory limiter.
app.use('*', async (c, next) => {
  if (c.req.method !== 'OPTIONS') {
    const edge = currentEdgeLimiter();
    let checked = false;
    if (edge) {
      try {
        if (!(await edge(`ip:${clientIp(c)}`))) throw new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', { retryAfterSeconds: 60 });
        checked = true;
      } catch (err) {
        if (err instanceof AppError) throw err;
      }
    }
    if (!checked) await enforce(ipBuckets(clientIp(c)), 'memory');
  }
  await next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', async c => c.json(ok(await healthCheck())));

// Onboarding emails / WhatsApp: a change made in the Technical Consultant's (or
// Accounts') work queues messages in the database; send them right away, within
// the same request, so they go out in seconds. Never fails the request itself.
app.use('/pipeline/customers/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 300) await dispatchQuietly();
});

// Chat push notifications (20270111000100): a message that was sent is pushed to the other people's phones and laptops right after the
// answer (Worker waitUntil), so sending never waits for it or fails because of it.
const chatPushAfterSend: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || c.res.status >= 300) return;
  const id = messageIdFrom(await c.res.clone().json().catch(() => null));
  if (id) await afterResponse(c, pushChatMessage(id));
};
app.use('/chat/conversations/:id/messages', chatPushAfterSend);
app.use('/chat/conversations/:id/secure-messages', chatPushAfterSend);
app.use('/client/chat/messages', chatPushAfterSend);

// New employees: the database queues the welcome e-mail when an account becomes active (a request approved, or an active account created);
// it is sent right away, within the same request, so the employee has the e-mail in seconds. Never fails the request itself. The scheduler
// below retries anything that could not be sent, so no Email Automation page has to be open.
app.use('/employee-requests/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 300) await welcomeEmailQuietly();
});
app.use('/users', async (c, next) => {
  await next();
  if (c.req.method === 'POST' && c.res.status < 300) await welcomeEmailQuietly();
});

// An expense (or a retry of a Department Head e-mail) in Accounts' finance pages: its e-mails go out right away.
app.use('/accounts/finance/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 300) await financeMailQuietly();
});
app.use('/accounts/finance-mail/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 300) await financeMailQuietly();
});

// An approval or a retry in the HR dashboard sends its e-mails right away (the scheduler would do it at its next run).
app.use('/hr/email-automation/*', async (c, next) => {
  await next();
  if (c.req.method === 'POST' && c.res.status < 300 && !relativePath(c).endsWith('/run')) await runHrAutomation().catch(() => undefined);
});

// The WhatsApp provider's delivery reports for the invoices sent through it: POST { reference, status: delivered | read | failed, detail? } with
// "Authorization: Bearer <WABASTORE_STATUS_SECRET>" (16+ characters). A report only moves a message forward (accepted -> delivered -> read).
app.post('/internal/whatsapp/status', async c => {
  const secret = (process.env.WABASTORE_STATUS_SECRET || '').trim();
  if (secret.length < 16) throw new AppError('SERVICE_UNAVAILABLE', 'Delivery reports are not configured.');
  const given = Buffer.from((c.req.header('authorization') || '').replace(/^Bearer\s+/i, '') || c.req.header('x-webhook-secret') || '');
  const want = Buffer.from(secret);
  if (want.length !== given.length || !timingSafeEqual(want, given)) throw new AppError('UNAUTHENTICATED');
  if (Number(c.req.header('content-length') || 0) > 20_000) throw new AppError('VALIDATION_ERROR', 'The report is too large.');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const ref = String(body?.reference ?? body?.message_id ?? body?.id ?? '').trim();
  const status = normalizeProviderStatus(body?.status);
  if (!body || !ref || ref.length > 200) throw new AppError('VALIDATION_ERROR', 'Send the message reference and its status.');
  if (!status) return c.json(ok({ matched: false, ignored: true }));
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 300) : null;
  // the same endpoint serves the paid-invoice and the lead welcome messages: the reference belongs to one of them
  const invoice = await applyDeliveryReport(ref, status, detail);
  return c.json(ok(invoice.matched ? invoice : await applyLeadDeliveryReport(ref, status, detail)));
});

// BolifyAI call results for the reminder calls: POST { call_id, status, duration?, detail? } with "Authorization: Bearer <BOLIFY_CALLBACK_SECRET>"
// (16+ characters). status: completed / answered -> COMPLETED; no-answer -> NOT_ANSWERED; busy -> BUSY; failed -> FAILED; anything else is ignored.
// The field names are provisional until BolifyAI's callback format is confirmed (bolifyCallResult in server/automations/bolify.ts).
app.post('/internal/bolify/call-status', async c => {
  const secret = (process.env.BOLIFY_CALLBACK_SECRET || '').trim();
  if (secret.length < 16) throw new AppError('SERVICE_UNAVAILABLE', 'Call results are not configured.');
  const given = Buffer.from((c.req.header('authorization') || '').replace(/^Bearer\s+/i, '') || c.req.header('x-webhook-secret') || '');
  const want = Buffer.from(secret);
  if (want.length !== given.length || !timingSafeEqual(want, given)) throw new AppError('UNAUTHENTICATED');
  if (Number(c.req.header('content-length') || 0) > 20_000) throw new AppError('VALIDATION_ERROR', 'The report is too large.');
  const parsed = bolifyCallResult(await c.req.json().catch(() => null));
  if (!parsed) throw new AppError('VALIDATION_ERROR', 'Send the call id and its status.');
  if (!parsed.outcome) return c.json(ok({ matched: false, ignored: true }));
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'The server has no service key.');
  const { data, error } = await getServiceClient().rpc('sub_reminder_call_result', {
    p_call_id: parsed.callId, p_outcome: parsed.outcome, p_duration_seconds: parsed.durationSeconds, p_detail: parsed.detail
  });
  if (error) {
    if (/NOT_FOUND/.test(error.message)) return c.json(ok({ matched: false }));
    if (/VALIDATION_ERROR/.test(error.message)) throw new AppError('VALIDATION_ERROR', 'The call result is not valid.');
    throw new AppError('SERVICE_UNAVAILABLE', 'The call result could not be recorded.');
  }
  return c.json(ok({ matched: true, ...(data as Record<string, unknown>) }));
});

/** The scheduled runs' check: "Authorization: Bearer <AUTOMATION_DISPATCH_SECRET>" (or Vercel Cron's CRON_SECRET), compared in constant time. */
function requireDispatchSecret(header: string | undefined): void {
  const secrets = automationSettings().dispatchSecrets;
  if (!secrets.length) throw new AppError('SERVICE_UNAVAILABLE', 'Automation dispatch is not configured.');
  const given = Buffer.from((header || '').replace(/^Bearer\s+/i, ''));
  const okSecret = secrets.some(sec => {
    const want = Buffer.from(sec);
    return want.length === given.length && timingSafeEqual(want, given);
  });
  if (!okSecret) throw new AppError('UNAUTHENTICATED');
}

// Attendance reminders, every 5 minutes from the Worker's scheduled run (migration 20270109000200): the database decides what is due and
// puts it in the bell; this pushes it to the person's devices. Same secret and the same Vercel stand-down as the dispatch below.
app.post('/internal/attendance/reminders', async c => {
  requireDispatchSecret(c.req.header('authorization'));
  if (isPausedVercelCron(c.req.header('user-agent'))) return c.json(ok({ skipped: true, reason: 'VERCEL_CRON_PAUSED is true: the scheduled automations run on Cloudflare.' }));
  return c.json(ok(await runAttendanceReminders()));
});

// Safety net + retries: call with "Authorization: Bearer <AUTOMATION_DISPATCH_SECRET>"
// (or Vercel Cron's CRON_SECRET), e.g. every few minutes from Supabase pg_cron.
app.on(['GET', 'POST'], '/internal/automations/dispatch', async c => {
  requireDispatchSecret(c.req.header('authorization'));
  // After the move to Cloudflare: Vercel's own cron stands down when VERCEL_CRON_PAUSED=true, so the automations run on one platform only.
  if (isPausedVercelCron(c.req.header('user-agent'))) return c.json(ok({ skipped: true, reason: 'VERCEL_CRON_PAUSED is true: the scheduled automations run on Cloudflare.' }));
  // The same safety-net run moves overdue tickets up (RM -> Team Lead -> Department Head) when pg_cron is not set up.
  let ticketsEscalated = 0;
  if (hasServiceClient()) {
    const { data, error } = await getServiceClient().rpc('escalate_overdue_tickets');
    if (error) log('error', 'ticket escalation failed', c, { message: error.message });
    else ticketsEscalated = Number(data) || 0;
  }
  // The Technical Consultant's consultation follow-ups: revalidate every open one against the persisted customer, cancel what no longer applies,
  // notify the responsible user ONCE when one has become due. Persistent (no browser timers); idempotent.
  let tcFollowups: unknown = null;
  if (hasServiceClient()) {
    const { data, error } = await getServiceClient().rpc('tc_followups_process_due');
    if (error) log('error', 'consultation follow-ups failed', c, { message: error.message });
    else tcFollowups = data;
  }
  // HR e-mails (birthdays, anniversaries, probation reminders, confirmations): decide what is due today, then send. Idempotent.
  const hr = await runHrAutomation();
  // Welcome e-mails of new employees: the retries (and anything left waiting).
  const welcomeEmails = await runWelcomeEmailDispatch().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Candidate selection / rejection e-mails (queued by the database with each recruiter decision): the retries and anything left waiting. Backend only.
  const recruitmentEmails = await runDecisionEmailDispatch().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Department Head e-mails about payments and expenses: the retries (and anything left waiting).
  const financeMail = await runFinanceMailDispatch().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Panel recharge reminder calls (7, 5 and 1 day before expiry): decided and tracked in the database. Dry run by default; live places the
  // calls through BolifyAI when BOLIFY_API_KEY (or the older BOLIFY_WEBHOOK_URL) is set.
  const subscriptionReminders = await runSubscriptionReminders({ sender: bolifySender() });
  // The same reminders by e-mail and WhatsApp (Wabastore): dry run by default; live only with an approved wording and a connected provider.
  const subscriptionMessages = await runAllSubscriptionMessages();
  // Paid invoices by WhatsApp: the retries (and anything left waiting). A click sends its own message at once; this is the safety net.
  const invoiceWhatsApp = await runInvoiceWhatsApp(new StorageRepository());
  // Lead welcome WhatsApp ("our services", once when a lead is first given to a sales person): the retries and anything left waiting.
  const leadWhatsApp = await runLeadWhatsApp().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Crocodial (read-only): leads, call logs, follow-ups and remarks of the connections that are switched on, at most every 15 minutes each;
  // a long first pull continues on the next runs. Never throws.
  const crocodial = await crocodialSyncQuietly(15_000);
  // Performance reports (Team Lead / Department Head): refresh the weekly and monthly reports whose task figures changed, then write their analysis. Idempotent.
  // HR training: end the programs that are over, make the consolidated reports, remind HR of the day reports still missing. Idempotent.
  const careers = await runCareerAutomation().catch(() => ({ error: 'Candidate maintenance failed.' }));
  const training = await runTrainingAutomation().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  const performance = await runPerformanceAutomation().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Top performers: recalculate the monthly scores from the task and approved report records, prepare the monthly recommendations, write the evaluations. Idempotent.
  const topPerformers = await runTopPerformersAutomation().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Company report analysis: write the analysis of every consolidated week HR submitted that is still waiting for it. Idempotent.
  const reportAnalysis = await runReportAnalysisAutomation().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Attendance: the place name of punches that have coordinates and no name yet (one lookup a second, as the free geocoder asks). Never throws.
  // Meetings: reminders (24 h / 1 h before), the Google Calendar sync of every changed meeting, and the e-mails to guests. Idempotent.
  const meetings = await runMeetingsDispatch({ budgetMs: 15_000 }).catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  const attendancePlaces = await resolveAttendancePlaces({ limit: 10, budgetMs: 15_000 });
  return c.json(ok({ ...(await runDispatch({ limit: 50, budgetMs: 25_000 })), attendancePlaces, meetings, ticketsEscalated, tcFollowups, hr, welcomeEmails, recruitmentEmails, financeMail, subscriptionReminders, subscriptionMessages, invoiceWhatsApp, leadWhatsApp, crocodial, performance, topPerformers, reportAnalysis, training, careers }));
});

// Supabase "Send Email" auth hook: Supabase hands every sign-up / reset / invite e-mail to the CRM, which sends it through its own mail setup
// (docs/AUTH_EMAIL_HOOK.md). Authenticated by Supabase's signature (SUPABASE_AUTH_HOOK_SECRET), not by a user token.
app.post('/internal/auth/email-hook', async c => {
  const reply = await handleAuthEmailHook({
    body: await c.req.text(),
    id: c.req.header('webhook-id'),
    timestamp: c.req.header('webhook-timestamp'),
    signature: c.req.header('webhook-signature')
  });
  return c.json(reply.body, reply.status as 200);
});

// Biometric device gateway: one punch per call, authenticated with "Authorization: Bearer <BIOMETRIC_INGEST_SECRET>".
// The first punch of the office day for that e-mail counts. Unknown or inactive e-mails are refused (404).
app.post('/integrations/biometric/punch', async c => {
  const secrets = (process.env.BIOMETRIC_INGEST_SECRET || '').split(',').map(s => s.trim()).filter(s => s.length >= 16);
  if (!secrets.length) throw new AppError('SERVICE_UNAVAILABLE', 'Biometric punches are not configured.');
  const given = Buffer.from((c.req.header('authorization') || '').replace(/^Bearer\s+/i, ''));
  if (!secrets.some(sec => { const want = Buffer.from(sec); return want.length === given.length && timingSafeEqual(want, given); })) {
    throw new AppError('UNAUTHENTICATED');
  }
  const input = parse(biometricPunchSchema, await readJson(c));
  const { data, error } = await getServiceClient().rpc('record_biometric_punch', { p_email: input.email, p_punched_at: input.punchedAt });
  if (error) throw fromDatabaseError(error);
  if (data === 'UNKNOWN_EMPLOYEE') throw new AppError('NOT_FOUND', 'No active employee has this e-mail.');
  return c.json(ok({ recorded: true }));
});

// Meetings: Google's return from an employee's "Connect Google Calendar" (no CRM login: the signed state names the employee). Redirects back.
app.get('/integrations/google/callback', async c => {
  await enforce([{ key: `google-callback:${clientIp(c)}`, limit: 20, window: 900 }], 'memory');
  return c.redirect(await finishGoogleConnect(c.req.query()), 302);
});

// Meetings: public booking links ("/book/<slug>") for customers, leads and candidates. No login. Bookings and a guest's changes are counted in
// the database (one count across every server instance, docs/ABUSE_PROTECTION.md); page and slot reads only in memory, like the job list.
app.get('/public/booking/:slug', async c => {
  await enforce([{ key: `booking-page:${clientIp(c)}`, limit: limitOf('BOOKING_VIEW_PER_IP_5MIN'), window: 300 }], 'memory');
  return c.json(ok(await bookingPage(c.req.param('slug'))));
});
app.post('/public/booking/:slug', async c => {
  const body = await readJson(c);
  const ip = clientIp(c);
  const email = emailKey((body as { email?: unknown } | undefined)?.email);
  await enforce(
    [
      { key: `booking-book:ip:${ip}`, limit: limitOf('BOOKING_PER_IP_15MIN'), window: 900 },
      { key: `booking-book-day:ip:${ip}`, limit: limitOf('BOOKING_PER_IP_DAY'), window: 86_400 },
      ...(email ? [{ key: `booking-book:email:${email}`, limit: limitOf('BOOKING_PER_EMAIL_DAY'), window: 86_400 }] : []),
      // a ceiling for the whole site: a booking flood from many addresses stops here
      { key: 'booking-book:site', limit: limitOf('BOOKING_SITE_HOUR'), window: 3600 }
    ],
    'shared'
  );
  return c.json(ok(await bookSlot(c.req.param('slug'), body)), 201);
});
app.get('/public/booking/manage/:token', async c => {
  await enforce([{ key: `booking-manage:${clientIp(c)}`, limit: limitOf('BOOKING_VIEW_PER_IP_5MIN'), window: 300 }], 'memory');
  return c.json(ok(await viewBooking(c.req.param('token'))));
});
app.post('/public/booking/manage/:token/cancel', async c => {
  await enforce([{ key: `booking-manage-w:ip:${clientIp(c)}`, limit: limitOf('BOOKING_MANAGE_PER_IP_15MIN'), window: 900 }], 'shared');
  return c.json(ok(await cancelBooking(c.req.param('token'), await readJson(c))));
});
app.post('/public/booking/manage/:token/proposal', async c => {
  await enforce([{ key: `booking-manage-w:ip:${clientIp(c)}`, limit: limitOf('BOOKING_MANAGE_PER_IP_15MIN'), window: 900 }], 'shared');
  return c.json(ok(await answerBookingProposal(c.req.param('token'), await readJson(c))));
});

// Candidate-portal registration (no login yet, so public): creates an already confirmed candidate account; the portal then signs the candidate in
// with the password they chose. No e-mail, OTP, phone or approval step. docs/CANDIDATE_REGISTRATION.md. Limited per address and per e-mail.
app.post('/candidate-auth/register', async c => {
  const body = await readJson(c);
  const email = emailKey((body as { email?: unknown } | undefined)?.email) || 'none';
  await botCheck(c, 'sign_up');
  await enforce(
    [
      { key: `cand-register:ip:${clientIp(c)}`, limit: limitOf('CAND_SIGNUP_PER_IP_HOUR'), window: 3600 },
      { key: `cand-register:email:${email}`, limit: limitOf('CAND_SIGNUP_PER_EMAIL_HOUR'), window: 3600 },
      // a ceiling for the whole site: a sign-up flood from many addresses stops here
      { key: 'cand-register:site', limit: limitOf('CAND_SIGNUP_SITE_HOUR'), window: 3600 }
    ],
    'shared'
  );
  if (email !== 'none' && isDisposableEmail(email)) {
    throw new AppError('VALIDATION_ERROR', 'Use a permanent e-mail address: temporary or throwaway addresses cannot be used.', { fields: { email: 'Use a permanent e-mail address.' } });
  }
  return c.json(ok(await registerCandidate(body)), 201);
});

// The Candidate Portal asks here before it signs a candidate in, sends a reset link (both go to Supabase directly) or submits an
// application: the bot check and the limits for that action. Public (no login yet), answers { allowed: true } or an error.
app.post('/candidate-auth/guard', async c => {
  const input = parse(candidateGuardSchema, await readJson(c));
  await botCheck(c, input.action);
  const ip = clientIp(c);
  const email = emailKey(input.email);
  const buckets =
    input.action === 'sign_in'
      ? [
          { key: `cand-signin:ip:${ip}`, limit: limitOf('CAND_SIGNIN_PER_IP_15MIN'), window: 900 },
          ...(email ? [{ key: `cand-signin:email:${email}`, limit: limitOf('CAND_SIGNIN_PER_EMAIL_15MIN'), window: 900 }] : [])
        ]
      : input.action === 'reset'
        ? [
            { key: `reset:candidate:ip:${ip}`, limit: limitOf('RESET_PER_IP_15MIN'), window: 900 },
            ...(email ? [{ key: `reset:email:${email}`, limit: limitOf('RESET_PER_EMAIL_HOUR'), window: 3600 }] : [])
          ]
        : [{ key: `cand-apply-guard:ip:${ip}`, limit: limitOf('CAND_APPLY_GUARD_PER_IP_HOUR'), window: 3600 }];
  await enforce(buckets, 'shared');
  return c.json(ok({ allowed: true }));
});

// "Forgot password?" on the staff sign-in page (no login). Same answer whatever the e-mail; at most a few a quarter hour per caller and per address.
app.post('/auth/forgot-password', async c => {
  const body = await readJson(c);
  const typed = typeof (body as { email?: unknown })?.email === 'string' ? String((body as { email: string }).email).trim().toLowerCase().slice(0, 254) : '';
  // counted in the database: one shared count across every server instance (each request may land on a different one)
  await enforce([
    { key: `reset:staff:ip:${clientIp(c)}`, limit: limitOf('RESET_PER_IP_15MIN'), window: 900 },
    ...(typed ? [{ key: `reset:email:${typed}`, limit: limitOf('RESET_PER_EMAIL_HOUR'), window: 3600 }] : [])
  ], 'shared');
  return c.json(ok(await staffForgotPassword(body)));
});

// Attendance reminders: a browser renewed its push subscription on its own (public/sw.js, "pushsubscriptionchange"). The service worker
// runs with nobody signed in, so the old subscription address (known only to that browser and the CRM) is the proof: the database moves
// an existing, active device to the new address for the same person, and changes nothing otherwise (20270110000200).
app.post('/attendance/push-resubscribe', async c => {
  await enforce([{ key: `push-resubscribe:ip:${clientIp(c)}`, limit: 30, window: 3600 }], 'memory');
  const body = (await readJson(c)) as { oldEndpoint?: unknown; endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
  const oldEndpoint = str(body?.oldEndpoint, 1000), endpoint = str(body?.endpoint, 1000);
  const p256dh = str(body?.keys?.p256dh, 200), auth = str(body?.keys?.auth, 100);
  if (!oldEndpoint || !endpoint || !p256dh || !auth || !/^https:\/\//.test(endpoint)) {
    throw new AppError('VALIDATION_ERROR', 'Send the old and the new subscription.');
  }
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'The server has no service key.');
  const { data, error } = await getServiceClient().rpc('push_subscription_replace', { p_old_endpoint: oldEndpoint, p_new_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
  if (error) {
    if (/VALIDATION_ERROR/.test(error.message)) throw new AppError('VALIDATION_ERROR', 'The renewed subscription is not valid.');
    throw new AppError('SERVICE_UNAVAILABLE', 'The subscription could not be updated.');
  }
  return c.json(ok({ replaced: data === true }));
});

// "Forgot password?" on the client sign-in page (no login). Same answer whatever the e-mail.
app.post('/client-auth/forgot-password', async c => {
  const body = await readJson(c);
  const typed = emailKey((body as { email?: unknown } | undefined)?.email);
  await enforce([
    { key: `reset:client:ip:${clientIp(c)}`, limit: limitOf('RESET_PER_IP_15MIN'), window: 900 },
    ...(typed ? [{ key: `reset:email:${typed}`, limit: limitOf('RESET_PER_EMAIL_HOUR'), window: 3600 }] : [])
  ], 'shared');
  return c.json(ok(await clientForgotPassword(body, c.req.header('origin'))));
});

/** a***@example.com: enough to recognise a typing mistake, not enough to learn an address from the log */
function maskIdentifier(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return '';
  const at = v.indexOf('@');
  return at > 0 ? `${v[0]}***${v.slice(at)}` : `${v[0]}***`;
}

/**
 * The sign-in page reports a refused password (no login exists yet, so this is public). It is evidence about the ATTEMPT, never about an
 * account: the row has no person, the typed e-mail is kept masked and marked unverified, the address and place come from the platform
 * (not from the body), and a caller can record only a few per quarter hour. (A refusal for a known account is also written by the
 * Auth password hook as LOGIN_FAILED, which has no address.)
 */
app.post('/auth/login-failed', async c => {
  await enforce([{ key: `loginfail:${clientIp(c)}`, limit: limitOf('LOGIN_FAIL_REPORT_PER_IP_15MIN'), window: 900 }], 'shared');
  const input = parse(loginFailureReportSchema, await readJson(c));
  const ip = auditIp(c);
  const identifier = maskIdentifier(input.identifier ?? '');
  if (ip || identifier) {
    await recordSecurityEvent({
      action: 'LOGIN_ATTEMPT_FAILED',
      entityType: 'auth',
      actorId: null,
      outcome: 'FAILURE',
      requestId: c.get('requestId'),
      ip: ip ?? undefined,
      location: await locateRequest(name => c.req.header(name), ip),
      dedupeKey: `loginfail:${ip ?? clientIp(c)}:${identifier}:${Math.floor(Date.now() / 60_000)}`,
      metadata: { surface: 'staff', identifier: identifier || null, identifierVerified: false }
    });
  }
  return c.json(ok({ recorded: true }));
});

// The client dashboard: the customer's own login, their own records only.
// Candidate membership is checked by each RPC, independently of staff profiles.
for (const route of candidateRoutes) {
  app.on(route.method, route.path, async c => {
    const db=route.public ? getAnonClient() : createUserClient(extractBearerToken(c.req.header('authorization')));
    if (!route.public) {
      const me=await new CareerRepository(db).profile();
      setRateHeaders(c,await enforce(userBuckets(`candidate:${me.id}`,route.rate ?? (route.method==='GET' ? 'default' : 'sensitive')),'memory'));
      // daily / hourly ceilings per candidate (applications, uploads, profile saves), counted in the database across all servers
      const quota=candidateQuota(route.method,route.path);
      if (quota) await enforce([{ key:`cand-${quota.name}:${me.id}`, limit:quota.limit, window:quota.window }],'shared');
    } else if (route.method==='GET' && !isPortalServer(name => c.req.header(name))) {
      // the portal's own (cached) listing calls are one address for everyone: not limited per address here
      await enforce([{ key:`jobs:ip:${clientIp(c)}`, limit:limitOf('JOBS_PER_IP_MINUTE'), window:60 }],'memory');
    }
    const request: ApiRequest={ method:c.req.method as HttpMethod,path:relativePath(c),query:c.req.query(),headers:{},
      body:['GET','DELETE'].includes(c.req.method) ? undefined : await readJson(c) };
    const result=await route.handler({db,req:request,params:c.req.param() as Record<string,string>});
    return c.json(ok(result.data),(result.status??200) as 200);
  });
}

for (const route of clientRoutes) {
  app.on(route.method, `/client${route.path}`, async c => {
    const { db, me, limit } = await authenticateClient(c.req.header('authorization'));
    setRateHeaders(c, limit);
    await noteSessionStart(c, null, { customerId: me.customerId });
    const request: ApiRequest = {
      method: c.req.method as HttpMethod,
      path: relativePath(c),
      query: Object.fromEntries(Object.entries(c.req.query()).filter(([k]) => k !== '__path')),
      headers: Object.fromEntries(Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v])),
      body: c.req.method === 'GET' || c.req.method === 'DELETE' ? undefined : await readJson(c)
    };
    const result = await route.handler({ req: request, params: c.req.param() as Record<string, string>, db, me, services: clientServices(db) });
    return c.json(ok(result.data), (result.status ?? 200) as 200);
  });
}

for (const route of routes) {
  app.on(route.method, route.path, authenticated(route), adapt(route));
}

const routeMatchers = [...candidateRoutes.map(r => new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`)),...routes.map(r => new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`)), ...clientRouteMatchers];

app.notFound(c => {
  const path = relativePath(c);
  const known = path === '/health' || routeMatchers.some(rx => rx.test(path));
  return fail(c, known ? new AppError('METHOD_NOT_ALLOWED') : new AppError('NOT_FOUND', 'Unknown API route.'));
});

/** Tell the error reporter (server/monitoring.ts: Sentry on Vercel, nothing elsewhere) about a defect or outage, with the route pattern and request id only. */
function reportError(c: Context, err: unknown, status?: number) {
  const actor = (c as Context<Env>).get('actor');
  reportServerError({
    error: err,
    requestId: (c as Context<Env>).get('requestId'),
    route: relativePath(c).replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:id'),
    method: c.req.method,
    status,
    role: actor?.role
  });
}

app.onError((err, c) => {
  if (err instanceof AppError) {
    // a 5xx the code raised itself (a busy database, a missing setting): an outage to know about, unlike a 4xx
    if (err.status >= 500) reportError(c, err, err.status);
    return fail(c, err);
  }
  if (err instanceof ConfigurationError) {
    log('error', 'configuration error', c, { message: err.message });
    reportError(c, err, 503);
    return fail(c, new AppError('SERVICE_UNAVAILABLE'));
  }
  if (err instanceof HTTPException) {
    return fail(c, new AppError(err.status === 413 ? 'VALIDATION_ERROR' : 'INTERNAL', err.status === 413 ? 'Request body is too large.' : undefined));
  }
  log('error', 'unhandled error', c, { message: (err as Error)?.message, stack: (err as Error)?.stack });
  reportError(c, err);
  return fail(c, new AppError('INTERNAL'));
});

// ---------------------------------------------------------------------------
// Route middleware
// ---------------------------------------------------------------------------
/**
 * Verify the token, load the profile and consume the per-user quota (one
 * database round trip), then require ACTIVE unless the route allows otherwise.
 */
function authenticated(route: RouteDef): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { actor, db, limit } = await authenticateRequest(c.req.header('authorization'), route.options?.rate || 'default');
    setRateHeaders(c, limit);
    // set first: a refused (inactive) caller is still named in the security log
    c.set('actor', actor);
    c.set('db', db);
    if (!route.options?.allowInactive) assertActive(actor);
    await noteSessionStart(c, actor);
    await next();
  };
}

/** Bridge Hono's context to the framework-independent controllers. */
function adapt(route: RouteDef) {
  return async (c: Context<Env>) => {
    const request: ApiRequest = {
      method: c.req.method as HttpMethod,
      path: relativePath(c),
      query: Object.fromEntries(Object.entries(c.req.query()).filter(([k]) => k !== '__path')),
      headers: Object.fromEntries(Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v])),
      body: c.req.method === 'GET' ? undefined : await readJson(c)
    };
    const result = await route.handler({ req: request, params: c.req.param() as Record<string, string>, actor: c.get('actor')!, db: c.get('db')! });
    // a lead may have just got its first sales person: send its welcome WhatsApp now (the scheduled dispatch is the safety net)
    if (assignsLeads(request.method, request.path)) await afterResponse(c, leadWhatsAppQuietly());
    return c.json(ok(result.data), (result.status ?? 200) as 200);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Background work after a request: on Cloudflare Workers it runs after the response (waitUntil); elsewhere it is awaited, so it is never cut off. */
async function afterResponse(c: Context, work: Promise<unknown>): Promise<void> {
  let ctx: { waitUntil(p: Promise<unknown>): void } | null = null;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = null; // Node.js (Vercel, local, tests): no execution context
  }
  if (ctx) ctx.waitUntil(work.catch(() => undefined));
  else await work.catch(() => undefined);
}
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

function fail(c: Context, err: AppError) {
  (c as Context<Env>).set('errorCode', err.code);
  if (err.code === 'RATE_LIMITED') {
    const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (retry) c.header('Retry-After', String(retry));
  }
  return c.json({ success: false, error: err.toBody() } satisfies ApiResponse<never>, err.status as 400);
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}

function relativePath(c: Context): string {
  const p = c.req.path;
  return p.startsWith(API_PREFIX) ? p.slice(API_PREFIX.length) || '/' : p;
}

function clientIp(c: Context): string {
  return (
    // a candidate's own address, forwarded and signed by the Candidate Portal's server (security/abuse.ts)
    verifiedPortalClient(name => c.req.header(name)) ||
    c.req.header('x-real-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * The address recorded in the audit log: only what the hosting platform itself set (see security/clientNetwork.ts). clientIp() above
 * also serves rate limiting, where a forged value can only hurt the forger; an audit record must never hold one.
 */
function auditIp(c: Context): string | null {
  return verifiedPortalClient(name => c.req.header(name)) ?? trustedClientIp(name => c.req.header(name));
}

/**
 * Cloudflare Turnstile (security/abuse.ts): the token comes in the x-turnstile-token header. Refused only in TURNSTILE_MODE=enforce; every
 * failed check is recorded in the Security & Audit log (at most one per address and action a minute).
 */
async function botCheck(c: Context, action: TurnstileAction): Promise<void> {
  const ip = clientIp(c);
  const outcome = await verifyTurnstile(c.req.header('x-turnstile-token'), action, ip === 'unknown' ? null : ip);
  if (outcome.result !== 'ok' && outcome.result !== 'off') {
    const audit = auditIp(c);
    await recordSecurityEvent({
      action: 'BOT_CHECK_FAILED',
      entityType: 'auth',
      actorId: null,
      outcome: outcome.allowed ? 'FAILURE' : 'DENIED',
      requestId: c.get('requestId'),
      ip: audit ?? undefined,
      dedupeKey: `botcheck:${ip}:${action}:${Math.floor(Date.now() / 60_000)}`,
      metadata: { surface: 'candidate', check: action, result: outcome.result, refused: !outcome.allowed }
    });
  }
  if (!outcome.allowed) throw turnstileRefused();
}

/** The per-candidate ceilings (security/abuse.ts ABUSE_LIMITS): which candidate routes count, and how much. */
function candidateQuota(method: string, path: string): { name: string; limit: number; window: number } | null {
  if (method === 'POST' && path === '/candidate/applications') return { name: 'apply', limit: limitOf('CAND_APPLY_PER_DAY'), window: 86400 };
  if (method === 'POST' && (path === '/candidate/resumes' || path === '/candidate/documents/:id')) return { name: 'upload', limit: limitOf('CAND_UPLOAD_PER_DAY'), window: 86400 };
  if (method === 'PATCH' && path === '/candidate/profile') return { name: 'profile', limit: limitOf('CAND_PROFILE_SAVE_PER_HOUR'), window: 3600 };
  return null;
}

function setRateHeaders(c: Context, r: BucketResult) {
  c.header('RateLimit-Limit', String(r.max_hits));
  c.header('RateLimit-Remaining', String(Math.max(0, r.max_hits - r.hits)));
  c.header('RateLimit-Reset', String(Math.max(0, Math.ceil((new Date(r.reset_at).getTime() - Date.now()) / 1000))));
}

function allowedOrigins(): string[] {
  try {
    return getEnv().allowedOrigins;
  } catch {
    return [];
  }
}

function log(level: 'info' | 'warn' | 'error', msg: string, c: Context<Env>, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, requestId: c.get('requestId'), method: c.req.method, path: relativePath(c), userId: c.get('actor')?.id, ...extra });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

// ---------------------------------------------------------------------------
// Security log: what the database cannot record because a refused request rolls its own transaction back
// ---------------------------------------------------------------------------
const ROUTE_LABELS: { rx: RegExp; method: string; label: string }[] = [
  ...routes.map(r => ({ rx: new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`), method: r.method, label: r.path })),
  ...clientRoutes.map(r => ({ rx: new RegExp(`^/client${r.path.replace(/:[^/]+/g, '[^/]+')}$`), method: r.method, label: `/client${r.path}` }))
];
const STATIC_LABELS = new Set(['/health', '/internal/automations/dispatch', '/internal/attendance/reminders', '/attendance/push-resubscribe', '/internal/bolify/call-status', '/internal/auth/email-hook', '/integrations/biometric/punch', '/client-auth/forgot-password', '/auth/forgot-password', '/candidate-auth/register', '/auth/login-failed', '/integrations/google/callback']);

/** The route PATTERN (never the raw path: no ids, no query string), or 'unmatched'. */
function routeLabel(method: string, path: string): string {
  if (STATIC_LABELS.has(path)) return path;
  return ROUTE_LABELS.find(r => r.method === method && r.rx.test(path))?.label ?? 'unmatched';
}

function securityAudit(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    const status = c.res.status;
    const code = c.get('errorCode');
    if (!code || (status !== 401 && status !== 403 && status !== 429)) return;
    const actor = c.get('actor');
    const route = routeLabel(c.req.method, relativePath(c));
    const ip = auditIp(c);
    const rateKey = clientIp(c);
    const action = status === 401 ? 'AUTH_REJECTED' : status === 429 ? 'RATE_LIMITED' : 'ACCESS_DENIED';
    await recordSecurityEvent({
      action,
      entityType: 'request',
      actorId: actor?.id ?? null,
      outcome: 'DENIED',
      requestId: c.get('requestId'),
      ip: ip ?? undefined,
      // one row per caller, kind of refusal and route per five minutes: a retry or a flood is a single event
      dedupeKey: `${action}:${code}:${actor?.id ?? rateKey}:${c.req.method}:${route}:${Math.floor(Date.now() / 300_000)}`,
      metadata: { method: c.req.method, route, status, code, ...(actor ? { role: actor.role, accountStatus: actor.status } : {}) }
    });
  };
}

const knownSessions = new Set<string>();
/** The first request of a sign-in session is the sign-in as the API sees it (the session id comes from the verified token). */
async function noteSessionStart(c: Context<Env>, actor: Actor | null, extra: Record<string, unknown> = {}) {
  const claims = sessionClaims(c.req.header('authorization'));
  if (!claims || knownSessions.has(claims.sessionId)) return;
  if (knownSessions.size > 5000) knownSessions.clear();
  knownSessions.add(claims.sessionId);
  const ip = auditIp(c);
  // the place of a staff sign-in (customers' sign-ins keep only the address): bounded wait, never a reason for the request to fail
  const location = actor ? await locateRequest(name => c.req.header(name), ip) : null;
  await recordSecurityEvent({
    action: 'SESSION_STARTED',
    entityType: actor ? 'session' : 'client_session',
    entityId: typeof extra.customerId === 'string' ? extra.customerId : null,
    actorId: actor?.id ?? null,
    outcome: 'SUCCESS',
    requestId: c.get('requestId'),
    ip: ip ?? undefined,
    location,
    dedupeKey: `session:${claims.sessionId}`,
    metadata: { method: claims.method, device: deviceLabel(c.req.header('user-agent')), ...(actor ? { role: actor.role } : {}) }
  });
}

/** One structured log line per request (visible in Vercel → Logs). */
function accessLog(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    if (process.env.API_ACCESS_LOG === 'off') return;
    const status = c.res.status;
    log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request', c, { status, ms: Date.now() - started });
  };
}

// ---------------------------------------------------------------------------
// Node entry point (Vercel function, Vite dev middleware, tests)
// ---------------------------------------------------------------------------
/**
 * On Vercel, vercel.json rewrites /api/v1/<path> → /api/crm?__path=<path>.
 * Restore the original path so Hono routes it normally.
 */
function restoreRewrittenPath(req: Request): Request {
  const url = new URL(req.url);
  const original = url.searchParams.get('__path');
  if (original === null) return req;
  url.searchParams.delete('__path');
  // Vercel's rewrite also adds the matched route parameter (:path*) as a plain `path` query parameter. It is routing data, not
  // something the caller sent, and endpoints that accept only their own parameters (the client calendar, attendance, leave
  // months) refuse an unknown one, whatever its value is encoded as: "Unrecognized key(s) in object: 'path'".
  // (Only on a rewritten request: a direct call to /api/v1/... that sends its own `path` is still refused.)
  url.searchParams.delete('path');
  url.pathname = `${API_PREFIX}/${original.replace(/^\/+/, '')}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? req.body : undefined,
    // Required by Node's fetch implementation when streaming a request body.
    ...(hasBody ? { duplex: 'half' } : {})
  } as RequestInit);
}

export const handleApiRequest = getRequestListener(req => app.fetch(restoreRewrittenPath(req)));
