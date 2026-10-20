---
title: Tracking Income, Department Earnings, and Expenses
description: Monitoring corporate cash flow, reviewing department revenue, and recording operational expenses.
order: 80
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts]
related: [accounts/recording-payments, accounts/business-reports-attribution]
updated: 2026-10-19
---

The Accounts Dashboard provides real-time oversight of company income, department financial performance, and operational expenditures.

## Before you start

:::prereq
- Sign in with an Accounts Department Staff or Accounts Head account.
- Financial figures reflect actual verified payments and recorded expenses.
:::

## Financial overview sections

### 1. Account Overview
Located at **Accounts > Account Overview**, this dashboard displays corporate totals:
- **Total Gross Income**: Cumulative verified customer payments across all departments.
- **Total Expenses**: All recorded operational expenditures (paid and pending).
- **Total Net Earnings**: Net financial position ($$\text{Income} - \text{Expenses}$$).
- **12-Month Trends**: Comparative monthly charts showing income vs expenses and net profitability over time.

### 2. Income Ledger
Navigate to **Accounts > Income** to view the itemized ledger of every verified transaction:
- Filterable by date range, department, payment method (UPI, Bank Transfer, Card, Cash), and customer.
- Each row identifies the customer code, paying entity, receiving department, and the accountant who verified the funds.

### 3. Department Income
Navigate to **Accounts > Department Income** for business unit breakdowns:
- Displays dedicated financial cards for each revenue-generating unit (Wabastore, Whatsbox, Dtalk, Digitree, Mpillar, Design Studio).
- Non-revenue administrative departments (Accounts, HR, Education & Training) are excluded.
- Shows total income earned on the left versus expenses incurred on the right.

### 4. Expenses Management
Navigate to **Accounts > Expenses** to log and monitor corporate overheads:
- **Company-wide Expenses**: General operational costs not tied to a specific business unit (e.g. server hosting, office rent).
- **Department Expenses**: Specific overheads attributed to an individual team (e.g. ad spend, software licenses).

## How to record a corporate expense

1. Under **Accounts > Expenses**, click **+ Add Expense**.
2. Specify the expense details:
   - **Date**: The date of expenditure.
   - **Department**: Choose a specific business unit or select *Company-wide*.
   - **Category**: Select Software, Infrastructure, Marketing, Office, Travel, Utilities, or Other.
   - **Amount (₹)**: Expenditure amount.
   - **Status**: Mark as `PAID` or `PENDING`.
   - **Notes**: Vendor name, bill number, or justification.
3. Click **Save Expense**.

## What you should see

:::result
The expense is appended to the ledger, and the **Total Net Earnings** and department summary boxes recalculate immediately.
:::

## Good to know

:::note Edit Permissions
Staff members can edit or delete expenses they personally created. Accounts Team Leads and the Accounts Department Head have permission to modify any expense entry.
:::

## If something goes wrong

If net income seems lower than anticipated, check the **Expenses** table for pending, unfinalized expense entries.
