import type { Handler } from '../http/types.js';
import { resolveAttendancePlaces } from '../automations/attendancePlaces.js';
import { sendTestPush } from '../automations/attendanceReminders.js';
import { vapidConfig } from '../automations/webPush.js';

const ok = <T>(data: T, status = 200) => ({ status, data });

/**
 * Attendance place names (20261230000600). Any signed-in user may ask the server to name the punches still waiting (a few at a time; the
 * lookup is idempotent and reads/writes nothing but the place names, with the service role). The screens call it right after a punch and when
 * HR opens the punch list; the scheduled dispatch does the rest.
 */
export const attendanceController = {
  resolvePlaces: (async () => ok(await resolveAttendancePlaces({ limit: 3, budgetMs: 5_000 }))) as Handler,
  /** Reminders (20270109000200): the public VAPID key a browser needs to subscribe; null while push is not set up. */
  pushKey: (async () => ok({ publicKey: vapidConfig()?.publicKey ?? null })) as Handler,
  /** "Send test notification" to the caller's own devices. */
  pushTest: (async ({ actor }) => ok(await sendTestPush(actor.id))) as Handler
};
