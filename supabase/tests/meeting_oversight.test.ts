// Meeting notices for the Managing Director (20270206000100), outside the database: the service worker opens the meeting when its push is
// tapped, and the 5-minute reminders run checks the meeting reminders.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let passed = 0;
const check = (ok: unknown, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++; console.log('ok -', name);
};

// ---- public/sw.js in a sandbox
type Handler = (e: any) => void;
const handlers: Record<string, Handler> = {};
const posted: any[] = [];
const opened: string[] = [];
let windows: any[] = [];
const self: any = {
  location: { origin: 'https://crm.example.com' },
  addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
  skipWaiting: () => undefined,
  registration: { showNotification: async (title: string, opts: any) => { shown.push({ title, ...opts }); } },
  clients: { claim: async () => undefined, matchAll: async () => windows, openWindow: async (url: string) => { opened.push(url); } }
};
const shown: any[] = [];
vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL, fetch: async () => undefined, console });
const tap = async (url: string) => {
  let wait: Promise<unknown> = Promise.resolve();
  handlers.notificationclick({ notification: { close: () => undefined, data: { url } }, waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
};
const id = '6f1c2b2a-1111-4222-8333-444455556666';
windows = [{ url: 'https://crm.example.com/', focus: async () => undefined, postMessage: (m: unknown) => posted.push(m) }];
await tap(`/?open=meeting&id=${id}`);
check(posted.length === 1 && posted[0].type === 'open-meeting' && posted[0].id === id, 'a tapped meeting notice tells the open CRM window to open that meeting', posted);
windows = [];
await tap(`/?open=meeting&id=${id}`);
check(opened[0] === `https://crm.example.com/?open=meeting&id=${id}`, 'with the CRM closed, it opens the CRM on that meeting');
let pushWait: Promise<unknown> = Promise.resolve();
handlers.push({ data: { json: () => ({ title: 'Team meeting in 15 minutes', body: 'Tue 25 Nov, 3:00 PM. Open the CRM for details.', tag: 'mtg-x-reminder', url: `/?open=meeting&id=${id}` }) },
  waitUntil: (p: Promise<unknown>) => { pushWait = p; } });
await pushWait;
check(shown[0]?.title === 'Team meeting in 15 minutes' && shown[0]?.data?.url === `/?open=meeting&id=${id}` && shown[0]?.tag === 'mtg-x-reminder',
  'a meeting push is shown with its own tag (a later one replaces it) and its link');
windows = [{ url: 'https://crm.example.com/', focus: async () => undefined, postMessage: (m: unknown) => posted.push(m) }];
await tap('/?open=attendance&view=today');
check(posted.at(-1)?.type === 'open-attendance' && posted.at(-1)?.view === 'today', 'other notices open as before (attendance)');

// ---- the 5-minute reminders run queues the Managing Director's meeting reminders (the meetings dispatch runs only twice a day)
process.env.SUPABASE_URL = 'http://db.test';
process.env.VITE_SUPABASE_URL = 'http://db.test';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.VITE_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
const called: { fn: string; body: any }[] = [];
let missing = false;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  const fn = url.split('/rpc/')[1]?.split('?')[0] ?? '';
  called.push({ fn, body: init?.body ? JSON.parse(String(init.body)) : {} });
  if (fn === 'mtg_oversight_run' && missing) {
    return new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.mtg_oversight_run' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const data = fn === 'mtg_oversight_run' ? { reminders: 2 } : { generated: 1, jobsCreated: 1, noDevice: 0 };
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const { runScheduledNotifications } = await import('../../server/automations/attendanceReminders');
const at = new Date('2026-11-25T09:15:00Z');
const totals = await runScheduledNotifications(at, true);
const mtgCall = called.find(c => c.fn === 'mtg_oversight_run');
check(mtgCall && mtgCall.body.p_now === at.toISOString() && totals.generated === 4,
  "every 5-minute reminders run checks the Managing Director's meeting reminders (and counts them)", { called, totals });
missing = true;
const before = await runScheduledNotifications(at, true);
check(before.generated === 2, 'before the migration is run, the other scheduled notices carry on without it', before);
console.log(`=== MEETING OVERSIGHT CHECKS PASSED (${passed}) ===`);
