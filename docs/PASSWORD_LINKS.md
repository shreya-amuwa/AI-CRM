# Password links: 24 hours, resending, robot check and limits

Every account sets its password from a one-time link: staff (welcome e-mail, "Forgot password?"), clients (login created, "Forgot
password?") and candidates (Careers portal "Forgot password?"). This page covers how long those links work, how to get a new one, and
the protections against abuse.

## 24 hours (owner, once)

- The lifetime is a Supabase Auth setting. It is not in code.
  - **Hosted Supabase:** Authentication → Email (or Providers → Email) → **Email OTP Expiration = `86400`** seconds. 24 hours is the
    most Supabase allows.
  - **Self-hosted:** `GOTRUE_MAILER_OTP_EXP: "86400"` under `services.auth.environment` (`docs/SELF_HOSTING_SUPABASE.md`).
- The e-mails and pages say "The link works once and for 24 hours" (`server/security/linkLifetime.ts`), so the setting must be exactly
  86400. With a shorter setting, links would stop working before the time the e-mails promise.
- A newer link replaces the older one: only the latest link works.

## Getting a new link

| Who | How |
| --- | --- |
| **Staff** | An expired link shows **"Send me a new link"** (their work e-mail) when they save, and the set-password page always offers **"Link expired? Send me a new one"**. Also "Forgot password?" on the sign-in page, or HR / the Department Head: **Resend welcome e-mail** (at most one every 2 minutes). |
| **Clients** | The same on the client set-password page (their login e-mail). Also "Forgot password?" on the client sign-in page. Or the **relationship manager**, below. |
| **Relationship manager** (also their Team Lead, Team Head, Department Head and Accounts) | Customer → Overview → **Client login**. It shows whether the client has chosen a password, when the last link was sent and until when it works, and **Send password link** (or **Send password reset link** once a password is set). "Last link" is the last one the team sent from this card; a client's own "Forgot password?" makes a newer one. |
| **Candidates** | Self-service only, on the Careers portal: "Forgot password?" (with the robot check). HR does not send candidate links. A candidate chooses their first password when registering, which is behind the robot check and the limits below. |

"Send me a new link" uses the same server endpoint as "Forgot password?". The answer is the same whatever the address, so nobody can
find out who has an account.

## Limits (all counted in the database, the same on every server instance)

| What | Limit |
| --- | --- |
| "Forgot password?" / "Send me a new link" (staff, client, candidate) | 5 per caller per 15 minutes, 3 per address per hour (`RESET_PER_IP_15MIN`, `RESET_PER_EMAIL_HOUR`) |
| Relationship manager's **Send password link** | 1 per customer every 2 minutes, 5 per customer per day, 100 per sender per day (`private.client_link_limits`), counted once the e-mail went out; each send is audited (`CLIENT_PASSWORD_LINK_REQUESTED`) |
| HR's **Resend welcome e-mail** | 1 every 2 minutes per employee |
| A client changing their password | 10 per 15 minutes per client |
| Auth e-mails sent through the Supabase hook (candidates) | 5 per recipient per hour, 500 per hour in total |
| Candidate sign-up | Robot check + 5 per caller per hour, 3 per address per hour, 300 per hour in total |

Busy read-only paths keep in-memory limits on purpose, behind Cloudflare's shared per-address flood limit. Counting every page view in
the database would add the load `docs/OUTAGES.md` describes.

## "Confirm you are not a robot" on the CRM's forms

Cloudflare Turnstile is already on the Careers portal (`TURNSTILE_MODE`). The CRM's own **Forgot password** (staff and client) and
**Send me a new link** forms have their own switch, so turning it on cannot lock anyone out before the pages show the check.

1. Cloudflare dashboard → Turnstile: either add the CRM's domain (`crm.amuwacorporation.com`) to the Careers portal's widget, or create
   a widget only for the CRM and put its secret key in the Worker secret **`TURNSTILE_CRM_SECRET_KEY`**. Use **Managed** mode.
2. Build setting **`VITE_TURNSTILE_SITE_KEY`** = the widget's site key (public). Redeploy. The forms now show the check.
3. Worker variable **`TURNSTILE_CRM_MODE=log`** for a day. Failures are recorded in Security & Audit (`BOT_CHECK_FAILED`, surface
   `crm`) without refusing anyone.
4. Then **`TURNSTILE_CRM_MODE=enforce`**. A request without a passed check is refused (403).

The secret key is `TURNSTILE_CRM_SECRET_KEY`, else the existing `TURNSTILE_SECRET_KEY`. Tokens are accepted only from the CRM's own host
name (`APP_URL`'s, else `crm.amuwacorporation.com`, or `TURNSTILE_CRM_HOSTNAMES`). If Cloudflare cannot be reached, or the check cannot load
in someone's browser (an ad blocker), the request is sent without it: allowed and recorded, and the limits above still apply.
The site's security policy allows Turnstile's script (`https://challenges.cloudflare.com` in `script-src`).

## Database

Migration `supabase/migrations/20270212000100_client_password_links.sql`:
- `client_password_link_sends` (no direct access);
- `client_login_status(customer)`, the card;
- `client_password_link_begin(customer)`, who may and the limits, before a link is made;
- `client_password_link_sent(customer)`, which counts the link and audits it once its e-mail was accepted.

Who may use them is unchanged: whoever may work on the support customer, or Accounts.
