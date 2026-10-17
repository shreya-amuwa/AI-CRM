# Service journeys, Support leads, delivery departments and invoice balances

Migration: `supabase/migrations/20261029000100_service_journeys_support_balance.sql` (run it after `20261028000100_dynamic_invoices_two_stage.sql`; safe to run again).

Order matters: `20261028000100_dynamic_invoices_two_stage.sql` redefines some functions this migration replaces (the invoice JSON, the PDF claim, the payment confirmation). If you ever run that file again, run this one again afterwards.

## One catalogue, a journey per service
`crm_services` is the only service catalogue (Sales, Support and every department read the same rows). Two columns say how a service is delivered:

| Column | Meaning |
| --- | --- |
| `requires_technical_consultant` | `true` (default): the existing Technical Consultant journey |
| `delivery_department_id` | the department that delivers the service; required when the consultant is not needed |

Seeded once: the six `DS_*` Amuwa Design Studio services skip the Technical Consultant and are delivered by the Design Studio. Every other service keeps the existing journey. The Super Admin changes this with `PATCH /pipeline/service-journeys/:code` (`set_service_journey`, audited). Nothing in the code names a service to decide the route.

A customer's journey (`private.customer_journey`, shown by `GET /pipeline/customers/:id/journey`) comes from the services selected:

* **TECHNICAL** - every service needs the consultant. Unchanged.
* **DIRECT** - none does: Sales/Support -> Accounts (payment, client login) -> back to Sales (documents) -> delivery department.
* **MIXED** - some do. The customer follows the Technical Consultant journey (nothing is bypassed); the services that need no consultant can be sent to their department once the documents are verified.
* A customer already sent to a Technical Consultant stays TECHNICAL, so a catalogue change never moves work in flight.

## Direct journey
1. Sales or Support creates the lead (same record, same pages) and chooses services.
2. **Send to Accounts** (existing): the same customer waits in the Accounts queue (`sentFrom` SALES / SUPPORT, who and when).
3. Accounts records and **verifies** the payment (existing ledger; unverified money is never counted).
4. Accounts creates the **client dashboard login** (`POST /pipeline/customers/:id/accounts/client-login`). Status is kept in `customer_client_provisioning` (PENDING / CREATED / FAILED, attempts, reason). A second click while one is running is refused, a failure can be retried, a half-made login is removed, a second login for the customer is impossible. The password is hashed by Supabase Auth; the CRM neither stores nor e-mails it.
5. **Return to Sales** (`accounts_confirm_and_return`) needs the login for a direct customer. Payment, services, history and owner are kept.
6. The owner (and their team head, department head, Super Admin) **verifies the documents**. Accounts and Technical Consultants cannot, for direct customers; payment confirmation never verifies a document.
7. **Send to the delivery department** (`send_to_delivery_departments`) once everything is verified: each service goes to its own department (per-service columns on `customer_services`). A direct customer then becomes a customer; the Technical Consultant step never happens.
8. The delivery department sees only what was sent to it (Delivery Queue, read-only access to the customer and its documents).

The separate facts stay separate: customer stage, `payment_workflow` / payment status, invoice balance, client login status, document verification counts, delivery state, responsible department. `step` in the journey read is only a label.

## Support leads
Support members get My Leads / Potential / Customer Onboarding / Part Payments (the Sales pipeline, own records only, no inbound enquiries). Support team heads get Team Leads. Visibility is the existing hierarchy: owner, team head, department head, Super Admin. A Support lead is never visible to Sales or other departments.

## Invoice balance
Remaining balance = invoice total - **confirmed** payments applied to that invoice (calculated by the database on every read; never typed, never sent by the browser). Where an invoice's payments live follows what exists, so nothing is counted twice:

* `CUSTOMER` - the agreed-services invoice uses the customer's payment ledger. The invoice total may not exceed the agreed amount (it could never be paid in full).
* `ADDON` - the add-on request's payments.
* `INVOICE` - payments recorded on the invoice itself (`invoice_payments`; an additional invoice, or a customer with no agreed amount). They count as income.

One paid-invoice workflow: **Confirm Payment & Send Paid Invoice**. A part payment (invoice ledger) is recorded and the invoice stays open ("Partially paid"); when the balance is zero the invoice is marked paid and the stamped PDF and e-mail follow. A repeated click or request records nothing twice (`requestId`, unique reference). Both PDFs print invoice total, payments received, balance outstanding and the status.

## Tests
`npm run test:db` (sections 40-46 of `journeys_test.sql`), `npm run test:unit` (journey service, PDF balance, WhatsApp checkbox in a real browser), `npm run test:api`.
