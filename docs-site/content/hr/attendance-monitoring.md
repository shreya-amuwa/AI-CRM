---
title: Attendance Monitoring and Biometric Discrepancy Tracking
description: Comprehensive guide for Human Resources to monitor employee attendance, reconcile CRM system logins against physical biometric punches, and resolve timing discrepancies.
order: 2
group: Human Resources
audience: internal
roles:
  - HR Manager
  - Department Head
  - Super Admin
status: verified
updated: 2026-11-10
related:
  - /hr/hr-operations-directory
  - /hr/leave-approval-hr
  - /shared/requesting-leave
---

Amuwa AI CRM features an integrated attendance auditing engine. To ensure transparency and workplace discipline, the system correlates **two independent clock-in streams**:

1. **Relationship Manager (RM) / CRM System Login (`rmLoginAt`):** The timestamp captured automatically when an employee signs in to the web CRM application.
2. **Biometric Punch (`biometricLoginAt`):** The timestamp recorded when an employee scans their fingerprint or facial profile at the office biometric attendance scanner (or authorized manual HR punch).

---

## Punch In / Punch Out: the attendance register (all staff)

Signing in to the CRM is **not** attendance. Each employee marks attendance themselves with **Punch In** and **Punch Out** in the
**Attendance** section of their side panel; each punch records the **server time** and the device's **current location** (latitude,
longitude and accuracy). Without a usable location the punch is not recorded and the employee is told how to turn location on.

In the **HR Department Panel**, **Attendance → Attendance register (all staff)** lists every active employee for the chosen date:

| Column | What it shows |
| :--- | :--- |
| CRM Login | First CRM sign-in of the day and the last sign-out ("No logout yet" / "Logout not recorded" when the session was not closed) |
| Punch In / Punch Out | Time in India Standard Time; "Missing" when punched in but not out |
| Punch In / Punch Out Location | Coordinates, accuracy in metres, a Google Maps link, and the nearest address when it has been looked up |
| Lunch Duration | Total of all breaks; anything over the **50 minutes** allowed is shown as extra |
| Worked | Punch In to Punch Out (lunch is shown separately, not deducted) |
| Status | Not Punched In, Punched In, On Lunch, Resumed Work, Punched Out, Incomplete Attendance |

Filter by date (any earlier day), department, employee and status. Click an employee's name to see the full date and time of each punch,
both locations on a map, every CRM session with its browser and system, and every lunch break. **Incomplete Attendance** means the person
punched in and did not punch out (a past day), or signed out of the CRM today without punching out. The CRM sign-out time is never used as a
Punch Out. Opening the register is recorded in the audit log. No office location or radius is configured, so punches are not limited to a
workplace boundary.

---

## The 15-Minute Discrepancy Rule

The system computes the difference in minutes between the CRM login and the biometric scan:

`Time Gap (minutes) = |CRM Login Time - Biometric Login Time|`

- **Normal Synchronized Punch (gap <= 15 minutes):** Displayed with a blue badge (`Present - Both recorded`).
- **Flagged Discrepancy (gap > 15 minutes):** Triggers a prominent red badge (`LoginGapBadge.tsx`). This indicates an employee punched into the office scanner but delayed opening the CRM to commence work (or conversely logged in remotely without being physically present).
- **Single Punch Only:** Displays a grey badge indicating missing counterpart data.

---

## Daily Attendance Register States

In the **HR Department Panel** (**Attendance Register**), each employee record for the active date is categorized into one of four states:

| Attendance State | Indicator | Description |
| :--- | :--- | :--- |
| **Present (Both recorded)** | Green dot | Both CRM login and biometric scanner punch are recorded within normal tolerances. |
| **Present (No biometric punch)** | Amber dot | Employee logged into the CRM but lacks an office physical scanner punch. |
| **Biometric only (No CRM login)** | Amber dot | Employee scanned at the office door but has not authenticated into their CRM workstation. |
| **Absent / On Leave** | Slate dot | No punch or login recorded; cross-referenced against approved leave records. |

---

## Step-by-Step HR Attendance Reconciliation

### 1. Filtering Attendance Records

1. Open the **HR Department Panel**.
2. Select the **Daily Attendance** sub-tab.
3. Use the filter chips to isolate specific cohorts:
   - **All Records:** View entire corporate workforce.
   - **CRM Logins Only:** Employees who signed in via web.
   - **Biometric Only:** Staff with scanner timestamps awaiting CRM sign-in.
   - **Discrepancies:** Quickly filter to records exceeding the 15-minute gap threshold.

---

### 2. Manual Punch Logging and Overrides

If a physical scanner malfunctions or an employee is assigned to external on-site client meetings:

1. In the attendance workspace, locate the **Manual Punch / Attendance Override** modal.
2. Select the employee name from the dropdown.
3. Choose the **Punch Device Type**:
   - `Biometric Scanner` (records the missing biometric physical scan time).
   - `Mobile Punch` (authorized off-site work).
   - `HR Override` (administrative correction).
4. Enter the punch time (e.g., `09:30 AM`) and target date.
5. Click **Record Attendance Punch**.
6. The system records the punch with an administrative audit tag: *"Recorded the biometric punch of [Employee] at [Time] on [Date] by HR."*

---

### 3. Exporting the Monthly Attendance Register

1. In the attendance toolbar, select the target calendar month or date range.
2. Click **Export Attendance Register (CSV)**.
3. The exported file contains:
   - `Employee Name`, `E-mail`, `Designation`, `Department`
   - `Date`, `RM System Login`, `Biometric Login`
   - `Time Difference (min)`, `Discrepancy (>15 min)` flag
4. Use this CSV for corporate payroll processing and monthly punctuality audits.
