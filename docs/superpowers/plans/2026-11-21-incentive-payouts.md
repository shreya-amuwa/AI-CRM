# Incentive Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales staff withdraw their incentive balance from My Income; Accounts pays each request by hand (PR 1) or through RazorpayX (PR 2).

**Architecture:** A `payout_requests` table next to the phase-1 `earnings` ledger; available = earned − paid − open requests. Staff and
Accounts call security-definer RPCs; the slip PDF and Razorpay calls go through the Node/Worker API (`server/`). Earnings are not changed.

**Tech Stack:** Supabase Postgres (plpgsql RPCs, RLS), React + TypeScript (`src/`), Node API (`server/`, pdf-lib), RazorpayX REST API.

**Spec:** `docs/superpowers/specs/2026-11-21-incentive-payouts-design.md`

## Global Constraints
- Migrations: new files only, timestamps after main's newest (today `20270122000300`): PR 1 `20270123000100_incentive_payouts.sql`,
  PR 2 `20270124000100_incentive_payouts_razorpay.sql`; rename on a clash. Safe to run twice; pasteable in the SQL editor.
- Every function: `security definer`, `set search_path = ''`, `revoke all … from public, anon`, grant to `authenticated` (staff/Accounts) or
  `service_role` (server-only). Errors prefixed `NOT_FOUND:` / `VALIDATION_ERROR:` / `FORBIDDEN:` / `CONFLICT:`. Every change audited with
  `private.write_audit(action, entity_type, entity_id, dept, team, metadata)`.
- Money `numeric(14,2)`, INR. Minimum withdrawal **₹500**. One open request (REQUESTED/PROCESSING) per person.
- Withdrawals open on HR joining date + `incentive_settings.start_after_days` (15). Joining date = `hr_employees.joining_date` (by
  `profile_id`, filled by HR's add-employee flow), else `employee_personal_details.joining_date`; **no** fallback to account dates. No
  date → closed, copy: "Withdrawals open 15 days after HR records your joining date." (use the setting's number, not a literal 15).
- Accounts = `private.is_accounts_staff()` / `private.require_accounts_staff()` (Accounts department or Super Admin). Nobody decides their
  own request (`FORBIDDEN: You cannot pay your own withdrawal.`).
- Full payout details only to the owner and Accounts; everyone else last four characters (`••••1234`).
- Paid payout → `department_expenses` row: category `Sales Incentive`, amount = gross, `payment_status 'PAID'`, `source 'MANUAL'`,
  `expense_date` = paid_on, description `Sales incentive payout - <name>`; one `expense_allocations` row (100%) to the earner's
  `department_id`, none if they have no department.
- Secrets only as server settings: `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET`.
- Synthetic test data only. Commits end with the session's Co-Authored-By / Claude-Session lines.

## Deviations from the spec (decided while planning)
- **Slip** is drawn on each download from the stored payout values (fixed once paid), not stored as a file: same content, no bucket;
  every download audited; a reversed payout prints VOID.
- **Notifications** go to the bell (`private.notify`). Phone push for them is not built: the CRM pushes only chat messages and attendance
  reminders today; a general bell-to-phone push is a separate change.
- **Cancel** by the employee gets its own status CANCELLED (not REJECTED), so Accounts' reject reasons stay meaningful.

## Review Focus
1. Two Accountants press **Mark paid** on the same request at once → exactly one succeeds; the other gets `CONFLICT:` (Task 2 test).
2. An earning reversed after a payout → available goes negative, a new request is refused, and My Income shows "to be recovered from
   future incentives" (Task 2 SQL test, Task 4 browser test).
3. The person changes their bank details while a request is open → the request keeps the details it was made with (`method_snapshot`);
   Accounts pays to the snapshot (Task 2 test).
4. A Razorpay webhook arrives twice, or after a manual **Check status** already settled it → nothing changes the second time (Task 8 test).
5. A payout amount with paise (e.g. ₹1,234.50) and TDS → net = gross − TDS exactly; Razorpay gets net in paise (123450 − TDS·100)
   (Task 2 and Task 8 tests).

---

# PR 1 — manual payouts (branch `claude/incentive-payouts`)

### Task 1: Payout details and the balance

**Files:**
- Create: `supabase/migrations/20270123000100_incentive_payouts.sql`
- Create: `supabase/tests/payouts_test.sql`; Modify: `supabase/tests/run.sh` (add after `incentives_test.sql`, same line pattern)

**Interfaces:**
- Produces tables: `payout_methods(profile_id pk → profiles, kind text check in ('BANK','UPI','OTHER'), holder_name, account_number, ifsc,
  upi_id, other_details, pan, updated_at, updated_by)`; `payout_requests(id, profile_id, amount, status check in
  ('REQUESTED','PROCESSING','PAID','REJECTED','CANCELLED','FAILED','REVERSED'), method_snapshot jsonb, requested_at, decided_by, decided_at, channel
  check in ('MANUAL','RAZORPAY') null, reference, paid_on date, tds_amount numeric(14,2) default 0, net_amount, reason, expense_id →
  department_expenses on delete set null, final_settlement boolean default false, request_id text unique)`; partial unique index on
  `(profile_id) where status in ('REQUESTED','PROCESSING')`. RLS on, no grants.
- Produces helpers: `private.payout_opens_on(p uuid) returns date` (null when no joining date), `private.payout_available(p uuid) returns
  numeric`, `private.payout_mask(text) returns text`, `private.payout_method_json(m payout_methods, p_full boolean) returns jsonb`.
- Produces RPCs: `payout_method_get() returns jsonb` (own, full; null when none), `payout_method_save(p jsonb) returns jsonb` (keys `kind,
  holderName, accountNumber, ifsc, upiId, otherDetails, pan`), and `income_summary()` re-created with extra keys `withdrawn`, `available`,
  `withdrawOpensOn` (date or null), `openRequest` (jsonb or null); `balance` = earned − PAID gross (kept for compatibility).

- [ ] **Step 1: Write the failing tests** in `payouts_test.sql` (fixture users from `rls_test.sql`: `tm_a`, `acc_m`, `sa`; customers /
  payments via the `test.inc_customer` / `test.inc_pay` helpers — re-create them at the top if absent):
  - `payout_method_save` as `tm_a` with BANK `{holderName:'Test Member', accountNumber:'123456789012', ifsc:'HDFC0001234'}` → returns
    `accountNumber = '123456789012'`; audit row `PAYOUT_METHOD_SAVED`.
  - IFSC `HDFC001234` → `VALIDATION_ERROR`; account `12AB` → `VALIDATION_ERROR`; UPI `bad` → `VALIDATION_ERROR`; PAN `ABCDE1234` →
    `VALIDATION_ERROR`; OTHER with empty `otherDetails` → `VALIDATION_ERROR`.
  - As root: `private.payout_method_json(m, false) ->> 'accountNumber' = '••••9012'`.
  - `private.payout_opens_on` = `hr_employees.joining_date + 15` when set; null when neither joining date exists (even with `approved_at`).
  - `private.payout_available(tm_a)` = sum of EARNED earnings when no requests; `income_summary()` has `available`, `withdrawn = 0`.
- [ ] **Step 2: Run** `bash supabase/tests/run.sh` (or the quick re-run against `crm_rls_test`) → FAIL (functions missing).
- [ ] **Step 3: Implement** the tables, helpers and RPCs above. Validation regexes: IFSC `^[A-Z]{4}0[A-Z0-9]{6}$` (upper-case input
  first), account `^[0-9]{9,18}$`, UPI `^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$`, PAN `^[A-Z]{5}[0-9]{4}[A-Z]$` (optional), holder name 2–120.
  Only the owner can save their details, so the guard against redirected money is the audit row (`PAYOUT_METHOD_SAVED`, old and new
  masked values) plus a `PAYOUT_DETAILS_CHANGED` notification to Accounts staff when a person with an open request changes them. Re-create `income_summary` by copying the current body
  (from `20270119000100`) and adding the keys.
- [ ] **Step 4: Run** → PASS. Run the migration twice in a row → no error.
- [ ] **Step 5: Commit** `feat(payouts): payout details and the available balance`.

### Task 2: Withdrawal requests and the Accounts actions

**Files:**
- Modify: `supabase/migrations/20270123000100_incentive_payouts.sql`; `supabase/tests/payouts_test.sql`

**Interfaces:**
- Consumes: Task 1 tables and helpers.
- Produces RPCs (all `returns jsonb`; a request's JSON = `private.payout_request_json(r, p_full boolean)` with keys `id, profileId, name,
  department, amount, status, requestedAt, decidedAt, decidedBy, channel, reference, paidOn, tdsAmount, netAmount, reason,
  finalSettlement, method` (snapshot, masked unless full)):
  - staff: `payout_request(p_amount numeric, p_request_id text)`, `payout_cancel(p_id uuid)`, `payout_my_requests()` (array, newest first).
  - Accounts: `payout_queue(p_status text)` (array; `available` per row), `payout_detail(p_id uuid)` (full method + `available` +
    `recentEarnings` last 20 from `earnings`), `payout_mark_paid(p_id uuid, p_reference text, p_paid_on date, p_tds numeric)`,
    `payout_reject(p_id uuid, p_reason text)`, `payout_final_settlement(p_profile uuid, p_reference text, p_paid_on date, p_tds numeric)`,
    `payout_leavers()` (non-active profiles with available > 0: `profileId, name, department, available, method`).
  - `payout_counts()` → `{requested: n}` for the Accounts nav badge.

- [ ] **Step 1: Write the failing tests** (append):
  - Before opening date (joining date = today − 10) → `payout_request(600,'r1')` `VALIDATION_ERROR` containing "Withdrawals open on";
    no joining date → `VALIDATION_ERROR` containing "HR records your joining date"; joining date = today − 16 → allowed.
  - 499 → `VALIDATION_ERROR`; more than available → `VALIDATION_ERROR`; no method saved → `VALIDATION_ERROR`; second request while one
    open → `CONFLICT`; same `request_id` twice → returns the same request (no second row).
  - After a request of 600: `available` fell by 600; `payout_cancel` → status CANCELLED, available restored; cancelling someone else's
    request → `FORBIDDEN`; cancelling a PAID one → `CONFLICT`.
  - `tm_a` calling `payout_queue` → `FORBIDDEN`; `acc_m` paying a request of their own (give `acc_m` earnings + a request) → `FORBIDDEN`.
  - `acc_m`: `payout_mark_paid(id, 'UTR123', today, 50.25)` on a 1234.50 request → PAID, `net_amount = 1184.25`, one
    `department_expenses` row (category `Sales Incentive`, amount 1234.50) with one allocation to `tm_a`'s department; `withdrawn` = 1234.50;
    notification `PAYOUT_PAID` to `tm_a`; audit `PAYOUT_PAID`. Paying again → `CONFLICT`. TDS > amount or < 0 → `VALIDATION_ERROR`;
    empty reference → `VALIDATION_ERROR`; paid_on in the future → `VALIDATION_ERROR`.
  - Snapshot: request, then `tm_a` changes bank details → `payout_detail` shows the old account number.
  - Reject with reason `Wrong account` → REJECTED, available restored, `PAYOUT_REJECTED` notification; empty reason → `VALIDATION_ERROR`.
  - Clawback: pay a request equal to all available, then reverse the underlying customer payment → `payout_available < 0`, a new request →
    `VALIDATION_ERROR`; a new verified payment brings it back above zero.
  - Final settlement: for active `tm_a` → `VALIDATION_ERROR`; after suspending `tm_a` → PAID request with `final_settlement = true` and
    amount = available; `payout_leavers()` lists then no longer lists them. An open request of a suspended person can still be marked paid.
  - Person without a department → expense with no allocation rows.
  - Requests of a profile with Accounts as recipient: `payout_request` notifies every active Accounts staff (`PAYOUT_REQUESTED`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `payout_request` locks the person's rows (`select … from payout_requests where profile_id = me for update`)
  before checking open/available. State changes `select … for update` the request and require the expected status (else `CONFLICT: This
  request was already handled.`). `payout_mark_paid` and `payout_final_settlement` share `private.payout_settle(r, reference, paid_on, tds,
  actor)` (sets PAID/MANUAL/net, inserts expense + allocation, audits, notifies).
- [ ] **Step 4: Run** → PASS (twice, for idempotency of the test file).
- [ ] **Step 5: Commit** `feat(payouts): withdrawal requests and the Accounts queue`.

### Task 3: Payout slip (PDF on demand)

**Files:**
- Create: `server/payouts/slip.ts` (pdf-lib renderer, loaded lazily like `server/hrDocuments/render.js`), `server/services/PayoutService.ts`,
  `server/repositories/PayoutRepository.ts`
- Modify: `server/routes.ts` (`{ method: 'GET', path: '/payouts/:id/slip', handler: payouts.slip }`), the container/wiring where
  `HrDocumentService` is constructed; migration (add `payout_slip_data(p_id uuid) returns jsonb`)
- Test: `supabase/tests/api_integration.test.ts` (new block)

**Interfaces:**
- Produces: `payout_slip_data(p_id)` — caller must be the owner or Accounts; status PAID or REVERSED (else `CONFLICT`); returns
  `{slipNo, name, employeeCode, department, amount, tdsAmount, netAmount, reference, paidOn, method (masked), finalSettlement, void}`;
  audits `PAYOUT_SLIP_DOWNLOADED`. `GET /api/v1/payouts/:id/slip` → `application/pdf`, filename `Payout-<slipNo>.pdf`.
- Slip number = `PO-` + paid_on `YYMM` + `-` + first 6 of id. Values are fixed once paid, so the PDF is drawn from them on each download
  (no stored file; a REVERSED payout prints **VOID**).

- [ ] **Step 1: Failing API tests:** owner downloads → 200, `content-type application/pdf`, body starts `%PDF`; a colleague → 403;
  a REQUESTED request → 409; an audit row per download.
- [ ] **Step 2: Run** `run-api.sh` → FAIL.
- [ ] **Step 3: Implement** (A4 page: company name, "Incentive payout slip", slip no, employee, department, period paid, gross, TDS, net,
  method, reference, date; VOID diagonal when `void`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(payouts): payout slip PDF`.

### Task 4: My Income — Balance block, Withdraw, payout details

**Files:**
- Create: `src/lib/payouts.ts`, `src/components/income/WithdrawDialog.tsx`, `src/components/income/PayoutDetailsForm.tsx`
- Modify: `src/components/income/IncomePage.tsx`, `src/lib/income.ts` (summary type)

**Interfaces:**
- Consumes: RPCs from Tasks 1–2; slip route from Task 3.
- Produces: `payoutsApi = { method(), saveMethod(p), request(amount, requestId), cancel(id), mine(), queue(status), detail(id), markPaid(id,
  reference, paidOn, tds), reject(id, reason), leavers(), settle(profileId, reference, paidOn, tds), counts(), slipUrl(id) }` (RPC helper as
  in `src/lib/income.ts`; `slipUrl` = `/api/v1/payouts/<id>/slip`, fetched with the session token like other API downloads).
- Screen copy (exact): section **My Earnings** (Total earned, Today, This month) and **Balance** (Withdrawn so far, Available to withdraw);
  negative available → "₹X to be recovered from future incentives"; button **Withdraw**; closed states "Withdrawals open on <date>" /
  "Withdrawals open <N> days after HR records your joining date."; list **Withdrawals** (status chip, amount, reference, TDS / net,
  **Download slip**, **Cancel** on REQUESTED); form **Payout details** (Bank account / UPI / Other (outside India), PAN optional).

- [ ] **Step 1:** Extend the browser test harness (Task 6 owns `ui_payouts`) — for this task, write the My Income cases first:
  Withdraw disabled with each closed message; dialog refuses 400 with "at least ₹500" (client check) and shows the server message for
  over-balance; after request, the open request appears and **Withdraw** is disabled; negative available shows the recovery text.
- [ ] **Step 2: Run** `node supabase/tests/ui_payouts.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** New request id per dialog open (`crypto.randomUUID()`); dialog prompts to add payout details first when none.
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(payouts): withdraw from My Income`.

### Task 5: Accounts — Payout requests page

**Files:**
- Create: `src/components/accounts/finance/PayoutRequests.tsx`
- Modify: `src/components/accounts/AccountsDashboard.tsx` (page `payouts` in `ACCOUNTS_PAGES`, Finance group item **Payout requests**
  with badge from `payoutsApi.counts().requested`)

**Interfaces:** Consumes `payoutsApi`.
- Tabs **Requested / Paid / Rejected / Failed / Leavers**. Detail panel: person, department, amount, available, recent earnings, full
  payout details with **Copy** buttons; **Mark paid** form (Reference, Paid on (default today), TDS (default 0) → "Net to pay: ₹…"),
  **Reject** (Reason). Leavers tab: **Pay final settlement** with the same form. OTHER-method requests show the free text.

- [ ] **Step 1:** Browser cases: Mark paid with TDS 50.25 on 1,234.50 shows "Net to pay: ₹1,184.25" and sends `p_tds 50.25`; the server's
  `CONFLICT` message shows when already handled; Reject requires a reason; Leavers lists a person and settles.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(payouts): Accounts payout requests page`.

### Task 6: Browser test file, docs, verification, PR 1

**Files:**
- Create: `supabase/tests/ui_payouts.test.mjs`, `supabase/tests/ui/payouts_stubs.ts`, `supabase/tests/ui/payouts_harness.tsx` (same
  pattern as `ui_income`); Modify: `supabase/tests/run-unit.sh` (add `ui_payouts` to the `for ui in` list)
- Docs: `docs-site/content/sales/withdraw-your-income.md`, `docs-site/content/accounts/pay-payout-requests.md` (front matter per
  `docs-site/CONTENT_GUIDE.md`), `docs/SALES_INCENTIVES.md` (Payouts section), release note.

- [ ] **Step 1:** Collect the Task 4–5 cases into the file; add 375 px no-overflow check for My Income and the Accounts page.
- [ ] **Step 2:** `bash supabase/tests/run.sh`, `run-api.sh` (with `PGHOST/PGPORT/PGUSER/POSTGREST_BIN`), `run-unit.sh`,
  `npm run typecheck`, `npm run build`, `node docs-site/build.mjs --check` → all pass.
- [ ] **Step 3:** Fresh reviewer on the branch; fix Critical / Important with tests first; list minors.
- [ ] **Step 4:** Merge `origin/main`, rename the migration if its timestamp clashed, push, open PR 1 listing the migration and checks.
  Stop (do not merge).

---

# PR 2 — Razorpay (branch `claude/incentive-payouts-razorpay`, from main after PR 1 merges)

### Task 7: Database for Razorpay

**Files:** Create `supabase/migrations/20270124000100_incentive_payouts_razorpay.sql`; Test: `supabase/tests/payouts_test.sql` (append)

**Interfaces (service_role only unless noted):**
- Columns: `payout_methods.rzp_contact_id`, `rzp_fund_account_id` (cleared by `payout_method_save` when details change);
  `payout_requests.rzp_payout_id` (unique); table `razorpay_events(event_id text pk, received_at)`.
- `payout_rzp_begin(p_id uuid, p_actor uuid) returns jsonb` — actor must be Accounts and not the owner; request REQUESTED; method BANK or
  UPI (else `VALIDATION_ERROR: Pay people outside India manually.`); sets PROCESSING / RAZORPAY, decided_by; returns `{id, amount, net,
  tds, method (full), contactId, fundAccountId, name, email}`. Takes `p_tds numeric` too (net = amount − tds).
- `payout_rzp_link(p_profile uuid, p_contact text, p_fund text)`; `payout_rzp_set_id(p_id uuid, p_payout text)`.
- `payout_rzp_settle(p_payout text, p_status text, p_utr text, p_reason text, p_event_id text) returns jsonb` — ignores a seen
  `event_id`; `processed` on PROCESSING → `private.payout_settle` (channel RAZORPAY, reference = UTR, paid_on = office today);
  `failed`/`rejected`/`reversed` on PROCESSING → FAILED (reason, amount freed, notify `PAYOUT_FAILED`); `reversed` on PAID → REVERSED,
  expense deleted (audit metadata keeps the row), notify; anything else → no change.
- `payout_rzp_undo(p_id uuid, p_reason text)` — PROCESSING → REQUESTED when the Razorpay call failed before a payout id existed.

- [ ] Steps: failing tests for each transition, repeated event id, OTHER refused, own request refused, TDS net; implement; pass; commit
  `feat(payouts): database for Razorpay payouts`.

### Task 8: RazorpayX client, routes, webhook, status check

**Files:**
- Create: `server/payouts/razorpayx.ts` (client: `createContact`, `createFundAccount`, `createPayout(idempotencyKey, …)`, `getPayout(id)`;
  Basic auth with key id / secret; base `https://api.razorpay.com/v1`), webhook verifier (HMAC-SHA256 of the raw body with
  `RAZORPAYX_WEBHOOK_SECRET`, constant-time compare with `X-Razorpay-Signature`).
- Modify: `server/services/PayoutService.ts`, `server/routes.ts`: `GET /payouts/razorpay/status` (Accounts: `{configured}`),
  `POST /payouts/:id/razorpay` (body `{tds}`), `POST /payouts/:id/razorpay/check`, `POST /razorpay/webhook` (no session; raw body;
  register next to the other signed callbacks in `server/app.ts`); `worker/index.ts` scheduled run: check PROCESSING requests older than
  10 minutes (only when `SCHEDULED_ENABLED`).
- Test: `supabase/tests/api_integration.test.ts` with a local RazorpayX stand-in (env `RAZORPAYX_BASE_URL` override for tests only).

**Interfaces:** payout body: `{account_number: RAZORPAYX_ACCOUNT_NUMBER, fund_account_id, amount: round(net*100), currency:'INR',
mode: BANK ? (net ≤ 500000 ? 'IMPS' : 'NEFT') : 'UPI', purpose:'payout', queue_if_low_balance:true, reference_id: request id, narration:
'Amuwa incentive'}`, header `X-Payout-Idempotency: <request id>`. Webhook events: `payout.processed`, `payout.reversed`, `payout.failed`,
`payout.rejected` (payload `payload.payout.entity` → id, status, utr, status_details.description).

- [ ] Steps: failing API tests — not configured → button status false and pay → 409; pay creates contact + fund account once and one payout
  (a retried call sends the same idempotency key, stand-in counts 1); Razorpay 4xx before a payout id → request back to REQUESTED with
  the message; webhook with a bad signature → 401; `processed` → PAID with UTR; same event twice → no change; `reversed` after PAID →
  REVERSED; **Check status** settles a PROCESSING request from `getPayout`; amount 1234.50 − TDS 50.25 → 118425 paise. Implement; pass;
  commit `feat(payouts): pay through RazorpayX`.

### Task 9: UI, docs, verification, PR 2

**Files:** Modify `src/components/accounts/finance/PayoutRequests.tsx` (**Pay through Razorpay** when configured and method BANK/UPI,
using the same TDS field; PROCESSING tab with **Check status**; note "Razorpay is not set up" when not configured), `src/lib/payouts.ts`
(`razorpayStatus()`, `payViaRazorpay(id, tds)`, `checkRazorpay(id)` via the API client); `ui_payouts` cases; docs (Accounts page section,
`docs/SALES_INCENTIVES.md`, `docs/GO_LIVE_RUNBOOK.md` — the four settings and the webhook URL/events to add in RazorpayX).

- [ ] Steps: browser cases (button hidden when not configured, disabled for OTHER, PROCESSING shown with Check status); full suites as in
  Task 6; fresh reviewer; merge main; push; PR 2 listing the migration and the settings to add. Stop.
