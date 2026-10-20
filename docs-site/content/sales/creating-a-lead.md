---
title: How to Create and Register a New Lead
description: Step-by-step instructions for adding a manual lead, specifying business categories, and selecting services.
order: 20
roles: [Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadForms.tsx, shared/validation.ts]
related: [sales/my-leads-overview, sales/recording-conversations]
updated: 2026-10-19
---

When speaking with a new prospect via phone, walk-in, or direct outreach, register them immediately to secure ownership and start tracking conversations.

## Before you start

:::prereq
- You must have the customer's name and a valid 10-digit mobile number.
:::

## Steps

1. In the sidebar, navigate to **Sales dashboard > My Leads > 1 Leads**.
2. Click the **+ Add Lead** button in the top right.
3. Fill in the **Contact Information**:
   - **Contact Person Name**: Full name of the primary contact (required).
   - **Company Name**: Registered business or shop name.
   - **Mobile Number**: Primary 10-digit phone number (required).
   - **WhatsApp Number**: Check **Same as mobile number** or enter a distinct number.
   - **Email Address**: Corporate or personal email.
4. Fill in the **Location & Business Profile**:
   - **City** and **Address**.
   - **Business Category**: Select Retail, Wholesale, Manufacturing, Services, IT, etc. If selecting *Other*, type the specific industry in the text field.
   - **Lead Source**: Select Walk-in, Website, Meta Ads, WhatsApp, Cold Calling, Telecaller, Reference, or Other.
5. Set the **Initial Qualification & Follow-up**:
   - **Status**: Default is `NEW` (options: `CONTACTED`, `INTERESTED`, `READY_TO_BUY`).
   - **Next Follow-up**: Select a future date and time for the follow-up reminder.
   - **Expected Budget**: Enter the customer's anticipated budget in Rupees (integers only).
6. Enter the **Initial Conversation Note**:
   - Type a concise summary of the first interaction (e.g. *Inquired about WhatsApp API setup for e-commerce catalog; wants pricing proposal by Friday*).
7. Select **Interested Services**:
   - Check the boxes for the services the customer expressed interest in (grouped by Wabastore, Whatsbox, Design Studio, etc.).
8. Click **Save Lead**.

## What you should see

:::result
The form closes and the newly created lead appears at the top of your **Leads** list. Your initial note is automatically stored as the first immutable entry in the customer's conversation history (`source: 'LEAD_NOTE'`).
:::

## Good to know

:::note Duplicate Prevention
The database checks mobile numbers against existing records. If the phone number already exists in your department, the system alerts you immediately.
:::

:::tip Service Requirements Preview
When selecting Amuwa Design Studio services, a **What onboarding will collect** preview box renders at the bottom of the form to inform you what files will be needed later.
:::

## If something goes wrong

- **"Invalid phone number"**: Ensure the mobile number contains exactly 10 digits without spaces or leading +91.
- **"Type the lead source"**: If you selected *Other* as the lead source, you must type a descriptive source name.
