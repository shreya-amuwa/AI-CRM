---
title: Client Notices Broadcasts and Department Hub Governance
description: Send targeted or broadcast Client Notices with severity and deep-link actions in ClientNoticePanel, track Read vs Unread status, and govern departments in the Super Admin Dashboard.
order: 5
group: Executive Governance
roles: [Super Admin, Department Head, Accounts Department]
audience: internal
status: verified
sources: [src/components/Workspaces/SuperAdminDashboard.tsx, src/components/Workspaces/ClientNoticePanel.tsx]
related: [super-admin/company-business-oversight, shared/notification-center-guide, client/welcome-client-portal]
updated: 2026-10-27
---

Super Admins manage external customer communications and divisional governance using two dedicated modules in `SuperAdminDashboard.tsx`: the **Client Notices** panel (`src/components/Workspaces/ClientNoticePanel.tsx`) for dispatching actionable alerts to the self-service Client Portal, and the **Departments** hub for governing business units and concurrent session boundaries.

## Before you start

:::prereq
- Sign in as a **Super Admin** at `/super-admin/dashboard`.
- To receive a notice in the Client Portal, the target customer must have an active Client Portal account (`/client/login`).
:::

## Dispatching and tracking Client Notices (`ClientNoticePanel.tsx`)

The **Client Notices** tab in the **Super Admin Dashboard** enables administrators to send structured notices directly to one customer or broadcast to multiple customers, complete with severity styling, deep-link action buttons, and read-receipt tracking:

```flow
Open Client Notices Tab | Super Admin | SuperAdminDashboard > Client Notices (ClientNoticePanel.tsx)
Select Recipients & Notice Type | Super Admin | Choose PAYMENT_REMINDER, RENEWAL_DUE, DOCUMENT_REQUEST, SERVICE_UPDATE, or GENERAL
Set Severity & Optional Action CTA | Super Admin | Severity: INFO, WARNING, URGENT + optional Action Label & Action Tab
Dispatch Notice to Client Portal | Realtime Engine | Appears on customer's Client Dashboard banner & notice feed
Track Read vs Unread Status | Super Admin | Live delivery table shows Read timestamp vs Unread badge
```

### 1. Notice types and severities

When composing a notice in **Client Notices**, select the appropriate classification and urgency level:

| Field | Options | Typical Use Case |
| --- | --- | --- |
| **Notice Type** (`type`) | `PAYMENT_REMINDER`, `RENEWAL_DUE`, `DOCUMENT_REQUEST`, `SERVICE_UPDATE`, `GENERAL` | Categorizes the notice icon and filter tag in the Client Portal. |
| **Severity** (`severity`) | `INFO` (Blue), `WARNING` (Amber), `URGENT` (Red) | Controls visual prominence and banner styling on the customer's dashboard. |
| **Action Label** (optional) | Custom button text (e.g., *"View Pending Invoice"* or *"Upload KYC Document"*) | Renders a one-click call-to-action button inside the notice card. |
| **Action Tab** (optional) | Target Client Portal tab (`overview`, `invoices`, `documents`, `services`, `tickets`, `plans`) | Deep-links the customer directly to the relevant Client Portal tab when they click the action button. |

### 2. Steps to send a Client Notice and track read receipts

1. In the **Super Admin Dashboard** sidebar, click **Client Notices**.
2. Choose the target recipient(s): select a specific customer from the search selector or target a customer cohort.
3. Select the **Notice Type** (`PAYMENT_REMINDER`, `RENEWAL_DUE`, `DOCUMENT_REQUEST`, `SERVICE_UPDATE`, or `GENERAL`) and **Severity** (`INFO`, `WARNING`, or `URGENT`).
4. Enter a clear **Title** and **Message Body**.
5. *(Optional)* Fill in **Action Label** and select an **Action Tab** so the customer can jump straight to **Invoices**, **Documents**, **Services**, or **Tickets** with one click.
6. Click **Send Notice**.
7. Monitor the **Sent Notices History** table below the composer:
   - Each dispatched notice displays a live **`Read`** badge (with timestamp when the client viewed or acknowledged it) or **`Unread`** badge.

## Governing divisions in the Departments tab

Click **Departments** in the **Super Admin Dashboard** sidebar to oversee all corporate divisions (**Wabastore**, **Whatsbox**, **Dtalk**, **Digitree**, **Mpillar**, **Design Studio**, **Accounts**, and **HR**):

1. **Department Drill-Down**: Click any department card to inspect its active staff roster, lead pipeline, onboarding queue, and revenue KPIs.
2. **Open any department**: As Super Admin you enter every department directly with **Enter Panel**. There are no lock or unlock controls, and nothing stops you from opening a department.
3. **Concurrent Session Ceilings**: Monitor `activeSessions / maxSessions` per department and terminate stale sessions if an employee left a workstation open.

## What you should see

:::result
Sent **Client Notices** appear immediately in the customer's Client Portal with the selected severity color and deep-link CTA button, and flip from **Unread** to **Read** in the Super Admin table as soon as the client opens them.
:::

## Good to know

:::tip Actionable Payment & Document Reminders
When sending a `PAYMENT_REMINDER`, set **Severity** to `WARNING` or `URGENT`, set **Action Label** to `View Invoices`, and set **Action Tab** to `invoices` so the client lands directly on their payable invoice screen.
:::

## If something goes wrong

- **Customer reports they did not see the notice**: Check in **Sent Notices History** whether the notice is still marked **Unread**, and verify that the customer has an active login provisioned for `/client/login`.
