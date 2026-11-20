# Sales Incentives and "Income" (My Earnings): Design, Phase 1 (rules, ledger, Income pages)

## Context
Sales staff (Operations Head → Department Head → Team Lead → Team Member, including Telecallers, Business Associates and field Sales
Executives) should see what they earn, live, to stay motivated. Today the CRM pays nobody: there are no incentives, no earnings, no
payouts and no staff bank details. The structure is set by the Super Admin and cascades down the hierarchy, each level keeping a share.
Eventually telecallers outside the office (worldwide) use it, and staff withdraw their balance through the Accountant.

This is four projects. **This plan covers 1–3**; **payouts (4) get their own design next**, because they involve real money transfers,
bank / UPI details, KYC and tax deductions.
1. Incentive rules (who gets how much). 2. Earnings ledger (earned automatically). 3. Income pages. 4. Withdrawals and payouts (next).

## Decisions made with the owner
- **A sale's incentive is earned only when Accounts verifies the customer's payment** (as Department Income already works); a reversed
  payment reverses the earning.
- **Part payments release incentive proportionally** (₹1,000 of a ₹2,000 order verified = 50% of that order's incentive now).
- **Targets are goals only** (shown as progress, e.g. "412 of 1,000"); every sale earns from the first one. No slabs in phase 1.
- **Events in phase 1:** sale paid (per product unit), demo completed, field visit completed; field Sales Executives are also rewarded on
  the business they bring (sales paid credited to them).
- **Flexibility:** the Super Admin creates incentive rules and chooses whom each applies to (a level, a sales sub-role, a department, a
  team or a person).
- **Incentives start after the employee completes 15 days in the company.** Events before then earn nothing (their joining date is
  the HR joining date, falling back to the date the account was activated); the Income page shows "Incentives start on <date>" until
  then. The 15 days is a company setting the Super Admin can change.
- **Approach: instant ledger.** An earning is recorded the moment its event happens, using the rule in force then, and reversed if the
  event is undone. Every rupee traces to one event and one rule; rules are never applied retroactively.

## Proposals (my calls; the owner can correct them)
- **Cascade for sales:** the Super Admin sets the amount per product for the Operations Head (e.g. ₹500); each level sets the amount for
  the level below (never more than its own), keeping the difference. On a sale, the closer gets their level's amount, and each level
  above in the closer's chain gets the share it kept (TM 100 + TL 50 + DH 150 + OH 200 = 500). A Team Lead who closes a sale gets the
  Team Member amount plus their own share.
- **Telecaller → Business Associate split:** when a telecaller's lead (the existing `ba_contacts` link) converts through a BA, the
  closer's amount is split between them by a percentage the Department Head sets.
- **Demo completed:** only counts when the BA marks the demo Completed **and** ticks a new "attended by the authorised person" box.
- **Event rewards (demo, field visit):** fixed amount per event, assigned by the Super Admin directly to recipients (no cascade), with an
  optional monthly cap per person.
- **Product = a service in the catalogue** (`crm_services` / `customer_services`); a customer order's verified payment releases incentive
  for each service unit in that order, proportionally to the amount verified.
- **Rupees only in phase 1**, stored as `numeric(14,2)` like all money in the CRM; other currencies come with worldwide payouts.

## What gets built (phase 1)
1. **Database** (one migration, safe to run twice; security-definer functions; audit log):
   - `incentive_rules` (event type, product, amount, period, target, assignee scope, created by, active from / to; never edited after
     use: a change ends the old rule and starts a new one).
   - `incentive_allocations` (the cascade: rule, level / person, amount for the level below, set by whom).
   - `incentive_splits` (Department Head's telecaller / BA percentage).
   - `earnings` ledger (person, rule, event type, event id, amount, status EARNED / REVERSED, linked reversal row, created at); one row
     per person per event per rule (unique key, so retries never double-pay).
   - Triggers / functions on: `customer_payments` becoming VERIFIED or REVERSED (sales, proportional), `ba_demos` becoming COMPLETED with
     the authorised-person tick, `lead_visits` becoming COMPLETED with GPS.
2. **API and screens**
   - **Income** in the side panel of every sales dashboard (Sales Head / Operations Head, Team Lead, Telecaller, Business Associate,
     Team Member): Today's earnings, this month, total, balance; a list of earnings with what each was for; progress towards targets;
     from the owner's notes, activity tiles where the data exists (business, calls and call duration from Crocodial, demos booked).
   - **Incentive setup:** Super Admin creates rules and assigns them; Operations Head / Department Head / Team Lead set the amount for the
     level below and see their kept share; Department Head sets the telecaller / BA split.
3. **Tests:** database tests for each event, the cascade, the split, proportional part payments, reversals, double events, and who may
   see / set what; browser tests for the Income page and the setup screens.

## Not in phase 1 (next designs)
- Withdrawals and real payouts (bank / UPI details, Accountant approval, how money is sent: manual transfer with a reference number or
  a payout service; TDS; worldwide currencies). Balance is shown in phase 1; "Withdraw" comes with phase 2.
- Slabs / bonuses on targets; "Project deadline + timer clock" from the notes (a separate idea).

## Critical files (existing, to reuse)
- Roles / hierarchy: `supabase/migrations/20261006000200_authorization_helpers.sql` (`private.my_role`, `my_team_id`, …),
  `20261205000100_operations_head.sql`, `20261211000100_employee_approval_hierarchy.sql` (`department_operations_owner`),
  `20261118000100_telecaller.sql` (`sales_sub_role`, `private.is_telecaller`), `20261119000100_business_associate.sql` (`ba_contacts`,
  `ba_demos`).
- Money: `customer_payments` (`20261011000200_payments_accounts_workflow.sql`), `service_prices`, `crm_services`, `customer_services`.
- Field visits: `20261203000100_sales_field_visits.sql` (`lead_visits`).
- Screens: `src/components/layout/shell.tsx` (`DashboardShell` groups), `src/components/sales-head/SalesHeadDashboard.tsx`,
  `src/components/team-lead/TeamLeadDashboard.tsx`, `src/components/telecaller/TelecallerDashboard.tsx`,
  `src/components/business-associate/BusinessAssociateDashboard.tsx`, `src/components/team-member/TeamMemberDashboard.tsx`.

## Verification
- `bash supabase/tests/run.sh` (new `incentives_test.sql`), `run-api.sh`, `run-unit.sh` (new `ui_income` browser test), typecheck, build.
- An employee on day 14 earns nothing for a completed demo; on day 16 they do; the Income page shows the start date before then.
- Worked example as a test: the ₹500 product cascade (OH 200, DH 150, TL 50, TM 100), a ₹2,000 order paid ₹1,000 + ₹1,000 (two releases
  of 50%), a reversal, a telecaller / BA 60/40 split, a ₹50 completed demo with and without the authorised-person tick.
