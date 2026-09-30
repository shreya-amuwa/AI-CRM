import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  Edit2,
  Mail,
  Phone,
  Calendar,
  CheckCircle2,
  Clock,
  Briefcase,
  DollarSign,
  Search,
  Check,
  X,
  Palmtree,
  CalendarCheck,
  AlertCircle,
  Building2,
  UserCheck
} from 'lucide-react';

export interface HRStaffMember {
  id: string;
  name: string;
  role: string;
  tier: 'Full-Time' | 'Intern' | 'Trainee';
  email: string;
  phone: string;
  salary: string;
  shift: string;
  joinDate: string;
  assignedArea: string;
  status: 'Active' | 'On Leave';
}

interface HRStaffLeave {
  id: string;
  staffId: string;
  staffName: string;
  role: string;
  type: string;
  dates: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Declined';
}

const INITIAL_HR_STAFF: HRStaffMember[] = [
  {
    id: 'HR-STF-01',
    name: 'Sarah Johnson',
    role: 'HR Lead & Operations',
    tier: 'Full-Time',
    email: 'sarah.j@amuwa.com',
    phone: '+91 98765 43210',
    salary: '₹85,000',
    shift: '09:30 AM - 06:30 PM (HQ Shift)',
    joinDate: '2023-01-15',
    assignedArea: 'Overall People Ops & Tech Hiring',
    status: 'Active'
  },
  {
    id: 'HR-STF-02',
    name: 'Mike Chen',
    role: 'Talent Acquisition Recruiter',
    tier: 'Full-Time',
    email: 'mike.c@amuwa.com',
    phone: '+91 98765 43211',
    salary: '₹60,000',
    shift: '09:30 AM - 06:30 PM (HQ Shift)',
    joinDate: '2023-06-20',
    assignedArea: 'Sales, Marketing & CX Hiring',
    status: 'Active'
  },
  {
    id: 'HR-STF-03',
    name: 'Lisa Patel',
    role: 'HR Coordinator & Onboarding',
    tier: 'Full-Time',
    email: 'lisa.p@amuwa.com',
    phone: '+91 98765 43212',
    salary: '₹55,000',
    shift: '09:30 AM - 06:30 PM (HQ Shift)',
    joinDate: '2024-02-10',
    assignedArea: 'Onboarding, KYC Dossiers & Attendance',
    status: 'Active'
  },
  {
    id: 'HR-STF-04',
    name: 'Riya Sen',
    role: 'HR Talent Intern',
    tier: 'Intern',
    email: 'riya.s@amuwa.com',
    phone: '+91 98765 43213',
    salary: '₹18,000',
    shift: 'Flexible Part-Time (Intern Shift)',
    joinDate: '2026-08-01',
    assignedArea: 'Resume Screening & Candidate Calls',
    status: 'Active'
  }
];

const INITIAL_HR_LEAVES: HRStaffLeave[] = [
  {
    id: 'HRL-101',
    staffId: 'HR-STF-02',
    staffName: 'Mike Chen',
    role: 'Talent Acquisition Recruiter',
    type: 'Casual Leave',
    dates: 'Sep 22 - Sep 23 (2 Days)',
    reason: 'Family event out of town. Pipeline interviews handed over to Lisa.',
    status: 'Pending'
  },
  {
    id: 'HRL-100',
    staffId: 'HR-STF-04',
    staffName: 'Riya Sen',
    role: 'HR Talent Intern',
    type: 'Exam Leave',
    dates: 'Sep 25 (1 Day)',
    reason: 'College semester final exam paper.',
    status: 'Approved'
  }
];

const INITIAL_HR_ATTENDANCE = [
  { id: 'HR-ATT-1', name: 'Sarah Johnson', role: 'HR Lead', time: '09:18 AM', status: 'On Time', device: 'Main Entrance Turnstile' },
  { id: 'HR-ATT-2', name: 'Mike Chen', role: 'Talent Recruiter', time: '09:24 AM', status: 'On Time', device: 'Main Entrance Turnstile' },
  { id: 'HR-ATT-3', name: 'Lisa Patel', role: 'HR Coordinator', time: '09:30 AM', status: 'On Time', device: 'Biometric Scanner' },
  { id: 'HR-ATT-4', name: 'Riya Sen', role: 'HR Intern', time: '09:32 AM', status: 'On Time', device: 'Mobile Punch App' },
];

export const AmuwaHRStaffManagement: React.FC = () => {
  const [staffList, setStaffList] = useState<HRStaffMember[]>(INITIAL_HR_STAFF);
  const [leavesList, setLeavesList] = useState<HRStaffLeave[]>(INITIAL_HR_LEAVES);
  const [activeTab, setActiveTab] = useState<'roster' | 'attendance' | 'leaves' | 'hiring' | 'payroll'>('roster');
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'All' | 'Full-Time' | 'Intern' | 'Trainee'>('All');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRole, setFormRole] = useState('Talent Acquisition Recruiter');
  const [formTier, setFormTier] = useState<'Full-Time' | 'Intern' | 'Trainee'>('Full-Time');
  const [formSalary, setFormSalary] = useState('₹60,000');
  const [formShift, setFormShift] = useState('09:30 AM - 06:30 PM (HQ Shift)');
  const [formJoinDate, setFormJoinDate] = useState(new Date().toISOString().split('T')[0]);
  const [formArea, setFormArea] = useState('Hiring & Staff Operations');
  const [formStatus, setFormStatus] = useState<'Active' | 'On Leave'>('Active');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormRole('Talent Acquisition Recruiter');
    setFormTier('Full-Time');
    setFormSalary('₹60,000');
    setFormShift('09:30 AM - 06:30 PM (HQ Shift)');
    setFormJoinDate(new Date().toISOString().split('T')[0]);
    setFormArea('Department Hiring & Sourcing');
    setFormStatus('Active');
    setShowModal(true);
  };

  const handleOpenEditModal = (staff: HRStaffMember) => {
    setEditingId(staff.id);
    setFormName(staff.name);
    setFormEmail(staff.email);
    setFormPhone(staff.phone);
    setFormRole(staff.role);
    setFormTier(staff.tier);
    setFormSalary(staff.salary);
    setFormShift(staff.shift);
    setFormJoinDate(staff.joinDate);
    setFormArea(staff.assignedArea);
    setFormStatus(staff.status);
    setShowModal(true);
  };

  const handleSaveStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formEmail.trim()) return;

    if (editingId) {
      setStaffList(prev => prev.map(s => s.id === editingId ? {
        ...s,
        name: formName.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim() || '+91 98000 00000',
        role: formRole,
        tier: formTier,
        salary: formSalary.trim() || (formTier === 'Intern' ? '₹18,000' : '₹60,000'),
        shift: formShift,
        joinDate: formJoinDate,
        assignedArea: formArea,
        status: formStatus
      } : s));
      showToast(`✅ Updated details for ${formName}!`);
    } else {
      const newMember: HRStaffMember = {
        id: `HR-STF-${Math.floor(10 + Math.random() * 90)}`,
        name: formName.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim() || '+91 98000 00000',
        role: formRole,
        tier: formTier,
        salary: formSalary.trim() || (formTier === 'Intern' ? '₹18,000' : '₹60,000'),
        shift: formShift,
        joinDate: formJoinDate || new Date().toISOString().split('T')[0],
        assignedArea: formArea,
        status: formStatus
      };
      setStaffList(prev => [newMember, ...prev]);
      showToast(`🎉 Added ${newMember.name} as ${newMember.tier} (${newMember.role})!`);
    }
    setShowModal(false);
  };

  const handleDeleteStaff = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to remove ${name} from the HR staff roster?`)) {
      setStaffList(prev => prev.filter(s => s.id !== id));
      showToast(`🗑️ Removed ${name} from HR team.`);
    }
  };

  const handleToggleStatus = (id: string) => {
    setStaffList(prev => prev.map(s => {
      if (s.id === id) {
        const nextStatus = s.status === 'Active' ? 'On Leave' : 'Active';
        showToast(`Status for ${s.name} set to ${nextStatus}`);
        return { ...s, status: nextStatus };
      }
      return s;
    }));
  };

  const handleApproveLeave = (leaveId: string) => {
    setLeavesList(prev => prev.map(l => l.id === leaveId ? { ...l, status: 'Approved' } : l));
    const target = leavesList.find(l => l.id === leaveId);
    showToast(`✅ Approved leave request for ${target?.staffName || 'staff member'}`);
  };

  const handleDeclineLeave = (leaveId: string) => {
    setLeavesList(prev => prev.map(l => l.id === leaveId ? { ...l, status: 'Declined' } : l));
    const target = leavesList.find(l => l.id === leaveId);
    showToast(`❌ Declined leave request for ${target?.staffName || 'staff member'}`);
  };

  const filteredStaff = staffList.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.assignedArea.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier = tierFilter === 'All' ? true : s.tier === tierFilter;
    return matchesSearch && matchesTier;
  });

  const fulltimeCount = staffList.filter(s => s.tier === 'Full-Time').length;
  const internsCount = staffList.filter(s => s.tier === 'Intern').length;
  const activeTodayCount = staffList.filter(s => s.status === 'Active').length;
  const pendingLeavesCount = leavesList.filter(l => l.status === 'Pending').length;

  return (
    <div className="space-y-6 animate-fade-in font-sans">

      {/* TOAST FEEDBACK */}
      {toastMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-mono font-semibold flex items-center justify-between shadow-xs animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 hover:text-emerald-950 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* TOP CLEAN EXECUTIVE HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl bg-white border border-slate-200 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-600" />
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0 shadow-xs">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                AMUWA HQ • SUPERADMIN
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Staff Active
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              HR Staff Management
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Superadmin oversight of the internal Human Resources personnel, recruiter roster, attendance, and leave approvals
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer self-start lg:self-center"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add HR Staff</span>
        </button>
      </div>

      {/* TOP 4 SIMPLE HIGH-IMPACT KPI CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total HR Staff */}
        <div 
          onClick={() => setActiveTab('roster')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">HR Staff Roster</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">{staffList.length}</span>
            <span className="text-xs text-slate-400 font-mono">Members</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 font-mono">
            <strong className="text-emerald-700">{fulltimeCount} Full-Time</strong> • <strong className="text-purple-700">{internsCount} Intern</strong>
          </p>
        </div>

        {/* On Duty Today */}
        <div 
          onClick={() => setActiveTab('attendance')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">Today's Attendance</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CalendarCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-heading text-emerald-700">100%</span>
            <span className="text-xs text-emerald-700 font-mono font-semibold">{activeTodayCount} / {staffList.length} Present</span>
          </div>
          <p className="text-[11px] text-emerald-600 mt-2 font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            All HR team on duty
          </p>
        </div>

        {/* Pending HR Leaves */}
        <div 
          onClick={() => setActiveTab('leaves')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-amber-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">HR Leave Requests</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Palmtree className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">{pendingLeavesCount}</span>
            <span className="text-xs text-amber-700 font-mono font-semibold">Needs Approval</span>
          </div>
          <p className="text-[11px] text-amber-700 mt-2 font-mono">
            Mike Chen (2 Days Casual)
          </p>
        </div>

        {/* Total HR Payroll */}
        <div 
          onClick={() => setActiveTab('payroll')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">Monthly HR Payroll</span>
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">₹2.18L</span>
            <span className="text-xs text-slate-400 font-mono">/ month</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 font-mono">
            Disbursed on 1st of month
          </p>
        </div>
      </div>

      {/* CLEAN WORKSPACE NAVIGATION TABS */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('roster')}
          className={`pb-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'roster'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Staff Directory ({staffList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('attendance')}
          className={`pb-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'attendance'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>HR Attendance (Today)</span>
        </button>

        <button
          onClick={() => setActiveTab('leaves')}
          className={`pb-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'leaves'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Palmtree className="w-4 h-4" />
          <span>Leave Approvals</span>
          {pendingLeavesCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-800">
              {pendingLeavesCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('hiring')}
          className={`pb-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'hiring'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>Hiring Duties</span>
        </button>

        <button
          onClick={() => setActiveTab('payroll')}
          className={`pb-3 px-3.5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'payroll'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          <span>HR Payroll</span>
        </button>
      </div>

      {/* TAB 1: STAFF DIRECTORY */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, role, email or focus area..."
                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              {(['All', 'Full-Time', 'Intern'] as const).map(tier => (
                <button
                  key={tier}
                  onClick={() => setTierFilter(tier)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    tierFilter === tier
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-mono uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Staff Name &amp; Role</th>
                  <th className="p-3.5">Employment Tier</th>
                  <th className="p-3.5">Contact Details</th>
                  <th className="p-3.5">Assigned Scope</th>
                  <th className="p-3.5">Monthly Pay</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStaff.map(staff => {
                  const initials = staff.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <tr key={staff.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                            {initials}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 block">{staff.name}</span>
                            <span className="text-[11px] text-slate-500">{staff.role}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                          staff.tier === 'Full-Time'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : staff.tier === 'Intern'
                            ? 'bg-purple-50 text-purple-800 border-purple-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}>
                          {staff.tier}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-600 space-y-0.5">
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <Mail className="w-3 h-3 text-slate-400" />
                          <span>{staff.email}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{staff.phone}</span>
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-700 font-medium">
                        {staff.assignedArea}
                      </td>
                      <td className="p-3.5 font-mono font-bold text-slate-900">
                        {staff.salary}
                      </td>
                      <td className="p-3.5">
                        <button
                          onClick={() => handleToggleStatus(staff.id)}
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                            staff.status === 'Active'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                          title="Click to toggle Active / On Leave"
                        >
                          {staff.status}
                        </button>
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenEditModal(staff)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                            title="Edit staff details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStaff(staff.id, staff.name)}
                            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remove staff member"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: HR ATTENDANCE */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="font-bold text-slate-900 text-sm">Today's HR Staff Biometric Clock-Ins</h4>
              <p className="text-xs text-slate-500 mt-0.5">Automated turnstile and mobile punch log for the HR division</p>
            </div>
            <span className="px-3 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-mono font-bold self-start sm:self-auto">
              100% Attendance Verified
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-mono uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-3.5">HR Staff Member</th>
                  <th className="p-3.5">Clock In Time</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Verification Terminal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {INITIAL_HR_ATTENDANCE.map(att => (
                  <tr key={att.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5">
                      <span className="font-bold text-slate-900 block">{att.name}</span>
                      <span className="text-[10px] text-slate-500">{att.role}</span>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-slate-900">{att.time}</td>
                    <td className="p-3.5">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        {att.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-mono text-slate-600">{att.device}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: LEAVE APPROVALS */}
      {activeTab === 'leaves' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <h4 className="font-bold text-slate-900 text-sm">HR Staff Leave Applications</h4>
            <p className="text-xs text-slate-500 mt-0.5">Leaves submitted by HR team members requiring direct Superadmin approval</p>
          </div>

          <div className="space-y-3">
            {leavesList.map(leave => (
              <div key={leave.id} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">{leave.staffName}</span>
                    <span className="text-xs text-slate-500 font-mono">({leave.role})</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      leave.status === 'Approved'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : leave.status === 'Declined'
                        ? 'bg-rose-50 text-rose-800 border border-rose-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}>
                      {leave.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 flex items-center gap-2">
                    <span className="font-semibold text-blue-600">{leave.type}</span>
                    <span>•</span>
                    <span className="font-mono text-slate-600">{leave.dates}</span>
                  </div>
                  <p className="text-xs text-slate-600 italic bg-slate-50 p-2 rounded-xl border border-slate-100">
                    "{leave.reason}"
                  </p>
                </div>

                {leave.status === 'Pending' && (
                  <div className="flex gap-2 self-start sm:self-center">
                    <button
                      onClick={() => handleDeclineLeave(leave.id)}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleApproveLeave(leave.id)}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      Approve Leave
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: HIRING DUTIES */}
      {activeTab === 'hiring' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <h4 className="font-bold text-slate-900 text-sm">Hiring Allocation &amp; Department Assignments</h4>
            <p className="text-xs text-slate-500 mt-0.5">Which HR officer is actively responsible for hiring in each corporate department</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h5 className="font-bold text-slate-900 text-sm">Sarah Johnson</h5>
                  <span className="text-xs text-blue-600 font-mono">HR Lead</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-blue-700">
                  Tech &amp; Operations Focus
                </span>
              </div>
              <p className="text-xs text-slate-600">Assigned Corporate Units: <strong>Tech &amp; Engineering</strong>, <strong>Operations</strong>, <strong>Finance</strong></p>
              <div className="text-xs space-y-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="font-bold text-slate-700 block text-[11px] uppercase font-mono">Active Open Requisitions:</span>
                <p>• Senior Frontend Dev (Tech) - In Interview Stage</p>
                <p>• Operations Specialist (Ops) - Offer Contract Prepared</p>
              </div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h5 className="font-bold text-slate-900 text-sm">Mike Chen</h5>
                  <span className="text-xs text-blue-600 font-mono">Talent Recruiter</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-50 text-purple-700">
                  Sales &amp; Growth Focus
                </span>
              </div>
              <p className="text-xs text-slate-600">Assigned Corporate Units: <strong>Sales &amp; BD</strong>, <strong>Marketing</strong>, <strong>Support</strong></p>
              <div className="text-xs space-y-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="font-bold text-slate-700 block text-[11px] uppercase font-mono">Active Open Requisitions:</span>
                <p>• Business Development Associate (Sales) - Sourcing</p>
                <p>• Content &amp; Growth Marketer (Marketing) - Screening</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: HR PAYROLL */}
      {activeTab === 'payroll' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-slate-900 text-sm">HR Department Payroll Register</h4>
              <p className="text-xs text-slate-500 mt-0.5">Monthly compensation and stipend payouts for the internal HR team</p>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-xs text-slate-500 block">Total Monthly Outlay</span>
              <span className="text-xl font-bold font-mono text-slate-900">₹2,18,000 / mo</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-mono uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Staff Member</th>
                  <th className="p-3.5">Tier</th>
                  <th className="p-3.5">Monthly Salary / Stipend</th>
                  <th className="p-3.5">Disbursement Method</th>
                  <th className="p-3.5 text-right">Payment Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {staffList.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 font-bold text-slate-900 font-sans">{s.name}</td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        s.tier === 'Full-Time' ? 'bg-emerald-50 text-emerald-800' : 'bg-purple-50 text-purple-800'
                      }`}>
                        {s.tier}
                      </span>
                    </td>
                    <td className="p-3.5 font-bold text-slate-800">{s.salary}</td>
                    <td className="p-3.5 text-slate-600">Bank Direct Deposit</td>
                    <td className="p-3.5 text-right font-bold text-emerald-700">Processed</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADD / EDIT HR STAFF MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-2xl space-y-4 my-8 max-h-[92vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-slate-900">
                    {editingId ? 'Edit HR Staff Member' : 'Add New HR Staff Member'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Manage role, employment tier (intern/full-time), and compensation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStaff} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Mike Chen"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Work Email *</label>
                  <input
                    type="email"
                    required
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="name@amuwa.com"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Phone Number</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="+91 98000 00000"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Employment Tier *</label>
                  <select
                    value={formTier}
                    onChange={(e) => {
                      const val = e.target.value as 'Full-Time' | 'Intern' | 'Trainee';
                      setFormTier(val);
                      if (val === 'Intern' && formSalary === '₹60,000') {
                        setFormSalary('₹18,000');
                        if (formRole === 'Talent Acquisition Recruiter') setFormRole('HR Talent Intern');
                      } else if (val === 'Full-Time' && formSalary === '₹18,000') {
                        setFormSalary('₹60,000');
                        if (formRole === 'HR Talent Intern') setFormRole('Talent Acquisition Recruiter');
                      }
                    }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                  >
                    <option value="Full-Time">Full-Time Staff</option>
                    <option value="Intern">HR Intern</option>
                    <option value="Trainee">Probation / Trainee</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Role / Designation *</label>
                  <input
                    type="text"
                    required
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                    placeholder="e.g. HR Recruiter"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Monthly Pay / Stipend</label>
                  <input
                    type="text"
                    value={formSalary}
                    onChange={(e) => setFormSalary(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1 font-mono">Assigned Area / Responsibility</label>
                <input
                  type="text"
                  value={formArea}
                  onChange={(e) => setFormArea(e.target.value)}
                  placeholder="e.g. Sales & Marketing Hiring"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Shift &amp; Hours</label>
                  <select
                    value={formShift}
                    onChange={(e) => setFormShift(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                  >
                    <option value="09:30 AM - 06:30 PM (HQ Shift)">09:30 AM - 06:30 PM (HQ Shift)</option>
                    <option value="10:00 AM - 07:00 PM (Tech Shift)">10:00 AM - 07:00 PM (Tech Shift)</option>
                    <option value="Flexible Part-Time (Intern Shift)">Flexible Part-Time (Intern Shift)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1 font-mono">Current Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                  >
                    <option value="Active">Active (On Duty)</option>
                    <option value="On Leave">On Leave</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors"
                >
                  {editingId ? 'Save Changes' : 'Add to HR Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default AmuwaHRStaffManagement;
