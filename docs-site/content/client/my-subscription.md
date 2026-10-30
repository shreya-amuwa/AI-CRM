---
title: My Subscription
description: See your plan, how long it runs, when it started and expires, how many days are left and how many messages you have used.
order: 3
group: Services & Plans
roles: [Client]
audience: client
status: verified
sources: [src/client/MySubscription.tsx, supabase/migrations/20261210000200_subscription_activation.sql]
related:
  - /client/viewing-services-usage
  - /client/managing-monthly-plans
updated: 2026-10-30
---

**My Subscription** shows, for each of your services, the plan and duration you agreed and where the subscription stands. It is always available from the sidebar, even while your onboarding is still in progress.

## Before your panel is active

You will see **Subscription Not Started**:

> Your subscription will begin once document verification is completed and your panel has been successfully created and activated.

The start date and the expiry date stay empty. Nothing counts down yet: your payment date, your invoice date and the date you sent your documents are not the start of the subscription.

## After your panel is active

You will see **Subscription Active** with:

- the **start date** - the day our team confirmed that your panel was created and activated;
- the **expiry date** - calculated automatically from that start date and your agreed duration (for example, 6 months from 10 November is 10 May);
- the **remaining days**;
- the **panel creation date**;
- your **total message credits**, **messages used**, **remaining messages** and the **usage percentage**.

You also receive an e-mail with the plan, the dates, the message limit and a secure link to sign in or set your password. We never send your password.

## Reminders

We remind you before the expiry date: 15, 7, 3 and 1 day before and on the day. You are also told when you have used 70%, 80%, 90% and 100% of your messages. Each reminder is sent once for each subscription period.

## When you renew

After your renewal payment is verified and our team confirms it, your history is kept and a new period starts: it continues from the old expiry date while the subscription is still running. You cannot change these dates yourself; if something looks wrong, raise a ticket.
