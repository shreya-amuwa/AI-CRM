---
title: Troubleshooting Handover and Progression Blockers
description: Identify the exact missing prerequisite when Send to Accounts, Send to Technical Consultant, Send to Department Head, or Pass to Team Lead is disabled.
order: 6
group: Documents & Onboarding
roles: [Sales Team Member, Sales Team Lead, Technical Consultant, Department Head, Accounts, Super Admin]
audience: internal
status: verified
sources: [src/components/SalesPanel.tsx, src/components/TechnicalConsultantPanel.tsx, src/components/DepartmentHeadPanel.tsx]
related:
  - /sales/sending-to-accounts
  - /sales/customer-onboarding-sales
  - /technical-consultant/department-handover-tc
  - /troubleshooting/document-upload-troubleshooting
updated: 2026-10-27
---

Amuwa AI CRM validates required fields, payments, checklist documents, and client portal credentials at every stage gate so incomplete customer dossiers cannot be handed over prematurely. When a progression button is disabled, use the checklists below to clear the blocker.

## Before you start

:::prereq
- Open the customer card where the progression button is disabled.
:::

:::tip Always check the on-screen blocker notice first
Look directly below the disabled progression button. An amber reason notice (`data-testid="send-reason"`) states the exact condition blocking the handover (for example, *"Client portal login must be created before handover"* or *"2 required documents missing"*).
:::

## 1. Symptom: "Send to Accounts" button is disabled (Sales Panel)

### Likely causes

- One or more commercial deal prerequisites are still missing on the lead/potential card.

### Step-by-step resolution

Verify and complete all items on this checklist:

- [ ] **Deal Amount > ₹0**: Enter and save a commercial `dealAmount` greater than ₹0.
- [ ] **At Least One Service Selected**: Select at least one service from the catalog for the order.
- [ ] **Tax Basis Selected**: Confirm whether the agreed deal amount is **Excluding GST (`EXCLUSIVE`)** or **Including GST (`INCLUSIVE`)**.
- [ ] **Conversation Note Logged**: Add at least one conversation note (`lead_conversations`) summarizing the client's commercial agreement.

## 2. Symptom: "Send to Technical Consultant" (or Direct Handover) is disabled (Sales Onboarding)

### Likely causes

- Accounts has not yet confirmed the initial payment, or mandatory onboarding checklist items are still incomplete or rejected.

### Step-by-step resolution

- [ ] **Accounts Payment Confirmed**: Confirm that Accounts has verified at least the initial payment (`accountsConfirmedAt` is set). Sales cannot forward a dossier while payment confirmation is still pending.
- [ ] **Mandatory Checklist Items Provided**: Upload files or save text values for every required sales-side checklist item (respecting the **2 MB** checklist limit and single-PDF rule for `2. All Important Documents`).
- [ ] **Rejected Items Replaced**: If the Technical Consultant returned the card with items marked *Not authorized*, upload replacement files for those items.

## 3. Symptom: "Send to Department Head" is disabled (Technical Consultant Panel)

### Likely causes

- Not all checklist items are marked **Authorized**, consultant-owned fields are blank, or the customer's Client Portal login has not been created yet.

### Step-by-step resolution

- [ ] **All Checklist Items Authorized**: Every required document and text item must be reviewed and marked **`Authorized`** (`itemsVerified >= itemsTotal`).
- [ ] **Zero Unresolved Rejections**: `itemsRejected === 0`. If any item is marked *Not authorized*, either return the card to Sales for correction or verify the newly uploaded replacement.
- [ ] **Consultant Fields Saved**: Fill and save all consultant-specific checklist fields (such as WABA ID or provisioned website URL).
- [ ] **Client Portal Login Created**: Provision and save the customer's `/client/login` email and password in the **Client panel login** section.
- [ ] **Not Currently Returned to Sales**: The dossier cannot be in `WAITING_ON_SALES` status.

## 4. Symptom: "Pass to Team Lead" or "Assign to Team Member" is disabled (Department Head / Team Lead Panel)

### Likely causes

- No active **Team Lead** (`TEAM_LEAD`) or **Team Member** (`TEAM_MEMBER`) exists in the target delivery department's roster.

### Step-by-step resolution

1. Check the department roster in the **Department Head** or **Super Admin** panel.
2. If the department has no active **Team Lead** or **Team Member**, ask a **Super Admin** to create or assign staff to that department.

## Expected result

:::result
- As soon as the final missing prerequisite is saved, the amber blocker notice disappears, the handover button becomes active, and clicking it transitions the customer to the next stakeholder queue with real-time notifications.
:::

## When to escalate

If all checklist items above appear complete but the button remains disabled, refresh the page (`kbd:Ctrl+R`) to reload the latest server state. If it is still blocked, escalate to a **Super Admin** with:

- The **Customer Name** and current **Handover / Lifecycle Stage**.
- The exact text shown in the amber blocker notice below the button.
