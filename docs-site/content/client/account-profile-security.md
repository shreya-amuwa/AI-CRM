---
title: Account Profile, Password Reset, and Security
description: Understand how your business profile details are maintained, how to reset your password from the sign-in screen, and how to sign out safely.
order: 10
group: Getting Started
roles: [Client]
audience: client
status: verified
sources: [src/client/Login.tsx, src/client/SetPassword.tsx, src/client/ClientApp.tsx]
related:
  - /client/welcome-client-portal
  - /client/chatting-with-your-team
  - /client/raising-support-tickets
  - /client/invoices-and-receipts
updated: 2026-10-27
---

Your Client Dashboard account is linked to your verified business record so that all GST invoices, compliance documents, and service configurations stay consistent and secure.

## Before you start

:::prereq
- You have a registered email address for your Client Dashboard at `/client/login`.
:::

## Updating your business profile or contact details

Your business name, GSTIN, billing address, and primary contact information are maintained by your Amuwa account team to ensure your official GST invoices and verified service registrations remain accurate.

:::important How to request a profile or billing address update
Business profile fields are not edited self-service inside the dashboard. If your company address, GST number, contact phone number, or primary contact person changes, message your team in [Chat with Team](/client/chatting-with-your-team) or submit a request in [Support Tickets](/client/raising-support-tickets) so our team can update your verified account record.
:::

## Resetting or changing your password

Whenever you need to set a new password — whether you forgot your password or want to rotate it for security — use the password reset flow on the sign-in screen:

```flow
Open /client/login | Client | Sign out if currently signed in, then open /client/login
Click Forgot password? | Client | Enter your registered account Email
Click Send me the link | Client | Check your email inbox for the reset link from Amuwa
Open /client/set-password | Client | Enter and confirm your new password (at least 8 characters) to sign in
```

1. If you are currently signed in, click **Sign out** in the left navigation menu to return to `/client/login`.
2. On `/client/login`, click **Forgot password?**.
3. Enter your registered **Email** address and click **Send me the link**.
4. Open the password reset email sent to your inbox and click the secure link, which opens `/client/set-password`.
5. Enter your new password (at least 8 characters), confirm it, and save to sign in with your updated password.

## Signing out safely

When using a shared computer or finishing your session:

1. Click **Sign out** at the bottom of the left navigation sidebar (or in the mobile menu drawer).
2. Your session closes immediately and you are returned to `/client/login`.

## What you should see

:::result
- After completing `/client/set-password`, your new password takes effect immediately and your previous password is no longer valid.
- Clicking **Sign out** clears your active browser session so no one else on the device can view your dashboard.
:::
