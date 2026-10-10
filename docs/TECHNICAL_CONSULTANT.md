# Technical Consultant dashboard

Who: staff created as **Technical Consultant** (Super Admin → department → Support →
*Team Members & Access* → Role: *Technical Consultant*; department heads and the support team
lead can create them too). They sign in on the normal sign-in page and land on this dashboard.
A plain **Team Member** of the Support team does *not* get this dashboard or its data; they get
the normal team member dashboard. An existing support member can be switched with
*Make Technical Consultant* / *Make team member* in the member list
(`profiles.is_technical_consultant`, migration `20261008000400_technical_consultant_role.sql`).
Support team leads, department heads and the super admin may review too (database rules).

## What it shows
- **Onboarding Customers** - customers of the consultant's department that the salesperson
  has sent with **Send to Technical Consultant** (on the customer's onboarding page, unlocked
  once every checklist item is saved). Nothing is visible before sending. Tabs *All / Review pending /
  Needs attention / Authorized* and the number of authorized items (`x/y docs authorized`).
  Status: *Awaiting documents* → nothing to review yet; *Review pending* → items saved by
  sales wait for review; *Needs attention* → an item was marked not authorized;
  *Authorized* → every item authorized.
- **Customer page** - customer, business, services and amount; every document and detail
  the salesperson collected (from the service checklist) with **View document**,
  **Authorize**, **Not authorized** (requires a reason) and **Authorize all**; and the
  **Automations** panel.
- **Send back for re-verification** - after marking wrong, inappropriate or fake items as
  *Not authorized*, this returns the customer to the salesperson (optional message). The
  salesperson sees it under **Returned by consultant** with every item and reason, fixes them
  and clicks **Send again to Technical Consultant**. Meanwhile it **stays in the consultant's
  list** as **Waiting for sales team** (own tab and count; migration
  `20261008000500_sent_back_visible_to_consultant.sql`): read-only, with a disabled *Waiting for
  sales team* button in place of the review actions. Fixed items show as *Pending review* as
  soon as sales fixes them; authorizing and automations unlock once sales sends it again.

## Automations (Email / WhatsApp / AI Calling)
Each automation is a Google Sheet. **Trigger → Confirm** makes the API append one row
(customer, phone, WhatsApp, e-mail, business, services, amount) to that sheet; the sheet's
own automation then sends the email / WhatsApp message / AI call. Every run is stored in
`onboarding_automation_runs` and shown as *Sent* or *Failed* - a run is only shown as sent
when the sheet confirms it. The same automation can't be triggered twice within a minute.

### Connect a sheet
1. Create the Google Sheet. **Extensions → Apps Script**, paste:

   ```js
   const SECRET = 'choose-a-long-random-secret';
   function doPost(e) {
     const data = JSON.parse(e.postData.contents);
     if (data.secret !== SECRET) return out({ ok: false, error: 'bad secret' });
     const c = data.customer;
     SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow([
       new Date(), data.automation, c.name, c.company, c.phone, c.whatsapp, c.email,
       (data.services || []).join(', '), c.dealAmount, data.triggeredBy, data.runId
     ]);
     return out({ ok: true });
   }
   function out(o) {
     return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
   }
   ```
2. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*.
   Copy the web app URL (`https://script.google.com/macros/s/…/exec`).
3. In Vercel → Settings → Environment Variables add (server only, never `VITE_`):
   - `AUTOMATION_EMAIL_WEBHOOK_URL`, `AUTOMATION_WHATSAPP_WEBHOOK_URL`,
     `AUTOMATION_AI_CALLING_WEBHOOK_URL` - one URL per sheet (leave unset to show
     "Google Sheet not connected");
   - `AUTOMATION_WEBHOOK_SECRET` - the same secret as in the script.
4. Redeploy. The automation's button becomes active.

## Database
Migration `20261008000200_return_onboarding_to_sales.sql`: `return_onboarding_to_sales()`,
`returned_at` / `return_note`, the RETURNED onboarding state and counts.
Migration `20261008000100_send_to_technical_consultant.sql`: consultants see and review a
customer only after sales sends it (`customer_onboarding.forwarded_to_support_at`).
Migration `20261008000000_technical_consultant_dashboard.sql`: the
*awaiting documents* state, `onboarding_review_counts()`, `verify_all_onboarding_entries()`,
and `onboarding_automation_runs` with `begin_/finish_onboarding_automation()`.

## Client login and hand-over (migration `20261008000900_client_handover.sql`)
1. **Client panel login.** After creating the client's panel in the internal platform, the
   consultant creates the client's login on the customer page (*Client panel login*): the
   e-mail and password the client will use in the mobile app (same as in the internal platform).
   The password goes straight to Supabase Auth (hashed); the CRM never stores or returns it, so
   it is shown once at creation (with *Copy*). A client login has **no CRM profile** and cannot
   use the CRM API. `customer_client_accounts` only links the auth user to the customer.
2. **Send to Department Head.** Enabled once every document/detail (and the WABA ID) is
   authorized and the client login exists. The consultant's review closes; the customer shows
   *Handed over* in their list.
3. **Department Head** → *Client Hand-overs*: *To assign* → **Pass to Team Lead** (an active Team
   Lead of the department; can be changed until it is assigned).
4. **Team Lead** → *Client Hand-overs*: **Assign to member** (an active member of their own team).
5. **Team Member** → *My Clients*: the verified details, files (view only) and the client login e-mail.
Everyone in the chain is notified (bell); each step is audited. Recipients get **read** access
only (checklist, files, owner); only the people named above can move the customer on.



## Customers, Add-ons Services and consultation notes

Migration: `supabase/migrations/20261014000100_tc_notes_addons.sql` (safe to re-run).

**Customers panel.** The old "Contract" column is labelled **Contacted** (the stored value
`customer_onboarding.contract_signed` is unchanged). Additional services is a Yes / No question
(`customer_onboarding.addons_required`, null = not answered). Yes shows the service picker (built from
the service catalogue). Answering No keeps any saved selection (it is only ignored) and asks first.
A customer opens read-only; details change only after an explicit Edit, with Save / Cancel. A save made
from a stale form is refused (`consultant_update_customer(..., p_expected)`).

**Send to Add-ons.** With Yes and at least one add-on the button reads "Send to Add-ons"
(`consultant_send_to_addons`, once per customer). "Send for onboarding" is refused by the database
while add-ons are selected but not sent. The customer then leaves Customers and is listed under
**Add-ons Services** (same customer record, no copy). From there the TC changes the services, collects
and verifies the add-on documents and can still send the customer for onboarding.

**Add-on documents.** The checklist is built from the same `onboarding_items` /
`onboarding_item_services` as normal onboarding, for the add-on service codes only
(`customer_addon_checklist`). Entries and uploads use the same tables and the same upload, size and
type rules; a document is collected once. The TC may save / upload / replace only items of the add-on
services of a customer sent to Add-ons (`private.can_collect_addon_item`); normal onboarding items stay
with Sales. Progress (`addon_items_*`) is kept by triggers. Nothing is marked verified automatically.

**Consultation notes.** `consultant_notes` is append-only history (add, edit by the author only; the
earlier text of an edit is kept in the audit log). The TC of the department writes; the TC, the
Department Head of the department and the Super Admin (CEO) read. Sales and the other roles cannot.
The Department Head sees the notes on the client detail page; the CEO has read access through the API
(`GET /pipeline/customers/:id/consultant/notes`) and the same data functions; no Super Admin screen
shows customer notes yet.

**Live updates.** Pipeline screens reload when rows change (Realtime on customers, documents,
onboarding and checklist entries), when the tab is focused again, after any change made in the tab,
and every 30 seconds while the tab is visible (this also covers a dropped Realtime connection).
