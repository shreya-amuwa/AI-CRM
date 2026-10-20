---
title: Welcome to Amuwa AI CRM
description: Comprehensive operational manual and role-based guides for Amuwa Corporation employees and clients.
audience: internal
status: verified
sources: [shared/contracts.ts, src/App.tsx, docs/ARCHITECTURE.md]
updated: 2026-10-19
---

Amuwa AI CRM is the central operating system for customer acquisition, service delivery, payment tracking, and support across Amuwa Corporation business units. This portal provides complete, task-oriented user manuals for every internal department and customer-facing dashboard.

:::tip How to use this documentation
Find your role in the navigation sidebar or use the search bar (**Ctrl+K** or **Cmd+K**) to search by task name, error message, or feature.
:::

## Choose your role guide

Every employee operates with role-based access tailored to their department. Select your role to open the step-by-step procedures you use daily:

| Department / Role | Primary Responsibilities | Quick Link |
| --- | --- | --- |
| **Sales Team Member & Lead** | Inbound leads, customer qualification, service selection, handover to Accounts | [Sales Guide](/sales/my-leads-overview) |
| **Support Team Member & Lead** | Support leads, relationship management, ticket inbox, client calendar activity | [Support Guide](/support/support-leads-management) |
| **Accounts Department** | Payment confirmation, dynamic two-stage GST invoices, part payments, business attribution | [Accounts Guide](/accounts/payment-confirmation-queue) |
| **Technical Consultant** | Onboarding review, document authorization, client login creation, add-on requests | [Technical Consultant Guide](/technical-consultant/onboarding-queue) |
| **Service Departments** | Wabastore, Meta Ads, Design Studio, and AI Studio service delivery queues | [Service Departments](/delivery/delivery-departments-overview) |
| **Department Head** | Department workload oversight, customer handovers, leave approvals, ticket SLAs | [Department Head Guide](/department-head/department-head-overview) |
| **Super Admin (Leadership)** | Department management, staff access, service catalog routes, business reporting | [Super Admin Guide](/super-admin/department-hub-management) |
| **Human Resources (HR)** | Attendance discrepancy monitoring (RM vs Biometric), staff directory, leave reviews | [HR Guide](/hr/attendance-monitoring) |
| **External Clients** | Service tracking, document uploads, invoices, tickets, and calendar insights | [Client Dashboard Guide](/client/welcome-client-portal) |

## Key end-to-end workflows

A customer moves through several departments during their lifecycle. Understand how responsibilities transition:

```flow
Lead Created | Sales or Support Team Member | My Leads > Add Lead
Move to Potential | Sales Team Member | Requires agreed deal amount
Send to Accounts | Sales Team Member | Status: PENDING_PAYMENT_CONFIRMATION
Payment Verified | Accounts Staff | Amount verified in ledger; customer moves to Onboarding
Technical Consultation | Technical Consultant | Requirements reviewed & client login created
-> Direct Service | Skips Consultant | Accounts provisions login; Sales verifies documents
Department Handover | Department Head & Team Lead | Customer assigned to Delivery Department
Service Delivery | Delivery Team Member | Active delivery in Webstore, Meta, or Studio
```

Explore all variations in [Customer Journeys](/customer-journeys/overview):
- [General Sales Journey](/customer-journeys/general-sales-journey): Standard route through Sales, Accounts, Technical Consultant, and Delivery.
- [Support Referral Journey](/customer-journeys/support-referral-journey): Support-originated leads and cross-sell handoffs.
- [Direct Delivery Journey](/customer-journeys/direct-delivery-journey): Faster route for eligible services (such as Design Studio) that skip technical review.
- [Part-Payment Journey](/customer-journeys/part-payment-journey): Rules for customers paying in installments.
- [Customer Backs Off](/customer-journeys/customer-backs-off): Safe return procedures when a deal is delayed or rejected.
- [Add-on Services Journey](/customer-journeys/addon-services-journey): Mid-contract upsells and supplemental service invoicing.

## Core system standards

### Real-time ledger accounting
All financial figures in the CRM represent real money. Income is counted only when Accounts marks a payment as `VERIFIED` in the ledger. Unverified entries remain pending and are never counted as revenue.

### Customer identity integrity
A customer is a single database record that progresses through stages (`LEAD` -> `POTENTIAL` -> `ONBOARDING` -> `CUSTOMER`). Records are never duplicated between queues, ensuring complete history and audit trails.

### Secure client isolation
The [Client Dashboard](/client/welcome-client-portal) is completely isolated from internal staff operations. Clients sign in via `/client/login` and can never access internal notes, staff queues, employee directories, or database functions.

## Need immediate help?

- If you encounter a login problem, missing customer, or upload failure, check [Troubleshooting](/troubleshooting/login-and-access-issues).
- Check the [Glossary and Reference](/reference/glossary) for clear definitions of system statuses, tax bases, and metrics.
- Read [Frequently Asked Questions](/faq/general-crm-faq) for fast answers to common questions.
