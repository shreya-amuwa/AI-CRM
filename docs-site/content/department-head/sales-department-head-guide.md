---
title: Sales Department Head Workspace and Lead Assign Guide
description: Complete guide to the Sales Department Head dashboard, including the 12 sidebar tabs, Telecaller .xlsx sheet uploads, Business Associate pipelines, and conversion tracking.
order: 6
group: Role Workspaces
roles: [Department Head, Sales Team Lead, Super Admin]
audience: internal
status: verified
sources: [src/components/Workspaces/SalesHeadDashboard.tsx, src/components/salesHead/LeadAssign.tsx, src/components/ScopeBar.tsx]
related: [department-head/department-head-overview, department-head/shared-and-combined-scopes, department-head/performance-and-work-tasks]
updated: 2026-10-27
---

A Department Head configured with `role = 'DEPARTMENT_HEAD'` and `headDivision = 'SALES'` is routed to the dedicated **Sales Department Head Workspace** at `/sales-head/dashboard/:userId` (`src/components/Workspaces/SalesHeadDashboard.tsx`). This workspace combines multi-department executive visibility with specialized tools for uploading Telecaller calling sheets, monitoring Business Associate (BA) pipelines, and supervising customer onboarding.

## Before you start

:::prereq
- Your account must be configured with `role = 'DEPARTMENT_HEAD'` and `headDivision = 'SALES'` (or you must be signed in as a **Super Admin** inspecting the Sales division).
- To upload a calling sheet or assign records, select a single department pill in the top **ScopeBar** rather than the read-only **Combined** roll-up view.
:::

## Sidebar navigation tabs

The **Sales Department Head Dashboard** (`SalesHeadDashboard.tsx`) exposes 12 specialized sidebar tabs:

| Sidebar Tab | Purpose & Key Features |
| --- | --- |
| **Overview** | Real-time Sales division KPIs, lead funnel metrics, Telecaller-to-BA handoff velocity, and revenue summaries across your active scope. |
| **Lead Assign** | Upload `.xlsx` calling sheets (`LeadAssign.tsx`), assign them to specific Telecallers, track per-sheet call disposition progress bars, and delete finished sheets. |
| **Telecallers** | Monitor every Telecaller (`salesSubRole = 'TELECALLER'`), their assigned calling sheets, call connection volumes, and leads marked `Ready to Buy` / `Sent to BA`. |
| **Business Associates** | Supervise Business Associates (`salesSubRole = 'BUSINESS_ASSOCIATE'`), inspect their `LEAD`, `POTENTIAL`, and `ONBOARDING` queues, and review deal closures. |
| **Teams & People** | Manage Sales squads, Team Leads (`TEAM_HEAD`), Telecallers, and Business Associates within the active department. |
| **Performance** | Compare individual and squad conversion scorecards across configurable date presets (`All time`, `This month`, `Last 30 days`, `Last 7 days`, `Custom`). |
| **Pipeline** | Full-funnel visibility into all leads, agreed deal amounts, selected services, and follow-up schedules. |
| **Onboarding** | Track customers sent to Accounts and Technical Consultants as they complete payment verification and onboarding checklists. |
| **Work Tasks** | Create, assign, and review operational tasks across Sales Team Leads, Telecallers, and Business Associates. |
| **Leave Request** | Approve or reject first-stage leave requests from Sales staff (`PENDING_DEPARTMENT_HEAD`) or apply for personal leave. |
| **Chat** | Collaborate via internal `Direct` messages and group `Channels`, or audit customer threads in read-only mode. |
| **My Profile** | Inspect your profile details, assigned department scopes, and account security settings. |

## Lead Assign (Telecaller sheet upload) workflow

The **Lead Assign** module (`src/components/salesHead/LeadAssign.tsx`) streamlines bulk cold-calling operations by letting the Sales Department Head upload structured Excel sheets directly into a Telecaller's workspace:

```flow
Prepare .xlsx Spreadsheet | Sales Department Head | Up to 700 KB and 2,000 rows (.xls rejected)
Select Telecaller & Sheet Label | Sales Department Head | Lead Assign tab > Upload form
Upload & Parse Rows | System Parser | Validates columns and assigns rows to target Telecaller
-> File is .xls or exceeds 700 KB / 2,000 rows | Upload rejected with prompt to save as .xlsx or split rows
Telecaller Works Calling Sheet | Telecaller | Marks rows Called, Interested, Ready to Buy, Sent to BA
Review Progress & Clean Up | Sales Department Head | Track progress bars or delete completed sheets
```

## Steps: Uploading a Telecaller sheet in Lead Assign

1. In the **Sales Department Head Dashboard**, make sure a single target department (such as **Wabastore**, **Whatsbox**, **Dtalk**, **Digitree**, or **Mpillar**) is selected in the top **ScopeBar**.
2. Click **Lead Assign** in the left sidebar.
3. Prepare your spreadsheet in modern Excel **`.xlsx`** format:
   - **Maximum file size**: **700 KB**.
   - **Maximum row count**: **2,000 rows** per sheet.
   - Legacy `.xls` binary files are strictly rejected with a clear prompt instructing you to re-save the workbook as `.xlsx` in Excel or Google Sheets.
4. In the **Upload Calling Sheet** card:
   - **Select Telecaller**: Choose the target Telecaller (`salesSubRole = 'TELECALLER'`) from the dropdown list.
   - **Sheet Label**: Enter a descriptive campaign or batch name (for example, `Mumbai Retail Retailers - Oct Batch 1`).
   - **Choose File**: Select your `.xlsx` file.
5. Click **Upload & Assign Sheet**.
6. Once uploaded, monitor real-time execution in the **Assigned Sheets** list. Each sheet displays a live breakdown of row statuses and progress bars:
   - **Total**: Total prospect rows imported in the sheet.
   - **Called**: Rows where the Telecaller has logged an outreach attempt.
   - **Interested**: Prospects expressing initial interest and scheduled for follow-up.
   - **Ready to Buy**: Qualified prospects ready for commercial proposal.
   - **Sent to BA**: Prospects converted and handed off into a Business Associate's CRM pipeline.
7. When a campaign batch is completed or obsolete, click the **Delete** action on the sheet card and confirm removal to keep the Telecaller's queue clean.

## What you should see

:::result
After uploading a valid `.xlsx` sheet, the new batch card appears immediately in **Lead Assign** with `Total`, `Called`, `Interested`, `Ready to Buy`, and `Sent to BA` counters, and the selected Telecaller receives the rows in their dashboard queue.
:::

## Good to know

:::warning Legacy .xls Files and Size Limits
The parser only accepts `.xlsx` files up to **700 KB** and **2,000 rows**. If you attempt to upload an older `.xls` file or a file exceeding those limits, the upload is blocked immediately with a validation message so browser memory and database transactions stay fast and reliable.
:::

:::tip Tracking Telecaller-to-BA Handovers
Use the **Telecallers** and **Business Associates** tabs side by side to verify that every prospect marked **Sent to BA** is promptly contacted and moved to **Potential** by the receiving Business Associate.
:::

## If something goes wrong

- **Upload button is disabled**: Check the top **ScopeBar** and switch from **Combined** roll-up mode to the specific department where the Telecaller belongs.
- **No Telecallers appear in the dropdown**: Verify in **Teams & People** (or ask Super Admin in **Team Members**) that the staff member has `salesSubRole = 'TELECALLER'` assigned.
