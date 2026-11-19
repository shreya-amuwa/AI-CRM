# Meetings: Google Calendar, booking links and CEO approval

> **The CEO's time is decided by the Super Admin only.** See [CEO_MEETING_APPROVAL.md](CEO_MEETING_APPROVAL.md) (migration `20270114000100`): delegates, Admin, HR and every other role can ask, never approve, reject or reschedule. Where this guide still says "delegate", read that guide.

One booking system for appointments, demos, interviews, meetings and meetings with the CEO (the Super Admin).
Migration `20270101000500_meetings_google_calendar.sql`.

## What people see

**Meetings** is in every dashboard's menu, right under Attendance. It has three tabs.

| Tab | What it does |
| --- | --- |
| Calendar | The week, day by day: your meetings, the ones you are invited to, (the CEO's meetings are the Super Admin's own). Open one to join the Google Meet, reschedule, cancel, mark it done, or answer an invitation. |
| Requests | The Super Admin (CEO): every employee's request in Pending / Approved / Rejected / Rescheduled / History sections, with Approve, Reject and Reschedule. Everybody else: *My CEO requests*, their own requests with the status, the confirmed time and the reasons. A new request appears here as soon as its notification arrives, without a refresh. |
| Google, hours & booking links | Connect your Google Calendar, set your working hours, create booking links, and (CEO) a note that decisions are not delegated. |

The page also has two buttons:

- **New meeting** books a meeting you host. You invite colleagues (their busy times for that day are shown, from the CRM and their Google Calendar) and guests outside the company by e-mail.
- **Ask the CEO for time** sends a request. It holds the time until the Super Admin (the CEO) does one of three things (nobody else can):
  - **Approve:** it is booked.
  - **Propose another time:** the person asking accepts or declines it.
  - **Decline:** with a reason.

  Nobody books the CEO's time directly: everybody else sends a request. When the person asking asks for another time for an approved meeting, it goes back to "requested" and needs approval again.

Clicking a meeting notification (the bell or the Notification Center) opens Meetings on that meeting.

### Booking links

A booking link looks like `https://crm.amuwacorporation.com/book/<name>`. Customers, leads and candidates open it **without logging in** and pick one of the host's free slots.

- **Free slots:** inside the host's working hours (default Monday–Saturday 10:00–18:00, host's time zone), not taken in the CRM, and not busy in the host's Google Calendar.
- **Your settings per link:**
  - length
  - gap between meetings
  - earliest booking (notice)
  - how many days ahead
  - Google Meet, in person or phone
  - whether each booking needs your approval first
- **The CEO's links** always need approval.
- **The guest** gets a confirmation (or "request received") e-mail with a calendar file, reminders, and a **private link** to cancel or to answer a proposed time.

### Existing screens feed the same calendar

These keep working where they are. Their meetings also appear in Meetings and in the host's Google Calendar, with the guest invited by e-mail:

| Source | Host | Guest invited |
| --- | --- | --- |
| Business Associate demos | Assigned owner | The demo contact |
| Recruitment interviews | Interviewer | The candidate |
| Employee → HR meeting requests, once HR confirms a time | Assigned HR person | The employee |

Change or cancel them in their own page; Meetings follows. The Team Member's private "Calendar" notes are not mirrored. They have no exact time, and they stay as they are.

## Notifications

| Who | How |
| --- | --- |
| Colleagues | By e-mail (`20270113000100`): when a meeting they take part in is scheduled or approved, moved or cancelled, and the one who asked when a request is declined. The e-mail comes from the CRM's mailbox **in the organiser's name** ("Priya Shah via Amuwa CRM", replies go to Priya) with a `.ics` file, and is skipped when Google already sent the invitation from the organiser's calendar. The organiser always gets it, because Google does not e-mail the organiser. |
| Colleagues | In the Notification Center (only for meetings they take part in): invited, request waiting (urgent), approved / declined / another time proposed, moved, cancelled, a guest booked or cancelled, someone cannot attend, reminders 24 hours and 1 hour before, Google sync failing, Google disconnected. |
| Guests outside the company | By e-mail, from the client sender address: confirmation (with a `.ics` calendar file), request received, another time proposed, declined, moved, cancelled, reminders 24 hours and 1 hour before. |
| Everyone invited, when the organiser connected Google | Google also sends its own calendar invitation, update and cancellation. For meetings booked by staff, the CRM then skips its own confirmation / change / cancellation e-mail so guests do not get two. Booking-link guests always get the CRM's, because it carries their private link. |

E-mails follow the same switches as every other client e-mail (`AUTOMATION_MODE`, `EMAIL_PROVIDER`, test recipients). Nothing is sent in a dry run.

## Google Calendar: how it works

- **Each employee connects their own Google account** (work or personal) under *Google, hours & booking links*. There is no company-wide Google admin set-up.
- **Permissions requested:**
  - `calendar.events`: create, change and remove the events the CRM books.
  - `calendar.freebusy`: when the person is busy, never what their other events are.
  - the account's e-mail address.
- **Token storage:** the refresh token is encrypted (AES-256-GCM, `GOOGLE_TOKEN_KEY`) in `google_calendar_connections`. Only the server (service role) can read that table.
- **Where events go:** the **organiser's** Google Calendar (`20270113000100`): the person who created the meeting, so Google e-mails the invitation, every change and the cancellation from their Gmail to everyone else, the host included. Meetings nobody created (BA demos, interviews, HR meetings, booking-link bookings) use the host's calendar. Every other participant is a guest, and a Google Meet link is added for "Google Meet" meetings.
  - A request for the CEO's time gets no event until it is approved. Then the event is created on the calendar of the one who asked, with the CEO as a guest. When the CEO moves or cancels it, that same event is updated or removed, and Google e-mails everyone again.
  - Events created before `20270113000100` stay on the host's calendar and keep being updated there.
  - Cancelled or declined meetings are removed, and Google tells the guests.
- **Sync timing:** right after every change, and again on every automation dispatch, which retries with back-off. Failures show on the meeting. After 5 failed tries the organiser is notified.
- **Revoked access:** if Google stops accepting the access, the connection is marked *needs reconnect* and the person is asked to connect again.
- **Disconnecting:** revokes the access at Google and deletes the stored token. Events already created stay in the calendar.

## Set-up (once, by the administrator)

### 1. Google Cloud

1. Create a project in [Google Cloud](https://console.cloud.google.com/), or use the company's.
2. Enable the Google Calendar API under **APIs & Services → Library**.
3. Set up the **OAuth consent screen**:
   - User type **External**, so employees with personal Gmail can connect too. Use **Internal** only if everyone uses the company's Google Workspace.
   - App name, support e-mail, and the CRM domain as an authorised domain.
   - Scopes: `openid`, `email`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.freebusy`.
   - An External app in *Testing* mode only works for the test users listed on the consent screen. **Publish** it for everyone. The calendar scopes are "sensitive", so Google asks for verification. Until that is done, users see an "unverified app" warning they can click through.
4. Create credentials under **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type **Web application**.
   - Authorised redirect URI, exactly: `https://crm.amuwacorporation.com/api/v1/integrations/google/callback` (or `<APP_URL>/api/v1/integrations/google/callback`).

### 2. Server environment (Vercel → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | from step 4 |
| `GOOGLE_CLIENT_SECRET` | from step 4 |
| `GOOGLE_TOKEN_KEY` | 32+ random characters (e.g. `openssl rand -base64 48`). Changing it later disconnects everyone. |
| `GOOGLE_REDIRECT_URI` | optional: only if the callback address differs from `<APP_URL>/api/v1/integrations/google/callback` |
| `MEETING_LINK_SECRET` | optional, 32+ characters: signs the guests' private links (defaults to `GOOGLE_TOKEN_KEY`). Without either, booking still works but guests get no private link. |

Without the Google variables everything else still works: the calendar, booking links, CEO requests and e-mails. Nothing reaches Google, and the page says so.

### 3. Database

Run `supabase/migrations/20270101000500_meetings_google_calendar.sql` in the Supabase SQL editor. It is additive, safe to run twice, and uses no temp tables. It also brings already-planned future demos, interviews and confirmed HR meetings into the calendar once.

Then run `supabase/migrations/20270113000100_meetings_creator_organiser.sql` (after every earlier migration). It adds who holds each Google event, the colleague e-mails and participant-only access. It is additive and safe to run twice.

### 4. Reminders

Reminders and retries run with `/api/v1/internal/automations/dispatch`. With only the two daily Vercel crons, the "1 hour before" reminder can come late. Call the dispatch every 5 minutes from Supabase `pg_cron` + `pg_net` (the same `net.http_post` call as in `docs/HR_EMAIL_AUTOMATION.md`, with `*/5 * * * *`), so reminders are on time.

## Rules the database enforces

- **Seeing a meeting:** only its host, the person who booked it, invited colleagues and (for other hosts) the host's delegates can see it; a Super Admin also sees every request for the CEO's time. The Super Admin sees a meeting only when taking part (a meeting between employees stays with those employees). Anyone else gets "not found".
- **Changing a meeting:** only the host, the person who booked it and the host's delegates can move, cancel or complete it. Invited colleagues only answer. **The CEO's meetings: only a Super Admin** (the one who asked can withdraw a pending request or ask for another time).
- **Deciding a request:** a request for a colleague's booking link: the host and their delegates. **A request for the CEO's time: a Super Admin only.**
- **No double booking.** A host cannot have two requested or scheduled meetings at the same time. Checks run under a lock, so two guests can never take the same slot. A host may book an overlap in their own calendar on purpose.
- **Booking-link slots are re-checked when booked:**
  - inside working hours
  - the link's notice and days-ahead limits
  - the gap between meetings
  - at most 3 open bookings per guest e-mail per link
- **Only Super Admins can be asked** for their time. Other colleagues are invited, not booked.
- **The public booking functions are not open to the public.** Only the server calls them, after its rate limits and a honeypot field. Bookings are limited per visitor, per guest e-mail and for the whole site, and a guest's cancel or answer per visitor, all counted in the database so every server instance shares one count. The `BOOKING_*` settings in `docs/ABUSE_PROTECTION.md` change them. A guest's private link is signed (HMAC) and cannot be guessed from the meeting id.
- **Audit and history:** every change is in the meeting's history (append-only) and the audit log, including Google connect and disconnect.

## Rollback

- **App:** redeploy the previous build.
- **Database:** the migration only adds tables, functions and three `AFTER` triggers.
  - To stop mirroring: `drop trigger ba_demos_meeting_mirror on public.ba_demos; drop trigger career_interviews_meeting_mirror on public.career_interviews; drop trigger employee_meetings_meeting_mirror on public.employee_meeting_requests;`
  - The demos, interviews and HR meetings themselves are never changed by it. A mirror that fails is skipped with a warning; it never blocks the original record.
- **Google:** remove the `GOOGLE_*` variables. Nothing more is sent to Google, and stored tokens become unusable once `GOOGLE_TOKEN_KEY` is gone.

## Files

- **Database:** `supabase/migrations/20270101000500_meetings_google_calendar.sql`
- **Server:** `server/meetings/`:
  - `google.ts`: OAuth and Calendar API
  - `slots.ts`: free slots and time zones
  - `mail.ts`: guest e-mails, the calendar file and private links
  - `worker.ts`: sync, e-mails and reminders
  - `connect.ts`: Google sign-in callback
  - `publicBooking.ts`: booking pages
- **Server API:** `server/services/MeetingService.ts`, `server/repositories/MeetingRepository.ts`
- **UI:** `src/components/meetings/MeetingsPage.tsx`, `src/components/meetings/PublicBooking.tsx`, `src/lib/api/meetings.ts`
- **Tests:**
  - `supabase/tests/meetings_test.sql` (database, 90 checks)
  - `supabase/tests/meetings.test.ts` (unit, 73)
  - `supabase/tests/ui_meetings.test.mjs` (browser, 26)
  - the meetings block of `supabase/tests/api_integration.test.ts`
