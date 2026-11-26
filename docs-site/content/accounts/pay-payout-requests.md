---
title: Pay payout requests - incentive withdrawals of Sales staff
description: How Accounts pays, rejects and records Sales staff's incentive withdrawals, and pays a final settlement to someone who left.
order: 95
group: Finance
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [src/components/accounts/finance/PayoutRequests.tsx, supabase/migrations/20270123000100_incentive_payouts.sql, supabase/migrations/20270125000100_incentive_payouts_razorpay.sql, server/services/PayoutService.ts]
related: [sales/withdraw-your-income, accounts/finance-and-expenses]
updated: 2026-11-21
---

Sales staff withdraw the incentives they earned from **My Income**. Their requests arrive in **Accounts > Finance > Payout requests** (the number next to it is how many are waiting). You send the money from the company's bank or UPI, then record it here.

## Before you start

:::prereq
- You are in the Accounts department (or the Super Admin).
- You cannot pay your own withdrawal: another member of Accounts pays it.
:::

## Steps

1. Open **Payout requests**. **Requested** lists the withdrawals waiting.
2. Click a person. You see the amount asked for, what they withdrew before, what is still available, their recent earnings, and the details to pay to (use the copy buttons).
3. Send the **Net to pay** amount from the company account.
4. Enter the **Reference** (the UTR or UPI reference), **Paid on**, and the **TDS (₹)** you deducted (0 if none). **Net to pay** updates as you type.
5. Click **Mark paid**. To refuse instead, click **Reject**, enter the **Reason** and click **Confirm reject**.

**Through Razorpay** (when the company's RazorpayX is set up): instead of sending the money yourself, enter the **TDS (₹)** and click **Pay through Razorpay**. Confirm the amount and where it goes. The request moves to **Being sent**, then to **Paid** with the bank reference when Razorpay confirms it. If Razorpay refuses (for example the account balance is too low), you see its reason and the request is waiting again. On a request in **Being sent**, **Check status** asks Razorpay where it is. International details (**Other**) can only be paid by hand.

For someone who has left the company: open **Leavers**, click the person, pay the amount shown, enter the reference and click **Pay final settlement**.

## What you should see

:::result
- The request moves to **Paid** and the person is told. Each paid withdrawal is also recorded as a **Sales Incentive** expense of the person's department (company-wide if they have no department), so it appears in the expenses and in Department Income.
- **Download slip** gives the payout slip (PDF) of a paid withdrawal.
:::

## Good to know

- Pay to the details shown on the request: they are the details the person had when they asked, even if they changed them later (you are told when that happens).
- International details (**Other**) are paid by hand.
- **Failed**: Razorpay could not send it; the person is told and the amount is available to them again. **Reversed**: the bank returned a payout that was paid; its expense is removed and its slip reads VOID.
- TDS is recorded on the slip; the person's balance goes down by the full amount they asked for.

## If something goes wrong

- **This withdrawal was already handled.** - another member of Accounts paid or rejected it first. Nothing more to do.
- **You cannot pay your own withdrawal.** - ask a colleague in Accounts.
- **TDS must be at least 0 and less than the amount.** - check the TDS.
