# Sales Incentives and Income (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Super Admin sets incentive rules; sales incentives cascade Operations Head → Department Head → Team Lead → Team Member
with each level keeping a share; earnings are recorded instantly when a payment is verified, a demo is completed (authorised person
attended) or a field visit is completed; everyone in Sales sees their earnings in an **Income** section.

**Architecture:** All rules and calculations live in the database (security-definer functions, the CRM's pattern): rule and allocation
tables, an `earnings` ledger written by triggers on `customer_payments`, `ba_demos` and `lead_visits`, and read functions the screens
call directly through Supabase RPC (as `src/lib/attendance.ts` does). Two PRs: (1) database, (2) screens.

**Tech Stack:** Supabase Postgres (plpgsql, triggers, RLS), React + Tailwind, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-11-20-sales-incentives-income-design.md`

## Global Constraints
- PR 1 branch `claude/sales-incentives-db`, PR 2 branch `claude/sales-income-screens`, each from the latest `origin/main`; open the PR and stop.
- One migration in PR 1 named after every migration on `main` (today the newest is `20270118000100`): `20270119000100_sales_incentives.sql`;
  safe to run twice; pasteable in the SQL editor; `security definer`, `set search_path = ''`, revoke from `public, anon`; errors
  `NOT_FOUND:` / `VALIDATION_ERROR:` / `FORBIDDEN:` / `CONFLICT:`; new tables RLS on, no grants; every setup change audited with
  `private.write_audit`.
- Money: rupees, `numeric(14,2)`, rounded to 2 decimals per earning row.
- Event types (exact): `SALE_PAID`, `DEMO_COMPLETED`, `VISIT_COMPLETED`.
- Earning roles (exact): `CLOSER`, `TELECALLER`, `BUSINESS_ASSOCIATE`, `TEAM_LEAD`, `DEPARTMENT_HEAD`, `OPERATIONS_HEAD`, `PARTICIPANT`.
- Start rule: a person earns only for events on or after `joining date + start_after_days` (default **15**); joining date =
  `employee_personal_details.joining_date`, else `profiles.approved_at::date`, else `profiles.created_at::date`. Shares of a person not
  yet eligible are not given to anyone else.
- Sales are earned only from `customer_payments` becoming `VERIFIED` (released proportionally: payment amount ÷ order total, order total =
  `coalesce(customers.agreed_amount, customers.deal_amount)`, cumulative release capped at 100%); `VERIFIED → REVERSED` reverses them.
- Product = a `customer_services.service_code` of the customer (one unit per service row); the closer = `customers.owner_id` when the
  payment is verified.
- Rules are never edited once created: "change" = end (`active_to = today`) + create a new one.
- Copy: side-panel item `Income`; page title `My Income`; tiles `Today`, `This month`, `Total earned`, `Balance`; before eligibility:
  `Incentives start on <d Month yyyy>.`

## Review Focus
1. A sales person with no Team Lead, no Department Head or no Operations Head in their chain: nobody is invented; missing levels' shares are
   simply not paid (test in Task 2).
2. The customer's owner changes between two part payments: each payment pays the owner at that payment's verification (test in Task 2).
3. A payment verified twice (retry) or re-verified after a reversal: never double-pays; a re-verify after a reversal pays again once
   (test in Task 2).
4. An order with no amount (`agreed_amount` and `deal_amount` null) or a payment larger than the order: release capped at 100%, never
   divided by zero (test in Task 2).
5. A Team Lead tries to set more for their Team Member than they themselves get, or a Department Head sets amounts for another
   department's Team Lead: refused (test in Task 1).

---

## PR 1: Database (branch `claude/sales-incentives-db`)

### Task 1: Rules, cascade allocations, splits, settings

**Files:** Create `supabase/migrations/20270119000100_sales_incentives.sql` (part 1), `supabase/tests/incentives_test.sql` (one line in
`supabase/tests/run.sh`, loads the migration twice).

**Interfaces — Produces:**
- `incentive_settings (id bool pk default true, start_after_days int default 15 check 0..365)`.
- `incentive_rules (id uuid pk, name text 1..120, event_type, service_code text null references crm_services (required iff SALE_PAID),
  amount numeric(14,2) > 0, target_units int null > 0, scope_type text in ('OPERATIONS_HEAD','LEVEL','SUB_ROLE','DEPARTMENT','TEAM','PERSON'),
  scope_value text null, monthly_cap numeric(14,2) null, active_from date default office today, active_to date null, created_by, created_at)`.
  SALE_PAID rules use `scope_type = 'OPERATIONS_HEAD'` with `scope_value` = the Operations Head's profile id (the top of the cascade gets
  `amount`). LEVEL values: `DEPARTMENT_HEAD`, `TEAM_HEAD`, `TEAM_MEMBER`; SUB_ROLE values: `sales_sub_role` values.
- `incentive_allocations (rule_id, recipient_id, amount numeric(14,2) >= 0, set_by, set_at, primary key (rule_id, recipient_id))`.
- `incentive_splits (department_id pk, telecaller_pct int 0..100 default 50, set_by, set_at)`.
- `private.incentive_chain(p_profile uuid) returns table (level text, profile_id uuid)` — rows for the person and everyone above:
  `TEAM_MEMBER` (if they are one) → `TEAM_HEAD` of their team (role `TEAM_HEAD`, same `team_id`) → `DEPARTMENT_HEAD`
  (`private.department_head_of(department, null, 'SALES')`) → `OPERATIONS_HEAD` (`department_operations_owner`); missing levels omitted.
- `private.incentive_amount(p_rule uuid, p_profile uuid) returns numeric` — the per-unit amount this person holds: the rule amount for
  the rule's Operations Head, else their allocation, else 0.
- `public.incentive_rule_create(p jsonb) returns uuid` (Super Admin; `p` keys: name, eventType, serviceCode, amount, targetUnits,
  scopeType, scopeValue, monthlyCap, activeFrom), `public.incentive_rule_end(p_rule uuid)` (Super Admin),
  `public.incentive_allocation_set(p_rule uuid, p_recipient uuid, p_amount numeric) returns jsonb` (the caller must be the recipient's
  next level up in `incentive_chain(p_recipient)`, the rule must be SALE_PAID and active, and `p_amount <= incentive_amount(rule, caller)`),
  `public.incentive_split_set(p_department uuid, p_telecaller_pct int)` (that department's head or Super Admin),
  `public.incentive_settings_set(p_days int)` (Super Admin), `public.incentive_setup() returns jsonb` (rules visible to the caller, with
  their own amount, what they gave each direct report, their kept share, and their department's split; Super Admin sees all).

- [ ] **Step 1: Failing SQL tests** (synthetic `inc.*@example.com` staff: OH, DH, TL, TM, telecaller, BA in one Sales department):
  `super admin creates a SALE_PAID rule of 500 for the OH`; `OH gives the DH 300` → ok; `DH gives the TL 150`; `TL gives the TM 100`;
  `TL giving the TM 200 (more than the TL holds) is refused` (VALIDATION_ERROR); `a DH of another department cannot set this TL`
  (FORBIDDEN); `a TM cannot create rules` (FORBIDDEN); `incentive_setup shows the TL holds 150, gave 100, keeps 50`;
  `DH sets the telecaller split to 60`; `ending a rule keeps it but it no longer accepts allocations`; audit rows exist.
- [ ] **Step 2: Run** `bash supabase/tests/run.sh` — Expected: FAIL (migration missing).
- [ ] **Step 3: Implement part 1 of the migration.**
- [ ] **Step 4: Run** — Expected: all `incentives` checks ok, whole suite green.
- [ ] **Step 5: Commit** `feat(incentives): rules, cascade allocations and splits`.

### Task 2: Earnings ledger and sales (proportional, cascade, split, reversal, 15 days)

**Files:** migration part 2; tests in `incentives_test.sql`.

**Interfaces — Produces:**
- `earnings (id bigint identity pk, profile_id, rule_id, event_type, event_ref text, role text, customer_id uuid null, service_code text null,
  amount numeric(14,2), status text in ('EARNED','REVERSED') default 'EARNED', earned_at timestamptz default now(), reversed_at)`,
  unique `(profile_id, rule_id, event_ref, role)`; index `(profile_id, earned_at desc)`.
- `private.incentive_eligible(p_profile uuid, p_on date) returns boolean` and `private.incentive_start_date(p_profile uuid) returns date`.
- `private.earn_sale_payment(p_payment uuid)` and `private.reverse_event(p_event_ref text)`; trigger `customer_payments_incentives`
  after update of status: `→ VERIFIED` earns, `VERIFIED → REVERSED` reverses. `event_ref` = `'PAY:' || payment id`.
- Sale algorithm per active SALE_PAID rule whose `service_code` is one of the customer's services: `f = least(payment.amount / order_total,
  1 - already released fraction for that customer and rule)`; chain = `incentive_chain(closer)`; holder amounts `A` from
  `incentive_amount`; the closer earns `A(closer) * f`; each level above earns `(A(level) - A(level below in the chain)) * f`, never below 0;
  if a `ba_contacts` row links the customer to a telecaller and the closer is its Business Associate, the closer's part is split
  `telecaller_pct / 100` to the telecaller (`TELECALLER`) and the rest to the BA (`BUSINESS_ASSOCIATE`); anyone not
  `incentive_eligible` on the payment date gets no row; amounts rounded to 2 decimals; order total null or 0 → nothing.

- [ ] **Step 1: Failing tests:** `a 2000 order paid 1000 then 1000: TM 50+50, TL 25+25, DH 75+75, OH 100+100`;
  `the same payment verified again pays nothing more`; `reversing the first payment reverses its rows only`; `re-verifying after the
  reversal pays once`; `owner changed before the second payment: the new owner is paid for it`; `no team lead in the chain: the DH gets
  300-100, nobody else invented`; `telecaller lead closed by the BA with split 60: telecaller 60%, BA 40% of the closer's part`;
  `a closer on day 14 gets nothing, their chain is still paid; on day 16 they are paid`; `no order amount: nothing`;
  `a payment bigger than the order releases at most 100%`.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3:** implement. **Step 4:** run — Expected: pass, whole suite green.
- [ ] **Step 5: Commit** `feat(incentives): earnings ledger for verified payments`.

### Task 3: Demo completed and field visit completed

**Files:** migration part 3; tests.

**Interfaces — Produces:** `ba_demos.authorised_person_attended boolean not null default false`;
`public.ba_demo_set_authorised(p_demo uuid, p_attended boolean) returns jsonb` (the demo's `assigned_to` BA, or their TL / DH);
triggers on `ba_demos` (status or the tick changes) and `lead_visits` (status). Participants: a demo → its BA (`assigned_to`) and the
contact's telecaller (`ba_contacts.telecaller_id`); a visit → `employee_id` (only when `gps_captured`). Each active rule of that event
type pays `amount` to every eligible participant that matches the rule's scope (role `PARTICIPANT`), once per event
(`'DEMO:'|| id`, `'VISIT:' || id`), respecting `monthly_cap` per person per rule per office month; leaving COMPLETED or unticking reverses.

- [ ] **Step 1: Failing tests:** `a completed demo without the tick pays nothing`; `ticking it pays the telecaller 50 (rule scoped to
  SUB_ROLE TELECALLER)`; `unticking reverses`; `a cancelled demo pays nothing`; `a completed visit with GPS pays the employee`; `without
  GPS it does not`; `the monthly cap stops payment once reached`; `someone else's demo cannot be ticked` (FORBIDDEN).
- [ ] **Steps 2–4:** run (FAIL) → implement → run (pass, suite green).
- [ ] **Step 5: Commit** `feat(incentives): demo and field visit rewards`.

### Task 4: Income read functions; PR 1

**Interfaces — Produces:** `public.income_summary() returns jsonb` → `{ startsOn: date|null, eligible: bool, today, month, total, balance,
targets: [{ ruleId, name, unitsDone, targetUnits }], activity: { businessThisMonth, demosCompletedThisMonth, visitsCompletedThisMonth } }`
(today / month in office time, EARNED rows only; `balance = total` in phase 1, payouts come later); `public.income_earnings(p_from date,
p_to date, p_limit int default 100) returns jsonb` → `[{ earnedAt, eventType, role, amount, status, customerName, serviceName, ruleName }]`,
own rows only. Both for any active staff account.

- [ ] **Step 1: Failing tests:** `the TM sees today 50 and total 100 after both payments`; `reversed rows are listed as reversed and not
  counted`; `a person sees only their own earnings`; `before eligibility startsOn is the start date and eligible is false`.
- [ ] **Steps 2–4:** FAIL → implement → pass; then `run-api.sh`, `run-unit.sh`, `npm run typecheck` green.
- [ ] **Step 5:** docs `docs/SALES_INCENTIVES.md` (the rules, the worked example, the 15 days); commit, merge `origin/main`, push, open
  PR 1 listing migration `20270119000100_sales_incentives.sql`.

## PR 2: Screens (branch `claude/sales-income-screens`, after PR 1 merges)

### Task 5: The Income page in every sales side panel

**Files:** Create `src/components/income/IncomePage.tsx`, `src/lib/income.ts` (`incomeApi.summary()`, `incomeApi.earnings(from, to)`
via Supabase RPC like `src/lib/attendance.ts`); add `{ id: 'income', label: 'Income' }` (Wallet icon) to `SalesHeadDashboard.tsx`
(rename its existing `'income'` page id to `'department-income'`, label unchanged, path kept), `TeamLeadDashboard.tsx`,
`TelecallerDashboard.tsx`, `BusinessAssociateDashboard.tsx`, the Sales Team Member dashboard; Test `supabase/tests/ui_income.test.mjs`.

- [ ] **Step 1: Failing browser tests (stubbed RPC):** `shows Today ₹50.00, This month, Total earned, Balance`; `lists earnings with what
  each was for and marks reversed ones`; `before eligibility shows "Incentives start on 6 December 2026."`; `target progress "1 of 1,000"`;
  `the calls tile appears only when crocodialApi.me() says connected`; `fits a 375 px phone`.
- [ ] **Steps 2–4:** FAIL → implement → pass; typecheck, build, unit suite green.
- [ ] **Step 5: Commit** `feat(income): My Income page in the sales side panels`.

### Task 6: Setup screens; PR 2

**Files:** Create `src/components/income/IncentiveSetup.tsx` (Super Admin: create / end rules, start-after days; OH / DH / TL: per rule,
their amount, an amount field per direct report, their kept share; DH: telecaller % split), add `Incentive setup` to the Super Admin and
sales head / team lead side panels; add the "Authorised person attended" tick to the BA demo screen
(`src/components/business-associate/`), calling `ba_demo_set_authorised`.

- [ ] **Step 1: Failing browser tests:** `super admin creates the 500 rule`; `TL setting 200 shows the server message "more than you get"`;
  `kept share updates live`; `DH saves a 60% split`; `BA ticks the authorised person on a completed demo`.
- [ ] **Steps 2–4:** FAIL → implement → pass; full suites, typecheck, build, docs check.
- [ ] **Step 5:** docs (the staff help page "Your income" and the HR / Super Admin setup page); commit, merge `origin/main`, push, PR 2.
