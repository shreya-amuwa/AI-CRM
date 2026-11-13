# Super Admin Overview: attendance and business by department

The Super Admin's **Overview** page now opens with two department bands, above the existing company summary. Nothing else in the
Super Admin dashboard, the sidebar, the other dashboards or the Accounts dashboard changed.

1. **Attendance by department** (first). One card per department: how many employees are absent, the department's staff count, and the
   names of the absent employees. A department where everyone punched in shows **No Employees Absent**. A long list scrolls inside its
   card, so a large department never stretches the band. A date picker shows an earlier day (up to two years back); the default is today.
2. **Business by department** (second). One card per revenue department (the departments Accounts shows under Department Income), with
   a period picker: this month (default), last month, this year, the last 10 years, or custom dates.
3. The **Outstanding balance** card was removed from the Overview's summary strip. The figure itself, the per-department "Balance due"
   column and every Accounts screen are unchanged.

## Where every figure comes from

One read-only database function, `public.dashboard_overview_departments(p_from, p_to, p_attendance_date)`
(migration `20270101000100_superadmin_overview_departments.sql`), API `GET /dashboard/company-departments?from=&to=&attendanceDate=`.
It reuses the existing calculations so the numbers match the screens they come from:

| Figure | Rule | Matches |
| --- | --- | --- |
| Absent | An ACTIVE employee (not the Super Admin) who has not punched in that day (`private.attendance_status = NOT_PUNCHED_IN`). Grouped by base department (a facet such as WabaTalk counts with its parent). People who joined after the day are left out. Approved leave covering the day is shown as *On leave* / *Half-day leave*. | HR's attendance register for the same day |
| Department Income | All verified income attributed to the department (`private.verified_income_attributed`). | Accounts → Department Income (`accounts_finance_by_department`) |
| Income | The same verified income, paid in the period (`paid_at::date`). | `accounts_finance_summary(department, from, to)` income |
| Expenses | The department's share of each expense (`expense_allocations`) dated in the period. A shared expense is counted once, each department its own part. | `accounts_finance_summary(department, from, to)` expenses |
| Customers onboarded | The department's customers whose onboarding was completed in the period (`customer_onboarding.onboarding_completed_at`). | — |
| Recharges | Completed plan purchases and renewals in the business ledger (`private.business_ledger`, `tx_type` SUBSCRIPTION / RENEWAL, status COLLECTED) in the period: count and amount. | Business Reports |

Notes:

* Customers onboarded before the onboarding checklist existed have a completion date set when that migration ran, so a period covering
  that day counts them then.
* A paid monthly plan is a recharge but is not "verified income" in Accounts, so recharge amounts are shown on their own line and are not
  added to Income.

## Permissions

Super Admin only, checked in the database (`FORBIDDEN` for everyone else, including Accounts, Department Heads, Team Leads and members)
and again in the API. The function only reads: it records nothing and changes no attendance.

## Rollout

Run `supabase/migrations/20270101000100_superadmin_overview_departments.sql` in the Supabase SQL editor (safe to run twice). Until it is
run, the two new bands show "could not be loaded" with a retry button; the rest of the Overview keeps working.

## Tests

* `supabase/tests/superadmin_overview_test.sql`: absent names under the right department, present and on-leave people, the same list as the
  HR register, Department Income / Income / Expenses equal to Accounts' functions, onboarding and recharges counts, who may read it.
* `supabase/tests/api_integration.test.ts`: the route's sign-in, Super Admin only, date validation and totals.
* `supabase/tests/e2e/dashboards.e2e.mjs`: the bands come first and the Outstanding balance card is gone.
