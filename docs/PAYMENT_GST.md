# GST of an order, part payments and invoices

Migration `20261201000100_order_level_gst.sql` (safe to run again; it replaces `20261114000200_payment_gst.sql`'s per-payment GST).
Tests: `supabase/tests/payment_gst_test.sql` (scenarios A to I), the "order GST" / "gst:" / "paid-only:" checks in `api_integration.test.ts`, the PDF checks in `invoice_pdf.test.ts`, and the browser test `supabase/tests/e2e/run-payment-gst.sh`.

## The model in one paragraph
Sales agrees an amount **excluding GST**. Nothing is added when the order is sent to Accounts. **Accounts chooses the GST rate once, for the whole order** (a dropdown filled from `order_gst_rates`: 0, 5, 12, 18, 28; never pre-selected, never a silent 18%). The database then works out the total payable and keeps it. **A payment is only money received**: it never carries GST, never changes the GST, and is checked against what is still payable *including* GST. **Invoices** (one for the whole order or several partial ones) use the order's rate on their own taxable part. The order balance and each invoice's balance are separate figures.

## Where each figure lives (the database is the source of truth)
| What | Column / function |
|---|---|
| What Sales agreed, before GST (never overwritten) | `customers.agreed_amount` |
| The GST rate of the order, who chose it and when | `customers.order_gst_rate`, `order_gst_set_by`, `order_gst_set_at` |
| The configured rates | `order_gst_rates` (validated by `accounts_set_order_gst`) |
| Total payable, GST included, whole rupees | `customers.deal_amount`, kept by `private.sync_order_payable` |
| Money received | `customer_payments.amount` (PENDING / VERIFIED / REJECTED / REVERSED); only VERIFIED is confirmed (`customers.amount_verified`) |
| Order figures for the screen, PDF and messages | `private.order_summary` (`order` in the payment overview and invoice summary) |
| Each invoice's share of the confirmed money | `private.invoice_allocations` (first issued, first paid) |

## Rounding policy (one rule everywhere)
* An **invoice** is exact to the paisa: GST is worked out per line as before (`shared/invoiceCalc.ts` and the database agree).
* The **order's total payable** is rounded to **whole rupees**, and the difference is shown as **Rounded to whole rupees** (`roundOff`). Example: 14 + 18% = 16.52, so the order is payable as **₹17** (GST 2.52, round-off 0.48).
* A payment is **whole rupees** (refused with a message otherwise, in the form and in the database). A **Full payment** is always the whole outstanding amount, filled in and read-only.
* When invoices exist, the payable is what they came to plus the part not invoiced yet (with the same rate), rounded to whole rupees.

## Choosing the rate (`accounts_set_order_gst`)
* Accounts only. Only for an order whose agreed amount is before GST.
* Until the rate is chosen: no payment can be recorded, no invoice can be made, and the screens say "Final payable amount not calculated yet". The payable shows the agreed amount only.
* The rate is **locked** once an invoice or a payment (pending or verified) exists. To change it, reject or reverse the payments first (every change is audited: `ORDER_GST_SET`).
* Older orders (see below) are never recalculated by choosing a rate: a rate that disagrees with GST already recorded on their payments or invoices is refused.

## Payments
* `accounts_record_payment` / `accounts_update_payment`: amount in whole rupees, method, reference, date, verify yes/no. No GST parameter.
* A payment may not exceed what is still to be received (payable minus verified and pending), a **part** payment may not settle the order, a **full** payment must settle it exactly.
* Pending, rejected and reversed payments never reduce the confirmed outstanding balance.
* Payments belong to one order (customer); they are never mixed across orders.

## Invoices
* The invoice builder shows the order's rate on every line, read-only. The database checks it too (`tg_generated_invoice_item_order_gst`): a line with another rate is refused.
* Overbilling is still refused: the invoices' taxable amounts together may not pass the agreed amount.

## A paid invoice for each payment (migration `20261202000100_payment_invoices.sql`)
Every **verified** payment, part or full, gets its own **paid invoice** for exactly that payment. This is what lets Accounts invoice the second part payment: the older rule only allowed invoices for the part of the agreed amount that no earlier invoice covered, and the first invoice usually took all of it.
* **When.** On *Record & verify* (the box "Make the paid invoice for this payment" is ticked by default) and on *Verify* of a pending payment. The payment is saved first; if the invoice cannot be made, the payment stands and the screen says why (no address on record, GST not chosen, ...). A verified payment without an invoice shows **Generate invoice**; it is idempotent (a second click returns the same invoice and repeats nothing).
* **What.** One line with the services of the order (and "part payment" for a part payment), GST at the order's rate, dated the day of the payment, marked paid by that payment. Then the paid stage runs like any paid invoice: PDF stored, e-mailed, sent by WhatsApp. The table `payment_invoices` links one payment to one invoice.
* **Amount.** The invoice total is the money received. Because the GST is worked out to the paisa and a payment is whole rupees, the invoice can be a paisa below the payment, never above, so the invoices of an order together never exceed the money that was verified.
* **The cap.** For an invoice made for a payment the rule is "all invoices together may not be worth more than the verified money" (the transaction flag `amuwa.payment_invoice`). A manual invoice for the whole agreed amount, made before the payments, already covers that money and leaves nothing to invoice: the screen then says "The money of this payment is already covered by the invoices issued so far".
* **Billing details** come from the customer record and onboarding; what they lack (the address) is taken from the customer's last invoice. A customer with neither has no invoice made until the address is added.
* The older ways are unchanged: Accounts can still create an invoice by hand and confirm its payment.
* Two invoices of 60,000 at 18% (70,800 each) for an order of 1,20,000 + 18% (1,41,600): with 60,000 received, invoice 1 shows 60,000 paid / 10,800 balance, invoice 2 shows 70,800, and the **order** still has 81,600 to receive.
* The PDF shows the taxable amount, the rate and CGST/SGST or IGST, the invoice total, then **Payments applied to this invoice**, **Invoice balance**, **Order total payable (incl. GST)**, **Total confirmed payments** and **Total order balance outstanding**, all from the saved figures.

## API
* `POST /pipeline/customers/:id/accounts/order-gst` `{ "rate": 18 }` → the payment overview (`orderGst`, `order`, `dealAmount`).
* `POST /pipeline/customers/:id/accounts/payments`, `PATCH .../payments/:paymentId`: `{ type, amount, method, reference, paidAt, note, verify }`; **`gstRate` is rejected (422)**.
* `GET /pipeline/customers/:id/payment-overview`: `orderGst { applies, rate, selected, legacy, locked, lockReason, rates[] }`, `order { gstRate, gstTotal, roundOff, totalPayable, confirmed, pending, balance, invoices[] }`.
* `GET /accounts/customers/:id/invoice-prefill`: `orderGstRate`; the lines carry it.
* `GET /pipeline/accounts/gst-reconciliation`: older orders that need a person to look at them (Accounts only).

## Orders made before this change (nothing is recalculated silently)
* Orders where **GST was recorded on payments** (the 20261114 way), or whose **invoices carry different rates**, keep their stored total payable exactly as it was. They are listed by `accounts_gst_reconciliation()` with the reasons (for example "GST recorded on payments", "invoices use different rates", "payable differs from agreed plus GST"). A person reviews each one; the system only lets Accounts choose a rate that agrees with what is already recorded.
* Orders with no GST rate and no GST recorded anywhere (older GST-less agreements) keep working as before; choosing a rate for them is optional and follows the same rules.
* The old payment columns `taxable_amount`, `gst_rate`, `gst_amount` stay for history (the payment list still shows the split on those rows). The retired functions `accounts_record_taxed_payment` / `accounts_update_taxed_payment` are dropped.
* `supabase/run_this_order_gst.sql` ends with a read-only list of those orders. Running it changes no payment, invoice or total.

## Known limits
* A payment cannot be re-allocated to a specific invoice; confirmed money is applied to invoices first issued, first paid (the order balance is exact either way).
* The retired per-payment GST has no UI any more: GST on an older order is read-only history.
