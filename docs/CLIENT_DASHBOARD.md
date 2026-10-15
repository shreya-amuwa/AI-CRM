# Client dashboard (the customer's own web dashboard)

Customers sign in at **`/client/login`** and use **`/client/dashboard/*`**. They see only their own business: services,
plan, invoices, tickets and notifications. Nothing here lets a customer change a price, create or edit an invoice, or
switch anything on by themselves.

Design: the Amuwa customer app (warm cream page, white rounded cards, brand teal `#0E5A53`, Bricolage Grotesque headings
and DM Sans body, pill status badges, a teal "hero" card for the current plan), adapted to a desktop dashboard with a
sidebar. It follows the device's light/dark setting and works on desktop, tablet and phone (the sidebar becomes a menu).

## Sidebar (in this order)

1. **Overview** - business and contact, active services, current plan, invoices to pay, open tickets, upcoming renewals,
   recent invoices / tickets / notifications. Empty sections say so (no sample data).
2. **My Services** - every service in `customer_services` for that customer (whatever the Sales team added, with no
   extra step): name, description, category, start date, activation date, plan, valid-until/renewal, status
   (`Live` / `Setting up`) and the details the team recorded (e.g. the WhatsApp API package shows a message-usage bar).
   `client_services()` does not depend on optional onboarding columns, so a database that is behind on migrations
   still shows the services (migration `20261020000100_client_services_resilient.sql`).
3. **Explore Services** - the company's service catalogue (`crm_services`) with price (when configured) and features,
   **View details** and **Add service**.
4. **Monthly Plans** - current plan, price, features, start, next renewal, status, payment status, history, and the plans
   Accounts configured. Choosing one is a **request**.
5. **Invoices** - read-only list from Accounts: number, date, amount, GST, due date, status, what it is for, **View** and
   **Download PDF**.
6. **Tickets** - raise a ticket (subject, description, category, optional service), history, status, Support's replies,
   reply back. The customer sees only their own tickets and only the replies meant for them.
7. **Notification Center** - the customer's own notifications, unread marker, mark read / mark all read, each one opens the
   page it is about.

## Sign-in and provisioning (no hard-coded or shared logins)

* The **Technical Consultant** creates the login in the existing **Client panel login** card (customer's e-mail + a
  password). That calls `POST /api/v1/pipeline/customers/:id/client-account`, which creates a **Supabase Auth** user and a
  row in `customer_client_accounts (customer_id, auth_user_id, email)`. **The password is never stored in the CRM**: it lives
  only in Supabase Auth, and is never returned or logged.
* The client signs in with `supabase.auth.signInWithPassword`. The server maps the login to **one customer** from
  `customer_client_accounts` (the database function `client_me()` / `private.my_client_customer()`), never from anything
  the browser sends.
* A **staff** login is refused on the client page ("not a client account"), and a **client** login is refused by every staff
  route. A customer who signs in on the normal staff login page is sent to `/client/dashboard`.
* Wrong credentials, an expired session, a network failure and "no access" each have their own message.
* Passwords are reset by the Technical Consultant (Supabase Auth); there is no shared account.

## How the customer's data is protected

Three layers, all must agree:

1. **Database (RLS + RPC-only access).** The new tables (`client_notifications`, `monthly_plans`, `monthly_plan_services`,
   `customer_plans`, `plan_requests`, `service_requests`) have row-level security on and **all grants revoked**: a signed-in
   customer cannot `select` or `insert` them directly. The customer reads and writes through `SECURITY DEFINER` functions
   (`client_*`) that take **no customer id**: they work out the customer from `auth.uid()`. Existing tables (customers,
   invoices, tickets, documents) were already hidden from customers by RLS and stay hidden.
2. **API (`/api/v1/client/*`).** Own authentication path: the token is checked, `client_me()` must succeed (staff get 403,
   bad/expired token 401), a per-client rate limit applies, and every request body/query is validated with Zod. No route
   accepts a customer id.
3. **Storage.** Invoice PDFs are in a private bucket. `GET /client/invoices/:id/url` asks the database whether *this*
   customer owns *that* invoice (`client_invoice_file`) and only then signs a **120-second** link. Each view/download is
   written to the audit log (`CLIENT_INVOICE_VIEWED`).

Tested: client A cannot read client B's tickets, invoices, plans, requests or invoice file through the API, a direct
table query, or a guessed URL; staff cannot call client functions and clients cannot call staff functions.

## Add-on services (Explore Services -> Add service)

1. The customer asks. A `service_requests` row is created (`REQUESTED`). **Nothing is bought or activated.** Duplicates are
   refused (one open request per customer + service; a service the customer already has cannot be requested).
2. The **Technical Consultant** sees it on **Add-ons Services -> "Asked for by customers"** (and a bell notification).
   They **Start review**, or **Decline** with a reason the customer reads. They then price it with the existing add-on
   request ("Price and send to Accounts"; the asked-for service is preselected). Prices are set only by staff.
3. That is the existing add-on workflow: **Accounts verifies the price**, uploads the invoice, **confirms the payment**.
   The request moves to *With Accounts* (the customer sees it).
4. When the add-on is **completed** (approved + paid + documents verified) the service is added to the customer
   (`customer_services`, activation date set) and shows in **My Services**. Not before.

Customers can withdraw a request while it is still `REQUESTED`.

## Monthly plans

* Plans are **data** (`monthly_plans`, optional `monthly_plan_services`). **Accounts managers** (Accounts head / team lead)
  create and edit them: Accounts Department Head dashboard -> **Monthly Plans** (and the Accounts dashboard). Until Accounts
  adds one, customers see "no monthly plans available" - nothing is invented.
* The customer's choice (new plan / upgrade / switch) is a **request** (`plan_requests`). Accounts **Approves**, then
  **activates only after ticking that the payment is confirmed**. Activation closes the old plan (history is kept) and starts
  the new one. A plan has a start date and an optional renewal date.
* There is **no automatic recurring billing**: renewals are dates shown to the customer; Accounts issues each invoice.

## Tickets

Reuses the Support ticket system (`support_tickets`, `support_ticket_updates`). A ticket raised by a customer has
`created_by = null` and goes to the department's Support team (its head and Technical Consultants are notified).
Support replies from the ticket pop-up (**Reply to the customer** box, only on customer-raised tickets): that reply is
marked client-visible. **Internal notes are never shown to the customer**; status changes are shown as plain status lines.
A customer reply on a *Resolved*/*Waiting* ticket reopens it; a *Closed* ticket cannot be replied to.

## Notifications

`client_notifications` rows are written by database triggers from real events: invoice issued / paid, payment verified,
add-on and service-request updates, plan request/approval/activation, ticket replies and status changes. Each has a
`dedupe_key` (unique) so the same event never notifies twice.

## Where things are

| What | Where |
| --- | --- |
| Migration | `supabase/migrations/20261018000100_client_dashboard.sql` |
| DB tests | `supabase/tests/client_test.sql` (run by `npm run test:db`) |
| API tests | `supabase/tests/api_integration.test.ts` ("client dashboard API" block, `npm run test:api`) |
| API | `server/clientRoutes.ts` (client side), `server/controllers/index.ts` -> `clientWorkflowController` (staff side), `server/services/ClientService.ts`, `server/repositories/ClientRepository.ts` |
| Shared types / validation | `shared/contracts.ts`, `shared/validation.ts` (client section) |
| Client UI | `src/client/*` (`ClientApp.tsx` shell + routing, one file per section, `client.css` scoped to `.cd`) |
| Staff UI | `src/components/support/consultant/ClientServiceRequests.tsx`, `src/components/accounts/AccountsPlans.tsx`, reply box in `src/components/support-member/TicketsPage.tsx` |

### API (all under `/api/v1/client`, client token required)

`GET /me` `GET /overview` `GET /services` `GET /catalog` `GET|POST /service-requests` `DELETE /service-requests/:id`
`GET /plans` `POST /plan-requests` `GET /invoices` `GET /invoices/:id/url?action=view|download` `GET|POST /tickets`
`GET /tickets/:id` `POST /tickets/:id/replies` `GET /notifications?limit&offset` `POST /notifications/read`

Staff side: `GET /pipeline/service-requests` (open requests), `GET /pipeline/customers/:id/service-requests`,
`POST /pipeline/service-requests/:id/decision` (Technical Consultant); `GET|POST /accounts/plans`,
`PATCH /accounts/plans/:id`, `POST /accounts/plan-requests/:id/decision` (Accounts; plan changes need an Accounts head or
lead); `POST /support/tickets/:id/client-reply` (Support).

## Deploying it

1. Run `supabase/migrations/20261018000100_client_dashboard.sql` in the Supabase SQL editor (re-runnable). It needs the
   earlier migrations already applied.
2. Redeploy the app. Set **`APP_URL`** to the public address if you want links in emails to point at the right place.
3. In **Accounts -> Monthly Plans**, add the plans you sell. Optionally set `description`, `starting_price`, `price_note`
   and `features` on the services in `crm_services` so Explore Services can show them (otherwise it says "Price confirmed
   after review"):

   ```sql
   update public.crm_services set description = '...', starting_price = 4999, features = '["Feature one","Feature two"]'::jsonb where code = 'META_ADS_MANAGEMENT';
   ```
4. Give the Technical Consultants the client address: `https://<your-domain>/client/login`.

Notes: a client and a staff member signing in on the same browser share Supabase's saved session, so signing in as one
replaces the other in that browser. Add-on services appear in **My Services** only after the add-on is completed.
