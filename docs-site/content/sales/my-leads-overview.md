---
title: Navigating the Sales Panel and My Leads
description: Learn how the Sales pipeline is structured across Leads, Potential, Customer Onboarding, and Inbound enquiries.
order: 10
roles: [Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadsView.tsx, src/components/team-member/pipeline/PipelineWorkspace.tsx]
related: [sales/creating-a-lead, sales/moving-to-potential]
updated: 2026-10-19
---

The Sales Panel is the dedicated workplace for sales professionals to qualify prospects, manage conversations, and transition paying customers into onboarding.

## Before you start

:::prereq
- Sign in with a Sales Team Member or Sales Team Lead account.
- The sidebar displays **My Leads** with live sub-counters.
:::

## Pipeline structure

The pipeline organizes customer progression into three sequential views:

1. **1 Leads**:
   - Holds new and active prospects undergoing qualification.
   - Status tabs: **All**, **New**, **Contacted**, **Interested**, **Ready to Buy**, **Returned from Accounts**, and **With Accounts**.
   - Contains the **Inbound Leads** drawer where web and WhatsApp enquiries arrive.

2. **2 Potential**:
   - Holds qualified prospects with an agreed **Deal Amount**.
   - Contains stage summary cards (Proposal, Negotiation, Closing).
   - Serves as the launchpad for the **Send to Accounts** payment submission.

3. **3 Customer onboarding**:
   - Holds customers whose payments have been confirmed by Accounts.
   - Houses the dynamic service requirement checklists and mandatory document uploads.
   - Tracks submission to the Technical Consultant.

4. **Part payments**:
   - Read-only tracking list of active customers with outstanding balance collections.

## Inbound leads queue

Website, WhatsApp, and digital campaign leads arrive in the **Inbound Leads** table:
1. Click **Inbound leads** in the Leads view toolbar.
2. Review the prospect details (contact, source channel, timestamp).
3. Click **Take this lead** (`claim_inbound_lead`).
4. The enquiry is converted into a standard `LEAD` record owned by you. A second claim attempt by another salesperson receives an immediate conflict notice.

## What you should see

:::result
Claimed leads appear at the top of your **My Leads** list with status `NEW`. Live counts on the sidebar increment in real time.
:::

## Good to know

:::tip Quick Keyboard Shortcut
Use `kbd:Ctrl+K` (or `kbd:Cmd+K`) from any sales screen to instantly search across your leads by name, phone number, or company.
:::

## If something goes wrong

If an inbound lead button returns an error, another team member has already claimed that lead. Refresh to update the queue.
