---
title: How to Return a Customer to Sales for Re-verification
description: Step-by-step instructions for Technical Consultants to reject invalid or incomplete customer documents and return the onboarding card to the sales representative.
order: 7
group: Technical Consultant
audience: internal
roles:
  - Technical Consultant
  - Sales Team Lead
  - Sales Team Member
status: verified
updated: 2026-10-27
related:
  - /technical-consultant/verifying-checklist-items
  - /technical-consultant/onboarding-queue
  - /sales/managing-returned-leads
---

When a customer's submitted documents are illegible, expired, mismatched with business registrations, or incomplete, the Technical Consultant must mark the defective items as **Not authorized** and return the customer record to Sales.

Returning a customer prevents defective documents from progressing to delivery departments and alerts the original sales owner to contact the customer for replacements.

---

## Prerequisites

- You must be authenticated as a **Technical Consultant** (or Support Team Member assigned to technical onboarding).
- The customer card must be in your active **Onboarding queue**.
- At least one checklist item must be evaluated and marked **Not authorized** with a concrete rejection reason.
- The record must not already be in a `WAITING_ON_SALES` state.

---

## Step-by-Step Procedure

### 1. Identify and Flag Defective Items

1. In the **Onboarding queue**, select the customer card to open the **Customer Verification Workspace**.
2. Scroll to the **Required Documents & Configuration** checklist.
3. For each defective document or field:
   - Click the **Not authorized** button.
   - In the reason prompt, select or type a specific explanation (for example: *"GST Certificate page 2 is missing"* or *"Aadhaar copy is blurry and unreadable"*).
   - Save the rejection.
4. Notice that the customer header displays a warning banner:
   > **[N] item(s) marked Not authorized.** Click "Send back for re-verification" to return this customer to the salesperson.

---

### 2. Open the Return Confirmation Dialog

1. Locate the top action toolbar on the customer workspace.
2. Click the red **Send back for re-verification** button (with the `RotateCcw` icon).
3. The confirmation dialog will appear:
   - **Dialog Title:** `Send back for re-verification`
   - **Target Recipient:** Displays the name of the assigned salesperson (e.g., *"Assigned to Rahul Sharma"*).
   - **Summary of Rejected Items:** Lists every item marked *Not authorized* along with your recorded reasons.

---

### 3. Record the Sales Re-verification Note

1. In the **Return Note for Sales** field, provide actionable guidance:
   - Specify exactly what the salesperson must request from the client.
   - Mention any deadlines or specific formats needed (e.g., *"Customer must provide original color scan of PAN card in PDF under 2 MB"*).
2. Review the summary for accuracy.

---

### 4. Submit the Return

1. Click **Confirm & Send Back**.
2. The system executes the atomic workflow:
   - Sets `returned_at` timestamp on `customer_onboarding`.
   - Stores your audit message in `return_note`.
   - Sends a high-priority notification to the assigned salesperson.
   - Transitions the customer status badge to **Waiting for sales team** (`WAITING_ON_SALES` in lavender styling).

---

## What Happens Next

| Stakeholder | System State & Action |
| :--- | :--- |
| **Technical Consultant** | The workspace switches to read-only mode with the notice: *"Sent back to [Salesperson] on [Date] for re-verification. You can authorize again once they fix the items and send it back."* |
| **Salesperson** | The customer appears in their Sales panel under **Returned from Technical Consultant** with rejected items highlighted in red. |
| **Customer / Client** | Sales contacts the customer to collect corrected files and uploads them into the onboarding checklist. |
| **Re-submission** | Once all rejected items have new files or corrected values, the salesperson clicks **Send back to Technical Consultant**, returning the card to your **Review pending** tab. |

---

## Important Rules

:::warning
**Do not return without specific notes:** A vague rejection like *"Wrong doc"* causes friction and delays client delivery. Always state the precise defect and the exact document required.
:::

:::note
**Add-on requests are not affected:** If an add-on request is concurrently pending verification with Accounts, returning the core onboarding record to Sales does not cancel the add-on invoice.
:::
