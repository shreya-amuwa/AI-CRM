---
title: Managing Your Monthly Plans
description: View your active monthly subscriptions, browse published plans from Amuwa, request to choose or switch plans, or cancel a pending request.
order: 3
group: Services & Plans
roles: [Client]
audience: client
status: verified
sources: [src/client/MonthlyPlans.tsx]
related:
  - /client/viewing-services-usage
  - /client/exploring-services
  - /client/invoices-and-receipts
  - /client/chatting-with-your-team
updated: 2026-10-27
---

The **Monthly Plans** page lets you review your active recurring subscriptions, explore available monthly plans published by Amuwa, and request a new plan or plan switch without waiting on back-and-forth emails.

## Before you start

:::prereq
- You are signed in to your Client Dashboard at `/client/login`.
:::

## Viewing your active subscriptions

1. Click **Monthly Plans** in the left navigation menu.
2. If your business has an active recurring subscription, the top section displays your current plan card with:
   - **Current plan**: The name and summary of your active monthly plan.
   - **Monthly price**: Your recurring monthly rate (and whether GST is included or added).
   - **Started**: The date your subscription became active.
   - **Next renewal**: The next scheduled billing or renewal date.
   - Included features and deliverables covered under the plan.

## Browsing available plans and requesting a plan

Below your current subscription, you can browse the catalog of monthly plans published by Amuwa:

1. Review the plan cards to compare the monthly price, billing cycle, and included features.
2. Click **Choose this plan** (if you do not currently have an active plan in that category) or **Switch to this plan** (if you are moving from an existing plan).
3. In the request dialog, add any optional notes or timing preferences for your account team.
4. Submit your request.

```flow
Browse Monthly Plans | Client | Review published plan features and monthly price
Click Choose this plan / Switch to this plan | Client | Add optional notes and submit request
Account Team Reviews Request | Account Team | Status moves from Waiting for confirmation to Confirmed - payment pending
Plan Activated | Account Team | Status becomes Active and appears under your current subscriptions
```

## Tracking and cancelling plan requests

All submitted requests appear in the **Your Plan Requests** section with one of four status badges:

| Status Badge | What It Means |
| :--- | :--- |
| **Waiting for confirmation** | Your request has been sent to your account team and is awaiting review. |
| **Confirmed — payment pending** | Your account team has confirmed the plan; it will activate once payment is completed. |
| **Active** | The plan is now live on your account. |
| **Declined** | The request was not applied (check the note on the request or message your team in [Chat with Team](/client/chatting-with-your-team)). |

### Cancelling a pending request

If you change your mind while a request is still marked **Waiting for confirmation**:

1. Locate the request under **Your Plan Requests**.
2. Click **Cancel request** and confirm.
3. The pending request is withdrawn immediately.

## What you should see

:::result
- Your request appears immediately under **Your Plan Requests** with the status **Waiting for confirmation**.
- Once your account team confirms the plan and payment is recorded, your subscription card updates to **Active** and any issued invoice appears in [Invoices & Payments](/client/invoices-and-receipts).
:::
