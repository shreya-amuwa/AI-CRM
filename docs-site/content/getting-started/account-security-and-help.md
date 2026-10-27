---
title: Account Security and Getting Help
description: Security standards for employee sessions, role-based data boundaries, signing out safely, and escalating technical or operational issues.
order: 60
group: Core Onboarding
roles: [All Roles]
audience: internal
status: verified
sources: [src/context/AuthContext.tsx, src/services/sessionManager.ts, src/lib/auth/roleMapping.ts, shared/contracts.ts]
related: [/getting-started/signing-in-and-account-approval, /troubleshooting/login-and-access-issues, /troubleshooting/missing-records-and-permissions, /reference/roles-and-permissions-matrix]
updated: 2026-10-27
---

Amuwa AI CRM handles confidential customer KYC documents, GST tax invoices, financial ledgers, and private communications. Every employee must follow strict session security practices and know how to escalate blockers quickly.

## Before you start

:::prereq
- Always save any in-progress form changes (such as lead notes, payment entries, or onboarding checklist uploads) before signing out or closing your browser tab.
:::

## How to sign out safely

1. Locate your profile name and role badge in the top-right header (or at the bottom of the left navigation sidebar).
2. Click **Sign out** (door icon with exit arrow).
3. Your Supabase authentication token and local session state are immediately cleared, and your browser returns to the `/login` screen.

```flow
Click Sign out | Staff Member | Top Header or Sidebar Footer
Invalidate Session Token | Auth & Session Manager | Revokes active token & clears local storage
Redirect to Login | Application Router | Returns to /login; back button cannot reopen protected views
```

## Session security and audit standards

### 1. Concurrent session protection
To prevent credential sharing and unauthorized access from unattended machines, the platform monitors active sessions per user account:
- If your account signs in from a new device or browser beyond the allowed concurrency limit, the oldest session is automatically evicted.
- The displaced browser displays a **Security Session Notice** banner explaining that the account was accessed from another device.

### 2. Immutable security and audit logs (`Security & Audit Logs`)
Every sensitive action across the CRM is permanently recorded in the `audit_logs` table and visible to Super Admins under **Security & Audit Logs**:
- Every record includes the `actor` name, `actorRole`, `department`, `action`, `outcome` (`SUCCESS`, `FAILURE`, or `DENIED`), `requestId`, IP address, and timestamp.
- Even if a staff member's profile is later deactivated, historical audit logs preserve their attribution.

### 3. Role-based data boundaries
- **Department & Division Isolation**: Sales reps, Telecallers, Business Associates, and Support members only see records within their authorized department and division.
- **Multi-Department Head Scopes**: Department Heads with multiple granted scopes (`user_department_scopes`) can view cross-department roll-ups in **Combined** mode or act within a specific department selected in the **`ScopeBar`**.
- **Client Portal Isolation**: External clients signing in at `/client/login` are strictly restricted to their own company's services, invoices, documents, tickets, chat, and calendar.

## How to get help and escalate issues

When you encounter a blocker or unexpected system behavior, use the escalation path below:

| Issue Category | First Self-Check Guide | Who to Escalate To | What Information to Provide |
| --- | --- | --- | --- |
| **Login, Pending Approval, or Session Eviction** | [Troubleshooting Login & Access Issues](/troubleshooting/login-and-access-issues) | Your **Department Head**, **HR**, or **Super Admin** | Your work email address, selected department, and the exact error banner text. |
| **Missing Customer, Lead, or Queue Access** | [Missing Records & Permissions](/troubleshooting/missing-records-and-permissions) | Your **Team Lead** or **Department Head** | Customer name/phone, your active **ScopeBar** selection, and whether **My Leads** or **Team Leads** is selected. |
| **Payment Balance or GST Discrepancy** | [Payment & Balance Discrepancies](/troubleshooting/payment-and-balance-discrepancies) | **Accounts Department** | Customer name/code, UTR reference, agreed deal amount, and tax basis (`EXCLUSIVE`, `INCLUSIVE`, or `NA`). |
| **Document Upload Size or Format Error** | [Document Upload Troubleshooting](/troubleshooting/document-upload-troubleshooting) | **Technical Consultant** or **Accounts** | Checklist item number (e.g., `2. All Important Documents`), file format (`.pdf`, `.xlsx`), and file size in KB/MB. |
| **Customer Stuck Before Handover** | [Handover & Progression Blockers](/troubleshooting/handover-and-progression-blockers) | **Technical Consultant** or **Department Head** | Which of the 6 onboarding checklist items is not yet `VERIFIED`, or whether `4. Payment Confirmation` / `5. Invoice Confirmation` is pending. |

## What you should see

:::result
When you sign out at the end of your shift, your session closes cleanly and no unauthorized user on that workstation can view your pipeline, chat messages, or financial queues.
:::

## Good to know

:::warning Never Share Staff Credentials
Sharing your login credentials with another employee violates Amuwa security policy and attributes all of their actions—including lead edits, document approvals, or payment entries—directly to your name in the audit log.
:::
