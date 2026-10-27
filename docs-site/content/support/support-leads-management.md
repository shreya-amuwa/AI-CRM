---
title: Support Dashboard Overview, Leads, and Upsells
description: Navigating the Support Dashboard sidebar and managing Support referrals, cross-sells, and existing customer upgrades across the 4-stage pipeline.
order: 1
group: Support Operations
roles: [Support Team Member, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [src/components/support-member/SupportMemberDashboard.tsx, src/components/support-lead/SupportLeadDashboard.tsx, shared/contracts.ts]
related: [customer-journeys/support-referral-journey, support/ticket-inbox-and-chat, support/importing-existing-customers]
updated: 2026-10-27
---

The **Support Dashboard** is the central workspace for Support Team Members (Relationship Managers) and Support Team Leads to manage active client accounts, resolve tickets, log deliverables, import legacy customers, and close cross-sell or referral deals.

![Support Dashboard and Client Tickets Inbox](shot:support-tickets-inbox.png)

## Before you start

:::prereq
- Sign in with a **Support Team Member** or **Support Team Lead** profile.
- Support leads and upsells are scoped to the Support division (`sentFrom: 'SUPPORT'`) and are never mixed into Sales queues.
:::

## Support Dashboard sidebar navigation

The Support workspace (`SupportMemberDashboard.tsx` and `SupportLeadDashboard.tsx`) provides dedicated sidebar tabs for account management, upsells, and service operations:

- **`Overview`** (`Dashboard - Existing Customers` / `Dashboard`): Summary of your assigned client portfolio, active tickets, pending tasks, and renewal alerts.
- **`My Leads`** (`1 Leads`, `2 Potential`, `3 Customer onboarding`, `4 Client` + `Part payments`): Your personal 4-stage pipeline for registering referrals, renewals, and cross-sell upgrades.
- **`Team Leads`** *(Support Team Lead only)*: Team-wide view of all referral and upsell leads across your support pod.
- **`Import Customers`**: The One-Sheet Existing Customer Import wizard for migrating active customers, services, payments, and portal logins in bulk.
- **`Client tickets`** (`Tickets`): Real-time support ticket inbox with SLA countdowns, internal notes, and 3-tier escalation.
- **`Client calendar`**: Activity calendar where staff log campaign metrics, deliverables, and touchpoints visible on the client's portal.
- **`Client documents`**: Verification queue (`To verify` and `Reviewed`) for KYC and compliance files uploaded by clients.
- **`My Tasks` / `Assigned Tasks`**: Operational tasks assigned by your Support Team Lead or Department Head.
- **`Leave Request`**, **`Chat`**, and **`My Profile`**: Submit and track leave applications, message internal teammates in real time, and review your profile settings.

## Registering a Support referral or existing customer upsell

Support team members frequently identify opportunities to sell additional services (`Add lead -> Existing customer (adding services)`) or register direct customer referrals (`New customer`):

1. In the sidebar, navigate to **My Leads > 1 Leads** and click **+ Add lead**.
2. Choose **Existing customer (adding services)** for an upgrade/renewal, or **New customer** for a new referral.
3. Fill in the **Prospect / Client Information**:
   - **Contact Name**, **Company Name**, **Mobile Number** (10 digits), **Email Address**, and **City**.
4. Select the **Lead Source** (for example, `Reference`, `Existing Customer`, or `Inbound Inquiry`).
5. Select the **Interested Services** from the catalog and record an **Initial Conversation Note** describing the upgrade or referral request.
6. Click **Save Lead**.
7. Progress the record through **`2 Potential`** (enter **Deal Amount** and click **Confirm Payment** / **Send to Accounts**) and **`3 Customer onboarding`** (complete the 6-item checklist) into **`4 Client`**.

```flow
Add Support Lead | Support Member | My Leads > 1 Leads > + Add lead (New or Existing customer)
Qualify & Move to 2 Potential | Support Member | Select services, enter Deal Amount, set READY_TO_BUY
Confirm Payment with Accounts | Support Member | Submits with sentFrom: 'SUPPORT' for Support attribution
Complete 3 Customer Onboarding | Support Member | Fulfill 6-item checklist & hand over for activation
Converted to 4 Client | System | Revenue credited to Support Division & active service provisioned
```

## What you should see

:::result
The referral or upsell deal appears in your **My Leads** pipeline (and in **Team Leads** for your Support Team Lead). When submitted to Accounts via **Confirm Payment**, the deal carries `sentFrom: 'SUPPORT'`, ensuring verified revenue is attributed to the Support division.
:::

## Good to know

:::tip Complete Pipeline Isolation
Support leads follow the exact same 4-stage gates as Sales (`1 Leads` -> `2 Potential` -> `3 Customer onboarding` -> `4 Client`), while database permissions keep Support pipeline records visible only to Support staff, Support Team Leads, the Support Department Head, and the Super Admin.
:::

## If something goes wrong

- **Payment request returned by Accounts**: Check the **Returned from Accounts** filter in **My Leads > 1 Leads**, read the Accounts resolution note, and resubmit once resolved.
