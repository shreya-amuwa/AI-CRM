# Meetings: invitations from the creator, live requests, private to participants

Status: draft for approval (2026-11-19). Scope: the **Meetings** page (sidebar). Not the HR "Meeting Requests" / Raise an Issue flow.

## Why

- **Late requests.** A request for the Super Admin's time does not appear on the Super Admin's Meetings → Requests tab until the page is reopened.
- **Wrong sender.** The company has no work e-mail addresses. Everyone has connected their own Google Calendar instead. Today Google sends the invitation from the **host's** calendar. For a request to the Super Admin, that is the Super Admin, not the person who asked.
- **What the owner wants:**
  - the person who created the meeting sends the invitation to everyone in it;
  - everyone gets it again whenever the Super Admin approves or moves the meeting;
  - the meeting is in everyone's Google Calendar;
  - this also applies to meetings between employees.
- **Privacy.** The Super Admin should only see and hear about meetings they are part of. Today they can open and change every meeting in the CRM.

## Goals

1. **The creator organises the Google event.** The event is created on the creator's Google Calendar, with every other participant (host included) as a guest. Google then e-mails the invitation, the update and the cancellation from the creator's Gmail, and the meeting shows in each guest's Google Calendar. This applies to:
   - meetings an employee creates with colleagues;
   - requests to the Super Admin, once approved;
   - meetings the Super Admin creates.
2. **Approval and changes send updates.**
   - When the Super Admin (or their delegate) approves a request, the event is created.
   - When anyone moves or cancels the meeting, the creator's event is updated or removed, and Google e-mails everyone again from the creator's Gmail.
3. **Fallback e-mail.** When the event cannot be placed on the creator's calendar, the CRM e-mails every participant itself, through the existing company mail settings and with a calendar file attached. This covers a disconnected creator, a Google error after retries, or a creator who is not set. Each such e-mail:
   - is sent "From: <Creator name> via Amuwa CRM";
   - has Reply-To set to the creator's e-mail address.
4. **Live Requests tab.** A new request, approval, proposal, move or cancellation appears on the open Meetings page within a couple of seconds, without a refresh. The page also refreshes when the browser tab regains focus.
5. **Notifications open the meeting.** Clicking a meeting notification (bell or notification centre) opens the Meetings page with that meeting's details.
6. **Participants only.** Each person sees and is notified about a meeting only when they are one of:
   - its host;
   - its creator;
   - an invited colleague;
   - the host's delegate.

   The Super Admin is no longer a special case: they see employee-to-employee meetings only when invited.

## Non-goals

- The HR "Meeting Requests" (Raise an Issue) flow. It is unchanged.
- Changing who is asked for approval. Only requests for the Super Admin's time need approval, as today.
- Moving meetings already synced to the Super Admin's calendar. Existing events stay where they are. The new rule applies to meetings synced from now on.
- Two-way sync from Google back into the CRM.

## Anti-goals (would make this a failure even if it "works")

- A participant receives no e-mail at all for a scheduled, moved or cancelled meeting.
- The Super Admin sees or is notified about an employee meeting they were not invited to.
- People get two copies of every invitation, one from Google and one from the CRM. Exactly one source sends each change.

## Constraints

- **Migrations:**
  - additive, idempotent and pasteable into the SQL editor;
  - a new file that sorts after `20270110000200`;
  - never edits the migrations already on `main`;
  - SECURITY DEFINER functions with `search_path=''`, as in the existing meetings migration.
- **Google:** uses the existing per-person connection (`google_calendar_connections`), token cache and `insertEvent` / `patchEvent` / `deleteEvent`, which already pass `sendUpdates=all`.
- **E-mail:** uses the existing mail outbox, worker and templates (`meeting_mail_outbox`, `server/meetings/mail.ts`) and the existing send blocker / test-recipient rules.
- **Tests:** existing tests are not weakened. Meeting DB tests and unit tests are extended.

## Approaches considered

- **A. The event lives on the creator's calendar, with a CRM e-mail fallback.** Chosen. The invitation really comes from the creator's Gmail, as the owner asked. Only one source sends each change, so nobody gets a duplicate.
- **B. Keep the event on the host's calendar and add CRM e-mails to everyone.** Rejected:
  - the invitation still comes from the Super Admin for requests;
  - people get two e-mails per change.

## Design (the parts decided)

### Who organises the event

- **The organiser** is the person whose calendar holds the event: the creator (`meetings.created_by`). It falls back to the host when there is no creator, as for mirrored BA demos, interviews and HR meetings, or for public booking-link bookings.
- **Remembering the organiser.** A new column `meetings.google_owner_id` records the organiser at the first successful sync. Later updates and deletes always go to that same calendar.
- **Meetings synced before this change.** Their `google_owner_id` is backfilled to the host, so their events keep being updated where they are.
- **Which meetings sync.** The sync claim (`mtg_sync_claim`) checks the organiser's connection, not the host's, when deciding whether there is anything to sync.

### The Google event

- **Guests.** The guest list is every participant except the organiser:
  - the host, now included when the creator is someone else;
  - invited colleagues, using their profile e-mail;
  - outside guests.

  The worker passes the organiser's e-mail so it is excluded, instead of the host's.
- **When the event exists.** The event is created only once the meeting is SCHEDULED. A REQUESTED meeting has no Google event, as today. On approval the event is created, so Google sends the invitation, from the creator, to the Super Admin and the other guests.
- **Changes.** A reschedule patches the event. A cancel or decline deletes it. Google e-mails everyone each time.

### The CRM fallback e-mail

- **The outbox covers colleagues too.** Today the outbox only holds outside guests. It also queues one row per colleague participant (host, creator and invited colleagues, with their profile e-mail) for these kinds:
  - CONFIRMED (scheduled or approved);
  - RESCHEDULED;
  - CANCELLED;
  - DECLINED (sent to the creator only).
- **When a colleague's row is skipped.** The worker skips a colleague's row when the meeting's Google event is SYNCED on the organiser's calendar (Google sent it). It waits about 15 minutes while the sync is PENDING, as it already does for outside guests, and sends the CRM e-mail otherwise.
- **The organiser's own row.** It is always sent for CONFIRMED / RESCHEDULED / CANCELLED, because Google does not e-mail the organiser. So the creator also gets "the meeting mail".
- **Sender name and Reply-To.** Sender display name: "<creator name> via Amuwa CRM". Reply-To: the creator's e-mail. With no creator, the host's name and e-mail are used.

### Live Requests tab

- **How the page hears about changes.** The existing live notification stream (`NotificationContext`, realtime on `notifications` for the signed-in user) emits a window event `crm:meetings-changed` whenever a notification with `entity_type = 'meeting'` arrives.
- **What the page does.** `MeetingsPage` listens for that event and reloads approvals, the calendar and the requests list. It also reloads on window focus or visibility change.
- **The notification itself.** Every request already notifies its deciders (host and delegates), so the Super Admin receives it.

### Opening a meeting from a notification

- `openFromNotification` handles `entityType === 'meeting'`: it switches to the Meetings tab (`my_meetings` for staff, or the Super Admin's equivalent) and opens the meeting's detail dialog by id.
- It uses the same pending-open pattern as the HR cases (`takePending…` plus a window event).

### Participants only

- **Viewing.** `mtg_can_view` and `mtg_can_manage` drop the "any Super Admin" clause.
- **Deciding.** `mtg_can_decide` keeps the host and their delegates, and keeps a Super Admin only when the host is a Super Admin (so one CEO can cover for another).
- **Listing.** `mtg_list` drops the "Super Admin may read anyone's calendar" clause.
- **Notifications.** They already go only to participants (`mtg_staff_ids`) and deciders. No change.

## Left to the builder

- Exact names of the new private helpers and the migration file. The file must sort after `20270110000200`.
- Wording of the e-mail templates for colleagues. Reuse the existing CONFIRMED / RESCHEDULED / CANCELLED / DECLINED templates, with the sender line added.
- Where the pending-meeting id is kept for the notification click. Follow `issueEvents.ts`.

## Calls I made (please check)

- **Approval.** On approval, the event goes on the requester's (creator's) calendar, and the Super Admin is a guest on it.
- **Who organises without a creator.** Meetings without a creator (mirrors, public booking links) keep using the host's calendar.
- **No backfill e-mails.** Existing synced events are not moved, and no e-mails are re-sent for past changes.
- **What the Super Admin loses.** They lose access to meetings they are not part of. A request for their time still reaches them, because they are its host.

## Verification

- **DB tests:**
  - the creator is chosen as organiser;
  - the owner is backfilled for existing meetings;
  - colleagues get outbox rows;
  - the Super Admin cannot list, see or change an employee-only meeting;
  - the Super Admin still decides requests for their own time.
- **Unit tests:**
  - the event guest list excludes the organiser and includes the host;
  - the worker uses the organiser's connection;
  - mail is skipped when Google sent it, but always sent to the organiser;
  - the sender name and Reply-To are set.
- **Browser test:** a meeting notification arriving reloads the Requests tab; clicking it opens the meeting.
- **Full suites:** typecheck, build, `test:db` and `test:unit`. `test:api` runs in CI.
