---
title: Introduction to Amuwa AI CRM
description: Understand the architecture, business units, and departmental layout of the Amuwa AI CRM platform.
order: 10
roles: [Super Admin, Department Head, Sales Team Member, Support Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [src/types/crm.ts, shared/contracts.ts, docs/ARCHITECTURE.md]
related: [getting-started/roles-and-permissions, getting-started/navigation-and-layout]
updated: 2026-10-19
---

Amuwa AI CRM connects marketing, sales, accounting, technical consulting, and operations across all Amuwa Corporation business units into a unified system.

## Before you start

:::prereq
- You must have an active company user account created by your Department Head or the Super Admin.
- Ensure you have network access to the CRM deployment URL or local office intranet.
:::

## Core architecture

The application is structured into specialized departments and sub-departments:

1. **Revenue Units**:
   - **Wabastore**: WhatsApp Business API, marketing automation, e-commerce solutions.
   - **Whatsbox**: Multi-agent customer communication platform.
   - **Dtalk**: Enterprise communication and voice calling infrastructure.
   - **Digitree**: Digital branding, performance marketing, and creative campaigns.
   - **Mpillar**: Strategic business expansion and multi-channel marketing.
   - **Design Studio**: Creative design packages, logos, brand guides, and collateral.

2. **Operations & Financial Controls**:
   - **Accounts**: Central payment verification, two-stage GST invoice generation, and expense tracking.
   - **Technical Consulting**: Technical onboarding, document authentication, Meta verification, and WABA provisioning.
   - **Human Resources (HR)**: Attendance auditing, biometric sync, staff records, and leave management.

3. **External Customer Interface**:
   - **Client Dashboard**: External self-service portal accessible at `/client/login`.

## Single record customer lifecycle

Unlike legacy tools where leads and customers are maintained in disconnected tables, Amuwa AI CRM uses a single record per customer:

```flow
LEAD | Sales / Support | Initial contact and service interest
POTENTIAL | Sales Team Member | Deal amount agreed and services selected
ONBOARDING | Accounts & Consultant | Payment verified; documentation collected
CUSTOMER | Delivery Department | Handed over for active service delivery
```

## Good to know

:::note Data Isolation & Role Boundaries
Every employee sees only the data permitted by their department and role. A salesperson cannot access Accounts ledgers or other departments' private pipelines.
:::

:::tip Real-time Sync
Lists, payment states, and document reviews update automatically via Supabase Realtime without manual browser refreshes.
:::

## If something goes wrong

If your department or assigned leads are not visible when opening the application, review [Troubleshooting Missing Records](/troubleshooting/missing-records-and-permissions).
