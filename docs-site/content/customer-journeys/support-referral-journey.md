---
title: The Support Referral Journey
description: How Support Team Members generate leads, manage referrals, and route cross-sells to Accounts.
order: 30
roles: [Support Team Member, Support Team Lead, Accounts Staff]
audience: internal
status: verified
sources: [docs/SERVICE_JOURNEYS.md, docs/BUSINESS_REPORTING.md, shared/contracts.ts]
related: [customer-journeys/general-sales-journey, support/support-leads-management]
updated: 2026-10-19
---

Support team members frequently identify opportunities to upgrade existing clients or refer new contacts from ongoing customer relationships.

## Before you start

:::prereq
- You must be signed in with a Support Team Member or Support Team Lead profile.
- Support leads are completely private to the Support division and are never mixed with Sales queues.
:::

## Complete workflow

```flow
1. Support Lead Creation | Support Member | Support Leads > Add Lead
2. Discovery & Follow-up | Support Member | Logs conversation notes & sets follow-up date
3. Service Selection | Support Member | Selects services from crm_services catalogue
4. Send to Accounts | Support Member | Submits deal with sentFrom: 'SUPPORT'
5. Accounts Review | Accounts Staff | Validates payment; attributes transaction to Support
6. Provisioning & Handover | Accounts or TC | Follows DIRECT or TECHNICAL path based on services
```

### 1. Ingestion in Support Leads
Support members do not handle cold inbound webhooks. Instead, they register referrals, existing customer expansions, or affiliate introductions in **Support Leads**.

### 2. Commercial Qualification
The support member defines the agreed deal amount and selects the requested services from the shared catalogue `crm_services`.

### 3. Submission to Accounts
When the customer agrees to the purchase:
1. The support member clicks **Send to Accounts**.
2. The submission records `sentFrom: 'SUPPORT'` and attributes `sentBy` to the support member's profile ID.
3. The record locks while under financial review.

### 4. Accounts Processing & Business Attribution
In the Accounts queue, the card displays a distinct **SUPPORT** badge and names the responsible support member. When Accounts confirms payment:
- The payment is logged in the ledger.
- The business reporting engine automatically credits the revenue to the **Support Division** under the support member's name.

### 5. Fulfillment Path
- If the services are **DIRECT** (e.g. Design Studio packages), Accounts provisions the client login and returns the customer to Support for document verification.
- If the services are **TECHNICAL** (e.g. WhatsApp API), the customer routes to the Technical Consultant.

## What you should see

:::result
Support members see their referrals progress cleanly without interference from the general sales pipeline. Transactions appear in the Support section of [Business Reports](/accounts/business-reports-attribution).
:::

## Good to know

:::note Commission and Credit Integrity
Because attribution is stamped on `payment_requests.requested_by` at the moment of submission, later reassignments of customer ownership never alter who gets credit for the sale.
:::

## If something goes wrong

If an Accounts staff member sends the referral back, see [Managing Returned Leads](/sales/managing-returned-leads).
