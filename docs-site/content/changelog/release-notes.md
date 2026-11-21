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

## Release: Incentive withdrawals
**Area:** Sales, Accounts

### Added
- **Withdraw** on My Income: save payout details (bank, UPI or international), ask for a withdrawal, follow it and download the payout slip. My Income now shows **My Earnings** next to **Balance** (withdrawn so far, available to withdraw). See [Withdraw your income](/sales/withdraw-your-income).
- **Accounts > Finance > Payout requests**: pay (reference, date, TDS) or reject withdrawals, and pay final settlements to people who left. See [Pay payout requests](/accounts/pay-payout-requests).

---

## Release: Sales incentives and My Income
**Area:** Sales, Super Admin

### Added
- **My Income** in every Sales dashboard: today, this month, total and balance, target progress, this month's activity and the list of earnings. See [My Income](/sales/my-income).
- **Incentive setup**: the Super Admin creates, edits, stops and deletes incentive rules; heads and Team Leads set what the people below them get; the Sales Department Head sets the telecaller and Business Associate split. See [Incentive setup](/sales/incentive-setup).
- **The client's authorised person attended** tick on completed demos in **Demo Schedule**.

---

## Release: Invoice series, customer revenue, split expenses, Department Head e-mails, Client Panel URL, hand-over queue
**Area:** Accounts, Meta Verifier, Department Head

### Added
- **Two invoice series per financial year**, assigned by the database: `GST/26-27/001` and `Amuwa/26-27/001`. Typing a number is no longer possible; the number on the PDF, e-mail and WhatsApp is the saved one.
- **Accounts > Customer Revenue**: purchased, invoiced, collected, pending and outstanding kept apart, per customer, with filters.
- **One expense, several departments**: department rows with a running total; stored once, reported per department, counted once in the company total.
- **Department Head e-mails** when a payment is recorded, a payment is verified, or an expense is allocated (only that department's amount), with per-recipient status, retries and a no-head escalation (**Accounts > Finance e-mails**).
- **Client Panel URL** per customer and service (Client login details): HTTPS only, no credentials in the link, audited; the link is e-mailed on request, once per link.
- The Status Completed e-mail and WhatsApp use the customer's own panel URL.

- **Operations Head options and dashboard:** when the role is *Operations Head*, the form offers *Sales Operations Head*, *Support Operations Head* or *Sales & Support Operations Head*, and the person opens the **Operations Head Dashboard** on the *Operations Dashboard* page by default (Sales side included) instead of the Department Head dashboard. Nothing in the database changes.

### Fixed
- **Department Head "Client hand-overs" was empty** for Support-side heads: they could not read customers owned by Sales teams once handed over. Fixed, and the page text no longer says that only Technical Consultant-verified customers appear. The Technical Consultant's consultation is a separate follow-up. A reconciliation report and one audited action cover customers handed over before the follow-up existed.
- A paid add-on or invoice payment could miss its Department Head e-mail (caught by a new test).

### Needs manual configuration outside the repository
- The WhatsApp Automation Builder needs a branch for `status = "Website Ready"` (`stage_code = WEBSITE_READY`) and the condition for `Meta Verification` (pending) must be separate from `Status Completed`. See `docs/ACCOUNTS_FINANCE_AND_WORKFLOW.md`.

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
