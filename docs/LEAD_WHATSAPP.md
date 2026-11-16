# Lead welcome WhatsApp

A lead gets **one** WhatsApp message about the services of Amuwa Corporation. It is sent the first time the lead is given to a sales person.

## When it is sent
- **The trigger.** A lead (a customer in the Leads stage) gets its first sales person. This happens in any of these ways:
  - a Department Head or Team Lead assigns or reassigns the lead;
  - a sheet is uploaded to a telecaller or a sales person;
  - an enquiry is assigned;
  - a field visit lead is assigned;
  - leads are imported;
  - a sales person adds a lead they own themselves.
- **Who counts as a sales person:**
  - an active Team Member or Team Lead of a **Sales** team, telecallers and field sellers included;
  - an active **Business Associate**.
  - A lead held by a Department Head or the Super Admin waits. It is sent when the lead reaches a sales person.
  - A lead given to someone outside Sales (for example Support) is not messaged.
- **Once per lead, ever.** Reassigning a lead, uploading the same sheet again or saving it again never sends a second message.
- **No backfill.** Leads assigned before the feature was switched on are not messaged.
- **No valid number.** A lead with no valid Indian WhatsApp or mobile number is recorded as *Skipped*. It gets "Send again" once a number is added.
- **When it goes out.** Straight after the assignment. The scheduled automation run (`/internal/automations/dispatch`) retries and picks up anything left waiting.

## Settings (Super Admin, Sales Department Head)
Open *Lead Welcome WhatsApp* in either menu: the Super Admin's Automations group, or the Sales Department Head dashboard.

- **On / off.** Nothing is queued while it is off.
- **Template.** Its name and language, exactly as registered with Wabastore / Meta.
- **Variables.** Which CRM value fills each `{{1}}`, `{{2}}` …, in order. The choices are:
  - the lead's name;
  - the lead's business name;
  - the sales person's name;
  - the sales person's phone.
- **"The provider has approved this template."** Nothing is sent until this is ticked. Changing the name, language or variables of an approved template withdraws the approval; tick it again once the new one is approved.
- **What the page shows:** the status (Off, Test run or Live), how many messages were sent, are waiting, failed or were skipped, and the latest 20 messages with the reason for any failure.

On a lead's page, *Welcome WhatsApp* shows the message's state. It offers **Send again** when the message failed, was skipped or was only a test run.

## How it works
- **Migration:** `supabase/migrations/20270103000100_lead_assignment_whatsapp.sql`. It only adds things and is safe to run twice.
  - It adds `lead_whatsapp_settings`, `lead_whatsapp_dispatches` (one per lead, unique key `LEADWA|<lead>`) and `lead_whatsapp_events`. These tables are server-only.
  - An `AFTER INSERT OR UPDATE OF owner_id` trigger on `customers` queues the message.
  - The trigger never blocks saving a lead. A problem becomes a warning, never an error.
- **States:** PENDING → PROCESSING → ACCEPTED → DELIVERED → READ.
  - On failure: RETRY 10 minutes later, then 30 minutes later; FAILED after 3 attempts.
  - Also DRY_RUN (test mode, nothing sent) and SKIPPED (with the reason).
  - ACCEPTED means Wabastore took the message. DELIVERED and READ come only from Wabastore's delivery report.
- **Safety:**
  - A live attempt whose result was never recorded (for example, the server stopped) is marked FAILED and not repeated. This stops a lead getting the message twice.
  - The number is masked everywhere except the internal key.
- **Server:** `server/leads/whatsapp.ts` sends what the database hands over, through Wabastore.
- **Delivery reports:** the existing `POST /api/v1/internal/whatsapp/status` (`WABASTORE_STATUS_SECRET`). A report goes to the paid-invoice message or the lead message, whichever its reference belongs to.
- **Audit:** `LEAD_WHATSAPP_QUEUED`, `_ACCEPTED`, `_FAILED`, `_SKIPPED` and `LEAD_WHATSAPP_SETTINGS_CHANGED`. The lead's timeline shows when it was sent or failed.

## Routes
| Route | Who |
| --- | --- |
| `GET /sales/lead-whatsapp/settings` | Super Admin, Sales Department Head |
| `POST /sales/lead-whatsapp/settings` `{ enabled, templateName, templateLanguage, templateApproved, variables[] }` | Super Admin, Sales Department Head |
| `GET /leads/:id/whatsapp` | anyone who can open the lead |
| `POST /leads/:id/whatsapp/retry` | anyone who can open the lead |

## Environment
| Variable | Meaning |
| --- | --- |
| `AUTOMATION_MODE_LEAD_WHATSAPP` | `off`, `dry_run` (default: decided and logged, nothing sent) or `live`. When it is not set, `AUTOMATION_MODE` decides. |
| `WABASTORE_WEBHOOK_URL`, `WABASTORE_API_KEY` | Wabastore's send address and key, shared with the paid-invoice and reminder messages. Live without them behaves like off and says why. |
| `WABASTORE_STATUS_SECRET` | 16+ characters; Wabastore sends delivery reports with it. |
| `AUTOMATION_TEST_RECIPIENTS` | Staging safety net: only these numbers are ever sent to. |

## The request to Wabastore
It is provisional until Wabastore's send API is settled. Only `leadWhatsAppPayload` changes.

```json
{ "reference": "lead-whatsapp:<dispatch id>", "to": "+91XXXXXXXXXX", "template": "<name>", "language": "en",
  "parameters": ["<{{1}}>", "<{{2}}>"],
  "variables": { "leadName": "…", "leadCompany": "…", "salesPersonName": "…", "salesPersonPhone": "+91 98XXXXXXXX" } }
```

A missing value is never sent empty, because WhatsApp refuses a template with an empty parameter. For example, a lead without a name is greeted as "there".

## Going live
1. Run the migration in the Supabase SQL editor.
2. Make sure `WABASTORE_WEBHOOK_URL` and `WABASTORE_API_KEY` are set on the server.
3. In *Lead Welcome WhatsApp*:
   - switch it on;
   - enter the template name, its language and its variables in order;
   - tick "approved" once Meta has approved the template.
4. Optional: try it on a staging number first with `AUTOMATION_TEST_RECIPIENTS`.
5. Set `AUTOMATION_MODE_LEAD_WHATSAPP=live`, or `AUTOMATION_MODE=live`, which also covers the other automations.

## Tests
- `supabase/tests/lead_whatsapp_test.sql` (database);
- `supabase/tests/lead_whatsapp.test.ts` (server);
- `supabase/tests/ui_lead_whatsapp.test.mjs` (browser);
- the "lead WhatsApp" block of `api_integration.test.ts`.
