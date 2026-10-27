---
title: "Chat: Messages, Groups and Client Conversations"
description: How employees use the Chat workspace for direct messages, department groups, customer threads, file attachments, and real-time client communications.
order: 1
group: Shared Features
audience: internal
roles:
  - Team Member
  - Team Lead
  - Department Head
  - Accounts Department
  - Technical Consultant
  - Super Admin
status: verified
updated: 2026-10-27
related:
  - /shared/notification-center-guide
  - /department-head/reviewing-client-conversations
  - /client/chatting-with-your-team
---

Chat is a full workspace in your dashboard navigation. It hosts your direct messages with colleagues, department channels, and customer communication threads.

![Shared Chat Workspace](shot:shared-chat-workspace.png "Team and Client Chat Workspace showing direct messages and customer threads")

## Before you start

:::prereq
- Every employee dashboard has **Chat** in the **Team** section of the menu, just above **Notification Center**. On a phone, open the menu with the menu button first.
- Clients can never see or join employee chats. Employee chats and client chats are completely separate.
:::

## Open Chat

1. Click **Chat** in the menu. The page fills the work area: the list of chats is on the left and the conversation is on the right. On a phone you see one at a time; use the back arrow to return to the list.
2. Look at the tabs at the top:
   - **Messages**: your one-to-one chats and groups.
   - **My clients**: the customers you look after as Team Member or Team Lead. This tab appears only if you have customers.
   - **Client conversations**: only for Department Heads (and the Super Admin). See [Reviewing client conversations](/department-head/reviewing-client-conversations).
3. The number next to a tab, and the number next to **Chat** in the menu, is how many messages you have not read.

## Message a colleague

1. In **Messages**, click **New**. The **New message** window opens on **One person**.
2. Type a name in **Find a colleague** and click the person. The chat opens. If you already have a chat with them, the same chat opens again.
3. Write in the box ("Write a message") and press kbd:Enter to send. Press kbd:Shift+Enter to start a new line.

The search shows names, roles and departments only.

## Create a group

1. In **Messages**, click **New**, then the **Group** tab.
2. Type a **Group name** (up to 80 characters) and search for colleagues. Click each person to add them; the names you picked appear above the search box, and the **x** next to a name takes it out.
3. Click **Create group**. You become the group admin.

A group is private. Only people who are added can see it. Someone you add later sees only the messages sent after they joined.

### Manage a group

Open the group and click the information icon (**Group details**).

- **Admins** can **Rename** the group, **Add people**, make a member an admin or remove admin rights, and remove a member. Removing someone asks you to confirm and takes the group away from that person immediately, including its earlier messages and files.
- **Everyone** can **Leave group**. You are asked to confirm. If the last admin leaves, the member who has been in the group longest becomes the admin.
- A short line in the conversation records who was added, removed or left.

## Chat with a customer you look after

1. Click the **My clients** tab and choose the customer. The conversation is the same one the customer sees in their **Chat** tab, shared with the other person on their team (the Team Member and the Team Lead both see it and can reply).
2. Write as above. The customer sees your name and **Team Member** or **Team Lead** next to your message.
3. If the customer has no dashboard login yet, a note says so: they cannot see messages until a login is created for them.

If a customer is reassigned to someone else, the earlier assignee loses access to the conversation straight away, and the new assignee sees the whole conversation. A line in the conversation says "Your assigned team was updated".

## Files, replies and reading

- **Attach a file**: click the paperclip. You can attach up to 5 files to a message, each up to 5 MB: images (PNG, JPEG, WEBP), PDF, text, CSV, Word (.docx) or Excel (.xlsx). Files are private; they open through a short-lived link and only for people in that conversation.
- **Reply to a message**: point at the message (on a phone the reply icon is always shown) and click the reply icon. Your message shows the quote.
- **Ticks**: one tick means sent. Two blue ticks mean the other side has read it. In a client chat, they show that someone from the team has it on screen. Groups do not show ticks.
- **Earlier messages**: click **Load earlier messages** at the top of a long conversation.
- A message can have up to 4,000 characters.

## What you should see

:::result
- New messages appear without refreshing the page. If your connection drops, the page catches up when it returns.
- A message that could not be sent stays in the conversation marked **Not sent**, with **Retry** and **Delete**. Retrying never sends it twice.
:::

## Good to know

:::note Notifications
A message from a customer sends you an in-app notification, **New message from** the customer, once for each stretch of unread messages. Click it and the Chat page opens on that conversation. Direct messages and groups show unread counts only; no e-mail or WhatsApp message is sent for any chat.
:::

:::warning What chat does not do
You cannot edit or delete a sent message, and there are no voice or video calls. Messages are protected by access control and by encryption in transit and at rest; they are not end-to-end encrypted. Do not send passwords or card numbers in chat.
:::

## If something goes wrong

- **"This conversation is not available"**: you no longer have access to it (for example you were removed from the group, or the customer was reassigned). Go back to the list.
- **Not sent**: check your connection and click **Retry**.
- A file is refused: check the type and the 5 MB limit above.
- For missing customers or permissions, see [Missing records and permissions](/troubleshooting/missing-records-and-permissions).
