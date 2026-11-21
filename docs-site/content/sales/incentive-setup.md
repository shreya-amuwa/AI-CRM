---
title: Incentive setup - rules, amounts for your team and the telecaller split
description: How the Super Admin creates, edits, stops and deletes incentive rules, how heads and Team Leads pass amounts down, and how the Sales Department Head sets the telecaller and Business Associate split.
order: 41
group: Income
roles: [Super Admin, Operations Head, Department Head, Team Lead]
audience: internal
status: verified
sources: [src/components/income/IncentiveSetup.tsx, src/components/business-associate/DemoSchedulePage.tsx, src/lib/income.ts, supabase/migrations/20270119000100_sales_incentives.sql, supabase/migrations/20270120000100_incentive_setup_given.sql]
related: [sales/my-income, sales/business-associate-workspace]
updated: 2026-11-21
---

Incentives are set in two steps. The Super Admin decides what each product pays and gives it to an Operations Head. Each level then decides what the people directly below it get, and keeps the difference. Demo and field visit rewards are fixed amounts the Super Admin gives straight to the people chosen.

```flow
Create a sales rule | Super Admin | product, amount per unit, Operations Head
Set the Department Head's amount | Operations Head | never more than what they get
Set each Team Lead's amount | Department Head | keeps the difference
Set each member's amount | Team Lead | keeps the difference
Payment verified | Accounts | everyone in the chain earns their share
```

## Before you start

:::prereq
- **Super Admin**: open **Sales Incentives** under **Company**.
- **Sales Operations Head** and **Sales Department Head**: open **Incentive setup** in the sidebar.
- **Sales Team Lead**: open **Incentive setup** under **Income**.
:::

## Steps for the Super Admin

1. Click **New rule**.
2. Enter a **Name** and choose what it is **For**: **Sale paid**, **Demo completed** or **Field visit completed**.
3. For a sale, choose the **Product**, the **Amount per unit for the Operations Head (₹)**, the **Operations Head** and, if you want, **Target units (optional, a goal only)**.
4. For a demo or a field visit, enter the **Amount per event (₹)**, choose **Who it is for** (everyone at a level, a sales role, a department, a team or one person) and, if you want, a **Monthly cap per person (₹, optional)**.
5. Click **Create rule**.
6. To change a rule, click **Edit**, change it and click **Save**.
7. To stop a rule, click **Stop**. To remove it, click **Delete**.
8. Under **When incentives start**, set **Days in the company** and click **Save**.

## Steps for heads and Team Leads

1. Each sales rule that reaches you shows what you get per unit.
2. For each person directly below you, enter the amount in **Gets per unit (₹)** and click **Save**.
3. **You keep** shows the difference, which you earn on their sales.

## Steps for the Sales Department Head: the split

1. Under **Telecaller and Business Associate split**, enter the **Telecaller's share (%)**. The Business Associate's share is shown next to it.
2. Click **Save**.

## What you should see

:::result
- A new rule is listed with its amount and who it is for. Stopped rules leave the list; tick **Show stopped rules** to see them.
- After you save an amount for someone, **You keep** shows your share.
:::

## Good to know

- **Editing a name, target or monthly cap** changes the rule as it is.
- **Editing the amount, the product or who it is for** applies from now on: the screen says **This change applies from now on**. The current version stops and a new one starts with the same name. A sales rule with the same product and Operations Head keeps the amounts already passed down. With a different product or Operations Head, every level must set its amounts again; until they do, the people below earn nothing from that rule. Earnings already recorded keep the amount they were earned at.
- An edit never lifts a limit: an order never earns more than 100% of its incentive, and a reward's monthly cap counts what was earned before the edit.
- A rule that starts later shows **Starts** with its date and can be edited.
- **Delete** removes a rule nobody has earned from yet. A rule with earnings is stopped instead, because earned money is never erased; the screen says so.
- Only one sales rule per product can be in force for an Operations Head. To change it, edit it.
- An amount you pass down can never be more than what you get. The screen shows the message **The amount must be between 0 and ...** with your own amount.
- A demo earns its reward only when it is **Completed** and **The client's authorised person attended** is ticked. The Business Associate ticks it when marking the demo completed, or later from the demo's details in **Demo Schedule**.
- Every change is recorded in the audit log.

## If something goes wrong

- **A sales incentive for this product is already in force for this Operations Head.** - edit the rule in force instead of adding a second one.
- **Only the Super Admin sets incentive rules.** - only the Super Admin creates, edits, stops or deletes rules.
- **This rule has ended; create a new one instead.** - a stopped rule cannot be edited.
