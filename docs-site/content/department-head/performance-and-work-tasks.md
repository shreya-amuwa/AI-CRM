---
title: Team Performance Scorecards and Work Tasks Management
description: Audit staff productivity in the Performance tab using date presets and role filters, and assign or track operational deliverables in the Work Tasks workspace.
order: 8
group: Team Management
roles: [Department Head, Sales Team Lead, Support Team Lead, Team Member]
audience: internal
status: verified
sources: [src/components/Workspaces/PerformancePanel.tsx, src/components/tasks/TasksWorkspace.tsx, src/components/Workspaces/DepartmentHeadDashboard.tsx, src/components/Workspaces/SalesHeadDashboard.tsx]
related: [department-head/department-head-overview, department-head/sales-department-head-guide, shared/requesting-leave]
updated: 2026-10-27
---

Both the **Department Head Dashboard** and the **Sales Department Head Dashboard** include two dedicated management modules in the left sidebar: **Performance** (`src/components/Workspaces/PerformancePanel.tsx`) for quantitative staff scorecards, and **Work Tasks** (`src/components/tasks/TasksWorkspace.tsx`) for assigning and tracking operational tasks across Team Leads and Team Members.

## Before you start

:::prereq
- Sign in as a **Department Head** (`DepartmentHeadDashboard.tsx` or `SalesHeadDashboard.tsx`) or **Team Lead**.
- In **Performance**, you can inspect either a single department or the **Combined (N)** roll-up across all your assigned departments. To create new tasks in **Work Tasks**, select the target department in the top **ScopeBar**.
:::

## Performance and task management flow

```flow
Select Date Preset & Filters | Department Head | Performance tab (All time, This month, Last 30/7 days, Custom)
Inspect Member Scorecards | Department Head | Compare leads, calls, conversions, revenue & tasks
Identify Coaching or Bottleneck Area | Department Head | Spot overdue follow-ups or low task completion
Assign Actionable Work Task | Department Head | Work Tasks tab > Assign to Team Lead or Team Member
Track Completion Status | Department Head & Assignee | PENDING -> IN_PROGRESS -> COMPLETED
```

## Auditing staff metrics in the Performance tab

The **Performance** panel (`PerformancePanel.tsx`) aggregates real-time productivity and revenue metrics for every staff member in your active scope:

### 1. Date range presets

Use the date filter bar at the top of the **Performance** workspace to switch the reporting window:
- **All time**: Cumulative historical performance since account activation.
- **This month**: Current calendar month from the 1st through today.
- **Last 30 days**: Rolling 30-day window for month-over-month comparisons.
- **Last 7 days**: Rolling 7-day sprint view for weekly standups.
- **Custom**: Pick exact **From** and **To** calendar dates for quarterly or campaign-specific audits.

### 2. Team and role filters

Narrow the scorecard table using the toolbar filters:
- **Team / Squad filter**: Isolate a specific Team Lead's squad or view the entire department.
- **Role / Sub-role filter**: Filter by `TEAM_HEAD`, `TEAM_MEMBER`, `TELECALLER`, `BUSINESS_ASSOCIATE`, or `Technical Consultant`.
- **Search input**: Filter immediately by employee name or email.

### 3. Member scorecard metrics

Each staff row in the scorecard displays role-appropriate performance indicators:
- **Leads Assigned & Active Pipeline**: Number of prospects currently owned by the member across `LEAD`, `POTENTIAL`, and `ONBOARDING`.
- **Calls & Conversations Logged**: Total outreach attempts, Telecaller sheet dispositions, and recorded consultation notes within the selected date window.
- **Conversions & Deal Closures**: Number of leads converted to paying customers (`CUSTOMER`) or handed off (`Sent to BA`).
- **Attributed Revenue**: Verified payment volume credited to the staff member or squad.
- **Task Completion Rate**: Completed vs. open/overdue operational tasks assigned in **Work Tasks**.

## Assigning and reviewing Work Tasks

The **Work Tasks** tab (`src/components/tasks/TasksWorkspace.tsx`) allows Department Heads and Team Leads to delegate structured action items and track execution:

1. Click **Work Tasks** in the left sidebar.
2. Click **New Task** (or **Assign Task**) to open the task creation dialog:
   - **Task Title**: Concise summary of the deliverable (for example, *"Complete Meta WABA verification audit for Oct batch"*).
   - **Description / Instructions**: Detailed steps, links to customer codes, or acceptance criteria.
   - **Assignee**: Choose a **Team Lead** (`TEAM_HEAD`) or **Team Member** (`TEAM_MEMBER`) in your department.
   - **Priority**: Select `LOW`, `MEDIUM`, `HIGH`, or `URGENT`.
   - **Due Date**: Set the target completion date.
3. Click **Create Task**. The assignee receives an instant notification and sees the task under their **My Tasks / Work Tasks** tab.
4. Monitor progress across the task status filters:
   - **To Do / Pending**: Assigned tasks awaiting start.
   - **In Progress**: Tasks actively being worked on by the assignee.
   - **Completed**: Finished tasks with completion timestamps and assignee remarks.
   - **Overdue**: Tasks past their due date requiring follow-up.

## What you should see

:::result
Updating the date preset in **Performance** recalculates all member scorecards and summary totals immediately. Creating or updating a task in **Work Tasks** syncs live to the assignee's workspace.
:::

## Good to know

:::tip Weekly Squad Reviews
Combine the **Last 7 days** preset in **Performance** with the **Overdue** filter in **Work Tasks** during weekly review meetings with your Team Leads to spot bottlenecks early.
:::

## If something goes wrong

- **Revenue figure shows zero on a closed deal**: Remember that revenue scorecards count only payments marked `VERIFIED` by the Accounts Department.
- **Assignee is missing from the New Task dropdown**: Confirm that you have selected their department in the top **ScopeBar** and that their account is active in **Teams & People**.
