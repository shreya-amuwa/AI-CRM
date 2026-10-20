---
title: Amuwa AI CRM Glossary of Business and Technical Terms
summary: Comprehensive definitions of business terms, system concepts, financial metrics, and architectural components used across Amuwa AI CRM.
audience: internal
roles:
  - Super Admin
  - Department Head
  - Team Lead
  - Team Member
related:
  - /reference/status-dictionary
  - /reference/roles-and-permissions-matrix
  - /faq/general-crm-faq
---

# Amuwa AI CRM Glossary of Business and Technical Terms

This glossary provides authoritative definitions for core business concepts, financial indicators, and system terms used throughout Amuwa AI CRM.

---

### Add-on Service
A supplemental capability or deliverable requested by a customer during or after technical onboarding (e.g., custom WhatsApp chatbots, extra phone numbers, or creative design templates). Billed independently without blocking primary onboarding.

### Agreement Basis (Order Tax Basis)
The agreed contractual tax structure governing an order:
- **`EXCLUSIVE`:** The agreed deal amount represents the net taxable value of services; standard 18% GST is added on top.
- **`INCLUSIVE`:** The agreed deal amount represents the gross total payable figure including 18% GST.

### Biometric Punch (`biometricLoginAt`)
The timestamp recorded when an employee scans their physical credential at the office door scanner. Correlated against the CRM login time to compute attendance punctuality.

### Client Portal (`/client/login`)
The external, authenticated dashboard for corporate customers to track active services, view deliverables on the activity calendar, upload KYC documents, download stamped invoices, and submit support tickets.

### Customer Onboarding
The operational phase following payment confirmation where client verification files (KYC, GST, Business Registration) and technical configurations (WABA ID, Webhook endpoints) are reviewed and authorized.

### Department Handover
The formal transfer of an authorized customer dossier from a Technical Consultant to the responsible Department Head, who routes it to a Team Lead for service delivery execution.

### Deal Amount
The commercial value agreed between sales staff and a prospect before payment. Must be greater than ₹0 to qualify as a Potential Customer.

### Direct Delivery Journey
A fulfillment workflow designed for creative and design solutions (such as Amuwa Design Studio brand identity packages) that bypasses the Technical Consultant. Accounts provisions client credentials, Sales verifies briefs, and delivery begins immediately.

### Inbound Leads
Prospects generated through digital marketing campaigns, website inquiry forms, or external webhooks that have not yet been claimed by or assigned to an individual salesperson.

### Outstanding Balance
The remaining gross amount due on a customer's order ($ \text{Total Payable} - \text{Verified Payments} $).

### SAC Code (Service Accounting Code)
A standardized 6-digit classification code (e.g., `998314` for IT & Software Services) mandated by Indian GST authorities for service taxation.

### Technical Consultant (TC)
A specialized Support Team Member empowered to review and authorize technical documents, provision official WhatsApp Business IDs, trigger onboarding automations, and generate client portal credentials.

### WhatsApp Business Account (WABA ID)
The official 15- to 18-digit numeric identifier provisioned by Meta for enterprise WhatsApp Business API deployments.
