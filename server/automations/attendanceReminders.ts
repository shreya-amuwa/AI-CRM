import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { sendWebPush, vapidConfig, type PushMessage, type PushOutcome, type PushTarget } from './webPush.js';

/**
 * Attendance reminders (migration 20270109000200). Every 5 minutes the Worker's scheduled run calls this: the database decides what is due,
 * records each reminder once and puts it in the CRM bell; this pushes it to the person's phones and laptops. Without VAPID keys the
 * reminders still reach the bell ("push: off").
 */
interface DueReminder extends PushMessage { profileId: string; kind: string; step: number; targets: PushTarget[] }
export interface PushTotals { pushed: number; gone: number; failed: number }

/**
 * Send each message to each device, a few at a time, then tell the database which devices answered, failed or are gone for good.
 * Also used by the chat push (chatPush.ts).
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

export async function runAttendanceReminders(now?: Date): Promise<{ due: number; push: 'on' | 'off' } & PushTotals> {
  const push = vapidConfig() ? 'on' : 'off';
  if (!hasServiceClient()) return { due: 0, push, pushed: 0, gone: 0, failed: 0 };
  const { data, error } = await getServiceClient().rpc('attendance_reminders_due', now ? { p_now: now.toISOString() } : {});
  if (error) throw new Error(`Attendance reminders could not be prepared: ${error.message}`);
  const due = (data ?? []) as DueReminder[];
  const jobs = due.flatMap(r => r.targets.map(target => ({ target, message: { title: r.title, body: r.body, tag: r.tag, url: r.url } })));
  return { due: due.length, push, ...(await sendPushJobs(jobs)) };
}

/** "Send test notification": to every active device of one person. */
export async function sendTestPush(profileId: string): Promise<{ sent: number; gone: number; failed: number }> {
  if (!hasServiceClient()) return { sent: 0, gone: 0, failed: 0 };
  const { data, error } = await getServiceClient().rpc('push_targets_for', { p_profile: profileId });
  if (error) throw new Error(`Your devices could not be read: ${error.message}`);
  const message: PushMessage = { title: 'Test reminder', body: 'Reminders work on this device.', tag: 'att-test', url: '/?open=attendance' };
  const totals = await sendPushJobs(((data ?? []) as PushTarget[]).map(target => ({ target, message })));
  return { sent: totals.pushed, gone: totals.gone, failed: totals.failed };
}
