---
title: System Roles and Permissions Matrix
summary: Comprehensive reference matrix defining operational permissions, data access boundaries, and workflow actions across all CRM roles.
audience: internal
roles:
  - Super Admin
  - Department Head
  - Team Lead
  - Team Member
related:
  - /reference/glossary
  - /getting-started/roles-and-permissions
  - /super-admin/staff-and-role-administration
---

# System Roles and Permissions Matrix

Amuwa AI CRM enforces strict role-based access control (RBAC). The following matrix defines authorized actions for each verified user role.

---

## Detailed Permissions Comparison Table

| Capability / Action | Super Admin | Dept Head | Team Lead | Team Member | Technical Consultant | Accounts Staff | HR Staff | Client User |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Manage Department Lock / Hub** | **Yes** | No | No | No | No | No | No | No |
| **Create & Administer Staff** | **Yes** | Dept Only | Squad Only | No | No | No | HR Only | No |
| **Edit Service Catalog & SAC** | **Yes** | No | No | No | No | No | No | No |
| **Create & Update Sales Leads** | **Yes** | Dept Only | Squad Only | **Yes** | No | Read Only | No | No |
| **Send Lead to Accounts** | **Yes** | Dept Only | Squad Only | **Yes** | No | No | No | No |
| **Confirm & Verify Payments** | **Yes** | No | No | No | No | **Yes** | No | No |
| **Issue Dynamic Tax Invoices** | **Yes** | No | No | No | No | **Yes** | No | No |
| **Authorize Checklist Documents** | **Yes** | Read Only | Read Only | Direct Only | **Yes** | No | No | No |
| **Provision Client Portal Login** | **Yes** | Read Only | No | No | **Yes** | Direct Only | No | No |
| **Transfer to Dept Head** | **Yes** | No | No | No | **Yes** | No | No | No |
| **Pass Handover to Team Lead** | **Yes** | **Yes** | No | No | No | No | No | No |
| **Assign Customer to Specialist** | **Yes** | **Yes** | **Yes** | No | No | No | No | No |
| **Stage 1 Leave Review (Dept)** | **Yes** | **Yes** | No | No | No | No | No | No |
| **Stage 2 Leave Signoff (HR)** | **Yes** | No | No | No | No | No | **Yes** | No |
| **Attendance & Biometric Sync** | **Yes** | Dept Only | Squad Only | Own Only | Own Only | Own Only | **Yes** | No |
| **Client Portal Self-Service** | No | No | No | No | No | No | No | **Yes** |

---

## Scope Isolation Rules

1. **Departmental Siloing:** Non-administrative staff members (Sales, Support, Delivery) are strictly restricted to their designated department (`department_id`). Cross-department data visibility requires explicit Super Admin privileges.
2. **Read-Only Lock During Verification:** When a salesperson forwards a customer to Accounts or Technical Consultant, the sales dossier locks in read-only mode to prevent conflicting modifications during audits.
3. **Audit Log Persistence:** All role promotions, status transitions, payment reversals, and document rejections are permanently recorded with the acting user's profile ID and timestamp.
