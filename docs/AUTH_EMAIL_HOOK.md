# Sending Supabase's auth e-mails through the CRM's own mailer

By default Supabase sends the sign-up confirmation, password-reset, invite and magic-link e-mails itself ("Supabase Auth", generic wording).
With the **Send Email hook** Supabase instead hands each e-mail to the CRM, which sends it through the mailbox it already uses
(nodemailer over SMTP, Resend or Brevo: `EMAIL_PROVIDER`, `SMTP_*`, `EMAIL_FROM`, see `ONBOARDING_AUTOMATIONS.md`) with Amuwa wording.

* Endpoint: `POST /api/v1/internal/auth/email-hook` (code: `server/automations/authEmailHook.ts`).
* Not used until you turn the hook on in Supabase. Merging this code changes nothing by itself.
* It covers the whole Supabase project: **candidates** (careers portal), **employees and clients** (CRM). Wording follows the user: a user with
  `user_metadata.candidate_portal = true` gets "Amuwa Careers" wording and sender name, everyone else "Amuwa CRM".
* The CRM's own employee welcome e-mail is unaffected: it builds its link with the admin API and does not go through this hook.

## What it handles

| Supabase e-mail | Result |
| --- | --- |
| `signup` (confirm e-mail) | confirmation link |
| `recovery` (reset password) | reset link |
| `invite` | invitation link |
| `magiclink` | sign-in link |
| `email` (one-time code), `reauthentication` | the code |
| `email_change` and any unknown type | **refused with 422** (not guessed; nothing is sent). AI-CRM and the candidate portal do not change e-mail addresses today. Turn the hook on only after confirming this, or ask for the type to be added. |

The link is Supabase's own verify endpoint (`<SUPABASE_URL>/auth/v1/verify?token=<hash>&type=<type>&redirect_to=<url>`), which then sends the person
to the page Supabase was given (for the candidate portal: `/auth/confirmed`, or the reset page). `redirect_to` must still be in Supabase's
**Redirect URLs** list.

## Security

* Every request is signed by Supabase (Standard Webhooks: HMAC-SHA256 over `webhook-id.webhook-timestamp.body`); unsigned, wrongly signed or
  older-than-5-minutes requests get 401 and send nothing. Comparison is constant-time. Bodies over 20 KB are refused.
* The hook secret is read from `SUPABASE_AUTH_HOOK_SECRET` only. Without it the endpoint answers 503.
* One-time links are **never copied to `EMAIL_CC` / `EMAIL_BCC`** (those lists belong to the onboarding e-mails).
* Nothing secret or personal is logged: no link, no code, no e-mail address; only the e-mail type and the provider's error class.
* This endpoint is not affected by `AUTOMATION_MODE` (that switch is for the onboarding automation, and a sign-up e-mail must not be silently
  dropped in `dry_run`). Whether it is active is decided by Supabase (hook on/off) and by the secret being set.
* Not protected against replays inside the 5-minute window (a replayed request would send the same e-mail again, to the same person).

## Turn it on (owner, in this order)

1. **Vercel → AI-CRM project → Environment Variables:** nothing else is needed if e-mail already works (`EMAIL_PROVIDER`, `SMTP_*`/key, `EMAIL_FROM`,
   `SUPABASE_URL`). Deploy this code first.
2. **Supabase → Authentication → Hooks → Send Email → Create:** choose **HTTPS**, URL
   `https://crm.amuwacorporation.com/api/v1/internal/auth/email-hook`. Click **Generate secret** and copy it.
3. **Vercel → AI-CRM project:** add `SUPABASE_AUTH_HOOK_SECRET` = the secret exactly as Supabase shows it (`v1,whsec_…`), then **redeploy** (variables apply to new deployments).
   Paste the secret only into Vercel and Supabase, never into chat, a file or a commit.
4. **Supabase:** save/enable the hook. Do steps 3 and 1 before enabling, or sign-ups fail with "Error sending confirmation email" until the secret is deployed.
5. Test with a fresh sign-up on the portal, then a "forgot password". You should receive the Amuwa e-mail from the CRM mailbox. Also test one CRM staff
   password reset, because it goes through the same hook.

**If it misbehaves:** disable the hook in Supabase (Authentication → Hooks) and Supabase sends its own e-mails again immediately. No code change or
redeploy is needed to roll back.

If a sign-up fails with "Error sending confirmation email", Supabase reached the CRM but the CRM answered with an error. See
**Vercel → AI-CRM → Logs** for `auth e-mail hook` lines: 401 = wrong secret or an old redeploy, 503 = mail provider/secret not configured or the
mailbox refused (for Gmail: a wrong or revoked app password), 422 = an e-mail type that is not supported.

## Tests

`supabase/tests/auth_email_hook.test.ts` (in `npm run test:unit`, no database): signature (tampering, replay, wrong secret, several signatures),
every e-mail type and audience, HTML escaping, CC/BCC never added, failures, and an end-to-end run: a signed HTTP request into the API, through
the real nodemailer SMTP path, into a local mail server that records the message. **Not tested here:** a real Supabase project sending to the endpoint,
and real mailbox delivery (not reachable from the development environment). Use the checks in "Turn it on".
