---
title: Troubleshooting Missing Records and Permission Boundaries
description: Locate missing leads, customers, or invoices by checking pipeline stage tabs, the Multi-Department ScopeBar, My Leads vs Team Leads toggles, and active filters.
order: 2
group: Access & Visibility
roles: [Super Admin, Department Head, Team Lead, Team Member, Telecaller, Business Associate, Accounts]
audience: internal
status: verified
sources: [src/components/DepartmentScopeBar.tsx, src/components/SalesPanel.tsx, src/components/DepartmentHeadPanel.tsx]
related:
  - /shared/searching-and-filtering
  - /sales/my-leads-overview
  - /troubleshooting/login-and-access-issues
updated: 2026-10-27
---

When a lead, customer dossier, or invoice appears to be missing, the record has almost always moved to another lifecycle tab, is hidden behind an active filter or ownership toggle, or belongs to a different department scope in the **`ScopeBar`**.

## Before you start

:::prereq
- Note the customer's **business name**, **phone number**, or **email address** so you can search for the record once the right tab and scope are selected.
:::

## 1. Symptom: A customer or lead is missing in a Multi-Department workspace

### Likely causes

- Staff members who manage multiple departments (such as a shared **Department Head** or **Super Admin** with multiple department scopes in `user_department_scopes`) have the Multi-Department **`ScopeBar`** set to a single department instead of **Combined** (or set to the wrong department).

### Step-by-step resolution

1. Look at the Multi-Department **`ScopeBar`** at the top of your dashboard.
2. Check which department pill is currently selected:
   - Click **Combined** (where available on roll-up views) to view records aggregated across all of your assigned departments, or
   - Click the specific department pill (for example, **Wabastore**, **Wabatalk**, **Digitree Infotech**, or **Amuwa Design Studio**) where the customer was created.
3. Re-run your search in the active view's search box.

## 2. Symptom: "The lead disappeared after I updated it or recorded a deal"

### Likely causes

- Updating a lead's commercial stage moves the card to the next pipeline tab:
  - Setting a deal amount (`> ₹0`) and moving to potential shifts the record from **1 My Leads** to **2 Potential Customers**.
  - Once **Accounts** verifies a payment, the customer moves from **2 Potential Customers** to **3 Customer Onboarding**.
  - After onboarding and handover complete, the customer appears in the delivery and support queues.

```flow
1 My Leads | Sales / Telecaller / BA | Initial inquiry before deal value is finalized
2 Potential Customers | Sales | Deal amount > ₹0 agreed or sent to Accounts for payment verification
3 Customer Onboarding | Sales & TC | Accounts confirmed payment; checklist and onboarding in progress
Active Service Delivery | Delivery & Support | Handed over to Department Head, Team Lead, and Team Member
```

### Step-by-step resolution

1. In the **Sales** workspace, switch across the pipeline tabs (**1 My Leads**, **2 Potential Customers**, and **3 Customer Onboarding**).
2. Clear any status or date filter pills set on the tab (reset status filter to **All**).
3. Type the customer's phone number or business name into the page search input.

## 3. Symptom: "I can't see a teammate's or squad member's leads"

### Likely causes

- The ownership view toggle is set to **My Leads** (personal records only) rather than **Team Leads** (all records across your squad or department).
- The lead is still in the unassigned **Inbound Leads** pool or in the **Lead Assign** queue awaiting distribution by the Sales Department Head.

### Step-by-step resolution

1. If you are a **Team Lead** or **Department Head**, switch the view toggle from **My Leads** to **Team Leads** (or **All**).
2. Check the **Inbound Leads** tab or **Lead Assign** tab to see if the record has not yet been assigned to an individual representative.
3. If a **Telecaller** handed the lead to a **Business Associate (BA)**, check the **BA Assigned Leads** queue.

## 4. Symptom: "Access Denied" or records from another division are not visible

### Likely causes

- Amuwa AI CRM enforces strict department data boundaries. A **Team Member** or **Team Lead** assigned only to **Wabastore** cannot view customer records belonging to **Wabatalk** or **Amuwa Design Studio**.

### Step-by-step resolution

1. Confirm which department owns the customer record.
2. If an employee permanently covers more than one department, a **Super Admin** can grant additional department access via `user_department_scopes` in the Staff Management panel.

## Expected result

:::result
- After selecting the right department in the **`ScopeBar`**, switching to the matching pipeline tab (**My Leads**, **Potential Customers**, or **Customer Onboarding**), and toggling **My Leads** vs **Team Leads**, the customer record appears in the list.
:::

## When to escalate

Escalate to your **Department Head** or **Super Admin** if the record does not appear in any stage tab after checking all scopes and filters. Include:

- The customer's **phone number**, **business name**, and **department**.
- Which employee last updated the record and what action they took (for example, *Moved to Potential*, *Sent to Accounts*, or *Assigned to BA*).
