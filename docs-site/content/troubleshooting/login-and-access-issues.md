---
title: Troubleshooting Login and Account Issues
description: Diagnose and resolve authentication failures, concurrent session limits, department lockouts, and password recovery issues across Amuwa AI CRM.
order: 1
group: Access & Visibility
roles: [Super Admin, Department Head, Team Lead, Team Member, Telecaller, Business Associate, Technical Consultant, Accounts, HR]
audience: internal
status: verified
sources: [src/components/Login.tsx, src/client/Login.tsx, src/client/SetPassword.tsx, server/index.ts]
related:
  - /getting-started/signing-in
  - /getting-started/account-safety-logout
  - /troubleshooting/missing-records-and-permissions
updated: 2026-10-27
---

Authentication and session issues can prevent staff or clients from accessing their workspaces. Use the diagnostic steps below to identify the symptom, verify the cause, and restore access quickly.

## Before you start

:::prereq
- Confirm whether the affected user is a **staff member** signing in at the main CRM login screen (`/`) or an **external client** signing in at `/client/login`.
- Check the exact error banner text shown on the login card.
:::

## 1. Symptom: "Invalid login credentials" or "Email or password is incorrect"

### Likely causes

- The user entered a typo in their email address or password, or `kbd:CapsLock` is enabled.
- Trailing or leading spaces were pasted along with the email address or temporary password.
- An external client is attempting to sign in on the internal staff login page (`/`), or a staff member is attempting to sign in on `/client/login`.
- The user's password was recently reset by a Super Admin or HR team member.

### Step-by-step resolution

1. Confirm the user is on the right URL:
   - **Internal Staff**: `/` (Main CRM login screen).
   - **External Clients**: `/client/login` (Client Dashboard login screen).
2. Type the email address in lowercase with no leading or trailing spaces.
3. Click the password visibility toggle (eye icon) to inspect the typed password characters before submitting.
4. **For Clients**: Click **Forgot password?** on `/client/login`, enter the registered email, click **Send me the link**, and set a new password at `/client/set-password`.
5. **For Staff**: Ask a **Super Admin** or **HR** administrator to reset the staff account password from the staff management panel.

## 2. Symptom: "Maximum concurrent sessions reached" or unexpected session eviction

### Likely causes

- The user or department has reached its active concurrent session limit because another browser window, home computer, or mobile device is still signed in.
- A browser crash closed the window without running the **Sign Out** cleanup, leaving an active server session until its heartbeat expires.

### Step-by-step resolution

1. Sign out of any secondary browser tabs, laptops, or mobile browsers where the account is still open.
2. Always use the **Sign Out** button in the sidebar when finishing work rather than closing the browser tab directly.
3. If an orphaned session blocks login after a crash, ask a **Super Admin** to open the **Department Hub** and clear stale sessions for that department or user.

## 3. Symptom: "This department is currently locked"

### Likely causes

- A **Super Admin** has locked the department card in the **Department Hub** (`locked: true`) during scheduled maintenance, audit review, or roster restructuring.

### Step-by-step resolution

1. Check with your **Department Head** or **Super Admin** to confirm whether maintenance is in progress.
2. Once the **Super Admin** unlocks the department in the **Department Hub**, refresh the browser page and sign in again.

## 4. Symptom: Immediate redirect back to Login after signing in

### Likely causes

- Browser local storage or cookies are blocked for the CRM domain.
- The workstation's system clock is skewed by several minutes from network time, causing authentication tokens (JWTs) to be treated as expired immediately.

### Step-by-step resolution

1. Enable cookies and site storage for the CRM domain in your browser privacy settings.
2. Open your operating system's **Date & Time** settings and turn on **Set time automatically** to synchronize with internet time.
3. Press `kbd:Ctrl+F5` to clear cached scripts and sign in again.

## Expected result

:::result
- After applying the matching resolution, the user signs in cleanly and lands on their role-appropriate workspace (`Sales`, `Support`, `Accounts`, `HR`, `Technical Consultant`, `Telecaller`, `Business Associate`, or `/client` for clients) with an active session heartbeat.
:::

## When to escalate

If the user still cannot sign in after completing the steps above, escalate to a **Super Admin** with:

- The user's exact **email address** and **role / department**.
- Which login path was used (`/` vs `/client/login`).
- A screenshot of the error message and the exact timestamp of the failed attempt.
