---
title: Viewing Your Services, Usage, and Campaigns
description: Monitor your active and setting-up services, check usage balances and low-balance alerts, inspect campaign metrics, and request renewals.
order: 2
group: Services & Plans
roles: [Client]
audience: client
status: verified
sources: [src/client/MyServices.tsx, src/client/Campaigns.tsx]
related:
  - /client/welcome-client-portal
  - /client/managing-monthly-plans
  - /client/exploring-services
  - /client/raising-support-tickets
updated: 2026-10-27
---

The **My Services** page gives you a clear view of every service your business has with Amuwa, including setup progress, remaining usage balances, campaign performance, and renewal dates.

## Before you start

:::prereq
- You are signed in to your Client Dashboard at `/client/login`.
- You have at least one active or onboarding service on your account.
:::

## Reviewing your My Services summary and cards

1. Click **My Services** in the left navigation menu.
2. At the top of the page, review the three summary counters:
   - **Active**: Services that are live and running for your business.
   - **Setting up**: Services currently being configured by your account team.
   - **Renewal soon**: Active services approaching their renewal date.
3. Below the summary, each service card displays its current status badge:
   - **Active**: Live and operational.
   - **Setting up**: Currently in onboarding or technical configuration.
   - **Renewal due**: Approaching or past the scheduled renewal date.
   - **Paused**: Temporarily paused.
4. From any service card, you can use the quick actions:
   - **Open service workspace**: Opens the detailed view for that service.
   - **Ask a question**: Opens a support ticket pre-linked to that service.
   - **Request renewal**: Sends a renewal request for that service to your account team.

## Inside a service workspace

Click **Open service workspace** on any service card to inspect its three tabs:

### 1. Usage & stats

- Displays your total allowance, amount used, and remaining balance for credit- or quota-based services (such as WhatsApp messaging or voice call packages).
- Shows recent activity and usage trends recorded for the service.

:::warning Low-balance alert banner
When your remaining balance drops to **15% or less** of your limit, an amber low-balance alert banner appears at the top of the workspace. Click **Ask to top up** in the banner to notify your account team that you need additional credits.
:::

### 2. Campaigns

If your service includes broadcast or outreach campaigns, the **Campaigns** tab lists every campaign linked to that service along with its status badge:

- **Draft**: Campaign is being prepared and has not been scheduled yet.
- **Scheduled**: Queued to run at the scheduled start time.
- **Running**: Currently sending messages or calls.
- **Completed**: Finished execution.
- **Paused**: Temporarily halted.

Each campaign card reports seven performance metrics:

| Metric | Meaning |
| :--- | :--- |
| **Targeted** | Total audience contacts targeted in the campaign. |
| **Sent** | Messages or calls dispatched. |
| **Delivered** | Successfully delivered to recipients. |
| **Read / answered** | Messages read or voice calls answered by recipients. |
| **Replies / leads** | Customer replies or interested leads generated. |
| **Failed** | Undelivered attempts (for example, invalid or unreachable numbers). |
| **Cost** | Usage credits or cost consumed by the campaign. |

### 3. Service info

- Displays your service start date, renewal or expiry date, billing cycle, and configuration notes shared by your team.

## What you should see

:::result
- Every service appears with a clear status badge (**Active**, **Setting up**, **Renewal due**, or **Paused**) and up-to-date usage and campaign numbers.
- Clicking **Ask to top up**, **Ask a question**, or **Request renewal** immediately sends your request to your account team.
:::
