---
title: Managing Teams, Onboarding, and Passing Handovers to Team Leads
description: Review verified customer handovers, manage Teams & People assignments, monitor Onboarding checklists, and route accounts to operational Team Leads.
order: 2
group: Client Delivery & Handovers
roles: [Department Head, Team Lead, Technical Consultant]
audience: internal
status: verified
sources: [src/components/Workspaces/DepartmentHeadDashboard.tsx, src/components/Workspaces/HandoverBoard.tsx, src/components/Workspaces/TeamsAndPeoplePanel.tsx]
related: [department-head/department-head-overview, technical-consultant/department-handover-tc, delivery/managing-delivery-queue]
updated: 2026-10-27
---

When a Technical Consultant completes document verification and provisions the client portal login (or when Accounts verifies payment on a direct-delivery service), the customer is transferred to the target delivery department (`handoverStage = 'DEPARTMENT_HEAD'`). As Department Head, you use the **Onboarding**, **Handovers**, and **Teams & People** tabs in `DepartmentHeadDashboard.tsx` to inspect incoming accounts, organize squads, and assign each customer to a **Team Lead**.

![Department Head Handover Board and Team Lead Assignment](shot:department-head-handovers.png)

## Before you start

:::prereq
- You must be signed in as an authorized **Department Head** with a single target department selected in the top **ScopeBar**.
- The customer record must be at `handoverStage = 'DEPARTMENT_HEAD'` for initial assignment, or `TEAM_LEAD` / `TEAM_MEMBER` for reassignment.
- At least one active **Team Lead** (`role = 'TEAM_HEAD'`) must belong to your department in **Teams & People**.
:::

## Handover and team allocation flow

```flow
Customer reaches Department Queue | Technical Consultant / Accounts | handoverStage = DEPARTMENT_HEAD
Inspect Onboarding & Dossier | Department Head | Onboarding & Handovers tabs
Select Pass to Team Lead | Department Head | Choose Team Lead + add operational note
-> No Team Lead available in squad | Configure squad in Teams & People first
Team Lead Assigns Team Member | Team Lead | handoverStage = TEAM_LEAD -> TEAM_MEMBER
```

## Steps: Reviewing onboarding and passing a handover to a Team Lead

1. In the left sidebar of the **Department Head Dashboard**, click **Onboarding** to inspect customers currently completing document verification or technical setup, or click **Handovers** to open the **Handover Board**.
2. On the **Handovers** tab, filter customer cards using the stage views:
   - **To assign (`DEPARTMENT_HEAD`)**: Verified customers waiting for you to assign a Team Lead.
   - **In progress (`TEAM_LEAD` or `TEAM_MEMBER`)**: Accounts already routed to a Team Lead or delivery specialist.
   - **All**: Complete historical list of departmental customer handovers.
3. Click a customer card in **To assign** to open the customer dossier and verify:
   - **Purchased Services & Add-Ons**: Catalog codes, quantities, and delivery scope.
   - **Consultation & Onboarding Notes**: Remarks recorded by Sales and the Technical Consultant.
   - **Client Portal Login**: Confirmation that the customer's `/client/login` credentials are active.
4. Click **Pass to Team Lead** on the customer card.
5. In the **Assign Team Lead** dialog, choose the target **Team Lead** from your department roster and enter an optional **Assignment Note** (such as target launch dates, priority instructions, or special client requirements).
6. Click **Confirm Assignment**.

## Managing squads in Teams & People

To keep workloads balanced across your division, open the **Teams & People** sidebar tab:

1. Review all operational teams inside your department along with each squad's assigned **Team Lead** and **Team Members**.
2. Check active customer counts and open task loads per staff member before routing new handovers.
3. To rebalance a customer already in delivery, open **Handovers > In progress**, select the customer card, and click **Change Team Lead** to transfer ownership to another Team Lead with an audit note.

## What you should see

:::result
Confirming the handover assignment sets `handoverStage = 'TEAM_LEAD'`, records the `passed_to_team_lead_at` timestamp, moves the card from **To assign** to **In progress**, and sends an instant notification to the selected Team Lead.
:::

## Good to know

:::note Cross-Department Add-On Routing
When an existing customer purchases an add-on service delivered by your department, it follows the same handover path once Accounts verifies the payment and the Technical Consultant (if required) completes onboarding checks.
:::

## If something goes wrong

- **No Team Leads appear in the dropdown**: Open **Teams & People** to verify that at least one active staff member in your current department holds the `TEAM_HEAD` role.
- **Customer is stuck in Onboarding**: See [Handover and Progression Blockers](/troubleshooting/handover-and-progression-blockers).
