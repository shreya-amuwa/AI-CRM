# One Sales dashboard (the Business Associate dashboard)

The Sales Team Member dashboard and the Business Associate dashboard are now **one dashboard**: the Business Associate dashboard
(`/business-associate/dashboard/:id`). A Business Associate and a **Sales Team Member with no other Sales role** both work in it. Nothing was copied:
the pages of the Sales Team Member dashboard that the Business Associate did not have now live in the unified dashboard, once.
Nothing in the database changed for this except one read-only list (see "Subscriptions").

## Who opens what

| Employee | Dashboard |
| --- | --- |
| Sales Team Member (no Sales role) and Business Associate | **Unified Sales dashboard** (`business-associate`) |
| Telecaller | Telecaller dashboard (unchanged) |
| Sales Team Lead | Team Lead dashboard (unchanged) |
| Sales Department Head | Sales Department Head dashboard (unchanged) |
| Team Members outside Sales | Team Member dashboard (unchanged) |

`toAuthUser` (`src/lib/auth/roleMapping.ts`) decides the route for navigation only. Every permission is still enforced by the API and the database from the profile
(`private.ba_eligible()` already let a Sales Team Member use the Business Associate functions, on their own contacts only).
The old address `/team-member/dashboard/:id` of a Sales member redirects to `/business-associate/dashboard/:id` (the route guard); there were no other pages under it.

## Audit: the two dashboards before the merge

| Page / feature | Sales Team Member dashboard | Business Associate dashboard | In the unified dashboard |
| --- | --- | --- | --- |
| Home (numbers, lead sources, target, today's activities) | yes (store based) | yes (BA numbers, demos, recent activity) | **one Home**: both sets of numbers, a metric both had is shown once |
| Leads group (Leads, Potential, Customer onboarding, Part payments) | yes | yes (the same component) | one (`PipelineWorkspace`) |
| Field Visit (10 pages) | yes (Sales members) | yes | one (`FieldVisitWorkspace`) |
| My Customers | yes | - | **My Customers** |
| Tasks & Follow-ups (scheduled follow-ups, call and WhatsApp log) | yes | - | **Tasks & Follow-ups** |
| My Tasks (work tasks) | yes | - | **My Tasks** |
| Calendar | yes | - | **Calendar** |
| Invoices (the member's invoices) | yes | - | **Invoices** |
| Delivery Queue | yes | - | **Delivery Queue** |
| Settings & targets | yes | - | **Settings** |
| Chat | yes | - | **Chat** (unread badge) |
| Notification Center (page) | yes | bell only | **Notification Center** + the bell |
| Raise an Issue | yes | yes | one |
| Leave Center, notification bell (top bar) | yes | yes | one |
| BA Tasks (contacts handed over by Telecallers) | in a "Business Associate" group | yes | **BA Tasks** |
| Quotation, Demo Schedule, Scope of Project | in that group | yes | one of each |
| Subscriptions (plan, duration, payment status, panel creation) | in the customer / lead pages | in the customer / lead pages | the same panels, plus a read-only **Subscriptions** list |

The shared pieces: `src/components/team-member/MemberSections.tsx` (the member pages; used by the Team Member dashboard and by this one) and
`src/components/team-member/pipeline/*`, `src/components/field-visit/*`, `src/components/chat/*`, `src/components/issues/*` (unchanged).

## The unified menu

* **Overview** - Dashboard
* **Sales & Leads** - Leads (Leads, Potential, Customer onboarding, Part payments), My Customers, Tasks & Follow-ups, My Tasks, Field Visit, Calendar
* **Business Associate** - BA Tasks, Quotation, Demo Schedule, Scope of Project
* **Subscriptions & Services** - Subscriptions, Invoices, Delivery Queue
* **Communication** - Chat, Notification Center, Raise an Issue
* **Account** - Settings

Only pages that already existed are in it. "Account creation" is Customer onboarding, "Payment status" is Part payments and the payment column of Subscriptions, and there are no
separate report pages: the reports of the two dashboards were their Home numbers, which are on Dashboard.

## The one Home

| Tile | Source (one calculation each) |
| --- | --- |
| Total Leads (+ new in 7 days), Converted Customers (+ rate) | the member's leads (`teamMemberStore`) |
| Pending Follow-ups | contact and lead follow-ups due (`ba/home`) **plus** the open scheduled follow-up tasks; the hint shows both |
| Accounts Created | customers in onboarding (`pipeline/counts`) |
| Active Subscriptions | `subscriptions_list().counts.active` |
| Pending Payments | part payments still to collect (`pipeline/counts`) |
| Assigned Contacts, Upcoming Demos, Quotations, Scope Documents | `ba/home` |

Also on Dashboard: the next demos, recent activity, the sales target and today's activities, the lead-source chart, where the contacts are, and the quick actions.
The "Leads in Progress" and "Completed Contacts" tiles of the Business Associate Home were left out as duplicates of Total Leads and of the contact stages list.

## Subscriptions (read only)

`GET /pipeline/subscriptions` -> `public.subscriptions_list(search, status, page, page_size)` (migration `20261212000100_sales_subscriptions_list.sql`; safe to run again).
One row per service of the customers the caller may see - the same scope as the customer pages (the owner, the Team Head of the team, the Department Head of the department, the Super Admin) -
with the plan, duration, amount, payment status, panel creation date, status, start and expiry dates. It reads existing tables only. The dashboard also works if the migration has not been
run yet (the page shows an error; Home shows a dash for the subscription tile).

## Permissions

Nothing was widened. A Sales member still sees only their own leads and customers (RLS and the `SECURITY DEFINER` functions are unchanged); the Business Associate functions still check
`private.is_business_associate()` / `ba_eligible()` and ownership; changing the price list stays with the Super Admin / Department Head; a client, a Telecaller and every other
role are refused by the same checks as before.

## Tests

`supabase/tests/sales_dashboard_routing.test.ts` (who opens what, the redirect), `supabase/tests/subscriptions_list_test.sql` (scope of the list),
the Business Associate, Telecaller and Field Visit browser tests (`supabase/tests/e2e/*`, updated for the unified menu).
