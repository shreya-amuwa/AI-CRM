# AI Website client onboarding details on a lead

When a team member adds a lead and ticks the **AI Website** service (`AI_WEBSITE`), the Add Lead form shows an extra section,
**AI Website Client Onboarding Details**: the same questions as the WebTara order form, so the AI Website team can start without asking
the client again. Migration: `supabase/migrations/20270113000100_ai_website_onboarding.sql` (additive, safe to run twice).

## The fields

| Group | Field | Rule |
| --- | --- | --- |
| Basic client details | Client name | required, up to 160 characters |
| | Mobile number | required, a 10-digit Indian mobile (a leading +91 / 91 / 0, spaces and dashes are removed) |
| | Email | optional, a valid address (saved in lower case) |
| | Business name | required |
| Business details | Is the business listed on Google Maps? | required, Yes / No |
| | Google Maps link | optional, shown only after "Yes"; a web address (`https://...`). "No" removes a link |
| | City | required |
| | Type of business | required, from the CRM's business categories; "Other" asks which type |

## How the form behaves

* The section appears as soon as AI Website is ticked and disappears when it is unticked (what was typed is kept if it is ticked again).
  Other services never show it. Nothing else in the lead form changes.
* The empty fields start from the customer details already typed above (name, business, mobile, e-mail, city, category). A field already
  filled is never replaced, and nothing is guessed (the Google Maps answer is always the team member's).
* Every field is checked before anything is sent (the same Zod schema as the server, `aiWebsiteOnboardingSchema` in `shared/validation.ts`),
  with the message under the field.
* The details go with the lead in the same request (`POST /pipeline/leads` with `aiWebsiteOnboarding`). The server refuses an AI Website lead
  without them, before the lead exists. A retry of the same form (`clientRequestId`) returns the same lead and the same one record.
* **Edit lead** shows the saved details in the same section; changes are saved with **Save changes** (`PATCH /pipeline/leads/:id`). Choosing
  AI Website on an existing lead asks for the details before the new service is saved. An older AI Website lead without details is not
  blocked: the section says they are not saved yet.
* `POST /pipeline/customers/:id/ai-website-onboarding` saves the details on their own (for example by the onboarding team).

## Where the details are seen

`GET /pipeline/customers/:id` returns `aiWebsiteOnboarding` (or `null`). A read-only card shows them on the lead / customer pages used along
the journey: the customer details pop-up and quick view, the onboarding page, the hand-over board and the Technical Consultant's customer page.

## Data and permissions

* `public.ai_website_onboarding`: **one row per customer** (primary key `customer_id`, deleted with the customer). Editing updates that row;
  it never creates a second lead, client or record. The row belongs to the customer, so it stays through every stage, owner change and hand-over.
* **Read**: whoever can read the customer. The row-level policy asks the `customers` table as the caller, so the existing customer rules decide
  (owner, their Team Lead, the Department Head of that side, the Super Admin, the onboarding team, consultants, hand-over and delivery departments).
* **Write**: only `public.ai_website_onboarding_save(customer, details)`: it validates every field again, allows the lead's own Sales side
  (`private.can_access_customer`) or the onboarding team after the hand-over (`private.may_update_support_customer`), upserts the one row and
  writes `AI_WEBSITE_ONBOARDING_ADDED` / `AI_WEBSITE_ONBOARDING_UPDATED` to the audit log with the names of the fields that changed (not their values).
* Before the migration runs, leads still open; the details read as `null` and saving them answers that a database update is needed.

## Tests

`supabase/tests/ai_website_onboarding_test.sql` (database), `supabase/tests/ai_website_onboarding.test.ts` (unit),
`supabase/tests/ui_ai_website_onboarding.test.mjs` (browser: add, validate, edit, phone width) and the "AI Website client onboarding" block
of `supabase/tests/api_integration.test.ts`.
