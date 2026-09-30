import React, { useState, useEffect } from 'react';
import { 
  Users, FileText, UserPlus, CheckCircle2, Clock, AlertCircle, 
  Calendar, Award, Sparkles, Send, FileCheck, ArrowRight, ShieldCheck,
  UserMinus, Eye, Plus, LayoutDashboard
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useLeadStore } from '../../../context/LeadStoreContext';
import { 
  INITIAL_EMPLOYEES, 
  INITIAL_OFFER_LETTERS, 
  INITIAL_LEAVE_APPLICATIONS
} from '../../../data/amuwaHqInitialData';
import { Employee, OfferLetter, LeaveApplication } from '../../../types/amuwaHq';
import { AmuwaOfficialOfferLetter } from './AmuwaOfficialOfferLetter';
import { EmployeeProfileModal } from './EmployeeProfileModal';
import { AccountsPanel } from './AccountsPanel';
import { AmuwaSettingsPanel } from './AmuwaSettingsPanel';
import { AmuwaHRStaffManagement } from './AmuwaHRStaffManagement';
import { FieldVisitTrackerView } from '../../common/FieldVisitTrackerView';
import { ActiveTab } from '../../layout/Sidebar';

interface AmuwaHqPanelProps {
  activeTab?: ActiveTab;
}

export const AmuwaHqPanel: React.FC<AmuwaHqPanelProps> = ({ activeTab = 'dashboard' }) => {
  const { activeDepartment } = useAuth();
  const { getLeadsForDepartment } = useLeadStore();

  // State Management
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [offerLetters, setOfferLetters] = useState<OfferLetter[]>(INITIAL_OFFER_LETTERS);
  const [leaves, setLeaves] = useState<LeaveApplication[]>(INITIAL_LEAVE_APPLICATIONS);

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
  const [newEmpDesignation, setNewEmpDesignation] = useState('Operations Executive');
  const [newEmpSalary, setNewEmpSalary] = useState('₹65,000');
  const [newEmpHours, setNewEmpHours] = useState('09:30 AM - 06:30 PM (Mon-Sat)');
  const [newEmpStatus, setNewEmpStatus] = useState<'Full-Time' | 'Training / Probation' | 'Intern'>('Training / Probation');

  // Trainee / Intern Conversion Handler
  const handleConvertTraineeToEmployee = (empId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEmployees(prev => prev.map(emp => {
      if (emp.id === empId) {
        return {
          ...emp,
          status: 'Full-Time',
          designation: emp.designation.replace(/(Trainee|Intern)/gi, 'Executive'),
          notes: `Converted to Permanent Employee on ${new Date().toLocaleDateString()}`
        };
      }
      return emp;
    }));
  };

  // Mark Left Handler
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

  // Toggle Document Collection status
  const handleToggleDocuments = (empId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEmployees(prev => prev.map(emp => {
      if (emp.id === empId) {
        return { ...emp, documentsCollected: !emp.documentsCollected };
      }
      return emp;
    }));
  };

  // Update employee from profile modal
  const handleUpdateEmployee = (updatedEmp: Employee) => {
    setEmployees(prev => prev.map(emp => emp.id === updatedEmp.id ? updatedEmp : emp));
  };

  // Add New Employee Handler
  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName || !newEmpEmail) return;

    const newEmp: Employee = {
      id: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      name: newEmpName,
      email: newEmpEmail,
      phone: newEmpPhone || '+91 98000 00000',
      designation: newEmpDesignation,
      departmentId: 'amuwa',
      status: newEmpStatus,
      joiningDate: new Date().toISOString().split('T')[0],
      workingHours: newEmpHours,
      monthlySalary: newEmpSalary,
      documentsCollected: false,
      uploadedDocs: [],
      leaveHistory: [],
      halfDaysCount: 0,
      totalLeavesCount: 0
    };

    setEmployees(prev => [newEmp, ...prev]);
    setShowAddEmployeeModal(false);
    setNewEmpName('');
    setNewEmpEmail('');
  };

  // Filtered employees
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
  const docsPendingCount = employees.filter(e => !e.documentsCollected).length;

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Top Department Brand Header (Without Action Buttons) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-rose-500 to-amber-500" />

        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-white p-1 border border-slate-200 flex items-center justify-center shrink-0 shadow-sm">
            <img src="/logos/amuwa.png" alt="Amuwa Corporation" className="h-full w-full object-contain" />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
              <span className="text-xs font-mono text-red-700 font-bold uppercase">
                AMUWA-CORP &bull; CORPORATE HEADQUARTERS
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
              Amuwa Corporation Panel
            </h2>
          </div>
        </div>
      </div>

      {/* SECTION 1: DASHBOARD OVERVIEW (CLEAN & EMPTY READY FOR INSTRUCTIONS) */}
      {mainSection === 'dashboard' && (
        <div className="p-12 rounded-3xl bg-white border border-slate-200 shadow-sm text-center space-y-3 min-h-[400px] flex flex-col items-center justify-center animate-fade-in">
          <div className="w-16 h-16 rounded-3xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center">
            <LayoutDashboard className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold font-heading text-slate-900">Amuwa Corporation Dashboard</h3>
          <p className="text-xs font-mono text-slate-400 max-w-md">
            Ready for instructions on what metrics and widgets to induce here.
          </p>
        </div>
      )}

      {/* SECTION 2: HR & OPERATIONS (CONTAINS OFFER LETTER & ADD EMPLOYEE BUTTONS) */}
      {mainSection === 'hr_ops' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* HR & Operations Header Bar with OFFER LETTER & ADD EMPLOYEE Buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 shadow-sm">
            <div>
              <h3 className="text-base font-bold font-heading text-slate-900 dark:text-white">HR &amp; Operations Management</h3>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400">Employee directory, document vault, automated 7-page offer letters &amp; leave register</p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => setShowOfferModal(true)}
                className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold font-mono flex items-center gap-1.5 transition-all shadow-md active:scale-95 btn-shimmer"
              >
                <Sparkles className="w-4 h-4" />
                <span>OFFER LETTER AUTOMATION</span>
              </button>

              <button
                onClick={() => setShowAddEmployeeModal(true)}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold font-mono flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
              >
                <UserPlus className="w-4 h-4 text-blue-400 dark:text-blue-600" />
                <span>ADD EMPLOYEE</span>
              </button>
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
                                  title="Confirm & Convert to Permanent Employee"
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
                                <span>PROFILE &rarr;</span>
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

      {/* SECTION 5: FIELD VISIT GPS TRACKING */}
      {mainSection === 'field_visits' && (
        <FieldVisitTrackerView viewerRole="admin" userName="Super Admin Console" />
      )}

      {/* MODAL: FULL EMPLOYEE PROFILE DRAWER / MODAL */}
      {selectedProfileEmp && (
        <EmployeeProfileModal
          employee={selectedProfileEmp}
          onClose={() => setSelectedProfileEmp(null)}
          onUpdateEmployee={handleUpdateEmployee}
        />
      )}

      {/* MODAL: OFFICIAL 7-PAGE APPOINTMENT LETTER GENERATOR */}
      {showOfferModal && (
        <AmuwaOfficialOfferLetter
          onClose={() => setShowOfferModal(false)}
          onIssueOfferLetter={(newOffer) => setOfferLetters(prev => [newOffer, ...prev])}
        />
      )}

      {/* MODAL: ADD NEW EMPLOYEE / INTERN / TRAINEE */}
      {showAddEmployeeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl animate-scale-up space-y-4">
            <h3 className="text-lg font-bold font-heading text-slate-900">Add New Staff Member</h3>
            <form onSubmit={handleAddEmployee} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono">FULL NAME *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Deshmukh"
                  value={newEmpName}
                  onChange={e => setNewEmpName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono">OFFICIAL EMAIL *</label>
                <input
                  type="email"
                  required
                  placeholder="rahul.d@amuwa.com"
                  value={newEmpEmail}
                  onChange={e => setNewEmpEmail(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono">PHONE NUMBER</label>
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={newEmpPhone}
                  onChange={e => setNewEmpPhone(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono">DESIGNATION</label>
                <input
                  type="text"
                  value={newEmpDesignation}
                  onChange={e => setNewEmpDesignation(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono">MONTHLY SALARY</label>
                  <input
                    type="text"
                    value={newEmpSalary}
                    onChange={e => setNewEmpSalary(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono">WORKING HOURS</label>
                  <input
                    type="text"
                    value={newEmpHours}
                    onChange={e => setNewEmpHours(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[10px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono">EMPLOYMENT TYPE</label>
                <select
                  value={newEmpStatus}
                  onChange={e => setNewEmpStatus(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value="Training / Probation">In-Training / Probation</option>
                  <option value="Intern">Intern</option>
                  <option value="Full-Time">Full-Time Employee</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddEmployeeModal(false)}
                  className="w-1/2 py-2 rounded-xl bg-slate-100 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2 rounded-xl bg-slate-900 text-white font-semibold font-mono"
                >
                  Save Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
