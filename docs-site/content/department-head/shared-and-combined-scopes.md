---
title: Shared Department Heads, ScopeBar, and Combined Roll-Ups
description: Understand how multi-department scopes (user_department_scopes), the session department chooser, the persistent ScopeBar,Combined roll-up mode, and the Wabatalk virtual facet work.
order: 7
group: Multi-Department Governance
roles: [Department Head, Sales Team Lead, Super Admin]
audience: internal
status: verified
sources: [src/components/ScopeBar.tsx, src/hooks/useActiveScope.ts, src/components/Workspaces/DepartmentHeadDashboard.tsx, src/components/Workspaces/SalesHeadDashboard.tsx]
related: [department-head/department-head-overview, department-head/sales-department-head-guide, super-admin/staff-and-role-administration]
updated: 2026-10-27
---

In Amuwa Corporation, a senior leader often heads multiple business units simultaneously—for example, leading **Sales** across **Wabastore**, **Whatsbox**, **Dtalk**, **Digitree**, and **Mpillar**, or overseeing **Support & Delivery** across **Dtalk** and **Wabatalk**. Amuwa AI CRM supports multi-department leadership natively through the `user_department_scopes` architecture, the session scope picker modal, and the persistent top **`ScopeBar`** (`src/components/ScopeBar.tsx`, `src/hooks/useActiveScope.ts`).

## Before you start

:::prereq
- Multi-department switching is automatically enabled whenever a **Department Head** has two or more departments granted via their primary `departmentId` plus additional entries in `user_department_scopes` (`additionalScopes`).
- Scope assignments are configured by the **Super Admin** in **Team Members** (see [Staff and Role Administration](/super-admin/staff-and-role-administration)).
:::

## Multi-department scope lifecycle

```flow
Sign In as Multi-Department Head | Department Head | System detects 2+ scopes in user_department_scopes
Choose a Department for This Session | Modal Picker | Select Combined (all N) or a single department card
Switch Scopes Anytime in ScopeBar | Top Header Bar | Click Combined (N) pill or individual department pill
-> Combined (N) active | Read-only executive roll-up across all N departments
-> Single Department pill active | Full operational write mode for that specific department
```

## The login scope chooser modal

When a Department Head assigned to two or more departments signs in, the CRM displays the **Choose a department for this session** modal before loading the workspace:

1. **Combined (all N)** card:
   - Aggregates leads, customers, handovers, tickets, and revenue KPIs across **all N assigned departments** in a unified executive roll-up view.
   - Clearly badged as a consolidated multi-department overview.
2. **Individual Department cards**:
   - Displays each assigned department (such as **Wabastore**, **Whatsbox**, **Dtalk**, **Digitree**, **Mpillar**, or **Wabatalk**) with its brand accent color and division label.
   - Selecting an individual card opens the dashboard scoped specifically to that department with full operational write permissions.

## Using the persistent top ScopeBar

Once inside the `DepartmentHeadDashboard` or `SalesHeadDashboard`, the **`ScopeBar`** (`src/components/ScopeBar.tsx`) remains pinned at the top of the workspace so you never need to log out to switch departments:

| ScopeBar Mode | Visual Indicator | Data & Action Behavior |
| --- | --- | --- |
| **Single Department Pill** (e.g., `Wabastore`) | Active pill highlighted with department accent dot | Displays records belonging only to that department. All write actions (Lead Assign upload, Pass to Team Lead, Leave approval, Ticket reassignment) are **enabled**. |
| **Combined Roll-Up Pill** (`Combined (N)`) | Highlighted summary pill showing total scoped count `N` | Merges metrics, pipelines, scorecards, and queues across all `N` assigned departments. Write actions that require a single target department are **disabled (read-only)** to prevent cross-department data collisions. |

## How Wabatalk works as a virtual Support division facet

In the corporate hierarchy, **Wabatalk** operates as a dedicated Support and conversational delivery brand closely paired with **Dtalk**:

- In the database, Wabatalk is modeled as a **virtual Support division facet** of Dtalk (`facet_of = 'dtalk'`, `facet_division = 'SUPPORT'`).
- When a Support Department Head is assigned scopes covering **Dtalk** and **Wabatalk**, both pills appear in their **`ScopeBar`** (`Dtalk` and `Wabatalk`, plus `Combined (2)`).
- Selecting **Wabatalk** filters the workspace to Wabatalk-tagged support services, onboarding handovers, and tickets while sharing the underlying Dtalk organizational infrastructure cleanly.

## Steps: Switching between Combined roll-up and single-department execution

1. To review cross-department performance at the start of the day, click **`Combined (N)`** in the top **ScopeBar** and open **Overview**, **Performance**, or **Pipeline**.
2. When you spot an item requiring action—such as an unassigned customer in **Handovers**, a pending application in **Leave Request**, or a Telecaller needing a new `.xlsx` sheet in **Lead Assign**—note the record's department badge.
3. Click that specific department's pill in the top **ScopeBar** (for example, **Wabastore**).
4. Perform the assignment, upload, or approval action. Your active scope selection persists in your browser session until you switch pills again.

## What you should see

:::result
Clicking any pill in the **ScopeBar** immediately re-queries and filters KPI cards, tables, team rosters, and charts to match the selected scope without reloading the application.
:::

## Good to know

:::note Single-Department Heads
If a Department Head is assigned to only one department (`scopes.length === 1`), the login chooser modal is skipped automatically and theworkspace opens directly in that department's operational mode.
:::

## If something goes wrong

- **A department pill is missing from your ScopeBar**: Ask your **Super Admin** to open **Super Admin Dashboard > Team Members**, edit your user profile, and check the missing department under **Additional Department Scopes**.
