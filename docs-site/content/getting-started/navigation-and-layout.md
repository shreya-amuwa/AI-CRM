---
title: Navigating the Dashboard and Interface
description: Learn about the top navigation bar, collapsible sidebars, multi-tab layout, and quick action tools.
order: 30
roles: [Super Admin, Department Head, Sales Team Member, Support Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [src/components/layout/Header.tsx, src/components/layout/Sidebar.tsx, src/components/layout/TabBar.tsx]
related: [getting-started/signing-in, getting-started/searching-records]
updated: 2026-10-19
---

The Amuwa AI CRM interface provides persistent navigation, role-scoped controls, and contextual tools designed for fast keyboard and mouse operation.

## Before you start

:::prereq
- Sign in with your employee credentials to load your assigned role interface.
:::

## Interface components

### 1. Top navigation header
The persistent top bar includes:
- **Amuwa Logo & Department Name**: Displays your currently active department. Super Admins can click the logo to return to the centralized **Department Hub**.
- **Active Sessions Counter**: Indicates the concurrent active sessions currently running in your department (maximum 2 concurrent sessions allowed per account).
- **Client Notices Button** (Super Admin and HR only): Allows broadcasting announcements, holidays, and office closures to external customer dashboards.
- **Leave Button**: Opens the **Leave Center** dialog to submit leave requests, view approval status, or approve subordinate requests.
- **Notification Bell**: Displays unread high-priority and normal alerts with one-click navigation to the subject record.
- **Profile Avatar & Sign Out**: Displays your initials, full name, role badge, and the **Sign Out** button.

### 2. Left navigation sidebar
Depending on your department, the sidebar organizes your primary queues:
- **Sales Sidebar**: Expands **My Leads** into **1 Leads**, **2 Potential**, and **3 Customer onboarding**, plus **Part payments**.
- **Accounts Sidebar**: Offers **Account Overview**, **Confirmation**, **Invoices**, **Part Payment**, **Department Income**, **Expenses**, and **Business Reports**.
- **Support Sidebar**: Provides **Tickets**, **Support Leads**, **Client Documents**, **Client Calendar**, and **Tasks**.
- **Collapsible Toggle**: Click the Hamburger menu button in the header or use the sidebar edge to collapse the sidebar for wide tables.

### 3. Multi-tab navigation (Super Admin)
When operating across multiple departments, the Super Admin interface maintains persistent workspace tabs across the top of the viewport, enabling seamless switching without losing work in progress.

## What you should see

:::result
Every screen provides clear breadcrumb paths, active tab indicators, and clean table borders. If your screen width is narrow, the sidebar automatically transitions into a mobile-friendly slide-over drawer.
:::

## Good to know

:::tip Keyboard Navigation
Press `kbd:Esc` to dismiss open dialogs, date pickers, or confirmation drawers without saving changes.
:::

## If something goes wrong

If your sidebar does not display expected sections, see [Missing Records and Permissions](/troubleshooting/missing-records-and-permissions).
