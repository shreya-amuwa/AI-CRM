---
title: How to create a client dashboard login
description: Creating the Client Dashboard login from Accounts, choosing between the set-password link and a temporary password, sending the e-mail again, and how it differs from the WhatsApp panel login.
order: 35
group: Payments
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/CREDENTIALS_AND_NOTIFICATIONS.md, src/components/accounts/ClientLogins.tsx, src/client/SetPassword.tsx, server/services/PipelineService.ts, supabase/migrations/20261208000300_client_credentials.sql]
related: [accounts/recording-payments, technical-consultant/provisioning-client-login]
updated: 2026-10-29
---

Once a payment is verified, Accounts creates the customer's **Client Dashboard** login from **Accounts > Client Logins**. It is created with the e-mail on the customer record - you never type an e-mail or a password.

## Before you start

:::prereq
- You are in the Accounts department.
- A payment for the customer is verified.
- The customer record has a valid e-mail. If not, use **Correct e-mail** (a reason is required and the change is audited).
:::

## Steps

1. Open **Accounts > Client Logins** and find the customer (**To create**).
2. Click **Create login**.
3. Choose how the client gets in:
   - **Set-password link** (recommended): the client receives an e-mail with a one-time link and chooses their own password. No password is sent.
   - **Temporary password**: the server makes a random password and e-mails it once; you never see it. The client must choose their own password the first time they sign in.
4. Click **Create login**. The row shows **Created**, who made it and when, and the state of the e-mail and the WhatsApp message.

## What you should see

:::result
The status is **Created**. With a temporary password the row says "Temporary password sent - the client has not chosen their own yet" until the client replaces it. A failed e-mail shows its reason.
:::

## Good to know

- **Send e-mail again** sends the set-password link to a client who has chosen their own password (it never resets an existing password). If the client has not yet replaced a temporary password, it makes a **new** temporary password and the earlier one stops working.
- A second click never makes a second login; a half-made login is finished by the retry.
- This is the **Client Dashboard** login. The password of the customer's **WhatsApp panel** is set by the Meta Verifier under **Client login details** and e-mailed to the customer separately; the e-mail says which login it is.
- Temporary passwords and panel passwords need `AUTOMATION_SECRET_KEY` on the server. They are encrypted, kept only on the one e-mail and erased when it is sent. An e-mail still carries a password - the set-password link is safer.

## If something goes wrong

If an e-mail could not be sent, the row shows why (for example the customer's mailbox refused it). Fix the cause, then click **Send e-mail again**. See [Login and access issues](/troubleshooting/login-and-access-issues/).
