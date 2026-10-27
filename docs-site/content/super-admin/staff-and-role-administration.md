---
title: Managing Team Members, Role Scopes, and Access Control Matrix
description: Approve pending staff accounts, assign roles, divisions, sales sub-roles, Technical Consultant flags, and multi-department scopes in Team Members, and govern permissions in Access Control.
order: 2
group: Identity & Access
roles: [Super Admin, HR Manager]
audience: internal
status: verified
sources: [src/components/Workspaces/SuperAdminDashboard.tsx, src/components/Workspaces/AccessControlMatrix.tsx, src/types/crm.ts]
related: [super-admin/company-business-oversight, department-head/shared-and-combined-scopes, hr/hr-account-provisioning]
updated: 2026-10-27
---

Super Admins manage the entire corporate identity lifecycle through two dedicated tabs in `SuperAdminDashboard.tsx`: **Team Members** (for user provisioning, pending account approvals, division/sub-role assignments, and shared department scopes) and **Access Control** (`src/components/Workspaces/AccessControlMatrix.tsx`, for interactive role-permission governance).

## Before you start

:::prereq
- You must be signed in as a **Super Admin** at `/super-admin/dashboard`.
- Verify which department, division (`BOTH`, `SALES`, or `SUPPORT`), and operational squad the employee belongs to before activating their account.
:::

## Staff provisioning and approval workflow

```flow
Create User or Review Pending Signup | Super Admin | Team Members tab > Pending Approval or Add Member
Assign Primary Department & Role | Super Admin | SUPER_ADMIN, DEPARTMENT_HEAD, TEAM_HEAD, TEAM_MEMBER, etc.
Configure Division & Sub-Role Flags | Super Admin | headDivision, salesSubRole, isTechnicalConsultant, additionalScopes
Approve & Activate Profile | Super Admin | Grants workspace access and syncs permissions
Govern Fine-Grained Capabilities | Super Admin | Access Control tab (AccessControlMatrix.tsx)
```

## Managing users in the Team Members tab

Open **Super Admin Dashboard > Team Members** to view all active employees, review accounts awaiting approval, or create new staff profiles:

### 1. Approving pending staff accounts

When a new employee registers or is staged by HR, their account appears under the **Pending Approval** filter in **Team Members**:
1. Inspect the employee's name, work email, and requested department.
2. Verify or adjust their **Role**, **Department**, **Division**, and **Sub-Role** attributes (detailed below).
3. Click **Approve** to activate their CRM login, or **Reject** to deny access.

### 2. Configuring Role, Division, Sub-Role, and Scopes

When creating or editing a user in **Team Members**, configure the following fields carefully:

| Field / Attribute | Allowed Values | Operational Effect |
| --- | --- | --- |
| **Role** (`role`) | `SUPER_ADMIN`, `DEPARTMENT_HEAD`, `TEAM_HEAD`, `TEAM_MEMBER`, `ACCOUNTS`, `HR` | Determines the primary workspace route and baseline authority level. |
| **Primary Department** (`departmentId`) | `wabastore`, `whatsbox`, `dtalk`, `digitree`, `mpillar`, `designstudio`, `accounts`, `hr` | Sets the employee's home business unit. |
| **Head Division** (`headDivision`) | `BOTH`, `SALES`, `SUPPORT` | For `DEPARTMENT_HEAD`: `SALES` routes to `SalesHeadDashboard.tsx` (`/sales-head/dashboard/:userId`); `SUPPORT` or `BOTH` routes to `DepartmentHeadDashboard.tsx`. |
| **Sales Sub-Role** (`salesSubRole`) | `TELECALLER`, `BUSINESS_ASSOCIATE` | For Sales staff: `TELECALLER` routes to the Telecaller calling-sheet workspace; `BUSINESS_ASSOCIATE` routes to the full CRM lead/potential/onboarding pipeline. |
| **Technical Consultant** (`isTechnicalConsultant`) | `true` / `false` (checkbox toggle) | Grants a Support member access to the Technical Consultant onboarding queue to verify documents, configure automations, and create client portal logins. |
| **Additional Scopes** (`additionalScopes`) | Multi-select department pills (`user_department_scopes`) | Grants a shared **Department Head** access to 2+ departments (plus the `Combined (N)` roll-up view and top **ScopeBar**). |

## Using the interactive Access Control matrix (`AccessControlMatrix.tsx`)

Click **Access Control** in the left sidebar of the **Super Admin Dashboard** to open the interactive permission matrix (`src/components/Workspaces/AccessControlMatrix.tsx`):

1. **Role Columns vs. Capability Rows**:
   - The matrix displays every CRM role across the columns (`SUPER_ADMIN`, `DEPARTMENT_HEAD`, `Sales Head`, `TEAM_HEAD`, `BUSINESS_ASSOCIATE`, `TELECALLER`, `Technical Consultant`, `Support Member`, `Accounts`, `HR`) against module capabilities (Lead Management, Calling Sheets, Invoicing & Payments, Technical Onboarding, Handover Routing, Ticket Escalations, Staff & Leave Governance).
2. **Inspecting & Toggling Permissions**:
   - Review which roles hold **Full Write**, **Scoped Read/Write**, **Read-Only Audit**, or **No Access** for each module.
   - Toggle configurable capability switches to tighten or expand operational access for specific roles.
3. **Audit Logging**:
   - Every permission change saved in **Access Control** or **Team Members** is recorded in **Security & Audit Logs** with the administrator's identity and timestamp.

## What you should see

:::result
Updating a staff member's `role`, `headDivision`, `salesSubRole`, `isTechnicalConsultant` flag, or `additionalScopes` immediately updates their workspace routing and top **ScopeBar** pills on their next page load or session refresh.
:::

## Good to know

:::tip Shared Department Heads Across Divisions
To set up a single Sales Head overseeing all 5 revenue units (**Wabastore**, **Whatsbox**, **Dtalk**, **Digitree**, **Mpillar**), set their `role = 'DEPARTMENT_HEAD'`, `headDivision = 'SALES'`, choose one primary department, and select the remaining four departments under **Additional Scopes** (`user_department_scopes`).
:::

## If something goes wrong

- **A Sales staff member sees the wrong dashboard**: Check their profile in **Team Members** and verify that `salesSubRole` is explicitly set to `TELECALLER` or `BUSINESS_ASSOCIATE` (or `headDivision = 'SALES'` for a Sales Department Head).
- **A Department Head cannot see their second department**: Verify that the department is checked under **Additional Scopes** in **Team Members**.
