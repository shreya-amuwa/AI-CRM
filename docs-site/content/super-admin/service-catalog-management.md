---
title: Service Prices, GST/SAC Defaults, and Catalog Administration
description: Manage the enterprise service catalog in the Service Prices tab, configure default HSN/SAC codes, default GST rates, department pricing, and Technical Consultant routing.
order: 3
group: Commercial Configuration
roles: [Super Admin, Accounts Department]
audience: internal
status: verified
sources: [src/components/Workspaces/SuperAdminDashboard.tsx, src/components/Workspaces/ServicePriceManager.tsx]
related: [super-admin/company-business-oversight, super-admin/tax-agreements-review, accounts/dynamic-invoices-overview]
updated: 2026-10-27
---

Every software subscription, WhatsApp API plan, voice solution, and creative package sold across Amuwa Corporation is governed from the **Service Prices** tab (`src/components/Workspaces/ServicePriceManager.tsx`) in the **Super Admin Dashboard**. Configuring accurate base prices, HSN/SAC tax codes, default GST rates, and delivery department mappings ensures that Sales quotations, Accounts invoices, and onboarding handovers stay synchronized.

## Before you start

:::prereq
- Sign in as a **Super Admin** at `/super-admin/dashboard` and click **Service Prices** in the left sidebar.
- Have the official 6-digit **HSN/SAC code**, **default GST percentage** (typically `18%`), and departmental base price ready before adding or modifying a catalog item.
:::

## Service catalog and pricing lifecycle

```flow
Open Service Prices Tab | Super Admin | SuperAdminDashboard > Service Prices (ServicePriceManager.tsx)
Add or Edit Service Offering | Super Admin | Set Name, Code, Department, Base Price, Default HSN/SAC & GST %
Configure Journey Routing | Super Admin | Set deliveryDepartmentId and requiresTechnicalConsultant flag
Sales & Accounts Consume Catalog | Sales / Accounts | Pre-fills deal pricing, SAC code, GST rate & handover route
```

## Managing services in Service Prices (`ServicePriceManager.tsx`)

When you open the **Service Prices** tab, the catalog displays all offerings grouped by department (**Wabastore**, **Whatsbox**, **Dtalk**, **Digitree**, **Mpillar**, **Design Studio**):

### 1. Adding a new service

1. Click **Add Service** in the top toolbar of **Service Prices**.
2. Fill in the commercial and tax configuration fields:
   - **Service Name**: Customer-facing title shown on quotations, invoices, and the Client Portal (for example, *Meta Official WhatsApp Business API - Annual Plan*).
   - **Service Code**: Unique identifier code (for example, `WA_API_PRO` or `DS_BRAND_KIT`).
   - **Department**: Select the owning/delivering business unit (`wabastore`, `whatsbox`, `dtalk`, `digitree`, `mpillar`, `designstudio`).
   - **Base Price (INR)**: Standard catalog price for the service tier.
   - **Default HSN / SAC Code**: Standard 6-digit tax classification code pre-filled into the Accounts Invoice Builder (for example, `998314` for IT design & development or `998319` for other IT services).
   - **Default GST Rate (%)**: Standard Goods and Services Tax percentage applied when generating tax invoices (default `18%`).
   - **Requires Technical Consultant**: Toggle on (`true`) if the service requires document verification, WABA ID setup, or technical onboarding before handover; toggle off (`false`) for direct-to-delivery services such as Design Studio creative packages.
3. Click **Save Service**.

### 2. Editing department pricing and tax defaults

1. Locate the service row in **Service Prices** using the department filter tabs or search bar.
2. Click **Edit** on the service row to update its **Base Price**, **Default HSN/SAC**, **Default GST Rate**, or active status.
3. Click **Save Changes**.

| Catalog Attribute | Where It Is Used | Impact of Changes |
| --- | --- | --- |
| **Base Price** | Sales **Move to Potential**, Client Portal **Explore Services** | Updates the default reference price for new deals; existing signed customer agreements retain their agreed deal amount. |
| **Default HSN / SAC** | Accounts **Invoice Builder** | Pre-populates the HSN/SAC column on new invoice line items. |
| **Default GST Rate (%)** | Accounts **Invoice Builder**, **Tax & Agreements** | Sets the default tax calculation rate for new invoices. |
| **Requires Technical Consultant** | Customer Journey Router | Determines whether paid orders route through the Technical Consultant queue (`TECHNICAL` / `MIXED`) or go straight to the delivery Department Head (`DIRECT`). |

## What you should see

:::result
Saved service items and updated prices appear immediately in the Sales service selector, the Client Portal service catalog, and the Accounts Invoice Builder with their configured HSN/SAC and GST defaults.
:::

## Good to know

:::warning Do Not Delete Services With Historical Invoices
If a service package is retired, mark it inactive or rename it as legacy rather than deleting its catalog code. Historical invoices and department revenue ledgers reference the service code for attribution reporting.
:::

## If something goes wrong

- **Wrong GST rate or SAC code appears on a draft invoice**: Update the service's **Default HSN/SAC** and **Default GST Rate** in **Service Prices**, then refresh the draft in [Issuing an Invoice](/accounts/issuing-an-invoice).
- **Order bypassed Technical Consultant unexpectedly**: Check that **Requires Technical Consultant** is enabled for that service code in **Service Prices**.
