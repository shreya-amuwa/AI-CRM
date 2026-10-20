---
title: Amuwa AI CRM Release Notes and Changelog
summary: Historical record of major architectural updates, feature deployments, database migrations, and workflow enhancements in Amuwa AI CRM.
audience: internal
roles:
  - Super Admin
  - Department Head
  - Team Lead
  - Team Member
related:
  - /maintaining/documentation-maintenance
  - /getting-started/platform-overview
  - /reference/status-dictionary
---

# Amuwa AI CRM Release Notes and Changelog

This changelog documents verified product releases, architectural updates, and workflow enhancements across the Amuwa AI CRM platform.

---

## Release: Dynamic Invoicing and Order Tax Basis Architecture
**Milestone:** Enterprise Invoicing & Tax Compliance Release

### Added
- **Explicit Order Tax Basis:** Introduced `EXCLUSIVE` (default: deal amount + 18% GST) and `INCLUSIVE` (all-inclusive price) order classifications.
- **Audited Tax Agreements Review:** Interface enabling Accounts and Super Admins to audit legacy customer agreements with active invoices.
- **Tax Basis Adjustment:** Audited correction mechanism requiring mandatory justification notes and preserving complete historical audit trails.
- **Dynamic PDF Invoice Generator:** Client-side vector PDF generator producing ultra-compact (<500 KB) GST-compliant statements with automatic intra-state (CGST/SGST) and inter-state (IGST) calculations.
- **Official PAID Stamping:** Confirmed invoices receive an authentic green stamped seal with transaction reference metadata.

---

## Release: Client Self-Service Dashboard Portal
**Subsystem Deployment:** `/client/*`

### Added
- **Dedicated Client Authentication:** Separate authentication bundle and routing for corporate clients at `/client/login`.
- **Encrypted Document Vault:** Direct client upload portal for KYC, business registrations, and brand assets, backed by Cloudflare R2 storage with pre-signed URLs (2 MB limit).
- **Two-Way Support Desk:** Real-time interactive ticket chat (#AMW-XXXX) connecting clients directly to assigned Relationship Managers.
- **Activity Calendar:** Interactive deliverable calendar displaying scheduled broadcast launches, strategy reviews, and milestone handovers.
- **Self-Service Invoicing:** Instant PDF downloads of all issued bills and payment receipts.

---

## Release: Technical Consultant & Onboarding Automations
**Subsystem Deployment:** `/technical-support/dashboard`

### Added
- **Customer Verification Workspace:** Dedicated panel for Technical Consultants to inspect, authorize, or reject customer onboarding documents.
- **Automated Client Messaging Pipeline:** Event-driven notification engine delivering staged Email and WhatsApp updates for Wabastore Meta WhatsApp API clients:
  - Stage 1: *Under Review / Website Pending*
  - Stage 2: *Website Ready*
  - Stage 3: *Meta Business Verification (2–3 weeks turnaround)*
  - Stage 4: *Meta Verification Completed & Portal Credentials*
- **Add-on Services Engine:** Independent scoping and quoting of supplemental client requests without blocking primary onboarding delivery.
- **Send to Department Head Handover:** Multi-tier departmental progression (`CONSULTANT` $\to$ `DEPARTMENT_HEAD` $\to$ `TEAM_LEAD` $\to$ `TEAM_MEMBER`).

---

## Release: Attendance and 15-Minute Discrepancy Tracking
**Subsystem Deployment:** `/departments/hr`

### Added
- **Two-Stream Attendance Tracking:** Simultaneous recording of CRM system sign-ins (`rmLoginAt`) and office biometric scanner punches (`biometricLoginAt`).
- **15-Minute Gap Detection:** Automated discrepancy calculation flagging instances where login and biometric punches deviate by more than 15 minutes.
- **Two-Tier Leave Engine:** Structured leave approval hierarchy requiring Department Head approval (Stage 1) followed by HR final signoff (Stage 2).
