---
title: Managing Returned Leads and Assigning / Reassigning Leads
description: Resolving leads returned from Accounts or Technical Consultants, and performing single, bulk, or round-robin lead assignments in Team Leads.
order: 8
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Department Head]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadsView.tsx, src/components/team-member/pipeline/OnboardingViews.tsx, src/components/team-lead/TeamCustomers.tsx]
related: [sales/my-leads-overview, sales/customer-onboarding-sales, sales/team-lead-pipeline-and-tasks]
updated: 2026-10-27
---

During the sales lifecycle, deals may be returned by Accounts or a Technical Consultant for correction, or a Sales Team Lead may need to assign, bulk-distribute, or transfer lead ownership across team members.

## Before you start

:::prereq
- To resolve a returned lead, sign in as the assigned Sales Team Member, Business Associate, or Team Lead.
- To assign, bulk-assign, or transfer lead ownership across a team, sign in as a **Sales Team Lead** or **Department Head**.
:::

## Scenario 1: Resolving leads returned from Accounts

When Accounts cannot verify a payment reference or finds a tax mismatch, the record returns to **My Leads > 1 Leads** under the **Returned from Accounts** tab:
1. Click the customer row to open the record and read the **Resolution Note from Accounts** banner at the top.
2. Contact the customer to collect the corrected UTR/transaction reference or align on the commercial amount and GST basis.
3. Update the deal details and click **Send to Accounts** (`Confirm Payment`) to resubmit.
4. If the customer cancels the purchase, click **Customer backed out** or set status to `LOST` and log the reason in **Conversations**.

## Scenario 2: Resolving onboarding items returned by the Technical Consultant

When a document fails technical compliance review, the customer appears in **My Leads > 3 Customer onboarding** under the **Returned by consultant** filter:
1. Open the customer in **3 Customer onboarding** and read the **Re-verification Note** banner from the Technical Consultant.
2. Locate any checklist item marked with a red **Not authorized** badge (for example, `2. All Important Documents` or `3. Requirement Document`).
3. Click **Replace File** or **Edit Details**, upload the corrected PDF (under **2 MB**), and save.
4. Once all rejected items return to `SAVED`, click **Send again to Technical Consultant**.

```flow
Record Returned or Unassigned | Accounts / TC / Team Lead | Appears in Returned tab or Team Customers list
Inspect Reason or Workload | Salesperson / Team Lead | Check resolution note or member capacity
Upload Fix or Select Assignee | Salesperson / Team Lead | Replace file or pick single / bulk / round-robin assignee
Confirm Action | System | Updates status or ownerId and writes audit log entry
```

## Scenario 3: Assigning and reassigning leads in `Team Leads` / `Team Customers`

Sales Team Leads and Department Heads manage lead distribution and ownership transfers from **Team Customers** (or **Team Leads**):

1. **Single Lead Assignment / Ownership Transfer**:
   - Open **Team Customers** (`src/components/team-lead/TeamCustomers.tsx`) and filter by stage (`1 Leads`, `2 Potential`, `3 Customer onboarding`, `4 Client`) or current owner.
   - Click the **Assign / Reassign** selector on the customer row, choose the target Sales Team Member or Business Associate, and confirm.
2. **Bulk Lead Assignment**:
   - Select multiple leads using the row checkboxes (or upload a batch via **Import Leads (CSV / Excel)**).
   - Choose a target salesperson to assign the selected batch in a single operation.
3. **Round-Robin Distribution**:
   - When importing a sheet of leads or distributing unassigned enquiries, choose **Round-Robin** to split leads evenly across all active members of your sales pod.

## What you should see

:::result
- For returned leads: Resubmitting moves the customer out of the **Returned** filter and back into the active Accounts or Technical Consultant queue.
- For reassigned leads: Ownership (`ownerId`) transfers immediately to the selected team member while preserving all historical conversations, uploaded documents, and payment records.
:::

## Good to know

:::note Full History Preserved on Reassignment
Transferring a lead or onboarding customer to another salesperson when someone is on leave never resets the customer's stage, conversation notes, or verified payments. Every ownership transfer is recorded in `audit_logs`.
:::

## If something goes wrong

- **Cannot reassign a record**: Only Team Leads, Department Heads, and Super Admins can transfer ownership across staff members. Sales Team Members can view and edit only their own assigned records.
