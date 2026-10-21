---
title: Managing the Ticket Inbox and Chatting with Clients
description: Handling support tickets, using real-time chat, sending internal notes, and updating ticket statuses.
order: 20
roles: [Support Team Member, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [docs/TICKET_HIERARCHY.md, shared/contracts.ts]
related: [support/sla-and-escalation, client/raising-support-tickets]
updated: 2026-10-19
---

Amuwa AI CRM features a unified, real-time ticket inbox designed to facilitate fast communication between customers and their assigned Relationship Managers.

## Before you start

:::prereq
- You must be signed in with a Support Team Member, Team Lead, or Department Head account.
:::

## Interface layout

The Tickets workspace uses a two-panel split:
- **Left Panel (Ticket Inbox)**: Lists all tickets with live unread indicators, SLA status badges, customer names, subject lines, and preview snippets.
- **Right Panel (Conversation & Details)**: The active chat thread with message history, internal notes, resolution actions, and customer metadata.

### Inbox tabs
- **All open**: All unresolved tickets across your permitted scope.
- **My tickets**: Tickets currently assigned to you as the Relationship Manager or escalated to you.
- **Unread**: Tickets with unread customer replies.
- **In progress**: Tickets actively being investigated.
- **Escalated**: Tickets that exceeded initial response thresholds or were manually escalated.
- **Resolved / Closed**: Historical completed tickets.

## How to reply to a ticket

1. Click a ticket from the inbox list. Ticket numbers follow the format `#AMW-0042`.
2. Review the customer's message and timeline events.
3. In the message box at the bottom, choose your message type:
   - **Reply to Client**: Sent directly to the customer's dashboard and mobile notifications.
   - **Internal Note**: Yellow background; visible only to company staff and hidden from the customer.
4. Type your message and press **Send** (or press `kbd:Enter`).
5. To send a file, click the paperclip next to the message box. You can attach up to 5 files per message, 5 MB each (images, PDF, text, CSV, Word or Excel). Files sent with an **Internal Note** are never shown to the customer. Click a file in the thread to open it; every file you attach or open is recorded in the audit log.

```flow
Customer Sends Message | Client Portal | Displays on left in chat thread
Relationship Manager Notified | Realtime | Bell alert & unread marker triggered
Staff Types Reply | Support Member | Choose "Reply to Client" or "Internal Note"
Message Delivered | System | Realtime sync to client; Sent/Seen ticks update
```

## Changing ticket status and priority

In the right header above the chat thread:
- **Priority dropdown**: Change between `Low`, `Medium`, `High`, or `Urgent`. Each change is logged as an internal event.
- **Status dropdown**:
  - `OPEN`: Initial received state.
  - `IN_PROGRESS`: Actively under technical investigation.
  - `WAITING_CUSTOMER`: Staff has replied; SLA timer pauses while waiting on the client.
  - `RESOLVED`: Issue fixed. A resolution note is recorded.
  - `CLOSED`: Final administrative closure.

## What you should see

:::result
Sent replies appear immediately on the right with a blue bubble and author stamp. When the client opens your reply on their dashboard, the tick mark updates to **Seen**.
:::

## Good to know

:::important Internal Notes are Strictly Private
Internal staff notes are permanently isolated from the customer API. Clients cannot view internal notes even via browser inspection or network traces.
:::

:::tip Customer Re-opening
If a client replies to a ticket in `RESOLVED` status, the ticket is automatically reopened, reset to `IN_PROGRESS`, and triggers an immediate high-priority alert to the Relationship Manager.
:::

## If something goes wrong

If a message fails to send, check your network connection and click the **Retry** icon next to the failed bubble.
