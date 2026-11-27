# Employee Wallet (phase 1)

Migration `supabase/migrations/20270207000100_employee_wallet.sql` (run after `20270205000100`; safe to run twice; nothing is deleted).
Tests: `supabase/tests/wallet_test.sql` (database, permission-denied cases included), `supabase/tests/ui_wallet.test.mjs` (the screens in a real browser, desktop and phone),
and one check in `ui_notice_board.test.mjs` (every dashboard shell has the Wallet entry).

## What it is, and what it deliberately is not
The Wallet is **one place where every employee sees what they earned, what is theirs to withdraw and what is on its way**. It is a *view over the money the
CRM already holds*, not a second money system:

| Money | Where it already lives | In the wallet |
| --- | --- | --- |
| Incentives | `earnings` (sales incentives, `20270119000100`): credited the moment a rule triggers, reversed when the payment is reversed | **Incentive Credit** / **Reversal** |
| Withdrawals | `payout_requests` (`20270123000100`, `20270125000100`): the employee asks, Accounts approves and pays (by hand or Razorpay) or rejects | **Withdrawal Request** / **Withdrawal Payment** |
| Bonuses, adjustments, refunds | nothing recorded them: **new `wallet_credits`** | **Bonus Credit**, **Wallet Adjustment**, **Refund** |
| Salary | only the free-text `hr_employees.monthly_salary`; the CRM has no payroll | shown as **expected salary**, "not credited, not withdrawable" |

Decisions taken with the owner: the wallet sits on top of what exists; salary is shown now and payroll comes in a later phase; incentives keep their instant credit
(there is no approval stage for them: the wallet shows them as *Credited*); only credited incentives and bonuses can be withdrawn.

## Balance
```
balance   = credited incentives + credited wallet credits - paid withdrawals       (a clawback can make it negative, as before: "to be recovered from future earnings")
available = balance - the open withdrawal request                                  (what may be requested: private.payout_available)
```
`private.payout_available` (used by the existing withdrawal flow) now also counts credited wallet credits. A pending or rejected credit, an open or cancelled
withdrawal and uncredited salary are never withdrawable. The withdrawal rules are unchanged and still re-checked in the database under a row lock: opens 15 days after the
HR joining date, minimum ₹500, one open request at a time, never more than available, an idempotent request id, Accounts approves and pays, nobody approves their own.

## The ledger
`wallet_transactions` is **derived, never typed in**: every row comes from `earnings`, `wallet_credits` or `payout_requests`, so the balance cannot change without leaving one of
those records (each is audited), and **the sum of the counted rows is always the balance** (the test checks it after every step). Fields: id, employee, type, amount
(signed), source, department, team, description, date, status, reference, created by, approved by, updated, and `countsInBalance`. Types: Salary Credit (reserved for
payroll), Incentive Credit, Bonus Credit, Wallet Adjustment, Withdrawal Request, Withdrawal Payment, Refund, Reversal. Paid withdrawals and credited items count; an open withdrawal
is reserved (off *available*, not yet off the balance); pending, rejected and cancelled ones count for nothing and are shown struck through.

## Wallet credits (bonus, adjustment, refund)
`wallet_credit_create` (Accounts and the Super Admin) -> `PENDING_APPROVAL` -> `wallet_credit_decide` by a **different Accounts person** (never the one who entered it, never the
employee) -> `CREDITED` or `REJECTED` (a reason is required). A bonus or refund is positive; an adjustment can be negative, and a deduction that would make the wallet negative is
refused at approval (the person's row is locked, as the withdrawal does). Idempotent: the same form sent twice is one credit (`request_id`), and the same `reference` is never
credited twice to one person. A decided credit can never be edited or deleted (trigger). Audited: `WALLET_CREDIT_CREATED`, `_CREDITED`, `_REJECTED`.

## Who sees what
- **Employee:** only their own wallet. The wallet functions take **no employee id**, so there is nobody else's wallet to ask for (`wallet_summary`, `wallet_transactions`, `wallet_monthly`).
  The Super Admin has no wallet (they are not payroll staff).
- **Accounts and the Super Admin:** enter and approve wallet credits; **Accounts, HR and the Super Admin** read the report (`wallet_report`): salary payable (HR figures), incentives generated /
  reversed / credited, pending incentive approvals (always 0), credits, withdrawal requests / pending / paid / rejected, department-wise, employee-wise and a monthly summary.
- **Team Leads and Department Heads:** nothing. No financial permission exists for them in the CRM and none was added; a role does not grant anyone else's financial data.
  Give one only with an explicit, audited permission in a later change.

## Notifications (the existing bell and push, kept while the person is offline, one per event)
Incentive credited (`WALLET_INCENTIVE_CREDITED`) and reversed (`WALLET_INCENTIVE_REVERSED`); bonus / adjustment credited (`WALLET_CREDIT_CREDITED`); withdrawal submitted
(`WALLET_WITHDRAWAL_SUBMITTED`) and approved / being processed (`WALLET_WITHDRAWAL_APPROVED`); withdrawal paid and rejected are the existing `PAYOUT_PAID` / `PAYOUT_REJECTED`.
For Accounts: a credit waiting (`WALLET_CREDIT_PENDING`); for the person who entered it: a rejected credit. Each has a dedupe key, so a repeat never notifies twice, and a
failure to notify never blocks Accounts or a withdrawal. Clicking one opens the Wallet (`issueEvents.ts`).

## Screens
- **Wallet** (`src/components/wallet/WalletPage.tsx`): in the side panel of every employee dashboard, below the Notice Board: the shared shell (`DashboardShell`, `__wallet`), the Team Member layout and the
  department sidebar (`my_wallet`). Main card: total balance, available for withdrawal, pending earnings, this month's salary (expected) and incentives. Tabs: Overview, Earnings (monthly),
  Incentives (pending / approved / credited / paid / reversed, and the list), Salary, Withdrawals (available, the rules, payout details, history with status, reason, processing date,
  cancel, slip; the existing `WithdrawDialog`), Transactions (type and date filters, pages, credit / debit / pending / paid indicators; a table on a wide screen, cards on a phone).
- **Wallet credits & report** (`WalletAdmin.tsx`): Accounts dashboard (Finance) and the Super Admin dashboard (Company > Wallet).
- Data access follows My Income and the payouts: the browser calls the database functions directly (the JWT is the caller; each function checks who it is). No Hono route was added.

## Not in phase 1 (and why)
- **Payroll.** The CRM records no salary structure, approvals, credits or payment dates; the wallet shows the HR monthly salary as *expected* and says "Not recorded" for the rest (basic /
  fixed / variable components, approved, credited, payment date, history). Salary Credit exists as a ledger type for the payroll phase. Salary is never withdrawable until credited.
- **Approval stage for incentives.** They credit instantly today; the wallet reports pending and approved incentives as 0 and says so.
- **New incentive sources** (Support, Business Developer, Business Partner...). Any new rule that writes to `earnings` (or a manual credit) appears in the wallet with no further work;
  `earnings` has only three event types (`SALE_PAID`, `DEMO_COMPLETED`, `VISIT_COMPLETED`). A department that earns in another way needs its own change to `earnings`, not to the wallet.
- **HR screen for the report and credits.** HR can read the report through the database function; a screen for HR (and HR entering credits) is a follow-up.
- **Team Lead / Department Head views** of their team's wallets (see above).

## Wallet PIN (migration `20270222000100_wallet_pin.sql`)
Design: `docs/superpowers/specs/2026-11-26-wallet-pin-design.md`.
- **First open:** the Wallet asks for a 6-digit PIN, entered twice. Not the same digit six times or a simple sequence (123456, 654321, 012345, 543210).
- **Afterwards:** the PIN is entered once per sign-in. The unlock is kept for that sign-in session (the access token's `session_id`) for 15 minutes,
  renewed while the Wallet is used; signing in again, or another device, asks again. **Lock wallet** ends it at once.
- **Wrong PINs:** 5 lock the Wallet for 15 minutes (`WALLET_PIN_LOCKED` in the audit log).
- **Change PIN:** the current PIN and the new one twice; other sign-ins must then enter the new PIN.
- **Forgot PIN:** `POST /api/v1/wallet/pin/forgot` e-mails a one-time 8-character code (30 minutes, 5 tries, one use, at most one a minute). The person types it in
  the Wallet with a new PIN. The code is made by `wallet_pin_reset_begin`, which only the API (service role) may call, so it never reaches a browser.
- **Security:** the PIN and the code are stored only as bcrypt hashes (`pgcrypto`); the tables have no grants. `wallet_summary`, `wallet_transactions` and
  `wallet_monthly` refuse with `WALLET_LOCKED` until the PIN was entered (`private.wallet_me()`), so the browser cannot skip the screen. Set, change, lock-out
  and reset are audited, never with the PIN or code.
- **The Managing Director** has no employee wallet and no PIN. Accounts' and HR's wallet screens (credits, report) are not behind a PIN.
- **My Income is in the Wallet** (migration `20270223000100_wallet_pin_income.sql`): the My Income menu entry is gone from every Sales dashboard; today's
  incentives, targets and this month's activity are on Overview (**Incentives and activity**). `income_summary`, `income_earnings` and the person's own
  withdrawal functions (`private.payout_me`) need the Wallet PIN of this sign-in once the person has set one (`private.wallet_pin_ok`); before a PIN is set
  there is nothing to protect, and the Wallet asks for one first. Any of them answering `WALLET_LOCKED` brings the PIN screen back (`src/lib/walletLock.ts`).
- Tests: `supabase/tests/wallet_pin_test.sql`, the Wallet PIN block of `api_integration.test.ts`, the PIN section of `ui_wallet.test.mjs`.
