# Candidate portal: registration without verification

A new candidate registers with name, mobile number, e-mail and password and is **active and signed in immediately**. There is no verification
e-mail, OTP, phone check or HR/admin approval, and no waiting screen. Every later visit is ordinary e-mail + password sign-in.

This is specific to the **candidate portal**. Staff, client and HR logins, and the project-wide Supabase Auth settings, are untouched.

## How it works

1. The portal's sign-up form calls `POST /api/v1/candidate-auth/register` (public, rate limited) with `{ name, email, phone, password }`.
2. AI-CRM creates the account through Supabase's **admin API** with `email_confirm: true`, so it is created already confirmed (no e-mail is
   sent) and carries the `candidate_portal` marker (`server/services/CandidateRegistrationService.ts`).
3. The portal signs the candidate in with the same e-mail and password (normal Supabase password sign-in), stores the session and redirects to the dashboard.
4. On the first request the database creates the candidate's profile and links it to the account (`private.career_me_id()`).

The account carries **no `app_metadata`**, so it can never be provisioned as staff or as a client, and an e-mail that already has *any* account
is refused (`409`, "sign in instead") without changing that account. The body is validated strictly: unknown fields (a role, a department) are rejected.

## What was removed

| Gate | Before | Now |
| --- | --- | --- |
| Supabase sign-up e-mail | required before the first sign-in | not sent: the account is created confirmed |
| `private.career_me_id()` | refused a candidate whose `email_confirmed_at` was empty | no verification check. It still requires a signed-in `candidate_portal` account |
| Existing unverified candidate accounts | could not sign in | marked as confirmed by the migration (below) |
| Portal sign-up page | "check your email" screen | signs in and redirects |

Not changed on purpose: the project-wide Supabase **Confirm email** setting stays as it is. Turning it off would also remove confirmation for staff and client
sign-ups, which is not wanted. It is not needed for this change.

## Migration to run (Supabase SQL editor)

`supabase/migrations/20261229000100_candidate_direct_registration.sql`

* replaces `private.career_me_id()` (same signature, minus the two verified-e-mail checks);
* sets `email_confirmed_at` on existing `candidate_portal` accounts that never verified, **excluding** accounts provisioned as staff or clients;
* does not touch passwords, applications, assessments, interviews or any other record, and is safe to run twice (tested).

Order: run the migration and deploy AI-CRM first, then merge the portal change. The portal needs the new endpoint; the endpoint works with or
without the migration for NEW candidates (they are created confirmed), the migration is what lets EXISTING unverified candidates in.

No new environment variable: the endpoint uses the service-role key AI-CRM already has (`SUPABASE_SERVICE_ROLE_KEY`).

## Security trade-offs (please read)

Removing verification is a deliberate choice, and it has consequences:

* **E-mail ownership is no longer proven.** Anyone can register an address they do not own, and then apply with it. Candidate notification
  e-mails (interview invitations, offers) go to the address typed at sign-up, so a typo or a false address sends them to the wrong person.
  HR should treat the e-mail as unverified until the candidate responds.
* **Account squatting:** someone can register a candidate's address first. The real owner can still reset the password (the reset e-mail goes to the
  address, so only the real owner can use it) and then take over the account.
* **Sign-up spam:** registration is public. It is limited to 10 per hour per address and 5 per hour per e-mail (shared across instances through the
  database; if the limiter is unavailable it falls back to per-instance limits and logs it). There is no CAPTCHA; add one if abuse appears.
* **Account existence:** the "sign in instead" answer tells a caller that an address has an account (candidate, staff or client). The rate limit slows
  guessing. If this matters more than the friendlier message, change the answer to a neutral one.
* Supabase's own public sign-up endpoint (reachable with the public anon key) is unchanged: accounts created that way stay unconfirmed and cannot
  sign in (while **Confirm email** is on), exactly as before.
* Every registration writes an audit event (`CANDIDATE_REGISTERED`, no e-mail, password or phone in it).

## Tests

* `supabase/tests/candidate_registration.test.ts` (unit suite): schema rules, the service, and the real route against a fake Supabase Auth server
  (created confirmed, marker set, no `app_metadata`, duplicate, weak password, outage, invalid bodies, rate limits).
* `supabase/tests/careers_test.sql`: an unverified candidate can now use the portal and gets their own applicant record; a non-candidate account is still refused.
* `supabase/tests/careers_direct_registration_test.sql`: re-runs the migration on crafted accounts (only unverified candidates change, staff/client markers untouched,
  nothing created or removed, safe to run twice).
* **Not tested here:** a real Supabase project (the admin call, sign-in and the confirm-email setting) and the live site.

## Roll back

Revert the pull request. To restore the old verification rule, re-create `private.career_me_id()` from `20261220010000_candidate_careers_foundation.sql`.
The confirmations written by the migration are not undone (a data change cannot be reversed from code).
