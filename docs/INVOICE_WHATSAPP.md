# Paid invoice by WhatsApp (Accounts)

## What existed before (audit)
| Piece | State |
|---|---|
| Invoice generation, PAID stamp, PDF drawn and stored (R2 / Supabase), recorded in `generated_invoices` | Existed. Reused unchanged. |
| Invoice **e-mail** with the PDF attached (SMTP / Resend / Brevo), retry, status, history | Existed (`server/invoices/mailer.ts`, `GeneratedInvoiceService.runStage`). |
| Invoice **WhatsApp** | **Did not exist.** The only WhatsApp code was the onboarding webhook (a fixed payload for the Automation Builder router: `postWhatsApp`) and the expiry reminders (`WabastoreSender`). There was no invoice message, no template, no status record. |
| Internal workflow builder | **None.** The only router is the external Automation Builder (see `ONBOARDING_AUTOMATIONS.md`). Nothing was invented: the invoice workflow is configured in the Accounts invoice screen. |
| Message status / retry / log | Existed for e-mail and onboarding jobs; added for invoice WhatsApp (below). |

## What was added
**Flow** (the lifecycle is unchanged): invoice issued -> payment confirmed -> **paid** invoice PDF stored -> (automatic, if switched on) or **Send invoice via WhatsApp** (Accounts) -> validate -> dispatch through Wabastore -> record the state.
Only the **paid** invoice is sent (customers never receive an unpaid invoice). Nothing is sent for an unpaid invoice, a paid invoice whose PDF is not stored, or a customer without a valid WhatsApp / mobile number.

* **Migration** `20261129000100_invoice_whatsapp.sql` (re-runnable; `supabase/run_this_invoice_whatsapp.sql` is the paste-and-run copy): `invoice_whatsapp_settings`, `invoice_whatsapp_dispatches`, `invoice_whatsapp_events` and the functions `accounts_invoice_whatsapp_request / _history`, `invoice_whatsapp_settings_get`, `set_invoice_whatsapp_settings`, and (server only) `invoice_whatsapp_claim / _finish / _status_update`. No invoice table is touched.
* **Server** `server/invoices/whatsapp.ts` (worker, payload, link), `GeneratedInvoiceService.sendWhatsApp / whatsAppHistory / whatsAppSettings / setWhatsAppSettings`, automatic step after the paid invoice, routes below, the scheduler retry, and the provider's delivery-report endpoint.
* **Screen**: the paid-invoice panel (Accounts) shows **Paid invoice on WhatsApp**: status, **Send invoice via WhatsApp**, **Send again** (failed / test run / skipped / accepted-but-not-delivered), the history, and (Super Admin / Accounts Department Head) **Settings**: on/off, send automatically, template name + language, "the provider has approved this template".

| Route | Who |
|---|---|
| `POST /accounts/generated-invoices/:id/whatsapp` `{ resend? }` | Accounts staff |
| `GET /accounts/generated-invoices/:id/whatsapp` (history) | Accounts staff |
| `GET /accounts/invoice-whatsapp/settings` | Accounts staff |
| `POST /accounts/invoice-whatsapp/settings` | Super Admin, Accounts Department Head |
| `POST /internal/whatsapp/status` (provider's delivery report) | the provider, `Authorization: Bearer <WABASTORE_STATUS_SECRET>` |

## Safety rules (each one has a test)
* **Recipient** = the customer's WhatsApp number, else the mobile number, on the CRM record (`private.mobile10`, the same Indian-number rule as everywhere), sent as +91 and ten digits. Never typed in, never hard-coded.
* **Figures** come from the persisted invoice (`generated_invoices.total_amount`, number, date, customer name); nothing is recalculated in the message layer.
* **Duplicates**: one dispatch per invoice + stage + number (`INVWA|invoice|PAID|number`, unique). A second click, six simultaneous clicks, a retried request and an automation event delivered twice all return the same dispatch. The claim uses `FOR UPDATE SKIP LOCKED` and a lease. A live attempt whose result was never recorded (server stopped) is marked failed and **not** repeated, so the customer is not sent it twice.
* **Statuses**: `PENDING -> PROCESSING -> ACCEPTED -> DELIVERED -> READ`, or `RETRY` (10, then 30 minutes; 3 attempts) `-> FAILED`; also `DRY_RUN` and `SKIPPED` (with the reason). **ACCEPTED only means the provider took the request.** DELIVERED / READ are set only by the provider's report, and a report only moves a message forward (a late "delivered" never downgrades "read").
* **A failed message never touches the invoice** and never creates one. "Send again" restarts the same dispatch; a delivered one is refused; one accepted less than 30 minutes ago is refused.
* **Confidentiality**: the PDF is not attached from the CRM. The provider receives a **short-lived signed link** (default 15 minutes, `INVOICE_WHATSAPP_LINK_TTL_SECONDS` 120 to 3600) made at the moment of sending, handed over and forgotten: it is not stored, logged, returned to Accounts or kept in the history. The permanent storage address is never exposed. The provider's reply is not stored either (it can echo the link), only the HTTP status. Numbers are masked everywhere except the internal duplicate key.
* **Approval**: a live send needs the template marked approved by the Super Admin / Accounts Department Head. Changing the template name withdraws the approval. No template is invented: **none is configured until you give its registered name**.
* **Permissions**: only Accounts staff request, read the history or the settings; only the Super Admin / Accounts Department Head change settings; the worker functions are for the server's service role only (Accounts, clients and anonymous callers are refused).
* **Audit**: `INVOICE_WHATSAPP_REQUESTED / _ACCEPTED / _FAILED`, `INVOICE_WHATSAPP_SETTINGS_CHANGED`; the customer's timeline shows accepted / failed.

## Environment
| Variable | Meaning |
|---|---|
| `AUTOMATION_MODE_INVOICE_WHATSAPP` | `off`, `dry_run` (default: decided and logged, nothing sent, no link made) or `live`. **When it is not set, `AUTOMATION_MODE` decides** (the same switch the onboarding messages use), so `AUTOMATION_MODE=live` is enough. |
| `WHATSAPP_WEBHOOK_URL` | The WhatsApp Automation Builder webhook the onboarding messages already use. The paid invoice is posted to it as an event (see below). Used when Wabastore is not set up. |
| `WABASTORE_WEBHOOK_URL`, `WABASTORE_API_KEY` | Wabastore's send endpoint (https), and an OPTIONAL key (sent as `Authorization: Bearer` only when set; shared with the expiry reminders). When set it is used instead of the builder. Live with neither behaves like off and says why. |
| `WABASTORE_STATUS_SECRET` | 16+ characters; the provider sends delivery reports to `/api/v1/internal/whatsapp/status` with it. |
| `INVOICE_WHATSAPP_LINK_TTL_SECONDS` | Link lifetime (default 900). |
| `AUTOMATION_TEST_RECIPIENTS` | Staging safety net: only these numbers are ever sent to. |

**The request to Wabastore is provisional** (`invoiceWhatsAppPayload`): `reference`, `to`, `template`, `language`, `variables {customerName, invoiceNumber, amount, invoiceDate}`, `document {url, filename, mimeType}`. It follows Wabastore's send API once that is settled (one function). If Wabastore wants the file uploaded instead of fetched from a link, the sender changes; nothing else does.

## Through the WhatsApp Automation Builder (the onboarding webhook)

With `WHATSAPP_WEBHOOK_URL` set and no `WABASTORE_WEBHOOK_URL`, the paid invoice goes to the same webhook as the onboarding messages. The template lives in the builder, so the "template approved" rule of the settings does not apply to it. The event has the same keys as the onboarding events plus the invoice:

```json
{"name":"<customer>","email":"","phone":"91XXXXXXXXXX","department":"","website":"","whatsapp_number":"91XXXXXXXXXX",
 "number":"XXXXXXXXXX","pdf_invoice_link":"<short-lived link>",
 "status":"Paid Invoice","stage_code":"INVOICE_PAID","source":"<WHATSAPP_SOURCE>","automation":"Paid Invoice","event_key":"invoice|<dispatch id>|<attempt>",
 "invoice_number":"INV-2026-00052","invoice_amount":"Rs.10,000.00","invoice_date":"27 Oct 2026","invoice_pdf_url":"<short-lived link>","invoice_filename":"INV-2026-00052-paid-invoice.pdf"}
```

**In the builder (this cannot be done from the CRM):** add a route whose condition is `stage_code` **equals** `INVOICE_PAID`, and let it send the invoice template with the PDF from `invoice_pdf_url` as the document (and `invoice_number`, `invoice_amount`, `invoice_date` as the text). "Accepted" in the CRM means the webhook took the event; whether the route sent it is shown in the builder. `event_key` is new for every attempt because the builder ignores a repeated one.

### If "nothing is sent", check in this order
1. **The server mode.** The invoice screen and the settings show a yellow note when the server is in test mode ("messages are prepared and logged but NOT sent"), switched off, or has no WhatsApp service. Fix: `AUTOMATION_MODE=live` (or `AUTOMATION_MODE_INVOICE_WHATSAPP=live`) and `WHATSAPP_WEBHOOK_URL` (or the Wabastore variables), then redeploy.
2. **The switch in the invoice screen.** Settings -> "Allow sending paid invoices by WhatsApp" (Super Admin or Accounts Department Head). **It starts switched on, with automatic sending** (migration `20261207000100`: it also switches on a setting nobody ever changed, and never overrides a choice a person made). Switching it off is the Super Admin's / Department Head's own decision; while it is off a paid invoice reports the step "Invoice WhatsApp is switched off" instead of staying silent. Whether a message really leaves the server is decided by check 1, not by this switch.
3. **Automatic sending.** Settings -> "Send automatically as soon as the paid invoice is ready" (on by default). Without it, use **Send invoice via WhatsApp** on the invoice.
4. **The customer's number.** A valid Indian WhatsApp or mobile number must be on the customer record.
5. **The builder route** (above).

## Going live (nothing is sent today)
1. Run `supabase/run_this_invoice_whatsapp.sql` in the Supabase SQL editor.
2. Register and get the invoice template approved with Wabastore / WhatsApp. Typical body: "Hello {{customerName}}, we have received your payment. Your paid invoice {{invoiceNumber}} for {{amount}} dated {{invoiceDate}} is attached." with a document header. **Give me the registered template name and variables** (they must match the four variables above, in that order, or the mapping is adjusted).
3. Set the environment variables (test numbers first: `AUTOMATION_TEST_RECIPIENTS`), switch `AUTOMATION_MODE_INVOICE_WHATSAPP=live`.
4. In the invoice screen: Settings -> allow, template name, language, tick "approved" (Wabastore only; the builder needs none of the three). Send one invoice to your own number. Then, if you want, tick "send automatically".

Retries run from the scheduler (`/internal/automations/dispatch`, which Vercel calls twice a day) or when Accounts presses **Send again**.

## Not covered
* Delivery reports need Wabastore to call the status endpoint; without them a message stays "Accepted".
* Unpaid invoices (older ones, made before the paid-only rule) are not sent by WhatsApp.
