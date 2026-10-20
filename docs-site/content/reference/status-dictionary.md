---
title: System Status Dictionary and Workflow Codes
summary: Comprehensive reference guide to all system statuses, lifecycle states, badge styles, and database enumeration codes across Amuwa AI CRM.
audience: internal
roles:
  - Super Admin
  - Department Head
  - Team Lead
  - Team Member
related:
  - /reference/glossary
  - /reference/roles-and-permissions-matrix
  - /customer-journeys/overview
---

# System Status Dictionary and Workflow Codes

This dictionary details every operational status code, visual badge style, and transition rule across the core CRM lifecycles.

---

## 1. Customer Lifecycle Stages (`lifecycle_stage`)

| Code | UI Label | Badge Tone | Business Meaning |
| :--- | :--- | :--- | :--- |
| `LEAD` | Leads (Tab 1) | Slate | Early-stage inquiry; deal value undefined. |
| `POTENTIAL` | Potential Customers (Tab 2) | Blue | Commercial deal amount > ₹0 agreed; services selected. |
| `ONBOARDING` | Customer Onboarding (Tab 3) | Indigo | Accounts confirmed payment; checklist verification underway. |
| `CUSTOMER` | Active Customer | Emerald | Onboarding concluded; active services running. |

---

## 2. Technical Consultant Verification States (`review_state`)

| Code | UI Label | Badge Tone | Definition |
| :--- | :--- | :--- | :--- |
| `AWAITING` | Awaiting documents | Slate | No documents or values saved yet. |
| `REVIEW_PENDING` | Review pending | Amber | Files uploaded or saved; awaiting consultant inspection. |
| `NEEDS_ATTENTION` | Needs attention | Rose | At least one item marked *Not authorized*. |
| `WAITING_ON_SALES` | Waiting for sales team | Lavender | Sent back to sales for document corrections. |
| `AUTHORIZED` | Authorized | Emerald | All required documents and consultant items authorized. |
| `HANDED_OVER` | Handed over | Sky Blue | Successfully transferred to Department Head. |

---

## 3. Departmental Handover Stages (`handover_stage`)

| Code | Meaning | Active Stakeholder |
| :--- | :--- | :--- |
| `CONSULTANT` | Document verification and client login creation. | Technical Consultant |
| `DEPARTMENT_HEAD` | Waiting for operational squad lead assignment. | Department Head |
| `TEAM_LEAD` | Waiting for specialist task allocation. | Team Lead |
| `TEAM_MEMBER` | Active execution, API configuration, and delivery. | Delivery Team Member |

---

## 4. Payment & Ledger Statuses (`payment_status`)

| Code | Visual Badge | Ledger Meaning |
| :--- | :--- | :--- |
| `UNPAID` | Red Pill | No payments recorded. |
| `PENDING` | Amber Pill | Payment entered; awaiting Accounts verification. (Does not reduce balance). |
| `PARTIAL` | Orange Pill | Verified payments are less than the total order amount. Remaining balance due. |
| `PAID` | Emerald Pill | Total verified payments equal or exceed gross payable ceiling. |
| `REVERSED` | Slate Pill | Payment officially reversed by management for refund or correction. |

---

## 5. Invoice Statuses (`invoice_status`)

| Code | Description | PDF Stamping |
| :--- | :--- | :--- |
| `ISSUED` | Invoice issued to client; awaiting settlement. | Unstamped itemized bill. |
| `PAID` | Payment applied and confirmed by Accounts. | Stamped with green official **PAID** seal. |

---

## 6. Employee Leave Statuses (`leave_status`)

| Code | Visual Badge | Stage Responsibility |
| :--- | :--- | :--- |
| `PENDING_DEPARTMENT_HEAD` | Amber | Stage 1 review: Department Head assesses operational coverage. |
| `PENDING_HR` | Blue | Stage 2 review: Human Resources audits quota balances. |
| `APPROVED` | Green | Authorized: Deducts leave balance and updates attendance register. |
| `REJECTED_BY_DEPARTMENT_HEAD` | Red | Declined at Stage 1 with mandatory operational note. |
| `REJECTED_BY_HR` | Red | Declined at Stage 2 with mandatory policy note. |

---

## 7. Support Ticket Lifecycle (`ticket_status`)

| Code | Description | SLA Clock Behavior |
| :--- | :--- | :--- |
| `OPEN` | Newly logged ticket awaiting triage. | SLA Clock Running |
| `IN_PROGRESS` | Assigned agent actively investigating. | SLA Clock Running |
| `WAITING_ON_US` | Client replied; awaiting internal response. | SLA Clock Running |
| `WAITING_ON_CLIENT` | Agent replied; awaiting client input. | SLA Clock Paused |
| `ESCALATED` | SLA breached; escalated to Team Lead or Dept Head. | Critical Alert |
| `RESOLVED` | Solution deployed and confirmed. | Clock Stopped |
| `CLOSED` | Concluded and archived. | Inactive |
