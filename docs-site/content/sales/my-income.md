---
title: My Income - see what you earn from incentives
description: How Sales staff read the My Income page - today, this month, total and balance, targets, activity and the list of earnings.
order: 40
group: Income
roles: [Telecaller, Business Associate, Sales Team Member, Team Lead, Department Head, Operations Head]
audience: internal
status: verified
sources: [src/components/income/IncomePage.tsx, src/lib/income.ts, supabase/migrations/20270119000100_sales_incentives.sql, supabase/migrations/20270121000100_incentive_setup_given.sql]
related: [sales/incentive-setup, sales/business-associate-workspace]
updated: 2026-11-21
---

**My Income** shows what you have earned from sales incentives. It is in the sidebar of every Sales dashboard. Each amount appears the moment it is earned: when Accounts verifies a customer's payment, when a demo is completed with the client's authorised person, or when a field visit is completed.

## Before you start

:::prereq
- You are an active member of a Sales team: Telecaller, Business Associate, Sales Team Member, Team Lead, Sales Department Head or Sales Operations Head.
- The Super Admin has set at least one incentive rule that reaches you. Until then the page shows zeros.
:::

## Steps

1. Open **My Income** in the sidebar. A Team Lead finds it under **Income**. The Sales Department Head and the Sales Operations Head find it next to **Department Income**, which still shows the department's business.
2. Read the four tiles: **Today**, **This month**, **Total earned** and **Balance**.
3. Under **Targets**, read your progress for each product, for example **412 of 1,000**.
4. Under the activity tiles, read **Business this month**, **Demos completed** and **Field visits completed**. If you are connected to Crocodial, **Calls this month** also shows your calls, connected calls and talk time.
5. Under **Your earnings**, choose **Last 30 days**, **Last 90 days** or **Last 12 months** to see each earning: the product and customer, what it was for (for example **Your sale** or **Team Lead share**) and the amount.

## What you should see

:::result
- A sale that Accounts verified in full shows its whole incentive. A part payment shows its share: half of the order paid means half of the incentive now, the rest when the next payment is verified.
- An earning whose payment was reversed is struck through and marked **Reversed**. It is no longer counted in the tiles.
:::

## Good to know

:::note Incentives start after your first days in the company
New employees earn incentives once they have been in the company for the number of days the Super Admin sets (15 days unless changed). Until then the page shows **Incentives start on** with the date. Work done before that date does not earn an incentive later.
:::

- A target is a goal only. Every sale earns from the first one.
- An incentive uses the amount in force when it was earned. A later change of the amount does not change past earnings.
- **Balance** is everything you have earned. Withdrawals are not available yet.

:::gap Not available yet
Withdrawing your balance through the Accountant comes in a later release.
:::

## If something goes wrong

- **The CRM is not connected to its database.** - the page could not reach the server. Click **Refresh**, or try again later.
- An earning you expected is missing: check with Accounts that the payment is verified. For a demo, check that it is **Completed** and that **The client's authorised person attended** is ticked.
