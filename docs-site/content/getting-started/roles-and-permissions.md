---
title: Understanding User Roles and Permissions
description: Complete overview of system roles, team divisions, and dashboard access rules.
order: 40
roles: [Super Admin, Department Head, Sales Team Member, Support Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [src/lib/auth/roleMapping.ts, shared/contracts.ts]
related: [getting-started/platform-overview, reference/roles-and-permissions-matrix]
updated: 2026-10-19
---

Amuwa AI CRM enforces strict role-based access control (RBAC). Your access is defined by your database role, your department, and your team division.

## Before you start

:::prereq
- Your role is configured by your administrator when your account is provisioned. You cannot alter your own role or department.
:::

## Roles and dashboard mappings

| Role | Department / Division | Dashboard Opened | Key Capabilities |
| --- | --- | --- | --- |
| **Super Admin** | Corporate | Department Hub | Full oversight, staff creation, revenue reports, department locking |
| **Department Head** | Assigned Department | Department Head Dashboard | Team monitoring, customer handovers, leave approvals, ticket SLAs |
| **Sales Team Lead** | Sales Division | Sales Team Lead Dashboard | Lead distribution, pod performance monitoring, pipeline oversight |
| **Sales Team Member** | Sales Division | Sales Member Dashboard | Adding leads, recording conversations, sending deals to Accounts |
| **Support Team Lead** | Support Division | Support Team Lead Dashboard | Ticket queue assignment, SLA monitoring, escalation handling |
| **Support Team Member** | Support Division | Support Member Dashboard | Ticket handling, customer communication, client activity logging |
| **Accounts Staff / Lead** | Accounts Department | Accounts Dashboard | Payment verification, two-stage dynamic invoices, part payments |
| **Technical Consultant** | Support (`isTechnicalConsultant`) | Technical Consultant Dashboard | Document authorization, client login creation, add-on requests |
| **HR Head / Staff** | HR Department | HR Operations Dashboard | Attendance discrepancy tracking, staff directory, final leave review |
| **Client** | External Portal | Client Dashboard | View active services, invoices, raise tickets, upload documents |

## Hierarchical permissions

The platform follows a strict organizational hierarchy:

```flow
Super Admin | Full system access | All departments & settings
Department Head | Department oversight | All teams in department
Team Lead | Pod oversight | Direct team members & leads
Team Member | Own records | Assigned customers & tickets
```

## Good to know

:::important Role Elevation Rules
An employee can only create or manage users with lower rank:
- **Super Admin** can create Department Heads, Team Leads, and Team Members.
- **Department Head** can create Team Leads and Team Members within their department.
- **Team Lead** can create Team Members within their team.
- **Team Member** cannot create accounts.
:::

:::note Technical Consultant Identification
A Technical Consultant is a specialized Support Team Member flagged with `isTechnicalConsultant: true`. This grants access to the technical onboarding checklist, automations, and client login provisioning.
:::

## If something goes wrong

If your dashboard shows "Access Denied" or does not match your assigned job responsibilities, contact your Department Head to verify your role and team settings.
