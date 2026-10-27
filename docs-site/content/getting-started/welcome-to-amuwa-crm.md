---
title: Platform Overview and Business Structure
description: Overview of the Amuwa AI CRM platform, its 8 revenue and service departments, corporate units, and end-to-end customer lifecycle.
order: 10
group: Core Onboarding
roles: [All Roles]
audience: internal
status: verified
sources: [src/App.tsx, shared/contracts.ts, src/lib/auth/roleMapping.ts, docs/ARCHITECTURE.md]
related: [/getting-started/signing-in-and-account-approval, /getting-started/understanding-your-role-and-dashboard, /customer-journeys/general-sales-journey]
updated: 2026-10-27
---

Amuwa AI CRM is the unified operational platform connecting lead acquisition, commercial qualification, GST payment verification, technical onboarding, service delivery, customer support, and HR operations across all Amuwa Corporation business units.

![Super Admin Overview Dashboard](shot:super-admin-overview.png)

## Before you start

:::prereq
- You must have an active corporate staff account approved by your Department Head, HR, or Super Admin.
- Use the internal staff portal (`https://ai-crm-drab.vercel.app/`) for employee operations, or direct external customers to the Client Dashboard (`/client/login`).
:::

## Business units and organizational structure

Amuwa AI CRM organizes company operations into **8 revenue and service-owning units** and **2 corporate control units**, all supervised from the Super Admin executive workspace.

### 1. Revenue and service-owning units (8 units)

| Business Unit | Slug / Facet | Core Services & Operational Scope |
| --- | --- | --- |
| **Wabastore** | `wabastore` | Official WhatsApp Business API (WABA) onboarding, mini-websites, e-commerce catalogs, automated messaging, and Blue Tick verification. |
| **Whatsbox** | `whatsbox` | Multi-agent shared inbox, customer communication automation, broadcast campaigns, and CRM messaging integrations. |
| **Wabastar** | `wabastar` | High-volume enterprise WhatsApp marketing, conversational funnels, and template campaign management. |
| **D Talk** | `dtalk` | Enterprise cloud telephony, IVR systems, voice broadcasting, and outbound/inbound calling infrastructure (Sales & Delivery). |
| **Wabatalk** | `wabatalk` (`facet_of: 'dtalk'`, `facet_division: 'SUPPORT'`) | Dedicated Support division facet of **D Talk**. Manages existing customer upgrades, renewals, support tickets, and receives 100% `ACQUISITION` revenue attribution on D Talk Support-led sales. |
| **Digitree Infotech** | `digitree` | Digital branding, performance marketing, Meta Ads management, SEO, and web/software engineering solutions. |
| **Amuwa Design Studio** | `design-studio` | Creative brand identity packages, logo design, marketing collateral, social media creatives, and direct-delivery design services. |
| **AI Studio** | `ai-studio` | Conversational AI agents, **BolifyAI** automated voice reminder calling, custom LLM workflows, and intelligent business automation. |

### 2. Corporate and governance units (2 units)

| Corporate Unit | Slug | Core Responsibilities |
| --- | --- | --- |
| **Accounts Department** | `accounts` | Payment confirmation (`Confirmation` queue), full and part-payment ledger recording with per-installment GST, GST invoice generation and PDF uploads, department income attribution, expense tracking, and monthly subscription plans. |
| **Human Resources (HR)** | `hr` | Daily attendance auditing (CRM check-in vs biometric punch with 15-minute grace indicators), two-stage leave approvals, staff directory management, candidate recruitment pipeline, and the 3-Day Training program. |

## Internal Staff CRM vs Client Dashboard

Amuwa AI CRM maintains a strict security and routing boundary between internal employees and external customers:

| Feature | Internal Staff CRM | External Client Dashboard |
| --- | --- | --- |
| **Sign-In Entry Point** | `https://ai-crm-drab.vercel.app/` (`/login`) | `/client/login` (and `/client/set-password` for first-time setup) |
| **Target Users** | Super Admin, Department Heads, Team Leads, Sales, Telecallers, Business Associates, Support, Technical Consultants, Accounts, HR | Authorized business customers and client point-of-contact users |
| **Available Tools** | 4-stage sales pipeline, calling sheets, payment confirmation ledger, invoice builder, onboarding verification, HR & audit logs | **Overview**, **My Services**, **Monthly Plans**, **Explore Services**, **Invoices & Payments**, **Documents**, **Support Tickets**, **Chat with Team**, and **Calendar** |
| **Documentation Manual** | This Internal Employee Manual | [Client Help Center](/client/welcome-client-portal) |

## End-to-end customer lifecycle

Unlike disconnected spreadsheets or legacy tools, Amuwa AI CRM maintains a **single canonical database record** for each customer from initial inquiry to active service delivery:

```flow
1. Lead (1 Leads) | Telecaller, Sales Member, BA, or Support | Prospect created via Add lead, ShopPhotoScan OCR, CSV import, or calling sheet
2. Potential (2 Potential) | Sales Member, BA, or Support | Commercial terms, services, and Deal Amount recorded; ready for payment confirmation
3. Payment Confirmation | Accounts Department | Sales clicks Confirm Payment -> Accounts verifies payment in Confirmation queue
4. Onboarding (3 Customer onboarding) | Sales & Technical Consultant | 6 mandatory checklist items collected and verified; Client Portal login created
-> Returned for Correction | Accounts or Technical Consultant | Returned to Sales with mandatory rejection reason if payment or documents fail review
5. Department Handover | Department Head & Team Lead | TC clicks Send to Department Head -> Head passes to Team Lead -> Assigned to Relationship Manager
6. Active Client (4 Client) | Service-Owning Department & Support | Services activated, Client Portal live, touchpoints logged on Client calendar, renewals & add-ons
```

## What you should see

:::result
When you sign in to Amuwa AI CRM, the application automatically identifies your profile role, department, and division (`SALES` or `SUPPORT`) and opens your dedicated workspace with real-time notifications and role-scoped queues.
:::

## Good to know

:::note Department Data Isolation
Row-Level Security (RLS) policies in the database ensure that staff members only view and modify records belonging to their authorized department, division, or assigned scope.
:::

:::tip Real-time Workspace Updates
Pipeline counts, payment confirmations, chat messages, and notification alerts update live via shared realtime channels without requiring manual page reloads.
:::

## If something goes wrong

If you cannot sign in or your account shows a pending status screen, see [Signing In and Account Approval](/getting-started/signing-in-and-account-approval) or [Troubleshooting Login and Access Issues](/troubleshooting/login-and-access-issues).
