# Integration Guide: HR Staff Management for Amuwa Corporation

## Overview
This guide shows how to integrate the new **HR Staff Management** component into Amuwa Corporation's HR section.

**What it does:**
- Manage HR department staff members (not employees/candidates)
- Add, edit, delete HR staff
- Assign roles and permissions
- Track join dates and status

---

## Files Modified/Created

### Created File:
```
src/components/departments/amuwa/AmuwaHRStaffManagement.tsx
```

### File to Modify:
```
src/components/departments/amuwa/AmuwaHqPanel.tsx
```

---

## Step-by-Step Integration

### Step 1: Import the Component
In `AmuwaHqPanel.tsx`, add the import at the top:

```typescript
import { AmuwaHRStaffManagement } from './AmuwaHRStaffManagement';
```

Add it with the other imports around line 15:

```typescript
import { AmuwaOfficialOfferLetter } from './AmuwaOfficialOfferLetter';
import { EmployeeProfileModal } from './EmployeeProfileModal';
import { AccountsPanel } from './AccountsPanel';
import { AmuwaSettingsPanel } from './AmuwaSettingsPanel';
import { AmuwaHRStaffManagement } from './AmuwaHRStaffManagement';  // ← ADD THIS
import { ActiveTab } from '../../layout/Sidebar';
```

---

### Step 2: Update the Main Section Type
Update the `mainSection` state type to include the new 'hrStaff' tab.

**Current (around line 35):**
```typescript
const [mainSection, setMainSection] = useState<ActiveTab>('dashboard');
```

**No change needed** - the ActiveTab type in Sidebar should be updated instead.

---

### Step 3: Add HR Staff Section Rendering
Find this section in the component (around line 570):

```typescript
{/* SECTION 3: ACCOUNTS */}
{mainSection === 'accounts' && (
  <AccountsPanel />
)}

{/* SECTION 4: SETTINGS */}
{mainSection === 'settings' && (
  <AmuwaSettingsPanel />
)}
```

**Add this after the HR & Operations section (around line 568):**

```typescript
{/* SECTION 2B: HR STAFF MANAGEMENT */}
{mainSection === 'hrStaff' && (
  <AmuwaHRStaffManagement />
)}

{/* SECTION 3: ACCOUNTS */}
{mainSection === 'accounts' && (
  <AccountsPanel />
)}

{/* SECTION 4: SETTINGS */}
{mainSection === 'settings' && (
  <AmuwaSettingsPanel />
)}
```

---

### Step 4: Update Sidebar Options
Update `src/components/layout/Sidebar.tsx` to include the new 'hrStaff' tab.

Find where it lists Amuwa sections and update accordingly. The sidebar should have:

```
AMUWA CORPORATION
├── Dashboard
├── HR & Operations  (existing employee management)
├── HR Staff         (NEW - for managing HR team)
├── Accounts
└── Settings
```

---

## Current HR Structure After Integration

```
AMUWA CORPORATION (Superadmin)
│
├── Dashboard
│   └── Main dashboard
│
├── HR & Operations
│   └── Employees, Offers, Leaves (for organization employees)
│
├── HR Staff [NEW]
│   ├── View HR team members
│   ├── Add new HR staff
│   ├── Edit HR staff details
│   ├── Assign roles & permissions
│   └── Remove HR staff
│
├── Accounts
│   └── Financial management
│
└── Settings
    └── Configuration
```

---

## Data Structure

### HR Staff Object:
```typescript
interface HRStaff {
  id: string;                              // Unique ID
  name: string;                            // Full name
  role: 'HR Director' | 'HR Manager' | 
        'Recruiter' | 'HR Coordinator' |   // Job role
        'HR Specialist';
  email: string;                           // Work email
  phone: string;                           // Phone number
  joinDate: string;                        // Join date (YYYY-MM-DD)
  status: 'Active' | 'On Leave' | 'Inactive';
  permissions: string[];                   // List of permissions
  department: string;                      // Usually 'Human Resources'
}
```

### Initial HR Staff (Dummy Data):
```typescript
- Sarah Johnson (HR Director)
- Mike Chen (Recruiter)
- Lisa Patel (HR Coordinator)
```

---

## Features Included

### 1. **View HR Staff**
- Grid view of all HR staff members
- Color-coded status badges (Active/On Leave/Inactive)
- Contact information (email, phone)
- Join dates
- Assigned permissions

### 2. **Add New HR Staff**
- Modal form with all required fields
- Name, email, phone, role, join date, status
- Permission checkboxes for granular access control

### 3. **Edit HR Staff**
- Click "Edit" button on any card
- Modify all staff details
- Update permissions

### 4. **Remove HR Staff**
- Delete button on each card
- Confirmation dialog before removal

### 5. **Filter by Status**
- Filter buttons: All, Active, On Leave, Inactive
- Easy status tracking

---

## Available Permissions

The system supports these permissions:
- `All` - Full access to all HR functions
- `Recruitment` - Access to recruitment features
- `Candidate Management` - Manage candidates
- `Leave Management` - Manage employee leaves
- `Payroll` - Payroll management
- `Documentation` - Document management
- `Performance Review` - Performance reviews
- `Training & Development` - Training programs
- `Compliance` - Compliance management
- `Benefits Administration` - Benefits management

---

## Styling Notes

The component uses Tailwind CSS classes consistent with your existing CRM design:
- Light theme with slate colors
- Blue accent color for actions
- Hover effects on cards
- Responsive grid layout (1 col mobile, 2 col tablet, 3 col desktop)
- Border and shadow consistent with other panels

---

## Testing Checklist

After integration, test:

- [ ] HR Staff Management tab appears in Amuwa sidebar
- [ ] Can view the 3 dummy HR staff members
- [ ] Can add new HR staff with all fields
- [ ] Can edit existing HR staff
- [ ] Can delete HR staff (with confirmation)
- [ ] Can filter by status (All/Active/On Leave/Inactive)
- [ ] Permissions checkboxes work correctly
- [ ] Modal opens and closes properly
- [ ] Form validation prevents empty required fields
- [ ] Styling matches existing CRM design

---

## Notes for Future Enhancement

1. **Data Persistence:** Currently uses React state. For production, connect to a database API.

2. **Search Feature:** Add search by name/email/phone to quickly find staff.

3. **Reporting:** Add reports showing HR team workload, hiring metrics, etc.

4. **Audit Trail:** Track changes to HR staff records (who added, edited, deleted).

5. **Org Chart:** Visualize HR team hierarchy.

6. **Performance Metrics:** Track HR staff performance and KPIs.

7. **Integration with HR Department:** Connect HR staff management with the standalone HR Department for unified view.

---

## Questions?

If you need clarifications on:
- How to integrate with your database
- How to add more features
- How to modify the styling
- How to connect with other components

Let me know! 👍
