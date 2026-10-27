---
title: Navigating the Technical Consultant Dashboard and Onboarding Queue
description: How Technical Consultants review incoming customers, filter review states, and manage consultation tasks.
order: 10
group: Technical Consultant
roles: [Technical Consultant, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [docs/TECHNICAL_CONSULTANT.md, shared/contracts.ts, src/components/support/TechnicalSupportDashboard.tsx]
related: [technical-consultant/verifying-checklist-items, technical-consultant/department-handover-tc]
updated: 2026-10-27
---

The Technical Consultant Dashboard is the central workspace for auditing onboarding files, authenticating business identities, configuring technical integrations (WABA, Meta, Webhooks), and provisioning customer credentials.

## Before you start

:::prereq
- You must be signed in with an account assigned the **Technical Consultant** role.
- Customers become visible in your queue only after Sales clicks **Send to Technical Consultant**.
:::

## The onboarding queue tabs

Navigate to **Onboarding Customers** in the sidebar. The queue provides 5 status tabs:

1. **All**: Complete list of customers currently assigned to your department.
2. **Review pending**: Customers where documents and details saved by Sales are awaiting your inspection.
3. **Needs attention**: Customers where at least one item was marked *Not authorized* and requires follow-up.
4. **Authorized**: Customers where every required checklist item has been authorized and are ready for handover.
5. **Waiting for sales team**: Customers you sent back to Sales for correction. These remain visible in a read-only state so you can monitor progress as Sales uploads fixes.

## Queue item indicators

Each customer card shows:
- **Customer Code & Business Name**: Identified by their permanent CRM code (e.g. `CUS-00104`).
- **Services Badges**: Shows purchased products (e.g. `WABA_SETUP`, `META_ADS`).
- **Authorization Progress**: Indicates authorized items versus total requirements (e.g. `7/8 docs authorized`).
- **Salesperson**: Names the representative who onboarded the account.
- **Consultation Notes Badge**: Shows if private consultation notes exist for this account.

## Opening a customer workspace

Click any customer row to open the full technical workspace:
- **Left Column**: Customer contact details, deal amount, verified payments, and the **Automations** panel.
- **Center Area**: The **Onboarding Checklist** with verification controls.
- **Right Column**: **Client Panel Login** provisioning and the **Department Handover** action card.

## What you should see

:::result
The workspace displays live document counters. As items are authorized, the progress bar updates and the **Send to Department Head** button checks for completion requirements.
:::

## Good to know

:::note Idle Updates
The dashboard uses Supabase Realtime to update checklists and queue counters without interval polling or manual browser refreshes.
:::

## If something goes wrong

If a salesperson claims they sent a customer but the record is missing from your queue, ensure the salesperson clicked **Send to Technical Consultant** on their onboarding page.
