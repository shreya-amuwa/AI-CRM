# Password links: 24 hours, resending, robot check and limits

Every account sets its password from a one-time link: staff (welcome e-mail, "Forgot password?"), clients (login created, "Forgot
password?") and candidates (Careers portal "Forgot password?"). This page covers how long those links work, how to get a new one, and
the protections against abuse.

## 24 hours (owner, once)

- The lifetime is a Supabase Auth setting. It is not in code.
  - **Hosted Supabase:** Authentication → Email (or Providers → Email) → **Email OTP Expiration = `86400`** seconds. 24 hours is the
    most Supabase allows.
  - **Self-hosted:** `GOTRUE_MAILER_OTP_EXP: "86400"` under `services.auth.environment` (`docs/SELF_HOSTING_SUPABASE.md`).
- The e-mails say "The link works once and for 24 hours" (`server/security/linkLifetime.ts`). If you choose a shorter lifetime, set
  `AUTH_LINK_HOURS` on the Worker to the same number of hours so the e-mails stay true.
- A newer link replaces the older one: only the latest link works.

## Getting a new link

| Who | How |
| --- | --- |
| **Staff** | Opening an expired link shows **"Send me a new link"** (their work e-mail). Also "Forgot password?" on the sign-in page, or HR / the Department Head: **Resend welcome e-mail** (at most one every 2 minutes). |
| **Clients** | Opening an expired link shows **"Send me a new link"** (their login e-mail). Also "Forgot password?" on the client sign-in page. Or the **relationship manager**, below. |
| **Relationship manager** (also their Team Lead, Team Head, Department Head and Accounts) | Customer → Overview → **Client login**. It shows whether the client has chosen a password, when the last link was sent and until when it works, and **Send password link** (or **Send password reset link** once a password is set). |
| **Candidates** | Self-service only, on the Careers portal: "Forgot password?" (with the robot check). HR does not send candidate links. A candidate chooses their first password when registering, which is behind the robot check and the limits below. |

"Send me a new link" uses the same server endpoint as "Forgot password?". The answer is the same whatever the address, so nobody can
find out who has an account.

## Limits (all counted in the database, the same on every server instance)

| What | Limit |
| --- | --- |
| "Forgot password?" / "Send me a new link" (staff, client, candidate) | 5 per caller per 15 minutes, 3 per address per hour (`RESET_PER_IP_15MIN`, `RESET_PER_EMAIL_HOUR`) |
| Relationship manager's **Send password link** | 1 per customer every 2 minutes, 5 per customer per day, 30 per sender per day (`private.client_link_limits`); each send is audited (`CLIENT_PASSWORD_LINK_REQUESTED`) |
| HR's **Resend welcome e-mail** | 1 every 2 minutes per employee |
| A client changing their password | 10 per 15 minutes per client |
| Auth e-mails sent through the Supabase hook (candidates) | 5 per recipient per hour, 500 per hour in total |
| Candidate sign-up | Robot check + 5 per caller per hour, 3 per address per hour, 300 per hour in total |

Busy read-only paths keep in-memory limits on purpose, behind Cloudflare's shared per-address flood limit. Counting every page view in
the database would add the load `docs/OUTAGES.md` describes.

## "Confirm you are not a robot" on the CRM's forms

Cloudflare Turnstile is already on the Careers portal (`TURNSTILE_MODE`). The CRM's own **Forgot password** (staff and client) and
**Send me a new link** forms have their own switch, so turning it on cannot lock anyone out before the pages show the check.

1. Cloudflare dashboard → Turnstile → add the CRM's domain (`crm.amuwacorporation.com`) to the widget, or create a widget for it. Use
   **Managed** mode.
2. Build setting **`VITE_TURNSTILE_SITE_KEY`** = the widget's site key (public). Redeploy. The forms now show the check.
3. Worker variable **`TURNSTILE_CRM_MODE=log`** for a day. Failures are recorded in Security & Audit (`BOT_CHECK_FAILED`, surface
   `crm`) without refusing anyone.
4. Then **`TURNSTILE_CRM_MODE=enforce`**. A request without a passed check is refused (403).

The secret key is the existing `TURNSTILE_SECRET_KEY`. Tokens are accepted only from the CRM's own address (`APP_URL`, or
`TURNSTILE_CRM_HOSTNAMES`). If Cloudflare cannot be reached, requests are allowed and recorded, and the limits above still apply.
The site's security policy allows Turnstile's script (`https://challenges.cloudflare.com` in `script-src`).

## Database

Migration `supabase/migrations/20270212000100_client_password_links.sql`:
- `client_password_link_sends` (no direct access);
- `client_login_status(customer)`, the card;
- `client_password_link_begin(customer)`, the limits and audit before a link is made.

Who may use them is unchanged: whoever may work on the support customer, or Accounts.
