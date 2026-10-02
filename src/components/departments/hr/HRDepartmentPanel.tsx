import React, { useState, useEffect } from 'react';
import { 
  Users, FileText, UserPlus, CheckCircle2, Clock, AlertCircle, 
  Calendar, Award, Sparkles, Send, FileCheck, ArrowRight, ShieldCheck,
  UserMinus, Eye, Plus, LayoutDashboard, BarChart3, TrendingUp, Briefcase,
  DollarSign, Gift, FolderKanban, ArrowLeft, CalendarCheck, Building2,
  Palmtree, ChevronRight, GraduationCap, ArrowUpRight, Activity, Check,
  Search, Phone, Mail, Shield, ChevronDown, Download, CheckCircle, XCircle, X,
  Star, ShoppingBag, MessageSquare, PhoneCall, Cpu, Layers, Cake, PartyPopper, FileCheck2,
  Lock, Fingerprint, Monitor
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useLeadStore } from '../../../context/LeadStoreContext';
import { 
  INITIAL_EMPLOYEES, 
  INITIAL_OFFER_LETTERS, 
  INITIAL_LEAVE_APPLICATIONS 
} from '../../../data/amuwaHqInitialData';
import { Employee, OfferLetter, LeaveApplication } from '../../../types/amuwaHq';
import { AmuwaOfficialOfferLetter } from '../amuwa/AmuwaOfficialOfferLetter';
import { EmployeeProfileModal } from '../amuwa/EmployeeProfileModal';
import { AutomatedLetterGeneratorWorkspace } from './AutomatedLetterGeneratorWorkspace';
import { ActiveTab } from '../../layout/Sidebar';
import { departmentMemberStore } from '../../../services/departmentMemberStore';
import { getSupabase } from '../../../services/supabaseClient';
import { attendanceStore, AttendanceRecord } from '../../../services/attendanceStore';

interface HRDepartmentPanelProps {
  activeTab?: ActiveTab;
}

export type { AttendanceRecord };
export const INITIAL_ATTENDANCE: AttendanceRecord[] = attendanceStore.getAttendanceRecords();

export const CORPORATE_DEPARTMENTS = [
  { id: 'amuwa', name: 'Amuwa Corporation', lead: 'Alexander Wright', staff: 14, status: 'Active', icon: Building2, color: 'text-red-600 bg-red-50 border-red-200' },
  { id: 'designstudio', name: 'Amuwa Design Studio', lead: 'Sarah Jenkins', staff: 9, status: 'Active', icon: Sparkles, color: 'text-rose-600 bg-rose-50 border-rose-200' },
  { id: 'wabastar', name: 'Wabastar', lead: 'Karthik Raman', staff: 11, status: 'Active', icon: Star, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { id: 'wabastore', name: 'Wabastore', lead: 'Vikram Singhania', staff: 17, status: 'Active', icon: ShoppingBag, color: 'text-teal-600 bg-teal-50 border-teal-200' },
  { id: 'whatsbox', name: 'Whatsbox', lead: 'Meera Nambiar', staff: 8, status: 'Active', icon: MessageSquare, color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
  { id: 'dtalk', name: 'D Talk Corporation', lead: 'Rohan Deshmukh', staff: 10, status: 'Active', icon: PhoneCall, color: 'text-purple-600 bg-purple-50 border-purple-200' },
  { id: 'digitree', name: 'Digitree Infotech', lead: 'Arjun Kapoor', staff: 15, status: 'Active', icon: Cpu, color: 'text-pink-600 bg-pink-50 border-pink-200' },
  { id: 'mpillar', name: 'M Pillar Corporation', lead: 'Rajesh Verma', staff: 12, status: 'Active', icon: Layers, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { id: 'edutraining', name: 'Education & Training', lead: 'Pooja Hegde', staff: 6, status: 'Active', icon: GraduationCap, color: 'text-sky-600 bg-sky-50 border-sky-200' },
  { id: 'hr', name: 'HR Department', lead: 'Priya Sharma', staff: 4, status: 'Active', icon: Users, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { id: 'accounts', name: 'Accounts Department', lead: 'Rajiv Khanna', staff: 5, status: 'Active', icon: DollarSign, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' }
];

export const HRDepartmentPanel: React.FC<HRDepartmentPanelProps> = ({ activeTab = 'dashboard' }) => {
  const { activeDepartment } = useAuth();
  const { getLeadsForDepartment } = useLeadStore();

  // State Management
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [offerLetters, setOfferLetters] = useState<OfferLetter[]>(INITIAL_OFFER_LETTERS);
  const [leaves, setLeaves] = useState<LeaveApplication[]>(INITIAL_LEAVE_APPLICATIONS);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(() => attendanceStore.getAttendanceRecords());
  const [latestMemberLogin, setLatestMemberLogin] = useState<AttendanceRecord | null>(() => attendanceStore.getLatestMemberLogin());
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'crm' | 'biometric'>('all');
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [showManualPunchModal, setShowManualPunchModal] = useState(false);
  const [punchEmpId, setPunchEmpId] = useState('EMP-1001');
  const [punchTime, setPunchTime] = useState('09:30 AM');
  const [punchStatus, setPunchStatus] = useState<'On Time' | 'Half-Day Approved' | 'Late'>('On Time');
  const [punchDevice, setPunchDevice] = useState<'Biometric Scanner' | 'Mobile Punch' | 'HR Override'>('HR Override');
  const [opToast, setOpToast] = useState<string | null>(null);
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState('');

  // Subscribe to live attendance updates (when team members log in via ID & Password)
  useEffect(() => {
    const unsub = attendanceStore.subscribe((records) => {
      setAttendanceRecords(records);
      setLatestMemberLogin(attendanceStore.getLatestMemberLogin());
    });
    return () => unsub();
  }, []);

  // Quick simulation helper to test real-time team member login with ID & Password
  const handleSimulateMemberLogin = (name: string, email: string, role: string, empId: string) => {
    const rec = attendanceStore.recordMemberLogin({
      empId,
      name,
      email,
      role,
      department: 'Wabastore Sales',
      authMethod: 'ID & Password Auth (System Login)',
      device: 'CRM Web Client (ID & Password)'
    });
    setOpToast(`🔐 System Login: ${name} logged in with ID & Password at ${rec.loginTime}`);
    setTimeout(() => setOpToast(null), 4000);
  };

  // System Login Time auto-captured the moment the system is opened
  const [systemLoginTime, setSystemLoginTime] = useState<string>(() => {
    const today = new Date().toISOString().split('T')[0];
    const savedDate = localStorage.getItem('amuwa_sys_login_date');
    const savedTime = localStorage.getItem('amuwa_sys_login_time');
    if (savedDate === today && savedTime) {
      return savedTime;
    }
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    localStorage.setItem('amuwa_sys_login_date', today);
    localStorage.setItem('amuwa_sys_login_time', nowTime);
    return nowTime;
  });

  // Upcoming Employee Birthdays & Work Anniversaries (within 30 days)
  interface UpcomingCelebration {
    id: string;
    type: 'birthday' | 'anniversary';
    name: string;
    role: string;
    date: string;
    daysLeft: number;
    avatar: string;
    milestone?: string;
    wished?: boolean;
    recognized?: boolean;
  }

  const [upcomingCelebrations, setUpcomingCelebrations] = useState<UpcomingCelebration[]>([
    { id: 'CEL-1', type: 'birthday', name: 'Kavya Nair', role: 'Design Specialist', date: '02 October', daysLeft: 4, avatar: 'KN', wished: false },
    { id: 'CEL-2', type: 'anniversary', name: 'Alexander Wright', role: 'Operations Lead', date: '05 October', milestone: '1st Year Milestone', daysLeft: 7, avatar: 'AW', recognized: false },
    { id: 'CEL-3', type: 'birthday', name: 'Rohan Mehta', role: 'Operations Trainee', date: '14 October', daysLeft: 16, avatar: 'RM', wished: false },
    { id: 'CEL-4', type: 'anniversary', name: 'Priya Sharma', role: 'Senior HR Lead', date: '21 October', milestone: '2nd Year Milestone', daysLeft: 23, avatar: 'PS', recognized: false }
  ]);

  const handleWishBirthday = (name: string, id: string) => {
    setUpcomingCelebrations(prev => prev.map(c => c.id === id ? { ...c, wished: true } : c));
    setOpToast(`🎂 Sent official corporate birthday greeting & Kudos card to ${name}!`);
    setTimeout(() => setOpToast(null), 4500);
  };

  const handleRecognizeAnniversary = (name: string, milestone: string, id: string) => {
    setUpcomingCelebrations(prev => prev.map(c => c.id === id ? { ...c, recognized: true } : c));
    setOpToast(`🎈 Awarded official ${milestone} Honor Badge & Certificate to ${name}!`);
    setTimeout(() => setOpToast(null), 4500);
  };

  // Live Supabase Cloud Sync
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    // Load cloud employees
    supabase.from('hr_employees').select('*').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!error && data && data.length > 0) {
        setEmployees(data.map((d: any) => ({
          id: d.id,
          name: d.name,
          email: d.email || '',
          phone: d.phone || '',
          designation: d.designation || '',
          departmentId: d.department_id || 'amuwa',
          status: d.status || 'Full-Time',
          joiningDate: d.joining_date || '',
          workingHours: d.working_hours || '09:30 AM - 06:30 PM (Mon-Sat)',
          monthlySalary: d.monthly_salary || '',
          documentsCollected: true,
          uploadedDocs: [],
          leaveHistory: [],
          halfDaysCount: 0,
          totalLeavesCount: 0
        })));
      }
    });

    // Realtime changes listener
    const channel = supabase.channel('public:hr_employees')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_employees' }, (payload: any) => {
        if (payload.eventType === 'INSERT') {
          const d = payload.new;
          const newE: Employee = {
            id: d.id,
            name: d.name,
            email: d.email || '',
            phone: d.phone || '',
            designation: d.designation || '',
            departmentId: d.department_id || 'amuwa',
            status: d.status || 'Full-Time',
            joiningDate: d.joining_date || '',
            workingHours: d.working_hours || '09:30 AM - 06:30 PM (Mon-Sat)',
            monthlySalary: d.monthly_salary || '',
            documentsCollected: true,
            uploadedDocs: [],
            leaveHistory: [],
            halfDaysCount: 0,
            totalLeavesCount: 0
          };
          setEmployees(prev => [newE, ...prev.filter(e => e.id !== newE.id)]);
        }
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const handleApproveLeave = (leaveId: string) => {
    setLeaves(prev => prev.map(l => l.id === leaveId ? { ...l, status: 'Approved' } : l));
    const target = leaves.find(l => l.id === leaveId);
    setOpToast(`✅ Approved leave application for ${target?.employeeName || 'employee'}!`);
    setTimeout(() => setOpToast(null), 4500);
  };

  const handleDeclineLeave = (leaveId: string) => {
    setLeaves(prev => prev.map(l => l.id === leaveId ? { ...l, status: 'Cancelled' } : l));
    const target = leaves.find(l => l.id === leaveId);
    setOpToast(`❌ Declined leave application for ${target?.employeeName || 'employee'}.`);
    setTimeout(() => setOpToast(null), 4500);
  };

  const handleExportAttendanceCsv = () => {
    const headers = ['Employee ID', 'Employee Name', 'Designation', 'Login / Clock In Time', 'Auth Method', 'Status', 'Verification Device'];
    const rows = attendanceRecords.map(r => [
      r.empId,
      `"${r.name}"`,
      `"${r.role}"`,
      r.loginTime || r.time,
      `"${r.authMethod}"`,
      r.status,
      `"${r.device}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `hr_attendance_punches_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setOpToast('📥 Downloaded daily attendance & login report CSV!');
    setTimeout(() => setOpToast(null), 4500);
  };

  const handleSaveManualPunch = (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find(e => e.id === punchEmpId);
    if (!emp) return;
    attendanceStore.recordMemberLogin({
      empId: emp.id,
      name: emp.name,
      email: emp.email,
      role: emp.designation,
      department: 'Corporate',
      authMethod: punchDevice as any,
      device: punchDevice
    });
    setShowManualPunchModal(false);
    setOpToast(`⏱️ Successfully logged clock-in for ${emp.name} at ${punchTime}`);
    setTimeout(() => setOpToast(null), 4500);
  };

  // Operational State for Rewards & Projects Modules
  const [rewardPoints, setRewardPoints] = useState(12450);
  const [initiatives, setInitiatives] = useState([
    { id: 'INIT-1', title: 'Q3 Performance Appraisal Review', progress: 75, due: 'In 12 days', lead: 'Priya Sharma', status: 'In Progress' },
    { id: 'INIT-2', title: 'Digital Onboarding Kit v2.4', progress: 90, due: 'Friday', lead: 'Alexander Wright', status: 'In Review' },
    { id: 'INIT-3', title: 'Annual Health & Wellness Camp', progress: 30, due: 'Next Month', lead: 'Kavya Nair', status: 'Planning' },
  ]);

  const handleGrantRewardPoints = (empName: string, amount: number = 250) => {
    setRewardPoints(prev => prev + amount);
    setOpToast(`🎉 Granted +${amount} Kudos Points to ${empName}! Updated Pool: ${(rewardPoints + amount).toLocaleString()} pts`);
    setTimeout(() => setOpToast(null), 4500);
  };

  const handleNominateAward = (empName: string) => {
    setOpToast(`🏆 Successfully submitted award nomination for ${empName}!`);
    setTimeout(() => setOpToast(null), 4500);
  };

  const handleAddQuickInitiative = () => {
    const newInit = {
      id: `INIT-${Date.now()}`,
      title: 'Company-Wide Growth & Culture Track 2026',
      progress: 20,
      due: 'End of Month',
      lead: 'HR Operations',
      status: 'In Progress'
    };
    setInitiatives(prev => [newInit, ...prev]);
    setOpToast(`🚀 Launched new HR Initiative: "${newInit.title}"`);
    setTimeout(() => setOpToast(null), 4500);
  };

  // Main Section Navigation controlled by sidebar activeTab
  const [mainSection, setMainSection] = useState<ActiveTab>('dashboard');

  useEffect(() => {
    if (activeTab) {
      setMainSection(activeTab);
    }
  }, [activeTab]);

  // Sub-tabs inside HR & OPERATIONS
  const [hrSubTab, setHrSubTab] = useState<'employees' | 'offers' | 'leaves'>('employees');
  const [employeeFilter, setEmployeeFilter] = useState<'all' | 'fulltime' | 'trainees' | 'interns' | 'left'>('all');

  // Modals state
  const [selectedProfileEmp, setSelectedProfileEmp] = useState<Employee | null>(null);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);

  // New Employee Form state
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpPhone, setNewEmpPhone] = useState('');
  const [newEmpDesignation, setNewEmpDesignation] = useState('HR Specialist');
  const [newEmpSalary, setNewEmpSalary] = useState('₹60,000');
  const [newEmpHours, setNewEmpHours] = useState('09:30 AM - 06:30 PM (Mon-Sat)');
  const [newEmpStatus, setNewEmpStatus] = useState<'Full-Time' | 'Training / Probation' | 'Intern'>('Full-Time');
  const [newEmpDepartment, setNewEmpDepartment] = useState('hr');
  const [newEmpSubDepartment, setNewEmpSubDepartment] = useState<'sales' | 'support'>('sales');
  const [newEmpJoiningDate, setNewEmpJoiningDate] = useState(new Date().toISOString().split('T')[0]);
  const [newEmpDocsCollected, setNewEmpDocsCollected] = useState(false);

  // Handlers
  const handleConvertTraineeToEmployee = (empId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEmployees(prev => prev.map(emp => {
      if (emp.id === empId) {
        return {
          ...emp,
          status: 'Full-Time',
          designation: emp.designation.replace(/(Trainee|Intern)/gi, 'Specialist'),
          notes: `Converted to Permanent Employee on ${new Date().toLocaleDateString()}`
        };
      }
      return emp;
    }));
  };

  const handleMarkLeft = (empId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEmployees(prev => prev.map(emp => {
      if (emp.id === empId) {
        return {
          ...emp,
          status: 'Left',
          leftDate: new Date().toISOString().split('T')[0]
        };
      }
      return emp;
    }));
  };

  const handleToggleDocuments = (empId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEmployees(prev => prev.map(emp => {
      if (emp.id === empId) {
        return { ...emp, documentsCollected: !emp.documentsCollected };
      }
      return emp;
    }));
  };

  const handleUpdateEmployee = (updatedEmp: Employee) => {
    setEmployees(prev => prev.map(emp => emp.id === updatedEmp.id ? updatedEmp : emp));
  };

  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName.trim() || !newEmpEmail.trim()) return;

    const isWabastore = newEmpDepartment === 'wabastore' || newEmpDepartment === 'sales' || newEmpDepartment === 'support' || newEmpDepartment === 'wabastore_sales' || newEmpDepartment === 'wabastore_support';
    const isIntern = newEmpStatus === 'Intern';
    const idPrefix = isIntern ? 'INT' : 'EMP';
    const generatedEmpId = isWabastore 
      ? `${idPrefix}-${Math.floor(1000 + Math.random() * 9000)}` 
      : `HR-EMP-${Math.floor(1000 + Math.random() * 9000)}`;

    const newEmp: Employee = {
      id: generatedEmpId,
      name: newEmpName.trim(),
      email: newEmpEmail.trim(),
      phone: newEmpPhone.trim() || '+91 98000 00000',
      designation: newEmpDesignation.trim() || 'Operations Specialist',
      departmentId: newEmpDepartment,
      status: newEmpStatus,
      joiningDate: newEmpJoiningDate || new Date().toISOString().split('T')[0],
      workingHours: newEmpHours,
      monthlySalary: newEmpSalary.trim() || (newEmpStatus === 'Intern' ? '₹18,000' : '₹60,000'),
      documentsCollected: newEmpDocsCollected,
      uploadedDocs: [],
      leaveHistory: [],
      halfDaysCount: 0,
      totalLeavesCount: 0
    };

    setEmployees(prev => [newEmp, ...prev]);

    // If department is Wabastore (Sales or Support), dispatch as pending approval
    if (isWabastore) {
      const targetDept: 'sales' | 'support' =
        newEmpDepartment === 'support' || newEmpDepartment === 'wabastore_support'
          ? 'support'
          : newEmpDepartment === 'sales' || newEmpDepartment === 'wabastore_sales'
          ? 'sales'
          : newEmpSubDepartment;
      
      const targetDeptName = targetDept === 'sales' ? 'WabaStore Sales' : 'WabaStore Support';
      
      departmentMemberStore.addPendingMember({
        id: generatedEmpId,
        name: newEmp.name,
        role: newEmp.designation,
        type: isIntern ? 'Intern' : 'Employee',
        department: targetDept,
        email: newEmp.email,
        phone: newEmp.phone,
        salary: newEmp.monthlySalary,
        addedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        submittedBy: 'HR Operations (Priya Sharma)'
      });

      setOpToast(`📋 Registered ${newEmp.name} (${generatedEmpId}) in HR! Dispatched to ${targetDeptName} Head as pending approval for SuperAdmin / Admin authorization.`);
    } else {
      const selectedDeptObj = CORPORATE_DEPARTMENTS.find(d => d.id === newEmpDepartment);
      const deptName = selectedDeptObj ? selectedDeptObj.name : newEmpDepartment;
      setOpToast(`🎉 Successfully onboarded ${newEmp.name} into ${deptName} as ${newEmp.status} (${newEmp.designation})!`);
    }

    // Automatically record active attendance entry so employee is recognized in the feed
    attendanceStore.recordMemberLogin({
      empId: newEmp.id,
      name: newEmp.name,
      email: newEmp.email,
      role: newEmp.designation,
      department: newEmpDepartment || 'Corporate',
      authMethod: 'HR Override',
      device: 'HR Direct Registration'
    });

    // Save to Supabase Cloud
    const supabase = getSupabase();
    if (supabase) {
      supabase.from('hr_employees').upsert({
        id: newEmp.id,
        name: newEmp.name,
        email: newEmp.email,
        phone: newEmp.phone,
        designation: newEmp.designation,
        department_id: newEmp.departmentId,
        status: newEmp.status,
        joining_date: newEmp.joiningDate,
        monthly_salary: newEmp.monthlySalary,
        working_hours: newEmp.workingHours
      }).then(({ error }: any) => {
        if (error) console.warn('[Supabase HR] Error saving employee:', error.message);
      });
    }

    setShowAddEmployeeModal(false);
    setTimeout(() => setOpToast(null), 5500);

    // Reset Form Fields
    setNewEmpName('');
    setNewEmpEmail('');
    setNewEmpPhone('');
    setNewEmpDesignation('HR Specialist');
    setNewEmpSalary('₹60,000');
    setNewEmpStatus('Full-Time');
    setNewEmpDepartment('hr');
    setNewEmpSubDepartment('sales');
    setNewEmpDocsCollected(false);
  };

  const filteredEmployees = employees.filter(emp => {
    if (employeeFilter === 'fulltime') return emp.status === 'Full-Time';
    if (employeeFilter === 'trainees') return emp.status === 'Training / Probation';
    if (employeeFilter === 'interns') return emp.status === 'Intern';
    if (employeeFilter === 'left') return emp.status === 'Left';
    return true;
  });

  const traineesCount = employees.filter(e => e.status === 'Training / Probation').length;
  const internsCount = employees.filter(e => e.status === 'Intern').length;
  const fulltimeCount = employees.filter(e => e.status === 'Full-Time').length;
  const leftCount = employees.filter(e => e.status === 'Left').length;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Top Department Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-slate-50 p-2 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
            <img src="/logos/hr.png" alt="HR" className="h-full w-full object-contain" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold font-heading text-slate-900">
                Human Resources
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                Shift: 09:30 - 18:30
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Workforce roster, attendance tracking, leave approvals &amp; letter automation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleExportAttendanceCsv()}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 shadow-2xs transition-all cursor-pointer"
            title="Download today's attendance logs as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Attendance CSV</span>
          </button>
          <button
            onClick={() => setShowAddEmployeeModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Employee</span>
          </button>
          <button
            onClick={() => setShowOfferModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate Offer</span>
          </button>
        </div>
      </div>

      {/* OPERATIONAL TOAST FEEDBACK */}
      {opToast && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-mono font-semibold flex items-center justify-between shadow-xs animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{opToast}</span>
          </div>
          <button onClick={() => setOpToast(null)} className="text-emerald-700 hover:text-emerald-950 cursor-pointer p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SECTION 1: MINIMAL OPERATIONAL DASHBOARD */}
      {mainSection === 'dashboard' && (
        <div className="space-y-6 animate-fade-in">

          {/* Top 4 Minimal High-Impact Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* 1. Active Staff */}
            <div 
              onClick={() => { setMainSection('hr_ops'); setHrSubTab('employees'); }}
              className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">Active Roster</span>
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">{employees.length}</span>
                <span className="text-xs text-slate-400 font-mono">Members</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500 font-mono">
                <span className="text-emerald-700 font-bold">{fulltimeCount} Full-Time</span>
                <span>•</span>
                <span>{traineesCount} Trainee</span>
                <span>•</span>
                <span>{internsCount} Intern</span>
              </div>
            </div>

            {/* 2. Today's Attendance */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-emerald-300 hover:shadow-md transition-all group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">Today's Attendance</span>
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <CalendarCheck className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-bold font-heading text-emerald-700">100%</span>
                <span className="text-xs text-emerald-700 font-mono font-semibold">4 / 4 Present</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>3 On Time • 1 Shift Approved</span>
              </div>
            </div>

            {/* 3. Pending Approvals */}
            <div 
              onClick={() => { setMainSection('hr_ops'); setHrSubTab('leaves'); }}
              className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">Pending Approvals</span>
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Palmtree className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
                  {leaves.filter(l => l.status === 'Pending' || l.status === 'Noted').length}
                </span>
                <span className="text-xs text-amber-700 font-mono font-semibold">Action Required</span>
              </div>
              <div className="flex items-center gap-1 mt-2 text-[11px] text-amber-700 font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Rohan Mehta (Half-Day)</span>
              </div>
            </div>

            {/* 4. Monthly Payroll Run */}
            <div 
              onClick={() => setShowPayrollModal(true)}
              className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">Monthly Payroll</span>
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">₹2.00 L</span>
                <span className="text-xs text-slate-400 font-mono">Disbursed</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-indigo-700 font-medium">
                <Check className="w-3.5 h-3.5 text-indigo-600" />
                <span>Next Cycle: 1st of Month</span>
              </div>
            </div>
          </div>

          {/* CONDITIONAL: EITHER SPECIFIC MODULE WORKSPACE OR THE 3X3 MINIMAL OPERATIONAL BOXES GRID */}
          {activeModule ? (
            <div className="space-y-6 animate-fade-in">
              {/* Back to Modules Navigation Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-200/90 shadow-xs">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveModule(null)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to HR Dashboard</span>
                  </button>
                  <span className="text-slate-300">/</span>
                  <span className="text-xs font-mono font-bold text-slate-900 uppercase">
                    {activeModule === 'attendance' && 'Attendance & Shift Management'}
                    {activeModule === 'departments' && 'Corporate Department Hierarchy (10 Units)'}
                    {activeModule === 'recruitment' && 'Recruitment & Talent Acquisition Desk'}
                    {activeModule === 'employees' && 'Employee Directory & KYC Profiles'}
                    {activeModule === 'leaves' && 'Leave & Shift Approvals Register'}
                    {activeModule === 'awards' && 'Awards, Upcoming Birthdays & Anniversaries'}
                    {(activeModule === 'offer_letter' || activeModule === 'letters') && 'Automated Offer Letter & Contract Studio'}
                    {activeModule === 'experience_letter' && 'Automated Relieving & Experience Certificate Studio'}
                    {activeModule === 'nda_letter' && 'Automated Mutual NDA & Confidentiality Studio'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {activeModule === 'attendance' && (
                    <>
                      <button
                        onClick={handleExportAttendanceCsv}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>CSV Export</span>
                      </button>
                      <button
                        onClick={() => setShowManualPunchModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Log Clock-In</span>
                      </button>
                    </>
                  )}
                  {activeModule === 'recruitment' && (
                    <button
                      onClick={() => setShowOfferModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Generate Offer</span>
                    </button>
                  )}
                  {activeModule === 'employees' && (
                    <button
                      onClick={() => setShowAddEmployeeModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add Employee</span>
                    </button>
                  )}
                </div>
              </div>

              {/* MODULE 1: ATTENDANCE WORKSPACE */}
              {activeModule === 'attendance' && (
                <div className="space-y-4">
                  {/* Clean Attendance Header & Status Bar */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center shrink-0">
                        <CalendarCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-slate-900">Attendance Register</h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            <span>Biometric &amp; System Login Sync Active</span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          System Boot: <span className="font-semibold text-slate-700">{systemLoginTime}</span>
                          {latestMemberLogin && (
                            <span className="ml-2 text-emerald-700 font-medium">
                              • Latest Login: <strong className="font-semibold">{latestMemberLogin.name}</strong> at {latestMemberLogin.crmLoginTime || latestMemberLogin.loginTime}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap font-mono text-xs">
                      {/* Filter Tabs */}
                      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setAttendanceFilter('all')}
                          className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                            attendanceFilter === 'all'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          All Staff ({attendanceRecords.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttendanceFilter('crm')}
                          className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            attendanceFilter === 'crm'
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'text-emerald-800 hover:text-emerald-950'
                          }`}
                        >
                          <Monitor className="w-3 h-3" />
                          <span>CRM System ({attendanceRecords.filter(r => r.crmLoginTime || r.loginTime || r.authMethod.includes('System') || r.authMethod.includes('CRM')).length})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttendanceFilter('biometric')}
                          className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            attendanceFilter === 'biometric'
                              ? 'bg-purple-600 text-white shadow-2xs'
                              : 'text-purple-800 hover:text-purple-950'
                          }`}
                        >
                          <Fingerprint className="w-3 h-3" />
                          <span>Biometric ({attendanceRecords.filter(r => r.biometricTime || r.authMethod.includes('Biometric')).length})</span>
                        </button>
                      </div>

                      {/* Quick Member Login Simulation */}
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-slate-400 text-[10px] uppercase font-mono mr-0.5">Simulate:</span>
                        <button
                          type="button"
                          onClick={() => handleSimulateMemberLogin('Priya Nair', 'priya@amuwa.com', 'Sales Executive', 'tm-priya')}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 transition-colors cursor-pointer"
                          title="Simulate CRM System login for Priya Nair"
                        >
                          Priya
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSimulateMemberLogin('Rahul Kumar', 'rahul@amuwa.com', 'Sales Executive', 'tm-rahul')}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 transition-colors cursor-pointer"
                          title="Simulate CRM System login for Rahul Kumar"
                        >
                          Rahul
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSimulateMemberLogin('Amit Patel', 'amit@amuwa.com', 'Senior Sales Specialist', 'tm-amit')}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors cursor-pointer"
                          title="Simulate CRM System login for Amit Patel"
                        >
                          Amit
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Attendance Table */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                        <tr>
                          <th className="p-3.5 pl-4">Staff Member</th>
                          <th className="p-3.5">Biometric Punch</th>
                          <th className="p-3.5">CRM Login (System Login)</th>
                          <th className="p-3.5 pr-4 text-right">Attendance Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {attendanceRecords
                          .filter(att => {
                            if (attendanceFilter === 'crm') return att.crmLoginTime || att.loginTime || att.authMethod.includes('System') || att.authMethod.includes('CRM');
                            if (attendanceFilter === 'biometric') return att.biometricTime || att.authMethod.includes('Biometric');
                            return true;
                          })
                          .map(att => (
                          <tr key={att.id} className="hover:bg-slate-50/80 transition-colors">
                            {/* Staff Member */}
                            <td className="p-3.5 pl-4">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-bold text-xs flex items-center justify-center font-sans shadow-2xs shrink-0">
                                  {att.avatar}
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-slate-900 font-sans block text-xs">{att.name}</span>
                                    {att.isOnline && (
                                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Active Online" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                    <span>{att.role}</span>
                                    <span>&bull;</span>
                                    <span className="text-slate-500 font-semibold">{att.department || 'Wabastore'}</span>
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Biometric Punch */}
                            <td className="p-3.5">
                              {att.biometricTime || att.authMethod.includes('Biometric') ? (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 font-bold">
                                  <Fingerprint className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                                  <span className="text-xs">{att.biometricTime || att.loginTime || '09:15 AM'}</span>
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-200/80 text-purple-950 font-semibold font-sans">
                                    Biometric
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-xs font-mono">— (Field / Web)</span>
                              )}
                            </td>

                            {/* CRM Login (System Login) */}
                            <td className="p-3.5">
                              {att.crmLoginTime || att.loginTime || att.authMethod.includes('System') || att.authMethod.includes('CRM') || att.authMethod.includes('ID & Password') ? (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold">
                                  <Monitor className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span className="text-xs">{att.crmLoginTime || att.loginTime}</span>
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-200/80 text-emerald-950 font-semibold font-sans">
                                    System Login
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-xs font-mono">— (Pending CRM)</span>
                              )}
                            </td>

                            {/* Attendance Status */}
                            <td className="p-3.5 pr-4 text-right">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold border ${
                                att.status === 'On Time'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : att.status === 'Half-Day Approved'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  att.status === 'On Time' ? 'bg-emerald-500' : 'bg-amber-500'
                                }`} />
                                {att.status === 'On Time' ? 'Present (Logged In)' : att.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* MODULE 2: DEPARTMENTS WORKSPACE */}
              {activeModule === 'departments' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
                    <h4 className="text-sm font-bold text-slate-900">Corporate Department Hierarchy</h4>
                    <p className="text-xs text-slate-500 mt-0.5">All 10 business units, assigned department leads, team capacity, and functional reporting chains</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {CORPORATE_DEPARTMENTS.map(dept => {
                      const IconComp = dept.icon;
                      return (
                        <div key={dept.id} className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:border-blue-300 transition-all space-y-3">
                          <div className="flex items-center justify-between">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${dept.color}`}>
                              <IconComp className="w-4 h-4" />
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {dept.status}
                            </span>
                          </div>
                          <div>
                            <h5 className="font-bold text-sm text-slate-900">{dept.name}</h5>
                            <p className="text-xs text-slate-500 mt-0.5">Lead: <span className="font-semibold text-slate-800">{dept.lead}</span></p>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs font-mono text-slate-500">
                            <span>{dept.staff} Members</span>
                            <span className="text-blue-600 font-semibold cursor-pointer hover:underline" onClick={() => setOpToast(`Navigating to ${dept.name}...`)}>Active Unit →</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* MODULE 3: RECRUITMENT WORKSPACE */}
              {activeModule === 'recruitment' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Candidate Pipeline &amp; Offer Desk</h4>
                      <p className="text-xs text-slate-500 mt-0.5">Official employment contracts generated using the Automated 7-Page generator</p>
                    </div>
                    <button
                      onClick={() => setShowOfferModal(true)}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Generate 7-Page Contract</span>
                    </button>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase text-[10px]">
                        <tr>
                          <th className="p-3.5">Candidate Name</th>
                          <th className="p-3.5">Position / Dept</th>
                          <th className="p-3.5">Compensation</th>
                          <th className="p-3.5">Joining Date</th>
                          <th className="p-3.5 text-right">Offer Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {offerLetters.map(off => (
                          <tr key={off.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3.5">
                              <span className="font-bold text-slate-900 block">{off.candidateName}</span>
                              <span className="text-[10px] text-slate-400 font-mono">{off.candidateEmail}</span>
                            </td>
                            <td className="p-3.5">
                              <span className="text-slate-800 font-medium block">{off.designation}</span>
                              <span className="text-[10px] text-slate-400">{off.departmentName}</span>
                            </td>
                            <td className="p-3.5 font-bold font-mono text-slate-900">
                              {off.monthlySalary} / mo
                            </td>
                            <td className="p-3.5 font-mono text-slate-600">
                              {off.joiningDate}
                            </td>
                            <td className="p-3.5 text-right">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                                off.status === 'Accepted'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : off.status === 'Issued'
                                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}>
                                {off.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* MODULE 4: EMPLOYEES WORKSPACE */}
              {activeModule === 'employees' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Staff Personnel Directory</h4>
                      <p className="text-xs text-slate-500 mt-0.5">Manage digital employee profiles, salary tiers, and compliance dossiers</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          value={dashboardSearchQuery}
                          onChange={(e) => setDashboardSearchQuery(e.target.value)}
                          placeholder="Search staff..."
                          className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-blue-500"
                        />
                      </div>
                      <button
                        onClick={() => setShowAddEmployeeModal(true)}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {employees
                      .filter(emp => emp.name.toLowerCase().includes(dashboardSearchQuery.toLowerCase()) || emp.designation.toLowerCase().includes(dashboardSearchQuery.toLowerCase()))
                      .map(emp => {
                        const initials = emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                        return (
                          <div key={emp.id} className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:border-blue-300 transition-all space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                                  {initials}
                                </div>
                                <div>
                                  <h5 className="font-bold text-sm text-slate-900">{emp.name}</h5>
                                  <p className="text-xs text-slate-500">{emp.designation}</p>
                                </div>
                              </div>
                              <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                                emp.status === 'Full-Time'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : emp.status === 'Training / Probation'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-purple-50 text-purple-700 border-purple-200'
                              }`}>
                                {emp.status}
                              </span>
                            </div>

                            <div className="text-xs space-y-1 text-slate-600">
                              <div className="flex items-center gap-2">
                                <Mail className="w-3 h-3 text-slate-400" />
                                <span>{emp.email}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Phone className="w-3 h-3 text-slate-400" />
                                <span>{emp.phone}</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                              <button
                                onClick={() => handleToggleDocuments(emp.id)}
                                className={`text-[10px] font-mono font-semibold px-2 py-1 rounded-lg border ${
                                  emp.documentsCollected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {emp.documentsCollected ? '✓ KYC Verified' : '○ KYC Pending'}
                              </button>
                              <button
                                onClick={() => setSelectedProfileEmp(emp)}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                              >
                                View Dossier →
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* MODULE 5: LEAVES WORKSPACE */}
              {activeModule === 'leaves' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
                    <h4 className="text-sm font-bold text-slate-900">Leave Applications &amp; Shift Register</h4>
                    <p className="text-xs text-slate-500 mt-0.5">Authorizations queue, half-day noticing, and mail approval attachments</p>
                  </div>

                  {/* Priority Approvals Queue */}
                  <div className="space-y-3">
                    <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">Pending Authorizations</h5>
                    {leaves.filter(l => l.status === 'Pending' || l.status === 'Noted').map(lev => (
                      <div key={lev.id} className="p-4 rounded-xl bg-amber-50/50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900">{lev.employeeName}</span>
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-[10px] font-bold">{lev.leaveType}</span>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">{lev.reason} ({lev.startDate})</p>
                          {lev.attachmentName && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-blue-600 underline mt-1">
                              <FileText className="w-3 h-3" />
                              {lev.attachmentName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleApproveLeave(lev.id)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleDeclineLeave(lev.id)}
                            className="px-3 py-1.5 rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Full Leave Register */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                        <tr>
                          <th className="p-3.5">Staff</th>
                          <th className="p-3.5">Type</th>
                          <th className="p-3.5">Date</th>
                          <th className="p-3.5">Reason</th>
                          <th className="p-3.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {leaves.map(lev => (
                          <tr key={lev.id} className="hover:bg-slate-50">
                            <td className="p-3.5 font-bold text-slate-900 font-sans">{lev.employeeName}</td>
                            <td className="p-3.5">{lev.leaveType}</td>
                            <td className="p-3.5 text-slate-600">{lev.startDate}</td>
                            <td className="p-3.5 text-slate-700 font-sans">{lev.reason}</td>
                            <td className="p-3.5 text-right">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                lev.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}>
                                {lev.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* MODULE 6: AWARDS & CELEBRATIONS WORKSPACE */}
              {activeModule === 'awards' && (
                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="text-base font-bold text-slate-900 font-heading">Employee Awards, Upcoming Birthdays &amp; Anniversaries</h4>
                      <p className="text-xs text-slate-500 mt-0.5">Track upcoming employee milestones, work anniversaries (soon), birthdays within 30 days, and honors</p>
                    </div>
                    <button
                      onClick={() => handleNominateAward('Priya Sharma')}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
                    >
                      <Award className="w-4 h-4" />
                      <span>Nominate Star Award</span>
                    </button>
                  </div>

                  {/* Section 1: Upcoming Celebrations (Birthdays & Work Anniversaries) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Cake className="w-4 h-4 text-amber-600" />
                        <span>Upcoming Birthdays &amp; Work Anniversaries (Within 30 Days)</span>
                      </h5>
                      <span className="text-xs font-mono text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                        {upcomingCelebrations.length} Upcoming Events
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {upcomingCelebrations.map(cel => (
                        <div
                          key={cel.id}
                          className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            cel.type === 'birthday'
                              ? 'bg-amber-50/60 border-amber-200'
                              : 'bg-indigo-50/60 border-indigo-200'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-white shadow-xs ${
                              cel.type === 'birthday' ? 'bg-amber-500' : 'bg-indigo-600'
                            }`}>
                              {cel.type === 'birthday' ? <Cake className="w-5 h-5" /> : <PartyPopper className="w-5 h-5" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h6 className="font-bold text-sm text-slate-900">{cel.name}</h6>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                                  cel.type === 'birthday'
                                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                                    : 'bg-indigo-100 text-indigo-900 border-indigo-300'
                                }`}>
                                  {cel.type === 'birthday' ? '🎂 Birthday' : '🎈 Anniversary'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500">{cel.role} &bull; <strong className="text-slate-800">{cel.date}</strong> ({cel.daysLeft} days away)</p>
                              {cel.milestone && (
                                <span className="text-[11px] font-mono text-indigo-700 font-semibold mt-0.5 block">
                                  🏅 Milestone: {cel.milestone}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0">
                            {cel.type === 'birthday' ? (
                              <button
                                onClick={() => handleWishBirthday(cel.name, cel.id)}
                                disabled={cel.wished}
                                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                  cel.wished
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                                }`}
                              >
                                <Cake className="w-3.5 h-3.5" />
                                <span>{cel.wished ? '✓ Wished' : 'Send Birthday Wish 🎉'}</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => handleRecognizeAnniversary(cel.name, cel.milestone || 'Work Anniversary', cel.id)}
                                disabled={cel.recognized}
                                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                  cel.recognized
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                                }`}
                              >
                                <Award className="w-3.5 h-3.5" />
                                <span>{cel.recognized ? '✓ Honored' : 'Award Milestone Badge 🏅'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section 2: Star Performers & Wall of Honors */}
                  <div className="space-y-3 pt-2">
                    <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                      Executive Star Performers of the Quarter
                    </h5>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold">
                            <Award className="w-5 h-5" />
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-200 text-amber-900">
                            Star of the Month Q3
                          </span>
                        </div>
                        <div>
                          <h5 className="font-bold text-base text-slate-900">Priya Sharma</h5>
                          <p className="text-xs text-slate-600 mt-1">Senior HR Partner • Recognized for 100% On-Time Onboarding &amp; Policy Revamp</p>
                        </div>
                        <button
                          onClick={() => handleNominateAward('Priya Sharma')}
                          className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          Celebrate Priya 👏
                        </button>
                      </div>

                      <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                            <Calendar className="w-5 h-5" />
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-200 text-blue-900">
                            Work Anniversary
                          </span>
                        </div>
                        <div>
                          <h5 className="font-bold text-base text-slate-900">Alexander Wright</h5>
                          <p className="text-xs text-slate-600 mt-1">1 Year of Outstanding Leadership at Amuwa HQ</p>
                        </div>
                        <button
                          onClick={() => handleNominateAward('Alexander Wright')}
                          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          Send Congrats 🚀
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* MODULE 7, 8, 9: AUTOMATED LETTERS & CONTRACTS WORKSPACE */}
              {(activeModule === 'offer_letter' || activeModule === 'experience_letter' || activeModule === 'nda_letter' || activeModule === 'letters') && (
                <AutomatedLetterGeneratorWorkspace
                  initialTab={activeModule === 'experience_letter' ? 'experience' : activeModule === 'nda_letter' ? 'nda' : 'offer'}
                  employees={employees}
                  onClose={() => setActiveModule(null)}
                  onSuccessToast={(msg) => {
                    setOpToast(msg);
                    setTimeout(() => setOpToast(null), 4500);
                  }}
                />
              )}
            </div>
          ) : (
            /* 3X3 GRID OF MINIMAL & HIGH-IMPACT OPERATIONAL MODULE BOXES */
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">

                {/* 1. Attendance Management */}
                <div 
                  onClick={() => setActiveModule('attendance')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-emerald-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <CalendarCheck className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Live Logs
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-emerald-700 transition-colors mt-3">
                      Attendance Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      System auto-capture login &amp; biometric punch records
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-purple-700 font-semibold flex items-center gap-1.5 truncate">
                        <Fingerprint className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                        <span>Biometric Active</span>
                      </span>
                      <span className="text-emerald-700 font-semibold flex items-center gap-1.5 shrink-0">
                        <Monitor className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>CRM System Logins</span>
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-emerald-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 2. Department Management */}
                <div 
                  onClick={() => setActiveModule('departments')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-purple-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        10 Units
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-purple-700 transition-colors mt-3">
                      Department Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Corporate hierarchy &amp; operational business units
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-purple-700 font-bold">10 Active Units</span>
                      <span className="text-[11px] text-slate-500">4 Divisions</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-purple-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 3. Recruitment Management */}
                <div 
                  onClick={() => setActiveModule('recruitment')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-blue-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Briefcase className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        Talent Pool
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-700 transition-colors mt-3">
                      Recruitment Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Candidate pipeline &amp; interview scheduling
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-blue-700 font-bold">2 Active Candidates</span>
                      <span className="text-[11px] text-slate-500">Offers Ready</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-blue-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 4. Employee Management */}
                <div 
                  onClick={() => setActiveModule('employees')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-indigo-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Users className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Full Roster
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-700 transition-colors mt-3">
                      Employee Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Staff directory, KYC profiles &amp; salary tiers
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-indigo-700 font-bold">{employees.length} Personnel Active</span>
                      <span className="text-[11px] text-emerald-600 font-semibold">{employees.filter(e => e.documentsCollected).length}/{employees.length} KYC</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-indigo-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 5. Leave Management */}
                <div 
                  onClick={() => setActiveModule('leaves')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-amber-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Palmtree className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                        Approval Queue
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-amber-700 transition-colors mt-3">
                      Leave Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Paid time off &amp; leave approval requests
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/60 flex items-center justify-between text-xs font-mono">
                      <span className="text-amber-900 font-bold truncate">Rohan Mehta (Half-Day)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold shrink-0">1 Pending</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-amber-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 6. Award & Celebrations Management */}
                <div 
                  onClick={() => setActiveModule('awards')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-amber-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Award className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Milestones
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-amber-700 transition-colors mt-3">
                      Award Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Upcoming birthdays, work anniversaries &amp; honors
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-amber-900 font-semibold truncate flex items-center gap-1">
                        <Cake className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span className="truncate">Kavya (in 4d)</span>
                      </span>
                      <span className="text-indigo-800 text-[11px] font-semibold shrink-0">1-Yr Anniv (in 7d)</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-amber-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 7. Offer Letter Management */}
                <div 
                  onClick={() => setActiveModule('offer_letter')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-blue-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <FileCheck2 className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        Automated
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-700 transition-colors mt-3">
                      Offer Letter Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Automated candidate offer generation &amp; PDF preview
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-blue-700 font-bold">Auto CTC Structuring</span>
                      <span className="text-[11px] text-slate-500">PDF Ready</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-blue-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 8. Experience Letter Management */}
                <div 
                  onClick={() => setActiveModule('experience_letter')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-purple-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Award className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        Relieving
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-purple-700 transition-colors mt-3">
                      Experience Letter Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Relieving certificates &amp; service verification
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-purple-700 font-bold">Tenure Calculator</span>
                      <span className="text-[11px] text-slate-500">Official Seal</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-purple-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                {/* 9. NDA Letter Management */}
                <div 
                  onClick={() => setActiveModule('nda_letter')}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-emerald-300 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Legal IP
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-emerald-700 transition-colors mt-3">
                      NDA Letter Management
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      Mutual confidentiality &amp; proprietary covenants
                    </p>

                    <div className="mt-3.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs font-mono">
                      <span className="text-emerald-700 font-bold">Standard Covenants</span>
                      <span className="text-[11px] text-slate-500">Digital Binding</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-emerald-700 transition-colors">
                    <span>Open Workspace</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      )}

      {/* HR & OPERATIONS MANAGEMENT SECTION */}
      {mainSection === 'hr_ops' && (
        <div className="space-y-6 animate-fade-in">

          {/* HR & Operations Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-sm">
            <div>
              <h3 className="text-base font-bold font-heading text-slate-900">HR &amp; Operations Management</h3>
              <p className="text-xs font-mono text-slate-500">Employee directory, document vault, automated 7-page offer letters &amp; leave register</p>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>{employees.length} Registered Staff</span>
              </span>
            </div>
          </div>

          {/* Sub-tabs inside HR & OPERATIONS */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
            <button
              onClick={() => setHrSubTab('employees')}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-2 ${
                hrSubTab === 'employees'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Employee Directory &amp; Roster ({employees.length})</span>
            </button>

            <button
              onClick={() => setHrSubTab('offers')}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-2 ${
                hrSubTab === 'offers'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Offer Letters Automated ({offerLetters.length})</span>
            </button>

            <button
              onClick={() => setHrSubTab('leaves')}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-2 ${
                hrSubTab === 'leaves'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Half-Days &amp; Leave Register ({leaves.length})</span>
            </button>
          </div>

          {/* SUB-TAB 1: EMPLOYEE DIRECTORY */}
          {hrSubTab === 'employees' && (
            <div className="space-y-4">

              {/* Filter Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  <button
                    onClick={() => setEmployeeFilter('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                      employeeFilter === 'all' ? 'bg-slate-900 text-white shadow-2xs' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    All Staff ({employees.length})
                  </button>

                  <button
                    onClick={() => setEmployeeFilter('fulltime')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                      employeeFilter === 'fulltime' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-white text-emerald-800 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Full Employees ({fulltimeCount})
                  </button>

                  <button
                    onClick={() => setEmployeeFilter('trainees')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                      employeeFilter === 'trainees' ? 'bg-amber-600 text-white shadow-2xs' : 'bg-white text-amber-800 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    In-Training ({traineesCount})
                  </button>

                  <button
                    onClick={() => setEmployeeFilter('interns')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                      employeeFilter === 'interns' ? 'bg-purple-600 text-white shadow-2xs' : 'bg-white text-purple-800 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Interns ({internsCount})
                  </button>

                  <button
                    onClick={() => setEmployeeFilter('left')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                      employeeFilter === 'left' ? 'bg-slate-700 text-white shadow-2xs' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Left Company ({leftCount})
                  </button>
                </div>

                <span className="text-xs text-slate-500 font-mono">
                  Click any employee row to open full profile &amp; document vault
                </span>
              </div>

              {/* Employee Table */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase">
                      <tr>
                        <th className="p-3.5">Employee Name &amp; ID</th>
                        <th className="p-3.5">Designation &amp; Salary</th>
                        <th className="p-3.5">Employment Type</th>
                        <th className="p-3.5">Documents Status</th>
                        <th className="p-3.5">Half-Days &amp; Leaves</th>
                        <th className="p-3.5 text-right">Actions / Profile</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEmployees.map(emp => (
                        <tr
                          key={emp.id}
                          onClick={() => setSelectedProfileEmp(emp)}
                          className="hover:bg-blue-50/50 cursor-pointer transition-colors group"
                        >
                          <td className="p-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center font-mono font-bold text-slate-800 overflow-hidden shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                                {emp.avatarUrl ? (
                                  <img src={emp.avatarUrl} alt={emp.name} className="w-full h-full object-cover" />
                                ) : (
                                  <span>{emp.name.charAt(0)}</span>
                                )}
                              </div>
                              <div>
                                <span className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors block">{emp.name}</span>
                                <span className="text-[11px] font-mono text-slate-400">{emp.id} &bull; {emp.email}</span>
                              </div>
                            </div>
                          </td>

                          <td className="p-3.5 font-medium text-slate-700">
                            {emp.designation}
                            <span className="block text-[11px] font-mono font-bold text-emerald-700">{emp.monthlySalary || '₹65,000'}</span>
                          </td>

                          <td className="p-3.5">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border ${
                              emp.status === 'Full-Time'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : emp.status === 'Intern'
                                ? 'bg-purple-50 text-purple-800 border-purple-200'
                                : emp.status === 'Left'
                                ? 'bg-slate-100 text-slate-600 border-slate-300'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}>
                              {emp.status === 'Full-Time' ? 'Employee' : emp.status === 'Training / Probation' ? 'In-Training' : emp.status}
                            </span>
                          </td>

                          <td className="p-3.5">
                            <button
                              type="button"
                              onClick={(e) => handleToggleDocuments(emp.id, e)}
                              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-mono font-bold transition-all border shadow-2xs ${
                                emp.documentsCollected
                                  ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600'
                                  : 'bg-rose-600 text-white border-rose-700 hover:bg-rose-700'
                              }`}
                            >
                              {emp.documentsCollected ? (
                                <>
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>COLLECTED (VERIFIED)</span>
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>PENDING VERIFICATION</span>
                                </>
                              )}
                            </button>
                          </td>

                          <td className="p-3.5 font-mono text-xs">
                            <span className="text-slate-800 block">Half-Days: <strong>{emp.halfDaysCount}</strong></span>
                            <span className="text-slate-500 text-[11px]">Full-Days: {emp.totalLeavesCount}</span>
                          </td>

                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {(emp.status === 'Training / Probation' || emp.status === 'Intern') && (
                                <button
                                  type="button"
                                  onClick={(e) => handleConvertTraineeToEmployee(emp.id, e)}
                                  className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-mono font-bold shadow-2xs flex items-center gap-1"
                                  title="Confirm &amp; Convert to Permanent Employee"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>CONVERT TO EMPLOYEE</span>
                                </button>
                              )}

                              {emp.status !== 'Left' && (
                                <button
                                  type="button"
                                  onClick={(e) => handleMarkLeft(emp.id, e)}
                                  className="px-2 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-rose-600 border border-slate-200 text-[11px] font-mono font-bold flex items-center gap-1"
                                  title="Mark Employee as Left Company"
                                >
                                  <UserMinus className="w-3 h-3" />
                                  <span>LEFT</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setSelectedProfileEmp(emp)}
                                className="px-2.5 py-1 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-mono font-bold hover:bg-blue-100 flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" />
                                <span>PROFILE →</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* SUB-TAB 2: OFFER LETTERS AUTOMATION */}
          {hrSubTab === 'offers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-red-50 p-4 rounded-2xl border border-red-100">
                <div>
                  <h4 className="text-sm font-bold text-red-950">Official 7-Page Appointment Letter Generator</h4>
                  <p className="text-xs text-red-800">Generate official 7-page Amuwa Corporation appointment letters with complete Terms &amp; Annexure A policies.</p>
                </div>
                <button
                  onClick={() => setShowOfferModal(true)}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold font-mono flex items-center gap-1.5 shadow-md"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Official Letter</span>
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase">
                    <tr>
                      <th className="p-3.5">Offer Reference &amp; Candidate</th>
                      <th className="p-3.5">Designation &amp; Department</th>
                      <th className="p-3.5">Salary &amp; Working Hours</th>
                      <th className="p-3.5">Joining Date</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {offerLetters.map(off => (
                      <tr key={off.id} className="hover:bg-slate-50/80">
                        <td className="p-3.5">
                          <span className="font-bold text-slate-900 block">{off.candidateName}</span>
                          <span className="text-[11px] font-mono text-slate-400">{off.id} &bull; {off.candidateEmail}</span>
                        </td>
                        <td className="p-3.5 font-medium text-slate-700">
                          {off.designation}
                          <span className="block text-[10px] text-slate-400 font-mono">{off.departmentName}</span>
                        </td>
                        <td className="p-3.5 font-mono">
                          <span className="text-slate-900 font-bold block">{off.monthlySalary} / mo ({off.annualCTC})</span>
                          <span className="text-slate-500 text-[10px]">{off.workingHours || '09:30 AM - 06:30 PM'}</span>
                        </td>
                        <td className="p-3.5 font-mono text-slate-700">
                          {off.joiningDate}
                        </td>
                        <td className="p-3.5">
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {off.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUB-TAB 3: LEAVE REGISTER */}
          {hrSubTab === 'leaves' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <h4 className="text-sm font-bold text-slate-900">Half-Day &amp; Full Leave Register</h4>
                <p className="text-xs text-slate-500 mt-0.5">Click on any employee row in the Employee Directory to file custom leaves with mandatory mail attachments or process leave cancellations.</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase">
                    <tr>
                      <th className="p-3.5">Employee Name</th>
                      <th className="p-3.5">Leave / Noting Type</th>
                      <th className="p-3.5">Date</th>
                      <th className="p-3.5">Reason &amp; Mail Approval Attachment</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaves.map(lev => (
                      <tr key={lev.id} className="hover:bg-slate-50/80">
                        <td className="p-3.5 font-bold text-slate-900">
                          {lev.employeeName}
                          <span className="block text-[10px] font-mono text-slate-400">{lev.employeeId}</span>
                        </td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                            lev.leaveType === 'Half-Day' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900'
                          }`}>
                            {lev.leaveType}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono text-slate-700">
                          {lev.startDate}
                        </td>
                        <td className="p-3.5">
                          <p className="text-slate-800">{lev.reason}</p>
                          {lev.attachmentName && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-blue-600 underline mt-0.5">
                              <FileText className="w-3 h-3" />
                              {lev.attachmentName}
                            </span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {lev.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}

      {/* MODALS */}
      {selectedProfileEmp && (
        <EmployeeProfileModal
          employee={selectedProfileEmp}
          onClose={() => setSelectedProfileEmp(null)}
          onUpdateEmployee={handleUpdateEmployee}
        />
      )}

      {showOfferModal && (
        <AmuwaOfficialOfferLetter
          onClose={() => setShowOfferModal(false)}
        />
      )}

      {/* ADD NEW EMPLOYEE MODAL */}
      {showAddEmployeeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-2xl animate-scale-up my-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shadow-xs">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">Add New Personnel</h3>
                  <p className="text-xs text-slate-500">Register employee, assign role, tier (intern/full-time) &amp; compensation</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowAddEmployeeModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddEmployee} className="space-y-4">
              {/* Row 1: Full Name & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Full Name *</label>
                  <input
                    type="text"
                    value={newEmpName}
                    onChange={(e) => setNewEmpName(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium text-slate-800"
                    placeholder="e.g. Rahul Sharma"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Work Email *</label>
                  <input
                    type="email"
                    value={newEmpEmail}
                    onChange={(e) => setNewEmpEmail(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium text-slate-800"
                    placeholder="rahul.sharma@amuwahq.com"
                  />
                </div>
              </div>

              {/* Row 2: Phone & Role / Designation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Phone Number</label>
                  <input
                    type="text"
                    value={newEmpPhone}
                    onChange={(e) => setNewEmpPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium text-slate-800"
                    placeholder="+91 98000 00000"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Role / Designation *</label>
                  <input
                    type="text"
                    value={newEmpDesignation}
                    onChange={(e) => setNewEmpDesignation(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium text-slate-800"
                    placeholder="e.g. Operations Specialist, Frontend Dev"
                  />
                </div>
              </div>

              {/* Row 3: Employment Type (Role Tier) & Department */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Employment Tier *</label>
                  <select
                    value={newEmpStatus}
                    onChange={(e) => {
                      const val = e.target.value as 'Full-Time' | 'Training / Probation' | 'Intern';
                      setNewEmpStatus(val);
                      if (val === 'Intern' && newEmpSalary === '₹60,000') {
                        setNewEmpSalary('₹18,000');
                        if (newEmpDesignation === 'HR Specialist') setNewEmpDesignation('HR Intern');
                      } else if (val === 'Full-Time' && newEmpSalary === '₹18,000') {
                        setNewEmpSalary('₹60,000');
                        if (newEmpDesignation === 'HR Intern') setNewEmpDesignation('HR Specialist');
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium text-slate-800 bg-white"
                  >
                    <option value="Full-Time">Full-Time Employee (Permanent)</option>
                    <option value="Training / Probation">Training / Probation (Trainee)</option>
                    <option value="Intern">Intern (Internship Track)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Department *</label>
                  <select
                    value={newEmpDepartment}
                    onChange={(e) => setNewEmpDepartment(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium text-slate-800 bg-white"
                  >
                    {CORPORATE_DEPARTMENTS.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Wabastore Sub-Department Selector when Wabastore is chosen */}
              {newEmpDepartment === 'wabastore' && (
                <div className="p-3.5 bg-gradient-to-r from-emerald-50/90 to-teal-50/90 border border-emerald-300 rounded-2xl animate-scale-up space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono font-bold text-emerald-900 flex items-center gap-1.5">
                      <span>WabaStore Sub-Department *</span>
                    </label>
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-200/80 px-2 py-0.5 rounded-md">
                      Requires SuperAdmin / Admin Approval
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setNewEmpSubDepartment('sales')}
                      className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        newEmpSubDepartment === 'sales'
                          ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-500/30'
                          : 'bg-white text-slate-700 border border-emerald-200 hover:bg-emerald-50/50'
                      }`}
                    >
                      <span>WabaStore Sales</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewEmpSubDepartment('support')}
                      className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        newEmpSubDepartment === 'support'
                          ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-500/30'
                          : 'bg-white text-slate-700 border border-emerald-200 hover:bg-emerald-50/50'
                      }`}
                    >
                      <span>WabaStore Support</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    ⚡ Candidate will be dispatched to <strong>WabaStore {newEmpSubDepartment === 'sales' ? 'Sales' : 'Support'} Head</strong> and will appear in the top pending approval pop-up.
                  </p>
                </div>
              )}

              {/* Row 4: Monthly Salary / Stipend & Joining Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Monthly Salary / Stipend</label>
                  <input
                    type="text"
                    value={newEmpSalary}
                    onChange={(e) => setNewEmpSalary(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-mono font-bold text-slate-800"
                    placeholder="₹60,000"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Date of Joining</label>
                  <input
                    type="date"
                    value={newEmpJoiningDate}
                    onChange={(e) => setNewEmpJoiningDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-mono text-slate-800 bg-white"
                  />
                </div>
              </div>

              {/* Row 5: Shift & Working Hours */}
              <div>
                <label className="text-xs font-mono font-bold text-slate-700 mb-1.5 block">Shift &amp; Working Hours</label>
                <select
                  value={newEmpHours}
                  onChange={(e) => setNewEmpHours(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium text-slate-800 bg-white"
                >
                  <option value="09:30 AM - 06:30 PM (Mon-Sat)">09:30 AM - 06:30 PM (Mon-Sat) - Standard HQ Shift</option>
                  <option value="10:00 AM - 07:00 PM (Mon-Fri)">10:00 AM - 07:00 PM (Mon-Fri) - Tech &amp; Design Shift</option>
                  <option value="09:00 AM - 06:00 PM (Mon-Sat)">09:00 AM - 06:00 PM (Mon-Sat) - Operations Shift</option>
                  <option value="Flexible Part-Time (Intern Shift)">Flexible Part-Time (Intern Shift)</option>
                </select>
              </div>

              {/* Row 6: Initial KYC Status Checkbox */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-900 block">KYC &amp; Credentials Collected</span>
                  <span className="text-[11px] text-slate-500 block">Government ID, PAN &amp; Bank Direct Deposit verified</span>
                </div>
                <input
                  type="checkbox"
                  checked={newEmpDocsCollected}
                  onChange={(e) => setNewEmpDocsCollected(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddEmployeeModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Onboard Personnel</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANUAL CLOCK-IN / PUNCH MODAL */}
      {showManualPunchModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl animate-scale-up space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Manual Attendance Punch</h3>
                  <p className="text-xs text-slate-500">Log biometric scanner or manual override</p>
                </div>
              </div>
              <button 
                onClick={() => setShowManualPunchModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveManualPunch} className="space-y-4">
              <div>
                <label className="text-xs font-mono font-bold text-slate-600 mb-1 block">Staff Member *</label>
                <select
                  value={punchEmpId}
                  onChange={(e) => setPunchEmpId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium bg-white"
                >
                  {employees.filter(e => e.status !== 'Left').map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono font-bold text-slate-600 mb-1 block">Punch Time *</label>
                  <input
                    type="text"
                    value={punchTime}
                    onChange={(e) => setPunchTime(e.target.value)}
                    required
                    placeholder="09:30 AM"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono font-bold text-slate-600 mb-1 block">Status</label>
                  <select
                    value={punchStatus}
                    onChange={(e) => setPunchStatus(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium bg-white"
                  >
                    <option value="On Time">On Time</option>
                    <option value="Half-Day Approved">Half-Day Approved</option>
                    <option value="Late">Late</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-mono font-bold text-slate-600 mb-1 block">Verification Device</label>
                <select
                  value={punchDevice}
                  onChange={(e) => setPunchDevice(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-xs font-medium bg-white"
                >
                  <option value="Biometric Scanner">Biometric Scanner (Entrance Turnstile)</option>
                  <option value="Mobile Punch">Mobile Punch (Geo-Fenced App)</option>
                  <option value="HR Override">HR Override (Manual Supervisor Entry)</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualPunchModal(false)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  Save Punch Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAYROLL & SALARY LEDGER AUDIT MODAL */}
      {showPayrollModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl animate-scale-up space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Monthly Payroll &amp; Salary Ledger</h3>
                  <p className="text-xs text-slate-500">Live compensation audit &amp; disbursement breakdown</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPayrollModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick KPI stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-semibold">Total Monthly CTC</div>
                <div className="text-lg font-bold font-heading text-slate-900">₹2,00,000</div>
                <div className="text-[10px] text-emerald-600 font-mono font-medium">● 100% On Schedule</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-semibold">Active Payees</div>
                <div className="text-lg font-bold font-heading text-slate-900">4 Employees</div>
                <div className="text-[10px] text-blue-600 font-mono font-medium">NEFT / Direct Deposit</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-mono uppercase text-slate-400 font-semibold">TDS &amp; Compliance</div>
                <div className="text-lg font-bold font-heading text-slate-900">Verified</div>
                <div className="text-[10px] text-emerald-600 font-mono font-medium">Statutory Clean</div>
              </div>
            </div>

            {/* Payroll Breakdown Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Employee</th>
                    <th className="p-3">Designation</th>
                    <th className="p-3">Gross Salary</th>
                    <th className="p-3 text-right">Disbursement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {employees.filter(e => e.status !== 'Left').map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50/70">
                      <td className="p-3">
                        <span className="font-bold text-slate-900 font-sans block">{emp.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{emp.id}</span>
                      </td>
                      <td className="p-3 text-slate-600 font-sans text-xs">
                        {emp.designation}
                      </td>
                      <td className="p-3 font-bold text-slate-900">
                        {emp.monthlySalary || '₹50,000'}
                      </td>
                      <td className="p-3 text-right">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Check className="w-3 h-3" />
                          Processed
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  const headers = ['Employee ID', 'Name', 'Designation', 'Gross Monthly Salary', 'Disbursement Status'];
                  const rows = employees.filter(e => e.status !== 'Left').map(e => [e.id, `"${e.name}"`, `"${e.designation}"`, `"${e.monthlySalary || '₹50,000'}"`, 'Processed']);
                  const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                  const link = document.createElement('a');
                  link.setAttribute('href', encodeURI(csv));
                  link.setAttribute('download', `payroll_ledger_${new Date().toISOString().split('T')[0]}.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  setOpToast('📥 Downloaded monthly payroll ledger CSV!');
                  setTimeout(() => setOpToast(null), 4500);
                }}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Payroll Sheet</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPayrollModal(false)}
                className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
