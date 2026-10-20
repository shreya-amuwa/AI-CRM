---
title: The Add-on Services Journey
description: How supplemental services are requested, verified by Accounts, invoiced, and fulfilled.
order: 70
roles: [Technical Consultant, Accounts Staff, Support Team Member]
audience: internal
status: verified
sources: [docs/ADDONS_INVOICES.md, docs/TECHNICAL_CONSULTANT.md, shared/contracts.ts]
related: [technical-consultant/submitting-addon-requests, accounts/addon-verification-accounts]
updated: 2026-10-19
---

Add-on services allow customers to purchase supplemental capabilities (such as extra message credits, custom chatbot flows, or additional Meta advertising campaigns) during or after initial onboarding.

## Before you start

:::prereq
- The customer must already be in onboarding or active customer status.
- Add-on requests must be submitted with itemized pricing, tax rates, and quantities.
:::

## Complete add-on lifecycle

```flow
Add-on Need Identified | Consultant / Support / Client | During onboarding or via Client Portal
Draft Request Created | Technical Consultant | Items, quantities, prices, and tax specified
Submit for Accounts Verification | Technical Consultant | Status: PENDING_VERIFICATION
Accounts Review | Accounts Staff | Under Business Verification > Add-ons
-> Request Changes | Accounts Staff | Returned to Consultant with revision note
-> Approved | Accounts Staff | Accounts approves pricing structure
Invoice Issued | Accounts Staff | Dynamic ADDON invoice generated & emailed
Payment Confirmed | Accounts Staff | Payment recorded; addon_payments ledger verified
Add-on Documents Unlocked | Technical Consultant | TC collects add-on checklist items
Add-on Completed | Technical Consultant | Deliverables active; status: COMPLETED
```

## Step-by-step procedure

### 1. Identifying the need
- During onboarding, the Technical Consultant asks if additional services are needed (**Additional services** question: Yes / No).
- Alternatively, a client can request a service from their dashboard via **Explore Services > Add service**.

### 2. Drafting the add-on request
1. Open the customer in the Technical Consultant dashboard.
2. Under **Add-on Services**, click **Add Service**.
3. Select a catalogue item (e.g. `WA_EXTRA_CREDITS`) or enter a custom service description.
4. Specify:
   - **Quantity**
   - **Unit Price**
   - **Discount** (if applicable)
   - **Tax Rate** (e.g. 18% GST)
5. Save draft. The subtotal, tax, and total are computed automatically.

### 3. Submitting for accounts verification
1. The consultant clicks **Submit for Accounts Verification**.
2. The request locks and appears in **Accounts > Business Verification**.

### 4. Accounts verification & invoicing
1. Accounts examines the requested pricing against company margins.
2. Accounts clicks **Approve Request**.
3. Accounts generates the official **Add-on Invoice** (`kind: 'ADDON'`).
4. When the customer pays, Accounts records and verifies the transaction under `addon_payments`.

### 5. Document collection & delivery
1. Once Accounts confirms payment, the add-on's specific document checklist unlocks.
2. The consultant collects and authorizes any required technical assets.
3. The consultant marks the add-on as **Completed**.

## What you should see

:::result
The add-on service is activated on the customer's profile, the payment is credited in the ledger, and the client dashboard immediately displays the newly purchased service.
:::

## Good to know

:::important Independence of Original Onboarding
The original contract onboarding is **never blocked** by an open add-on request. The initial services can proceed to delivery even while an add-on request is awaiting payment.
:::

## If something goes wrong

If an add-on request is rejected or returned for changes, the consultant sees the rejection note under **Add-ons Services** with status `CHANGES_REQUESTED`.
