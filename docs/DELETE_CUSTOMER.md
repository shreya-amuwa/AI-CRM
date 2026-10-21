# Deleting a customer, and invoice pricing

## Delete a customer (Super Admin and Department Head)

Migration: `20261113000100_delete_customer.sql` (one function, safe to run again). Run it after `20261112000300_company_workflow.sql`.

* **Who:** the Super Admin, and the Department Head of the customer's own department. Everyone else (Team Leads, members, Accounts, other departments) is refused by the database and the API (`DELETE /customers/:id`).
* **Where:** a **Delete customer** button (with a confirmation) in the customer's pop-up or page: the Department Head's *Customers* page, the Super Admin's lead and customer views, and the Support customer profile. Only those two roles see it.
* **What is removed:** the customer and its conversations, activity, onboarding, documents (the stored files are removed too), tickets, plans, payment requests and any payment that was **never verified**, and the client login (the customer's sign-in user).
* **What blocks it:** a customer with an **issued invoice** or a **verified (or reversed) payment** cannot be deleted. Those are the company's financial records, Accounts keeps them, and the income reports are built from them. The pop-up shows the reason. (An invoice is immutable by design.)
* Every deletion is audited once as `CUSTOMER_DELETED`, with a snapshot of the customer's record.

## Invoice pricing: Accounts sets each price

Migration: `20261113000200_manual_invoice_pricing.sql` (replaces one helper, safe to run again). If `20261102000100` or `20261103000100` is ever run again, run this one again afterwards: they define the same helper.

* The system **no longer divides the budget**. With one service, its line carries the balance still to be invoiced. With two or more, every amount is left empty and Accounts enters the price of each (a different price per service, before GST).
* The cap is unchanged and enforced by the database when the invoice is issued: the invoices of the agreed services together can never pass the amount Sales agreed (before GST when the agreement excludes GST, otherwise with GST). The invoice builder shows the budget, what is already invoiced, what this invoice uses and what is left, and turns red with the amount over when the prices pass it.
* Example: Sales agrees 300 for two services. Accounts enters 100 and 200. Entering 150 and 200 is refused (350 > 300).

## Tests

`supabase/tests/delete_customer_test.sql` (sections 57-58), the "deleting a customer" block of `api_integration.test.ts`.
