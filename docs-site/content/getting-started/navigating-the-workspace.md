---
title: Navigating the Workspace
description: Learn how to use the collapsible left sidebar, top header bar, multi-department ScopeBar, inline table search, and documentation keyboard shortcuts.
order: 40
group: Core Onboarding
roles: [All Roles]
audience: internal
status: verified
sources: [src/components/layout/shell.tsx, src/components/ScopeBar.tsx, src/components/team-member/pipeline/LeadsView.tsx, docs-site/build.mjs]
related: [/getting-started/understanding-your-role-and-dashboard, /getting-started/common-statuses-and-stages, /shared/searching-and-filtering]
updated: 2026-10-27
---

Every workspace in Amuwa AI CRM is built on a consistent `DashboardShell` layout (`src/components/layout/shell.tsx`) featuring a collapsible left navigation sidebar, a contextual top header, a multi-department `ScopeBar` (for shared Department Heads), and fast inline table filtering.

![Sales Pipeline Workspace and Navigation Shell](shot:sales-leads-pipeline.png)

## Before you start

:::prereq
- Sign in to your active staff account to load your role's workspace shell.
:::

## 1. Left navigation sidebar

The left sidebar organizes your daily queues into clear functional groups:

- **Collapsible Pipeline Groups**: In Sales, Business Associate, and Support dashboards, **My Leads** (and **Team Leads** for Team Leads) expands into the 4 lifecycle stages with live record counters:
  - **1 Leads**
  - **2 Potential**
  - **3 Customer onboarding**
  - **4 Client**
- **Role-Specific Action Queues**:
  - **Telecallers** see **Overview** and **Tasks** (assigned calling sheets).
  - **Sales Heads** see **Lead Assign**, **Telecallers**, and **Business Associates**.
  - **Accounts** sees **Account Overview**, **Department Income**, **Confirmation**, **Payments**, **Customers**, **Invoices**, **Finance**, and **Monthly Plans**.
  - **Technical Consultants** see **Overview**, **Customers** (Direct Intake Queue), **Customer Onboarding**, and **Automations**.
  - **HR** sees **Overview**, **Attendance**, **Leave Requests**, **Staff Directory**, **Recruitment**, and **3-Day Training**.
- **Shared Employee Tools**: Every staff sidebar includes quick access to **Leave Request**, **Chat** (with live unread badge counts), **User Documentation**, and **My Profile**.
- **Responsive Drawer on Mobile / Narrow Screens**: Click the hamburger menu button in the top-left corner to toggle the sidebar drawer on smaller screens.

## 2. Top header bar and `ScopeBar`

Across the top of your workspace, you have immediate access to context switchers and real-time alerts:

1. **`ScopeBar` (Multi-Department Heads)**:
   - When a Department Head is authorized for multiple departments (`user_department_scopes`), a persistent bar at the top of the workspace displays pills for **Combined (N)** and each individual department (such as `Wabastore`, `Whatsbox`, `D Talk`, or `Wabatalk`).
   - Click any pill to switch between aggregated read-only roll-up mode (`Combined`) and single-department operational mode.
2. **Primary Role Action Buttons**:
   - Contextual quick actions appear on the right side of the header (for example, **Add Team Member** for Super Admins and Department Heads, or **Add lead** inside pipeline views).
3. **Notification Bell**:
   - Displays an unread counter badge for real-time handovers, payment confirmations, document rejections, task assignments, and leave updates. Click any notification to jump to the relevant customer or queue.
4. **Profile Menu & Sign Out**:
   - Shows your display name, resolved role badge, and the **Sign out** button.

## 3. Searching and filtering CRM tables

:::important No Global `Ctrl+K` Command Palette in the CRM
Amuwa AI CRM does **not** use a global `Ctrl+K` / `Cmd+K` pop-up command palette. Instead, every table and queue provides an **inline debounced search bar** and contextual **filter chips** directly above the table.
:::

To find a customer, lead, invoice, or ticket inside any workspace:

1. **Inline Search Input**:
   - Click the search box at the top of your active table (such as `Search name, company, phone, email...`).
   - Type at least 2 characters of the customer's name, business name, phone number (including the last 4 digits), email, or customer code. Results filter automatically as you type.
2. **Status and Stage Filter Chips**:
   - Click the horizontal filter pills above the table to narrow records by stage or status (for example, `All`, `New`, `Contacted`, `Interested`, `Ready to buy`, `With Accounts`, or `Returned` in **1 Leads**).
3. **Service and Dropdown Facets**:
   - Filter pipeline rows by purchased service from the service dropdown, by team member (in **Team Leads** and Department Head views), or by follow-up window (`Overdue`, `Due today`, `No follow-up`).

## 4. Searching the documentation site (`/`)

When reading this User Manual or the Client Help Center:
- Press `kbd:/` on your keyboard (or click **Search the documentation** in the top header) to open the instant documentation search modal.
- Type any keyword (such as `GST`, `ocr`, `telecaller`, `wabatalk`, or `handover`).
- Use `kbd:Up` and `kbd:Down` to highlight a guide and press `kbd:Enter` to open it, or press `kbd:Esc` to close the modal.

## What you should see

:::result
You can move between pipeline stages, switch multi-department scopes, filter tables inline without page reloads, and open any documentation guide with a single `/` keystroke.
:::

## If something goes wrong

If a customer record does not appear in your table search, verify that:
- Your status filter chip is set to **All** rather than a specific status tab.
- Your **ScopeBar** (for multi-department heads) or **My Leads / Team Leads** toggle (for Team Leads) is set to the right scope.
- See [Missing Records and Permissions](/troubleshooting/missing-records-and-permissions) for full diagnostic steps.
