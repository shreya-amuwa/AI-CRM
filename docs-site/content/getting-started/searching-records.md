---
title: Searching and Filtering Records
description: Master global search shortcuts, status filters, and service facets to find any customer or lead.
order: 50
roles: [Super Admin, Department Head, Sales Team Member, Support Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadsView.tsx, src/components/team-member/pipeline/shared.tsx]
related: [getting-started/navigation-and-layout, sales/my-leads-overview]
updated: 2026-10-19
---

Amuwa AI CRM features server-side debounced search and multi-criteria filtering across all customer tables.

## Before you start

:::prereq
- You must be signed in and view any queue (such as **My Leads**, **Potential**, **Accounts Confirmation**, or **Tickets**).
:::

## Steps

1. To quickly focus the search bar from anywhere on the page, press `kbd:Ctrl+K` (or `kbd:Cmd+K` on macOS).
2. Type at least two characters of the customer name, phone number, company name, city, or email.
3. The table automatically debounces your keystrokes and queries the database.
4. Refine results using the dropdown filters:
   - **Service filter**: Select a specific service code (for example `WABA_SETUP` or `META_ADS`).
   - **Lead source**: Filter by origin channel (WhatsApp, Meta Ads, Telecaller, Website, etc.).
   - **Follow-up filter**: Select `Due today`, `Overdue`, `Due this week`, or `No follow-up set`.
5. Switch status tabs above the table to restrict results (for example `New`, `Contacted`, `Returned from Accounts`).

## What you should see

:::result
The table updates instantaneously, showing matching rows with live counts. Clicking any customer row opens the customer detail card.
:::

## Good to know

:::tip Quick Row Click
Clicking anywhere on a customer row opens the full record. You do not need to click precisely on the **Edit** or **View** button.
:::

:::note Phone Number Search
You can search by partial mobile numbers (e.g. typing the last 4 digits) to quickly find customers calling in.
:::

## If something goes wrong

If an existing record does not appear when searching, verify that your status tab is set to `All` and check [Troubleshooting Missing Records](/troubleshooting/missing-records-and-permissions).
