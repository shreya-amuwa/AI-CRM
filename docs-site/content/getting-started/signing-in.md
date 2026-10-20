---
title: How to Sign In to Amuwa AI CRM
description: Learn how to sign in securely, switch between Sign In and Registration, and resolve access notices.
order: 20
roles: [Super Admin, Department Head, Sales Team Member, Support Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [src/components/auth/LoginForm.tsx, src/context/AuthContext.tsx]
related: [getting-started/roles-and-permissions, getting-started/account-safety-logout]
updated: 2026-10-19
---

Amuwa AI CRM uses Supabase Authentication to verify your identity and automatically navigate you to your designated departmental dashboard.

## Before you start

:::prereq
- You must have an approved email address and password provided by your Department Head or created via the sign-up form.
- External clients do not use this screen; they must sign in at `/client/login`.
:::

## Steps

1. Open the CRM login URL in your web browser.
2. In the **EMAIL ADDRESS** field, enter your corporate email address (for example `name@example.com`).
3. In the **PASSWORD** field, type your account password. Click the Eye icon to confirm you typed it correctly.
4. Keep **Remember me on this device** checked if you are on an authorized workstation.
5. Click **Sign In**.

```flow
Enter Credentials | Employee | Login Screen (/login)
Authenticate | Supabase Auth | Validates password & fetches profile
-> Wrong Password | Displays "Invalid login credentials"
-> Account Pending | Displays "Pending approval from Department Head"
Redirect to Dashboard | System Router | Automatically opens your role dashboard
```

## What you should see

:::result
Upon successful authentication, the system evaluates your assigned role and team division, redirecting you immediately to your primary dashboard:
- **Sales Team Member**: Opens `/team-member/dashboard/:id` (My Leads)
- **Support Team Member**: Opens `/support-member/dashboard/:id` (Tickets & Tasks)
- **Accounts Staff**: Opens `/accounts/dashboard/:id` (Confirmation Queue)
- **Technical Consultant**: Opens `/technical-support/dashboard` (Onboarding Customers)
- **Department Head**: Opens your department's leadership dashboard
- **Super Admin**: Opens the centralized Department Hub
:::

## Good to know

:::important Account Approval Requirement
If you used the **Create an account** form to register, your account remains in `PENDING` status until your Department Head or a Super Admin approves your registration. You cannot sign in until approval is granted.
:::

:::note Single Active Session Protection
To maintain data security, signing into your account on a second device or browser will prompt a session eviction notice on your previous device.
:::

## If something goes wrong

- **Invalid login credentials**: Verify your email spelling and retype your password. Passwords are case-sensitive.
- **Account Deactivated or Revoked**: Contact your Department Head or HR department to check your account status.
- For additional scenarios, see [Troubleshooting Login and Access](/troubleshooting/login-and-access-issues).
