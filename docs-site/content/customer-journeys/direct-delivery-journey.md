---
title: The Direct Delivery Journey
description: The streamlined workflow for services that bypass technical consulting and route directly to delivery.
order: 40
roles: [Sales Team Member, Support Team Member, Accounts Staff, Delivery Department]
audience: internal
status: verified
sources: [docs/SERVICE_JOURNEYS.md, shared/contracts.ts]
related: [customer-journeys/overview, delivery/design-studio-direct-delivery]
updated: 2026-10-19
---

Certain services, such as Amuwa Design Studio creative packages (`DS_*`), do not require API webhooks, Meta verification, or technical configurations. The CRM provides a streamlined **DIRECT** workflow that bypasses the Technical Consultant entirely.

## Before you start

:::prereq
- Every service selected on the customer record must have `requires_technical_consultant: false` configured in the catalog.
- If even one service requires technical review, the customer automatically follows the **MIXED** / **TECHNICAL** path.
:::

## Direct workflow comparison

```flow
Direct Service Selected | Sales or Support | Design Studio or direct catalogue item
Send to Accounts | Sales or Support | Deal amount and tax basis submitted
Payment Confirmed | Accounts Staff | Amount verified in financial ledger
Client Login Provisioned | Accounts Staff | Accounts creates client portal account
Return to Sales | Accounts Staff | Requires provisioned client login
Document Verification | Sales / Support Owner | Owner verifies uploaded collateral
Send to Delivery Department | Sales / Support Owner | Sent directly to Design Studio queue
Active Delivery | Delivery Department | Designers execute deliverables
```

## Step-by-step procedure

### 1. Lead creation and service selection
The salesperson or support member selects direct services (e.g. `DS_LOGO_DESIGN`, `DS_BRAND_IDENTITY`). The system marks `journey: 'DIRECT'`.

### 2. Submission to Accounts
The deal is submitted via **Send to Accounts** with the agreed deal amount and tax basis.

### 3. Accounts verification and client login creation
In the Accounts confirmation queue:
1. The accountant verifies the payment in the ledger.
2. The accountant clicks **Create client login**. The CRM creates the client portal credentials directly in Supabase Auth.
3. Once the login status is `CREATED`, the accountant clicks **Confirm Payment & Return to Sales**.

### 4. Document verification by sales owner
For direct customers, the Technical Consultant does not review documents:
1. The customer owner (Sales or Support member), their Team Lead, or Department Head reviews the uploaded client files.
2. The owner marks items as **Verified**.
3. Accounts and Technical Consultants cannot verify documents for direct customers.

### 5. Send to delivery department
Once all required items are verified:
1. The **Send to Delivery Department** button unlocks on the customer page.
2. The owner clicks the button.
3. The customer record updates to active status, and the service appears in the delivery department's **Delivery Queue** (e.g. Design Studio).

## What you should see

:::result
The customer moves directly from document verification to active delivery. The Technical Consultant queue is never touched, cutting onboarding turnaround time significantly.
:::

## Good to know

:::important Client Login Prerequisite
For direct customers, Accounts cannot click **Return to Sales** until the client portal account has been created. This ensures the client can track deliverables from day one.
:::

## If something goes wrong

If the **Send to Delivery Department** button is disabled, ensure all mandatory documents are marked `VERIFIED`. See [Handover Blockers](/troubleshooting/handover-and-progression-blockers).
