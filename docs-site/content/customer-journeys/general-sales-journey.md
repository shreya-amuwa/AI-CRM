---
title: The General Sales Journey
description: Step-by-step walkthrough of the standard customer route through Sales, Accounts, Technical Consultant, and Delivery.
order: 20
roles: [Sales Team Member, Accounts Staff, Technical Consultant, Department Head]
audience: internal
status: verified
sources: [docs/SERVICE_JOURNEYS.md, docs/LEADS_ONBOARDING.md, docs/TECHNICAL_CONSULTANT.md]
related: [customer-journeys/overview, sales/customer-onboarding-sales, accounts/payment-confirmation-queue]
updated: 2026-10-19
---

The General Sales Journey is the primary operational route for business units such as Wabastore, Whatsbox, and Dtalk, where services require technical provisioning and document verification.

## Before you start

:::prereq
- You must understand the transition criteria required at each stage boundary.
- An agreed deal amount and at least one service must be selected before submitting to Accounts.
:::

## Complete stage breakdown

```flow
1. Inbound Lead Claim / Creation | Sales Team Member | My Leads > Add Lead (or Inbound Leads)
2. Lead Qualification | Sales Team Member | Status: NEW -> CONTACTED -> INTERESTED -> READY_TO_BUY
3. Move to Potential | Sales Team Member | Enters deal amount; moves to Potential queue
4. Send to Accounts | Sales Team Member | Chooses tax basis; customer locks in PENDING_PAYMENT_CONFIRMATION
5. Payment Verification | Accounts Staff | Verifies payment in ledger; customer moves to ONBOARDING
6. Requirements Collection | Sales Team Member | Collects Business Basics, Service Items, and Mandatory Docs
7. Send to Technical Consultant | Sales Team Member | Unlocked once all required checklist items are saved
8. Technical Review & Client Login | Technical Consultant | Authorizes items, provisions client login, configures webhooks
9. Department Handover | Department Head & Team Lead | TC sends to Department Head -> Team Lead -> Team Member
10. Active Delivery | Delivery Department | Webstore, Meta, or Studio teams execute active campaigns
```

### Stage 1: Lead Creation & Qualification
- The salesperson creates a lead manually or claims an inbound webhook enquiry.
- Conversations are logged under **Lead Details > Conversations**.
- The salesperson selects interested services (e.g. `WABA_SETUP`, `BLUE_TICK_VERIFICATION`).

### Stage 2: Move to Potential
- When commercial terms are established, the salesperson sets the **Deal Amount** (agreed price).
- The salesperson clicks **Save & move to Potential**.
- The record moves to the **Potential** queue.

### Stage 3: Send to Accounts
- The salesperson clicks **Send to Accounts**.
- The dialog asks whether the amount includes GST:
  - **Excluding GST** (the dialog starts here): the amount is before GST (e.g. ₹1,00,000 + 18% GST = ₹1,18,000 total payable).
  - **Including GST**: the amount already includes GST.
- The salesperson enters an optional note and confirms submission.
- The customer is locked from editing while Accounts reviews the deal.

### Stage 4: Accounts Payment Confirmation
- Accounts reviews the customer under **Accounts > Confirmation**.
- Accounts records the received payment (full or part payment) with payment method, date, and reference.
- Accounts clicks **Confirm Payment & Return to Sales**.
- The customer lifecycle advances to `ONBOARDING` and the payment workflow updates to `PAYMENT_CONFIRMED`.

### Stage 5: Document Collection & Checklist
- The salesperson opens the customer in **Customer onboarding**.
- The page renders a dynamic checklist based on the sold services:
  - **Business Basics**: Business name, address, GSTIN, Udyam certificate.
  - **Service Specifics**: Facebook Business Manager ID, website URL, brand assets.
  - **Mandatory Documents**: System invoice (linked by Accounts) and Important Documents.
- Once all mandatory items have status `SAVED`, the **Send to Technical Consultant** button unlocks.

### Stage 6: Technical Consultant Review
- The Technical Consultant opens **Onboarding Customers**.
- Each item is reviewed with **Authorize** or **Not authorized** (with mandatory reason).
- The consultant creates the client's self-service login in **Client panel login**.
- Once all items are authorized and the login exists, the consultant clicks **Send to Department Head**.

### Stage 7: Handover & Delivery
- The Department Head assigns the customer to an active Team Lead.
- The Team Lead assigns the customer to an active Relationship Manager (Team Member).
- The customer reaches `CUSTOMER` status and active service management begins.

## What you should see

:::result
At the end of this journey, the customer has:
- A verified financial ledger in Accounts.
- Fully authorized compliance documents.
- An active client portal account.
- An assigned Relationship Manager.
:::

## Good to know

:::tip Real-time Handover Notifications
Every participant in the chain receives an immediate notification bell alert when a customer is handed over to their queue.
:::

## If something goes wrong

If an item is rejected during technical review, see [Managing Returned Leads](/sales/managing-returned-leads).
