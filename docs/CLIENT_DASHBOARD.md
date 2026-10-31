# Client dashboard (the customer's own web dashboard)

Customers sign in at **`/client/login`** and use **`/client/dashboard/*`**. They see only their own business: services,
plan, invoices, tickets and notifications. Nothing here lets a customer change a price, create or edit an invoice, or
switch anything on by themselves.

Design: the Amuwa customer app (warm cream page, white rounded cards, brand teal `#0E5A53`, Bricolage Grotesque headings
and DM Sans body, pill status badges), adapted to a desktop dashboard with a slim sidebar. It is always light, spacious
(few boxes per page, generous spacing) and works on desktop, tablet and phone (the sidebar becomes a menu).

> **Onboarding journey.** New customers see an *Onboarding Journey* page first, and the sections below open stage by stage (locked
> ones stay visible and disabled, and are refused by the API). See [CLIENT_ONBOARDING_JOURNEY.md](CLIENT_ONBOARDING_JOURNEY.md).

## Sidebar (in this order)

1. **Overview** - the customer's name, business, phone, e-mail and "customer since", four counters (active services,
   current plan, invoices to pay, open tickets), a renewal reminder when one is near, and short lists (3-4 rows each) of
   services, tickets, invoices and the latest updates. Each block loads on its own and shows the real reason with a
   "Try again" button if it fails. Empty blocks say so (no sample data).
2. **My Services** - every service in `customer_services` for that customer (whatever the Sales team added, with no
   extra step), as simple cards (name, category, status, since / renews). **View details** shows start, activation, plan,
   valid-until and the details the team recorded (e.g. the WhatsApp API package shows a message-usage bar).
   `client_services()` does not depend on optional onboarding columns, so a database that is behind on migrations
   still shows the services (migration `20261020000100_client_services_resilient.sql`). Migration
   `20261023000100_client_services_contract.sql` also adds any column the function reads that an older migration
   should have added, and reloads the API's schema cache (rerunnable). An empty list shows "No services yet"; a server
   failure shows "We could not load your services" with **Try again** (no database details are shown).
3. **Explore Services** - the company's service catalogue (`crm_services`) with price (when configured) and features,
   **View details** and **Add service**.
4. **Monthly Plans** - current plan, price, features, start, next renewal, status, payment status, history, and the plans
   Accounts configured. Choosing one is a **request**.
5. **Calendar** - a month calendar of what happened on each day. The support team logs what it did for the client
   (a campaign, a call campaign, a post, an ad, a setup, a report, a meeting) with the day's **insights** (for example
   messages sent / delivered / read, calls made / answered, reach, clicks, leads); the client opens a day and sees the
   details and the result tiles. The same calendar also shows what the system recorded: services added / activated /
   renewing, invoices issued and paid, tickets raised and resolved, documents verified. Filters: everything, our work
   for you, services, invoices, tickets, documents. A new entry reaches the client's bell. Entries are made by the
   support side (below), never by the client.
6. **Documents** - the client's own checklist, grouped by "About your business", each service and "Important documents":
   every document to upload and every detail to type, with its state (*Not provided yet*, *Waiting for our team to check*,
   *Verified*, *Needs your attention* with the team's note). The client uploads a document they missed during onboarding
   (after receiving their login), replaces a rejected one, types a missing detail, and sees the documents of a **service
   bought later** appear on the same page. A verified item is locked (raise a ticket to change it). Uploads go straight to
   storage (R2 / Supabase) like every customer document (2 MB, type and content checked). The invoice, the Technical
   Consultant's own items (for example the WABA ID), approvals and access grants are not on this page.
7. **Invoices** - read-only list from Accounts: number, date, amount, GST, due date, status, what it is for, **View** and
   **Download PDF**.
8. **Tickets** - raise a ticket (subject, description, category, optional service), history, status, Support's replies,
   reply back. The customer sees only their own tickets and only the replies meant for them.
9. **Notification Center** - the customer's own notifications, unread marker, mark read / mark all read, each one opens the
   page it is about.

## Calendar activity and client documents (support side)

* **Client calendar** (Technical Consultant, Support Team Lead and a handed-over Team Member / Lead; the Department Head and
  Super Admin too): choose a client, **Log an activity** (date, what it was, service, title, details, insights) - edit or
  remove an entry later. Migration `20261031000100_client_calendar_documents.sql` (`log_client_activity`,
  `update_client_activity`, `delete_client_activity`, `client_activity_list`, `client_activity_customers`).
* **Client documents**: what clients uploaded or typed lands in a queue (**To verify** / **Reviewed**). The reviewer opens the
  file, **Verify**s it or **Sends it back** with a note; the client gets a notification either way and can upload again.
  Verification is available **after the hand-over too** (the normal onboarding review closes then), to the same people who
  can log activity (`private.can_serve_client`). Functions: `client_documents`, `client_begin_document_upload`,
  `client_complete_document_upload`, `client_save_detail`, `client_document_queue`, `review_client_document`.
* An upload is an ordinary onboarding entry (`customer_onboarding_entries`, status `SAVED`, `saved_by_client`), so progress
  counts, the Technical Consultant's checklist and the add-on counts see it.

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
* Passwords: the client sets their own from a "Set your password" e-mail link (sent when Accounts creates the login from Client Logins, not when the customer is returned to Sales; it opens `https://crm.amuwacorporation.com/client/set-password` directly, see CLIENT_ONBOARDING_JOURNEY.md), and can get a new link with "Forgot password?" on the sign-in page (see EXISTING_CUSTOMERS_IMPORT.md). There is no shared account.

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
`created_by = null`. It is **assigned to the customer's own Team Member** and placed in their Team Lead's team (from the
hand-over: `customer_onboarding.team_member_id` / `team_lead_id`); the Team Member, the Team Lead and the Department Head
each get a bell notification, and the assignment is on the ticket history (not shown to the customer). Customers not yet
handed over go to the department's Support team lead as before, and the ticket follows the customer to their Team Member
as soon as one is assigned. Team Member -> Team Lead -> Department Head see it through the existing ticket rules; the
Department Head also sees every ticket of a customer, with its status and who is working on it, on **Customers**.
Support replies from the ticket pop-up (**Reply to the customer** box, only on customer-raised tickets): that reply is
marked client-visible. **Internal notes are never shown to the customer**; status changes are shown as plain status lines.
A customer reply on a *Resolved*/*Waiting* ticket reopens it; a *Closed* ticket cannot be replied to.

## Notifications

`client_notifications` rows are written by database triggers from real events: invoice issued / paid, payment verified,
add-on and service-request updates, plan request/approval/activation, ticket replies and status changes. Each has a
`dedupe_key` (unique) so the same event never notifies twice.

## Notices: office closed and new services

* A **Department Head** (for the clients of their department) or the **Super Admin / HR head** (one department or all
  clients; the **Client notices** button in the top bar) publishes a notice. The HR department has no clients of its own, so the
  database lets its head (like the Super Admin) choose the audience; every other Department Head reaches only their own
  department's clients (migration `20261117000100_hr_client_notices.sql`). A notice: **Office closed** (a day, a run of days, or the
  same date every month - for example the monthly performance review - and how many days ahead clients start seeing it) or
  **New service** (pick a service; clients get a pop-up).
* Clients see "office closed" notices as a banner at the top of every page ("Our office will be closed in 3 days"; "closed
  today" on the day) from the number of days you chose ahead of the closure (7 by default; the bell shows it at once), with the Department Head's message, and in their Notification Center. Each client can dismiss a notice;
  it is remembered per client and per occurrence (next month's closure shows again).
* A **new service** pop-up has **Know more**, which opens that service's details in Explore Services
  (`/client/dashboard/explore?service=CODE`), and **Maybe later**. It is shown once per client and not at all to a client
  who already has the service.
* **Adding a service to the catalogue** (`crm_services`) announces it to every client automatically and tells all
  Department Heads.
* Data: `client_announcements`, `client_announcement_dismissals` (RLS on, no direct access). Staff use
  `publish_client_announcement`, `client_announcements_overview`, `end_client_announcement`; clients use
  `client_announcements()` and `client_dismiss_announcement()` (API: `GET /client/announcements`,
  `POST /client/announcements/:id/dismiss`). Dates use the office's time zone (India).

## Where things are

| What | Where |
| --- | --- |
| Migrations | `supabase/migrations/20261018000100_client_dashboard.sql`, `20261022000100_dashboard_v2_leads_onboarding.sql` (notices, ticket routing) |
| DB tests | `supabase/tests/client_test.sql` (run by `npm run test:db`) |
| API tests | `supabase/tests/api_integration.test.ts` ("client dashboard API" block, `npm run test:api`) |
| API | `server/clientRoutes.ts` (client side), `server/controllers/index.ts` -> `clientWorkflowController` (staff side), `server/services/ClientService.ts`, `server/repositories/ClientRepository.ts` |
| Shared types / validation | `shared/contracts.ts`, `shared/validation.ts` (client section) |
| Client UI | `src/client/*` (`ClientApp.tsx` shell + routing, one file per section, `client.css` scoped to `.cd`) |
| Staff UI | `src/components/support/consultant/ClientServiceRequests.tsx`, `src/components/accounts/AccountsPlans.tsx`, reply box in `src/components/support-member/TicketsPage.tsx` |

### API (all under `/api/v1/client`, client token required)

`GET /me` `GET /overview` `GET /services` `GET /catalog` `GET|POST /service-requests` `DELETE /service-requests/:id`
`GET /plans` `POST /plan-requests` `GET /invoices` `GET /invoices/:id/url?action=view|download` `GET|POST /tickets`
`GET /tickets/:id` `POST /tickets/:id/replies` `GET /announcements` `POST /announcements/:id/dismiss` `GET /notifications?limit&offset` `POST /notifications/read`

Staff side: `GET /pipeline/service-requests` (open requests), `GET /pipeline/customers/:id/service-requests`,
`POST /pipeline/service-requests/:id/decision` (Technical Consultant); `GET|POST /accounts/plans`,
`PATCH /accounts/plans/:id`, `POST /accounts/plan-requests/:id/decision` (Accounts; plan changes need an Accounts head or
lead); `POST /support/tickets/:id/client-reply` (Support).

## Deploying it

1. Run `supabase/migrations/20261018000100_client_dashboard.sql` and then `20261022000100_dashboard_v2_leads_onboarding.sql`
   in the Supabase SQL editor (both re-runnable). They need the earlier migrations already applied.
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
