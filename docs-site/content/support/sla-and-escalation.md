---
title: Ticket SLA Deadlines and 3-Tier Escalation
description: Understanding response time limits, automatic overdue escalation, and manual ticket handoffs across Relationship Managers, Support Team Leads, and Department Heads.
order: 3
group: Support Operations
roles: [Support Team Member, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [docs/TICKET_HIERARCHY.md, src/components/support-member/TicketsPage.tsx, shared/contracts.ts]
related: [support/ticket-inbox-and-chat, department-head/configuring-ticket-slas]
updated: 2026-10-27
---

To guarantee responsive client care, Amuwa AI CRM enforces Service Level Agreement (SLA) response windows across a 3-tier escalation hierarchy inside **Client tickets**: **Level 1 (Relationship Manager) -> Level 2 (Support Team Lead) -> Level 3 (Department Head)**.

## Before you start

:::prereq
- Sign in to the Support Dashboard and open **Client tickets** (`Tickets`) from the sidebar (`Overview`, `My Leads`, `Team Leads`, `Import Customers`, `Client tickets`, `Client calendar`, `Client documents`, `My Tasks` / `Assigned Tasks`, `Leave Request`, `Chat`, `My Profile`).
:::

## The 3-tier escalation hierarchy

```flow
Level 1: Relationship Manager | Support Team Member | Assigned automatically when client raises a ticket
-> Exceeds Level 1 SLA Window | Automatic Escalation | Ticket escalates to Level 2
Level 2: Support Team Lead | Support Team Lead | Pod leader alerted in Client tickets > Escalated tab
-> Exceeds Level 2 SLA Window | Automatic Escalation | Ticket escalates to Level 3
Level 3: Department Head | Department Head | Executive oversight & final resolution
```

| Escalation Level | Responsible Role | How It Is Triggered |
| --- | --- | --- |
| **Level 1 (RM)** | Relationship Manager (`Support Team Member`) | Assigned automatically when the client submits a new ticket. |
| **Level 2 (TL)** | `Support Team Lead` | RM does not reply before the Level 1 SLA deadline expires, or RM clicks **Escalate**. |
| **Level 3 (DH)** | `Department Head` | Team Lead does not reply before the Level 2 SLA deadline expires, or manual escalation. |

## How the SLA clock operates

- **When the SLA clock runs**: The countdown timer runs whenever the customer is waiting for an official company response (when a new ticket is opened or after a client sends a follow-up message).
- **When the SLA clock pauses**: The countdown stops immediately when:
  - A staff member sends a public **Reply to Client** (internal notes do *not* stop the client SLA timer).
  - The ticket status is changed to `WAITING_CUSTOMER`.
  - The ticket status is marked `RESOLVED` or `CLOSED`.
- **Configurable SLA windows**: Default response windows (typically 24 hours per tier) can be customized per department by the Department Head.

## Automatic vs manual escalation

### 1. Automatic overdue escalation (`escalate_overdue_tickets`)
- A scheduled background job evaluates open tickets every 5 minutes.
- When an unanswered ticket passes its current tier's deadline, it automatically escalates to the next tier (`Level 2` Support Team Lead, then `Level 3` Department Head) and displays a red **Overdue** badge in **Client tickets**.

### 2. Manual escalation by staff
When a ticket requires senior technical intervention, billing authorization, or management escalation:
1. Open the ticket in **Client tickets**.
2. Click **Escalate** in the top-right ticket header.
3. Choose the target tier (**Support Team Lead** or **Department Head**).
4. Enter a clear **Escalation Reason** (for example, *Requires Meta Partner Portal escalation for WABA display name appeal*).
5. Click **Confirm Escalation**.

## What you should see

:::result
Escalated tickets display an amber escalation banner at the top of the conversation thread and appear under the **Escalated** tab in **Client tickets**. Both the new escalation owner and the original Relationship Manager receive real-time notifications.
:::

## Good to know

:::note Complete Escalation Audit Trail
Every automatic and manual escalation is permanently logged in `support_ticket_escalations` and `audit_logs` with the timestamp, previous level, new level, and escalation reason.
:::

## If something goes wrong

- **Need to transfer an escalated ticket to another RM**: A **Support Team Lead** or **Department Head** can click **Reassign** in the ticket header to assign the ticket to an available Support Team Member.
