---
title: Super Admin Dashboard, Company Workflow, and Business Oversight
description: Master all 10 sidebar tabs of the Super Admin Dashboard, configure Client Dashboard purchase attribution rules, execute permanent customer deletions, and manage Fresh Start resets.
order: 1
group: Executive Governance
roles: [Super Admin, Accounts Department]
audience: internal
status: verified
sources: [src/components/Workspaces/SuperAdminDashboard.tsx, docs/DELETE_CUSTOMER.md, docs/FRESH_START.md]
related: [super-admin/staff-and-role-administration, super-admin/service-catalog-management, super-admin/tax-agreements-review]
updated: 2026-10-27
---

As the enterprise control center for Amuwa Corporation, the **Super Admin Dashboard** (`src/components/Workspaces/SuperAdminDashboard.tsx`) provides global visibility and administrative authority across every business unit, financial ledger, workflow attribution rule, and security boundary.

## Before you start

:::prereq
- You must be signed in with a verified **Super Admin** account (`role = 'SUPER_ADMIN'`) at `/super-admin/dashboard`.
- Administrative actions—such as changing attribution splits, updating service pricing, or deleting a customer—take effect immediately and are recorded in **Security & Audit Logs**.
:::

## All 10 sidebar tabs of SuperAdminDashboard

The **Super Admin Dashboard** is organized into 10 primary navigation tabs in the left sidebar:

| Sidebar Tab | Component / Scope | Key Capabilities |
| --- | --- | --- |
| **Executive Overview** | `SuperAdminDashboard.tsx` | Enterprise KPI cards, total verified revenue, outstanding balances, active client counts, departmental revenue split, and global customer inspection/deletion. |
| **Departments** | Department Hub | Inspect and drill into individual business units (**Wabastore**, **Whatsbox**, **Dtalk**, **Digitree**, **Mpillar**, **Design Studio**, **Accounts**, **HR**), lock/unlock access, and monitor session caps. |
| **Company Workflow** | Workflow & Attribution | Visual end-to-end CRM stage map and configurable **Client Dashboard purchase attribution rules** (`SUPPORT`, `ORIGIN`, `FIFTY_FIFTY`, `CUSTOM`). |
| **Tax & Agreements** | Agreement Ledger | Audit customer commercial agreements by tax basis (`EXCLUSIVE`, `INCLUSIVE`, `NA`), verified payments, invoiced totals, and remaining order balances. |
| **Client Notices** | `ClientNoticePanel.tsx` | Broadcast targeted or global notices (`PAYMENT_REMINDER`, `RENEWAL_DUE`, `DOCUMENT_REQUEST`, `SERVICE_UPDATE`, `GENERAL`) to Client Portals and track `Read` vs `Unread` receipts. |
| **Service Prices** | `ServicePriceManager.tsx` | Manage the commercial service catalog, default HSN/SAC codes, default GST percentages, and per-department base pricing. |
| **Team Members** | Staff Provisioning | Approve pending staff signups, create users, and assign `role`, `headDivision`, `salesSubRole`, `isTechnicalConsultant`, and multi-department `additionalScopes`. |
| **Access Control** | `AccessControlMatrix.tsx` | Interactive role-by-capability permission matrix governing read/write/approve rights across CRM modules. |
| **Security & Audit Logs** | Audit Trail | Immutable chronological log of logins, role changes, tax basis adjustments, client chat inspections, and customer deletions. |
| **Chat** | `ChatWorkspace.tsx` | Global internal messaging (`Direct` and `Channels`) plus read-only audit access to all departmental `Clients` conversations. |

## Client Dashboard purchase attribution rule

When an existing customer purchases an additional service or plan renewal directly from the self-service **Client Dashboard** (`/client/dashboard`), the CRM determines how revenue credit is split between the **Support / Relationship team** and the **Originating Sales team** based on the **Client Dashboard Purchase Attribution Rule** configured in **Company Workflow**:

| Attribution Mode | Code | Revenue Split Behavior |
| --- | --- | --- |
| **100% Support Division** | `SUPPORT` | Credits 100% of the self-service Client Portal purchase to the Support / Relationship department managing the client. |
| **100% Originating Channel** | `ORIGIN` | Credits 100% of the purchase back to the original acquisition channel and department that closed the customer. |
| **50 / 50 Equal Split** | `FIFTY_FIFTY` | Splits revenue attribution equally (50% Support division, 50% Originating acquisition channel). |
| **Custom Percentage Split** | `CUSTOM` | Allows the Super Admin to define custom Support % and Origin % sliders (summing to 100%) applied to verified self-service payments. |

## Deleting a customer permanently (`Delete customer`)

Super Admins have exclusive access to permanently remove a test, duplicate, or erroneously created customer record (`docs/DELETE_CUSTOMER.md`):

```flow
Locate Customer Record | Super Admin | Executive Overview or Department customer table
Click Delete Customer | Super Admin | Opens permanent deletion confirmation modal
Type DELETE & Optional Reason | Super Admin | Exact uppercase string DELETE required to unlock button
Execute Cascading Removal | Backend Transaction | Deletes customer + linked invoices, payments, tickets, chat & portal login
Write Immutable Audit Entry | Security & Audit Logs | Records actor ID, deleted customer metadata, timestamp, and reason
```

1. Locate the customer in **Executive Overview** or inside a **Departments** drill-down view and click **Delete customer**.
2. In the confirmation dialog, review the warning listing all linked records that will be permanently removed.
3. Type **`DELETE`** (in all capitals) in the confirmation input and enter an optional audit **Reason** (for example, *"Duplicate test entry created during staging verification"*).
4. Click **Permanently Delete Customer**.
5. The backend executes a cascading deletion across all linked tables (`customers`, `customer_services`, `customer_payments`, `invoices`, `onboarding_checklists`, `support_tickets`, `chat_threads`, and `client_accounts`) and writes a permanent entry to **Security & Audit Logs**.

## Fresh Start database reset (`Fresh Start`)

Before production cutover or after a full staging UAT cycle, administrators can use the **Fresh Start** maintenance workflow (`docs/FRESH_START.md`) to wipe transactional test records (leads, customers, invoices, payments, tickets, and chat messages) while preserving core organizational configuration (departments, service catalog prices, access control matrix, and verified staff accounts).

:::warning Destructive Administrative Operations
Both **Delete customer** and the **Fresh Start** reset permanently remove transactional data and cannot be undone from the UI. Always verify database backups before running a Fresh Start reset.
:::

## What you should see

:::result
Changes to the **Company Workflow** attribution rule apply immediately to subsequent Client Portal purchases and Business Reports. Customer deletions immediately remove the record from all departmental queues and log the action under **Security & Audit Logs**.
:::

## If something goes wrong

- **The Confirm Delete button remains disabled**: Ensure you typed `DELETE` in uppercase letters without extra spaces.
- **Unclassified historical revenue in reports**: See [Business Reports and Attribution](/accounts/business-reports-attribution).
