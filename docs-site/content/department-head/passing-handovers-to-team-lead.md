---
title: How to Pass a Verified Customer to a Team Lead
summary: Operational procedure for Department Heads to review incoming customer handovers from Technical Consultants and route accounts to operational Team Leads.
audience: internal
roles:
  - Department Head
  - Team Lead
  - Technical Consultant
related:
  - /department-head/department-head-overview
  - /technical-consultant/department-handover-tc
  - /delivery/managing-delivery-queue
---

# How to Pass a Verified Customer to a Team Lead

When a Technical Consultant finishes document verification and provisions the client portal login, they transfer the customer to the Department Head. The customer appears in the Department Head's **Handover Board** under the **To assign** queue.

This guide explains how to inspect the verified dossier and route the customer to the appropriate delivery **Team Lead**.

---

## Prerequisites

- You must be logged in as an authorized **Department Head**.
- The customer must have been transferred by the Technical Consultant (`handoverStage === 'DEPARTMENT_HEAD'`).
- At least one active **Team Lead** must exist within your department roster.

---

## Step-by-Step Assignment Procedure

### 1. Open the Handover Board

1. In your dashboard navigation, click **Clients & Handovers** (or open the **Handover Board** tab).
2. The board organizes customer cards into status tabs:
   - **To assign (`DEPARTMENT_HEAD`):** Newly arrived verified customers awaiting team lead allocation.
   - **In progress (`TEAM_LEAD` or `TEAM_MEMBER`):** Customers actively assigned to team leads or specialists.
   - **All:** Historical list of all departmental accounts.
3. Select the **To assign** tab. Newly transferred cards display an orange badge labeled **Waiting for a team lead**.

---

### 2. Inspect Customer Dossier and Technical Notes

1. Click on the customer card to open the **Customer Dossier Modal**.
2. Review critical onboarding data:
   - **Purchased Services:** Catalog codes and package quantities.
   - **Consultation Notes:** Historical observations recorded by the Technical Consultant and Sales.
   - **Client Portal Status:** Confirm that `clientAccount` is provisioned.
   - **Handover Timestamp:** Displays when the Technical Consultant dispatched the account.

---

### 3. Open the Team Lead Allocation Dialog

1. In the customer card action toolbar, click the blue **Pass to Team Lead** button (with the `UserCheck` icon).
2. The **Assign Team Lead** dialog appears:
   - **Customer Name:** Pre-filled with business name.
   - **Select Team Lead:** Dropdown listing all active Team Leads belonging to your department.

---

### 4. Select Team Lead and Add Operational Guidance

1. Select the designated Team Lead based on current squad workload and specialization.
2. In the **Assignment Note for Team Lead** field, enter any specific instructions:
   - Target launch date or milestone deadlines.
   - Special client requirements or communication channels.
   - Priority level.

---

### 5. Confirm Allocation

1. Click **Confirm Assignment**.
2. The CRM executes the state transition:
   - Sets `handoverStage = 'TEAM_LEAD'`.
   - Records `passed_to_team_lead_at` timestamp and stores your assignment note.
   - Dispatches a real-time notification to the selected Team Lead.
   - Transitions the customer card from the **To assign** column to the **In progress** column.

---

## Reassigning a Team Lead

If a Team Lead is on scheduled leave or workload rebalancing is required:

1. Open the **In progress** tab on the Handover Board.
2. Click on the customer card.
3. Click the **Change Team Lead** button.
4. Select a new Team Lead from the dropdown and record the reason for reassignment.
5. The system immediately updates ownership and transfers the customer to the new Team Lead's active queue.
