---
title: Business Associate (BA) Workspace Guide
description: Complete guide to the Business Associate workspace for receiving Telecaller handovers, running demos, sharing quotations, and closing deals across the 4-stage pipeline.
order: 10
group: Role Workspaces
roles: [Business Associate, Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/business-associate/BusinessAssociateDashboard.tsx, src/components/business-associate/HomePage.tsx, src/components/business-associate/TasksPage.tsx, src/components/business-associate/QuotationPage.tsx, src/components/business-associate/DemoSchedulePage.tsx, src/components/business-associate/ScopePage.tsx]
related: [sales/telecaller-workspace-guide, sales/my-leads-overview, sales/moving-to-potential, sales/customer-onboarding-sales]
updated: 2026-10-27
---

The **Business Associate (BA) Workspace** (`salesSubRole = 'BUSINESS_ASSOCIATE'`, accessed at `/business-associate/dashboard/:userId`) is designed for closing specialists who receive warm prospects handed over by Telecallers, conduct product demonstrations, prepare commercial quotations and project scopes, and guide paying customers through the 4-stage pipeline.

![Business Associate Pipeline and Handover Workspace](shot:business-associate-workspace.png)

## Before you start

:::prereq
- Sign in with a Sales profile configured with `salesSubRole = 'BUSINESS_ASSOCIATE'`.
- Warm leads handed over by Telecallers appear automatically in your **Tasks** and **Leads** views with a `Sent to BA` attribution badge.
:::

## Business Associate sidebar and workspace structure

The Business Associate dashboard (`BusinessAssociateDashboard.tsx`) unifies Telecaller handovers, the 4-stage sales pipeline, and commercial closing tools around the same customer record:

1. **Home (`Overview`)**:
   - Displays your personal KPI summary cards: **Active Pipeline**, **Potential Deals**, **Onboarding**, **Closed Won**, and **Collected Revenue**.
   - Surfaces today's scheduled product demos, pending Telecaller handovers, and follow-up alerts.
2. **Tasks (`My Tasks / Assigned Tasks`)**:
   - Lists warm contacts handed over by Telecallers (tagged with the originating Telecaller's name and `Sent to BA` badge) alongside tasks assigned by your Sales Team Lead or Department Head.
   - Provides one-click actions to schedule a demo, generate a quotation, or open the customer in the pipeline.
3. **Leads (4-Stage Pipeline)**:
   - **`1 Leads`**: Qualify Telecaller handovers and self-sourced leads, log conversations, and select services.
   - **`2 Potential`**: Record agreed deal amounts, select GST basis, and submit **Confirm Payment** (`Send to Accounts`).
   - **`3 Customer onboarding`**: Complete the 6-item onboarding checklist (`1. Basic Information` through `6. Quotation Shared`) and hand over to the Technical Consultant or Department Head.
   - **`4 Client` / `Part payments`**: Track converted active clients and monitor outstanding installment balances.
4. **Commercial Closing Tools (`Quotation`, `Demo Schedule`, `Scope of Project`)**:
   - **Quotation**: Build and download itemized commercial quotations linked to the customer record.
   - **Demo Schedule**: Schedule, track, and log outcomes of live product demonstrations.
   - **Scope of Project**: Author structured project scope documents that feed directly into `3. Requirement Document` during onboarding.
5. **Header & Team Utilities (`Leave Request`, `Notification Bell`, `Chat`)**:
   - Submit leave applications via **Leave Center** (`Leave Request`), monitor real-time payment and handover notifications, and collaborate with Telecallers and Team Leads in **Chat**.

```flow
Telecaller Clicks Send to BA | Telecaller | Warm lead routed to Business Associate with notes
BA Reviews Handover | Business Associate | Opens Tasks or 1 Leads (sees Sent to BA attribution badge)
Runs Demo & Shares Quotation | Business Associate | Uses Demo Schedule, Quotation & Scope of Project
Moves to 2 Potential & Confirms Payment | Business Associate | Enters Deal Amount > submits to Accounts
Completes 3 Customer Onboarding | Business Associate | Uploads 2. All Important Documents & 3. Requirement Document
Handover to Delivery | Technical Consultant / Dept Head | Deal closes into 4 Client & credits Collected Revenue
```

## Working warm leads handed over by Telecallers

1. Open **Tasks** or **Leads > 1 Leads** from the sidebar.
2. Locate contacts displaying the **Sent to BA** attribution badge and review the Telecaller's initial call notes.
3. Contact the prospect to conduct discovery or click **Demo Schedule** to book a product walkthrough.
4. Prepare a formal proposal in **Quotation** and define deliverables in **Scope of Project**.
5. Once the customer agrees on commercial terms:
   - Move the record to **2 Potential** (`READY_TO_BUY`) with the agreed **Deal Amount (₹)**.
   - Click **Confirm Payment** (`Send to Accounts`) once payment is made.
   - After Accounts verifies the funds, complete the 6-item checklist in **3 Customer onboarding**.

## What you should see

:::result
As you progress a Telecaller handover through **1 Leads → 2 Potential → 3 Customer onboarding → 4 Client**, your **Home** KPI cards (`Active Pipeline`, `Potential Deals`, `Onboarding`, `Closed Won`, and `Collected Revenue`) update automatically from live database records.
:::

## Good to know

:::note Single Client Dossier Across All Tabs
Creating a **Quotation**, booking a **Demo Schedule**, or drafting a **Scope of Project** attaches directly to the customer's pipeline record—you never have to re-enter contact details or upload duplicate files.
:::

## If something goes wrong

- **Cannot move a handover to `2 Potential`**: Ensure at least one catalog service is selected and a positive integer **Deal Amount (₹)** is saved on the lead record.
- **Payment verified by Accounts is not showing in `Collected Revenue`**: Refresh the dashboard or check **Part payments** to confirm Accounts has marked the ledger row `VERIFIED`.
