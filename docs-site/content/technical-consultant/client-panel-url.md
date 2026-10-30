---
title: How to save and send the Client Panel URL
description: Record the address where a customer signs in to the panel of a WhatsApp service, check that it is safe, and e-mail it to the customer once.
order: 40
group: Verification
roles: [Meta Verifier, Technical Consultant, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/ACCOUNTS_FINANCE_AND_WORKFLOW.md, shared/panelUrl.ts, supabase/migrations/20261209000500_client_panel_url.sql, src/components/support/consultant/ClientLoginDetails.tsx]
related: [technical-consultant/verifying-checklist-items, accounts/client-logins]
updated: 2026-10-29
---

The **Client panel URL** sits in **Client login details**, under each WhatsApp service of the customer, next to the account / user ID. It is the address where the customer signs in to that panel. It belongs to one customer and one service.

## Before you start

:::prereq
- You can edit the customer's panel details (the Meta Verifier of the customer's route, the Department Head of the customer's department, or the Super Admin).
- The customer has an e-mail address on the record. The link is sent there.
:::

## Steps

1. Open the customer and go to **Client login details**.
2. Under the service, type the sign-in address in **Client panel URL** and click **Save the URL**.
3. Click **E-mail the panel link** when you are ready for the customer to receive it.

The page checks the address as you type. It must start with `https://`, use a real public web address, and carry no user name, password, key or token. The server and the database apply the same rules.

## What you should see

:::result
Saving the URL sends nothing; the box says so. After you click **E-mail the panel link** the box shows the e-mail as *waiting to be sent*, then *sent* with the time and the recipient. If the e-mail fails, the reason is shown and **Try sending again** is offered.
:::

## When is the customer e-mailed again?

- The same link to the same customer and service is sent **once**. A double click, a retry or a repeated request sends nothing more.
- If you **change** the URL, the box says *URL changed since it was sent* and offers **E-mail the new link**. Changing the URL never sends by itself.
- You can send the same link again on purpose with **Send again**.
- The panel password is a separate action and is never in this e-mail. The customer signs in with the password already shared with them.

The customer's *Status Completed* e-mail and WhatsApp message use this URL when it is saved (otherwise the department's sign-in page).

## If something goes wrong

- **"The panel URL must start with https://"**: type the full address including `https://`.
- **"must not carry a password, key or token"**: enter the plain sign-in page, not a link that logs the customer in.
- **"The customer has no valid e-mail address on the record"**: ask Accounts to correct the customer's e-mail, then send again.
