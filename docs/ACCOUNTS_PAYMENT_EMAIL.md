# Emails to the Accounts payment desk

When Sales or the Technical Consultant sends a request that needs Accounts, the person who handles it gets an **email**
in addition to the bell notification inside the CRM:

| Request | Sent by |
| --- | --- |
| A customer is sent for payment confirmation | Sales |
| A payment is recorded and waits for verification | Sales |
| Add-on services are sent to Accounts for verification | Technical Consultant |

The email says what was sent, the customer (name, company, phone, e-mail), who sent it and, when the CRM's address is
configured, has a link that opens the request.

## Who gets it: exactly one person

1. The accountant already **assigned** to the customer (`customers.accounts_owner_id`), if that person is active.
2. Otherwise the **payment desk** person: the active Accounts person with the lowest `profiles.payment_desk_order`;
   if nobody has a number, the longest-serving active Accounts person.

Today there is one Accounts person, so that person gets every email. When the team grows, make one person the desk by
running this in the Supabase SQL editor (use their email), and only they are emailed for requests with no assigned accountant:

```sql
update public.profiles set payment_desk_order = 1 where email = 'accountant@amuwa.com';
```

Everyone in Accounts still gets the bell notification.

## Setup

It uses the same email sender as the customer emails (`AUTOMATION_MODE=live`, `EMAIL_PROVIDER` + `SMTP_*` /
`EMAIL_API_KEY`: see `docs/ONBOARDING_AUTOMATIONS.md`). One extra setting is optional:

| Variable | Value |
| --- | --- |
| `APP_URL` | The CRM's web address, for example `https://crm.amuwa.com`, so the email has an "Open it in the CRM" link. Without it the link is left out (on Vercel the production domain is used when it is available). |

- It is an internal email: the test-recipient list (`AUTOMATION_TEST_RECIPIENTS`) does not apply, and nothing is shown on the customer's page.
- In `dry_run` mode it is prepared and logged but not sent. A failed send is retried after 1, 5, 15 and 60 minutes; after that Accounts gets a bell notification.
- Run `supabase/migrations/20261017000100_accounts_payment_email.sql`, then redeploy.
