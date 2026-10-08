# Technical Consultant dashboard

Who: members of a department's **Support** team (role Team Member). They sign in on the
normal sign-in page and land on this dashboard. Department heads and the super admin may
review too (database rules), but their dashboards don't have this screen yet.

## What it shows
- **Onboarding Customers** — every customer of the consultant's department that is in
  onboarding (after sales confirms the payment), with tabs *All / Review pending /
  Needs attention / Authorized* and the number of authorized items (`x/y docs authorized`).
  Status: *Awaiting documents* → nothing to review yet; *Review pending* → items saved by
  sales wait for review; *Needs attention* → an item was marked not authorized;
  *Authorized* → every item authorized.
- **Customer page** — customer, business, services and amount; every document and detail
  the salesperson collected (from the service checklist) with **View document**,
  **Authorize**, **Not authorized** (requires a reason; sales is notified and the item comes
  back after it is fixed) and **Authorize all**; and the **Automations** panel.

## Automations (Email / WhatsApp / AI Calling)
Each automation is a Google Sheet. **Trigger → Confirm** makes the API append one row
(customer, phone, WhatsApp, e-mail, business, services, amount) to that sheet; the sheet's
own automation then sends the email / WhatsApp message / AI call. Every run is stored in
`onboarding_automation_runs` and shown as *Sent* or *Failed* — a run is only shown as sent
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
     `AUTOMATION_AI_CALLING_WEBHOOK_URL` — one URL per sheet (leave unset to show
     "Google Sheet not connected");
   - `AUTOMATION_WEBHOOK_SECRET` — the same secret as in the script.
4. Redeploy. The automation's button becomes active.

## Database
Migration `20261008000000_technical_consultant_dashboard.sql`: department-wide visibility of
onboarding customers for consultants (leads and potential customers stay hidden), the
*awaiting documents* state, `onboarding_review_counts()`, `verify_all_onboarding_entries()`,
and `onboarding_automation_runs` with `begin_/finish_onboarding_automation()`.
