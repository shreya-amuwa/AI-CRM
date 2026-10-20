---
title: How to Qualify a Lead and Move to Potential
description: Progressing a qualified lead with an agreed commercial value into the Potential stage.
order: 40
roles: [Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/PotentialView.tsx, docs/LEADS_ONBOARDING.md]
related: [sales/creating-a-lead, sales/sending-to-accounts]
updated: 2026-10-19
---

When a lead expresses clear buying intent and you have agreed upon commercial pricing, qualify the lead by moving it to the **Potential** stage.

## Before you start

:::prereq
- You must agree on a commercial price with the prospect.
- The lead must have at least one service selected from the catalog.
:::

## Steps

1. In **My Leads > 1 Leads**, locate the qualified lead and click **Edit**.
2. Scroll to the **Deal Information** section:
   - In the **Deal Amount (₹)** field, enter the total agreed contract value (e.g. `120000`). No decimals or paise are permitted.
   - Verify that the **Interested Services** checkboxes accurately reflect the agreed package.
3. Update the lead status to `READY_TO_BUY` or `INTERESTED`.
4. Click the button: **Save & move to Potential**.

```flow
Enter Deal Value | Salesperson | Must be greater than ₹0
Select Services | Salesperson | At least 1 service required
-> Deal Amount Missing | Refused | Validation error prompts for deal value
Move to Potential | Database RPC | lifecycle_stage set to POTENTIAL
Move Complete | System | Customer relocates to "2 Potential" queue
```

## What you should see

:::result
The lead disappears from the **1 Leads** list and appears in **2 Potential**. The sidebar counter for Potential increments by one. The customer card now displays the deal value, expected close timeline, and payment preparation tools.
:::

## Good to know

:::important Deal Value Requirement
You cannot move a customer to Potential with an empty or ₹0 deal amount. The database enforces this rule to ensure that unpriced inquiries do not clutter financial forecasts.
:::

:::tip Single Record Guarantee
Moving a lead to Potential does not duplicate or recreate the record. The customer keeps their existing ID, documents, contact history, and ownership.
:::

## If something goes wrong

- **"Deal amount is required to move to Potential"**: Enter a positive integer in the Deal Amount field and retry.
- **"Select at least one service"**: Check the appropriate service checkboxes in the service picker.
