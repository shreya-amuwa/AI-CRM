---
title: Confirming Panel Activation and the Subscription Start
description: Record the panel creation and activation dates, let the system calculate the expiry, retry the activation e-mail, correct a date and confirm a renewal.
order: 40
group: Client Setup
roles: [Meta Verifier, Technical Consultant, Support Team Member, Department Head, Super Admin]
audience: internal
status: verified
sources: [src/components/journey/SubscriptionPanel.tsx, src/components/journey/SubscriptionTerms.tsx, supabase/migrations/20261210000200_subscription_activation.sql]
related:
  - /technical-consultant/provisioning-client-login
  - /sales/creating-a-lead
updated: 2026-10-30
---

A customer's subscription starts on the day the panel is **really created and activated**, not when documents are approved and not when Sales closes the deal. You record that day in the **Subscription** card on the customer; the system calculates the expiry date from the duration Sales selected.

## Before you start

:::prereq
- Sales has set the plan, duration and amount (you will see "duration not set" if not - ask Sales).
- Payment is confirmed, Meta verification is completed where it applies, the Relationship Manager is assigned and every document of the service is authorized.
- The panel has been created **and** activated.
:::

## Confirm the activation

1. Open the customer and find the **Subscription** card.
2. Choose **Confirm panel activation**.
3. Enter the **Panel creation date** and the **Subscription activation date** (not in the future). **Activated by** is recorded from your sign-in.
4. Press **Confirm activation**. The expiry date appears, calculated from the activation date and the duration (calendar months and years, month ends and leap years included).

Pressing it twice, or someone else doing it later, changes nothing: the first confirmed dates stay. Sales cannot confirm or change these dates.

## The activation e-mail

The customer receives the panel activation e-mail once the subscription starts: plan, duration, start and expiry dates, message limit and a secure sign-in or set-password link. The card shows whether it was sent. If it failed, use **Retry sending**.

## Corrections and renewals

- **Correct dates** (Super Admin, Department Head, support Team Head): enter the right dates and a reason. The expiry is recalculated and the old and new dates are kept in the history.
- **Confirm renewal**: choose the payment Accounts has **verified**. While the subscription is running, the new period continues from the old expiry date; after it lapsed, enter the date the renewed panel was activated. The previous period stays in the history.
