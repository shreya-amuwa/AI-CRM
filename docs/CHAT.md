# Chat (client chat and internal employee chat)

Two audiences, one set of tables and functions, no overlap:

* **Client chat** - a **Chat** tab in the client dashboard. The client talks to the Team Member and the Team Lead who look
  after them, in **one shared conversation**. The Department Head of the customer's department can **read** it (review only).
* **Internal chat** - employees message each other one to one and in groups. Employees open it from the **Chat** item in the
  menu of their dashboard (just above the Notification Center). It is a full page, not a pop-up.

A client can never reach internal chat, and no internal conversation is ever visible to a client. The two share no
participants, no endpoints and no screens.

## Who can do what

| Person | Client conversation of a customer | Internal chats |
| --- | --- | --- |
| The client | read and write their own (the server finds it from their login) | no access |
| Assigned Team Member and Team Lead | read and write | their own direct chats and groups |
| Department Head (customer's department) and Super Admin | **read only** (audited) | their own, like any employee |
| Any other employee | nothing | their own |

The Department Head is never a member of the conversation and is never shown to the client. The write check does not know
that role at all, so there is nothing to bypass: sending, uploading and every write function refuse a reviewer in the
database, and the API returns `403`.

Participants of a client conversation are **not stored**; they are worked out live from the customer's current assignment
(`customer_onboarding.team_member_id` / `team_lead_id`, with the existing support-team fallback). That is why a
reassignment takes effect at once.

## Decisions written down

* **One conversation per customer** (a partial unique index). The client, Team Member and Team Lead share it, so a hand-over
  never splits the thread.
* **Reassignment**: the conversation stays with the customer. The new assignees see the whole thread (the same way they see the
  customer's notes and journey); the previous assignee **loses access immediately**; a system line records "Your assigned
  team was updated" for everyone. *If your business rule is that a new assignee must not see earlier messages, say so: it is
  a one-line change (a "visible from" position for staff on a client conversation) that already exists for group members.*
* **Department Head scope**: only customers of their own department. There is no company-wide screen. Opening a client chat as
  a reviewer is written to the audit log (`CLIENT_CHAT_REVIEWED`, at most once per 30 minutes per person and chat, serialized
  so two tabs leave one entry).
* **Groups**: private, by invitation. The creator is the admin; admins add and remove people, rename, and make others admins;
  anyone can leave (the longest-standing member becomes admin if the last admin leaves). A person added later sees messages
  from the moment they joined; a person who was removed or left loses the group, its history and its files at once. System
  lines record joins, removals and leaves.
* **Direct messages**: one conversation per pair of people (a unique key), opened again when you start a chat with the same
  person.
* **Not included on purpose**: editing or deleting messages (there is no audit model for it yet), voice or video, and end-to-end
  encryption. Messages are protected by access control and by encryption in transit and at rest; they are **not** end-to-end
  encrypted, and the product does not say they are.
* **Notifications**: in-app only, through the existing notification systems. One entry per "unread run" (a new one only after
  the person has read the chat), not one per message. No e-mail or WhatsApp is sent for chat.

## Data model (`supabase/migrations/20261108000100_chat.sql`)

| Table | Purpose |
| --- | --- |
| `chat_conversations` | `kind` CLIENT / DIRECT / GROUP, the customer (client chats), title, direct key, last sequence, preview, mirrored read positions for "seen" |
| `chat_members` | members of direct chats and groups (role, joined, visible-from, left / removed) |
| `chat_messages` | the messages: per-conversation `seq`, sender (from the session), kind TEXT / SYSTEM, body (up to 4000), reply-to, `client_msg_id`, attachments |
| `chat_read_state` | one row per person and conversation: how far they have read |
| `chat_attachments` | files: private bucket `chat-attachments`, status PENDING / READY / FAILED, provider reference |

* Server timestamps, `seq` assigned under a row lock (stable order; a reconnecting screen asks for "everything after N";
  unread counts are arithmetic).
* **Idempotent send**: the screen sends a `clientMsgId`; a retry or duplicate request stores one message.
* Constraints: a shape check per kind, one CLIENT conversation per customer, one DIRECT per pair, body length, at most 5 files
  per message, 5 MB per file.
* A flood guard stops a sender after 60 messages in a minute.

### Security model

* Tables have **row level security with select policies only**. Nobody (not even the service role used by the API for other
  things) writes them directly: every write is a `SECURITY DEFINER` function (`set search_path = ''`, executable by
  `authenticated` only) that decides from `auth.uid()` who the caller is. No function accepts a sender, a conversation of
  someone else, or a participant list for a client chat.
* Supabase Realtime applies the same select policies to every change it delivers, so a screen can only be told about rows
  its person may read (this includes a member being removed: the member's own row stays visible so their screen learns it).
* The API uses the **caller's own database client**; the service-role key is never used for chat reads or writes and never
  reaches the browser.
* No message text is logged. Files are checked on the server (type, size, and that the stored content matches the type),
  stored privately, and downloaded only through a link that lives 120 seconds and is issued after the database says the
  caller may read the message the file belongs to. There is no public URL.
* Client routes take no conversation id: `/api/v1/client/chat/*` works it out from the login, and strict validation rejects
  any extra field.

## API

Employees (`/api/v1/chat/...`): `GET internal`, `my-clients`, `review`, `unread`, `directory?q=`; `POST direct`, `groups`;
`GET customers/:customerId`, `conversations/:id`, `conversations/:id/messages?before=|after=&limit=`;
`POST conversations/:id/messages`, `.../read`, `.../review-open`, `.../uploads`; `POST uploads/:id/complete|abort`;
`GET attachments/:id/url`; `PATCH groups/:id`; `POST groups/:id/members`, `groups/:id/admins`, `groups/:id/leave`;
`DELETE groups/:id/members/:profileId`.

Clients (`/api/v1/client/chat/...`): `GET /` (conversation and the newest page), `messages`, `unread`,
`attachments/:id/url`; `POST messages`, `read`, `uploads`, `uploads/:id/complete|abort`.

Errors follow the existing convention (`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `RATE_LIMITED`). A client login
that calls an employee route is answered `401` (it has no CRM profile). Management routes use the *sensitive* rate class.

## Screens

* **Client > Chat**: header with the assigned Team Member and Team Lead, bubbles with sender name and role, date separators,
  "seen" ticks, loading / empty / error states, a composer (Enter sends, Shift+Enter adds a line), attach files, reply to a
  message, failed sends stay on screen with **Retry** (same message id, no duplicate), earlier messages load on request. If no
  Team Member is assigned yet, the composer is replaced by a note.
* **Employees > Chat (menu item)**: a WhatsApp-style page that fills the content area (chat list on the left, the conversation on
  the right; on a phone one panel at a time with a back arrow). My messages are on the right, the other person's on the left,
  with ticks, date separators and a wallpaper. Tabs: **Messages** (direct chats and groups, with preview, time, unread count,
  search, **New** to start a chat or group, group details with admin actions and confirmation for removing someone or
  leaving), **My clients** (the customers they look after and the shared conversation), and, for Department Heads,
  **Client conversations** (review only, with a "Review only" marker and no message box). The menu item shows the unread count.
* Clicking an in-app notification about a client message opens the Chat page on that conversation.

## Live updates without polling

* History comes from the API. A screen then listens (Supabase Realtime `postgres_changes`, filtered to the one conversation)
  and, when told something happened, asks the API for "everything after the last message I have". The live event is only a
  signal, so a message that arrives both as the answer to your own send and as an event is shown once (messages are merged by id).
* There is **no timer**. A screen also catches up when the tab becomes visible, the window gets focus, the network returns,
  and when the live connection is re-made after a drop.
* A message counts as read only when it was on screen in a visible tab.
* Subscriptions are removed when a screen closes.

## Encryption, deleting messages, emoji

Internal chats are end-to-end encrypted, messages can be deleted for me / for everyone, and the message box has an emoji picker: see
`docs/CHAT_ENCRYPTION.md` (protocol, key management, limits, the one-time clean-up script). Client chats are not end-to-end encrypted.

## Tests

* `supabase/tests/chat_test.sql` (part of `npm run test:db`): the denials come first - a client against another client's chat,
  a Department Head writing / uploading / inserting directly, an unassigned employee, an outsider reading a group, a
  removed member, a suspended employee, direct writes to the tables, tampered ids - then the allowed paths, reassignment,
  paging, idempotency, the flood guard, the Realtime publication and row level security being on.
* `supabase/tests/api_integration.test.ts` (part of `npm run test:api`): the same through HTTP with real tokens, including
  the client routes ignoring any conversation id.
* `supabase/tests/e2e/run-chat.sh`: real browsers for a client, two Team Members, a Team Lead and a Department Head (and a phone
  window): live delivery without a refresh, seen ticks, unread badges, one notification per unread run, review-only,
  a Department Head's direct API send refused, failed send and retry without a duplicate, offline catch-up, 85 messages
  of history and paging, direct messages, groups (create, remove with confirmation, live loss of access, leave), attachments
  (type / size / content refusals, signed link, no public URL, outsider refused), reply, Shift+Enter, no console errors.
  See `supabase/tests/e2e/README.md`. `supabase/tests/local-realtime.mjs` is the Realtime stand-in the local stack uses; it
  re-reads each changed row as the subscriber, so row level security decides who is told.

## Deploying

1. Run `supabase/migrations/20261108000100_chat.sql` in the Supabase SQL editor (safe to run again; nothing is deleted). It
   creates the tables, the private `chat-attachments` bucket, the functions, the policies and adds the chat tables to the
   `supabase_realtime` publication.
2. Deploy the web app and API. No new environment variable is needed: chat files use the same storage driver as customer
   documents (`STORAGE_PROVIDER`, the Cloudflare R2 settings, CORS on the R2 bucket for `PUT` from the app's origin).
3. Chat deletion + encryption: run `supabase/migrations/20261206000300_chat_deletion_and_e2ee.sql` (or the bundle
   `supabase/run_these_3_migrations_hierarchy_contact_secure_chat.sql`). For encrypted files the R2 bucket's CORS rule must also allow `GET`
   from the app's origin.
4. Supabase Realtime must be enabled for the project (it is by default).
