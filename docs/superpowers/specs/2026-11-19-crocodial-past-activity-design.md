# Crocodial: earlier activity and the Department Head's view (short design)

## Why

After Sachin and Supriya were mapped and synced, Crocodial Activity showed 0. A mapping counted only activity after its approval
(19 Nov 2026, 5:02 pm), so 18,404 stored calls counted for nobody.

The owner wants three things:

- earlier activity shown;
- each person's own data on their dashboard, including the Department Head (Supriya);
- the Super Admin able to track everyone.

The owner confirmed that everything on those two Crocodial logins is theirs.

## Goals

- The Super Admin can set when an approved mapping starts counting: from the first stored activity, or from a chosen day.
- A Department Head or Team Lead who is connected sees their own activity next to the people they oversee.
- A Department Head is labelled as such in the management view, not shown as "—" or "No team".

## Non-goals and anti-goals

- No fetching again: the data is already stored.
- No change to anyone's role or team.
- Never let one record count for two people.
- Never infer who is who from names.

## Approaches considered

1. **Super Admin sets a "count from" date on an approved mapping (chosen).** It is explicit, audited, and checked for overlap in the
   database.
2. **Make approval always count everything stored.** This is simpler, but it would silently give a re-used login's earlier calls to the
   new person. Rejected.
3. **A one-off SQL update.** This is quick, but it is not audited and not repeatable for the next people. Rejected.

## Design

- **Database.** New function `public.croc_mapping_count_from(mapping, from date | null)`:
  - Super Admin only.
  - Works only on an approved mapping that is in effect.
  - `null` means the start of the day of the user's first stored call, follow-up or remark.
  - A future date is refused.
  - A period that overlaps another mapping of the same Crocodial user or person on that account is refused.
  - Audited with the previous and the new date.
- **API.** `POST /crocodial/mappings/:id/count-from` with `{ from: 'YYYY-MM-DD' | null }`.
- **Super Admin page.** Each approved mapping shows "Counting activity from <date>", with "Count all past activity" and "or from
  <date>, Use this date".
- **Heads and Team Leads.** The side panel gets a **Crocodial** section with three entries:
  - My Crocodial Activity (when connected);
  - My Crocodial Leads (when connected);
  - Team Crocodial Activity (when they oversee connected people).

  This was added after Sachin, a Team Lead with no connected people under him, found no Crocodial entry at all.
- **My Crocodial Leads.** New function `public.croc_leads`, read-only:
  - the leads Crocodial assigns to the person's mapped user;
  - the same visibility as `croc_activity`;
  - filters, search, paging and masked phones;
  - `GET /crocodial/leads`.
  It is also shown on the home page of Telecallers, BAs and team members who are connected.
- **Both activity views.** A "Last 90 days" preset is added.

## Calls made by the builder

- Days are in the account's time zone (Asia/Kolkata).
- A head is shown as "Department Head (above teams)".
- The 93-day maximum per view is kept.
