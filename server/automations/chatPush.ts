import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { sendPushJobs, type PushTotals } from './attendanceReminders.js';
import { vapidConfig, type PushMessage, type PushTarget } from './webPush.js';

/**
 * Chat push notifications (migration 20270111000100): right after a chat message is sent, the database decides who is notified and what
 * the notification says (colleague chats: name and text; client chats: name only), and this pushes it to their devices. It runs after the
 * sender has their answer (server/app.ts, afterResponse) and never throws: push trouble never slows or breaks sending a message.
 */
interface ChatPushRecipient extends PushMessage { profileId: string; targets: PushTarget[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The new message's id from the API's answer ({ success, data: { id } }); null for anything else. */
export function messageIdFrom(json: unknown): string | null {
  const id = (json as { success?: unknown; data?: { id?: unknown } } | null)?.data?.id;
  return (json as { success?: unknown } | null)?.success === true && typeof id === 'string' && UUID.test(id) ? id : null;
}

export async function pushChatMessage(messageId: string): Promise<{ recipients: number } & PushTotals> {
  const none = { recipients: 0, pushed: 0, gone: 0, failed: 0 };
  try {
    if (!hasServiceClient()) return none;
    // Asked even when push is off: the message is then recorded once, so nothing old is pushed later.
    const { data, error } = await getServiceClient().rpc('chat_push_for_message', { p_message: messageId });
    if (error) {
      console.error('[chat push] could not prepare:', error.message);
      return none;
    }
    const recipients = (data ?? []) as ChatPushRecipient[];
    if (!vapidConfig() || !recipients.length) return { ...none, recipients: recipients.length };
    const jobs = recipients.flatMap(r => r.targets.map(target => ({ target, message: { title: r.title, body: r.body, tag: r.tag, url: r.url } })));
    return { recipients: recipients.length, ...(await sendPushJobs(jobs)) };
  } catch (e) {
    console.error('[chat push] failed:', e instanceof Error ? e.message : 'unknown error');
    return none;
  }
}
