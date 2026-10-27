---
title: Handling Ticket Escalations, SLAs, and Delivery Blockers
description: Supervise the 3-tier SLA escalation hierarchy in the Tickets tab, post internal staff directives, reassign breached tickets, and resolve departmental blockers.
order: 4
group: Support & Escalations
roles: [Department Head, Support Team Lead, Super Admin]
audience: internal
status: verified
sources: [src/components/Workspaces/DepartmentHeadDashboard.tsx, src/components/tickets/TicketWorkspace.tsx, server/slaMonitor.ts]
related: [department-head/department-head-overview, support/sla-and-escalation, support/ticket-inbox-and-chat]
updated: 2026-10-27
---

Prompt resolution of customer issues and onboarding blockers is critical to client retention. Amuwa AI CRM runs an automated Service Level Agreement (SLA) monitor that tracks response clocks across all open tickets and escalates unresolved issues through a 3-tier hierarchy to the **Department Head**.

## Before you start

:::prereq
- Sign in as an authorized **Department Head** (`DepartmentHeadDashboard.tsx`) and open the **Tickets** tab in the left sidebar.
- To perform reassignments or post internal directives, select a specific department in the top **ScopeBar** rather than the read-only **Combined** view.
:::

## The 3-tier SLA escalation ladder

The background SLA monitor evaluates tickets in `OPEN`, `WAITING_ON_US`, and `IN_PROGRESS` states every 5 minutes against the department's target SLA window:

```flow
Tier 1: Frontline Assignee | Team Member / Relationship Manager | Initial ticket created by client or staff
Tier 2: Squad Escalation | Team Lead | Triggered when SLA clock passes 80% without response
Tier 3: Executive Escalation | Department Head | Triggered at 100% SLA breach (status = ESCALATED)
Department Head Intervention | Department Head | Post #INTERNAL_NOTE, reassign owner, or reply directly
```

## Steps: Resolving escalated tickets and blockers

1. In the **Department Head Dashboard** sidebar, click **Tickets**.
2. Filter the queue using the status tabs at the top of the ticket inbox:
   - **Escalated**: Tickets that have breached their SLA response window and require immediate leadership action.
   - **Open / Waiting on Us**: Active client inquiries awaiting a staff response.
   - **In Progress / Resolved**: Ongoing or completed support threads.
3. Click an escalated ticket to open the two-panel ticket workspace:
   - **Left Panel**: Customer details, active services, SLA countdown/breach timer, priority badge, and current assignee.
   - **Right Panel**: Full chronological message thread between the client and internal staff, including yellow **Internal Notes**.
4. Take one or more intervention actions:
   - **Post an Internal Directive (`#INTERNAL_NOTE`)**: Switch the composer mode to **Internal Note** to write instructions visible only to staff (for example, directing an engineer to check a WABA webhook or invoice ledger).
   - **Reassign the Ticket**: Use the **Reassign** selector in the ticket details panel to transfer ownership to a senior Team Member or Team Lead when the current assignee is unavailable or blocked.
   - **Send an Authoritative Client Reply**: Reply directly to the customer thread to confirm priority handling and next steps.
5. If the ticket reveals a broader delivery or onboarding blocker, open **Work Tasks** from the sidebar to assign a tracked remediation task with a due date to the responsible Team Lead.

## Standard departmental SLA benchmarks

| Issue Category | Standard SLA Window | Critical / Urgent SLA |
| --- | --- | --- |
| **WhatsApp Business API / Wabastore Outages** | 2 Hours | 30 Minutes |
| **Technical Onboarding & Verification Queries** | 8 Hours | 2 Hours |
| **Billing, Tax & Invoice Inquiries** | 24 Hours | 4 Hours |
| **Creative & Campaign Revisions (Design Studio / Digitree)** | 24 Hours | 8 Hours |

## What you should see

:::result
Once a staff reply is sent or the ticket status is updated to **In Progress** / **Resolved**, the SLA breach indicator clears and the intervention is logged in the ticket audit trail.
:::

## Good to know

:::important Internal Notes Are Staff-Only
Messages posted as **Internal Notes** (`#INTERNAL_NOTE`) are highlighted in amber for internal team members and are never exposed to the customer in the Client Portal.
:::

## If something goes wrong

- **Cannot reply or reassign**: Ensure your top **ScopeBar** is set to a single department rather than **Combined** roll-up mode.
- **Customer cannot see ticket updates**: Verify that the customer's Client Portal login has been provisioned (see [Provisioning Client Login](/technical-consultant/provisioning-client-login)).
