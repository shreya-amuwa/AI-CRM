# Sales incentives and "My Income" (phase 1)

Migration `20270119000100_sales_incentives.sql`. Design: `docs/superpowers/specs/2026-11-20-sales-incentives-income-design.md`.
Payouts (withdrawing a balance through Accounts) are phase 2; until then the balance is everything earned.

## Rules (the Super Admin)
`incentive_rule_create(p jsonb)`: what it rewards (`SALE_PAID`, `DEMO_COMPLETED`, `VISIT_COMPLETED`), the amount, an optional target (a goal
shown as progress only), an optional monthly cap (event rewards), and who it is for:
- **Sales (`SALE_PAID`)**: a product (`crm_services.code`) and the Operations Head it is given to (amount per unit).
- **Event rewards**: a level (`DEPARTMENT_HEAD` / `TEAM_HEAD` / `TEAM_MEMBER`), a sales sub-role (`TELECALLER`, `BUSINESS_ASSOCIATE`, …), a
  department, a team or a person.
Rules are never edited: `incentive_rule_end` stops one at once (earnings already recorded stay) and a new one is created. The start period
(15 days in the company by default) is `incentive_settings_set(days)`.

## The cascade (sales)
Each level passes an amount per unit to the level directly below (`incentive_allocation_set`), never more than it holds, and keeps the
difference: **Operations Head → Department Head (the department's Sales head) → Team Lead → Team Member**. The person who closed the sale
(the customer's owner when the payment is verified) gets what they hold; each level above gets what it kept. Missing levels are left out.
A Department Head sets the **telecaller split** (`incentive_split_set`): a telecaller's lead closed by its Business Associate splits the
closer's part (e.g. 60% telecaller, 40% BA).

**Worked example:** ₹500 per unit to the Operations Head; OH → DH 300; DH → TL 150; TL → TM 100. A ₹2,000 order paid ₹1,000 + ₹1,000:
each verified payment releases 50% → TM 50, TL 25, DH 75, OH 100, twice.

## When an earning is recorded (instantly, in the database)
- **Sale paid:** a `customer_payments` row becomes `VERIFIED` (Accounts). It releases payment ÷ order total (`agreed_amount`, else
  `deal_amount`), never more than 100% in all, for every sales rule of a product the customer bought. Leaving `VERIFIED` (reversed, rejected,
  back to pending) reverses it; verifying again pays once.
- **Demo completed:** a Business Associate demo `COMPLETED` **and** "authorised person attended" ticked (`ba_demo_set_authorised`); paid to
  the demo's BA and the lead's telecaller when a rule applies to them. Unticking or leaving Completed reverses it.
- **Field visit completed:** a `lead_visits` row `COMPLETED` with `gps_captured`; paid to the employee.
- **Start:** nobody earns for events before their joining date (`employee_personal_details.joining_date`, else the account's approval or
  creation date) + the start period. Their share is not given to anyone else.
- A calculation problem never blocks Accounts: it is written to the audit log (`INCENTIVE_ERROR`).

## Reading (the Income page)
`income_summary()` (today, this month, total, balance, start date, target progress, this month's activity) and
`income_earnings(from, to, limit)`: the signed-in person's own earnings only. `incentive_setup()`: the setup screen's data.

Tests: `supabase/tests/incentives_test.sql`.
