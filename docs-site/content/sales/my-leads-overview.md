---
title: Navigating the Sales Panel and Pipeline Overview
description: Learn how the Sales sidebar and 4-stage pipeline are structured across Leads, Potential, Customer onboarding, Client, Part payments, and Inbound enquiries.
order: 1
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Business Associate]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadsView.tsx, src/components/team-member/pipeline/PipelineWorkspace.tsx]
related: [sales/creating-a-lead, sales/moving-to-potential, sales/team-lead-pipeline-and-tasks]
updated: 2026-10-27
---

The Sales Panel is the dedicated workspace for sales professionals to qualify prospects, manage conversations, submit confirmed deals to Accounts, and transition paying customers into onboarding and active service delivery.

## Before you start

:::prereq
- Sign in with a Sales Team Member, Business Associate, or Sales Team Lead account.
- Check the left sidebar for **Overview** and **My Leads** (plus **Team Leads** / **Team Customers** if you are a Sales Team Lead).
:::

## Sales sidebar and pipeline stages

The Sales sidebar organizes daily customer progression into sequential views with live badge counters:

1. **Overview**:
   - Displays personal KPI cards (Active Pipeline, Potential Deals, Onboarding, Closed Won, Collected Revenue), follow-up reminders, and recent activity.
2. **My Leads → 1 Leads**:
   - Holds new and active prospects undergoing qualification.
   - Status filter tabs: **All**, **New**, **Contacted**, **Interested**, **Ready to Buy**, **Returned from Accounts**, and **With Accounts**.
   - Includes the **Inbound leads** queue where website, WhatsApp, and digital campaign enquiries arrive.
3. **My Leads → 2 Potential**:
   - Holds qualified prospects with selected services and an agreed **Deal Amount**.
   - Serves as the launchpad for **Send to Accounts** (`Confirm Payment`), **Send to Onboarding**, or **Customer backed out**.
4. **My Leads → 3 Customer onboarding**:
   - Holds customers whose initial payment has been confirmed by Accounts.
   - Houses the 6-item onboarding checklist, document uploads, the **Get Started** indicator, and handover controls.
5. **My Leads → 4 Client** (and **Part payments**):
   - Displays converted active clients (`stage: 'CLIENT'`) and tracks active installment balances in **Part payments**.
6. **Team Leads / Team Customers** (Sales Team Leads only):
   - Provides a unified team-wide 4-stage pipeline view with member filters, bulk CSV/Excel import, and lead assignment tools.

```flow
Create or Claim Lead | Salesperson | My Leads > 1 Leads (+ Add Lead or Inbound leads)
Qualify & Set Status | Salesperson | Log conversations, schedule follow-up, mark READY_TO_BUY
Price Deal in Potential | Salesperson | 2 Potential > confirm services, Deal Amount, and GST basis
Request Payment Confirmation | Salesperson | Click Confirm Payment / Send to Accounts
Complete Onboarding Checklist | Salesperson | 3 Customer onboarding > upload required PDFs
Handover to Delivery | Technical Consultant or Sales | Moves to 4 Client for department fulfillment
```

## Search and filter controls

Across every stage of **My Leads**, use the toolbar controls to narrow down records:
- **Search bar**: Filter instantly by customer name, business/company name, or 10-digit mobile number.
- **Service filter**: Filter the stage list by any service from the catalog (for example, `Wabastore`, `Whatsbox`, or `Amuwa Design Studio`).
- **Status / State tabs**: Switch between qualification statuses in `1 Leads` or onboarding states (`Returned by consultant`, `Collecting`, `Waiting on client`, `Ready for handover`, `Get started`) in `3 Customer onboarding`.
- **Sort selector**: Order records by newest, oldest, or upcoming follow-up date.

## Claiming from the Inbound leads queue

Website, WhatsApp, and campaign enquiries arrive in the **Inbound leads** drawer inside **1 Leads**:
1. Click **Inbound leads** in the **1 Leads** toolbar.
2. Review the prospect's contact details, source channel, and inquiry timestamp.
3. Click **Take this lead** (`claim_inbound_lead`).
4. The enquiry converts into a standard `LEAD` record owned by you and appears at the top of **1 Leads**.

## What you should see

:::result
Claimed or newly added leads appear immediately at the top of **1 Leads** with status `NEW`, and the sidebar stage counters update in real time.
:::

## Good to know

:::tip Quick Keyboard Shortcut
Press `kbd:Ctrl+K` (or `kbd:Cmd+K`) from any sales screen to search across your leads by customer name, phone number, or company name.
:::

## If something goes wrong

- **"Lead already claimed"**: Another salesperson claimed the inbound enquiry moments before you. Refresh the **Inbound leads** drawer to view remaining unclaimed enquiries.
- **Missing customer record**: Check whether the customer advanced to **2 Potential** or **3 Customer onboarding**, or see [Missing Records and Permissions](/troubleshooting/missing-records-and-permissions).
