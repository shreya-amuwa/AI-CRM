---
title: Managing the Client Tickets Inbox and Real-Time Chat
description: Handling client tickets in the Support Dashboard, sending public replies and private internal notes, attaching files, and updating ticket statuses.
order: 2
group: Support Operations
roles: [Support Team Member, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [src/components/support-member/TicketsPage.tsx, src/components/support-member/SupportMemberDashboard.tsx, docs/TICKET_HIERARCHY.md]
related: [support/sla-and-escalation, support/support-leads-management, client/raising-support-tickets]
updated: 2026-10-27
---

Amuwa AI CRM features a unified, real-time **Client tickets** workspace designed for fast, transparent communication between external clients and their assigned Relationship Managers.

## Before you start

:::prereq
- Sign in with a **Support Team Member**, **Support Team Lead**, or **Department Head** account.
- Open **Client tickets** (`Tickets`) from the Support Dashboard sidebar (`Overview`, `My Leads`, `Team Leads`, `Import Customers`, `Client tickets`, `Client calendar`, `Client documents`, `My Tasks` / `Assigned Tasks`, `Leave Request`, `Chat`, `My Profile`).
:::

## Interface layout

The **Client tickets** workspace uses a two-panel split view:
- **Left Panel (Ticket Inbox)**: Lists tickets with unread badges, SLA countdown pills, customer names, ticket numbers (`#AMW-0042`), subject lines, and latest message snippets.
- **Right Panel (Conversation & Details)**: Displays the live message thread, internal staff notes, status/priority controls, escalation actions, and customer metadata.

### Inbox filter tabs
- **All open**: All unresolved tickets within your permitted team or department scope.
- **My tickets**: Tickets assigned directly to you as the Relationship Manager or escalated to you.
- **Unread**: Tickets with unread client replies.
- **In progress**: Tickets actively under technical or operational investigation.
- **Escalated**: Tickets that breached an SLA window or were manually escalated to a Team Lead or Department Head.
- **Resolved / Closed**: Completed historical tickets.

## How to reply to a client ticket

1. In the sidebar, click **Client tickets** (`Tickets`) and select a ticket from the inbox list.
2. Review the customer's inquiry, attached screenshots, and timeline events.
3. In the composer at the bottom of the thread, select your message mode:
   - **Reply to Client**: Visible immediately on the client's portal dashboard and triggers a client notification.
   - **Internal Note**: Highlighted in amber; visible strictly to internal staff (`Support`, `Team Lead`, `Department Head`) and never exposed to the client.
4. Type your response and click **Send** (or press `kbd:Enter`).
5. To attach files, click the paperclip icon next to the composer (up to 5 files per message, max **5 MB** each; supports images, PDF, CSV, TXT, Word, and Excel). Files attached to an **Internal Note** remain private to staff.

```flow
Client Opens or Replies to Ticket | Client Portal | Appears in Support > Client tickets with SLA timer running
Relationship Manager Notified | Realtime | Bell alert & unread indicator displayed
Staff Sends Reply or Internal Note | Support Member | Public reply pauses SLA clock; Internal Note stays staff-only
Issue Fixed & Marked Resolved | Support Member | Status updated to RESOLVED with resolution summary
```

## Updating ticket priority and status

In the ticket header above the conversation thread:
- **Priority selector**: Switch between `Low`, `Medium`, `High`, and `Urgent`.
- **Status selector**:
  - `OPEN`: Newly created ticket awaiting first response.
  - `IN_PROGRESS`: Actively being investigated by Support or Delivery.
  - `WAITING_CUSTOMER`: Staff has replied and is waiting on client input (pauses the SLA timer).
  - `RESOLVED`: Issue is resolved and a resolution summary is recorded.
  - `CLOSED`: Final administrative closure.

## What you should see

:::result
Public replies render immediately on the right side of the thread and sync in real time to the client's portal with **Sent / Seen** read indicators. Answering the client automatically stops the active SLA countdown timer.
:::

## Good to know

:::important Strict Isolation of Internal Notes
Internal notes and their file attachments are filtered out at the API level—clients can never view internal staff discussions even via browser network inspection.
:::

:::tip Automatic Re-Opening on Client Reply
If a client replies to a ticket currently marked `RESOLVED`, the system automatically reopens the ticket to `IN_PROGRESS`, restarts the SLA clock, and alerts the assigned Relationship Manager.
:::

## If something goes wrong

- **Attachment upload rejected**: Verify each file is **5 MB or smaller** and uses a supported format (PNG, JPG, PDF, TXT, CSV, DOCX, XLSX).
