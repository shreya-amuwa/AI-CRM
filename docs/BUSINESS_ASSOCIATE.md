# Business Associate workspace

A **Business Associate** is a Sales team member with the Sales role *Business Associate* (set by the Super Admin or the Department Head, at creation or later in
*Team Members & Access*). The role is stored on the profile; the person stays in the Sales team. Run `supabase/run_this_business_associate.sql` (the migration
`20261119000100_business_associate.sql`) once in the Supabase SQL editor, after `run_this_telecaller.sql`. It is safe to run again and changes no existing data.

## The workflow
Telecaller lead -> **Convert** (Telecaller's Leads page, only for a lead whose call status is *Interested*) -> contact assigned to a Business Associate of the department
-> **Tasks** -> requirements -> **Quotation** -> **Demo Schedule** -> **Scope of Project** -> follow-up.

* Converting creates one row in `ba_contacts` that points at the *same* `customers` row (`lead_id`, unique): nothing is copied, a lead converts once (a second attempt is
  refused), and the lead keeps its owner and its place in the Sales pipeline. Without a chosen Business Associate, the one with the fewest open contacts gets it.
  The Department Head / Super Admin can reassign (`POST /ba/contacts/:id/reassign`); the history stays with the contact.
* Stages (explicit, in `ba_contacts.stage`): New, In Progress, Quotation Pending, Demo Scheduled, Scope of Project Pending, Completed. They move by themselves
  (first piece of work, a quotation draft, a booked demo, a completed demo, a finalised document) and the Business Associate can set them.

## Pages (Home, then the five sections in this order)
Tasks - Leads - Quotation - Demo Schedule - Scope of Project. **Leads** is the same page the Telecaller uses (same table, form, validation, badges) with the Business
Associate's own endpoints (`/ba/leads`): their leads are ordinary Sales leads they own, never the Telecaller's.

## Quotations
* Prices start from the **approved price list** (`service_prices`, set by the Super Admin / Department Head in *Service Prices*: price, GST rate, largest discount allowed).
  A price that differs, or a service with no approved price, is **flagged** on the quotation; a discount above the limit is **refused**. No tax is added unless
  "GST applies" is ticked. The database works out every amount (whole paise); the AI never sees a way to change one.
* **Generate with AI** drafts the words only (introduction, requirements, service descriptions, terms text). Payment terms, validity and timeline are what the
  Business Associate typed; if one is missing the AI asks for it instead of inventing it. An AI draft is *not reviewed*: it cannot become a PDF until the Business
  Associate has read it and confirmed.
* **Generate PDF** finalises the quotation: the PDF is drawn from the stored snapshot, stored in the private bucket `ba-documents` (R2 or Supabase Storage, like invoices) and its
  reference kept in the database. A final quotation never changes; **Create revision** makes a new draft with the same number. A quotation is **not an invoice**:
  nothing here touches invoices, payments or Accounts. No registration number, GSTIN or bank detail is printed.

## Demo Schedule
Book, edit, reschedule, cancel and complete demos (with feedback and follow-up notes); list and month calendar; upcoming / completed / cancelled / rescheduled.
The end must be after the start, a past time is refused, and one Business Associate cannot be in two demos at once. **No invitation, video meeting or reminder is sent**:
the meeting is recorded in the CRM only.

## Scope of Project
A structured blueprint per client: A client and business profile, B current situation (kept with the contact, so quotations and scope read the same facts), C business analysis
with SWOT (every point is **Verified** or **Assumption**), D recommended services (only from the approved catalogue; anything else the AI returns is dropped), E project scope
(deliverables, phases, milestones, responsibilities, assumptions, out of scope, risks, KPIs, next steps) and a list of **questions for what is missing**. *Generate Scope with
AI*, *Regenerate this section*, edit, review, **Finalize Scope and generate PDF**; finalised versions are kept and read-only, **Start a new version** copies the latest one.

## AI and privacy
`ANTHROPIC_API_KEY` (server only; the same setting the performance reports use), optional `BA_AI_MODEL` (default `PERFORMANCE_AI_MODEL`, then `claude-sonnet-5-5`) and
`BA_AI_TIMEOUT_MS` (default 120000). Without a key the AI buttons say so and the documents can be written by hand. The AI receives only the one client the signed-in
Business Associate owns (name, company, requirements, the profile they typed, services, their notes; **no phone numbers or e-mail addresses**), the approved catalogue and
the fixed totals. Every answer is validated against a schema before use.

## Security
RLS plus `SECURITY DEFINER` functions; nobody writes the tables directly. A Business Associate reads and changes only their contacts and documents; the Department Head, the
Super Admin and the Team Lead of the team can **read** (and download) them. Finalised documents are protected by a database trigger. Downloads are short-lived signed links
checked by the database first. Conversions, finalisations, reassignment and price changes are audited.

## Tests
`supabase/tests/business_associate_test.sql` (database), the Business Associate block of `api_integration.test.ts` (API, with a local stand-in for the AI service and a fake R2),
`ba_pdf.test.ts` (the PDFs), `telecaller_sheet.test.ts`, and `supabase/tests/e2e/run-business-associate.sh` (real browser).

## A Sales Team Member working as a Business Associate
The Business Associate keeps its own dashboard, role and data. In addition, a **Sales Team Member who has no Sales role** (the "Sales Team Member" dashboard) works as a Business
Associate from their own sidebar: a **Business Associate** group under *My Leads* with **BA Overview, BA Tasks, Quotation, Demo Schedule and Scope of Project** - the same pages, the same
rules, the same AI drafts and PDFs. Only these pages are added; every other page of that dashboard is unchanged. The Business Associate's *Leads* page is not repeated: a Sales member's
leads are the ones in *My Leads* (the Home buttons that point at Leads open *My Leads*).

* Migration `20261127000100_sales_member_business_associate.sql` (`supabase/run_this_sales_member_business_associate.sql`, run once after `run_this_business_associate.sql`; safe to run again).
  `private.ba_eligible()` is true for an active Team Member who is a Business Associate or a Sales Team Member with no Sales role; `private.is_business_associate()` uses it, so every
  Business Associate function works for them - on **their own contacts only** (the ownership checks are unchanged).
* A Telecaller (and the Department Head, when reassigning) can hand a contact to such a Sales member of the department. With no choice made, a dedicated Business Associate is still
  preferred (then the fewest open contacts), so nobody's current workload moves.
* Telecallers and the other Sales roles, Support and every other department stay refused; changing the price list stays with the Super Admin / Department Head.
