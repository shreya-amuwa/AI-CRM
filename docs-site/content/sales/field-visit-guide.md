---
title: Field Visit - plan, record and follow up visits to your leads
description: How Telecallers, Business Associates and Sales Team Members use the Field Visit group of their own dashboard, and how the Sales Department Head assigns leads for a visit.
order: 11
group: Role Workspaces
roles: [Telecaller, Business Associate, Sales Team Member, Department Head]
audience: internal
status: verified
sources: [src/components/field-visit/FieldVisitWorkspace.tsx, src/components/field-visit/FieldVisitDialogs.tsx, src/components/field-visit/AssignVisitDialog.tsx, src/components/sales-head/LeadList.tsx, supabase/migrations/20261203000100_sales_field_visits.sql]
related: [sales/telecaller-workspace-guide, sales/business-associate-workspace, sales/my-leads-overview, sales/creating-a-lead, sales/sending-to-accounts]
updated: 2026-10-28
---

**Field Visit** is a group in the sidebar of the dashboard you already use (Telecaller, Business Associate or Sales Team Member). It is not a separate dashboard. It lets you plan a visit to a lead, record how it went, and keep every visit of a lead in a history that is never overwritten.

## Before you start

:::prereq
- You are an active Telecaller, Business Associate or Sales Team Member (a Sales member with no Sales role of their own).
- Support members, Team Leads and Department Heads do not have the Field Visit group. The Sales Department Head assigns visits from **Leads > Lead List**.
:::

## The ten pages

Open **Field Visit** in the sidebar. It lists, in this order:

1. **Field Visit Overview** - six cards (**Total Assigned Leads**, **My Leads**, **Today's Scheduled Visits**, **Completed Field Visits**, **Pending Field Visits**, **Follow-ups Required**) and the lead table with ten filters. Click a card to open its filter.
2. **Department Head Assigned Leads** - the leads your Department Head gave you for a visit, with the priority, who assigned it, the date and the visit instructions. You cannot change an assignment.
3. **Add Lead** - the same Add Lead form as in your dashboard, with the lead source **Field visit** already chosen. The lead is saved once, in your leads.
4. **All Leads**, **My Leads**, **Department Leads**, **To Accounts**, **Returned by Accounts** - the lead table with one filter fixed. Department Leads belong to your colleagues and are read-only.
5. **My Field Visits** - visits you planned and have not finished.
6. **Visit History** - visits you finished or cancelled.

The overview filters are **All Leads**, **My Leads**, **Department Leads**, **Department Head Assigned**, **To Accounts**, **Returned by Accounts**, **Field Visit Pending** (assigned to you with no visit planned yet), **Visit Scheduled**, **Visit Completed** and **Follow-up Required**. The number beside each filter is the number of rows it shows.

## Steps - plan and record a visit

1. Open **Field Visit > Field Visit Overview** (or **My Leads**) and click **Schedule visit** on the lead. You can plan visits for your own leads and for leads your Department Head assigned to you.
2. Enter the **Visit date** (today or later), an optional **Planned time**, the **Visit address**, the **Purpose of the visit** and **Notes**. Click **Schedule visit**.
3. When you arrive, open **My Field Visits** and click **Start**. Choose **Start with my location** to record where you are, or **Start without location**.
4. When you leave, click **Record outcome**. Choose **Completed** or **Follow-up Required**, enter the **Outcome**, and optionally **Meeting notes**, **Customer requirements** and **Next steps**. A follow-up needs the **Next follow-up date**.
5. Click **Save outcome**. The visit moves to **Visit History**. Click **History** on a lead to see all of its visits.

:::result
The visit shows its status (Scheduled, In Progress, Completed, Follow-up Required or Cancelled) in every table. A lead whose latest visit needs a follow-up appears under **Follow-up Required**.
:::

## Good to know

:::note Location
The position is recorded only when your device really shares it. It is shown as **Location captured by the device** and is never called verified. If you refuse the permission, nothing starts: you can try again or start without a location, and the visit then shows **Location not captured**.
:::

- **Nothing is overwritten.** A second visit to the same lead is a new record; the first stays as it was recorded.
- **Cancelling** asks for confirmation (and an optional reason) and keeps the visit in the history. Only a visit that has not started can be rescheduled or cancelled.
- **The lead keeps its owner.** A Department Head assignment never moves a lead. The Accounts workflow (**To Accounts**, **Returned by Accounts**, payment confirmation) is not touched by a visit.
- **Follow-up date.** When you finish a visit of your own lead with a next follow-up date, the lead's follow-up date is updated too. On a lead you do not own, only the visit records the date.
- **Field Visit is separate from Work / Tasks.** A visit can optionally be linked to one of your own tasks; nothing is created in Tasks by itself.
- **Double clicks and retries** never create two visits.

## Sales Department Head: assign a lead for a visit

1. Open **Leads > Lead List** and click **Field visit** on a lead (a lead that is already in a Sales member's pipeline).
2. Choose **Who will make the visit** (an active Telecaller, Business Associate or Sales Team Member of your department), the **Priority** and the **Visit instructions**. Click **Assign for visit**.
3. To take the assignment back, open the same dialog and click **Withdraw assignment**. Assigning the same lead to someone else reassigns it.

## If something goes wrong

- **"Lead not found. You can schedule visits for your own leads and the leads your Department Head assigned to you."** - the lead is a colleague's lead that was not assigned to you. Ask your Department Head to assign it.
- **"The visit date cannot be in the past."** - choose today or a later date.
- Other messages and fixes: [Missing records and permissions](/troubleshooting/missing-records-and-permissions).
