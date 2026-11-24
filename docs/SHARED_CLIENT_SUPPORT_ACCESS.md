# Shared client chat and tickets (Support desk)

Migration: `supabase/migrations/20270129000100_shared_client_support_access.sql` (safe to run twice; nothing is deleted or rewritten).
Tests: `supabase/tests/shared_client_support_access_test.sql` (database), `supabase/tests/shared_support_desk.test.ts` and `supabase/tests/ui_shared_support_desk.test.mjs` (screens).

## What it solves

A client conversation used to be open only to the customer's **Relationship Manager (RM)** and **Team Lead**, to the Support employees a Team Lead added to the client's support
group by hand, and (read only) to the Department Head and the Super Admin. A ticket was open only to its assignee, creator, current escalation owner, the Team Lead of its team,
the Department Head and the Super Admin. When the RM was on leave, nobody else could answer the client.

Now an **authorised Support colleague of the customer's department** can open the same chat and tickets, read the whole history, and reply under their own name. The same
conversation and the same ticket are used: there is no copy, no second chat and no second ticket system.

## Who counts as "authorised" (the shared Support desk)

`private.shared_support_ok(customer)` is true only for the signed-in person when **all** of these hold:

* they are an active Support Team Member or Team Lead (`private.is_support_staff()`: a team whose division is SUPPORT);
* their department is the customer's department, and the customer is a customer (not a lead);
* the Support desk switch is on (`access_settings.support_desk_department_wide`, default on; the Super Admin can turn it off with `set_support_desk_department_wide(false)` and
  everything below goes back to strict ownership at once). It is the same switch the customer list already uses.

Not included: Sales, HR, Accounts and every other department, Support employees of another department, clients, anonymous callers. The Department Head and the Super Admin keep their
existing read-only review of client chats. Shared access is **not** Super Admin power.

## Client chat

| | RM / Team Lead | Covering colleague (desk) | Department Head / Super Admin |
| --- | --- | --- | --- |
| open, read the history | yes | yes | yes (reviewer) |
| reply | yes | yes, under their own name | no |
| see who is handling it | yes | yes | yes |
| the client sees the handler | no | no | no |

* `private.chat_access` returns `STAFF` for the desk (RM channel only; the Meta verification channel is unchanged). `chat_customer_conversation` opens it.
* The reply is stored with the authenticated employee as `sender_id` and `sender_name`; the label is **Support Team**, never "Relationship Manager" for a colleague. Nothing in the
  browser request names who is sending.
* **The RM assignment is never changed** by a reply, a take-over or a release (`support_member_of`, `support_lead_of`, the support group are untouched).
* Different things stay different: the **primary RM** (assignment), the **last responder** (the last message), the **current handler** (`chat_conversations.handling_by`) and, for
  tickets, the **ticket assignee** (`assignee_id`).
* **Currently handling** (`handling_by`, `handling_at`): set when an employee replies in the RM channel and by `chat_set_handling(conversation, 'TAKE' | 'RELEASE')`. It is
  information only (nobody is locked out) and shows as active for 15 minutes after the last activity. Releasing is allowed for the handler, the RM and the Team Lead. Taking and
  releasing are written to the audit log.
* `chat_desk_clients(search)` lists the department's customers for the desk: customer, company, RM, handler, last message and sender, unread, awaiting reply.
* The chat has no internal notes: everything in it is customer-visible. Employee-only remarks belong in a ticket internal note.

### Notifications (existing system, no flood)

* A client message notifies the RM and the Team Lead (as before) and, if a colleague is actively handling the chat, that colleague. One bell per person per unread run
  (`private.notify_once`), not one per message.
* The RM (and, since `20270202000200`, the Team Lead) gets one `CHAT_COVER_REPLY` bell per colleague per day when a colleague answers their client.
* Nobody else on the desk is notified; nobody is notified of their own reply.

## Tickets

* `private.can_view_ticket` also admits the desk, so `mark_support_ticket_read`, the attachment functions and `send_ticket_message` work for a covering colleague (reply to the
  customer, or add an **internal note**). The reply carries `author_id` = the colleague; the assignee and the escalation owner are notified (`TICKET_STAFF_REPLY` / `TICKET_NOTE`).
* A reply never changes the assignee, the status, the priority, the escalation level or the history (`first_response_at` / `last_staff_reply_at` are set by the existing trigger,
  which also stops the SLA clock the way any staff reply does).
* **Managing is unchanged.** Status, priority, assignment and escalation (`update_support_ticket`, `set_ticket_priority`, `assign_support_ticket`, `escalate_support_ticket`) now
  call `private.can_manage_ticket`, which is exactly the old visibility rule (assignee, creator, current owner, Super Admin, the Department Head, the Team Lead whose team it is).
  The RM → Team Lead → Department Head escalation works as before.
* **The ticket tables stay as narrow as before.** The policies on `support_ticket_updates` and `support_ticket_escalations` are pinned to `can_manage_ticket`, and
  `support_tickets_select` is untouched, so everybody's own ticket lists, dashboards and counts do not change. A colleague reads shared tickets through `desk_tickets()`
  (the department's 300 most recently updated customer tickets with their history, `manageable`, the handler and the names). The screens use it in a **Support desk** tab next to **My tickets**.
* `ticket_set_handling(ticket, 'TAKE' | 'RELEASE')` marks who is handling a ticket (information only, audited). A reply sets it too.
* **Internal notes never reach the customer.** They are `client_visible = false` rows in a table the customer cannot read; every client function (`client_ticket`, `client_tickets`,
  the dashboard, WhatsApp) returns only customer-visible updates.

## What is enforced where

| Rule | Where |
| --- | --- |
| who may open / read / reply in a client chat | `private.chat_access` (database); the API only passes the conversation id |
| who may read / reply to a ticket | `private.can_view_ticket`, `send_ticket_message` (database) |
| who may manage a ticket | `private.can_manage_ticket` and the four management functions (database) |
| who may take / release | `chat_set_handling`, `ticket_set_handling` (database) |
| what an unauthorised caller gets | not found (`P0001 NOT_FOUND`) or forbidden (`42501`, HTTP 403 through the API); anonymous callers have no execute right |
| who the author is | the signed-in user (`auth.uid()` / `private.my_id()`), never a value from the request |

## Tests

`supabase/tests/shared_client_support_access_test.sql` (80 checks): the RM works as before; a colleague opens, reads and replies with their own identity and label; the RM, Team Lead
and members are unchanged; the handler is recorded and shown to the RM and not to the client; one bell per run and none for the wrong people; take over / release rules and audit;
a Sales member, another department's Support member, a suspended colleague, the switch off, a client and an anonymous caller are all refused; the Department Head cannot write;
ticket tables stay narrow; the desk shows the ticket without management rights; reply and internal note by a colleague; the internal note is absent from every client function;
status, priority, escalate and assign are refused for a colleague while the Team Lead and the RM still manage; the RM → Team Lead escalation still works with the colleague's reply kept.

Existing tests that assumed "no colleague may read this" (`chat_test.sql`, `tickets_test.sql`) now check the same rule with the desk switch off, so the strict mode is still tested.

## Limits and notes

* "Authorised" is defined as the Support team of the customer's department (the CRM's existing Support desk rule). A narrower or wider group (for example a named backup per RM) would be
  a new rule; say so and it can be added in `private.shared_support_ok` without touching anything else.
* The desk does not receive live pushes for tickets it does not own (Realtime follows the table policies, which stay narrow): the Support desk tab refreshes when the tab comes back
  into view and after an action; the bell covers the assignee and the handler.
* Shared tickets are loaded as the 300 most recently updated (and at most 3000 updates); older ones are found by the customer's own ticket list.
* After running the migration nothing has to be done in the dashboards: the tabs appear for Support employees when the desk has something to show.
