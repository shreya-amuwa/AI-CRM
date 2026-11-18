# Chat Push Notifications on Phones and Laptops: Design

Date: 2026-11-18. Status: approved in conversation (approach A and the behaviour below); written down here.

## Why
Staff miss chat messages when the CRM is not open. Today only **client** messages create a bell notification (`CHAT_CLIENT_MESSAGE`);
colleague messages (direct and group) only raise the unread count while the CRM is open. Staff now install the CRM on their phones
(PR #238), so a new chat message should reach them as a phone / laptop notification within seconds, like WhatsApp.

## Goals
- A push notification for every new chat message to every other member of the conversation, on each device where they turned
  notifications on, within a few seconds.
- **Colleague chats (DIRECT, GROUP): name and message text.** `Shreya Mande · Manual CRM` / `wtf mhnje 4 months?` (direct chat: the
  sender's name as the title).
- **Client chats (CLIENT): name only.** `Manual CRM` (the customer's company or name) / `New message from <sender>`. No message text: client
  conversations are business records and should not appear on a lock screen.
- **No content where there is no text:** a message that is only attachments says `sent a file`; an end-to-end encrypted message
  (older chats, or `internal_mode = E2EE`) says `New message`.
- **Grouped per conversation:** a notification tag per conversation (`chat-<conversation id>`), so quick messages replace each other
  (showing the latest) instead of stacking. The phone still alerts for each one (`renotify`).
- **Tapping opens that conversation** (the chat page on that conversation; a CRM window already open switches to it).
- **A "Chat notifications" switch** for each person (default on), next to their reminder times in Attendance → Reminders, so someone can
  keep attendance reminders and turn chat off. The device on/off and the banner stay shared with the reminders; the banner and the tab
  wording change from "reminders" to "notifications" where they mean both.

## Non-goals
- No push for clients on the client portal (they do not use the staff app).
- No per-conversation mute (can come later).
- No retry of a failed push (the message, the unread count and the bell are unaffected).
- No change to what is stored, to encryption, or to who can read a conversation.

## Anti-goals (failure even if it "works")
- Sending a message gets slower, or fails because of push.
- Someone receives a notification for a conversation they are not a member of, or after they left it.
- Client message text on a lock screen.
- The sender gets a notification for their own message.

## Approach (chosen: A)
| | How | Trade-off |
|---|---|---|
| **A (chosen)** | The API sends the push right after a message is saved (Worker `waitUntil`, after the answer): one database call returns the recipients' devices and the exact notification text; the API pushes, then reports results (gone devices switched off). | Instant (1–2 s), nothing new to configure, reuses the reminders' Web Push. A failed push is not retried. |
| B | Supabase database webhook on each stored message calls the API. | Also catches messages written outside the API, but all messages already go through it; adds a Supabase setting to keep working. |
| C | Queue table drained by a 1-minute cron. | Most dependable, but up to a minute late: feels broken for chat. |

## How (decided)
- **Paths that create a message:** staff `POST /chat/conversations/:id/messages` (text and attachments together), staff
  `POST /chat/conversations/:id/secure-messages` (encrypted), client `POST /client/chat/messages`. Each, after success, schedules the push
  for the new message id. Nothing else creates chat messages from people.
- **The database decides** (new service-role function, e.g. `chat_push_for_message(p_message uuid)`): recipients = current members of the
  conversation, staff only, active accounts, not the sender, with their chat switch on and at least one active device; it builds title,
  body, tag and url by the rules above, and returns `[{ profileId, title, body, tag, url, targets }]`. Message text is cut to about
  120 characters. A message already pushed is not pushed again (once per message).
- **Sending** reuses `server/automations/webPush.ts` (`sendWebPush`, 10-second timeout) and `push_subscriptions_report`. Pushes are sent
  at most 6 at a time and **capped per message** (so a big group can never break sending or the Worker's request limit); the cap is the
  builder's call, with the Cloudflare plan in mind (free: 50 outside requests per run, paid: 1,000).
- **The service worker** (`public/sw.js`) already shows `{ title, body, tag, url }`; the url for chat opens the chat page on that
  conversation, and an open CRM window is asked to switch to it.
- **Load:** per message, one small indexed database call plus one small update, plus one request per recipient device to Google / Apple
  (not to the database), all after the sender has their answer.

## Left to the builder
- The exact cap per message, and the function / column names (the chat switch may be a column on the existing reminder preferences).
- How the chat page opens a conversation from a url / message (follow the existing chat deep-link and `openChat` patterns).
- The banner / tab wording change ("Turn on notifications").

## Tests expected
- Database: recipients (members only, not the sender, not someone who left, not inactive, chat switch off excluded), colleague vs client
  wording, attachment-only and encrypted messages, once per message.
- API: sending a message schedules the push and still answers immediately when push is off or fails.
- Browser: the Chat notifications switch; tapping a chat notification opens the conversation.
