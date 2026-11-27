# Sales incentives and "My Income" (phase 1)

Migrations `20270119000100_sales_incentives.sql` (database) and `20270121000100_incentive_setup_given.sql` (setup screens: edit, delete). Design: `docs/superpowers/specs/2026-11-20-sales-incentives-income-design.md`.
Payouts (withdrawing a balance through Accounts) are phase 2; until then the balance is everything earned.

## Rules (the Super Admin)
`incentive_rule_create(p jsonb)`: what it rewards (`SALE_PAID`, `DEMO_COMPLETED`, `VISIT_COMPLETED`), the amount, an optional target (a goal
shown as progress only), an optional monthly cap (event rewards), and who it is for:
- **Sales (`SALE_PAID`)**: a product (`crm_services.code`) and the Operations Head it is given to (amount per unit).
- **Event rewards**: a level (`DEPARTMENT_HEAD` / `TEAM_HEAD` / `TEAM_MEMBER`), a sales sub-role (`TELECALLER`, `BUSINESS_ASSOCIATE`, …), a
  department, a team or a person.
`incentive_rule_end` stops a rule at once (earnings already recorded stay). `incentive_rule_update(rule, changes)` (20270121000100):
the name, target and monthly cap change in place; a new amount, product or audience ends the old version and creates a new one with the
same name (a sales rule with the same product and Operations Head carries the allocations, capped at the new amount), so an earning always
keeps the rule and amount it was earned with. `incentive_rule_delete(rule)` removes a rule nobody earned from and only ends one with
earnings. A new version records the one it replaced (`replaces_rule_id`); a sale's 100% of the order counts every version of the product's rule for
that Operations Head, and an event reward's monthly cap counts every version (`private.incentive_lineage`). All Super Admin only, audited (`INCENTIVE_RULE_UPDATED`, `INCENTIVE_RULE_DELETED`). The start period (15 days in the company by
default) is `incentive_settings_set(days)`.

## The cascade (sales)
Each level passes an amount per unit to the level directly below (`incentive_allocation_set`), never more than it holds, and keeps the
difference: **Operations Head → Department Head (the department's Sales head) → Team Lead → Team Member**. The person who closed the sale
(the customer's owner when the payment is verified) gets what they hold; each level above gets what it kept. Missing levels are left out.
A Department Head sets the **telecaller split** (`incentive_split_set`): a telecaller's lead closed by its Business Associate splits the
closer's part (e.g. 60% telecaller, 40% BA).

**Worked example:** ₹500 per unit to the Operations Head; OH → DH 300; DH → TL 150; TL → TM 100. A ₹2,000 order paid ₹1,000 + ₹1,000:
each verified payment releases 50% → TM 50, TL 25, DH 75, OH 100, twice.

## When an earning is recorded (instantly, in the database)
- **Sale paid:** a `customer_payments` row becomes `VERIFIED` (Accounts). It releases payment ÷ order total (the full payable `deal_amount`,
  GST included; else `agreed_amount`), never more than 100% in all, for every sales rule of a product the customer bought. Leaving `VERIFIED` (reversed, rejected,
  back to pending) reverses it; verifying again pays once.
- **Demo completed:** a Business Associate demo `COMPLETED` **and** "authorised person attended" ticked (`ba_demo_set_authorised`); paid to
  the demo's BA and the lead's telecaller when a rule applies to them. Unticking or leaving Completed reverses it.
- **Field visit completed:** a `lead_visits` row `COMPLETED` with `gps_captured`; paid to the employee.
- **Start:** nobody earns for events before their joining date (`employee_personal_details.joining_date`, else the account's approval or
  creation date) + the start period. Their share is not given to anyone else.
- A calculation problem never blocks Accounts: it is written to the audit log (`INCENTIVE_ERROR`).

## Reading (the Income page)
`income_summary()` (today, this month, total, balance, start date, target progress, this month's activity) and
`income_earnings(from, to, limit)`: the signed-in person's own earnings only. `incentive_setup()`: the setup screen's data - per rule, each person
directly below the caller (`private.incentive_reports`) with what they get now and what the caller keeps on them; for the Super Admin the
rule form's option lists and how often each rule was earned.

## Screens
- **My Income moved into the Wallet** (20270223000100, `docs/EMPLOYEE_WALLET.md`): the menu entry is gone from the Sales Head / Operations Head, Team Lead,
  Telecaller, Business Associate and Sales Team Member dashboards (an old `my-income` / `income` address opens the Wallet; the Sales Head's Department Income
  keeps `income`). Today, targets and this month's activity are on the Wallet's Overview (`WalletActivity`), withdrawals on its Withdrawals tab.
  `income_summary`, `income_earnings` and the person's own payout functions need the Wallet PIN once it is set. `IncomePage.tsx` is no longer shown on any
  dashboard (kept for now: `ui_income` / `ui_payouts` still exercise it).
- **Incentive setup** (`src/components/income/IncentiveSetup.tsx`): Super Admin (Company > Sales Incentives), Sales heads and Team Leads.
- The Business Associate's **The client's authorised person attended** tick on completed demos (`ba_demo_set_authorised`; the demo
  record carries `authorisedPersonAttended`).
- Help: `docs-site/content/sales/my-income.md`, `docs-site/content/sales/incentive-setup.md`. Browser test: `supabase/tests/ui_income.test.mjs`.

Tests: `supabase/tests/incentives_test.sql`.

## Payouts (phase 2, migration `20270123000100_incentive_payouts.sql`)
Design: `docs/superpowers/specs/2026-11-21-incentive-payouts-design.md`.
- `payout_methods` (bank / UPI / international details; full only to the owner and Accounts) and `payout_requests` (REQUESTED → PAID /
  REJECTED / CANCELLED; FAILED / REVERSED / PROCESSING come with Razorpay). Available = earned − paid − the open request; a clawback can
  make it negative (recovered from future earnings; no request until positive).
- Withdrawals open on the HR joining date + `incentive_settings.start_after_days`; no HR joining date → closed. Minimum ₹500; one open request.
- Accounts (`private.require_accounts_staff`, never their own): `payout_queue`, `payout_detail`, `payout_mark_paid` (reference, date, TDS),
  `payout_reject`, `payout_leavers`, `payout_final_settlement`. A paid payout is a `department_expenses` row (category `Sales Incentive`,
  allocated to the person's department). Notifications: `PAYOUT_REQUESTED`, `PAYOUT_DETAILS_CHANGED` (Accounts), `PAYOUT_PAID`,
  `PAYOUT_REJECTED` (the person).
- Slip: `GET /api/v1/payouts/:id/slip` (PDF as base64; `payout_slip_data` checks and audits each download).
- Screens: My Income (My Earnings, Balance, Withdraw, Withdrawals), Accounts > Finance > Payout requests. Tests: `payouts_test.sql`,
  `ui_payouts.test.mjs`, the payouts block of `api_integration.test.ts`.

### Razorpay (migration `20270125000100_incentive_payouts_razorpay.sql`)
- Server-only steps (service role; the API checks the Accountant's session first): `payout_rzp_begin` (REQUESTED → PROCESSING, TDS / net;
  Accounts only, never their own, BANK / UPI only), `payout_rzp_link` (Razorpay contact and fund account, dropped when the details change),
  `payout_rzp_set_id`, `payout_rzp_settle` (processed → PAID with the UTR; failed / rejected / cancelled → FAILED; reversed after PAID →
  REVERSED, its expense removed and kept in the audit; a seen event id changes nothing), `payout_rzp_undo`, `payout_rzp_pending`,
  `payout_rzp_lookup`.
- API: `GET /payouts/razorpay/status`, `POST /payouts/:id/razorpay {tds}`, `POST /payouts/:id/razorpay/check`, and the signed webhook
  `POST /internal/razorpay/payouts`. The request id is the `X-Payout-Idempotency` key. Settings: `docs/GO_LIVE_RUNBOOK.md` § RazorpayX.
- Tests: `payouts_razorpay_test.sql`, the RazorpayX stand-in block of `api_integration.test.ts`, `ui_payouts.test.mjs`.
