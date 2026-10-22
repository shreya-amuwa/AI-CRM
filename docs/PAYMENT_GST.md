# GST when Accounts records a payment

Migration `20261114000200_payment_gst.sql` (safe to run again). Tests: `supabase/tests/payment_gst_test.sql`, the "payment GST" checks in `api_integration.test.ts`, and the browser test `supabase/tests/e2e/run-payment-gst.sh`.

## What the accountant sees
In **Record payment** (and Edit payment), for an order whose agreed amount is **before GST** (every order Sales sends now):

* **Amount before GST (₹)**: whole rupees.
* **GST**: No GST (0%), 5%, 12%, 18% or 28%. It must be chosen, so a rate is never forgotten by default.
* A box shows **Amount before GST**, **GST (rate)** and the **Final amount received** as soon as there is an amount and a rate.
* **Full payment** fills what is left of the agreed amount before GST.
* The payment history shows the split (for example "₹60,000 + GST ₹10,800 (18%)").

For an older agreement that already includes GST the form is unchanged (no GST option): GST cannot be added on top of an amount that includes it.

## What is recorded
* `customer_payments.amount` is the **final amount** (what the customer paid), so every balance, ledger, report and the department income read it exactly as before.
* `taxable_amount`, `gst_rate`, `gst_amount` store the split (`amount = taxable_amount + gst_amount`). They are empty for older payments and for agreements that include GST.
* GST is **on top of the agreed amount**: the order's total payable is the agreed amount plus the order's GST, where the order's GST is the **larger** of the GST of the invoices Accounts issued and the GST recorded on payments (so the same money is not taxed twice when its invoice repeats the GST). The total payable follows when a payment is edited, rejected or reversed.
* A payment still must not exceed the agreed amount plus GST; a full payment must settle it exactly; a part payment must not settle it.
* **Invoices are unchanged**: Accounts still chooses the GST on the invoice itself.

## API
`POST /pipeline/customers/:id/accounts/payments` and `PATCH .../payments/:paymentId` accept `gstRate` (0 to 28). `amount` is then the amount before GST; the response (the payment overview) returns each payment's `amount`, `taxableAmount`, `gstRate`, `gstAmount`, and `gst: { allowed, onPayments, taxableBalance }`. The database functions are `accounts_record_taxed_payment` / `accounts_update_taxed_payment`; the older functions remain for callers that send no rate.

## Known limit
An order that has both older payments without a GST split and invoices with GST may count the order's GST once rather than twice (the "larger of" rule). If a payment is refused as "exceeding the agreed amount" in that situation, record it with "No GST" or ask for the invoice GST to be reviewed.
