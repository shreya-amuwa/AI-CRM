---
title: How to Log Client Calendar Activities and Insights
description: Logging deliverables, marketing campaigns, call performance, and meetings directly onto the customer's portal calendar.
order: 40
roles: [Support Team Member, Support Team Lead, Technical Consultant]
audience: internal
status: verified
sources: [docs/CLIENT_DASHBOARD.md, shared/contracts.ts]
related: [support/ticket-inbox-and-chat, client/client-calendar-view]
updated: 2026-10-19
---

To keep clients informed of ongoing service delivery without sending manual email updates, support staff log campaign metrics, posts, and setups directly into the customer's portal calendar.

## Before you start

:::prereq
- The customer must have an active client portal login.
- You must have the performance metrics or deliverable details on hand.
:::

## Steps

1. In the sidebar, navigate to **Client Calendar**.
2. Select the customer from the customer dropdown.
3. Click the **Log an activity** button.
4. Fill in the activity details:
   - **Date**: The date the deliverable occurred (India office time).
   - **Activity Kind**: Select Campaign, Call Campaign, Post, Ad, Setup, Report, Meeting, or Other.
   - **Related Service**: Select the purchased service this activity relates to (e.g. `WhatsApp API` or `Meta Ads`).
   - **Title**: Descriptive headline (e.g. *Diwali Promo Broadcast - 50k Reach*).
   - **Summary**: Concise description of what was accomplished.
5. Add **Key Performance Metrics** (Key / Value pairs):
   - Example 1: `Messages Sent` -> `52,400`
   - Example 2: `Delivery Rate` -> `98.2%`
   - Example 3: `Inquiries Generated` -> `412`
6. Click **Save Activity**.

```flow
Log Activity | Support Staff | Client Calendar > Log an activity
Enter Metrics | Support Staff | Headline, date, summary, and KPI tiles
Save Entry | Database RPC | Appends to customer calendar records
Client Notification | Realtime | Bell alert & calendar tile render for client
```

## What you should see

:::result
The activity renders on the internal calendar and immediately appears on the client's own portal calendar. The customer can click the date to view the headline and KPI tiles.
:::

## Good to know

:::tip System Events vs Staff Activities
The client calendar automatically merges your manual activities with automated system milestones (such as invoice issuance, invoice payment, ticket resolutions, and document verifications).
:::

:::note Editing Past Entries
You can edit or delete an activity you created at any time by clicking the activity tile and selecting **Edit**.
:::

## If something goes wrong

If a customer does not appear in the customer dropdown, verify that the customer has reached active status and has a provisioned client account.
