---
title: How to Record and Track Customer Conversations
description: Maintain detailed customer interaction logs, edit notes, and view the latest conversation summary.
order: 30
roles: [Sales Team Member, Sales Team Lead, Department Head]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadConversations.tsx, docs/PAYMENTS_ACCOUNTS.md]
related: [sales/creating-a-lead, sales/moving-to-potential]
updated: 2026-10-19
---

Consistent documentation of calls, meetings, and WhatsApp chats ensures full context is retained across the entire customer lifecycle.

## Before you start

:::prereq
- Open an existing lead or customer from your pipeline.
:::

## Steps

1. In **My Leads**, click on the customer row to open the customer record.
2. Locate the **Conversations** section below the customer details.
3. In the text area, type a summary of your latest interaction:
   - What was discussed (pain points, feature requests, objections).
   - Any agreed action items or promised delivery dates.
4. Click **Add conversation**.

```flow
Add Conversation Note | Salesperson | Customer Details > Conversations
Database Insert | System | Appends new row to lead_conversations
Update Last Conversation | System | Newest entry becomes displayed summary
Notification to Team | System | Audit trail updated with timestamp & author
```

## How conversations are displayed

- **Last conversation**: The most recent conversation entry is highlighted in bold at the top of the conversation panel and shown in table previews so anyone opening the customer sees current context instantly.
- **Initial Note**: The note entered when the lead was originally created is preserved with tag `LEAD_NOTE`.
- **Chronological History**: All historical notes appear in descending order (newest first) with the author's name and exact timestamp.

## Editing an existing conversation

1. Hover over a conversation note you authored and click **Edit**.
2. Update the note text.
3. Click **Save**.
4. The note displays an `(edited)` indicator. The previous text is permanently preserved in `audit_logs`.

## What you should see

:::result
The conversation thread updates immediately. When viewing the customer in table lists, the **Last conversation** snippet reflects your new entry.
:::

## Good to know

:::note Who can edit notes?
Only the original author, their Department Head, or the Super Admin can edit a conversation entry. Colleagues cannot overwrite each other's notes.
:::

## If something goes wrong

If an **Add conversation** click does not submit, ensure the text box contains text. Blank notes are refused by the API.
