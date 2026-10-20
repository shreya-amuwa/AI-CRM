---
title: How to Manage the Service Delivery Queue
summary: Operational manual for delivery Team Leads and Team Members to inspect assigned customer accounts, review verified onboarding dossiers, and execute service fulfillment.
audience: internal
roles:
  - Team Lead
  - Team Member
  - Department Head
related:
  - /delivery/delivery-departments-overview
  - /support/logging-client-activity
  - /client/client-calendar-view
---

# How to Manage the Service Delivery Queue

Once a customer dossier has been transferred through Department Head and Team Lead allocations (`handoverStage === 'TEAM_MEMBER'`), the customer appears in the assigned specialist's operational workspace.

This guide outlines how delivery team members review customer requirements, access verified technical assets, log deliverables, and coordinate service completion.

---

## Prerequisites

- You must be logged in as an authorized **Team Member** or **Team Lead** within the responsible delivery department (e.g., Wabastore, Design Studio, Digitree).
- The customer must have completed onboarding verification and been formally assigned to your team roster.

---

## Step-by-Step Delivery Procedure

### 1. Open Your Assigned Delivery Queue

1. Sign in to your departmental dashboard.
2. Click **Active Delivery Queue** (or **Assigned Customers**).
3. The queue displays:
   - Customer business name and primary contact.
   - Purchased service catalog tags.
   - Handover timestamp and notes from Department Head/TC.
   - SLA delivery deadline indicator.

---

### 2. Inspect Verified Assets and Technical Requirements

1. Click on the customer row to open the **Customer Delivery Workspace**.
2. Review the core data cards:
   - **Service Specifications:** Review exact purchased tiers, quantity, and custom deliverables.
   - **Authorized Documents:** Inspect verified business documents, logos, or technical credentials uploaded during onboarding.
   - **Consultation & Sales Notes:** Read the historical notes logged by Sales and the Technical Consultant to understand agreed client preferences.
   - **Provisioned WABA ID / API Keys:** If applicable, copy the authorized technical identifiers.

---

### 3. Log Delivery Progress on the Client Calendar

To keep external clients informed without requiring redundant support messages, delivery staff log progress updates directly to the **Client Portal Activity Calendar**:

1. In the customer workspace, open the **Client Activity** tab.
2. Click **Log Activity / Deliverable**.
3. Fill in the required details:
   - **Activity Type:** Select `CAMPAIGN_LAUNCH`, `DELIVERABLE_COMPLETED`, `MILESTONE`, or `MEETING`.
   - **Title:** E.g., *"Interactive WhatsApp Template Set Submitted for Meta Approval"*.
   - **Description:** Provide brief, client-friendly explanation of progress.
   - **Date / Milestone Time:** Select the completion date.
4. Click **Publish to Client Calendar**.
5. The activity immediately reflects on the client's dashboard on the calendar.

---

### 4. Coordinate Revisions and Proof of Work

1. If the deliverable requires client feedback (e.g., visual creatives or bot conversation trees):
   - Upload the draft file to the customer documents repository or provide the external preview link.
   - Coordinate via the CRM internal message thread or linked support ticket.
2. When the deliverable is approved by the client, log the final artifact in the delivery records.

---

### 5. Finalizing Service Delivery

1. Once all services in the customer order are deployed and functioning:
   - Verify that test transactions or API pings execute successfully.
   - Ensure the customer's portal usage bars reflect their active package allowances.
   - Update the internal delivery status to **Delivered / Active**.
2. If the client has an active monthly retainer plan, handover transitions to the designated Relationship Manager for ongoing account health and ticket support.
