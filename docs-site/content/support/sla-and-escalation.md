---
title: Ticket SLA Deadlines and Hierarchical Escalation
description: Understanding response time limits, automatic overdue escalation, and manual handoffs to Team Leads.
order: 30
roles: [Support Team Member, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [docs/TICKET_HIERARCHY.md, shared/contracts.ts]
related: [support/ticket-inbox-and-chat, department-head/configuring-ticket-slas]
updated: 2026-10-19
---

To ensure high service quality, Amuwa AI CRM enforces strict Service Level Agreements (SLA) with a 3-tier escalation hierarchy: Relationship Manager -> Team Lead -> Department Head.

## Before you start

:::prereq
- Understand the role tiers and who handles escalations in your department.
:::

## The 3-tier escalation hierarchy

```flow
Level 1: Relationship Manager | Support Member | Assigned customer representative
-> Exceeds SLA Window | Automatic Escalation | Overdue timer fires
Level 2: Team Lead | Team Lead | Pod leader takes over handling
-> Exceeds Second SLA | Automatic Escalation | Overdue timer fires
Level 3: Department Head | Department Head | Executive oversight & final resolution
```

| Escalation Level | Responsible Person | How It Is Triggered |
| --- | --- | --- |
| **Level 1 (RM)** | Relationship Manager (Assigned Support Member) | Assigned automatically when the client opens a ticket. |
| **Level 2 (TL)** | Support Team Lead | RM fails to reply within the SLA window, or manual escalation. |
| **Level 3 (DH)** | Department Head | Team Lead fails to reply within the TL SLA window, or manual escalation. |

## How the SLA clock works

- **When the clock runs**: The SLA countdown runs exclusively while the customer is waiting for a company response (when a ticket is first raised, or when the client sends a new message).
- **When the clock pauses**: The clock stops as soon as:
  - Staff sends a reply to the customer.
  - Ticket status is set to `WAITING_CUSTOMER`.
  - The ticket is marked `RESOLVED`.
- **Default SLA duration**: 24 hours per level (customizable by Department Heads).

## Automatic vs manual escalation

### 1. Automatic escalation (`escalate_overdue_tickets`)
- The CRM runs an automated database job every 5 minutes.
- When an open ticket exceeds the response deadline, it is automatically escalated to Level 2 (Team Lead).
- If the Team Lead does not respond within their window, it escalates to Level 3 (Department Head).
- The ticket card displays a red **Overdue** pill and the time elapsed.

### 2. Manual escalation
If a technical issue requires senior assistance or management intervention:
1. In the ticket details header, click **Escalate**.
2. Select the target level (Team Lead or Department Head).
3. Enter a mandatory **Escalation Reason** (e.g. *Requires Meta Partner Support escalation for business verification reject*).
4. Click **Confirm Escalation**.

## What you should see

:::result
An amber escalation banner appears across the top of the ticket. The Relationship Manager remains attached to the ticket, while the `escalated_to` field points to the Team Lead or Department Head.
:::

## Good to know

:::note Audit Trail Preservation
Every manual or automated escalation is written to `support_ticket_escalations` and the system audit log, tracking exact timestamps and reasons.
:::

## If something goes wrong

If an escalated ticket needs to be reassigned, the Team Lead can click **Reassign** to distribute it to another active support member.
