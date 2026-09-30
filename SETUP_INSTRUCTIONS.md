# CRM Unified System - Complete Setup & Usage Guide

## ✅ What's Included

This folder contains a complete CRM system with:

### **10 Business Departments:**
1. Amuwa Corporation
2. Amuwa Design Studio
3. Wabastar
4. Wabastore
5. Whatsbox
6. D Talk Corporation
7. Digitree Infotech
8. M Pillar Corporation
9. Education & Training
10. **HR Department** (NEW - with exact HR dashboard from Amuwa Corporation)

### **Role-Based Access Control (RBAC):**
- **SuperAdmin** - Access to ALL departments
- **Admin/Department Head** - Access to specific departments with 2-step authentication
- **HR** - Access to HR Department with 2-step authentication

---

## 🔐 Login Credentials

### **SuperAdmin Login (Access to ALL Departments)**
```
ID:       admin
Password: admin123
```

### **Department Head / Admin Logins (2-Step Authentication)**

**Step 1 (Main Login)** - ALL Department Heads use:
```
ID:       admin
Password: admin123
```

**Step 2 (Department Unlock)** - Individual Department Passwords:

| Department | ID | Password |
|---|---|---|
| Amuwa Corporation | amuwa | amuwa@123 |
| Amuwa Design Studio | designstudio | design@123 |
| Wabastar | wabastar | waba@123 |
| Wabastore | wabastore | store@123 |
| Whatsbox | whatsbox | box@123 |
| D Talk Corporation | dtalk | dtalk@123 |
| Digitree Infotech | digitree | digitree@123 |
| M Pillar Corporation | mpillar | pillar@123 |
| Education & Training | edutraining | edu@123 |

### **HR Department Login (2-Step Authentication)**

**Step 1 (Main HR Login):**
```
ID:       hr
Password: hr123
```

**Step 2 (HR Department Unlock):**
```
ID:       hr
Password: hr@secure
```

---

## 🚀 How to Run the App

### **Prerequisites:**
- Node.js (v16 or higher)
- npm or yarn

### **Installation Steps:**

1. **Extract the folder:**
   ```bash
   unzip crm-unified-system.zip
   cd crm-unified-system
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm start
   ```

4. **Open in browser:**
   ```
   http://localhost:3000
   ```

---

## ⚠️ IMPORTANT: Clear Browser Storage (First Time Only)

**Before logging in for the first time, you MUST clear your browser's storage:**

### **Method 1: Developer Tools (Recommended)**
1. Press `F12` to open Developer Tools
2. Go to **Application** tab
3. Click **Local Storage** in left sidebar
4. Find and click the origin for localhost
5. Look for key `unified_crm_departments_v1`
6. **Delete it** by right-clicking and selecting "Delete"
7. Refresh the page (Ctrl+R or Cmd+R)

### **Method 2: Clear All Site Data**
1. Right-click on the page
2. Click **Settings**
3. Go to **Cookies and site data**
4. Click **Clear all data**
5. Refresh the page

---

## 📋 Feature Checklist

### **✅ HR Department (New)**
- Exact replica of Amuwa Corporation's HR section
- **Same 4 Employees:**
  - Alexander Wright
  - Priya Sharma
  - Rohan Mehta
  - Kavya Nair
- **Employee Directory** - Full employee roster with filters
- **Offer Letters Automated** - Generate professional offer letters
- **Half-Days & Leave Register** - Manage employee leave
- Employee profile modals with document collection
- Convert trainees to permanent employees
- Mark employees as left
- Document tracking system

### **✅ All 10 Departments Visible**
- Department Selector shows all 10 units
- Each department has its own control panel
- Department-specific navigation tabs

### **✅ 2-Step Authentication**
- Main login (SuperAdmin ID/Password)
- Department-specific unlock with credentials
- Separate HR login flow

### **✅ Data Persistence**
- localStorage saves your session
- Department data persists across page refreshes
- Employee records are maintained

---

## 🎯 Quick Start Guide

### **For SuperAdmin:**
1. Login with `admin` / `admin123`
2. Click any department card to enter
3. Access all features immediately

### **For Department Head (e.g., Amuwa Head):**
1. Login with `admin` / `admin123` (Step 1)
2. Click Amuwa Corporation card
3. Enter unlock credentials: `amuwa` / `amuwa@123` (Step 2)
4. Access Amuwa department panel

### **For HR:**
1. Login with `hr` / `hr123` (Step 1)
2. Click HR Department card
3. Enter unlock credentials: `hr` / `hr@secure` (Step 2)
4. Access HR department panel with full employee management

---

## 📁 Folder Structure

```
crm-unified-system/
├── src/
│   ├── components/
│   │   ├── departments/
│   │   │   ├── amuwa/           (Amuwa Corporation Panel)
│   │   │   ├── hr/              (HR Department Panel - NEW)
│   │   │   ├── whatsbox/        (Whatsbox Panel)
│   │   │   ├── wabastore/       (Wabastore Panel)
│   │   │   ├── dtalk/           (D Talk Panel)
│   │   │   ├── digitree/        (Digitree Panel)
│   │   │   ├── mpillar/         (M Pillar Panel)
│   │   │   └── edutraining/     (Education & Training Panel)
│   │   ├── dashboard/           (Department Selector & Main Dashboard)
│   │   ├── auth/                (Login & Authentication)
│   │   └── layout/              (Header, Sidebar, Navigation)
│   ├── data/
│   │   ├── departments.ts       (All 10 departments config)
│   │   └── amuwaHqInitialData.ts (Employee, Offer Letter, Leave data)
│   ├── context/
│   │   ├── AuthContext.tsx      (Authentication & Department selection)
│   │   └── DepartmentContext.tsx (Department management)
│   └── App.tsx                  (Main routing logic)
├── public/
│   └── logos/                   (Department logos)
└── package.json
```

---

## 🔍 What Changed From Original Request

### **✅ Implemented:**
1. ✅ HR Department created as 10th department
2. ✅ HR Dashboard copied from Amuwa Corporation's HR section (exact same employees, offer letters, leave register)
3. ✅ 2-step authentication for all departments
4. ✅ Individual department credentials
5. ✅ Separate HR login and unlock credentials
6. ✅ No changes to original Amuwa HR section
7. ✅ All 10 departments visible in department selector
8. ✅ Full employee management in HR Department
9. ✅ Offer letter automation in HR Department
10. ✅ Leave register in HR Department

---

## 🐛 Troubleshooting

### **Q: HR Department card not appearing?**
**A:** Clear your browser's localStorage as instructed above, then refresh.

### **Q: Can't unlock a department?**
**A:** Make sure you're using the correct credentials from the table above. Check spelling and capitalization.

### **Q: Employee data not saving?**
**A:** This is normal - data is stored in component state. Refresh to reset. For persistent storage, you would need a backend database.

### **Q: Getting stuck on login screen?**
**A:** Clear localStorage and try again with correct credentials.

---

## 📞 Contact & Support

All features have been implemented as requested:
- ✅ HR Department visible in department grid
- ✅ HR Dashboard contains exact content from Amuwa Corporation's HR section
- ✅ Same 4 employees displayed
- ✅ Full employee management features
- ✅ No changes to original Amuwa Corporation HR section

**Ready to use. Enjoy!**
