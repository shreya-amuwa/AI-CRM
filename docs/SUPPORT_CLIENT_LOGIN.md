# Support: Create a client login from the customer's page

Migration `20270218000100_support_client_login.sql` (run once in the Supabase SQL editor; safe to run twice).

## Why
A client login used to be made only by the import (the **Client Login E-mail** column of the Excel import or the Google Sheet sync) or by
Accounts after a verified payment. A customer added without that column, for example by the sheet sync, had no way to get a login from the
Support side: the card said "No client login yet. Accounts creates it once the payment is verified."

## What the Support team member sees
On the customer's page, the **Client login** card of a customer with no login shows **Login e-mail** (the customer's e-mail, which can be
changed) and **Create login**. The client gets the "Set your password" e-mail (the link works once, for 24 hours); afterwards the card shows the
login and **Send password link**, as for every other client login.

## Who may
The same people who may send a set-password link for that customer: the Support team member who looks after it (and their Team Lead / head as
`private.may_update_support_customer` allows). Anyone else gets "not found"; Accounts keeps its own path (Client Logins).

## Checks (the database decides)
* `support_client_login_begin(customer, email)`: who, no login yet, a valid e-mail that is not already a client login, a staff e-mail or another sign-in.
* The API creates the sign-in in Supabase Auth with a random password nobody knows and e-mails the set-password link (the same code as the import).
* `support_client_login_record(customer, user, email)`: saves it only if that sign-in was made for this customer; recorded in the customer's activity and
  in the audit log (`CLIENT_LOGIN_CREATED`, via `support`). A second login is refused.

API: `POST /api/v1/customers/:id/client-login` with `{ "email"?: string }`. `GET /api/v1/customers/:id/client-login` now also returns `canCreate` and
`suggestedEmail` when there is no login.

Tests: `supabase/tests/support_client_login_test.sql`, the "Support Create login" block of `api_integration.test.ts`.
