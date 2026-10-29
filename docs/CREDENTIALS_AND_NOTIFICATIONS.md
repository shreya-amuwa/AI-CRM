# Handover date, client credentials, Accounts e-mails, part-payment helper, invoice layout and e-mail, Crocodial

Migrations: `20261208000100_handover_date_and_service_name.sql`, `20261208000200_accounts_email_all_members.sql`,
`20261208000300_client_credentials.sql` (all safe to run again; the three are bundled in
`supabase/run_these_3_migrations_handover_accounts_email_credentials.sql`). Nothing in them sends a message, changes a payment, an invoice or a
total, or deletes anything.

## 1. Meta Verifier handover date is automatic

**Root cause.** The onboarding header asked Sales to pick a "Target handover" date by hand, although the handover itself already happens on a
button click. `customer_onboarding.forwarded_to_support_at` (set with the database's `now()`, never the browser's clock) is that moment, but it
is cleared when the verifier sends the customer back, so the first handover was not kept and a handover left no line in the history.

**Now.** A trigger on the same update that sets `forwarded_to_support_at` writes `first_handed_over_at` once (never overwritten, not by a later
handover, not by editing or opening the record; the table API cannot write it) and one `HANDED_OVER` history line per handover
("Handed over to the Meta Verifier on 29 Oct 2026, 07:26 AM"). A retried request cannot make a second event: the send function already refuses
"Already sent", and only the `null -> value` change counts. A reassignment (back to Sales and on again) keeps the first date and adds its own
history line. The manual date step is gone from the Sales onboarding screen, the Potential screen and the consultant views; the screens show the
automatic time. `target_handover_date` stays in the table for records that have one (other legitimate date fields - payment due date, expected
completion - are untouched).

## 2. Credentials

Two different credentials, kept apart in tables, functions, e-mails and screens:

| | Client Dashboard login | WhatsApp panel login (Meta Verifier) |
|---|---|---|
| What | A Supabase Auth account for the Amuwa client dashboard | The login of the external panel that runs the customer's WhatsApp service |
| Made by | Accounts (`Client Logins`) | The Meta Verifier sets it on the panel; the CRM only delivers it |
| E-mail used | Always the one on the customer record (never typed, never sent by the browser) | The customer's e-mail on the record |
| Per | Customer | Customer + service (`service_panel_credentials`) |
| Account / user ID | The login e-mail | `customer_services.panel_account` (unchanged) |

### Client Dashboard (Accounts -> Client Logins)
* The list shows customer, e-mail on the record, status (To create / Being created / Created / Failed), who and when, and the state of the
  e-mail and WhatsApp message. Only the Accounts department can create or resend (the database checks it; verifier, Sales and Support are refused).
* **Create login** opens a choice - the audited, additive part of this change:
  * **Set-password link** (default, unchanged): a random password nobody knows and an e-mailed one-time link. No password is ever sent.
  * **Temporary password**: the **server** makes a random 14-character password (CSPRNG, no look-alike characters), creates the login with it and
    queues **one** e-mail. The browser never sees it. At the first sign-in the client must choose their own password: until then
    `customer_client_accounts.must_change_password` makes `private.my_client_customer()` (hence every client function, the chat, ticket
    attachments and the row-level policies) see no customer. Only `client_me` answers (it says the password must change). The client
    chooses the password on `POST /client/password`, where the **server** sets it (so the temporary one cannot be kept), refuses the temporary
    password again, and only then clears the flag. The "Forgot password?" page uses the same endpoint.
* **No duplicates, no resets.** A second click is refused while a login is being made or exists; a half-made sign-in from a crashed attempt is
  finished, not duplicated; an existing password is never reset: "Send e-mail again" sends the set-password link to a client who chose their own
  password, and a *new* temporary password only to a client who has not yet replaced the first one (the database is asked first, so a refused
  resend never invalidates the password the client holds).
* Failure is shown with a safe reason and can be retried; no success e-mail exists unless the login was saved (the e-mail is queued only after
  `record_client_account_with_access`).

### WhatsApp panel (Meta Verifier -> Client login details)
The account / user ID form is unchanged. Next to each WhatsApp service there is a separate **Panel password** action: the verifier types the
password they set on the panel (twice), the API encrypts it and the database queues **one** e-mail to the customer's address on the record
(`PANEL_CREDENTIALS`). Saved afterwards: who set it, when, and the e-mail's state (Not set / Configured / waiting / sent / could not be sent with
the reason). Not saved: the password. Saving the account form never touches it. Only whoever may manage that customer's panel details (the route's
verifier, the Department Head, the Super Admin) can; a request id makes a double click or a retry one e-mail.

### E-mails
Dashboard: "Your Amuwa client dashboard - temporary sign-in details" (or the set-password e-mail). Panel: "Your <service> panel login - sign-in
details", which says in its first paragraph that it is the WhatsApp panel and separate from the dashboard login. The greeting is the customer's
name on the record. A missing/invalid address, an unreadable secret or a provider failure is recorded on the job (never as sent) and the
verification team / Accounts get a notification; only the password-free reason is recorded.

### How secrets are handled
* Encrypted by the API with AES-256-GCM (`server/automations/secrets.ts`, key `AUTOMATION_SECRET_KEY`, which exists only in the server
  environment). Without the key both features are **refused before anything is made** (503 with the reason).
* Kept only on the one e-mail job (`automation_jobs.secret`, not readable by any staff role). The database erases it when the job is sent,
  skipped or failed, while a *retry* still holds it (migration section 8), and after 7 days at most. It is in no ordinary table, history line,
  audit entry, notification, log or API response (asserted by the SQL and API tests). Supabase Auth keeps only its own hash.
* The temporary password is random per login and has to be replaced at first use; resending makes a new one.

### Residual risk (read this)
* **An e-mail carries a password.** Anyone who can read the customer's mailbox (or an e-mail provider's logs/archives) can read it. Mitigations:
  one-time use for the dashboard (forced change; the temporary one dies at first use), "delete this e-mail" in the text, no long-lived
  password in any response, and the set-password link remains the recommended default. The **panel** password cannot be one-time (the CRM cannot
  rotate an external panel): ask the customer to change it on the panel after the first sign-in.
* The CRM cannot verify that the password the verifier typed is the one set on the panel.
* The e-mail provider (Resend/Brevo/SMTP) sees the message in transit; use a provider with TLS (all three do).
* A client who never opens the e-mail stays locked out until Accounts sends it again (a new temporary password), by design.
* If `AUTOMATION_SECRET_KEY` is rotated while a job waits for a retry, that job cannot be decrypted: it fails with a clear message and Accounts /
  the verifier send again.

## 3. Payment e-mails reach every Accounts member
**Root cause.** `private.payment_desk_email()` chose one recipient (the oldest active Accounts member). Now `private.payment_desk_recipients()`
lists every **active** member of the Accounts department (read live from the department's membership, nothing hard-coded - a third member or a
suspended one is handled by the data) and `private.queue_accounts_email` queues one job **per recipient** (dedupe key per request and recipient,
so a retry makes none twice; two profiles cannot share an address - a unique index). A provider failure for one member is that member's retry
and never holds back the other; an invalid address is skipped for that member only. The e-mail carries the customer, a reference, the sender and
a link - no amount and no phone number. `payment_desk_email(uuid)` still returns the first recipient for older callers.

## 4. Part-payment installment helper
In **Record payment -> Part payment** (a new payment only; hidden for Full payment, which still fills the whole outstanding amount including
GST and validates as before), an optional checkbox **"Split what is still to receive into two installments"**. Basis: the amount **still to
receive** (total payable minus the money already recorded). Arithmetic: whole rupees in integers (`shared/installments.ts`), exact (81,600 ->
40,800 + 40,800; an odd amount puts the extra rupee in the first). It fills the first installment as this payment (still editable) and shows the
second as **planned, not received**. A planned installment is **not** a payment: nothing is stored, invoiced or marked verified, the order is not
settled, and GST, invoice totals and balances are untouched. No schema change: the second installment is simply the remaining balance the
order already tracks; persistent scheduling (due dates, reminders) was assessed and is not needed for this.

## 5. Invoice PDF layout
Rendered synthetic invoices (1, 2, 3, 5, 14, 25 rows; unpaid/paid; with the order block; long business name and address; Devanagari; IGST and
reverse charge) and inspected the pages. Fixed: the payment/balance block had rows with no padding (text touching the rules) - every row now has
its own height with the text centred and a margin above and below; the footer's contact line straddled the top edge of the green band and the
AIQR logo touched it - the band now starts clear of both, and the office text has its own left margin; the PAID stamp touched "For Amuwa
Corporation" - the signature area is taller and the stamp smaller; an invoice balance is never printed negative. Branding, GST, numbering, the
payment logic and the **Invoice Balance vs Total Order Balance** distinction are unchanged. The "Taxable Amount" column of the line table holds the
GST of the line (the supplied template's heading); it was left as supplied.

## 6. Invoice e-mails address the contact person
The greeting ("Dear Ashish,") and the recipient's display name use the customer's contact name (the invoice billing contact person, else the
name on the customer record, else the business name, else "Customer"); the PDF keeps the legal business name. The name is stripped of control
characters, angle brackets, quotes, commas and `@`, capped at 80 characters and HTML-escaped. The send step is recorded once (retry sends only
what has not been sent).

## 7. Crocodial
`crm_services.name` for `CROCODILE_CHANNEL_WEBHOOK` is now "Crocodial (Call CRM)": same row, code, prices, routing and customers' purchases, no
new service. History text (old invoice lines, audit entries, old migrations) is not rewritten. The usage import still accepts the old spelling.
The three Excel templates and their builder scripts use "Crocodial".

## Manual configuration / review after deploying
1. Run `supabase/run_these_3_migrations_handover_accounts_email_credentials.sql` once, deploy the app.
2. Set `AUTOMATION_SECRET_KEY` (any long random string) on the server - required for temporary and panel passwords.
3. Check Settings -> Team: every Accounts member who should receive payment e-mails is **Active** and has a valid e-mail.
4. Historical records: customers that already have a client login keep the set-password-link behaviour; nothing is converted. Old invoice
   lines that say "Crocodile" are history and are left as they are.
