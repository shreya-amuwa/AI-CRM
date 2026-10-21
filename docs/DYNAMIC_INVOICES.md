# Dynamic invoices (paid invoice only)

Accounts builds an invoice from the customer and purchase details. **Only the paid invoice (with the PAID stamp) is ever created and sent.** Older invoices keep the two-stage history described at the end of the lifecycle section.

## What changed (migration `20261112000100_paid_only_invoices.sql`)

- **No GST question for Sales, no automatic 18%.** *Send to Accounts* asks only for the agreed amount and a note. The agreed amount is the amount payable; the system adds no GST. Accounts chooses the GST rate of every invoice line (the rate field starts blank, with 0 / 5 / 12 / 18 / 28 % shortcuts, and any other rate can be typed); the invoice total and the order balance follow from that choice. Older agreements that were saved as including GST keep that meaning (Accounts can change it with a reason).
- **Save Invoice sends nothing.** The invoice is saved (`paid_only = true`); no unpaid PDF is created, stored or e-mailed, and the customer does not see it yet.
- **Confirm Payment & Send Paid Invoice** creates the paid PDF, stores it and e-mails it. It works after a **part payment** too: it needs at least one verified payment that is not already covered by an earlier paid invoice of the same order (`generated_invoices.paid_order_confirmed` records the confirmed total each paid invoice was issued against), so several paid invoices can follow several part payments.
- **Simpler invoice summary** (PDF, screens, e-mail attachment): *Invoice total*, *Total confirmed payments*, *Total order balance outstanding* and, on the PDF, the *Payment status*. *Balance Due on this Invoice*, *Invoice Status* and *Total Order Value* are removed. The invoice and the confirm dialog have more spacing.
- Add-on and invoice ledgers (`ADDON`, `INVOICE`) keep their existing part-payment-on-invoice rule.

Run `supabase/migrations/20261112000100_paid_only_invoices.sql` in the Supabase SQL editor after the earlier migrations (safe to run again).


## Lifecycle (invoices made before the paid-only rule)

1. **Generate & Send Invoice** (Accounts > Invoices, the customer pop-up, or an approved add-on in Business Verification). The invoice is saved as `ISSUED`, the unpaid PDF is created, stored privately (Cloudflare R2, or Supabase Storage as the fallback) and e-mailed to `customers.email`. The customer sees it on the client dashboard once the PDF is stored.
2. **Confirm Payment & Send Paid Invoice**. Accounts records the method, reference and date. The same invoice is rendered again with the PAID stamp, stored next to the unpaid one and e-mailed. The paid file appears for the customer only once it is stored; until then the dashboard says it is being prepared.

Each stage tracks its own `pdf_status` and `email_status`. A failed PDF or e-mail is retried from the invoice (`Retry`); the invoice, the stored file and a mail that was already accepted are never duplicated. A request id makes a double click or a repeated request return the same invoice.

## Rules

- Totals, GST (CGST + SGST for Maharashtra customers, IGST otherwise), rounding and the amount in words are calculated by the database. The browser sends only base amounts and rates; a total or GST amount in the request is refused.
- A tax treatment that differs from the customer's state needs a reason; a GSTIN from another state needs an explicit confirmation.
- Only Accounts (or Super Admin) writes invoices. A client sees only their own invoices (identity comes from `client_me`).
- PDFs are private, stay under 500,000 bytes (a lean fallback is used if a render would reach the limit) and are opened through short-lived links.
- Nothing polls: the Accounts lists refresh on `crm:pipeline-changed` and Realtime, the client page on the client notification feed.

## One order: the agreed amount, GST and balance

Sales usually agrees a price **before GST** (for example 1,20,000 + 18% GST = 1,41,600). Earlier, the agreed amount was treated everywhere as the total the customer pays, so the invoice check compared GST-inclusive invoice totals with a pre-GST figure and every balance and status was capped at it. The model is now:

| Figure | Where it lives |
| --- | --- |
| Agreed amount, as agreed | `customers.agreed_amount` |
| Does it include GST? | `customers.agreed_tax_basis` (`INCLUSIVE` or `EXCLUSIVE`) |
| Total payable, GST included | `customers.deal_amount` (what every payment, balance and status rule already read) |
| Total confirmed payments | `customers.amount_verified` (verified payments only; pending and rejected are never counted) |
| Order balance | total payable - confirmed payments |
| An invoice's own figures | taxable subtotal, GST, total, and what the verified payments cover of it (first invoice first) |

- `EXCLUSIVE`: the invoices of the agreed services may total at most the agreed amount **before GST**. The total payable is the GST of the invoices already issued plus the agreed amount not yet invoiced with GST at the rate of those invoices (18% before the first invoice). It is recalculated in the same transaction when an invoice is issued. Real GST is never added to a payment, and never twice.
- `INCLUSIVE`: unchanged. Invoice totals (with GST) are compared with the agreed amount.
- The PDF, the invoice preview and e-mail attachment, the Accounts and customer screens and the client dashboard all read `private.order_summary` and `private.invoice_payment_summary`; nothing re-derives a balance in the browser or the PDF. The PDF shows the invoice's own balance ("Balance Due on this Invoice") apart from "Total Order Value (incl. GST)", "Total Confirmed Payments", "Total Order Balance Outstanding" and the order's "Payment Status". The PAID stamp belongs to the invoice, not the order.
- Sales chooses the basis in Send to Accounts (default: excluding GST). Paise are accepted only on the payment that settles the exact balance (GST can leave paise).
- Agreements made before migration `20261103000100` are **not** reinterpreted: they stay `INCLUSIVE`. Accounts can correct one with `accounts_set_agreement_basis` (reason required, audited as `AGREEMENT_BASIS_CHANGED`; the "The agreed amount is before GST" link in the invoice builder). `accounts_agreement_review` (`GET /accounts/agreement-review`) lists every older agreement that already has invoices, for reconciliation. Nothing is rewritten or regenerated automatically.

Run `supabase/migrations/20261103000100_order_tax_basis.sql` in the Supabase SQL editor after `20261102000100` (safe to run again).

## Setup

- Run `supabase/migrations/20261028000100_dynamic_invoices_two_stage.sql` once in the Supabase SQL editor (safe to run again).
- Storage: the existing `STORAGE_PROVIDER` / R2 variables (see `CLOUDFLARE_R2.md`).
- E-mail is sent only when `AUTOMATION_MODE=live` and a provider is configured (for SMTP: `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`). Otherwise the stage reports `NOT_SENT` with the reason and can be retried after the setup is fixed. If `AUTOMATION_TEST_RECIPIENTS` is set, only those addresses receive mail.

## Tests

`npm run test:unit` (calculation, PDF, delivery), `npm run test:db` (section 30-37 of `invoices_test.sql`), `npm run test:api`, and the browser test `supabase/tests/e2e/run-invoices.sh` (Sales form without GST, Accounts choosing the GST, a paid invoice after a part payment, a phone-sized builder). New cases: `supabase/tests/paid_invoices_test.sql` and the "paid-only" block of `api_integration.test.ts`.
