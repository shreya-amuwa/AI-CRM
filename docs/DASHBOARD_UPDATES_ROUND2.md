# Dashboard updates, round 2 (staff side)

Migration: `supabase/migrations/20261022000100_dashboard_v2_leads_onboarding.sql` (run it in the Supabase SQL editor, then redeploy).

## 1. Lead details carry into onboarding (nothing typed twice)

* The lead now has a **Business address** (Add lead and Edit lead).
* When a customer enters onboarding, the lead's **Customer Name**, **Mobile Number**, **Business Name** and **Business
  Address** are filled into the onboarding cards by the database. Editing the lead afterwards updates the cards (a card that
  changed goes back to "Saved", so the Technical Consultant reviews the new value).
* The other way round too: editing one of those four cards in onboarding updates the customer record. One value, one place.
* Existing customers: the cards are filled for everyone already in onboarding (nothing already saved is overwritten).

## 2. Business Name and Business Address are separate cards

"Business name & address" is split into two onboarding cards. The old card is switched off; anything already saved on it is
kept on both new cards with the same review status. The checklist now has 15 items for a typical customer (it was 14).

## 3. The Technical Consultant can correct what Sales sent

While a customer is still in onboarding with Support (before the hand-over to the Department Head), the consultant sees
**Edit** on each detail and **Replace file** on each document in the customer's Documents list. The usual checks apply
(file type, 2 MB limit, file content), the new value or version is saved under the consultant's name, goes back to
"Pending review", and old file versions are kept as history. Invoices stay with Accounts, and deleting a file stays with Sales.

## 4. The Department Hub is for the Super Admin only

Department Heads (including the HR head) no longer see the "Department Hub" button or the all-departments screen; they open
straight into their own department. The Super Admin sees everything as before.

## 5. Department Head: Customers

A new **Customers** page lists the department's customers (those sent to Support and customers), each with its **Team
Lead**, **Team Member**, hand-over status and ticket counts (pending / resolved). Click one to see the customer's details,
services, client-login status and every ticket with its status, who raised it (client or staff), the Team Member working on
it and the Team Lead. It refreshes when tickets or hand-overs change (no timer).

## 6. Client tickets reach the right people

A ticket a client raises is assigned to the client's Team Member and the Team Lead's team; the Team Member, Team Lead and
Department Head are notified. See `docs/CLIENT_DASHBOARD.md` (Tickets).

## 7. Client notices (office closed, new services)

* **Department Head dashboard -> Client Notices**, or **Client notices** in the top bar for the Super Admin / HR head.
* Office closed: one day, several days, or the same date every month; choose how many days ahead clients start seeing it.
* New service: pick a service and publish; clients get a pop-up whose **Know more** opens the service in Explore Services.
* A service added to the catalogue is announced to all clients automatically, and every Department Head is notified.
* **End** stops a notice. Clients can dismiss a notice for themselves.

## 8. Select all services

On Add lead and Edit lead: **Select all services** (and **Clear all**), plus **Select all in section** for each group.

## 9. Client dashboard redesign

See `docs/CLIENT_DASHBOARD.md`: a calmer layout, a slim sidebar with the real logo, simpler Overview and My Services, and
a My Services page that no longer depends on optional database columns.
