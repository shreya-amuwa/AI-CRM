# 🚀 CRM Unified System - Complete Project Folder

## 📦 What's in This Folder

This is the **complete, ready-to-use CRM project folder** with:
- ✅ All source code (React + TypeScript)
- ✅ 10 departments fully configured  
- ✅ HR Department with dashboard (NEW!)
- ✅ Multi-tab system (NEW!)
- ✅ All configuration files
- ✅ All documentation

---

## ⚡ Quick Start (3 Steps)

### **1. Install Dependencies**
```bash
npm install
```

### **2. Clear Browser Cache** (First time only)
- Open DevTools: `F12`
- Go to: **Application → LocalStorage**
- Delete all entries

### **3. Start the App**
```bash
npm start
```
Opens at `http://localhost:5173`

---

## 🔐 Authentication, Database & Backend

The CRM now uses **Supabase Auth + PostgreSQL as the single source of truth**.
There are no built-in demo accounts or shared passwords; persistent CRM data is
not stored in the browser.

| Topic | Where |
|---|---|
| Architecture, schema, RBAC, RLS strategy, risks | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Setup / deployment / testing | [`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md) |
| Database migrations | `supabase/migrations/` |
| Backend API (Controller → Service → Repository) | `server/`, served at `/api/v1` |

Quick start:

```bash
cp .env.example .env.local        # fill in your Supabase project values
npx supabase db push              # apply migrations (or run them in order in the SQL editor)
npm run bootstrap:super-admin -- you@company.com "Your Name"
npm run dev                       # http://localhost:3000 (frontend + /api/v1)
```

New staff sign up and wait for approval by their Team Head / Department Head,
or are created by a manager from **Access & Approvals**.

---

## 📁 Folder Structure

```
crm-unified-system-folder/
├── src/                              # All source code
│   ├── App.tsx                       # Main app (UPDATED - multi-tab!)
│   ├── index.css                     # Styles
│   ├── components/
│   │   ├── departments/
│   │   │   ├── amuwa/                # Amuwa Corporation
│   │   │   ├── hr/                   # HR Department (NEW!)
│   │   │   ├── whatsbox/             # Whatsbox
│   │   │   ├── wabastore/            # Wabastore
│   │   │   ├── dtalk/                # D Talk
│   │   │   ├── digitree/             # Digitree
│   │   │   ├── mpillar/              # M Pillar
│   │   │   └── edutraining/          # Education & Training
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── TabBar.tsx            # Tab bar (NEW!)
│   │   ├── dashboard/
│   │   │   └── DepartmentSelector.tsx # With "Open in New Tab"
│   │   ├── auth/                     # Login & authentication
│   │   ├── leads/                    # Lead management
│   │   ├── notifications/            # Notifications
│   │   └── ...other components
│   ├── context/
│   │   ├── AuthContext.tsx           # Login state
│   │   ├── DepartmentContext.tsx     # Departments
│   │   ├── TabContext.tsx            # Multi-tab (NEW!)
│   │   ├── LeadStoreContext.tsx
│   │   └── NotificationContext.tsx
│   ├── types/                        # TypeScript types
│   └── data/                         # Initial data
├── public/
│   └── logos/                        # Department logos
├── package.json                      # Dependencies
├── package-lock.json                 # Dependency lock
├── tsconfig.json                     # TypeScript config
├── vite.config.ts                    # Vite config
├── index.html                        # Entry point
├── README.md                         # This file
├── SETUP_INSTRUCTIONS.md             # Setup guide
└── HR_REQUIREMENTS_FINAL.md          # HR details
```

---

## ✨ What's New

### **HR Department**
- ✅ 10th department in the system
- ✅ Impressive dashboard with metrics
- ✅ Same 4 employees as Amuwa
- ✅ Employee management
- ✅ Offer letter generation
- ✅ Leave management

### **Multi-Tab System**
- ✅ Open multiple departments simultaneously
- ✅ Tab bar at the top
- ✅ Click tabs to switch
- ✅ Each tab remembers your position
- ✅ Independent state per tab
- ✅ Close individual tabs

---

## 🎯 Key Files Modified

- `src/App.tsx` - Multi-tab routing
- `src/context/TabContext.tsx` - Tab state (NEW!)
- `src/components/layout/TabBar.tsx` - Tab UI (NEW!)
- `src/components/dashboard/DepartmentSelector.tsx` - New Tab button
- `src/components/departments/hr/HRDepartmentPanel.tsx` - HR dashboard

---

## 📋 Available Scripts

```bash
# Start development server
npm start

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## 🔧 Requirements

- **Node.js** v16+
- **npm** or **yarn**
- Modern browser (Chrome, Firefox, Safari, Edge)

---

## 📚 Documentation Files

- **README.md** (this file) - Overview
- **SETUP_INSTRUCTIONS.md** - Detailed setup
- **HR_REQUIREMENTS_FINAL.md** - HR feature details

---

## 🎓 Usage Guide

### **Single Department Mode**
1. Click "Enter Panel" on a department
2. Browse the department
3. Click "Department Hub" to return

### **Multi-Tab Mode**
1. Enter first department
2. Go back to selector
3. Click "New Tab" on another department
4. Switch tabs at the top
5. Click × to close tabs

---

## ✅ Verification

After setup, check:
- [ ] App starts without errors
- [ ] Login works with provided credentials
- [ ] Department Selector shows 10 departments
- [ ] HR Department visible
- [ ] Can open multiple departments in tabs
- [ ] Tab bar visible when multiple tabs open
- [ ] Can switch between tabs
- [ ] Can close individual tabs

---

## 🐛 Troubleshooting

**App won't start:**
```bash
rm -rf node_modules package-lock.json
npm install
npm start
```

**Old data showing:**
- Clear localStorage: F12 → Application → LocalStorage → Delete all
- Refresh the page

**Can't login:**
- Use correct credentials (see CREDENTIALS.md)
- Clear localStorage and try again
- Use Incognito/Private window

---

## 🚀 Ready to Use!

This folder contains **everything** you need. Just:
1. Run `npm install`
2. Run `npm start`
3. Login with provided credentials
4. Enjoy your CRM!

---

**Created:** September 9, 2026  
**Version:** 2.0 - With HR Department & Multi-Tab System  
**Status:** ✅ Production Ready

🎉 **All-in-one folder - no additional downloads needed!**
