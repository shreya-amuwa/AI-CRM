---
title: Reviewing Leave Requests and Departmental Service Add-Ons
description: Approve or reject first-stage staff leave applications in the Leave Request tab and review customer service subscriptions and add-on requests in Client Services.
order: 3
group: Team Management
roles: [Department Head, HR Manager, Team Lead, Team Member]
audience: internal
status: verified
sources: [src/components/Workspaces/DepartmentHeadDashboard.tsx, src/components/leave/LeaveWorkspace.tsx, src/components/Workspaces/ClientServicesPanel.tsx]
related: [department-head/department-head-overview, shared/requesting-leave, hr/leave-approval-hr]
updated: 2026-10-27
---

Department Heads govern both internal squad availability and active customer service portfolios. From the sidebar of `DepartmentHeadDashboard.tsx`, you use **Leave Request** to perform first-stage operational reviews on employee time-off applications and **Client Services** to supervise active service deliveries and customer add-on requests.

## Before you start

:::prereq
- You must be signed in as an authorized **Department Head**.
- Staff leave applications must be submitted by a Team Lead or Team Member in your department and carry the status `PENDING_DEPARTMENT_HEAD`.
:::

## Two-tier leave approval workflow

```flow
Employee Submits Leave Request | Team Member / Team Lead | Leave Request tab -> PENDING_DEPARTMENT_HEAD
Stage 1 Operational Review | Department Head | Checks squad coverage and delivery deadlines
-> Operational conflict | Reject with mandatory reason -> REJECTED_BY_DEPARTMENT_HEAD
Stage 2 Final HR Signoff | HR Manager | Advances to PENDING_HR -> APPROVED (attendance synced)
```

## Steps: Approving or rejecting departmental leave requests

1. In the **Department Head Dashboard** sidebar, click **Leave Request**.
2. Locate the **Department Leave Requests** queue showing applications submitted by your Team Leads and Team Members. Requests awaiting your decision display the **Pending Department Head Approval** (`PENDING_DEPARTMENT_HEAD`) badge.
3. Click an application row to review:
   - **Employee Name & Role**: The staff member requesting leave and their squad assignment.
   - **Leave Type**: `CASUAL`, `SICK`, `EARNED`, `UNPAID`, or `EMERGENCY`.
   - **Start Date & End Date**: Requested dates and total day count.
   - **Reason**: The employee's submitted explanation.
4. Verify team coverage in **Teams & People** and upcoming deadlines in **Work Tasks** and **Handovers**.
5. To approve the request:
   - Click **Approve**, add an optional operational note (for example, who is covering active accounts), and confirm.
   - The status updates to `PENDING_HR` and routes automatically to the HR Department for final approval.
6. To reject the request:
   - Click **Reject**, enter a mandatory explanation describing the scheduling conflict, and confirm.
   - The status transitions to `REJECTED_BY_DEPARTMENT_HEAD` and notifies the employee immediately.

## Reviewing active subscriptions and add-ons in Client Services

The **Client Services** tab in `DepartmentHeadDashboard.tsx` gives Department Heads a consolidated view of every service line and add-on sold to customers in their division:

1. Click **Client Services** in the left sidebar.
2. Filter or search by customer name, service code, or fulfillment status (`ACTIVE`, `PENDING_ONBOARDING`, `RENEWAL_DUE`, `ADDON_REQUESTED`).
3. Inspect add-on service requests submitted by Technical Consultants, Support, or the Client Portal:
   - Verify whether Accounts has confirmed the add-on payment (`VERIFIED`).
   - Confirm that the assigned Team Lead and Team Member have picked up the add-on deliverable in their queue.

## What you should see

:::result
Approved leave requests move immediately from `PENDING_DEPARTMENT_HEAD` to `PENDING_HR`, while rejected applications record your note and notify the applicant in real time.
:::

## Good to know

:::tip Personal Leave Submissions
Department Heads can also submit their own leave applications from the **Leave Request** tab using the **Apply for Leave** form, which routes directly to HR and Super Admin oversight.
:::

## If something goes wrong

- **Leave request is not visible**: Confirm that the employee is assigned to your active department in **Teams & People** and that your **ScopeBar** is set to that department.
- **Add-on service is locked**: Check whether payment verification is still pending in Accounts (see [Add-On Verification in Accounts](/accounts/addon-verification-accounts)).
