---
title: How to Create, Scan, or Import a Lead
description: Step-by-step instructions for adding a new or existing customer lead, scanning shop boards or visiting cards with OCR, and importing bulk leads.
order: 2
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Business Associate, Telecaller]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadForms.tsx, src/components/common/ShopPhotoScan.tsx, src/lib/ocr/readShopPhoto.ts, shared/validation.ts]
related: [sales/my-leads-overview, sales/recording-conversations, sales/team-lead-pipeline-and-tasks]
updated: 2026-10-27
---

When speaking with a prospect via phone, field visit, walk-in, or direct outreach—or when selling additional services to an existing client—register the lead in **My Leads > 1 Leads** to secure ownership and track follow-ups.

## Before you start

:::prereq
- You need the customer's contact name and a valid 10-digit Indian mobile number, or a clear photo of their shop board / visiting card for OCR scanning.
:::

## Choosing between New customer and Existing customer

When you click **+ Add lead** in **My Leads > 1 Leads**, choose the appropriate mode at the top of the form:
- **New customer**: Creates a brand-new prospect record in your pipeline and validates that the 10-digit mobile number is not already registered in your department.
- **Existing customer (adding services)**: Lets you look up an active client who wants to buy additional services (upsell, cross-sell, or renewal) and creates a linked expansion order without duplicating their core client profile.

## Scanning a Shop Photo or Visiting Card (`ShopPhotoScan`)

During field visits or walk-ins, you can auto-fill the lead form from a photograph of a shop sign board or visiting card:

1. In the **Add lead** form (or **Field Visits** check-in), locate the **Fill from a photo of the shop** (`ShopPhotoScan`) banner at the top.
2. Click **Take / choose photo** and capture a photo with your mobile camera or select an image file from your device.
3. The on-device reader (`readShopPhoto.ts`) processes the image locally in your browser using **English + Hindi Tesseract OCR** and **barcode/QR detection** (no photo is uploaded to external third-party servers).
4. The parser extracts and auto-fills detected fields directly into the form:
   - **Business / Company Name** (with one-tap chips for alternative detected names)
   - **Contact Name**
   - **Phone / Mobile Number** (with one-tap chips if multiple numbers appear on the board)
   - **Email Address** and **Website**
   - **Business Address** and **City**
   - **GST Number (GSTIN)** and **Business Category**
5. Review the auto-filled values and edit any field as needed before saving.

```flow
Open Add Lead | Salesperson | My Leads > 1 Leads > + Add lead
Choose Mode | Salesperson | Select "New customer" or "Existing customer (adding services)"
Scan Shop / Card (Optional) | On-Device OCR | English + Hindi Tesseract & barcode reader auto-fills fields
Complete Qualification Fields | Salesperson | Select Business Category, Lead Source, Services, and Next Follow-up
Save Lead | System | Creates LEAD record and logs initial LEAD_NOTE in conversation history
```

## Steps to create a lead manually

1. In the sidebar, navigate to **My Leads > 1 Leads** and click **+ Add lead**.
2. Select **New customer** or **Existing customer (adding services)**.
3. Fill in the **Contact Information**:
   - **Contact Person Name**: Full name of the primary decision-maker (required).
   - **Company / Business Name**: Registered business or shop name.
   - **Mobile Number**: Primary 10-digit phone number (required).
   - **WhatsApp Number**: Keep **Same as mobile number** checked or enter a separate number.
   - **Email Address**: Business or personal email.
4. Fill in the **Location & Business Profile**:
   - **City** and **Address**.
   - **Business Category**: Select Retail, Wholesale, Manufacturing, Services, IT, Healthcare, Education, Real Estate, Hospitality, or *Other* (type the specific industry when selecting *Other*).
   - **Lead Source**: Select Walk-in, Website, Meta Ads, WhatsApp, Cold Calling, Telecaller, Reference, Field Visit, or *Other*.
5. Set the **Initial Qualification & Follow-up**:
   - **Status**: Default is `NEW` (options: `NEW`, `CONTACTED`, `INTERESTED`, `READY_TO_BUY`).
   - **Next Follow-up**: Pick a date and time for your next scheduled call or meeting.
   - **Expected Budget / Deal Amount**: Enter the customer's anticipated budget in whole Rupees (integers only).
6. Enter the **Initial Conversation Note**:
   - Summarize your first interaction (for example, *Visited retail outlet in Andheri; owner wants WhatsApp catalog bot and festive broadcast package*).
7. Select **Interested Services**:
   - Select one or more services from the catalog chips/checkboxes (grouped by department such as Wabastore, Whatsbox, Amuwa Design Studio, AI Studio).
8. Click **Save Lead**.

## Bulk Import Leads (CSV / Excel) for Team Leads

Sales Team Leads and Department Heads can bulk-import prospect lists and distribute them to team members:
1. Open **Team Customers** (or **Team Leads**) from the Team Lead sidebar.
2. Click **Import Leads (CSV / Excel)** and download the sample lead template if needed.
3. Upload a `.csv` or `.xlsx` sheet containing customer names, 10-digit mobile numbers, business names, cities, and lead sources.
4. Assign the imported rows to a specific salesperson or use **Round-Robin** distribution across active team members.

## What you should see

:::result
The form closes and the newly registered lead appears at the top of **1 Leads** (or directly in **2 Potential** if saved with status `READY_TO_BUY` and a valid deal amount). Your initial note is permanently saved as the first entry in the customer's conversation timeline (`source: 'LEAD_NOTE'`).
:::

## Good to know

:::note Duplicate Mobile Prevention
The CRM checks mobile numbers against existing records in your department. If the phone number is already registered, an immediate duplicate alert identifies the existing record.
:::

:::tip Service Requirements Preview
As soon as you select services in the **Add lead** form, a **What onboarding will collect** preview box appears below the picker so you can inform the prospect upfront which compliance documents will be needed.
:::

## If something goes wrong

- **"No readable text found" during OCR scan**: Retake the photo closer to the sign board or visiting card, straight on and in even lighting.
- **"Invalid phone number"**: Ensure the mobile number contains exactly 10 digits (starting with 6, 7, 8, or 9) without spaces or a `+91` prefix.
- **"Type the lead source"**: If you selected *Other* as the lead source, fill in the custom source description field.
