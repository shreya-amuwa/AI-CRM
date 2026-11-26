import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { isMissingFunction } from './attendanceReminders.js';

/**
 * Client messages nobody has answered (migration 20270202000200). On the same 5-minute scheduled run as the attendance reminders, the database finds the client
 * chats whose last message is the client's and is older than 30 minutes (2 hours for the Team Lead), and writes ONE bell notification per person per unanswered
 * message and level (public.chat_unanswered_remind: office hours only, nothing for a message older than 3 days). Before the migration is run this does nothing.
 */
export interface ChatWaitingRun { reminded: number; skipped?: string }

export async function runChatUnansweredReminders(now?: Date): Promise<ChatWaitingRun> {
  if (!hasServiceClient()) return { reminded: 0, skipped: 'NO_DATABASE' };
  const { data, error } = await getServiceClient().rpc('chat_unanswered_remind', now ? { p_now: now.toISOString() } : {});
  if (isMissingFunction(error)) return { reminded: 0, skipped: 'MIGRATION_NOT_RUN' };
  if (error) throw new Error(`Unanswered chat reminders could not be prepared: ${error.message}`);
  const r = (data ?? {}) as { reminded?: number; skipped?: string };
  return { reminded: Number(r.reminded) || 0, ...(r.skipped ? { skipped: r.skipped } : {}) };
}
