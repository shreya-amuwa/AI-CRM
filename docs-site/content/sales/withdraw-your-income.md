---
title: Withdraw your income - ask Accounts to pay your incentive balance
description: How Sales staff save their payout details, ask for a withdrawal from the Wallet, follow it and download the payout slip.
order: 42
group: Income
roles: [Telecaller, Business Associate, Sales Team Member, Team Lead, Department Head, Operations Head]
audience: internal
status: verified
sources: [src/components/wallet/WalletPage.tsx, src/components/income/WithdrawDialog.tsx, src/components/income/PayoutDetailsForm.tsx, supabase/migrations/20270123000100_incentive_payouts.sql]
related: [sales/my-income, accounts/pay-payout-requests]
updated: 2026-11-26
---

Withdrawals are in your **Wallet** (My Income moved there): open **Wallet**, enter your Wallet PIN and go to **Withdrawals**. The top card shows what you can still take out (**Available for withdrawal**); you ask for a withdrawal there, and Accounts sends the money and records it.

## Before you start

:::prereq
- Withdrawals open a number of days after the joining date HR recorded for you (15 days unless the Super Admin changed it). Until then the Wallet shows **Withdrawals open on** with the date, or **Withdrawals open 15 days after HR records your joining date.** if HR has not recorded it yet.
- You need at least ₹500 available.
:::

## Steps

1. Open **Wallet**, enter your Wallet PIN, go to **Withdrawals** and click **Payout details**.
2. Choose **Bank account** (account holder name, account number, IFSC), **UPI** (UPI ID) or **Other (outside India)** (bank name, account or IBAN, SWIFT code and country). The PAN is optional. Click **Save details**.
3. Click **Withdraw**, enter the **Amount (₹)** and click **Request withdrawal**.
4. Follow it under **Withdrawals**: **Waiting for Accounts**, then **Being sent** if Accounts sent it through Razorpay, then **Paid** with the reference; or **Rejected** with the reason. **Failed** or **Reversed** means the bank did not take it: the amount is available again, so check your details and ask again. While it is waiting you can click **Cancel withdrawal**.
5. When it is paid, click **Download slip** for your payout slip (PDF).

## What you should see

:::result
- While a withdrawal is waiting, **Available to withdraw** is lower by its amount and **Withdraw** is switched off.
- When it is paid, **Withdrawn so far** goes up. If Accounts deducted TDS, the list and the slip show the amount, the TDS and the net paid.
:::

## Good to know

- One withdrawal at a time, at least ₹500, and no more than what is available.
- Accounts pays to the details you had when you asked. If you change your details while a withdrawal is waiting, Accounts is told, and pays to the details shown on the request.
- If a sale's payment is reversed after you were paid, its incentive is taken back from your future earnings. The Balance block then shows the amount **to be recovered from future incentives**, and you can withdraw again once new earnings cover it.
- If you leave the company with money still available, Accounts pays it to you as a final settlement.

## If something goes wrong

- **Add your payout details first.** - save your bank account, UPI ID or international details before asking.
- **You can withdraw up to ...** - you asked for more than is available.
- **You already have a withdrawal waiting.** - cancel it or wait until Accounts pays it.
