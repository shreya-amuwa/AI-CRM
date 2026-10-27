---
title: Welcome to Amuwa AI CRM
description: Official internal operational manual and role-based user guides for Amuwa Corporation staff and external clients.
order: 1
group: Home
roles: [All Roles]
audience: internal
status: verified
sources: [shared/contracts.ts, src/App.tsx, src/lib/auth/roleMapping.ts, docs/ARCHITECTURE.md]
related: [/getting-started/welcome-to-amuwa-crm, /getting-started/understanding-your-role-and-dashboard, /customer-journeys/overview, /reference/roles-and-permissions-matrix]
updated: 2026-10-27
---

Amuwa AI CRM is the central operating system for lead acquisition, commercial qualification, GST payment verification, technical onboarding, service delivery, support, and HR operations across all Amuwa Corporation business units.

![Amuwa AI CRM Executive and Operational Workspace](shot:super-admin-overview.png)

## Choose your documentation portal

Select the documentation portal that matches how you sign in to Amuwa AI CRM:

| Audience | Portal & Sign-In URL | Primary Purpose | Quick Entry |
| --- | --- | --- | --- |
| **Internal Staff (Employee Manual)** | Internal CRM (`https://ai-crm-drab.vercel.app/`) | Role-specific procedures for Sales, Telecallers, Business Associates, Support, Technical Consultants, Accounts, Delivery Departments, HR, Department Heads, and Super Admins. | [Start with Welcome to Amuwa AI CRM](/getting-started/welcome-to-amuwa-crm) |
| **External Clients (Client Help Center)** | Client Dashboard (`/client/login`) | Self-service instructions for viewing active services, campaign usage, monthly plans, GST invoices, onboarding documents, support tickets, team chat, and the activity calendar. | [Open the Client Help Center](/client/welcome-client-portal) |

:::tip Search the documentation instantly with `/`
Press `kbd:/` from anywhere in this documentation site (or click **Search the documentation** in the top bar) to search by task name, role, status badge, checklist item, or error message. Use `kbd:Up` and `kbd:Down` to navigate results and `kbd:Enter` to open a guide.
:::

## Guides by role

Every employee operates inside a role-scoped dashboard mapped automatically by `src/lib/auth/roleMapping.ts`. Find your assigned role below to open your daily operational guides:

| Role / Division | Default Dashboard & Scope | Core Responsibilities | Primary Role Guides |
| --- | --- | --- | --- |
| **Super Admin** | Super Admin Dashboard (`SUPER_ADMIN`) | Company-wide business oversight, department lock/unlock, staff & role administration, access control matrix, service catalogue pricing, tax agreements, client notices, and security audit logs. | [Company Business Oversight](/super-admin/company-business-oversight) · [Staff & Role Administration](/super-admin/staff-and-role-administration) · [Service Catalog Management](/super-admin/service-catalog-management) |
| **Department Head — Combined (`BOTH`) & Support (`SUPPORT`)** | Department Head Dashboard (`DEPARTMENT_HEAD`) | Single-department or multi-department (`ScopeBar` / `Combined`) KPI oversight, team & people management, performance scorecards, customer handovers, ticket SLAs, and work tasks. | [Department Head Overview](/department-head/department-head-overview) · [Shared & Combined Scopes](/department-head/shared-and-combined-scopes) · [Performance & Work Tasks](/department-head/performance-and-work-tasks) |
| **Sales Department Head (`SALES`)** | Sales Department Head Dashboard (`/sales-head/dashboard/:userId`) | Uploading `.xlsx` calling sheets in **Lead Assign**, monitoring Telecaller and Business Associate conversion funnels, managing sales teams, and tracking pipeline revenue. | [Sales Department Head Guide](/department-head/sales-department-head-guide) · [Shared & Combined Scopes](/department-head/shared-and-combined-scopes) |
| **Sales Team Lead** | Sales Team Lead Dashboard (`TEAM_HEAD` · `SALES`) | Managing personal (`My Leads`) and squad-wide (`Team Leads`) 4-stage pipelines, bulk CSV/Excel lead imports, round-robin lead distribution, and daily team tasks. | [Team Lead Pipeline & Tasks](/sales/team-lead-pipeline-and-tasks) |
| **Sales Team Member** | Sales Team Member Dashboard (`TEAM_MEMBER` · `SALES`) | Creating leads (manual or visiting card OCR scan), logging conversations, moving deals to Potential, submitting payment confirmations to Accounts, and collecting the 6 mandatory onboarding items. | [My Leads Overview](/sales/my-leads-overview) · [Creating a Lead](/sales/creating-a-lead) · [Customer Onboarding (Sales)](/sales/customer-onboarding-sales) |
| **Telecaller** | Telecaller Dashboard (`/telecaller/dashboard/:userId`) | Working assigned calling sheets in **Tasks**, updating inline call statuses (`Interested`, `Ready to buy`, `Follow-up`), recording notes, and clicking **Send to BA** to hand warm prospects to Business Associates. | [Telecaller Workspace Guide](/sales/telecaller-workspace-guide) |
| **Business Associate (BA)** | Business Associate Dashboard (`/business-associate/dashboard/:userId`) | Receiving warm leads from Telecallers (`Sent to BA`), closing commercial deals across the 4-stage pipeline (`1 Leads` → `4 Client`), and coordinating payment and onboarding handoffs. | [Business Associate Workspace](/sales/business-associate-workspace) |
| **Support Team Lead & Member** | Support Dashboard (`SUPPORT` division) | Managing private Support referral/upsell pipelines, executing one-sheet existing customer imports, resolving **Client tickets**, reviewing **Client documents**, and logging **Client calendar** touchpoints. | [Support Leads Management](/support/support-leads-management) · [Importing Existing Customers](/support/importing-existing-customers) · [Ticket Inbox & Chat](/support/ticket-inbox-and-chat) |
| **Accounts Department** | Accounts Dashboard (`accounts` department) | Verifying customer payments in **Confirmation**, recording full/part payments with per-installment GST, issuing or uploading GST invoices (up to 500 KB), managing **Finance** expenses, **Monthly Plans**, and **Department Income** attribution. | [Confirming Payment & Invoicing](/accounts/confirming-payment-invoice) · [Recording Payments](/accounts/recording-payments) · [Issuing an Invoice](/accounts/issuing-an-invoice) |
| **Technical Consultant** | Technical Consultant Workspace (`isTechnicalConsultant: true`) | Reviewing the **Customers** intake queue, verifying or rejecting the 6 mandatory onboarding items, provisioning Client Portal logins, submitting add-on service requests, and running **BolifyAI** subscription expiry call automations. | [TC Onboarding Queue](/technical-consultant/onboarding-queue) · [Verifying Checklist Items](/technical-consultant/verifying-checklist-items) · [Automations Setup](/technical-consultant/automations-setup) |
| **Service-Owning Departments** | Delivery Workspace (`Wabastore`, `Whatsbox`, `Wabastar`, `D Talk`, `Wabatalk`, `Digitree Infotech`, `Amuwa Design Studio`, `AI Studio`) | Receiving completed customer handovers in `4 Client`, activating purchased services, fulfilling deliverables, and handling ongoing client support and renewals. | [Managing Delivery Queue](/delivery/managing-delivery-queue) |
| **Human Resources (HR)** | HR Dashboard (`hr` department) | Auditing daily **Attendance** (CRM check-in vs biometric punch with 15-minute grace badges), approving employee **Leave Requests**, managing the **Staff Directory**, and running **Recruitment** & **3-Day Training** cohorts. | [Attendance Monitoring](/hr/attendance-monitoring) · [Leave Approval (HR)](/hr/leave-approval-hr) · [Recruitment & Training Workspace](/hr/recruitment-and-training-workspace) |
| **Client Dashboard Users** | Client Portal (`/client/login`) | Viewing active services and campaign stats, subscribing to monthly plans, requesting add-on services, downloading GST invoices, uploading KYC documents, raising support tickets, and chatting with the account team. | [Welcome to the Client Portal](/client/welcome-client-portal) |

## Popular daily tasks

Jump directly to step-by-step instructions for high-frequency tasks across the CRM:

- **Sign In & Account Setup:** [How to Sign In & Request Account Approval](/getting-started/signing-in-and-account-approval) · [Understanding Your Role & Dashboard](/getting-started/understanding-your-role-and-dashboard) · [Navigating the Workspace](/getting-started/navigating-the-workspace)
- **Lead & Deal Management:** [Create a Lead or Scan a Shop / Visiting Card (OCR)](/sales/creating-a-lead) · [Move a Lead to Potential](/sales/moving-to-potential) · [Track Part-Payment Balances](/sales/tracking-part-payments-sales)
- **Payments & GST Invoicing:** [Confirm Pending Customer Payments](/accounts/confirming-payment-invoice) · [Record Full or Part Payments with GST](/accounts/recording-payments) · [Issue or Upload a GST Invoice](/accounts/issuing-an-invoice)
- **Onboarding & Delivery Handover:** [Complete the 6-Item Sales Onboarding Checklist](/sales/customer-onboarding-sales) · [Verify Onboarding Documents & Provision Client Login](/technical-consultant/verifying-checklist-items) · [Receive Customer Handovers in Service Departments](/delivery/managing-delivery-queue)
- **Customer Migration & Operations:** [One-Sheet Existing Customer Import (Excel/CSV)](/support/importing-existing-customers) · [Upload Telecaller Calling Sheets (Sales Head)](/department-head/sales-department-head-guide) · [Use Internal & Client Chat](/shared/chat-guide)

## End-to-end customer journeys

In Amuwa AI CRM, every customer is stored as a single continuous record that progresses across four core lifecycle stages (`LEAD` → `POTENTIAL` → `ONBOARDING` → `CLIENT`) without duplicate rows across departments.

```flow
1. Lead Acquisition | Sales, Telecaller, BA, or Support | Added in 1 Leads (manual entry, ShopPhotoScan OCR, CSV import, or calling sheet)
2. Commercial Qualification | Sales, BA, or Support | Agreed Deal Amount & services recorded; promoted to 2 Potential
3. Payment Confirmation | Accounts Department | Confirm Payment submitted -> Accounts verifies UTR/proof in Confirmation queue
4. Customer Onboarding | Sales & Technical Consultant | 6 mandatory checklist items collected & verified; Client Portal login provisioned
-> Returned to Sales | Accounts or Technical Consultant | Sent back with mandatory note if payment or compliance documents need correction
5. Department Handover | Department Head & Team Lead | Get Started enabled -> Send to Department Head -> Pass to Team Lead -> Assign to Member
6. Active Client Delivery | Service-Owning Department | Live service activation in 4 Client, Client Portal access, tickets, renewals, and add-ons
```

Explore each end-to-end journey guide in detail:

| Journey Guide | When This Path Applies | Participating Roles |
| --- | --- | --- |
| [General Sales Journey](/customer-journeys/general-sales-journey) | Standard route for technical services (such as Wabastore, Whatsbox, Wabastar, D Talk, and AI Studio) requiring payment verification, the 6-item onboarding checklist, and Technical Consultant authorization. | Sales / BA, Accounts, Technical Consultant, Department Head, Team Lead |
| [Support Referral Journey](/customer-journeys/support-referral-journey) | Existing customer upgrades, renewals, or referrals originated by Support teams with 100% `ACQUISITION` revenue attribution to the Support division (or **Wabatalk** for D Talk Support). | Support Team Member & Lead, Accounts, Technical Consultant |
| [Direct Delivery Journey](/customer-journeys/direct-delivery-journey) | Streamlined route for non-technical catalog services (`requires_technical_consultant: false`, such as Amuwa Design Studio packages) that bypass the Technical Consultant queue. | Sales / Support, Accounts, Service Delivery Department |
| [Part-Payment Journey](/customer-journeys/part-payment-journey) | Onboarding customers on an initial verified installment while tracking remaining balances and per-payment GST (`0%`, `5%`, `12%`, `18%`, `28%`) on GST-exclusive agreements. | Sales / Support, Accounts, Technical Consultant |
| [Customer Backs Off & Returns](/customer-journeys/customer-backs-off) | Safe return workflows when a prospect backs out in `2 Potential` (**Customer backed out**) or is returned from `3 Customer onboarding` (**Return to Sales**) or Accounts. | Sales, Accounts, Technical Consultant |
| [Add-on Services Journey](/customer-journeys/addon-services-journey) | Requesting, pricing, verifying, invoicing, and fulfilling supplemental add-on services during or after onboarding without blocking primary service delivery. | Technical Consultant, Support, Accounts, Client |
| [Client Portal Purchase Journey](/customer-journeys/client-portal-purchase-journey) | Self-service service requests (`Explore Services > Add service`) and subscription plan upgrades (`Monthly Plans`) initiated by customers inside the Client Dashboard. | Client, Support / Technical Consultant, Accounts, Super Admin |

## Core system standards

### Verified ledger accounting
Financial widgets and department income reports reflect real money only. Revenue is counted only when the Accounts department marks a payment entry as `VERIFIED` in the ledger. Unverified or pending entries never inflate revenue totals.

### Single-record lifecycle integrity
A customer record is never cloned when moving between Sales, Accounts, Technical Consulting, and Service Delivery. All conversations, audit events, invoices, and uploaded documents remain attached to one canonical customer ID.

### Strict client portal isolation
External clients sign in exclusively at `/client/login` and interact only with client-safe views. Internal staff notes, pipeline stages, employee directories, and departmental queues are strictly isolated from the Client Dashboard.

## Troubleshooting and reference guides

Need help resolving an error banner, checking a status badge, or verifying role permissions?

- [Common Statuses and Stages (Visual Guide)](/getting-started/common-statuses-and-stages): Complete breakdown of `CustomerStage`, `LeadStatus`, `PaymentStatus`, `AccountsConfirmationStatus`, `HandoverStage`, and `ClientStatus`.
- [Troubleshooting Login and Account Issues](/troubleshooting/login-and-access-issues): Fix invalid credential alerts, `PENDING` approval screens, session eviction notices, and locked accounts.
- [System Roles and Permissions Matrix](/reference/roles-and-permissions-matrix): Authoritative capability matrix across all internal roles, sub-roles, and external clients.
- [Status Dictionary](/reference/status-dictionary): Every status enum across Pipeline, Payments, Onboarding, Handover, Tickets, Leave, and HR.
- [Glossary of Business and Technical Terms](/reference/glossary): Definitions of CRM terminology, tax bases (`EXCLUSIVE`, `INCLUSIVE`, `NA`), revenue attribution modes, and automation terms.
