---
title: Signing In and Account Approval
description: Step-by-step instructions for signing in to the internal CRM, requesting a new staff account, and understanding Pending Approval and Inactive states.
order: 20
group: Core Onboarding
roles: [All Roles]
audience: internal
status: verified
sources: [src/components/auth/LoginForm.tsx, src/context/AuthContext.tsx, shared/contracts.ts]
related: [/getting-started/welcome-to-amuwa-crm, /getting-started/understanding-your-role-and-dashboard, /troubleshooting/login-and-access-issues]
updated: 2026-10-27
---

Amuwa AI CRM uses role-based authentication backed by Supabase Auth. Depending on whether your manager created your profile directly or you submitted an account request, your account must be in `ACTIVE` status before your dashboard opens.

## Before you start

:::prereq
- Use your official work email address (for example, `name@amuwa.com`) and password.
- Internal staff must sign in at the main CRM login page (`https://ai-crm-drab.vercel.app/`).
- External customers must sign in at `/client/login` — staff credentials will not work on the client login form, and client credentials will not work on the staff login form.
:::

## How to sign in (Internal Staff)

1. Open the Amuwa AI CRM login screen in your browser.
2. Fill in the **Sign In** form fields:
   - **Email** (`EMAIL ADDRESS`): Enter your registered work email address.
   - **Password** (`PASSWORD`): Enter your password. Click the eye icon on the right side of the field to verify your typing.
3. Optional: Keep **Remember me** checked on your assigned company workstation.
4. Click **Sign In**.

```flow
Enter Email & Password | Staff Member | Staff Login Screen (/login)
Verify Account Status | Auth Service | Checks profile status (ACTIVE, PENDING_APPROVAL, SUSPENDED, INACTIVE)
-> Status is PENDING_APPROVAL | Pending Approval Screen | Hold screen shown until Super Admin, HR, or Department Head approves
-> Status is INACTIVE / SUSPENDED | Access Blocked | Displays account deactivation or suspension notice
Route to Role Dashboard | Role Router | Opens default dashboard mapped in src/lib/auth/roleMapping.ts
```

## How to request a new staff account

If your account has not yet been provisioned by a Super Admin, HR manager, or Department Head, you can submit an account registration request from the login screen:

1. On the login card, switch to the **Request Account** / **Create Account** view.
2. Complete all required registration fields:
   - **Full Name** (`TEAM MEMBER'S NAME`): Your full legal/display name (for example, `Kunal Sharma`).
   - **Phone Number**: Your 10-digit mobile number for internal directory and contact verification.
   - **Department** (`SELECT DEPARTMENT`): Select your assigned business unit (such as `Wabastore`, `Whatsbox`, `Wabastar`, `D Talk`, `Digitree Infotech`, `Amuwa Design Studio`, `AI Studio`, `Accounts`, or `HR`).
   - **Division / Role**: Select **Sales** or **Support** where applicable to preview your target dashboard.
   - **Work Email** (`EMAIL ADDRESS`): Your corporate email address.
   - **Password**: Must be at least 10 characters long.
   - **Confirm Password**: Retype the exact same password to confirm.
3. Submit the registration form.

## Understanding account statuses after sign-in

### 1. Pending Approval (`PENDING_APPROVAL` / `PENDING`)
When a new staff account is requested, it is placed in `PENDING_APPROVAL` (`PENDING`) status to protect company and customer data.
- If you sign in while your account is still awaiting review, you will see the **Pending Approval** screen (`Registration Request Submitted! / PENDING AUTHORIZATION`).
- A **Super Admin**, **HR**, or your **Department Head** must approve your profile from **Team Members** (or **HR Directory > Pending Approval**) and confirm your department, division, team, and role.
- Once approved, refresh or sign in again to enter your workspace immediately.

### 2. Inactive, Suspended, or Revoked (`INACTIVE` / `SUSPENDED` / `REVOKED`)
If an administrator or HR marks your profile as **Left / Inactive**, **Suspended**, or **Revoked**:
- The system blocks dashboard routing and displays an account status notice on the login card.
- Any active browser sessions are immediately terminated.
- Contact your Department Head or the HR department if you believe your account was deactivated in error.

## External Client Portal sign-in (`/client/login`)

External customers use a dedicated login screen at `/client/login` after their Client Portal login is provisioned during onboarding.

- Clients enter their registered **Email** and **Password** and click **Sign in**.
- If a client forgets their password or is signing in for the first time without a temporary password, they click **Forgot password?**, enter their email, and click **Send me the link** to set a new password at `/client/set-password`.

## What you should see

:::result
Once your staff credentials are authenticated and your profile status is `ACTIVE`, you are redirected straight to your role-specific dashboard (or the **Choose a department for this session** modal if you are a Department Head managing multiple departments).
:::

## Good to know

:::important Password Length & Complexity
New staff account passwords must be at least **10 characters** long. Never share your password with other team members—every action in the CRM is logged under your individual profile ID.
:::

## If something goes wrong

- **"Invalid login credentials"**: Check for typos in your email address and confirm whether Caps Lock is enabled.
- **Stuck on Pending Approval**: Ask your Department Head, HR, or Super Admin to approve your account under **Team Members** or **HR > Staff Directory > Pending Approval**.
- See [Troubleshooting Login and Access Issues](/troubleshooting/login-and-access-issues) for complete recovery steps.
