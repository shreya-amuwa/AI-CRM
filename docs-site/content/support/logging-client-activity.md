---
title: Logging Client Calendar Activities and Touchpoints
description: Recording campaign metrics, deliverables, calls, and service milestones on the Client calendar so clients can track progress on their portal.
order: 4
group: Support Operations
roles: [Support Team Member, Support Team Lead, Technical Consultant, Department Head]
audience: internal
status: verified
sources: [src/components/client-portal/ClientActivityManager.tsx, src/components/support-member/SupportMemberDashboard.tsx, shared/contracts.ts]
related: [support/ticket-inbox-and-chat, client/client-calendar-view, delivery/managing-delivery-queue]
updated: 2026-10-27
---

To keep customers informed of ongoing service work without manual status emails, Support and Delivery staff log campaigns, monthly deliverables, setups, and review meetings directly in **Client calendar** (`ClientActivityManager.tsx`).

## Before you start

:::prereq
- Sign in to the Support Dashboard and locate **Client calendar** in the sidebar (`Overview`, `My Leads`, `Team Leads`, `Import Customers`, `Client tickets`, `Client calendar`, `Client documents`, `My Tasks` / `Assigned Tasks`, `Leave Request`, `Chat`, `My Profile`).
- The customer must be an active client (`stage: 'CLIENT'`).
:::

## Steps to log a client calendar activity or touchpoint

1. In the Support Dashboard sidebar, click **Client calendar**.
2. Select the client from the **Customer** selector at the top.
3. Click **Log an activity** (or click directly on a date cell in the calendar grid).
4. Complete the activity details:
   - **Date**: Date the deliverable, campaign, or touchpoint occurred (India Standard Time).
   - **Activity Kind**: Choose `Campaign`, `Call Campaign`, `Post`, `Ad`, `Setup`, `Report`, `Meeting`, or `Other`.
   - **Related Service**: Select which purchased service the activity belongs to (for example, `Wabastore`, `Whatsbox`, `AI Calling`, or `Amuwa Design Studio`).
   - **Title**: Write a clear, client-facing headline (for example, *Festive WhatsApp Broadcast — 50,000 Recipients*).
   - **Summary**: Provide a concise summary of the work completed or outcomes achieved.
5. Add **Key Performance Metrics** (optional key/value KPI tiles shown to the client):
   - `Messages Sent` -> `52,400`
   - `Delivery Rate` -> `98.2%`
   - `Leads / Replies` -> `412`
6. Click **Save Activity**.

```flow
Open Client Calendar | Support Staff | Support Dashboard > Client calendar
Select Active Client | Support Staff | Pick customer from dropdown & click Log an activity
Enter Deliverable & KPIs | Support Staff | Choose Activity Kind, Service, Title, Summary & KPI tiles
Save Activity | System | Stores entry and publishes to Client Portal calendar in real time
```

## What you should see

:::result
The logged touchpoint appears on the internal **Client calendar** grid and is immediately visible to the customer when they sign in to their **Client Portal > Calendar** view, complete with KPI tiles and service badges.
:::

## Good to know

:::tip Unified Timeline of Staff Activities and System Events
The **Client calendar** automatically combines manual staff entries (campaigns, posts, review calls) with automated system milestones (invoice issued, payment verified, document verified, ticket resolved).
:::

:::note Editing or Removing Entries
Click any manual activity tile you created on **Client calendar** and select **Edit** or **Delete** to update figures or fix a date.
:::

## If something goes wrong

- **Customer does not appear in the Client calendar dropdown**: Confirm that the customer has completed onboarding (`stage: 'CLIENT'`) or was imported via **Import Customers**.
