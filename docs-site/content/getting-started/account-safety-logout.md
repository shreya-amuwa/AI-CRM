---
title: Account Safety and Signing Out
description: Best practices for credential protection, session eviction, and properly terminating employee sessions.
order: 60
roles: [Super Admin, Department Head, Sales Team Member, Support Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [src/components/layout/Header.tsx, src/services/sessionManager.ts, src/context/AuthContext.tsx]
related: [getting-started/signing-in, troubleshooting/login-and-access-issues]
updated: 2026-10-19
---

Maintaining account safety protects customer records, private transaction ledgers, and company compliance.

## Before you start

:::prereq
- Ensure any open forms (such as new lead creation, payment recording, or document review) are saved before signing out.
:::

## Steps to sign out

1. Locate your user avatar in the top right corner of the navigation header.
2. Click the **Sign Out** icon (door with exit arrow) located next to your profile badge.
3. The application securely invalidates your Supabase authentication token and clears your cached session state.
4. You are immediately returned to the login screen (`/login`).

## Session management rules

### 1. Concurrent session cap
Each departmental user account is restricted to a maximum of **2 active sessions**. The active session counter in the header (`Active Sessions: x/2`) displays live concurrency.

### 2. Session eviction
If you sign in on a new device when your account already has the maximum concurrent sessions, the oldest active session is automatically evicted. The displaced device displays:
`"Your session has ended because this account was accessed from another device."`

### 3. Password safety rules
- Never share your corporate login or password with colleagues. Each staff member must have an individually attributed account to maintain audit log integrity.
- Never write down credentials or leave unattended workstations unlocked.

## What you should see

:::result
When successfully signed out, local storage tokens are purged and any attempt to navigate back using browser history redirects to `/login`.
:::

## Good to know

:::warning Audit Log Tracking
Every login, document view, payment recording, and customer update is recorded in the immutable `audit_logs` table with your user ID and IP address.
:::

## If something goes wrong

If you receive unexpected session eviction alerts while working on a single device, review [Troubleshooting Login Issues](/troubleshooting/login-and-access-issues).
