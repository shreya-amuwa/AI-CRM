# Meetings: creator-organised invites, live requests, participant-only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meetings are put on the creator's Google Calendar, so Google e-mails the invitation and its updates from the creator, with a CRM e-mail as the fallback. The Requests tab updates live, meeting notifications open the meeting, and only participants see a meeting.

**Architecture:**
- One additive migration:
  - a new owner column;
  - redefined helper and claim functions;
  - colleague rows in the mail outbox;
  - visibility functions without the Super Admin clause.
- The server worker picks the organiser's Google connection and decides per e-mail whether Google already sent it.
- The UI emits a `crm:meetings-changed` event from the live notification stream, and an `openMeeting(id)` event from notification clicks.

**Tech Stack:** Postgres/Supabase (plpgsql RPCs), Node/TypeScript server (Hono), React + Vite.

**Spec:** `docs/superpowers/specs/2026-11-19-meetings-creator-invites-design.md`

## Global Constraints

- **Migration file:** `supabase/migrations/20270113000100_meetings_creator_organiser.sql`. It sorts after `20270112000100`.
- **Migration style:**
  - additive and idempotent, pasteable into the SQL editor, no temp tables;
  - never edit older migrations;
  - every function is `security definer set search_path = ''`, with `revoke … from public, anon, authenticated` on private helpers, as in `20270101000500`.
- **Organiser:** `coalesce(google_owner_id, created_by, host_id)`.
- **Fallback sender:** display name `"<organiser name> via Amuwa CRM"`, Reply-To the organiser's e-mail.
- **Tests:** do not weaken or delete existing tests. The `meetings_test.sql` and `meetings.test.ts` expectations that change are the Super Admin visibility ones, which the spec reverses on purpose.
- **Commits:** end with the session's attribution trailers.

## Review Focus

1. **A colleague who is also the organiser.** They must still get the CRM e-mail, because Google never e-mails the organiser. Test in Task 2.
2. **The Super Admin is the host of a request the employee created.** The Super Admin must be a Google guest, and the employee must be excluded as organiser. Test in Task 2.
3. **An existing synced meeting.** Its owner is backfilled to the host, and later patches must go to that calendar, not the creator's. Test in Task 1.
4. **A Super Admin deciding a request to another Super Admin.** It must still be allowed, while an employee-only meeting is not visible to them. Test in Task 1.
5. **A notification for a meeting arrives while the Meetings page is closed.** Clicking it later opens the page on that meeting (the pending id is taken on mount). Test in Task 3.

---

### Task 1: Migration — organiser, colleague e-mails, participant-only access

**Files:**
- Create: `supabase/migrations/20270113000100_meetings_creator_organiser.sql`
- Modify: `supabase/tests/meetings_test.sql` (load the new migration; add checks; flip the two Super Admin visibility expectations)

**Interfaces — produces:**
- `meetings.google_owner_id uuid references profiles(id)`. Backfill: `= host_id` where `google_event_id is not null`.
- `private.mtg_organiser(m public.meetings) returns uuid`: `coalesce(m.google_owner_id, m.created_by, m.host_id)`.
- `meeting_mail_outbox.to_profile_id uuid` (null for outside guests).
- `private.mtg_mail_externals(m, p_kind, p_send_after)`: same signature, plpgsql. It still queues outside guests, as today. It also queues colleagues:
  - for `CONFIRMED`, `RESCHEDULED`, `CANCELLED`: the host, the creator and profile attendees, each with their `profiles.email`;
  - for `DECLINED`: the creator only, when the creator is not the host.
- `public.mtg_sync_claim` JSON adds, per meeting:
  - `googleOwnerId`;
  - `organizerEmail`, `organizerName` (the organiser's profile);
  - `hostEmail`, `hostName`.

  The NOT_CONNECTED check uses the organiser's connection.
- `public.mtg_sync_result`: on success with an event id, sets `google_owner_id = coalesce(google_owner_id, private.mtg_organiser(m))`. When the event is removed, it clears `google_owner_id`.
- `public.mtg_mail_claim` JSON adds `toProfileId`, `organizerEmail` and `organizerName`.
- Access:
  - `mtg_can_view` and `mtg_can_manage`: no Super Admin clause;
  - `mtg_can_decide`: host, delegate, or (Super Admin and the host is a Super Admin);
  - `mtg_list`: no `p_host … SUPER_ADMIN` clause.

- [ ] **Step 1: Write the failing checks in `meetings_test.sql`.**
  - An employee meeting created by employee E (with colleague C):
    - the Super Admin's `mtg_list` does not include it;
    - the Super Admin's `mtg_detail` raises FORBIDDEN / NOT_FOUND (as for any non-participant).
  - The same meeting's `mtg_mail_externals(m,'CONFIRMED')`: the outbox has rows for E and C with `to_profile_id` set.
  - A request from E to the Super Admin: after approval, the claim JSON has `googleOwnerId` null and `organizerEmail` = E's e-mail. After `mtg_sync_result(ok, event)`, `google_owner_id = E`.
  - A meeting with `google_event_id` set before the migration has `google_owner_id = host_id` after the backfill. Simulate by setting it and re-running the backfill statement.
  - A decline queues a `DECLINED` row for the creator only.
- [ ] **Step 2: Run** `supabase/tests/run.sh`. Expected: FAIL in `meetings_test.sql`.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `supabase/tests/run.sh`. Expected: exit 0, `MEETINGS TESTS PASSED`.
- [ ] **Step 5: Commit.**

### Task 2: Server — organiser connection, guest list, e-mail rules

**Files:**
- Modify: `server/meetings/google.ts` (`CalendarMeeting`, `eventBody`)
- Modify: `server/meetings/worker.ts` (`syncOne`, `mailOne`, `ClaimedMeeting`, `ClaimedMail`)
- Test: `supabase/tests/meetings.test.ts`

**Interfaces:**
- **Consumes:** Task 1 JSON fields.
- **Produces:**
  - `CalendarMeeting` gains `organizerEmail: string | null` and `hostName: string | null`.
  - `eventBody(m, appUrl, withConference)` excludes `organizerEmail` from the guests. It adds the host (`hostEmail`, `hostName`) as a guest when the host is not the organiser. Guests are de-duplicated case-insensitively.
  - `syncOne` uses `cache.connection(m.googleOwnerId ?? m.createdBy ?? m.hostId)`.
  - `meetingSender(settings, organizerName, organizerEmail)` is exported from `worker.ts`. It returns settings with `email.fromName = "<name> via Amuwa CRM"` and `email.replyTo = organizerEmail`. Without a name it returns the settings unchanged.
  - `mailOne`:
    - a colleague row whose `toEmail` equals `organizerEmail` is always sent for CONFIRMED / RESCHEDULED / CANCELLED (never skipped as "Google sent it");
    - other rows keep today's SYNCED-skip / PENDING-defer rule;
    - colleague rows are sent with `meetingSender(...)`.

- [ ] **Step 1: Write failing unit tests in `meetings.test.ts`.**
  - `eventBody` for a meeting with host `ceo@x`, organiser `emp@x` and attendee `emp@x`: guests are exactly `['ceo@x']`.
  - `eventBody` with the organiser equal to the host: the host is not a guest (today's behaviour).
  - `mailOne` with a stub db, a SYNCED meeting and a colleague row to the organiser: the result is `SENT` and `sendEmail` is called.
  - The same setup with a row to another colleague: `SKIPPED` with "Google sent the invitation."
  - `meetingSender(s, 'Priya Shah', 'priya@gmail.com')`: `fromName` is `'Priya Shah via Amuwa CRM'` and `replyTo` is `'priya@gmail.com'`.
- [ ] **Step 2: Run** `npx tsx supabase/tests/meetings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit test, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: UI — live Requests tab, notification opens the meeting

**Files:**
- Create: `src/components/meetings/meetingEvents.ts`
- Modify:
  - `src/context/NotificationContext.tsx` (emit on meeting rows);
  - `src/components/issues/issueEvents.ts` (`openFromNotification`: `entityType === 'meeting'`);
  - `src/components/layout/shell.tsx` (open the Meetings overlay);
  - `src/components/team-member/TeamMemberLayout.tsx`;
  - `src/App.tsx` (switch to `my_meetings`);
  - `src/components/meetings/MeetingsPage.tsx` (reload and open).
- Test: `supabase/tests/ui_meetings.test.mjs`

**Interfaces — produces (`meetingEvents.ts`):**
- `MEETINGS_CHANGED_EVENT = 'crm:meetings-changed'`, `notifyMeetingsChanged(): void`, `useMeetingsChanged(cb: () => void): void`.
- `OPEN_MEETING_EVENT = 'crm:open-meeting'`, `openMeeting(id?: string): void`, `takePendingMeeting(): string | null`, `useOpenMeetingRequest(show: (id?: string) => void): void`.
- `NotificationContext`: the realtime callback calls `notifyMeetingsChanged()` when `payload.new?.entity_type === 'meeting'`.
- `MeetingsPage`:
  - on mount: `takePendingMeeting()` → `setOpenId`;
  - `useOpenMeetingRequest(id => id && setOpenId(id))`;
  - `useMeetingsChanged(reload)`;
  - window `focus` / `visibilitychange` (visible) → `reload`.

- [ ] **Step 1: Add failing browser checks to `ui_meetings.test.mjs`.**
  - With the page open, after the mocked approvals API starts returning one request and `crm:meetings-changed` is dispatched, the Requests tab label shows `Requests (1)`.
  - Dispatching `crm:open-meeting` with that id opens the details dialog.
- [ ] **Step 2: Run** `node supabase/tests/ui_meetings.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again, plus `npm run typecheck` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: Docs and full verification

**Files:**
- Modify: `docs/MEETINGS.md` (or the existing meetings doc): who organises, the fallback e-mail, participant-only access, the migration to run.

- [ ] **Step 1: Update the doc.**
- [ ] **Step 2: Run** `npm run typecheck`, `npm run build`, `npm run test:db` and `npm run test:unit`. Expected: all exit 0.
- [ ] **Step 3: Commit and push** to `claude/ai-crm-supabase-backend-kog2gh`.
