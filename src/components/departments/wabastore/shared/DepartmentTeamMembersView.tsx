import React, { useState, useEffect } from 'react';
import {
  Users, UserCheck, ShieldAlert, CheckCircle2, Search,
  Clock, ShieldCheck, Sparkles, Check, X, Filter
} from 'lucide-react';
import { useAuth } from '../../../../context/AuthContext';
import { departmentMemberStore, DepartmentMember } from '../../../../services/departmentMemberStore';

interface DepartmentTeamMembersViewProps {
  department: 'sales' | 'support';
}

export const DepartmentTeamMembersView: React.FC<DepartmentTeamMembersViewProps> = ({ department }) => {
  const { user } = useAuth();
  const [approvedMembers, setApprovedMembers] = useState<DepartmentMember[]>([]);
  const [pendingMembers, setPendingMembers] = useState<DepartmentMember[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Employee' | 'Intern'>('All');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync with store
  const refreshMembers = () => {
    setApprovedMembers(departmentMemberStore.getApprovedMembers(department));
    setPendingMembers(departmentMemberStore.getPendingMembers(department));
  };

  useEffect(() => {
    refreshMembers();
    const unsubscribe = departmentMemberStore.subscribe(() => {
      refreshMembers();
    });
    return () => unsubscribe();
  }, [department]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Approval handler
  const handleApprove = (member: DepartmentMember) => {
    const approverName = user?.name ? `${user.name} (${user.role.toUpperCase()})` : 'SuperAdmin';
    const success = departmentMemberStore.approveMember(member.id, approverName);
    if (success) {
      showToast(`✅ Approved ${member.name} (${member.id})! Successfully added to ${department === 'sales' ? 'Sales' : 'Support'} Department Members.`);
      refreshMembers();
    }
  };

  // Rejection handler
  const handleReject = (member: DepartmentMember) => {
    const success = departmentMemberStore.rejectMember(member.id);
    if (success) {
      showToast(`❌ Declined request for ${member.name}. Request returned to HR.`);
      refreshMembers();
    }
  };

  // Filter approved members
  const filteredMembers = approvedMembers.filter(m => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.role.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = typeFilter === 'All' || m.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const isSales = department === 'sales';
  const deptTitle = isSales ? 'WabaStore Sales' : 'WabaStore Support';

  // Count summaries
  const totalApproved = approvedMembers.length;
  const totalEmployees = approvedMembers.filter(m => m.type === 'Employee').length;
  const totalInterns = approvedMembers.filter(m => m.type === 'Intern').length;
  const totalPending = pendingMembers.length;

  return (
    <div className="space-y-4 animate-fade-in font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 animate-bounce-in">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl border border-slate-700 text-xs sm:text-sm font-medium">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 animate-spin" />
            <span>{toastMessage}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 1. UNIFIED COMMAND HEADER: STATS + SEARCH + FILTERS */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* Left: Department Directory Title + Inline KPI Pills */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>{deptTitle} &bull; Department Members</span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {filteredMembers.length} Active
              </span>
            </h3>
          </div>

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          {/* Clean Metric Badges Strip */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-medium">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>Total: <strong>{totalApproved}</strong></span>
            </span>

            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Employees: <strong>{totalEmployees}</strong></span>
            </span>

            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Interns: <strong>{totalInterns}</strong></span>
            </span>

            {totalPending > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 font-semibold animate-pulse">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>Pending Approval: <strong>{totalPending}</strong></span>
              </span>
            )}
          </div>
        </div>

        {/* Right: Integrated Search + Filter Pills */}
        <div className="flex items-center gap-2.5 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search member, role, ID..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none text-xs font-medium text-slate-800"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
            {(['All', 'Employee', 'Intern'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setTypeFilter(filter)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  typeFilter === filter
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {filter === 'All' ? 'All' : filter === 'Employee' ? 'Employees' : 'Interns'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. SLEEK, COMPACT PENDING HR APPROVAL CALLOUT (ONLY IF PENDING MEMBERS EXIST) */}
      {pendingMembers.length > 0 && (
        <div className="rounded-2xl border border-amber-300/90 bg-gradient-to-r from-amber-50/90 via-orange-50/40 to-amber-50/90 p-3.5 shadow-xs space-y-2 animate-scale-up">
          <div className="flex items-center justify-between gap-2 border-b border-amber-200/80 pb-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 animate-pulse" />
              <span className="text-xs font-bold text-slate-900">
                Awaiting SuperAdmin / Admin Approval ({pendingMembers.length})
              </span>
              <span className="text-[11px] text-amber-800 hidden sm:inline">
                &bull; Onboarded by HR Operations for {deptTitle}
              </span>
            </div>
            <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-white/90 px-2 py-0.5 rounded-md border border-amber-200 shadow-2xs">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              <span>Admin Authorized</span>
            </div>
          </div>

          {/* Compact Candidate Row Cards */}
          <div className="space-y-1.5">
            {pendingMembers.map((candidate) => (
              <div
                key={candidate.id}
                className="bg-white/95 rounded-xl px-3 py-2 border border-amber-200 hover:border-amber-400 shadow-2xs flex flex-wrap items-center justify-between gap-3 transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white font-bold flex items-center justify-center text-xs shrink-0 shadow-2xs">
                    {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900">{candidate.name}</span>
                    <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                      {candidate.id}
                    </span>
                    <span className="text-xs text-slate-600 font-medium truncate max-w-[200px]">
                      {candidate.role}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      candidate.type === 'Intern'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {candidate.type}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                  <button
                    onClick={() => handleReject(candidate)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <X className="w-3 h-3 text-rose-500" />
                    <span>Decline</span>
                  </button>

                  <button
                    onClick={() => handleApprove(candidate)}
                    className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 shadow-xs transition-all active:scale-95 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Approve &amp; Add</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. STRICT 4-COLUMN TEAM MEMBERS DIRECTORY TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-5">1. Employee Name</th>
                <th className="py-3 px-5">2. Status</th>
                <th className="py-3 px-5">3. Emp ID</th>
                <th className="py-3 px-5">4. Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
              {filteredMembers.length > 0 ? (
                filteredMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* 1. Employee Name */}
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl font-bold flex items-center justify-center text-xs shadow-2xs shrink-0 ${
                          member.type === 'Intern'
                            ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                            : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        }`}>
                          {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 text-sm block">
                            {member.name}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 2. Status (Employee vs Intern) */}
                    <td className="py-3.5 px-5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${
                        member.type === 'Intern'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          member.type === 'Intern' ? 'bg-indigo-500' : 'bg-emerald-500'
                        }`} />
                        {member.type}
                      </span>
                    </td>

                    {/* 3. Emp ID */}
                    <td className="py-3.5 px-5">
                      <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 tracking-wider">
                        {member.id}
                      </span>
                    </td>

                    {/* 4. Role */}
                    <td className="py-3.5 px-5">
                      <span className="text-slate-800 font-semibold text-xs sm:text-sm">
                        {member.role}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    <Users className="w-8 h-8 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                    <p className="font-semibold text-slate-700 text-sm">No team members match your filter.</p>
                    <p className="text-xs text-slate-400 mt-0.5">Try clearing search query or changing filter pills.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
