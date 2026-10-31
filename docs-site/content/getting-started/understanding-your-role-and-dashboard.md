---
title: Understanding Your Role and Dashboard
description: Authoritative reference for how Amuwa AI CRM maps user roles, divisions, and sub-roles to dedicated dashboards and multi-department scopes.
order: 30
group: Core Onboarding
roles: [All Roles]
audience: internal
status: verified
sources: [src/lib/auth/roleMapping.ts, src/App.tsx, src/components/ScopeBar.tsx, src/hooks/useActiveScope.ts, shared/contracts.ts]
related: [/getting-started/welcome-to-amuwa-crm, /getting-started/navigating-the-workspace, /department-head/shared-and-combined-scopes, /reference/roles-and-permissions-matrix]
updated: 2026-10-27
---

When you sign in to Amuwa AI CRM, the application inspects your database `role`, `department`, `team.division`, `headDivision`, `salesSubRole`, and `isTechnicalConsultant` flags using `src/lib/auth/roleMapping.ts` (`toAuthUser` and `defaultDashboardLabel`) to route you to the exact workspace built for your job.

## Before you start

:::prereq
- Your role, division, and sub-role flags are assigned by a Super Admin, HR, or your Department Head.
- If your dashboard does not match your responsibilities, an administrator must update your profile in **Team Members** or **Teams & People**.
:::

## Complete role-to-dashboard routing table

The table below shows every supported role combination in `src/lib/auth/roleMapping.ts` and the exact dashboard and URL route opened after sign-in:

| Database `role` | Division / Specialty Flags | Mapped App Role (`AuthUser['role']`) | Route / Workspace Opened | Key Sidebar Views |
| --- | --- | --- | --- | --- |
| `SUPER_ADMIN` | Corporate-wide | `superadmin` | Super Admin Dashboard (`/super-admin/dashboard`) | `Executive Overview`, `Departments`, `Company Workflow`, `Tax & Agreements`, `Client Notices`, `Service Prices`, `Team Members`, `Access Control`, `Security & Audit Logs`, `Chat` |
| `DEPARTMENT_HEAD` | `headDivision: 'BOTH'` (or `null` / whole department) | `admin` | Department Head Dashboard (`/admin/dashboard/:userId`) | `Overview`, `Teams & People`, `Performance`, `Pipeline`, `Onboarding`, `Handovers`, `Client Services`, `Tickets`, `Work Tasks`, `Leave Request`, `Chat`, `My Profile` |
| `DEPARTMENT_HEAD` | `headDivision: 'SALES'` (`defaultDashboard: 'sales-department-head'`) | `sales-head` | Sales Department Head Dashboard (`/sales-head/dashboard/:userId`) | `Overview`, `Lead Assign`, `Telecallers`, `Business Associates`, `Teams & People`, `Performance`, `Pipeline`, `Onboarding`, `Work Tasks`, `Leave Request`, `Chat`, `My Profile` |
| `DEPARTMENT_HEAD` | `headDivision: 'SUPPORT'` | `admin` | Department Head Dashboard — Support Scope (`/admin/dashboard/:userId`) | `Overview`, `Teams & People`, `Performance`, `Pipeline` (Support), `Onboarding`, `Handovers`, `Client Services`, `Tickets`, `Work Tasks`, `Leave Request`, `Chat`, `My Profile` |
| `DEPARTMENT_HEAD` / `TEAM_HEAD` / `TEAM_MEMBER` | `department.slug === 'hr'` | `hr` | HR Dashboard (`/hr/dashboard/:userId`) | `Overview`, `Attendance`, `Leave Requests`, `Staff Directory`, `Recruitment`, `3-Day Training`, `Client Notices` (Head), `Chat`, `My Profile` |
| `TEAM_HEAD` | `team.division === 'SALES'` | `team-lead` | Sales Team Lead Dashboard (`/team-lead/dashboard/:userId`) | `Overview`, `My Leads` (`1 Leads` .. `4 Client`), `Team Leads` (`1 Leads` .. `4 Client`), `My Tasks / Assigned Tasks`, `Leave Request`, `Chat`, `My Profile` |
| `TEAM_HEAD` | `team.division === 'SUPPORT'` (`defaultDashboard: 'support-lead'`) | `support-lead` | Support Team Lead Dashboard (`/support-lead/dashboard/:userId`) | `Overview`, `My Leads`, `Team Leads`, `Import Customers`, `Client tickets`, `Client calendar`, `Client documents`, `Assigned Tasks`, `Leave Request`, `Chat`, `My Profile` |
| `TEAM_MEMBER` | `team.division === 'SALES'` (standard sales rep, `salesSubRole: null`) | `business-associate` | Unified Sales Dashboard (`/business-associate/dashboard/:userId`; the old `/team-member/dashboard/:userId` address redirects here) | `Dashboard`, `Leads` (`Leads`, `Potential`, `Customer onboarding`, `Part payments`), `My Customers`, `Tasks & Follow-ups`, `My Tasks`, `Field Visit`, `Calendar`, `BA Tasks`, `Quotation`, `Demo Schedule`, `Scope of Project`, `Subscriptions`, `Invoices`, `Delivery Queue`, `Chat`, `Notification Center`, `Raise an Issue`, `Settings` |
| `TEAM_MEMBER` | `team.division === 'SALES'` + `salesSubRole === 'TELECALLER'` | `telecaller` | Telecaller Dashboard (`/telecaller/dashboard/:userId`) | `Overview`, `Tasks` (Assigned Calling Sheets & **Send to BA**), `My Leads`, `Leave Request`, `Chat`, `My Profile` |
| `TEAM_MEMBER` | `team.division === 'SALES'` + `salesSubRole === 'BUSINESS_ASSOCIATE'` | `business-associate` | Business Associate Dashboard (`/business-associate/dashboard/:userId`) | `Overview`, `Leads` (`1 Leads`, `2 Potential`, `3 Customer onboarding`, `4 Client`, `Part payments`), `My Tasks / Assigned Tasks`, `Leave Request`, `Chat`, `My Profile` |
| `TEAM_MEMBER` | `team.division === 'SUPPORT'` + `isTechnicalConsultant === false` | `support-member` | Support Team Member Dashboard (`/support/dashboard/:userId`) | `Overview`, `My Leads` (`1 Leads` .. `4 Client`), `Import Customers`, `Client tickets`, `Client calendar`, `Client documents`, `My Tasks`, `Leave Request`, `Chat`, `My Profile` |
| `TEAM_MEMBER` | `team.division === 'SUPPORT'` + `isTechnicalConsultant === true` | `technical-support` | Technical Consultant Workspace (`/technical-support/dashboard`) | `Overview`, `Customers` (Direct Intake Queue), `Customer Onboarding`, `Automations` (BolifyAI), `Leave Request`, `Chat` |
| `TEAM_HEAD` / `TEAM_MEMBER` | `department.slug === 'accounts'` | `accounts-staff` | Accounts Dashboard (`/accounts/dashboard/:userId`) | `Account Overview`, `Department Income`, `Confirmation`, `Payments`, `Customers`, `Invoices`, `Finance`, `Monthly Plans`, `Leave Request`, `Chat` |

## Multi-department scope picker (`Choose a department for this session`)

Some Department Heads (`DEPARTMENT_HEAD`) are granted authority across two or more departments or division facets via `user_department_scopes` (`src/components/ScopeBar.tsx` and `src/hooks/useActiveScope.ts`).

```flow
Multi-Scope Department Head Signs In | Department Head | 2+ authorized departments in user_department_scopes
Session Scope Modal Appears | Choose a department for this session | Lists Combined (all N) + individual department cards
-> Selects Combined (all N) | Read-Only Roll-Up Mode | Aggregates KPIs, pipelines, and revenue across all N granted scopes
-> Selects Single Department | Operational Mode | Scopes all actions, handovers, and assignments to that specific department
Switch Anytime in Top Header | ScopeBar Pills | Click any department pill or Combined (N) in the top ScopeBar
```

### How the session picker and `ScopeBar` work
1. **At Sign-In (`Choose a department for this session`)**:
   - If you are assigned to multiple departments (for example, `Wabastore` and `Whatsbox`, or `D Talk` and `Wabatalk`), a modal prompts you to choose your initial workspace view:
     - **Combined (all N)**: Opens a unified executive roll-up across all `N` departments you lead.
     - **Individual Department Card**: Opens that specific department in full operational mode.
2. **Persistent Top `ScopeBar`**:
   - At the top of your dashboard, the **`ScopeBar`** displays quick-switch pills for **Combined (N)** and each of your authorized departments, along with badges indicating whether your scope in that department is `Sales`, `Support` (such as **Wabatalk** for D Talk Support), or `Whole Department`.
   - Clicking any pill switches your active department context immediately without signing out.

## Role creation hierarchy

To preserve organizational governance, `creatableRoles()` in `src/lib/auth/roleMapping.ts` enforces strict rank boundaries when adding staff:
- **Super Admin (`SUPER_ADMIN`)**: Can create `DEPARTMENT_HEAD`, `TEAM_HEAD` (Team Lead), and `TEAM_MEMBER`.
- **Department Head (`DEPARTMENT_HEAD`)**: Can create `TEAM_HEAD` and `TEAM_MEMBER` within their authorized department.
- **Team Lead (`TEAM_HEAD`)**: Can create `TEAM_MEMBER` within their team.
- **Team Member (`TEAM_MEMBER`)**: Cannot create staff accounts.

## What you should see

:::result
Your left sidebar and header subtitle always reflect your resolved dashboard label (for example, `Sales Department Head Dashboard · Wabastore`, `Telecaller Dashboard · D Talk`, or `Technical Consultant Dashboard · Whatsbox`).
:::

## Good to know

:::note Other Sales Sub-Roles
In `shared/contracts.ts`, `SALES_SUB_ROLES` also defines `INFLUENCER`, `VISIT_SALES`, and `BUSINESS_PARTNER`. If a user is assigned one of those future sub-roles, the app displays a clear notice (`dashboard not set up yet`) rather than exposing an unauthorized dashboard.
:::

## If something goes wrong

If you land on the wrong dashboard (for example, opening the standard Support dashboard instead of the Technical Consultant workspace), ask your Department Head or Super Admin to verify the `isTechnicalConsultant`, `headDivision`, or `salesSubRole` setting on your profile. See [Missing Records and Permissions](/troubleshooting/missing-records-and-permissions).
