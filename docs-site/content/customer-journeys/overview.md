---
title: Overview of Customer Lifecycles and Journeys
description: High-level map of how customer records move across departments from initial acquisition to active delivery.
order: 10
roles: [Super Admin, Department Head, Sales Team Member, Support Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [docs/SERVICE_JOURNEYS.md, shared/contracts.ts, docs/LEADS_ONBOARDING.md]
related: [customer-journeys/general-sales-journey, customer-journeys/direct-delivery-journey]
updated: 2026-10-19
---

In Amuwa AI CRM, a customer journey represents the exact path a business follows from lead ingestion to active service delivery. Different services follow different routes depending on whether technical configuration is required.

## Before you start

:::prereq
- Familiarize yourself with the core lifecycle stages: `LEAD`, `POTENTIAL`, `ONBOARDING`, and `CUSTOMER`.
:::

## Journey types in Amuwa AI CRM

Every customer is assigned a journey kind based on the specific services they purchase:

```flow
Services Selected | Sales or Support | Lead or Potential stage
Journey Computed | System | Inspects requires_technical_consultant flag
-> TECHNICAL | Every service needs TC | Routes via Technical Consultant
-> DIRECT | No service needs TC | Skips TC; Accounts creates login; Sales verifies docs
-> MIXED | Some services need TC | Follows Technical Consultant route
```

### The 4 Journey Categories

| Journey Kind | Definition | Workflow Path |
| --- | --- | --- |
| **TECHNICAL** | Every purchased service requires technical setup (e.g. WABA Setup, Meta Verification, Blue Tick). | Sales -> Accounts -> Technical Consultant -> Handover -> Delivery Department |
| **DIRECT** | No purchased service requires a Technical Consultant (e.g. Design Studio graphic design packages). | Sales / Support -> Accounts (Payment + Client Login) -> Sales (Doc Verification) -> Delivery Department |
| **MIXED** | Customer bought both technical and direct services. | Follows TECHNICAL path so all compliance is satisfied; direct services can be dispatched once documents are verified. |
| **NONE** | Lead has not yet selected any services from the catalogue. | Stays in Sales or Support pipeline awaiting qualification. |

## Lifecycle stage transitions

```flow
LEAD | Sales / Support | Initial inquiry and qualification
Move to Potential | Sales Team Member | Requires agreed deal amount & services
POTENTIAL | Sales Team Member | Finalizing proposal & payment terms
Send to Accounts | Sales Team Member | Status: PENDING_PAYMENT_CONFIRMATION
ONBOARDING | Accounts Staff | Payment verified in ledger; requirements collection
Handover Completed | Delivery Team | Customer enters active service status
CUSTOMER | System | Live active customer
```

## Good to know

:::important Journey Stability Rule
Once a customer is sent to a Technical Consultant, their journey remains locked to `TECHNICAL`. Future changes to the service catalog never alter or disrupt customer workflows currently in flight.
:::

:::note Payment Verification Prerequisite
A customer cannot move to `ONBOARDING` or active service delivery until Accounts verifies at least one part or full payment in the official ledger.
:::

## If something goes wrong

If a customer appears stalled between departments, see [Handover and Progression Blockers](/troubleshooting/handover-and-progression-blockers).
