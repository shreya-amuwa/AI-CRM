---
title: Your income is in the Wallet - see what you earn from incentives
description: My Income moved into the Wallet. Where Sales staff now find today, this month, the balance, targets, activity and every earning.
order: 40
group: Income
roles: [Telecaller, Business Associate, Sales Team Member, Team Lead, Department Head, Operations Head]
audience: internal
status: verified
sources: [src/components/wallet/WalletPage.tsx, src/components/wallet/WalletActivity.tsx, src/components/wallet/WalletPinGate.tsx, supabase/migrations/20270221000100_wallet_pin_income.sql, src/lib/income.ts, supabase/migrations/20270119000100_sales_incentives.sql, supabase/migrations/20270121000100_incentive_setup_given.sql]
related: [sales/incentive-setup, sales/business-associate-workspace]
updated: 2026-11-26
---

**My Income** is no longer a separate page: everything it showed is in your **Wallet**, which is in the sidebar of every dashboard and protected by your Wallet PIN. Each amount appears the moment it is earned: when Accounts verifies a customer's payment, when a demo is completed with the client's authorised person, or when a field visit is completed. An old **My Income** link or bookmark opens the Wallet.

## Before you start

:::prereq
- You are an active member of a Sales team: Telecaller, Business Associate, Sales Team Member, Team Lead, Sales Department Head or Sales Operations Head.
- The Super Admin has set at least one incentive rule that reaches you. Until then the figures are zero.
- The first time you open the Wallet you set a 6-digit Wallet PIN; afterwards you enter it once per sign-in.
:::

## Steps

1. Open **Wallet** in the sidebar and enter your Wallet PIN.
2. The top card shows your **Wallet balance**, **Available for withdrawal**, pending money and **This month's incentives**.
3. On **Overview**, **Incentives and activity** shows **Earned today**, **Business this month**, **Demos completed**, **Field visits completed** (and **Calls this month** if you are connected to Crocodial) and your progress on each target, for example **412 of 1,000**.
4. **Incentives** lists every incentive credited to you and any reversal; **Earnings** shows month by month; **Transactions** can be filtered by type and dates.
5. To take money out, open **Withdrawals** (see *Withdraw your income*).
