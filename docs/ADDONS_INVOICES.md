# Add-on verification and centralised invoices

Migration: `supabase/migrations/20261015000100_addon_verification_invoices.sql` (re-runnable).
It extends the existing onboarding, payment and invoice structures; nothing is duplicated.

## Workflow

```
Sales adds lead -> Send to Accounts -> Accounts confirms the initial payment -> Technical Consultant (TC)
TC contacts the customer: interested in add-on services?
  No  -> Send for onboarding (existing technical onboarding)
  Yes -> TC prices the add-ons (draft) -> Submit for Accounts Verification
         Accounts: Business Verification
           Reject (reason)           -> TC sees the reason; may start a new request
           Request changes (reason)  -> TC corrects and resubmits
           Approve                   -> Accounts generates the add-on invoice
                                       -> Accounts records / verifies payments -> Confirm payment
                                       -> TC starts add-on document collection -> verify -> Complete
```

The original services keep their own onboarding and payment ledger; "Send for onboarding" is never
blocked by add-ons. Add-on money is kept in `addon_payments`, apart from `customer_payments`.

## Statuses (`addon_requests.status`)

| Status | Label | Meaning |
| --- | --- | --- |
| DRAFT | Draft | TC is preparing it; not visible to Accounts |
| PENDING_VERIFICATION | Pending Accounts Verification | Submitted; prices locked |
| CHANGES_REQUESTED | Changes Requested | Accounts gave a reason; TC can edit and resubmit |
| REJECTED | Rejected | Closed with a reason; a new request may be started |
| APPROVED | Approved | Verifier recorded; waiting for the invoice |
| INVOICE_GENERATED | Invoice Generated | Shown with the payment state "Pending Payment" / "Part paid" |
| PAYMENT_CONFIRMED | Payment Confirmed | TC may start the add-on documents |
| IN_PROGRESS | Technical Onboarding In Progress | Add-on documents being collected and verified |
| COMPLETED | Completed | Every add-on item verified |

"Pending Payment" is the payment state of an INVOICE_GENERATED request, not a second status.
`customer_onboarding.addon_request_status` mirrors the latest request (trigger), for lists and filters.

## Tables

- `addon_requests`: customer, department, consultant, status, totals, `version` (stale-form check),
  submitted / decided (by, at, note), `invoice_id`, payment confirmed (by, at), started, completed.
  One open request per customer (partial unique index).
- `addon_request_items`: the priced lines (service code or typed name, quantity, unit price, discount,
  tax %, tax, line total). Totals are worked out by the database (`private.price_items`).
- `addon_request_events`: append-only history (action, note, snapshot of the lines).
- `addon_payments`: amount, method, reference (unique per request), status PENDING / VERIFIED / REJECTED.
- `member_invoices` (existing invoice table, extended): `kind` (SERVICE / ADDON / MANUAL for older rows),
  department, subtotal / discount / tax, issued by / at, paid at, `addon_request_id` (unique: one invoice
  per request). Numbers come from a sequence: `INV-YYYY-#####`.

All new tables have RLS on and no direct grants: every read and write is a SECURITY DEFINER function
that checks the caller (`private.require_accounts_staff`, `private.can_manage_addons`,
`private.can_view_addons`, `private.can_read_invoice`), locks the row and re-checks the state, so a
request cannot be approved or invoiced twice and a payment cannot exceed the invoice.

## Invoice permissions

| Role | Invoices |
| --- | --- |
| Accounts staff | Create (services), generate (approved add-ons only), mark services invoices paid / pending, view, download |
| Sales | Read-only, own customers (list, detail, PDF). Cannot create, edit, upload or delete |
| Technical Consultant | Read-only for the customers of their department in onboarding |
| Department / team heads, Support | Read-only where they may already see the customer |
| Super Admin | Unchanged |

The Sales "Add Invoice" form, the "Create Invoice" quick action and the Invoice upload on the onboarding
checklist are gone. Insert / update / delete on `member_invoices` are revoked from `authenticated`, and
`begin_document_upload`, `save_onboarding_entry` and `delete_customer_document` refuse the INVOICE item.
The onboarding "Invoice" item is filled by the services invoice Accounts issues.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET / POST | `/pipeline/customers/:id/addon-request` | read: anyone who may see the customer; save / submit: TC |
| POST | `/pipeline/customers/:id/addon-request/start-documents` | TC |
| POST | `/pipeline/customers/:id/addon-request/complete` | TC |
| GET | `/pipeline/customers/:id/invoices`, `/invoices` | read-only, scoped |
| GET | `/accounts/addon-requests`, `/accounts/addon-requests/:id` | Accounts |
| POST | `/accounts/addon-requests/:id/decision` (APPROVE / REJECT / CHANGES) | Accounts |
| POST | `/accounts/addon-requests/:id/invoice` | Accounts |
| POST | `/accounts/addon-requests/:id/payments`, `/accounts/addon-payments/:id/decision` | Accounts |
| POST | `/accounts/addon-requests/:id/confirm-payment` | Accounts |
| GET / POST / PATCH | `/accounts/invoices`, `/accounts/invoices/:id`, `/accounts/invoice-customers` | Accounts |

## Notifications (from saved state changes)

Submitted -> Accounts and the salesperson; approved / rejected / changes requested -> TC; invoice
issued -> TC and salesperson; payment confirmed -> TC and salesperson; add-on documents started ->
salesperson. The existing notifications for the initial payment and the hand-over are unchanged.

## Existing data

Add-ons chosen with the old unpriced picker become DRAFT requests at price 0 with a note asking the
TC to enter the agreed prices; nothing is approved, invoiced or paid automatically. Invoice PDFs Sales
uploaded earlier stay where they were and still count for the Invoice item.
