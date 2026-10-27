---
title: Moving to Potential and Managing Deal Commercials
description: Qualifying a lead into 2 Potential, recording deal services and pricing, requesting payment confirmation, or handling a customer who backs out.
order: 4
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Business Associate]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/PotentialView.tsx, src/components/team-member/pipeline/LeadForms.tsx, docs/LEADS_ONBOARDING.md]
related: [sales/creating-a-lead, sales/sending-to-accounts, customer-journeys/customer-backs-off]
updated: 2026-10-27
---

When a prospect confirms buying intent and agrees on commercial pricing, the record moves from **1 Leads** into **2 Potential**. In **2 Potential**, you finalize the service package and deal value, submit payment confirmation requests to Accounts, advance confirmed deals to onboarding, or return the record to **1 Leads** if the customer backs out.

## Before you start

:::prereq
- You must agree on a commercial price greater than ₹0 with the customer (whole Rupees only).
- At least one service from the CRM service catalog must be selected on the record.
:::

## Moving a lead to `2 Potential`

A lead enters **2 Potential** in either of two ways:

1. **Automatic promotion via `READY_TO_BUY`**:
   - When creating or editing a lead in **1 Leads**, select the **Interested Services**, enter the agreed **Deal Amount (₹)**, set **Status** to `READY_TO_BUY`, and click **Save & move to Potential**.
2. **Manual promotion (`Send to Potential`)**:
   - Open an interested lead in **1 Leads**, verify that the **Deal Amount (₹)** and **Services** are filled in, and click **Move to Potential** (or **Send to Potential**).

```flow
Qualify Lead in 1 Leads | Salesperson | Set status READY_TO_BUY or click Move to Potential
Validate Commercials | System | Checks Deal Amount > ₹0 and at least 1 service selected
-> Deal Amount or Service Missing | Move Refused | Validation prompt highlights missing field
Stage Updated to POTENTIAL | System | Record moves to My Leads > 2 Potential
Confirm Payment | Salesperson | Submits deal to Accounts (CONFIRMATION_PENDING)
-> Customer Backed Out | Salesperson | Clicks "Customer backed out" to return record to 1 Leads
Send to Onboarding | Accounts / Sales | Moves to 3 Customer onboarding once payment is verified
```

## Recording deal services and pricing in `2 Potential`

Inside **My Leads > 2 Potential**, each customer card and detail drawer lets you manage commercial specifics before or during payment verification:
- **Selected Services**: Add or remove catalog services (for example, `Wabastore`, `Whatsbox`, `Amuwa Design Studio`) so the exact package matches the quotation.
- **Deal Amount (₹)**: Enter or update the total agreed contract amount in whole Rupees (no decimals/paise).
- **GST Basis**: Specify whether the agreed deal amount is **Excluding GST (18% GST added on top)** or **Including GST**.

## Actions available in `2 Potential`

| Action Button | When to Use | What Happens |
| --- | --- | --- |
| **Confirm Payment** / **Send to Accounts** | Customer has paid (full or part payment) or committed to invoice terms. | Opens the payment submission dialog and sends the deal to Accounts (`paymentWorkflow: 'CONFIRMATION_PENDING'`). |
| **Send to Onboarding** | Accounts has confirmed the payment and unlocked onboarding progression. | Transitions the customer record into **3 Customer onboarding** (`stage: 'ONBOARDING'`). |
| **Customer backed out** | Prospect delays the purchase, cancels before paying, or renegotiates scope. | Safely returns the customer record from **2 Potential** back to **1 Leads** with a mandatory reason logged in **Conversations**. |

## Returning a deal when the customer backs out

If a prospect in **2 Potential** decides to postpone or cancel before payment is verified:
1. Open the customer in **My Leads > 2 Potential**.
2. Click **Customer backed out**.
3. Enter a brief note explaining why the customer paused or backed out (for example, *Postponed WhatsApp API launch until next quarter budget approval*).
4. Confirm the action. The record moves back to **1 Leads** with all historical notes and contact details intact.

## What you should see

:::result
When promoted to **2 Potential**, the lead disappears from **1 Leads** and appears in **2 Potential** with its agreed deal value, service chips, and **Confirm Payment** action buttons.
:::

## Good to know

:::important Deal Value Requirement
You cannot move a customer to **2 Potential** with an empty or ₹0 deal amount. The database enforces this rule so unpriced enquiries never distort pipeline forecasts.
:::

:::tip Single Customer Record Guarantee
Moving a customer between **1 Leads**, **2 Potential**, and **3 Customer onboarding** updates the stage of the same database record—never duplicating the customer or losing conversation history.
:::

## If something goes wrong

- **"Deal amount is required to move to Potential"**: Enter a positive integer in **Deal Amount (₹)** and retry.
- **"Select at least one service"**: Select at least one service chip in the service picker before saving.
- **Record is locked in Potential**: While `paymentWorkflow` is `CONFIRMATION_PENDING` (waiting on Accounts), commercial fields are locked so figures cannot change mid-verification.
