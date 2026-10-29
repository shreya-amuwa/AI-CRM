---
title: Amuwa AI CRM Release Notes and Changelog
description: Historical record of major architectural updates, feature deployments, database migrations, and workflow enhancements in Amuwa AI CRM.
order: 1
group: Changelog
audience: internal
roles:
  - Super Admin
  - Department Head
  - Team Lead
  - Team Member
status: verified
updated: 2026-10-27
related:
  - /maintaining/documentation-maintenance
  - /getting-started/welcome-to-amuwa-crm
  - /reference/status-dictionary
---

This changelog documents verified product releases, architectural updates, and workflow enhancements across the Amuwa AI CRM platform.

---

## Release: Handover date, client credentials, Accounts e-mails, installments, invoice layout
**Area:** Accounts, Meta Verifier, Sales, invoices

### Added
- **Handover date is automatic:** the first handover is stamped by the database and each handover writes a line in the history; the manual "Target handover / Set date" step is gone.
- **Temporary password for the Client Dashboard login** (Accounts > Client Logins) with a forced change at the first sign-in, and the **panel password** the Meta Verifier sets on the customer's WhatsApp panel, e-mailed to the customer once and never stored.
- **Installment helper** in Record payment (Part payment only): splits what is still to receive into two proposed installments; the second is a plan, not a payment.

### Changed
- **Payment e-mails reach every active Accounts member** (one e-mail each).
- **Invoice e-mails** greet the customer's contact person; the PDF keeps the business name.
- **Invoice PDF** margins and padding of the payment block, footer and PAID stamp.
- **"Crocodile" is now "Crocodial"** (same service, same code).
- Run `supabase/run_these_3_migrations_handover_accounts_email_credentials.sql` once and set `AUTOMATION_SECRET_KEY`. Details: `docs/CREDENTIALS_AND_NOTIFICATIONS.md`.

---

## Release: Field Visit in the Sales member dashboards
**Area:** Sales (Telecaller, Business Associate, Sales Team Member, Sales Department Head)

### Added
- **Field Visit group:** a sidebar group of ten pages inside the existing dashboards (no separate dashboard): Overview with six cards and ten filters, Department Head Assigned Leads, Add Lead, All Leads, My Leads, Department Leads, To Accounts, Returned by Accounts, My Field Visits and Visit History.
- **Visits that belong to a lead:** schedule, start, record the outcome (Completed or Follow-up Required) and cancel; every visit of a lead is kept in its own history. A position is recorded only when the device shares it and is never called verified.
- **Department Head assignment:** the Sales Department Head assigns a lead for a visit from **Leads > Lead List** with a priority and instructions. The lead keeps its owner and the employee cannot change the assignment.
- **Lead source "Field visit"** in the lead forms.

### Changed
- Nothing existing was removed. The Accounts workflow, lead ownership and the Support dashboards are unchanged. Run `supabase/run_this_sales_field_visits.sql` once.

---

## Release: Dynamic Invoicing and Order Tax Basis Architecture
**Milestone:** Enterprise Invoicing & Tax Compliance Release

### Added
- **Explicit Order Tax Basis:** An agreement records whether the agreed amount includes GST (`INCLUSIVE`) or GST is added on top (`EXCLUSIVE`). Send to Accounts asks, and starts on excluding GST. Older agreements stay `INCLUSIVE`.
- **One order balance:** The total payable (GST included), the confirmed payments and the order balance are worked out by the database and shown the same on the invoice PDF, the Accounts screens and the client dashboard. An invoice's own balance is shown apart from the order balance.
- **Agreement reconciliation:** Accounts can correct an agreement's basis from the Invoice Builder with a mandatory reason (audited). Older agreements that already have invoices can be listed through the API for review; nothing is rewritten automatically.
- **Dynamic PDF Invoice Generator:** Server-side vector PDF generator producing ultra-compact (<500 KB) GST-compliant statements with automatic intra-state (CGST/SGST) and inter-state (IGST) calculations.
- **Official PAID Stamping:** A fully paid invoice gets a PAID stamp on its paid PDF.

---

## Release: Client Self-Service Dashboard Portal
**Area:** Client dashboard

### Added
- **Dedicated Client Authentication:** Separate authentication bundle and routing for corporate clients at `/client/login`.
- **Encrypted Document Vault:** Direct client upload portal for KYC, business registrations, and brand assets, backed by Cloudflare R2 storage with pre-signed URLs (2 MB limit).
- **Two-Way Support Desk:** Real-time interactive ticket chat (#AMW-XXXX) connecting clients directly to assigned Relationship Managers.
- **Activity Calendar:** Interactive deliverable calendar displaying scheduled broadcast launches, strategy reviews, and milestone handovers.
- **Self-Service Invoicing:** Instant PDF downloads of all issued bills and payment receipts.

---

## Release: Technical Consultant & Onboarding Automations
**Area:** Technical Consultant dashboard

### Added
- **Customer Verification Workspace:** Dedicated panel for Technical Consultants to inspect, authorize, or reject customer onboarding documents.
- **Automated Client Messaging Pipeline:** Event-driven notification engine delivering staged Email and WhatsApp updates for Wabastore Meta WhatsApp API clients:
  - Stage 1: *Under Review / Website Pending*
  - Stage 2: *Website Ready*
  - Stage 3: *Meta Business Verification (2–3 weeks turnaround)*
  - Stage 4: *Meta Verification Completed & Portal Credentials*
- **Add-on Services Engine:** Independent scoping and quoting of supplemental client requests without blocking primary onboarding delivery.
- **Send to Department Head Handover:** Multi-tier departmental progression (`CONSULTANT` -> `DEPARTMENT_HEAD` -> `TEAM_LEAD` -> `TEAM_MEMBER`).

---

## Release: Attendance and 15-Minute Discrepancy Tracking
**Area:** HR department

### Added
- **Two-Stream Attendance Tracking:** Simultaneous recording of CRM system sign-ins (`rmLoginAt`) and office biometric scanner punches (`biometricLoginAt`).
- **15-Minute Gap Detection:** Automated discrepancy calculation flagging instances where login and biometric punches deviate by more than 15 minutes.
- **Two-Tier Leave Engine:** Structured leave approval hierarchy requiring Department Head approval (Stage 1) followed by HR final signoff (Stage 2).
