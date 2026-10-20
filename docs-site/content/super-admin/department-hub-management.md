---
title: Department Hub and Business Division Management
summary: Administrative guide for Super Admins to configure corporate departments, toggle lock/active states, manage session ceilings, and govern division metadata.
audience: internal
roles:
  - Super Admin
related:
  - /super-admin/staff-and-role-administration
  - /super-admin/service-catalog-management
  - /getting-started/roles-and-permissions
---

# Department Hub and Business Division Management

The **Department Hub** serves as the organizational backbone of Amuwa AI CRM. It partitions operations into autonomous business units-such as Amuwa Corporation Holding, Wabastore, Amuwa Design Studio, Digitree Infotech, D Talk, and HR.

Super Admins hold exclusive authority to provision new departments, edit organizational metadata, enforce concurrent session ceilings, and lock or unlock departmental portals.

---

## Department Structure and Capabilities

Each corporate department configured in the CRM includes:

- **Department Identifier (`id`):** Unique slug used in routing and API payloads (e.g., `amuwa`, `wabastore`, `designstudio`, `accounts`).
- **Brand Identity:** Official department display name, marketing description, theme accent color, and high-resolution logo asset (`/logos/[id].png`).
- **Operational Metrics:** Real-time counters tracking total leads, active staff members, and live concurrent sessions.
- **Access State:** Locked (`locked: true`) or Open (`locked: false`).
- **Session Ceilings (`maxSessions`):** Strict boundary capping simultaneous administrative sessions to protect system integrity.

---

## Step-by-Step Administrative Procedures

### 1. Navigating to Department Administration

1. Sign in with authorized **Super Admin** credentials.
2. From the main administrative navigation, select **Department Hub**.
3. The dashboard displays the global department grid showing all corporate divisions, active staff counts, and session monitors.

---

### 2. Provisioning or Updating a Department

1. To update an existing department, click the **Settings / Edit** button on the department card.
2. In the configuration dialog:
   - **Department Name:** Corporate entity title (e.g., *"Amuwa Design Studio"*).
   - **Operational Tagline / Description:** Brief scope summary (e.g., *"Creative Solutions & Strategic Design Innovation"*).
   - **Accent Color:** Hex color code used for badges, buttons, and border highlights in departmental panels.
   - **Max Concurrent Sessions:** Integer specifying permitted simultaneous active staff logins (default: 2 per department).
3. Click **Save Department Configuration**.

---

### 3. Locking or Unlocking a Department

If a department undergoes scheduled maintenance, organizational restructuring, or security review:

1. Locate the department card in the Department Hub.
2. Toggle the **Lock Department** switch:
   - **When Locked:** Non-admin staff attempting to access the department receive an alert: *"This department is currently locked for administrative maintenance."* Existing non-admin sessions are gracefully evicted.
   - **When Unlocked:** Department staff resume normal operational access immediately.
3. Every lock/unlock action is permanently recorded in the system audit trail.

---

### 4. Concurrent Session Monitoring

Amuwa AI CRM enforces strict concurrent session policies to prevent credential sharing and unauthorized multi-location access:

- The top header of each department panel tracks `activeSessions / maxSessions`.
- If the maximum session quota is reached, any additional login attempt is blocked with an alert: *"Maximum concurrent department sessions reached. Please have an active user sign out."*
- Super Admins can click **Terminate Stale Sessions** on the department card to evict orphaned or inactive sessions.
