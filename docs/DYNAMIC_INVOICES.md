# Dynamic two-stage invoices

Accounts builds an invoice from the customer and purchase details, and the CRM creates, stores and e-mails its PDF in two stages.

## Lifecycle

1. **Generate & Send Invoice** (Accounts > Invoices, the customer pop-up, or an approved add-on in Business Verification). The invoice is saved as `ISSUED`, the unpaid PDF is created, stored privately (Cloudflare R2, or Supabase Storage as the fallback) and e-mailed to `customers.email`. The customer sees it on the client dashboard once the PDF is stored.
2. **Confirm Payment & Send Paid Invoice**. Accounts records the method, reference and date. The same invoice is rendered again with the PAID stamp, stored next to the unpaid one and e-mailed. The paid file appears for the customer only once it is stored; until then the dashboard says it is being prepared.

Each stage tracks its own `pdf_status` and `email_status`. A failed PDF or e-mail is retried from the invoice (`Retry`); the invoice, the stored file and a mail that was already accepted are never duplicated. A request id makes a double click or a repeated request return the same invoice.

## Rules

- Totals, GST (CGST + SGST for Maharashtra customers, IGST otherwise), rounding and the amount in words are calculated by the database. The browser sends only base amounts and rates; a total or GST amount in the request is refused.
- A tax treatment that differs from the customer's state needs a reason; a GSTIN from another state needs an explicit confirmation.
- Only Accounts (or Super Admin) writes invoices. A client sees only their own invoices (identity comes from `client_me`).
- PDFs are private, stay under 500,000 bytes (a lean fallback is used if a render would reach the limit) and are opened through short-lived links.
- Nothing polls: the Accounts lists refresh on `crm:pipeline-changed` and Realtime, the client page on the client notification feed.

## Setup

- Run `supabase/migrations/20261028000100_dynamic_invoices_two_stage.sql` once in the Supabase SQL editor (safe to run again).
- Storage: the existing `STORAGE_PROVIDER` / R2 variables (see `CLOUDFLARE_R2.md`).
- E-mail is sent only when `AUTOMATION_MODE=live` and a provider is configured (for SMTP: `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`). Otherwise the stage reports `NOT_SENT` with the reason and can be retried after the setup is fixed. If `AUTOMATION_TEST_RECIPIENTS` is set, only those addresses receive mail.

## Tests

`npm run test:unit` (calculation, PDF, delivery), `npm run test:db` (section 30-37 of `invoices_test.sql`), `npm run test:api`.
