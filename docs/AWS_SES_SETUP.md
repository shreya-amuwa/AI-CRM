# Setting up AWS SES for the CRM's e-mail

For the owner. About 1 hour of clicking, then about a day of waiting for AWS to grant production access. Do it before go-live; the CRM
keeps sending through the Gmail mailbox (`meta@amuwa.com`) until you switch `EMAIL_PROVIDER` to `ses`, and the mailbox stays the backup
afterwards (see "What the CRM does" at the end).

Never paste keys or passwords into chat, documents or commits: only into the AWS console and the Cloudflare dashboard.

## 1. AWS account (15 minutes)

1. Create an account at <https://aws.amazon.com> with a company e-mail (not a personal one) and the company card.
2. **Secure the root user:** account menu -> Security credentials -> Assign MFA device (an authenticator app). Use the root user only for
   billing and account settings from now on.
3. **Billing alarm:** Billing and Cost Management -> Budgets -> Create budget -> "Zero spend budget" or a monthly budget of e.g. US$10 with
   an e-mail alert. SES costs about US$0.10 per 1,000 e-mails, so a jump means something is wrong.

## 2. Choose the region

Top-right region menu: **Asia Pacific (Mumbai) ap-south-1**. Every SES step below happens in this region. (If you choose another, set
`SES_REGION` to it.)

## 3. Verify the domain amuwa.com (15 minutes + DNS wait)

Amazon SES -> Configuration -> **Identities** -> Create identity:

* Identity type: **Domain**, `amuwa.com`.
* **Use a custom MAIL FROM domain:** on, `mail.amuwa.com`, "Behavior on MX failure": *Use default MAIL FROM domain*.
* Advanced DKIM settings: **Easy DKIM**, **RSA_2048_BIT**, DKIM signatures enabled.
* Create identity. SES shows the DNS records to add.

Add these records where `amuwa.com`'s DNS is managed (the same place as its Google Workspace MX records):

| Type | Name | Value | Why |
| --- | --- | --- | --- |
| CNAME (×3) | `xxxx._domainkey.amuwa.com` (three different names) | `xxxx.dkim.amazonses.com` | DKIM: proves the e-mails are really from amuwa.com |
| MX | `mail.amuwa.com` | `10 feedback-smtp.ap-south-1.amazonses.com` | bounces come back to SES (custom MAIL FROM) |
| TXT | `mail.amuwa.com` | `v=spf1 include:amazonses.com ~all` | SPF for the MAIL FROM domain |
| TXT | `_dmarc.amuwa.com` | `v=DMARC1; p=none; rua=mailto:meta@amuwa.com` | only if there is no `_dmarc` record yet; if there is one, keep it |

* Copy the exact values from the SES page (the `xxxx` parts are unique to your account).
* **Do not change the existing records of `amuwa.com` itself** (its MX for Google, its SPF `v=spf1 include:_spf.google.com ~all`, the
  Google DKIM). The SES records are on `_domainkey` names and on `mail.amuwa.com`, so nothing Google uses changes. Company e-mail is
  unaffected.
* If a DNS provider adds the domain automatically, enter only the part before `.amuwa.com` (e.g. `mail`, `xxxx._domainkey`).
* Wait until the identity shows **Verified** and DKIM **Successful** (minutes to a few hours), and "MAIL FROM domain" **Success**.

After this, the CRM can send from **any** `@amuwa.com` address: `auth@`, `support@`, `careers@`, `hr@`, `sales@`... No per-address step.

## 4. Bounces and complaints (5 minutes)

* Amazon SES -> Configuration -> **Suppression list** (account-level): make sure **Bounces and complaints** are both selected. An address
  that bounced or reported spam is then never e-mailed again, which is what keeps the account in good standing.
* CloudWatch -> Alarms -> Create alarm -> metric **SES -> Account metrics -> Reputation.BounceRate**: threshold `>= 0.04` (4%), action:
  create an SNS topic that e-mails you (confirm the subscription e-mail). Create a second alarm on **Reputation.ComplaintRate** `>= 0.0008`.
  AWS reviews accounts at 5% bounces or 0.1% complaints; these warn you before that.

## 5. Ask for production access (5 minutes + about a day)

A new SES account is in the **sandbox**: it can only send to addresses you verified, at most 200 a day, 1 a second.
Amazon SES -> Account dashboard -> **Request production access**:

* Mail type: **Transactional**.
* Website URL: `https://crm.amuwacorporation.com` (or the company website).
* Use case description (adapt as needed):

  > Amuwa Corporation uses Amazon SES for transactional e-mail from its internal CRM and careers portal only: account sign-in and
  > password-reset links, employee welcome e-mails, client onboarding updates, payment requests and invoices (PDF), subscription renewal
  > reminders, HR notices (birthdays, probation, training) and candidate application updates. We send only to our own employees, our
  > clients and job applicants who created an account; we do not buy or rent lists and send no marketing. Expected volume: about
  > 100–1,000 e-mails a day. Bounces and complaints: the SES account-level suppression list is enabled for both, CloudWatch alarms watch
  > the bounce and complaint rates, and the sending application stops e-mailing addresses that bounced. Recipients who no longer want
  > an e-mail type can ask us at meta@amuwa.com.

* Expected answer within 24 hours. If AWS asks questions, answer them in the case; if refused, reply with more detail (it is often granted
  on the second try). When granted, the dashboard shows your daily quota (often 50,000) and rate (often 14 a second).

While in the sandbox you can test by verifying your own address: Identities -> Create identity -> Email address -> click the link e-mailed
to you.

## 6. A sending-only key for the CRM (10 minutes)

IAM -> Users -> Create user: name `crm-ses-sender`, **no** console access. Permissions: "Attach policies directly" -> none; after
creating it, open the user -> Add permissions -> Create inline policy -> JSON, replace `123456789012` with your account id (top-right menu):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendFromAmuwaOnly",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "arn:aws:ses:ap-south-1:123456789012:*",
      "Condition": { "StringLike": { "ses:FromAddress": "*@amuwa.com" } }
    }
  ]
}
```

Name it `crm-send-email-only`. This key can send e-mail from `@amuwa.com` addresses and do nothing else: no reading, no settings, no other
AWS service. If it leaks, the worst case is spam from your domain until you delete it, so keep it only in Cloudflare.

Then: the user -> Security credentials -> **Create access key** -> "Application running outside AWS" -> copy the **Access key ID** and the
**Secret access key** (shown once) straight into Cloudflare (next step). Rotate it yearly: create a second key, update Cloudflare, delete
the old one.

## 7. Settings in Cloudflare (when switching, runbook phase 6)

Worker `ai-crm` -> Settings -> Variables and Secrets:

| Name | Type | Value |
| --- | --- | --- |
| `SES_ACCESS_KEY_ID` | Secret | the access key id |
| `SES_SECRET_ACCESS_KEY` | Secret | the secret access key |
| `SES_REGION` | Text | `ap-south-1` |
| `SES_MAX_PER_SECOND` | Text | your production rate from the SES dashboard, e.g. `14` (default 10) |
| `EMAIL_FROM` | Text | e.g. `Amuwa Corporation <meta@amuwa.com>` (everything without its own sender below) |
| `EMAIL_FROM_AUTH` / `EMAIL_REPLY_TO_AUTH` | Text | optional, e.g. `Amuwa <auth@amuwa.com>` / `support@amuwa.com` (password resets, sign-in links) |
| `EMAIL_FROM_CAREERS` / `EMAIL_REPLY_TO_CAREERS` | Text | optional, e.g. `Amuwa Careers <careers@amuwa.com>` |
| `EMAIL_FROM_CLIENT` / `EMAIL_REPLY_TO_CLIENT` | Text | optional, e.g. `Amuwa <support@amuwa.com>` (onboarding, payments, invoices, renewals, client logins) |
| `EMAIL_FROM_HR` / `EMAIL_REPLY_TO_HR` | Text | optional, e.g. `Amuwa HR <hr@amuwa.com>` |
| `SMTP_SEND_AS` | Text | optional: the addresses above that are "Send mail as" aliases of the Gmail mailbox, comma separated |
| `EMAIL_PROVIDER` | Text | `ses` (last: this switches sending over) |

Keep `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: they are the backup. Any address you send **from** and expect **replies to**
should exist in Google Workspace (a user, group or alias), or set an `EMAIL_REPLY_TO_*` that does.

Then send one of each e-mail type (a staff password reset, a client invoice, a candidate update) and check SES -> Account dashboard ->
sending statistics, and the CRM's delivery logs. Going back is instant: set `EMAIL_PROVIDER` to `smtp`.

## What the CRM does (for reference)

* Sends through the SES API v2 (`https://email.<SES_REGION>.amazonaws.com/v2/email/outbound-emails`), signed with the key above.
  Attachments (invoice PDFs) go with the e-mail. Calls are spaced to `SES_MAX_PER_SECOND`; "too many requests" is waited out once.
* If SES does not accept an e-mail (daily quota reached, sending paused or suspended, key refused, domain or sandbox recipient not
  verified, SES failing), the **same e-mail goes out through the Gmail mailbox at once**, and after a quota answer SES is skipped for 15
  minutes. The backup sends as the original address if it is listed in `SMTP_SEND_AS`, otherwise as `meta@amuwa.com` with the original
  reply-to. Not after a timeout (SES may have sent it: no duplicate) nor for an invalid address or content; those stay queued for a retry.
* `EMAIL_FALLBACK=off` turns the backup off. Code: `server/automations/providers.ts`; tests: `supabase/tests/ses_email.test.ts`.

## Amuwa's actual region and SES as a fallback (migration 20270131000100)

Amuwa's SES identity is verified in **Asia Pacific (Sydney) `ap-southeast-2`**, not the Mumbai region used as the example above: set
`SES_REGION=ap-southeast-2` (now also the default when unset) and read every `ap-south-1` above as `ap-southeast-2` (e.g. the MAIL FROM MX
`feedback-smtp.ap-southeast-2.amazonses.com`). SES is not used as a general provider or fallback until `EMAIL_SES_PRODUCTION_ENABLED=true`, which
is set only after AWS grants production access; Email Management → Email Providers → Amazon SES → Check now reports sandbox or production.
See `docs/EMAIL_MANAGEMENT.md` section 9.
