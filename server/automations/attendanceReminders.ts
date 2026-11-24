import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { fromDatabaseError } from '../http/errors.js';
import { sendWebPush, vapidConfig, type PushMessage, type PushOutcome, type PushTarget } from './webPush.js';
import { NO_TOTALS, processDeliveries, type DeliveryTotals } from './notificationDelivery.js';

/**
 * Attendance reminders (migrations 20270109000200, 20270126000200). Every 5 minutes the Worker's scheduled run calls this:
 * 1. the database decides what is due and, in one transaction, records each reminder once, puts it in the CRM bell and queues one delivery
 *    per active device (attendance_reminders_generate);
 * 2. the outbox is sent (notificationDelivery.ts): this run's new rows and earlier ones waiting for a retry;
 * 3. the run itself is recorded (notification_scheduler_run_record), so Notification Health shows when the scheduler last worked.
 * Before the migration is run, the older path is used (attendance_reminders_due + an immediate push without retries).
 * Without VAPID keys the reminders still reach the bell ("push: off") and nothing is queued for later.
 */
interface DueReminder extends PushMessage { profileId: string; kind: string; step: number; targets: PushTarget[] }
export interface PushTotals { pushed: number; gone: number; failed: number }
export interface ReminderRun extends PushTotals {
  due: number;
  push: 'on' | 'off';
  mode: 'outbox' | 'legacy';
  bellWritten: number;
  jobsCreated: number;
  noDevice: number;
  deliveries: DeliveryTotals;
}

/** A database function that does not exist yet (the migration has not been run): PostgREST PGRST202, PostgreSQL 42883. */
export function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message ?? ''));
}

/**
 * Send each message to each device, a few at a time, then tell the database which devices answered, failed or are gone for good.
 * Used by the chat push (chatPush.ts) and by the reminders before migration 20270126000200.
 */
export async function sendPushJobs(jobs: { target: PushTarget; message: PushMessage }[], limit = 6): Promise<PushTotals> {
  const vapid = vapidConfig();
  const by: Record<PushOutcome, string[]> = { ok: [], gone: [], failed: [] };
  if (!vapid || !jobs.length) return { pushed: 0, gone: 0, failed: 0 };
  for (let i = 0; i < jobs.length; i += limit) {
    const batch = jobs.slice(i, i + limit);
    const outcomes = await Promise.all(batch.map(j => sendWebPush(j.target, j.message, vapid)));
    outcomes.forEach((o, k) => by[o].push(batch[k].target.id));
  }
  const { error } = await getServiceClient().rpc('push_subscriptions_report', { p_ok: by.ok, p_gone: by.gone, p_failed: by.failed });
  if (error) console.error('[reminders] could not record the push results:', error.message);
  return { pushed: by.ok.length, gone: by.gone.length, failed: by.failed.length };
}

async function recordRun(run: Record<string, unknown>): Promise<void> {
  const { error } = await getServiceClient().rpc('notification_scheduler_run_record', { p: run });
  if (error && !isMissingFunction(error)) console.error('[reminders] could not record the scheduler run:', error.message);
}

async function runLegacy(now: Date | undefined, push: 'on' | 'off'): Promise<ReminderRun> {
  const { data, error } = await getServiceClient().rpc('attendance_reminders_due', now ? { p_now: now.toISOString() } : {});
  if (error) throw new Error(`Attendance reminders could not be prepared: ${error.message}`);
  const due = (data ?? []) as DueReminder[];
  const jobs = due.flatMap(r => r.targets.map(target => ({ target, message: { title: r.title, body: r.body, tag: r.tag, url: r.url } })));
  const totals = await sendPushJobs(jobs);
  return { due: due.length, push, mode: 'legacy', bellWritten: due.length, jobsCreated: jobs.length, noDevice: due.filter(r => !r.targets.length).length,
           deliveries: { ...NO_TOTALS, attempted: jobs.length, accepted: totals.pushed, failed: totals.failed, gone: totals.gone }, ...totals };
}

/**
 * Scheduled notifications that ride on the reminders' 5-minute run (each one checked and recorded once by the database):
 *  - sa_attendance_alert_generate (20270131000100): "Look at today's attendance." to the Super Admin, once a working day from 11:00 India time;
 *  - notice_release_due (20270131000200): company notices whose publish time has come reach their audience;
 *  - mtg_oversight_run (20270208000200): the Managing Director's meeting reminders (15 minutes before and at the start by default). It
 *    needs this 5-minute run: the meetings dispatch runs only twice a day. Meeting notices queued by a booking, move or cancellation
 *    (a database trigger) also go out with this run's outbox.
 * A function that does not exist yet (its migration not run) is skipped; a failure of one never stops the reminders.
 */
export async function runScheduledNotifications(now: Date | undefined, push: boolean): Promise<{ generated: number; jobsCreated: number; noDevice: number }> {
  const totals = { generated: 0, jobsCreated: 0, noDevice: 0 };
  for (const fn of ['sa_attendance_alert_generate', 'notice_release_due']) {
    const { data, error } = await getServiceClient().rpc(fn, { ...(now ? { p_now: now.toISOString() } : {}), p_push: push });
    if (error) {
      if (!isMissingFunction(error)) console.error(`[reminders] ${fn} failed:`, error.message);
      continue;
    }
    const r = (data ?? {}) as { generated?: number; jobsCreated?: number; noDevice?: number };
    totals.generated += r.generated ?? 0;
    totals.jobsCreated += r.jobsCreated ?? 0;
    totals.noDevice += r.noDevice ?? 0;
  }
  const mtg = await getServiceClient().rpc('mtg_oversight_run', now ? { p_now: now.toISOString() } : {});
  if (mtg.error) {
    if (!isMissingFunction(mtg.error)) console.error('[reminders] mtg_oversight_run failed:', mtg.error.message);
  } else {
    totals.generated += Number((mtg.data as { reminders?: number } | null)?.reminders) || 0;
  }
  return totals;
}

export async function runAttendanceReminders(now?: Date, opts: { budgetMs?: number } = {}): Promise<ReminderRun> {
  const vapid = vapidConfig();
  const push = vapid ? 'on' : 'off';
  const empty: ReminderRun = { due: 0, push, mode: 'outbox', bellWritten: 0, jobsCreated: 0, noDevice: 0, deliveries: { ...NO_TOTALS }, pushed: 0, gone: 0, failed: 0 };
  if (!hasServiceClient()) return empty;
  const startedAt = new Date().toISOString();
  const { data, error } = await getServiceClient().rpc('attendance_reminders_generate', { ...(now ? { p_now: now.toISOString() } : {}), p_push: !!vapid });
  if (isMissingFunction(error)) return runLegacy(now, push);
  if (error) {
    await recordRun({ startedAt, ok: false, pushConfigured: !!vapid, error: 'GENERATION_FAILED' });
    throw new Error(`Attendance reminders could not be prepared: ${error.message}`);
  }
  const g = (data ?? {}) as { generated?: number; bellWritten?: number; jobsCreated?: number; noDevice?: number };
  // the same run queues the Super Admin's 11:00 attendance alert and the notices whose publish time has come; they go out with the outbox below
  const extra = await runScheduledNotifications(now, !!vapid);
  g.generated = (g.generated ?? 0) + extra.generated;
  g.bellWritten = (g.bellWritten ?? 0) + extra.generated;
  g.jobsCreated = (g.jobsCreated ?? 0) + extra.jobsCreated;
  g.noDevice = (g.noDevice ?? 0) + extra.noDevice;
  let deliveries: DeliveryTotals = { ...NO_TOTALS };
  let sendError: string | null = null;
  try {
    deliveries = await processDeliveries({ vapid, budgetMs: opts.budgetMs ?? 20_000 });
  } catch (e) {
    // the reminders are in the bell and the deliveries wait in the outbox: the next run sends them
    sendError = 'DELIVERY_FAILED';
    console.error('[reminders] sending failed:', e instanceof Error ? e.message : 'error');
  }
  const run: ReminderRun = {
    due: g.generated ?? 0, push, mode: 'outbox', bellWritten: g.bellWritten ?? 0, jobsCreated: g.jobsCreated ?? 0, noDevice: g.noDevice ?? 0,
    deliveries, pushed: deliveries.accepted, gone: deliveries.gone, failed: deliveries.failed + deliveries.retry
  };
  await recordRun({ startedAt, ok: !sendError, pushConfigured: !!vapid, generated: run.due, bellWritten: run.bellWritten, jobsCreated: run.jobsCreated,
                    noDevice: run.noDevice, ...deliveries, error: sendError });
  return run;
}

export interface TestPushResult { sent: number; gone: number; failed: number; devices: number; retry: number; pushConfigured: boolean }

/**
 * "Send test notification" to the caller's own active devices: queued as the caller (the database checks the account and the rate limit),
 * then sent at once. `sent` counts the devices whose push service ACCEPTED the message; whether it appeared is for the person to confirm.
 */
export async function sendTestPush(profileId: string, db?: SupabaseClient): Promise<TestPushResult> {
  const pushConfigured = !!vapidConfig();
  if (!hasServiceClient()) return { sent: 0, gone: 0, failed: 0, devices: 0, retry: 0, pushConfigured };
  if (db) {
    const { data, error } = await db.rpc('push_test_enqueue');
    if (!error) return sendQueuedTest(data as { ids?: number[]; devices?: number }, pushConfigured);
    if (!isMissingFunction(error)) throw fromDatabaseError(error);
  }
  // before migration 20270126000200
  const { data, error } = await getServiceClient().rpc('push_targets_for', { p_profile: profileId });
  if (error) throw new Error(`Your devices could not be read: ${error.message}`);
  const targets = (data ?? []) as PushTarget[];
  const message: PushMessage = { title: 'Test reminder', body: 'Reminders work on this device.', tag: 'att-test', url: '/?open=attendance' };
  const totals = await sendPushJobs(targets.map(target => ({ target, message })));
  return { sent: totals.pushed, gone: totals.gone, failed: totals.failed, devices: targets.length, retry: 0, pushConfigured };
}

/** Send test deliveries that were just queued (by the person, or by HR / the Super Admin for an employee). */
export async function sendQueuedTest(queued: { ids?: number[]; devices?: number } | null, pushConfigured = !!vapidConfig()): Promise<TestPushResult> {
  const ids = (queued?.ids ?? []).map(Number).filter(Number.isFinite);
  const t = ids.length ? await processDeliveries({ ids, budgetMs: 12_000 }) : { ...NO_TOTALS };
  return { sent: t.accepted, gone: t.gone, failed: t.failed, retry: t.retry, devices: queued?.devices ?? ids.length, pushConfigured };
}
