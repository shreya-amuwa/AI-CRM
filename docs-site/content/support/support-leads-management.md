---
title: Managing Support Leads and Referrals
description: How Support Team Members register cross-sells, referral leads, and existing customer upgrades.
order: 10
roles: [Support Team Member, Support Team Lead]
audience: internal
status: verified
sources: [docs/SERVICE_JOURNEYS.md, docs/SUPPORT_DASHBOARD.md, shared/contracts.ts]
related: [customer-journeys/support-referral-journey, support/ticket-inbox-and-chat]
updated: 2026-10-19
---

Support team members frequently identify opportunities to provide additional services to ongoing accounts or handle direct customer referrals.

## Before you start

:::prereq
- You must be signed in with a Support Team Member or Support Team Lead profile.
- Support leads are completely private to the Support division and are never mixed with Sales queues.
:::

## Steps

1. In the sidebar, navigate to **Support Leads > Add Lead**.
2. Fill in the **Prospect Information**:
   - **Contact Name** and **Company Name**.
   - **Mobile Number** (10 digits).
   - **Email Address** and **Location**.
3. Select the **Lead Source** (e.g. `Reference`, `Existing Customer`, or `Inbound Inquiry`).
4. Select the **Interested Services** from the `crm_services` catalog.
5. In the **Initial Conversation Note**, describe the customer's specific support inquiry or upgrade request.
6. Click **Save Lead**.

```flow
Add Support Lead | Support Member | Support Leads > Add Lead
Qualify Interest | Support Member | Logs follow-ups & selects services
Set Deal Amount | Support Member | Enters agreed contract price
Send to Accounts | Support Member | Submits with sentFrom: 'SUPPORT'
Revenue Attributed | Accounts Ledger | Credited to Support Division
```

## What you should see

:::result
The referral is created and assigned to you. When you submit the customer to Accounts via **Send to Accounts**, the transaction is automatically tagged with `sentFrom: 'SUPPORT'`, ensuring you receive proper attribution upon payment confirmation.
:::

## Good to know

:::tip Pipeline Isolation
Support leads follow the same stage gates as Sales (`LEAD` -> `POTENTIAL` -> `ONBOARDING`), but your records are only visible to Support Team Leads, the Support Department Head, and the Super Admin.
:::

## If something goes wrong

If an Accounts team member returns your referral, it appears in your **Returned** tab with their resolution note.
