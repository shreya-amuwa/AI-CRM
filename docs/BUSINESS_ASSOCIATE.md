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

## Pages (Home, then the sections in this order)
Tasks - **Leads** (a group: Leads, Potential, Customer onboarding, Part payments) - Quotation - Demo Schedule - Scope of Project.
The **Leads** group is the same Leads -> Potential -> Customer onboarding pipeline every Sales Team Member works in (the same pages, API and rules; one record moves through the
steps, nothing is copied): *Add lead* is on Leads, *Save & move to Potential* takes a ready-to-buy lead to Potential, and a confirmed payment starts Customer onboarding.
The earlier flat Leads page (`/ba/leads`, Hot/Warm/Cold and call status) is still in the code and the API but is no longer in the menu.

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
> **Superseded by `docs/SALES_DASHBOARD_MERGE.md`:** the Sales Team Member dashboard was merged into this dashboard. A Sales Team Member (no other Sales role) now works in the Business Associate dashboard itself, with the pages of both; the "Business Associate" group in the Sales Team Member menu no longer exists. The rules below (ownership, `ba_eligible()`) still apply.
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

## Lead filters
The **Leads** page of the Leads group has the same five filters as the Telecaller's: All Leads, My Leads, Department Leads (read-only), To Accounts and Returned by Accounts, with counts. See `docs/TELECALLER.md` ("Lead filters").

## Client research on the web (migration 20270225000100)

**Where:** Business Associate → Scope of Project → open a version → **A. Client and business profile** → **Research the client online**.
The panel suggests the profile fields (sections A and B). Each suggestion shows **Verified** (a source says it) or **Assumption**, with its
numbered source links. **Use** / **Replace** fills one field, **Fill N empty fields** fills only the empty ones. Nothing is saved until the
Business Associate saves the draft, and the saved profile is then shared with quotations, as before.

**What is sent to the web:** the business (company) name, city, business category, the website and industry already typed. Never phone
numbers, e-mail addresses, the street address or notes (checked in the database tests). Phone numbers and e-mails that a web page shows are
removed from the suggestions.

**Cost control:**

| Step | Cost |
|---|---|
| A stored result (same company, city and website, last 30 days) | free, no web call |
| Tavily: 1 basic search (6 results, short snippets, `auto_parameters` off) | 1 credit |
| Tavily: 1 basic extract of the client's own site (home, /about, /services; missing pages are not charged) | 1 credit |
| Claude fills the fields from those snippets (no web search) | about 3-6k input and 1-2k output tokens |
| **Total per client with Tavily** | **about 2 credits + about $0.02-0.03 of Claude (~₹2-3)** |
| Fallback: Claude's own web search (at most 3 searches) | $0.01 per search + about 15-40k input tokens: **about $0.08-0.15 (~₹7-13)** |

* At most **15 new researches per person per day** (India time); stored results do not count.
* "Search again" asks for confirmation, because it spends credits.
* Each result stores what it used (`usage`: Tavily credits, Claude tokens and searches, an estimate in dollars), shown under the panel.

**Fallback:** Tavily is tried first. When it is not set up, does not answer, or says its credits are used up (HTTP 432 / 433), Claude's web
search is used (`BA_RESEARCH_FALLBACK=claude`, the default; `none` switches it off). After "credits used up", Tavily is skipped until the
1st of next month (India time), so no failed Tavily calls are wasted (`ba_research_state`).

**Set-up (server only, never `VITE_`):** `TAVILY_API_KEY` (Cloudflare: `wrangler secret put TAVILY_API_KEY`; Vercel: Project → Settings →
Environment Variables), plus the existing `ANTHROPIC_API_KEY`. Optional: `BA_RESEARCH_FALLBACK`, `BA_RESEARCH_CLAUDE_SEARCHES` (1-5, default 3),
`BA_RESEARCH_MODEL` (default `BA_AI_MODEL`), `BA_RESEARCH_TAVILY_TIMEOUT_MS`.

**API:** `GET /api/v1/ba/contacts/:id/research` (the last result, no web call; the contact's readers) and
`POST /api/v1/ba/contacts/:id/research` `{ force?: boolean }` (the contact's Business Associate only).

**Tests:** `supabase/tests/ba_client_research_test.sql` (access, what is searched, 30-day reuse, daily limit, Tavily pause),
`supabase/tests/ba_research.test.ts` (Tavily calls and credits, fallbacks, answer cleaning) and the "client research API" checks in
`api_integration.test.ts`.
