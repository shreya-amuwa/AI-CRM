# Telecaller Sheets and Service Prices are Sales-only

| Who | Telecaller Sheets (assign / read sheets) | Service Prices (read) | Service Prices (change) |
|---|---|---|---|
| Super Admin | yes | yes | yes |
| Sales Department Head (also a shared / combined head while the Sales function is active) | yes | yes | yes |
| Head of a whole department with no side set (not HR / Accounts) | yes (as before) | yes | yes |
| **Support Department Head** (or a shared head while Support is active) | **no** | **no** | **no** |
| HR / Accounts Department Head | no | no | no |
| Sales Team Lead | read the team's sheets | yes | no |
| **Support Team Lead / Support member** | **no** | **no** | no |
| Telecaller | their own sheets | no | no |
| Business Associate (and a Sales member who works as one) | no | yes (to quote) | no |

* **Menu:** the Sales Department Head dashboard has both pages (Work group). The Support Department Head dashboard no longer lists them. They were only in the shared Department Head dashboard before.
* **Database** (`20261130000100_sales_only_sheets_prices.sql`, re-runnable, no data touched): `private.in_sales_section()` is the one rule; `require_sheet_assigner`, `telecaller_can_read` (also the table policies of `telecaller_contact_lists` / `telecaller_contacts`), `telecaller_lists`, `service_prices_list`, `service_price_save` and the `service_prices` table policy use it. Before, the price table could be read by every signed-in user and any Department Head could save prices.
* **API:** unchanged routes; the database answers 403 for a Support caller. Tests: `supabase/tests/sales_only_sections_test.sql`, `api_integration.test.ts` ("sales-only: ...", incl. direct table access through PostgREST) and the browser test `e2e/run-sales-only-need-help.sh`.
* The active function of a shared or combined head comes from the request header the app sends (`x-active-division`), the same mechanism as the rest of the department scope.
