---
title: "Employee Issues and Meeting Requests"
description: How HR reviews, assigns, answers and resolves employee issues, and schedules and manages meeting requests, in the HR dashboard.
order: 6
group: Human Resources
audience: internal
roles:
  - HR Manager
  - Department Head
  - Super Admin
status: verified
updated: 2026-10-30
related:
  - /shared/raise-an-issue-guide
  - /hr/hr-operations-directory
  - /shared/notification-center-guide
---

The HR dashboard has two separate menu items, **Employee Issues** and **Meeting Requests**. They show what Team Members, Team Leads and Department Heads of every department sent from **Raise an Issue**. Only HR staff and the Super Admin can open them; the system refuses everyone else.

## Employee Issues

1. Open **Employee Issues**. The cards at the top (**Total Issues**, **New Issues**, **In Progress**, **Resolved**, **Urgent Issues**) are counted from the live records.
2. Use the tabs (**All Issues**, **New**, **In Progress**, **Awaiting Employee Response**, **Resolved**, **Closed**), the filters (department, priority, category, assigned HR employee, date range) and the search box (employee name, reference or title). The table is paged.
3. Press **Open** on a row to see the full description, the employee's details, attachments and the complete history.
4. In the detail you can:
   - **Assign** the issue to an HR team member (an unassigned issue that is assigned moves to **In Progress**).
   - **Respond to the employee** (they read it on their page) or **Request more information** (the issue waits for the employee).
   - Change the **status**. **Resolved** and **Closed** ask for a confirmation; a closed issue cannot be changed or answered.
   - Add an **internal note**, shown with an *HR only* lock and never visible to the employee.
5. Every assignment, response and status change is written to the history and to the audit log.

An issue you raised yourself (HR employees can raise issues through the API) is not in the HR list and cannot be worked by you; another HR person sees it.

## Meeting Requests

1. Open **Meeting Requests**. The cards show **Total Requests**, **Pending Approval**, **Approved / Scheduled**, **Completed** and **Declined or Cancelled**.
2. Filter by status, department, category, assigned HR employee and meeting date; search by employee, reference or subject.
3. Open a request and choose what to do:
   - **Approve and schedule**: the confirmed date and time (required), the mode, a location or an **https** meeting link, instructions and a message.
   - **Propose another time**: the employee accepts or answers.
   - **Decline the request**: a reason is required and the employee reads it (confirmation asked).
   - **Reschedule** a scheduled meeting (new date and time and a reason) or **Cancel** it (a reason; confirmation asked).
   - **Mark as completed**: record the **outcome** and **follow-up actions**. These are for HR only; the employee never sees them.
4. You can assign the **responsible HR representative** and add internal notes at any time.

The employee sees the confirmed date, time, mode, location or link, your message and any reason on their **Raise an Issue** page, and is notified.

## Notifications

When an employee submits an issue or a meeting request, every active member of the HR department gets an in-app notification (the Super Admin instead when the HR department has nobody). Replies from the employee notify the assigned HR person. Notifications show the reference and the status, never the issue text. Nothing is e-mailed or sent through WhatsApp for this feature.

## If something goes wrong

- **"This page is for HR"**: your account is not in the HR department (or the Super Admin).
- **The meeting link is refused**: it must start with `https://`.
- **A status cannot be changed**: a closed issue is final; ask the employee to raise a new one.
