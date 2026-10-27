---
title: Accounts Dashboard Overview and Payment Confirmation Queue
description: Navigating the Accounts workspace, auditing Sales and Support payment submissions, verifying contract terms, and advancing customers to onboarding.
order: 10
group: Payments
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts, src/components/accounts/AccountsDashboard.tsx, src/components/accounts/AccountsConfirmations.tsx]
related: [accounts/recording-payments, accounts/issuing-an-invoice, sales/sending-to-accounts]
updated: 2026-10-27
---

The Accounts Dashboard is the central financial command center in Amuwa AI CRM. Every sale originated by Sales or Support is audited in the **Confirmation** queue before incoming funds are recognized as company income and technical onboarding begins.

## Before you start

:::prereq
- Sign in with an **Accounts Staff**, **Department Head**, or **Super Admin** account.
- Have access to your corporate bank statements or UPI merchant portal to cross-check UTR and transaction reference numbers.
:::

## Navigating the Accounts Dashboard

The left sidebar in `AccountsDashboard.tsx` organizes daily accounting workflows into dedicated sections, paired with top-bar actions:

| Sidebar Group | Tab Label | Purpose |
| --- | --- | --- |
| **Overview** | **Account Overview** | Real-time corporate cash flow summary, total verified collections, expenses, net cash position, and 12-month financial trends. |
| **Payments** | **Confirmation** | Primary audit queue (`CONFIRMATION_PENDING`) for new Sales and Support deal submissions awaiting payment verification. |
| **Payments** | **Business Verification** | Review queue for priced add-on requests submitted by Technical Consultants (`PENDING_VERIFICATION` and `APPROVED`). |
| **Payments** | **Part Payment** | Collections workspace for tracking customers with active installment balances and logging follow-up outcomes. |
| **Payments** | **Invoices** | Two-stage dynamic GST invoice builder, PDF uploader (up to **500 KB**), and paid-invoice stamping workspace. |
| **Payments** | **Monthly Plans** | Catalog management for recurring subscription plans and approval queue for client portal plan subscriptions. |
| **Finance** | **Income** | Itemized ledger of all verified customer payments with department, payment method, and date filters. |
| **Finance** | **Department Income** | Business-unit cards comparing verified collections and operational expenses across revenue-generating departments. |
| **Finance** | **Income by Division** | Granular revenue attribution breakdown across **Sales**, **Support**, add-ons, and self-serve Client Dashboard purchases. |
| **Finance** | **Expenses** | Corporate and department overhead ledger for recording paid and pending vendor expenditures. |
| **Finance** | **Business Reports** | Executive reporting across Overview, Sales performance, and Support renewal/upsell ledgers. |
| **Team & Top Bar** | **Chat**, **Notification Center**, **Leave Request** | Internal team messaging, real-time system alerts, and leave application management in the top header bar. |

![Accounts Payment Confirmation queue showing pending sales submissions, agreed tax basis, and verification controls](shot:accounts-payment-confirmations.png)

## Submission card overview in the Confirmation queue

When you open **Accounts > Confirmation**, each pending submission card displays:

- **Origin Division Badge**: Marked as **SALES** or **SUPPORT** alongside the submitting employee's name.
- **Agreed Amount & Tax Basis**: Shows the contract value agreed by Sales and whether it is `EXCLUSIVE` of GST (where GST is added on top) or `INCLUSIVE` of GST.
- **Purchased Services**: Service badges listing every product in the customer's order.
- **Salesperson's Notes & Proof**: Transaction reference numbers (UTR), payment screenshots/slips, or installment schedules recorded by the representative.
- **Last Conversation**: The most recent call or message note logged with the customer.

## Workflow procedure

```flow
Submission Arrives | Sales or Support | Appears in Accounts > Confirmation (CONFIRMATION_PENDING)
Inspect UTR & Proof | Accounts Staff | Compares bank statement with submitted transaction reference
Record & Verify Payment | Accounts Staff | Enters amount (and GST rate if EXCLUSIVE) and verifies ledger row
-> If Deal Fell Through | Accounts Staff | Clicks "Customer Backed Off" (only when zero verified payments exist)
Confirm & Advance | Accounts Staff | Clicks "Confirm Payment & Return to Sales"
Onboarding Unlocked | System | Customer moves to ONBOARDING; item "4. Payment Confirmation" auto-unlocks
```

## Steps to confirm a customer payment

1. In the sidebar, open **Accounts > Confirmation**.
2. Locate the customer submission card and click **Review Details**.
3. Verify that the funds have settled in the corporate bank account or payment gateway:
   - Match the UTR or UPI transaction reference number.
   - Confirm that the credited amount matches the customer deposit.
4. Click **Record payment** to log the received deposit in the ledger, and tick **I have received this money and verified it** (see [How to Record and Verify Payments in the Ledger](/accounts/recording-payments)).
5. Once at least one verified payment exists on the customer record, click the green **Confirm Payment & Return to Sales** button.
6. The system executes the confirmation workflow automatically:
   - Advances the customer status from `CONFIRMATION_PENDING` to `ONBOARDING`.
   - Marks `customer_onboarding.payment_verified = true`, which automatically satisfies checklist item **4. Payment Confirmation** for the onboarding team.
   - Routes the customer to the Technical Consultant's **Customers** intake panel (or prompts you to **Create client login** first for direct-delivery services).
   - Sends a real-time notification to the submitting salesperson.

## Rejecting a submission or handling a customer back-off

If the payment proof is invalid or the customer cancelled before paying:

1. Ensure **zero verified payments** exist on the customer's ledger (if a pending row was added in error, delete or leave it unverified).
2. Click **Customer Backed Off** (or return the request with an audit note).
3. Enter a clear reason explaining why the submission could not be confirmed (for example, *"UTR not found in HDFC statement"* or *"Cheque dishonored"*).
4. The customer returns to the salesperson's pipeline so they can follow up with the client.

## What you should see

:::result
The confirmed customer leaves the **Confirmation** queue, their verified payment is immediately reflected in **Account Overview** and **Income**, and checklist item **4. Payment Confirmation** is unlocked in the onboarding workspace.
:::

## Good to know

:::important Guard on Customer Backed Off
The **Customer Backed Off** action is strictly disabled once a verified payment exists in `customer_payments`. If verified funds were recorded in error, an Accounts Lead or Super Admin must reverse the ledger entry first.
:::

:::note Client Login for Direct Delivery Services
When a customer purchases direct-delivery services that bypass the Technical Consultant queue (such as Design Studio packages), Accounts is prompted to click **Create client login** before finalizing confirmation.
:::

## If something goes wrong

- If the amount on the bank statement differs from the sales submission because GST was added on top of a GST-exclusive agreement, check the tax basis badge and record the base amount plus GST rate in the payment modal. See [Payment and Balance Discrepancies](/troubleshooting/payment-and-balance-discrepancies).
