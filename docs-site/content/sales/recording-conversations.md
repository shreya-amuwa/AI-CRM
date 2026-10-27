---
title: Logging Conversations, Status Transitions, and Follow-ups
description: Maintain detailed customer interaction logs, update lead qualification statuses, and schedule next follow-up reminders.
order: 3
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Business Associate, Department Head]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadConversations.tsx, src/components/team-member/pipeline/LeadForms.tsx]
related: [sales/creating-a-lead, sales/moving-to-potential]
updated: 2026-10-27
---

Consistent documentation of phone calls, demos, field visits, and WhatsApp discussions ensures complete context is preserved across Sales, Accounts, Technical Consultants, and Delivery teams.

## Before you start

:::prereq
- Open an existing lead or customer record from **My Leads** (`1 Leads`, `2 Potential`, or `3 Customer onboarding`).
:::

## Steps to log a conversation and schedule a follow-up

1. In **My Leads**, click on the customer row to open the customer detail drawer or workspace.
2. Locate the **Conversations** section (`LeadConversations.tsx`) below the customer summary.
3. In the note text area, enter a clear summary of your latest interaction:
   - Customer pain points, product questions, or pricing discussions.
   - Agreed next steps, demo dates, or promised quotation details.
4. Click **Add conversation**.
5. To update the prospect's qualification state or follow-up reminder:
   - Click **Edit** on the lead record.
   - Update **Status** (`NEW`, `CONTACTED`, `INTERESTED`, `READY_TO_BUY`, or `LOST`).
   - Update the **Next follow-up** date and time picker (`nextFollowUpAt`).
   - Click **Save**.

```flow
Open Customer Record | Salesperson | My Leads > Click customer row
Log Interaction Note | Salesperson | Conversations > Type summary > Add conversation
Update Qualification Status | Salesperson | Set NEW, CONTACTED, INTERESTED, or READY_TO_BUY
Schedule Next Follow-up | Salesperson | Pick Next follow-up date and time > Save
Audit & Summary Updated | System | Latest note pinned to table preview & audit_logs
```

## Understanding lead status transitions

| Status | When to Use | Pipeline Impact |
| --- | --- | --- |
| `NEW` | Newly created, imported, or claimed lead before first conversation. | Remains in **1 Leads** (`New` tab). |
| `CONTACTED` | Initial call or message completed; awaiting prospect response. | Appears in **1 Leads** (`Contacted` tab). |
| `INTERESTED` | Prospect has confirmed interest in specific services and is reviewing scope or pricing. | Appears in **1 Leads** (`Interested` tab). |
| `READY_TO_BUY` | Commercial terms and services are agreed; customer is ready to pay. | Can be promoted immediately to **2 Potential**. |
| `LOST` | Prospect declined to proceed. Requires a final conversation note explaining why. | Archived from active follow-up counts. |

## How conversations and follow-ups are displayed

- **Last conversation preview**: The newest conversation note is highlighted at the top of the conversation panel and displayed inline in the **1 Leads** and **2 Potential** table rows so managers and teammates can read current context at a glance.
- **Initial Note (`LEAD_NOTE`)**: The note recorded when the lead was first created is permanently badged as `LEAD_NOTE`.
- **Next follow-up indicator**: Leads with a scheduled **Next follow-up** date display a date badge in the pipeline table. Overdue follow-ups are highlighted in amber/red on your **Overview** dashboard.

## Editing an existing conversation note

1. Hover over a conversation note you authored and click **Edit**.
2. Modify the text to correct typos or add missing details.
3. Click **Save**.
4. The entry displays an `(edited)` indicator while the original text remains preserved in `audit_logs`.

## What you should see

:::result
Your note appears immediately at the top of the customer's chronological conversation timeline, the **Last conversation** column in the pipeline list updates to show your latest entry, and the **Next follow-up** badge reflects your scheduled callback time.
:::

## Good to know

:::note Author and Manager Edit Permissions
Only the original author of a note, their Department Head, or the Super Admin can edit a conversation entry. Team members cannot overwrite or delete notes written by colleagues.
:::

## If something goes wrong

- **Add conversation button does not submit**: Ensure the note text box is not empty or whitespace-only; blank notes are rejected by validation.
- **Cannot save status as `READY_TO_BUY`**: Make sure at least one service is selected and an agreed deal amount greater than ₹0 is entered before moving the customer to **2 Potential**.
