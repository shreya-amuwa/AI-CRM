---
title: Finance Ledger, Expenses, and Monthly Plans Management
description: Monitoring corporate cash flow in Account Overview and Income, logging expenses, reviewing Department Income cards, and managing recurring Monthly Plans.
order: 80
group: Finance & Reports
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts, src/components/accounts/finance/AccountsOverview.tsx, src/components/accounts/finance/AccountsIncome.tsx, src/components/accounts/finance/AccountsDepartmentIncome.tsx, src/components/accounts/finance/AccountsExpenses.tsx, src/components/accounts/AccountsPlans.tsx]
related: [accounts/recording-payments, accounts/business-reports-attribution]
updated: 2026-10-27
---

The Accounts Dashboard provides complete visibility into company cash flow, itemized income ledgers, operational expenses, department earnings, and recurring **Monthly Plans**.

## Before you start

:::prereq
- Sign in with an **Accounts Staff**, **Department Head**, or **Super Admin** account.
- Financial totals reflect verified customer payments (`VERIFIED`) and recorded operational expenses.
:::

## Financial overview and ledger tabs

### 1. Account Overview (`Accounts > Account Overview`)

Displays executive cash-flow KPIs and 12-month comparative charts:

- **Verified Collections (Gross Income)**: Sum of all verified payments across initial sales, add-ons, renewals, and monthly plans.
- **Approved / Recorded Expenses**: Sum of corporate and department operational expenditures.
- **Net Cash Position (Total Net Earnings)**: Computed directly from verified ledger entries:

```
Net Cash Position = Verified Collections - Approved Expenses
```

- **12-Month Trend Charts**: Monthly comparison of verified collections versus operational expenses and net cash position.

### 2. Income Ledger (`Accounts > Income`)

Provides the itemized ledger of every verified incoming payment across the organization:

- Filterable by date range, business department, payment method (`UPI`, `Bank Transfer`, `Card`, `Cash`, `Cheque`), and customer search.
- Each row shows the customer code, business name, attributed department, payment method, UTR / reference number, taxable amount and GST breakdown (where recorded), and the accountant who verified the funds.

### 3. Department Income Cards (`Accounts > Department Income`)

Displays visual financial performance cards for each revenue-generating business unit (such as **Wabastore**, **Whatsbox**, **D Talk**, **Digitree**, **Mpillar**, and **Design Studio**):

- Administrative, non-revenue departments (such as Accounts, HR, and Education & Training) are automatically excluded from revenue cards.
- Clicking a department card drills down into that unit's verified collections versus department-specific expenses.

![Accounts Department Income view showing revenue cards and financial metrics per business unit](shot:accounts-department-income.png)

### 4. Expenses Management (`Accounts > Expenses`)

Tracks both company-wide overheads (such as cloud hosting, rent, and utilities) and department-specific expenses (such as ad spend or software licenses).

## Steps to record an operational expense

1. In the sidebar, open **Accounts > Expenses** and click **+ Add Expense**.
2. Fill in the expenditure details:
   - **Date**: Date the expense was incurred.
   - **Department**: Select a specific business unit or choose **Company-wide**.
   - **Category**: Choose `Software`, `Infrastructure`, `Marketing`, `Office`, `Travel`, `Utilities`, or `Other`.
   - **Amount (₹)**: Enter the expenditure amount in Rupees.
   - **Status**: Select `PAID` or `PENDING`.
   - **Notes**: Enter the vendor name, invoice/bill reference, and purpose.
3. Click **Save Expense**.

## Managing recurring subscriptions in Monthly Plans (`Accounts > Monthly Plans`)

The **Payments > Monthly Plans** tab (`src/components/accounts/AccountsPlans.tsx`) enables Accounts to manage the catalog of recurring subscription plans and approve client plan purchases:

1. **Create or Edit Subscription Plans**:
   - Open **Accounts > Monthly Plans** and click **Create Plan** (or click **Edit** on an existing plan).
   - Configure the **Plan Name**, **Department / Service Category**, **Billing Cycle** (monthly, quarterly, or annual), **Base Price (₹)**, **GST Rate (%)**, and included feature deliverables.
   - Toggle whether the plan is active and visible for self-serve purchase in the Client Portal.
2. **Approve Client Plan Requests & Record Plan Payments**:
   - When a customer subscribes to or requests a plan from their Client Portal, the request appears in **Accounts > Monthly Plans**.
   - Verify the customer's payment reference against your bank statement, click **Confirm Plan Payment**, and activate the subscription period (`customer_plans`).

```flow
Configure Plan Catalog | Accounts Staff | Creates or edits recurring plans in Accounts > Monthly Plans
Client Requests / Pays Plan | Client Portal | Subscription request appears in Monthly Plans queue
Verify Funds & Activate | Accounts Staff | Confirms payment; plan activates and credits revenue ledger
Log Operational Expenses | Accounts Staff | Records vendor costs in Accounts > Expenses
Update Net Cash Position | System | Recalculates Verified Collections minus Approved Expenses
```

## What you should see

:::result
New expenses and verified plan payments immediately update **Account Overview**, **Department Income**, and the **Net Cash Position** indicator without requiring a page reload.
:::

## Good to know

:::note Expense Edit Permissions
Accounts staff members can edit or delete expense entries they personally created. Accounts Team Leads, Department Heads, and Super Admins can edit or remove any expense entry.
:::

## If something goes wrong

- If **Net Cash Position** looks lower than expected, filter **Accounts > Expenses** by status and date range to check for recently logged bulk or pending vendor expenses.
