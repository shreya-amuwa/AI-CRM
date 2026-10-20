---
title: Troubleshooting Login and Access Issues
summary: Diagnostic guide to resolving authentication failures, concurrent session limits, department lockouts, and credential recovery in Amuwa AI CRM.
audience: internal
roles:
  - Super Admin
  - Department Head
  - Team Lead
  - Team Member
related:
  - /getting-started/signing-in
  - /getting-started/account-safety-logout
  - /troubleshooting/missing-records-and-permissions
---

# Troubleshooting Login and Access Issues

Authentication and session problems can disrupt daily operations. This guide details verified solutions for common login errors, concurrent session limits, and account lockouts.

---

## 1. Symptom: "Invalid login credentials"

### Likely Causes
- Typo in corporate email or password.
- Caps Lock is enabled.
- Email contains leading or trailing spaces copied from clipboard.
- Account was provisioned with a temporary password that was subsequently updated.

### Resolution Steps
1. Verify that your email address is typed entirely in lowercase without spaces (e.g., `rahul.sharma@amuwa.com`).
2. Toggle the eye icon in the password field to verify the exact characters entered.
3. If using an initial temporary password from HR or Super Admin, ensure you copy the exact string without whitespace.
4. If still unable to sign in, contact your **Super Admin** or **HR Department** to issue a temporary password reset.

---

## 2. Symptom: "Maximum concurrent sessions reached"

### Likely Causes
Amuwa AI CRM enforces strict concurrent session ceilings per department (typically capped at 2 simultaneous administrative sessions) to prevent credential sharing and maintain audit trail integrity.

### Resolution Steps
1. Verify if you have an active session open in another browser tab, mobile browser, or home workstation.
2. Sign out of any secondary devices using the **Sign Out** button.
3. Contact a teammate currently logged in to your department and request that they sign out if their work is concluded.
4. If an orphaned session remains active after a computer crash, contact **Super Admin** to click **Terminate Stale Sessions** on your department card in the Department Hub.

---

## 3. Symptom: "This department is currently locked"

### Likely Causes
A Super Admin has temporarily toggled the department status to `locked: true` for scheduled system maintenance, data migration, or administrative review.

### Resolution Steps
1. Confirm with your Department Head or Super Admin whether scheduled maintenance is underway.
2. Once maintenance concludes and Super Admin toggles the lock off, refresh your browser page to sign in immediately.

---

## 4. Symptom: Redirected to Login Immediately After Authenticating

### Likely Causes
- Browser cookies or local storage disabled.
- System clock on your device is skewed significantly from network time, causing Supabase Auth JSON Web Tokens (JWT) to appear expired.

### Resolution Steps
1. Enable cookies and local storage for the CRM domain.
2. Ensure your computer system clock is synchronized automatically with internet time.
3. Perform a hard refresh (`Ctrl + F5` on Windows, `Cmd + Shift + R` on macOS) to clear stale cached scripts.
