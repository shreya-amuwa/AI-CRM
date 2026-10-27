---
title: Reviewing Client Conversations and Service Quality (Read-Only)
description: Audit customer chat threads in read-only mode from the Chat tab, understand audit logging rules, and coordinate service quality improvements with Team Leads.
order: 5
group: Support & Escalations
roles: [Department Head, Super Admin]
audience: internal
status: verified
sources: [src/components/Workspaces/DepartmentHeadDashboard.tsx, src/components/chat/ChatWorkspace.tsx, server/chatRoutes.ts]
related: [shared/chat-guide, department-head/department-head-overview, department-head/passing-handovers-to-team-lead]
updated: 2026-10-27
---

As a **Department Head**, you can audit the live chat conversations between your department's customers and the **Team Member** and **Team Lead** assigned to them. This read-only inspection mode lets you verify service quality, check response tone, and investigate escalations without appearing as a participant in the client's chat window.

## Before you start

:::prereq
- You must be signed in as a **Department Head** (scoped to your assigned department) or **Super Admin** (global access across all departments).
- You are not an active participant in client conversations: your name is never shown to the customer, and the message composer is disabled in audit mode.
:::

## Audit and coaching workflow

```flow
Open Chat > Clients Tab | Department Head | DepartmentHeadDashboard sidebar > Chat
Select Customer Thread | Department Head | Search by customer name, company, or code
Read Thread in Review-Only Mode | System Audit Logger | Logs read event (deduplicated per 30 min window)
Coach Assigned Squad | Department Head | Message Team Lead/Member in Direct or Channels tab
```

## Steps: Inspecting a client conversation

1. In the left sidebar of the **Department Head Dashboard** (`DepartmentHeadDashboard.tsx`), click **Chat**.
2. In the **Chat** workspace (`ChatWorkspace.tsx`), select the **Clients** (`Client conversations`) tab at the top of the conversation list.
3. Search for the customer by name, company, or customer code. Conversations with at least one message appear ordered by most recent activity first; click **Show more** to load additional records.
4. Click a customer row to open the thread:
   - The header displays the customer's name along with their assigned **Team Member** and **Team Lead**, plus a **Review only** badge.
   - Each message shows the sender's name, role (**Client**, **Team Member**, or **Team Lead**), timestamp, and any shared file attachments.
5. If you need to instruct the team on how to respond or handle an add-on request, switch to the **Direct** or **Channels** tab in **Chat** to message the assigned Team Lead or Team Member privately.

## What you should see

:::result
The conversation opens with no message input box and no send button. A notice at the bottom confirms: *"Review only. You can read this conversation but not write in it. Opening it is recorded in the audit log."* New messages stream in automatically via Supabase Realtime.
:::

## Good to know

:::important Audit Log Recording
Every time a Department Head or Super Admin opens a client conversation, an entry is written to the security audit log recording the reviewer's user ID, customer ID, and timestamp. Re-opening the same conversation within 30 minutes does not create a duplicate log entry.
:::

- **Strict server-side enforcement**: Read-only access is enforced by the backend API as well as the UI; a Department Head cannot post messages or upload attachments to a client thread via any endpoint.
- **Persistent history across reassignments**: If you reassign a customer to a new Team Lead or Team Member in **Handovers**, the full historical conversation remains intact and visible.
- **Privacy of internal staff chats**: One-to-one **Direct** messages and private **Channels** between employees are never visible to you unless you are a member of that conversation.

## If something goes wrong

- **The Clients conversation tab is not visible**: Only Department Heads and Super Admins have audit access to departmental client threads; verify your role in **My Profile**.
- **A customer does not appear in the list**: Confirm that the customer belongs to your currently selected department in the **ScopeBar** and has exchanged at least one chat message.
