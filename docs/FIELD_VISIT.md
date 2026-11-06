# Field Visit (Sales Telecaller, Business Associate, Sales Team Member)

Field Visit is a sidebar group **inside** the existing Telecaller, Business Associate and Sales Team Member dashboards (no separate dashboard):
Field Visit Overview, Department Head Assigned Leads, Add Lead, All Leads, My Leads, Department Leads, To Accounts, Returned by Accounts,
My Field Visits, Visit History. The Sales Department Head assigns a lead for a visit from **Leads > Lead List > Field visit**.

Run `supabase/run_this_sales_field_visits.sql` (the migration `20261203000100_sales_field_visits.sql`) once in the Supabase SQL editor.
It is additive and safe to run again. It needs the lead-filter migrations (`run_this_lead_scope_filters.sql`,
`run_this_lead_scope_sales_members.sql`) to have been run.

## Data
| Table | What |
|---|---|
| `lead_visit_assignments` | A Department Head hands a lead to an employee for a visit (priority, instructions). At most one ACTIVE assignment per lead. The lead **keeps its owner**. |
| `lead_visits` | One row per visit (never overwritten): date, planned time, address, purpose, status SCHEDULED / IN_PROGRESS / COMPLETED / FOLLOW_UP_REQUIRED / CANCELLED, outcome, notes, requirements, next steps, follow-up date, cancel reason, check-in position. Unique `(employee_id, client_request_id)` so a retry or double click returns the same visit. |

The live trip tracker (`public.field_visits`) is untouched. Both tables have row level security that allows `select` only (the employee sees their
own visits, the owner sees visits of their lead, the head sees their department's); every write goes through a `security definer` function.
`gps_captured` is true only when valid coordinates were sent at start; the UI says "captured by the device", never "verified".

## Functions (all `security definer`, `search_path = ''`, executable by `authenticated` only)
Employee (active Telecaller, Business Associate or Sales member with no Sales role, via `private.require_field_visit_user()`): `field_visit_overview`,
`field_visit_leads_list`, `field_visit_assigned_list`, `field_visit_list`, `field_visit_schedule`, `field_visit_update`, `field_visit_start`,
`field_visit_complete`, `field_visit_cancel`. Sales Department Head (`private.require_sales_head()`): `sales_visit_assignees`, `sales_visit_assign`,
`sales_visit_assignment_cancel`.

Rules enforced in the database: a visit can be planned only for the person's own lead or a lead actively assigned to them (still a LEAD of their
department); past dates are refused; a started visit cannot be rescheduled; starting twice changes nothing; finishing a visit sets the lead's next
follow-up only when the person owns the lead; no function changes `owner_id`, `payment_workflow` or any Accounts row.

## API (`/api/v1/field-visits`)
`GET /overview`, `GET /leads?filter&search&sort&page&pageSize`, `GET /assigned`, `GET /` (`scope=OPEN|HISTORY|ALL`, `status`, `leadId`),
`POST /`, `PATCH /:id`, `POST /:id/start|complete|cancel`; head only: `GET /assignees`, `POST /assignments`, `DELETE /assignments/:leadId`.
Validation is in `shared/validation.ts` (strict schemas: unknown fields are refused, so a visit cannot be made "for" somebody else).

## Filters
`ALL`, `MINE`, `DEPARTMENT`, `TO_ACCOUNTS`, `RETURNED` reuse `private.lead_scope_ids`. `DH_ASSIGNED`: an ACTIVE assignment to me. `VISIT_PENDING`: an ACTIVE
assignment with no non-cancelled visit since it was made. `VISIT_SCHEDULED`: my SCHEDULED / IN_PROGRESS visit. `VISIT_COMPLETED`: a COMPLETED visit of mine.
`FOLLOW_UP`: my latest finished visit of the lead is FOLLOW_UP_REQUIRED. Every number beside a filter counts the same function the table reads.

## Tests
`supabase/tests/field_visit_test.sql` (database), the "Field Visit" block of `supabase/tests/api_integration.test.ts` (API), and the browser test
`supabase/tests/e2e/field-visit.e2e.mjs` (`run-field-visit.sh`): the three dashboards, the Department Head assignment, GPS granted / refused, history,
permissions, the Accounts workflow, tablet and phone widths.

## Not included / notes
* A visit's optional `taskId` (link to a work task) is accepted by the API but the screens do not offer it yet.
* Assigning a lead sends the employee a notification (`FIELD_VISIT_ASSIGNED`); visits themselves are not shown on the calendar pages and send no reminders yet.
* GPS at start is the browser's position when the visit starts; live location during a visit is described in "Live location" below (the older trip tracker is separate).

## Live location during a visit (migration 20261228000100)

**What the employee does.** On *My Field Visits*, a visit that is in progress shows **Live location** with a notice of who will see it.
**Share live location** asks the browser for permission and starts `navigator.geolocation.watchPosition` in that tab. The panel shows the
current position, accuracy, last update, what is still waiting to be sent, and the history. **Stop sharing** ends it; recording the outcome
or cancelling the visit ends it too. It never starts by itself, and after a reload it offers **Resume sharing** instead of resuming silently.

**What is stored.** `lead_visit_locations` (visit, employee, latitude, longitude, accuracy, time taken on the phone, time received) and
`lead_visit_tracking_events` (started, stopped, visit ended, permission withdrawn, no GPS fix, timeout). `lead_visits` gets
`tracking_status` OFF / ACTIVE / STOPPED with start and stop times, the reason and the last reported problem; it holds no coordinates.
Writes go through `field_visit_tracking_start|points|issue|stop` only. These accept positions only for the caller's own visit while it is
IN_PROGRESS and tracking is ACTIVE. A position dated before tracking started or in the future is dropped, as is one within 15 s of the
previous one. There are at most 50 positions per call and 2,000 per visit. The browser sends a position when the person moved about 25 m,
or once a minute while standing still. Positions taken offline (up to 200) are sent with their own times when the connection returns.

**Who sees it** (`private.can_track_visitor`, used by the table's row rule, so Supabase Realtime delivers a position only to them):
the employee; their direct Team Lead (`direct_lead_of`); a Sales Department Head covering their department (`head_covers`); a Sales
Operations Head whose scope covers that department's Sales side (`scope_covers(.., 'SALES')`); and HR staff (`is_hr_staff`, which excludes
recruiters). A Support Operations Head, another Team Lead, colleagues and other departments see nothing (tested). Each trail view and
board view is audited at most once per viewer per 30 minutes (`FIELD_VISIT_TRACKING_VIEWED` / `_BOARD_VIEWED`).

**Where.** *Active Field Visits*: the Sales Department Head and the Sales Operations Head dashboards (Field Visits group), the Team Lead's
Field Visits page (above the older trip tracker), and HR > Field Visit Tracking. Each row shows the employee, department, Team Lead,
lead, visit status, start time, last update, accuracy and the status:
- **Live**: a position in the last 2 minutes.
- **Stale**: older than that, or a GPS problem was reported since.
- **Offline**: nothing for 10 minutes.
- **Ended**, **Waiting** or **Not shared**.

The status ages on screen without requests. A selected visit shows its position on an OpenStreetMap map (with a Google Maps link) and its history.

**Browser limits (by design, stated in the UI).** A web page can report a position only while it is open. When the browser is closed, the
phone is locked or the tab is suspended, positions stop and managers see the last known one as Stale and then Offline. Nothing is
simulated and there is no background tracking.

**Retention.** Positions and events older than `field_visit_tracking_settings.retention_days` (90) are removed by
`private.purge_field_visit_tracking()`. This is scheduled daily (21:17 UTC) when `pg_cron` is installed. Otherwise the Super Admin runs
`select public.purge_field_visit_tracking();`, which is audited.

API: `POST /field-visits/:id/tracking/start|points|issue|stop`, `GET /field-visits/:id/tracking` (trail), `GET /field-visits/tracking/board?date=`.

## Field Visit leads -> Sales Department Head -> Telecaller (migration 20261228000100)

1. On **Field Visit > Add Lead** (the dashboard's own Add Lead form), the employee can **take or upload a photo** of a shop board or
   visiting card. The existing on-device reader (`ShopPhotoScan`, `readShopPhoto`, `scanFill.planLeadFill`) fills the business name,
   mobile number, address, e-mail, business category (only when the shop type means the same as a category) and notes (GSTIN, website,
   PIN). The customer's own name is never read from a photo, and WhatsApp is filled only when the employee ticks "Same as mobile number".
   Every field stays editable and is marked "From photo" until edited. A second photo fills only empty fields and fields still holding a
   photo value; where it reads something different from what the employee typed, it asks (*Use the photo's value* / *Keep mine*).
   Before saving, **Review & edit details** shows everything once more; the confirmed values are what is saved. The photo is not
   uploaded or stored. The source stays *Field visit*. The form sends a `clientRequestId`, so a retry returns the same lead
   (`create_lead_once`, `lead_create_requests`).
2. Any lead with the source *Field visit* added by a Field Visit employee (Telecaller, Business Associate or Sales Team Member, any form)
   gets a `field_visit_lead_routes` row (PENDING). The Sales Department Heads covering it are notified (`FIELD_VISIT_LEAD_PENDING`). It is
   one lead in `customers`; `created_by` and the source are kept.
3. While PENDING, the person who added it, or a Team Lead or member, cannot change its owner, stage or Accounts workflow (`CONFLICT`). A
   Department Head, the Super Admin or a system job can; the route then records that owner.
4. The head opens **Field Visit Leads - Pending Assignment** (Sales Department Head dashboard), reviews the lead and assigns an active
   Telecaller of the department (`field_visit_lead_assign`). The Telecaller becomes the owner, so it is in their Leads, and is notified
   (`LEAD_ASSIGNED`). The employee is told who has it (`FIELD_VISIT_LEAD_ASSIGNED`). The assignment is in
   `field_visit_lead_assignment_events`, the lead's activity and the audit log. A retry changes nothing; a reassignment adds a history row.
   Operations Heads oversee but do not assign. Lead conversion, Accounts handover, payments and onboarding are unchanged. The Excel
   lead-sheet assignment is not used for these leads.

API: `GET /field-visits/lead-queue?status=PENDING|ASSIGNED|ALL`, `GET /field-visits/lead-queue/:leadId/telecallers`,
`POST /field-visits/lead-queue/:leadId/assign {telecallerId, note?}`; `POST /pipeline/leads` accepts an optional `clientRequestId`.

## Add Lead dropdowns

Business category and Lead source use `ListSelect` (`src/components/common/ListSelect.tsx`), an accessible select-only combobox with a
divider between options, the same look in every browser, and a full-width list on phones. Keyboard: arrows, Home/End, type-ahead,
Enter/Space, Escape. Values and validation are unchanged.

Tests: `supabase/tests/field_visit_tracking_test.sql` (database: tracking, every viewer allowed and refused, the queue, retries),
`supabase/tests/field_visit_tracking.test.ts` (unit: throttling, Live/Stale/Offline, photo fill rules),
`supabase/tests/ui_field_visit.test.mjs` (browser: real OCR, corrections, review, one save, geolocation granted/moving/offline/stopped/
refused, the board, the dropdowns), and the matching API block in `api_integration.test.ts`.
