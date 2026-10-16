# Ticket hierarchy: Relationship Manager → Team Lead → Department Head

Migration: `supabase/migrations/20261025000100_ticket_hierarchy_escalation.sql` (re-runnable).
This change extends the existing ticket system (`support_tickets`, `support_ticket_updates`, the shared
`TicketsPage` and the client Tickets page). Nothing outside tickets changed.

## Who handles a ticket

| Level | Who | How they get it |
| --- | --- | --- |
| RM | The customer's Relationship Manager: the Team Member the customer was assigned to (`customer_onboarding.team_member_id`) | A new client ticket is assigned to them |
| TL | The customer's Team Lead (`customer_onboarding.team_lead_id`), else a lead of the ticket's team | The RM did not answer within the RM SLA, or someone escalated it |
| DH | The Department Head of the ticket's department | The Team Lead did not answer within the TL SLA, or someone escalated it |

- The RM stays the assignee after an escalation. `escalated_to` holds the Team Lead or Department Head who handles the ticket now. The ticket, its customer and its messages never move.
- **No RM yet:** the ticket starts with the Team Lead (`escalation_level = 'TL'`), or with the Department Head if there is no Team Lead. When the customer later gets an RM, the open ticket goes to them, unless it was really escalated.
- Every step is stored in `support_ticket_escalations` (from/to level and person, SLA or manual, who did it, note). It is also written to the ticket history and `audit_logs`.

## SLA

- `ticket_sla_settings` has one default row, plus optional per-department rows: the minutes the RM, then the Team Lead, has to answer. The starting default is 24 hours each.
  - Super Admin: Tickets → **SLA** sets the default.
  - Department Head: sets their own department's values.
- **The clock runs while the customer is waiting.**
  - It starts when the client raises a ticket or replies.
  - It stops when staff reply to the customer, set *Waiting for Customer*, or resolve the ticket.
  - Staff-raised tickets have no clock; they can still be escalated by hand.
- **`escalate_overdue_tickets()`** moves overdue tickets up one level.
  - Calling it is always safe: it never escalates a ticket twice.
  - It runs from **pg_cron** every 5 minutes, if the extension is enabled. Enable pg_cron in Supabase, then rerun the migration.
  - It also runs from `/api/v1/internal/automations/dispatch`, the existing secured job.
  - It also runs when a ticket screen opens or regains focus. There is no interval polling.

## Replies and notifications

- **Customer reply:** goes to the RM's ticket inbox (Realtime on `support_ticket_updates`). The RM is notified, and so is the Team Lead or Department Head it was escalated to.
- **Staff reply:** the customer sees it with the author's name. If a Team Lead or Department Head writes it, the RM is told.
- **Duplicates:** the same message sent again within 2 minutes is stored once. The same ticket submitted again within 10 minutes returns the first ticket.
- **Client live updates:** the client can now read **only their own** `client_notifications` rows (RLS). This lets their dashboard update through Realtime. Opening a ticket marks its notifications read (`POST /client/tickets/:id/seen`).

## Screens

- **RM (Support member):** each ticket card shows *Awaiting reply*, the level it is with, *Overdue*, and the reply deadline. Escalate goes to the next level.
- **Team Lead / Department Head / Super Admin (manager Tickets page):**
  - Overdue KPI.
  - Filters: overdue, waiting for our reply, level, person.
  - Columns: Relationship Manager, Handled by, SLA, Resolved by (and when).
  - Workload table with overdue counts and "resolved by them".
  - Monitoring never assigns the ticket.
- **Client:**
  - Their Relationship Manager's name, an escalation banner and an *Escalated* status.
  - Unread markers.
  - Live replies.

## Ticket chat (migration `20261026000100_ticket_chat.sql`)

- Every ticket's conversation is its existing history (`support_ticket_updates`). Customer messages, replies from the RM / Team Lead / Department Head, internal notes and system events (opened, assigned, escalated, reopened, resolved) share one thread.
- **No duplicates:** every message sent from a screen carries a `client_msg_id`; the same id is stored once (unique per ticket), so double clicks and retries never create a second copy. A client reply that reopens a resolved ticket is shown as one message plus a "reopened" event (this used to show an extra empty bubble).
- **Read state:** `support_ticket_reads` (staff, own rows only) and `support_tickets.client_read_at` (the client) give unread counts and "Sent" / "Seen" ticks.
- **Inbox previews:** `last_message_at`, `last_message_preview` and `last_message_from` on the ticket (internal notes are never the preview).
- **New functions:** `send_ticket_message` (staff reply or internal note), `mark_support_ticket_read`, `client_send_ticket_message`. `client_ticket` returns `messages` (messages and events). Manual escalation now needs a reason.
- **API:** `POST /client/tickets/:id/messages` `{ message, clientMsgId }`.
- **Screens:** staff Tickets pages are an inbox (tabs: All, Unread, Open, In progress, Pending, Escalated, Resolved), a chat, and a details panel with Resolve / Change status / Escalate / Reassign / Reopen. The client Tickets page is an inbox plus chat. On phones, one panel shows at a time.
- **Scheduled escalation:** the migration switches on `pg_cron` when the database offers it, so overdue tickets escalate every 5 minutes without anyone online.

## Ticket screens redesign (migration `20261027000100_ticket_priority_control.sql`)

The staff Tickets pages and the client Tickets page now share one structure: **inbox on the left, the selected ticket on the right** (one panel at a time on phones, the open conversation goes full screen with a Back arrow).

- **Ticket numbers** are shown as `#AMW-0042`. The stored number (`TKT-000042`) does not change, so notifications and old records keep the stored form. Search matches both.
- **Inbox tabs** adapt to the role: Team Lead sees All open, Unassigned, My tickets, My team, Escalated, Resolved / closed; Department Head and Super Admin the same without My team; a team member sees All open, My tickets, Escalated, Resolved / closed. Counts are computed from the tickets the person is allowed to see. "My tickets" means tickets with that person *now* (the RM, or the person it is escalated to). Status, priority, level, person, unread and overdue are under **Filters**.
- **Ticket item:** number, time since last activity, customer and business, subject and last message, status, priority and team badges, unread count, and who is working on it (or "Nobody is working on this yet").
- **Selected ticket:** header with number, status, phone; a context banner (waiting for the RM, escalated because the SLA was exceeded, assigned to X, a new customer message needs your attention); team / RM / current-handler chips; **Priority** and **Status** selects; Escalate (reason required) and Reassign; a collapsible Details area (customer ID, SLA, escalation history, resolution). **Pick up this ticket** appears only for the Team Lead of an unassigned ticket's own team (it uses the existing `assign_support_ticket`); monitoring or replying never takes a ticket over.
- **Chat:** bubbles carry the sender name and role and the time; customers' messages on the left, the team's on the right; internal notes are marked; system events (assigned, escalated, priority changed, resolved, reopened) are separate timeline entries; Sent / Seen ticks; sending / failed / retry states; date separators; "New messages" button when scrolled up.
- **Priority control:** new `set_ticket_priority(ticket, priority)` (same permission as updating the ticket; audited; the other handlers are notified) and the `PRIORITY_CHANGED` timeline event (internal, the customer does not see it).
