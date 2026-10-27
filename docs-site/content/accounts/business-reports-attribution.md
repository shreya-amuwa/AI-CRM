---
title: Department Income by Division, Business Reports, and Revenue Attribution
description: Understanding All Departments vs Income by Division, the immutable revenue_attributions model (ACQUISITION, SALES, CLIENT_DASHBOARD), and Wabatalk/D Talk mapping.
order: 90
group: Finance & Reports
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/BUSINESS_REPORTING.md, docs/DEPARTMENT_INCOME.md, shared/contracts.ts, src/components/reports/DepartmentIncome.tsx, src/components/reports/BusinessReports.tsx, supabase/migrations/20261114000100_revenue_attribution.sql]
related: [accounts/finance-and-expenses, accounts/payment-confirmation-queue, super-admin/company-business-oversight]
updated: 2026-10-27
---

Amuwa AI CRM tracks corporate revenue using an immutable, order-level **Revenue Attribution** engine (`revenue_attributions`). Every verified rupee is attributed both to a business **Department** and to the earning **Division** (**Sales** vs **Support**), surfaced across **Department Income**, **Income by Division**, and **Business Reports**.

## Before you start

:::prereq
- Sign in with an **Accounts Staff**, **Department Head**, or **Super Admin** account.
- Use **Accounts > Department Income** for business-unit cards, **Accounts > Income by Division** (`DepartmentIncome.tsx`) for division/source attribution, and **Accounts > Business Reports** (`BusinessReports.tsx`) for employee-level leaderboards.
:::

## Department Income vs Income by Division

The Accounts sidebar provides two complementary department revenue views:

1. **Department Income (`All Departments` view - `AccountsDepartmentIncome.tsx`)**:
   - Displays visual summary cards for all revenue-generating departments (**Wabastore**, **Whatsbox**, **D Talk**, **Digitree**, **Mpillar**, **Design Studio**), comparing total verified collections against department expenses.
2. **Income by Division (`DepartmentIncome.tsx`)**:
   - Breaks down every department's revenue by **who earned it** (**Sales** vs **Support**), **taxable value vs GST**, and **why it was attributed** (`By source`), with filters for **All departments** or a single department and date presets (**This month**, **Last 30 days**, **All time**).

## The `revenue_attributions` model

Defined in `supabase/migrations/20261114000100_revenue_attribution.sql`, the CRM records attribution **once per order** (`SALE:<customer>`, `ADDON:<request>`, `INV:<invoice>`, `PLAN:<plan>`) when the order is created. Later changes to a customer's assigned owner, team, or department never rewrite historical revenue attribution.

| Attribution Source | Order Type | Division & Department Credited | Rule & Special Handling |
| --- | --- | --- | --- |
| **`ACQUISITION`** | Initial customer sale (`SALE:<customer>`) | **100% to the acquiring division (`SALES` or `SUPPORT`)** and acquiring department (`customers.acquisition_department_id`) | Recorded when the lead/customer is created based on the creator's team division. For **D Talk**, leads and sales originated by its Support division are attributed to **Wabatalk**'s Support division where configured. |
| **`DEFAULT_SALES` / `SALES`** | Pure Sales-led initial deal | **100% to the Sales division (`SALES`)** | Credits the Sales division and the salesperson who submitted the deal for confirmation (`payment_requests.requested_by`). |
| **`SUPPORT_ADDON`** | Add-on request (`ADDON:<request>`) | **100% to the Support division (`SUPPORT`)** | Credits the Technical Consultant or Support member who submitted the add-on proposal. |
| **`SUPPORT_INVOICE`** | Additional invoice tagged as Renewal or Add-on (`INV:<invoice>`) | **100% to the Support division (`SUPPORT`)** | Credited when Accounts tags an additional invoice as a **Renewal** or **Add-on** and links the responsible Support member. |
| **`CLIENT_DASHBOARD` (`CLIENT_PORTAL`)** | Self-serve Client Portal purchase (`ADDON` or `PLAN`) | Governed by the Super Admin **Client Dashboard purchase attribution rule** | Attributed according to the active rule in `revenue_attribution_settings` (`SUPPORT` by default, `ACQUISITION` / `ORIGIN`, `SALES`, or split/custom policies configured by Super Admin). Changing the rule affects new orders only. |
| **`MANUAL`** | Reconciled or corrected order | Chosen **Division** and **Department** | Corrected by Accounts or Super Admin with a mandatory audit reason (`reason`). |

```flow
Order Created | CRM Database |SALE, ADDON, INV, or PLAN order key generated
Check Commercial Origin | attribution_rule() | Reads customer acquisition_division and order kind
-> Acquired by Support / Referral | ACQUISITION (SUPPORT) | 100% credit to acquiring Support team (D Talk Support -> Wabatalk)
-> Pure Sales Deal | ACQUISITION / DEFAULT_SALES (SALES) | 100% credit to Sales division & salesperson
-> Add-on or Renewal | SUPPORT_ADDON / SUPPORT_INVOICE | 100% credit to Support division & consultant
-> Self-Serve Portal Purchase | CLIENT_DASHBOARD | Follows Super Admin Client Dashboard attribution rule
Lock Attribution Row | revenue_attributions | Immutable across future owner or department transfers
```

## Reviewing Income by Division and reconciling orders

1. Navigate to **Accounts > Income by Division**.
2. Review the top KPI tiles:
   - **Collected**: Total confirmed payments (GST included).
   - **Taxable value collected**: Net revenue collected alongside the **GST** total.
   - **Pending**: Recorded payments awaiting verification.
   - **Outstanding**: Remaining receivable on billed orders.
3. Inspect the division highlight cards:
   - **Sales**: First sales of customers acquired by Sales.
   - **Support**: Add-ons, renewals, monthly plans, and first sales of Support-acquired customers.
   - **Add-ons attributed to Support**, **Support referrals**, **Bought in the Client Dashboard**, and **All sales of Support-acquired customers**.
4. Scroll to the **Orders** and **Reconciliation (`needs_review`)** tables:
   - If a legacy order or unclassified invoice is flagged as needing review, click **Correct attribution**, choose the rightful **Division** (`Sales` or `Support`) and **Department**, enter a mandatory audit **Reason**, and click **Save**.

## Reviewing employee leaderboards in Business Reports

Navigate to **Accounts > Business Reports** for three executive tabs:

- **Overview Tab**: Company-wide collected, pending, outstanding, and refunded totals broken down by department.
- **Sales Tab**: Salesperson performance leaderboard (orders, billed value, verified collections) and chronological Sales transaction ledger.
- **Support Tab**: Support member and Technical Consultant leaderboard tracking Add-on revenue, Renewal revenue, and Monthly Plan subscription revenue.

## What you should see

:::result
Every verified payment is attributed to the exact division, department, and employee that earned it, with taxable value separated from GST and full audit history preserved.
:::

## Good to know

:::important Attribution Immutability on Handover
When a customer moves from Sales to Technical Consulting or is reassigned to a delivery department, `customers.acquisition_division`, `acquisition_department_id`, and `revenue_attributions` remain locked to the original acquiring team so historical revenue never shifts between departments.
:::

## If something goes wrong

- If an additional invoice appears as unclassified in **Business Reports**, open **Accounts > Invoices**, locate the prompt **What is this additional invoice?**, tag it as **Renewal** or **Add-on**, and select the responsible Support team member.
