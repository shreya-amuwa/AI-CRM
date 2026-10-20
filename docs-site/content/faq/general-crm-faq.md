---
title: General CRM Frequently Asked Questions (FAQ)
summary: Answers to common operational, navigation, permission, and workflow questions across all departments in Amuwa AI CRM.
audience: internal
roles:
  - Super Admin
  - Department Head
  - Team Lead
  - Team Member
related:
  - /faq/billing-and-payments-faq
  - /getting-started/platform-overview
  - /reference/glossary
---

# General CRM Frequently Asked Questions (FAQ)

Find answers to common questions regarding day-to-day operations, lead management, role assignments, and system behavior.

---

### Q1: What is the primary difference between a Lead, a Potential Customer, and a Customer?
- **Lead (Tab 1):** An early-stage inquiry or inbound interest without an agreed deal value.
- **Potential Customer (Tab 2):** A qualified prospective buyer with an agreed deal value (> ₹0) undergoing active sales negotiations and service selection.
- **Customer Onboarding (Tab 3):** A client who has made a confirmed payment (full or partial) verified by Accounts, actively completing checklist requirements and technical onboarding.

---

### Q2: Why can't I edit customer details after they are sent to Accounts?
Once a salesperson clicks **Send to Accounts**, the customer record is locked in read-only status for Sales to prevent unauthorized modifications while Accounts audits the agreed financial terms. If changes are necessary, Accounts can return the customer with a note, or Sales can update non-financial fields after payment confirmation.

---

### Q3: What is the difference between a Technical Journey and a Direct Journey?
- **Technical Journey:** Mandatory for software, conversational AI, and Meta WhatsApp Business API solutions. Requires a Technical Consultant to authorize verification documents, collect WABA IDs, trigger automated client messaging, and provision client portal logins.
- **Direct Journey:** Designed for creative solutions (e.g., Amuwa Design Studio brand kits). Bypasses the Technical Consultant; Accounts provisions the client login, Sales verifies creative briefs, and the order routes straight to the delivery team.

---

### Q4: How does the attendance discrepancy tracking work?
Amuwa AI CRM automatically logs the employee's web CRM login time (`rmLoginAt`) and compares it against their physical biometric office scan time (`biometricLoginAt`). If the gap between the two exceeds **15 minutes**, the system automatically flags an attendance discrepancy badge for HR review.

---

### Q5: Can a client see internal notes or conversation history?
**No.** All sales conversation notes (`lead_conversations`), technical consultant notes, and staff-only ticket notes tagged `#INTERNAL_NOTE` are strictly internal. Clients only see content specifically published to their dashboard, such as calendar events, official invoice PDFs, and client-facing ticket replies.
