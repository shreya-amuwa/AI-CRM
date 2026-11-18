# Chat Push Notifications: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new chat message reaches the other people in the conversation as a phone or laptop notification within seconds. Colleague chats show the text; client chats show the name only.

**Architecture:**
- After the API saves a message, it hands the message id to background work (`afterResponse`: Worker `waitUntil`, so the sender's answer is not delayed).
- One service-role database function decides who is notified and builds the exact notification. It records the message so it is pushed once.
- The API pushes with the existing Web Push sender. The service worker shows the notification, and a tap opens that conversation.

**Tech Stack:** Supabase Postgres (security-definer functions), Hono API on Cloudflare Workers, `server/automations/webPush.ts` (Web Push already in place), React.

**Spec:** `docs/superpowers/specs/2026-11-18-chat-push-notifications-design.md`

## Global Constraints

**Branch and PR**
- One branch, `claude/chat-push-notifications`, cut from the latest `origin/main`. One PR, never merged by us.
- Merge `origin/main` before pushing.

**Migration**
- One new migration, `20270111000100_chat_push.sql`. It must be later than every migration on `main` (the latest today is `20270110000200`). Rename it if `main` moves past it.
- It must be safe to run twice and pasteable in the SQL editor.
- Functions are `security definer` with `set search_path = ''`, revoked from `public, anon`.
- The two functions only the API calls are `service_role` only.
- Errors use `VALIDATION_ERROR:` / `FORBIDDEN:` prefixes.

**Recipients**
- Recipients come from `private.chat_recipients(conversation)`, the existing rule: members of direct and group chats, and the client chat's assigned staff plus support-group members.
- Each recipient must:
  - be a `profiles` row with `status = 'ACTIVE'`;
  - not be the sender;
  - have `from_seq < message.seq`;
  - have the chat switch on;
  - have at least one active row in `push_subscriptions`.
- Client logins never match a profile row, so they are never pushed to.

**Notification copy (exact)**

| Conversation | Title | Body |
|---|---|---|
| DIRECT | `<sender name>` | text |
| GROUP | `<sender name> · <group title>` | text |
| CLIENT | `<company, or the customer's name when there is no company>` | `New message from <sender name>` |

- Text is the message body cut to 120 characters, with `…` added when cut.
- When the body is empty and there are attachments, the text is `sent a file`.
- An encrypted message (`chat_messages.encrypted`) uses the text `New message`.
- Messages with `kind = 'SYSTEM'` are never pushed.

**Notification fields**
- Tag: `chat-<conversation id>`.
- URL:
  - colleague chats: `/?open=chat&conversation=<id>`
  - client chats: `/?open=chat&client=<id>`

**Limits**
- At most **40 devices per message** (the Worker's free plan allows 50 outside requests per run, minus the database calls).
- At most 6 pushes at a time, with a 10-second timeout each (the existing `sendWebPush`).
- The chat switch defaults **on**.

**Copy changes**
- Banner: `Turn on reminders` becomes `Turn on notifications`.
- Banner text: `Get Punch In, lunch and Punch Out reminders on this device.` becomes `Get chat messages and attendance reminders on this device.`
- `Reminders are on for this device.` becomes `Notifications are on for this device.`

## Review Focus

1. **A member who left a group, or was added after the message:** they get nothing. Tested in Task 1 (`left_at`, `from_seq`).
2. **The sender:** never notified of their own message, including on their own second device. Tested in Task 1.
3. **Push down, slow or not set up:** sending a message still answers 201 straight away, and the message is saved. Tested in Task 2.
4. **The same message seen twice:** a retried request or the same id, for example. It is pushed once. Tested in Task 1.
5. **A client chat:** the text never appears in the notification, even when staff send the message. Tested in Task 1.

---

### Task 1: Who is notified, and what it says (database)

**Files:**
- Create: `supabase/migrations/20270111000100_chat_push.sql`
- Create: `supabase/tests/chat_push_test.sql`, with one line in `supabase/tests/run.sh` after `attendance_reminders_test.sql`. It loads the migration twice.

**Interfaces:**
- Produces:
  - `attendance_reminder_prefs.chat_push boolean not null default true` (new column).
  - `public.push_chat_set(p_enabled boolean) returns jsonb`, granted to `authenticated`. It works for active staff, including the Super Admin, and creates the prefs row if missing. It returns the same JSON as `attendance_reminder_settings()`.
  - `private.attendance_reminder_settings_json(uuid, boolean)` is recreated so it adds `'chatPush': coalesce(prefs.chat_push, true)` at the top level. Everything else stays as on `main` (`20270109000200`).
  - Table `public.chat_push_log (message_id uuid primary key references chat_messages on delete cascade, pushed_at timestamptz default now())`, with RLS on and no grants.
  - `public.chat_push_for_message(p_message uuid) returns jsonb`, granted to `service_role` only.
    - It returns `[{ profileId, title, body, tag, url, targets: push_targets_for(profileId) }]` by the Global Constraints.
    - It inserts `chat_push_log` `on conflict do nothing` and returns `[]` when the row already existed.
    - It returns `[]` for an unknown id, a `SYSTEM` message, or no recipients.
    - Targets are limited so the total across recipients is at most 40 devices (recipients in name order, devices newest first).

- [ ] **Step 1: Write the failing SQL tests.**
  - Set-up: two new staff `cp.a@example.com` and `cp.b@example.com` with one device each, via the `test.create_auth_user` / `profiles` helpers used in `chat_company_readable_test.sql`. Also a direct chat, a group "Manual CRM" with a third member who left, and a client chat for a synthetic customer.
  - Names and checks:
    - `direct: B gets "<A's name>" / the text, A gets nothing`
    - `group: title "<A's name> · Manual CRM"; a member who left gets nothing`
    - `a member added after the message gets nothing`
    - `a 300-character message is cut to 120 characters with …`
    - `a file without text says "sent a file"`
    - `an encrypted message says "New message"`
    - `client chat: title is the company, body "New message from <sender>", never the text`
    - `the same message twice: the second call returns []`
    - `chat switch off (push_chat_set(false)): nothing for that person, and attendance_reminder_settings() shows chatPush false`
    - `an inactive account or a person without devices gets nothing`
    - `the url and tag name the conversation`
    - `staff cannot call chat_push_for_message` (expects `permission denied`)

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `PGHOST=/var/run/postgresql PGUSER=root psql -X -v ON_ERROR_STOP=1 -d crm_rls_test -f supabase/tests/chat_push_test.sql`
  - Expected: error, because the migration file does not exist yet.

- [ ] **Step 3: Write the migration.**
  - For the text cut, use `left(body, 120)` plus `…` when `length(body) > 120`.
  - Read the sender name from `chat_messages.sender_name`.

- [ ] **Step 4: Run the tests and confirm they pass,** then run the whole `bash supabase/tests/run.sh`. Expected: no failures.

- [ ] **Step 5: Commit.** Message: `feat(chat): decide chat push notifications in the database`.

### Task 2: Push right after a message is sent (API)

**Files:**
- Modify:
  - `server/automations/attendanceReminders.ts`: export the existing `pushAll` as `sendPushJobs(jobs, limit = 6)`. Keep its behaviour.
  - `server/app.ts`: middleware next to the other `app.use(... afterResponse ...)` patterns.
- Create: `server/automations/chatPush.ts`
- Test: `supabase/tests/api_integration.test.ts` (one `{ }` block before the final line) and `supabase/tests/chat_push.test.ts` (added to the `run-unit.sh` list).

**Interfaces:**
- Consumes: `chat_push_for_message` (Task 1); `sendPushJobs`; `vapidConfig`.
- Produces:
  - `export async function pushChatMessage(messageId: string): Promise<{ recipients: number } & PushTotals>`. It never throws, and does nothing (zeros) without a service client or VAPID config.
  - `export function messageIdFrom(json: unknown): string | null`. It reads `data.id` from the API envelope `{ success, data: { id } }` and returns null otherwise.
- Middleware:
  - It runs on `POST /chat/conversations/:id/messages`, `POST /chat/conversations/:id/secure-messages` and `POST /client/chat/messages`.
  - After `next()`, when the status is 2xx, it calls `afterResponse(c, pushChatMessage(id))` with the id from `messageIdFrom(await c.res.clone().json())`.

- [ ] **Step 1: Write the failing tests.**
  - Unit test `chat_push.test.ts`:
    - `messageIdFrom reads data.id`
    - `messageIdFrom is null for an error envelope or a non-uuid`
    - `pushChatMessage without VAPID keys pushes nothing and does not throw`
  - API test block:
    - `sending a colleague message still answers 201 with push not set up`
    - `the message is recorded as pushed (chat_push_log has its id)`: in the test API, push is off, so the database call still runs and logs it.
    - `a client message is logged too`
    - `a failed send (empty body) logs nothing`

- [ ] **Step 2: Run the tests and confirm they fail.**
  - `bash supabase/tests/run-unit.sh 2>&1 | grep -A3 chat_push`
  - the API suite via `run-api.sh`
  - Expected: FAIL.

- [ ] **Step 3: Implement `chatPush.ts`, `sendPushJobs` and the middleware.**
  - `pushChatMessage` calls the database function even when push is off, so the log row exists and a later retry does not push old messages. It sends only when `vapidConfig()` is set.

- [ ] **Step 4: Run the tests and confirm they pass.** Also run `npm run typecheck`, the unit suite and the API suite. Expected: all green.

- [ ] **Step 5: Commit.** Message: `feat(chat): push new chat messages right after they are sent`.

### Task 3: Tapping opens the conversation; the Chat notifications switch; wording

**Files:**
- Modify:
  - `public/sw.js` (`notificationclick`)
  - `src/components/attendance/StaffReminders.tsx` (`useStaffReminders`)
  - `src/components/attendance/ReminderBanner.tsx` and `RemindersPanel.tsx` (copy and switch)
  - `src/lib/attendance.ts` (`setChatPush`, `ReminderSettings.chatPush`)
  - `supabase/tests/ui/reminders_stubs.ts`, `supabase/tests/ui_reminders.test.mjs`, `supabase/tests/pwa_assets.test.ts`
  - Docs: `docs/CHAT.md` (new section "Push notifications"), `docs/ATTENDANCE_PUNCH.md`, `docs-site/content/shared/attendance-reminders.md` (adds chat)

**Interfaces:**
- Consumes: `push_chat_set`, `chatPush` in the settings JSON (Task 1); `openChat({ conversationId } | { clientConversationId })` from `src/components/chat/chatEvents.ts`.
- Produces:
  - `sw.js`: on click, when an open CRM window exists, it posts `{ type: 'open-chat', conversationId?, clientConversationId? }` for a chat URL, or `{ type: 'open-attendance' }` as before. Otherwise it opens the URL.
  - `useStaffReminders`:
    - on mount, it reads `?open=chat&conversation=…` / `&client=…` and calls `openChat(...)` once;
    - it handles the `open-chat` worker message the same way;
    - it then removes `open` / `conversation` / `client` from the address with `history.replaceState` (this also fixes the earlier deferred minor for `?open=attendance`).

- [ ] **Step 1: Write the failing tests.**
  - `pwa_assets`:
    - `sw.js posts open-chat for a chat url`: a text check for `open-chat` and `conversation`.
  - `ui_reminders`:
    - `the banner says Turn on notifications and mentions chat messages`
    - `the Reminders tab has a Chat notifications switch; turning it off calls push_chat_set(false)`
    - `/?open=chat&conversation=c1 opens the chat on c1 and the address no longer has open=`: the harness probe counts `crm:open-chat` events with their detail.
    - `a worker message open-chat with clientConversationId opens that client chat`: dispatched through a fake `navigator.serviceWorker` message listener.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node supabase/tests/ui_reminders.test.mjs` and the `pwa_assets` unit test.
  - Expected: FAIL.

- [ ] **Step 3: Implement the worker click, the hook, the switch (`attendanceApi.setChatPush(enabled)`), the copy and the docs.**
  - Put the switch in "My reminder times", renamed "My notifications": `Chat notifications` and `Attendance reminders`.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run the unit and browser suites, `npm run typecheck`, `npm run build` and `npm run docs:check`.
  - Repeat the scratchpad Chromium check against `vite preview` with a chat payload: delivering `{ title, body, tag: 'chat-…', url: '/?open=chat&conversation=…' }` shows the notification with that tag.

- [ ] **Step 5: Commit, merge `origin/main`, push and open the PR.**
  - Message: `feat(chat): open conversations from notifications; Chat notifications switch`.
  - The PR lists the migration `20270111000100_chat_push.sql` and the checks.
  - It says the VAPID settings are still needed for any push.
