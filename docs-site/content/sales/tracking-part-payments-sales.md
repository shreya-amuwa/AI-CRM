---
title: Tracking Part-Payment Customers in Sales
description: Monitoring customer payment installments, verified funds, and outstanding balances from the Sales Panel.
order: 80
roles: [Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts]
related: [customer-journeys/part-payment-journey, sales/customer-onboarding-sales]
updated: 2026-10-19
---

The Sales Panel provides a dedicated overview of customers who have paid an initial deposit and have outstanding contract balances.

## Before you start

:::prereq
- The customer must have at least one payment verified by Accounts and a remaining balance greater than ₹0.
:::

## Viewing part payments

1. In the sidebar, navigate to **Sales dashboard > Part payments**.
2. The table displays every customer in your assigned territory currently carrying an active balance.

## Table columns explained

| Column | Description |
| --- | --- |
| **Customer / Business** | Customer name, company, and contact phone number. |
| **Services** | Badges showing all purchased services. |
| **Deal Value** | The total agreed order value (GST inclusive or exclusive based on contract). |
| **Amount Verified** | Real money received and verified by Accounts. |
| **Outstanding Balance** | Total deal value minus verified payments ($$\text{Deal Amount} - \text{Amount Verified}$$). |
| **Last Payment** | Date and amount of the most recent verified installment. |
| **Salesperson** | The team member who originally submitted the deal. |

## What you should see

:::result
Clicking any customer opens their quick view card showing the breakdown of verified installments versus pending balances, along with the customer's current onboarding status.
:::

## Good to know

:::important Read-Only Boundary
In the Sales Panel, the Part Payments view is **read-only**. Salespersons cannot add payment follow-up notes or mark payments verified here; collection follow-ups are audited by the Accounts Department in their dedicated balance workspace.
:::

:::tip Automatic Balance Clearing
When Accounts confirms the final balance payment, the customer automatically moves out of this active view.
:::

## If something goes wrong

If an installment paid by a customer is not reflected in the **Amount Verified** column, check with Accounts to ensure the transaction reference has been verified on the bank statement.
