---
title: Department Head Workspace, KPIs, and Operational Oversight
description: Navigate the 12 sidebar tabs of the Department Head Dashboard, monitor departmental KPIs, manage pipeline progression, and oversee service delivery across teams.
order: 1
group: Role Workspaces
roles: [Department Head, Super Admin]
audience: internal
status: verified
sources: [src/components/Workspaces/DepartmentHeadDashboard.tsx, src/components/ScopeBar.tsx, src/types/crm.ts]
related: [department-head/passing-handovers-to-team-lead, department-head/sales-department-head-guide, department-head/shared-and-combined-scopes]
updated: 2026-10-27
---

In Amuwa AI CRM, the **Department Head** (`role = 'DEPARTMENT_HEAD'`) leads operational execution across an assigned business unit or division (such as Wabastore, Support, Design Studio, Digitree, Dtalk, or Wabatalk). Depending on their assigned `headDivision` (`BOTH`, `SUPPORT`, or `SALES`), Department Heads oversee incoming handovers, team assignments, pipeline conversion, support SLAs, and staff leave requests.

## Before you start

:::prereq
- Sign in with an active **Department Head** account at `/department-head/dashboard/:userId` (or `/sales-head/dashboard/:userId` when configured with `headDivision = 'SALES'`).
- If you manage two or more departments via `user_department_scopes`, select your target department or **Combined** roll-up view in the session scope selector or top **ScopeBar**.
:::

## Sidebar navigation tabs

The **Department Head Dashboard** (`DepartmentHeadDashboard.tsx`) provides 12 dedicated sidebar tabs organized around departmental operations, team governance, and personal collaboration:

| Sidebar Tab | Purpose & Key Actions |
| --- | --- |
| **Overview** | Executive KPI summary cards, active customer distribution, revenue metrics, pending handovers, and urgent SLA alerts. |
| **Teams & People** | View and manage departmental squads, assign Team Leads (`TEAM_HEAD`) and Team Members (`TEAM_MEMBER`), and balance active caseloads. |
| **Performance** | Inspect staff scorecards across date presets (`All time`, `This month`, `Last 30 days`, `Last 7 days`, `Custom`), conversion rates, and call/task metrics. |
| **Pipeline** | Audit every lead and potential customer currently progressing through your department's acquisition and qualification stages. |
| **Onboarding** | Monitor customers in the `ONBOARDING` stage, inspect document verification checklists, and coordinate with Technical Consultants. |
| **Handovers** | Review verified customer accounts transferred from Technical Consultants or Sales (`handoverStage = 'DEPARTMENT_HEAD'`) and assign them to Team Leads. |
| **Client Services** | Track active recurring and one-time services, inspect delivery milestones, and review add-on service requests submitted for existing customers. |
| **Tickets** | Supervise department-wide support tickets, filter by SLA breach status, post `#INTERNAL_NOTE` directives, and reassign escalated cases. |
| **Work Tasks** | Assign operational tasks to Team Leads and Team Members, set priority deadlines, and verify task completion. |
| **Leave Request** | Review first-stage staff leave applications (`PENDING_DEPARTMENT_HEAD`) and submit your own personal leave requests. |
| **Chat** | Communicate in real time across `Direct` messages, internal `Channels`, and read-only `Clients` conversation audits. |
| **My Profile** | View your employment profile, assigned department scopes, division configuration, and account security settings. |

## End-to-end departmental workflow

```flow
Monitor KPIs & Pipeline | Department Head | Overview & Pipeline tabs
Inspect Onboarding & Handovers | Department Head | Onboarding & Handovers tabs
Route Verified Client to Team Lead | Department Head | Handovers > Pass to Team Lead
-> Team Lead overloaded | Reassign client or rebalance squad in Teams & People
Supervise Delivery, Add-Ons & SLAs | Department Head | Client Services, Tickets & Performance tabs
```

## Steps: Daily operational review

1. Open **Overview** to check the top KPI cards: **Incoming Handovers to Assign**, **Active Customers in Delivery**, **Open / Escalated Tickets**, and **Pending Leave Approvals**.
2. If you oversee multiple departments, verify the active scope pill in the top **ScopeBar**. Switch from **Combined** mode to a specific department pill whenever you need to perform write actions such as assigning a Team Lead.
3. Click **Handovers** to allocate newly verified accounts waiting in the **To assign** queue to an available Team Lead.
4. Open **Client Services** to inspect active customer service subscriptions and review pending add-on service requests.
5. Check **Tickets** and **Work Tasks** to clear operational blockers and ensure SLA compliance across all squads.

## What you should see

:::result
Each sidebar tab updates in real time via Supabase Realtime. Unread chat counters, pending handover badges, and escalated ticket indicators appear directly beside their respective sidebar labels.
:::

## Good to know

:::note Division-Specific Routing
Department Heads configured with `headDivision = 'SALES'` are automatically routed to the specialized **Sales Department Head** workspace (`/sales-head/dashboard/:userId`), which adds **Lead Assign**, **Telecallers**, and **Business Associates** tabs. See [Sales Department Head Guide](/department-head/sales-department-head-guide).
:::

:::tip Multi-Department Roll-Ups
When viewing the **Combined** scope across multiple assigned departments, KPI cards and tables aggregate data across all your departments in read-only mode. Select a single department pill in the **ScopeBar** to unlock assignment and approval buttons.
:::

## If something goes wrong

- **Assignment buttons are disabled**: Check the top **ScopeBar**; if **Combined** mode is active, click a specific department pill to enable write actions.
- **Missing records or squads**: See [Missing Records and Permissions](/troubleshooting/missing-records-and-permissions).
