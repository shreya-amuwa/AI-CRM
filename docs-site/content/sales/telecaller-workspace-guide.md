---
title: Telecaller Workspace and Calling Sheet Guide
description: Complete operational guide for Telecallers managing assigned calling sheets, updating call statuses, logging notes, and handing over warm leads to Business Associates.
order: 9
group: Role Workspaces
roles: [Telecaller, Sales Team Member, Sales Team Lead, Department Head]
audience: internal
status: verified
sources: [src/components/telecaller/TelecallerDashboard.tsx, src/components/telecaller/HomePage.tsx, src/components/telecaller/TasksPage.tsx, src/components/telecaller/ConvertLead.tsx]
related: [sales/business-associate-workspace, sales/creating-a-lead, sales/my-leads-overview]
updated: 2026-10-27
---

The **Telecaller Workspace** (`salesSubRole = 'TELECALLER'`, accessed at `/telecaller/dashboard/:userId`) is purpose-built for high-volume outbound prospecting. Telecallers work through calling sheets assigned by the Sales Department Head, record call outcomes inline, manage personal leads, and hand over qualified prospects (`Interested` or `Ready to buy`) directly to a **Business Associate (BA)** to close the deal.

## Before you start

:::prereq
- Sign in with a Sales profile configured with `salesSubRole = 'TELECALLER'`.
- Your Sales Department Head or Team Lead must have uploaded and assigned a calling sheet to you, or you can add prospects directly in **Leads**.
:::

## Telecaller sidebar and workspace sections

The Telecaller workspace (`TelecallerDashboard.tsx`) provides focused navigation across your daily calling workflow and top header actions:

1. **Home (`Overview`)**:
   - Displays real-time KPI summary cards: **Assigned Tasks**, **Calls Made**, **Interested**, **Ready to Buy**, and **Sent to BA**.
   - Shows the **Call Status Breakdown** across your assigned sheets and a quick-action list of **Recent Interested Customers** ready for handover.
2. **Tasks (Assigned Calling Sheets)**:
   - Displays all contacts from calling sheets uploaded and assigned to you by the Sales Head.
   - Filter pills: **All**, **To call**, **Interested**, **Ready to buy**, **Follow-up**, **Not interested**, and **Sent to BA**.
   - Includes a live **Search bar** (search by name, phone number, business, or city), inline **Call Status** dropdown selector, inline **Notes** editor, and the **Send to BA** handover action button.
3. **Leads (`My Leads`)**:
   - Holds prospects you registered directly via **+ Add lead** (including shop photo / visiting card OCR scan) and lets you qualify or convert them via **Send to BA** (`ConvertLead.tsx`).
4. **Top Header Utilities (`Leave Request`, `Notification Bell`, `Chat`, `My Profile`)**:
   - Access **Leave Center** (`Leave Request`) to apply for leave, check real-time alerts in the **Notification Bell**, coordinate with teammates in **Chat**, and review your assignment details in **My Profile**.

```flow
Sales Head Uploads Sheet | Sales Department Head | Assigns calling sheet rows to Telecaller
Telecaller Calls Lead | Telecaller | Opens Tasks > filters by "To call" and dials prospect
Marks Interested / Ready to Buy | Telecaller | Updates inline Call Status & records conversation Notes
Clicks Send to BA | Telecaller | Selects target Business Associate and confirms handover
Business Associate Closes Deal | Business Associate | Receives warm lead in BA Tasks & Leads pipeline
```

## Working through your calling sheet in `Tasks`

1. In the left sidebar, click **Tasks**.
2. Select the **To call** filter tab (or use the search bar to find a specific contact or city).
3. Dial the prospect's 10-digit mobile number shown on the row.
4. Immediately update the inline **Call Status** selector based on the conversation:
   - `To call`: Not dialed yet.
   - `Interested`: Prospect wants a product demo, quotation, or deeper discussion.
   - `Ready to buy`: Prospect has confirmed buying intent and budget.
   - `Follow-up`: Prospect requested a callback at a later date/time.
   - `Not interested`: Prospect declined or is not a fit.
5. In the inline **Notes** field, type key takeaways from the call (such as which services they asked about, preferred language, or callback timing).

## Handing over a warm lead via `Send to BA`

When a contact on your calling sheet (or in your **Leads** list) is marked `Interested` or `Ready to buy`:
1. Click the **Send to BA** button on that contact's row.
2. In the handover modal (`ConvertLead.tsx`), review or complete the customer's business name, interested services, and call notes.
3. Select the receiving **Business Associate (BA)** from your sales team.
4. Click **Send to BA** to confirm.

## What you should see

:::result
The row status updates to **Sent to BA** with a badge naming the assigned Business Associate, your **Sent to BA** KPI counter on **Home (`Overview`)** increments by one, and the Business Associate receives the warm lead in their workspace with full Telecaller attribution.
:::

## Good to know

:::tip Preserved Telecaller Attribution
When you transfer a prospect via **Send to BA**, the CRM permanently links your Telecaller user ID on the contact record so management reports credit both the Telecaller who originated the warm lead and the Business Associate who closes the sale.
:::

## If something goes wrong

- **`Send to BA` button is disabled or hidden**: Ensure the contact has a valid 10-digit mobile number and their call status is set to `Interested` or `Ready to buy` (contacts already marked `Sent to BA` cannot be sent a second time).
- **No contacts appear in `Tasks`**: Check that the **All** filter tab is selected, or ask your Sales Department Head to assign a calling sheet to your profile.
