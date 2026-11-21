# Design: Incentive payouts (phase 2)

Approved 2026-11-21. Phase 1 (rules, earnings, My Income, setup) is merged: #259, #261; see `docs/SALES_INCENTIVES.md`.

## Context and intent
Sales staff see a live **Balance** on **My Income** (everything earned from incentives). They cannot get the money yet. The owner wants
staff to withdraw that balance and Accounts to pay it, either by hand (bank / UPI transfer, then record the reference) or automatically
through the company's **Razorpay** account (RazorpayX Payouts), so both the Accountant and the staff member have flexibility. Every rupee
must stay traceable: earned → requested → paid (or rejected / failed and returned to the balance).

## Decisions (owner)
- **Both ways of paying:** manual (Accountant pays, enters the bank reference and date) and Razorpay (one click; Razorpay sends and
  confirms). The company has a Razorpay account.
- **Approval: Accounts alone.** Anyone in the Accounts department (or the Super Admin) approves and pays in one step, like payment
  Confirmation today. Nobody approves their own request.
- **Withdraw only 15 days after the joining date HR records** when HR adds the employee to the company (owner's wording: "after HR adds
  them in the company, from their joining date till the next 15 days"). The 15 is the Super Admin's existing setting
  (`incentive_settings.start_after_days`). Withdrawals use the HR joining date only — no fallback to the account's activation date: if HR
  has not recorded a joining date, withdrawals stay closed and My Income says "Withdrawals open 15 days after HR records your joining
  date." Once recorded: "Withdrawals open on <joining date + 15>". (Builder: HR keeps a joining date in `hr_employees.joining_date`
  (directory, linked by `profile_id`) and in `employee_personal_details.joining_date` — `private.incentive_start_date` reads the latter
  with a fallback; confirm which one HR's "add employee" flow fills and read that one, the other as a fallback. Earning keeps its
  current rule.)
- **Approach 1:** a separate payout-requests table; balance = earned − paid − open requests. Earnings are unchanged.
- **Two PRs:** PR 1 manual payouts; PR 2 Razorpay.
- **Clawback: recover from future earnings.** An earning reversed after it was paid out can take the balance below zero; My Income shows
  the minus amount ("to be recovered from future incentives") and withdrawals stay blocked until new earnings bring it above zero. Nobody
  chases anyone; no extra table. (So "never negative" applies to *requests*: available must be ≥ the amount requested.)
- **Leavers: Accounts settles it.** When an account is deactivated, Accounts can still pay an open request, and can pay the remaining
  available balance as a **final settlement** without a request (`payout_final_settlement(profile, reference, paid_on, tds)`, Accounts
  only, only for non-active profiles with a positive available balance). The staff-side functions still require an active account.

## My calls (owner can correct)
- Withdraw any time; **minimum ₹500**; at most the available balance; **one open request at a time**.
- **TDS:** the Accountant may enter a tax deduction when paying; balance falls by the gross requested; slip shows gross, TDS, net.
- Payout details: bank account (holder name, account number, IFSC) **or** UPI ID, plus optional PAN. Owner and Accounts see them in full;
  anyone else sees only the last four digits. Any change is audited and notifies the owner (guards against redirected money).
- Each paid payout is also recorded as a **"Sales Incentive" expense** (`department_expenses`, allocated 100% to the earner's department via
  `expense_allocations`) so company net and Department Income stay right. Amount = gross (TDS is still a company cost, owed to tax).
- Notifications (bell + phone push where on): request received (Accounts staff), paid / rejected / failed (the person).
- A payout slip (PDF) for every paid request, stored privately, downloadable by the person and Accounts (download audited).
- Staff outside India: Razorpay pays Indian bank accounts / UPI only. A third payout method **OTHER** (free-text international details:
  bank name, account / IBAN, SWIFT, country) can be saved; requests on OTHER can only be paid manually. The method kind decides it — no
  country field needed.
- "Full details" are seen by the **person who owns them** and by Accounts staff (and the Super Admin); the owner is the one notified of
  changes.
- Expense allocation: the earner's own department; a person with no department (e.g. an Operations Head without one) → a company-wide
  expense (no allocation rows, which the finance summary already treats as company-wide).
- A Razorpay payout reversed after it was processed: the request moves PAID → REVERSED, its expense is deleted (audited, with the deleted
  row in the audit metadata), the slip is marked void, the amount is available again, the person is notified. TDS on it is dropped.
- Missed Razorpay webhooks: a **Check status** button on PROCESSING requests (Accounts) asks Razorpay directly; the 5-minute scheduler also
  runs the check where it is enabled (`SCHEDULED_ENABLED`), so production works whether or not the scheduler runs.

## Goals / non-goals / anti-goals
- Goals: staff request withdrawals from My Income; Accounts pays them manually or via Razorpay; balance is always right; full audit.
- Non-goals: salary / payroll; foreign currencies (amounts stay INR; overseas staff are paid manually at Accounts' discretion); automatic
  scheduled payouts; Form 16 / TDS filing (only the deduction is recorded).
- Anti-goals: paying the same money twice (double click, retry, two Accountants, a Razorpay webhook repeated); a request larger than
  what is available; bank details readable by colleagues; secrets in the database or code.

## Approaches considered
1. **(Chosen) Separate `payout_requests` table.** Balance computed from earnings minus paid and open requests; earnings untouched; a
   rejected / failed request simply frees its amount.
2. Negative rows in `earnings`. Rejected: mixes two things; every existing total (month, total, targets) would need filters; failures need
   reversing rows — more ways to get money wrong.

## Data (PR 1 migration; safe to run twice; security definer + `search_path = ''`; NOT_FOUND / VALIDATION_ERROR / FORBIDDEN / CONFLICT)
- `payout_methods` (one per person): `profile_id` PK, `kind` BANK | UPI | OTHER (`other_details` text for OTHER), `holder_name`, `account_number`, `ifsc`, `upi_id`, `pan`,
  `updated_at`, `updated_by`; Razorpay ids added in PR 2 (`rzp_contact_id`, `rzp_fund_account_id`, cleared when details change).
  RLS on, no grants; read only through functions.
- `payout_requests`: `id`, `profile_id`, `amount` (gross, numeric(14,2)), `status` REQUESTED | PROCESSING | PAID | REJECTED | FAILED,
  (status also REVERSED in PR 2), `method_snapshot` jsonb (details at request time, masked copy for display), `requested_at`, `decided_by`, `decided_at`,
  `channel` MANUAL | RAZORPAY, `reference`, `paid_on`, `tds_amount`, `net_amount`, `reason` (reject / failure), `expense_id`,
  `slip_path`, `request_id` (idempotency, unique). Partial unique index: one REQUESTED/PROCESSING per person.
- Balance helper `private.payout_available(p)` = earned (EARNED) − PAID gross − REQUESTED/PROCESSING gross. `income_summary` gains
  `available`, `withdrawOpensOn`, `openRequest`; existing `balance` becomes earned − paid.
- Functions:
  - staff: `payout_method_get()`, `payout_method_save(p jsonb)` (validates IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`, account 9–18 digits, UPI
    `^[\w.\-]{2,}@[a-zA-Z]{2,}$`, PAN `^[A-Z]{5}[0-9]{4}[A-Z]$`; audited; notifies owner), `payout_request(amount, request_id)`
    (eligible after start date; ≥ 500; ≤ available; method saved; one open; row-locks the person's requests), `payout_cancel(id)`
    (own REQUESTED only), `payout_my_requests()`.
  - Accounts (`private.require_accounts_staff()`, not own request): `payout_queue(status)`, `payout_detail(id)` (full details + recent
    earnings), `payout_mark_paid(id, reference, paid_on, tds)` (REQUESTED → PAID; creates the expense; audited; notifies),
    `payout_reject(id, reason)`.
- All state changes lock the request row (`for update`) and check the expected status, so two Accountants cannot both pay.

## Screens (PR 1)
- **My Income** (`src/components/income/IncomePage.tsx`), owner's request: a **Balance** block next to **My Earnings** — My Earnings shows
  overall (Total earned) and Today (and This month); Balance shows **Withdrawn so far** and **Available to withdraw**, so staff see
  earned → withdrawn → available at a glance (a negative available reads "to be recovered from future incentives"); **Withdraw** button → dialog (amount, method
  summary, "Edit payout details"); before the start date "Withdrawals open on <date>"; a **Withdrawals** list with status, reference,
  TDS / net and **Download slip**; **Cancel** on an open request. A **Payout details** form (bank or UPI, PAN).
- **Accounts > Finance > Payout requests** (`src/components/accounts/finance/PayoutRequests.tsx`, nav in `AccountsDashboard.tsx` with a
  badge): tabs Requested / Paid / Rejected / Failed; row → detail with person, department, amount, available balance, recent earnings,
  full payout details (copy buttons); actions **Mark paid** (reference, date, TDS → shows net) and **Reject** (reason). PR 2 adds
  **Pay through Razorpay**.
- Slip: server-side PDF (pdf-lib, like `server/services/HrDocumentService.ts`), private bucket `payout-slips`, signed download, audited.

## Razorpay (PR 2)
- Server settings (never in DB/code): `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET`.
  Without them the button is hidden and an Accounts note says Razorpay is not set up.
- **Pay through Razorpay** (server route, Accounts only): create Contact and Fund Account on first use (bank_account / vpa), then
  `POST /v1/payouts` (mode IMPS for bank ≤ ₹5 lakh, UPI for VPA; `X-Payout-Idempotency` = request id; `purpose: payout`, amount = net in
  paise); request → PROCESSING with the Razorpay payout id. Overseas / non-INR details → button disabled.
- Webhook `/api/v1/razorpay/webhook` (signature checked with the webhook secret; event id stored so a repeat does nothing):
  `payout.processed` → PAID (reference = UTR, expense + slip + notify); `payout.reversed` / `payout.failed` / `payout.rejected` → FAILED with
  reason, amount freed, notify. A periodic status check (existing 5-minute scheduler) catches missed webhooks for PROCESSING requests.

## Testing
- SQL: clawback (an earning reversed after payout → negative available, request refused, positive again after new earnings), final
  settlement for a deactivated person (and refused for an active one), eligibility (day 14 refused, day 16 allowed), min / max / one open, balance maths across paid / rejected / failed, cancel, Accounts-only,
  not own request, double pay refused, masking for non-owners, expense + allocation created, audit rows.
- API (PR 2): Razorpay stand-in — payout created once per request (idempotency), webhook signature, processed / reversed paths, repeat
  webhook ignored, missed-webhook status check.
- Browser (`ui_payouts`): withdraw dialog and validation messages, "Withdrawals open on", Accounts mark paid with TDS (net shown), reject
  with reason, slip link, 375 px.
- Full suites: run.sh, run-api.sh, run-unit.sh, typecheck, build, docs check; docs pages (staff "Withdraw your income", Accounts "Pay
  payout requests") and `docs/SALES_INCENTIVES.md`.

## Left to the builder
Exact column names and JSON shapes; UI layout details; PDF layout; the scheduler hook used for the Razorpay status check; which existing
notification types / push helpers to reuse.
