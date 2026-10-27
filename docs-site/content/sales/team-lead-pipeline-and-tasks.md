---
title: Sales Team Lead Pipeline and Tasks Guide
description: Comprehensive guide for Sales Team Leads to switch between My Leads and Team Leads, filter by team member, bulk-import and assign leads, manage targets, and unblock stalled deals.
order: 11
group: Role Workspaces
roles: [Sales Team Lead, Department Head]
audience: internal
status: verified
sources: [src/components/team-lead/TeamLeadDashboard.tsx, src/components/team-lead/TeamCustomers.tsx, src/components/tasks/TeamLeadTasksView.tsx]
related: [sales/my-leads-overview, sales/managing-returned-leads, sales/telecaller-workspace-guide, sales/business-associate-workspace]
updated: 2026-10-27
---

The **Sales Team Lead Workspace** (`role = 'TEAM_LEAD'`, accessed at `/team-lead/dashboard/:userId`) gives pod leaders complete visibility and control over both their personal sales pipeline and their entire team's 4-stage pipeline, daily/weekly task targets, field visits, and onboarding bottlenecks.

## Before you start

:::prereq
- Sign in with a **Sales Team Lead** account assigned to a Sales team (`division = 'SALES'`).
:::

## Switching between `My Leads` and `Team Leads` (`Team Customers`)

A Sales Team Lead can both sell directly and supervise every member of their sales pod:

- **`My Leads` (Personal 4-Stage Pipeline)**:
  - Filters the pipeline (`1 Leads`, `2 Potential`, `3 Customer onboarding`, `4 Client`) strictly to records owned personally by you (`mine: true`).
- **`Team Leads` / `Team Customers` (Team-Wide 4-Stage Pipeline)**:
  - Displays every record across all Sales Team Members, Telecallers, and Business Associates in your team across all 4 stages (`1 Leads`, `2 Potential`, `3 Customer onboarding`, `4 Client`) plus **Part payments**.
  - Includes the **Team Member filter** dropdown so you can inspect a single salesperson's pipeline or view the combined pod queue.

```flow
Review Overview KPIs | Sales Team Lead | Checks team pipeline counts, overdue follow-ups & revenue
Open Team Leads / Team Customers | Sales Team Lead | Switches between My Leads and Team-wide 4-stage view
Import & Assign Leads | Sales Team Lead | Bulk CSV/Excel import or round-robin assignment to members
Assign Daily / Weekly Targets | Sales Team Lead | Assigned Tasks > sets call, demo, or revenue goals
Unblock Stalled Deals | Sales Team Lead | Resolves Returned from Accounts or Returned by Consultant items
```

## Filtering by team member and auditing stage progression

1. In the sidebar, click **Team Customers** (or **Team Leads**).
2. Choose any stage tab: **`1 Leads`**, **`2 Potential`**, **`3 Customer onboarding`**, or **`4 Client`**.
3. Use the **Owner / Team Member** dropdown to filter records belonging to a specific Sales Team Member or Business Associate.
4. Combine with the **Status / State** filter (for example, `Returned from Accounts` in `1 Leads` or `Returned by consultant` in `3 Customer onboarding`) to spot deals that require immediate coaching or intervention.

## Bulk lead import and assignment

To keep your team's pipeline stocked:
1. In **Team Customers > 1 Leads**, click **Import Leads (CSV / Excel)** to upload a prospect spreadsheet, or select multiple existing rows using the table checkboxes.
2. Choose how to distribute the leads:
   - **Assign to a specific member**: Route high-intent or territory-specific leads to a chosen salesperson or Business Associate.
   - **Round-Robin distribution**: Automatically distribute imported or unassigned leads evenly across all active team members.
3. To transfer a live deal when a team member is on leave, click **Reassign** on the customer row and pick the new owner.

## Assigning daily and weekly targets in `Assigned Tasks`

1. In the sidebar, click **Assigned Tasks** (`TeamLeadTasksView.tsx`).
2. Click **+ Assign Task** to create an operational task or daily/weekly target for any member of your team:
   - Select the **Assignee** (Sales Team Member, Telecaller, or Business Associate).
   - Enter the **Task Title & Instructions** (for example, *Complete 40 outbound calls from retail sheet* or *Collect pending All Important Documents PDF for Test Traders*).
   - Set the **Priority** (`Low`, `Medium`, `High`, `Urgent`) and **Due Date**.
3. Track real-time completion status (`TODO`, `IN_PROGRESS`, `COMPLETED`) across your team roster.

## Unblocking stalled onboarding and payment items

Sales Team Leads should check two high-priority queues daily:
- **Stalled Payment Confirmations (`Returned from Accounts`)**: Open any team deal returned by Accounts, verify the UTR or GST basis with the salesperson and client, and help resubmit **Confirm Payment**.
- **Stalled Onboarding Dossiers (`Returned by consultant` / `Waiting on client`)**: Open team records stuck in **3 Customer onboarding**, assist the salesperson in compiling the combined `2. All Important Documents` PDF or `3. Requirement Document`, and trigger **Send again to Technical Consultant**.

## What you should see

:::result
Your **Overview** panel (`ScopeOverviewPanel`) reflects live database counts for your team's pipeline stages, active tasks, and verified revenue, while any lead assignments or task updates appear immediately on the assigned team member's dashboard.
:::

## Good to know

:::tip Field Visits & Performance Oversight
Use **Field Visits** in the Team Lead sidebar to review GPS check-ins and shop-board OCR scans logged by your field sales reps, and open **Performance Management** to track individual conversion rates against targets.
:::

## If something goes wrong

- **A team member does not appear in the Owner filter**: Open **Team Members & Access** in the sidebar to verify that the staff member is assigned to your team and has an `ACTIVE` status.
