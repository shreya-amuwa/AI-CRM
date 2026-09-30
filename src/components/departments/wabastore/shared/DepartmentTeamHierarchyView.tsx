import React, { useState } from 'react';
import {
  Users, UserCheck, Award, Shield, Phone, Mail, Sparkles,
  Search, Filter, ChevronRight, CheckCircle2, Clock, AlertCircle,
  TrendingUp, Headphones, Target, Check, ExternalLink, Activity
} from 'lucide-react';

interface TeamMemberRep {
  id: string;
  name: string;
  role: string;
  type: 'Employee' | 'Intern';
  email: string;
  phone: string;
  avatar: string;
  status: 'Available' | 'On Call' | 'In Chat' | 'Offline';
  workloadMetricLabel: string;
  workloadMetricValue: string | number;
  efficiencyRate: string;
  quotaOrSla: string;
}

interface TeamPod {
  id: string;
  name: string;
  badge: string;
  description: string;
  lead: {
    id: string;
    name: string;
    title: string;
    email: string;
    phone: string;
    avatar: string;
    status: 'Available' | 'On Call' | 'In Chat';
    experience: string;
    teamTarget: string;
    achievementRate: string;
    directReportsCount: number;
  };
  members: TeamMemberRep[];
}

interface DepartmentTeamHierarchyViewProps {
  department: 'sales' | 'support';
}

const SALES_PODS: TeamPod[] = [
  {
    id: 'sales-pod-alpha',
    name: 'Enterprise & Key Accounts Squad',
    badge: 'Pod Alpha &bull; Enterprise',
    description: 'High-ticket deals, strategic commercial negotiations, and multi-location retail accounts',
    lead: {
      id: 'TL-SALES-01',
      name: 'Vikram Deshmukh',
      title: 'Senior Enterprise Sales Team Lead',
      email: 'vikram.d@wabastore.com',
      phone: '+91 98210 11001',
      avatar: 'VD',
      status: 'Available',
      experience: '7+ Years',
      teamTarget: '₹35,00,000 / mo',
      achievementRate: '92.4%',
      directReportsCount: 4
    },
    members: [
      {
        id: 'EMP-1042',
        name: 'Priya Nair',
        role: 'Senior Enterprise Account Executive',
        type: 'Employee',
        email: 'priya.n@wabastore.com',
        phone: '+91 98450 11223',
        avatar: 'PN',
        status: 'Available',
        workloadMetricLabel: 'Active Deals',
        workloadMetricValue: 18,
        efficiencyRate: '31.2% Conv.',
        quotaOrSla: '94% Quota'
      },
      {
        id: 'EMP-1058',
        name: 'Rahul Kumar',
        role: 'Mid-Market Sales Specialist',
        type: 'Employee',
        email: 'rahul.k@wabastore.com',
        phone: '+91 97112 33445',
        avatar: 'RK',
        status: 'On Call',
        workloadMetricLabel: 'Active Deals',
        workloadMetricValue: 14,
        efficiencyRate: '28.5% Conv.',
        quotaOrSla: '86% Quota'
      },
      {
        id: 'EMP-1073',
        name: 'Amit Patel',
        role: 'Commercial Business Developer',
        type: 'Employee',
        email: 'amit.p@wabastore.com',
        phone: '+91 99001 55667',
        avatar: 'AP',
        status: 'In Chat',
        workloadMetricLabel: 'Active Deals',
        workloadMetricValue: 16,
        efficiencyRate: '29.8% Conv.',
        quotaOrSla: '89% Quota'
      },
      {
        id: 'INT-2015',
        name: 'Sneha Verma',
        role: 'Enterprise Sales Intern',
        type: 'Intern',
        email: 'sneha.v@wabastore.com',
        phone: '+91 98765 99881',
        avatar: 'SV',
        status: 'Available',
        workloadMetricLabel: 'Assigned Leads',
        workloadMetricValue: 24,
        efficiencyRate: '22.4% Conv.',
        quotaOrSla: '78% Quota'
      }
    ]
  },
  {
    id: 'sales-pod-beta',
    name: 'Inbound Velocity & Mid-Market Squad',
    badge: 'Pod Beta &bull; Velocity',
    description: 'Rapid inbound conversion, demo scheduling, WhatsApp commerce onboarding, and outbound expansion',
    lead: {
      id: 'TL-SALES-02',
      name: 'Meera Nambiar',
      title: 'Inbound Sales Team Lead & Velocity Manager',
      email: 'meera.n@wabastore.com',
      phone: '+91 98450 22002',
      avatar: 'MN',
      status: 'On Call',
      experience: '5+ Years',
      teamTarget: '₹22,00,000 / mo',
      achievementRate: '95.1%',
      directReportsCount: 3
    },
    members: [
      {
        id: 'EMP-1088',
        name: 'Rohan Gupta',
        role: 'Inside Sales Specialist',
        type: 'Employee',
        email: 'rohan.g@wabastore.com',
        phone: '+91 98223 34455',
        avatar: 'RG',
        status: 'Available',
        workloadMetricLabel: 'Calls Today',
        workloadMetricValue: 34,
        efficiencyRate: '26.4% Conv.',
        quotaOrSla: '92% Quota'
      },
      {
        id: 'EMP-1094',
        name: 'Pooja Hegde',
        role: 'SDR & Outreach Specialist',
        type: 'Employee',
        email: 'pooja.h@wabastore.com',
        phone: '+91 98334 55667',
        avatar: 'PH',
        status: 'Available',
        workloadMetricLabel: 'Calls Today',
        workloadMetricValue: 38,
        efficiencyRate: '27.9% Conv.',
        quotaOrSla: '96% Quota'
      },
      {
        id: 'INT-2022',
        name: 'Aryan Sharma',
        role: 'Outbound Prospecting Intern',
        type: 'Intern',
        email: 'aryan.s@wabastore.com',
        phone: '+91 96543 21876',
        avatar: 'AS',
        status: 'Available',
        workloadMetricLabel: 'Touches Today',
        workloadMetricValue: 42,
        efficiencyRate: '21.0% Conv.',
        quotaOrSla: '84% Quota'
      }
    ]
  }
];

const SUPPORT_PODS: TeamPod[] = [
  {
    id: 'support-pod-1',
    name: 'Tier-1 Inbound & Customer Operations Squad',
    badge: 'Pod 1 &bull; Frontline CX',
    description: 'High-speed WhatsApp desk triage, customer inquiries, order tracking, and first-contact resolution',
    lead: {
      id: 'TL-SUP-01',
      name: 'Aakash Singhal',
      title: 'Tier-1 Operations Team Lead',
      email: 'aakash.s@wabastore.com',
      phone: '+91 98330 33001',
      avatar: 'AS',
      status: 'Available',
      experience: '6+ Years',
      teamTarget: '< 15m Response Time',
      achievementRate: '96.8%',
      directReportsCount: 4
    },
    members: [
      {
        id: 'EMP-2034',
        name: 'Rohan Mehta',
        role: 'Senior Support Specialist',
        type: 'Employee',
        email: 'rohan.m@wabastore.com',
        phone: '+91 98200 54321',
        avatar: 'RM',
        status: 'Available',
        workloadMetricLabel: 'Tickets Handled',
        workloadMetricValue: 48,
        efficiencyRate: '96.2% FCR',
        quotaOrSla: '11m Avg SLA'
      },
      {
        id: 'EMP-2088',
        name: 'Farhan Akhtar',
        role: 'L1 Support Executive',
        type: 'Employee',
        email: 'farhan.a@wabastore.com',
        phone: '+91 96543 11223',
        avatar: 'FA',
        status: 'In Chat',
        workloadMetricLabel: 'Tickets Handled',
        workloadMetricValue: 41,
        efficiencyRate: '94.5% FCR',
        quotaOrSla: '13m Avg SLA'
      },
      {
        id: 'INT-3012',
        name: 'Ananya Roy',
        role: 'Customer Success Intern',
        type: 'Intern',
        email: 'ananya.r@wabastore.com',
        phone: '+91 98111 22334',
        avatar: 'AR',
        status: 'Available',
        workloadMetricLabel: 'Tickets Handled',
        workloadMetricValue: 32,
        efficiencyRate: '92.1% FCR',
        quotaOrSla: '15m Avg SLA'
      },
      {
        id: 'INT-3019',
        name: 'Tanmay Joshi',
        role: 'Helpdesk & Triage Intern',
        type: 'Intern',
        email: 'tanmay.j@wabastore.com',
        phone: '+91 98777 66554',
        avatar: 'TJ',
        status: 'On Call',
        workloadMetricLabel: 'Tickets Handled',
        workloadMetricValue: 35,
        efficiencyRate: '91.8% FCR',
        quotaOrSla: '14m Avg SLA'
      }
    ]
  },
  {
    id: 'support-pod-2',
    name: 'Tier-2 Technical Escalations & Resolution Squad',
    badge: 'Pod 2 &bull; Technical SLA',
    description: 'Webhook payload debugging, Meta catalog sync bugs, payment gateway mismatches, and VIP escalations',
    lead: {
      id: 'TL-SUP-02',
      name: 'Neha Kulkarni',
      title: 'Technical Escalations Team Lead',
      email: 'neha.k@wabastore.com',
      phone: '+91 98777 44002',
      avatar: 'NK',
      status: 'In Chat',
      experience: '8+ Years',
      teamTarget: '< 4h Resolution Time',
      achievementRate: '94.2%',
      directReportsCount: 3
    },
    members: [
      {
        id: 'EMP-2045',
        name: 'Neha Gupta',
        role: 'Escalations & Resolution Lead',
        type: 'Employee',
        email: 'neha.g@wabastore.com',
        phone: '+91 97654 32109',
        avatar: 'NG',
        status: 'Available',
        workloadMetricLabel: 'Resolved Bugs',
        workloadMetricValue: 26,
        efficiencyRate: '95.4% CSAT',
        quotaOrSla: '3.2h MTTR'
      },
      {
        id: 'EMP-2062',
        name: 'Kavita Roy',
        role: 'Senior Technical Specialist',
        type: 'Employee',
        email: 'kavita.r@wabastore.com',
        phone: '+91 98112 77889',
        avatar: 'KR',
        status: 'Available',
        workloadMetricLabel: 'Resolved Bugs',
        workloadMetricValue: 31,
        efficiencyRate: '96.1% CSAT',
        quotaOrSla: '2.8h MTTR'
      },
      {
        id: 'EMP-2079',
        name: 'Siddharth Jain',
        role: 'Critical Patch Specialist',
        type: 'Employee',
        email: 'siddharth.j@wabastore.com',
        phone: '+91 98990 12345',
        avatar: 'SJ',
        status: 'Offline',
        workloadMetricLabel: 'Resolved Bugs',
        workloadMetricValue: 22,
        efficiencyRate: '93.8% CSAT',
        quotaOrSla: '3.6h MTTR'
      }
    ]
  }
];

export const DepartmentTeamHierarchyView: React.FC<DepartmentTeamHierarchyViewProps> = ({ department }) => {
  const [selectedPodId, setSelectedPodId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNotification, setActiveNotification] = useState<string | null>(null);

  const pods = department === 'sales' ? SALES_PODS : SUPPORT_PODS;
  const isSales = department === 'sales';
  const deptTitle = isSales ? 'WabaStore Sales' : 'WabaStore Support';

  const triggerNotice = (msg: string) => {
    setActiveNotification(msg);
    setTimeout(() => setActiveNotification(null), 3500);
  };

  // Filter pods
  const displayedPods = pods.filter(p => selectedPodId === 'all' || p.id === selectedPodId);

  // Total counts
  const totalLeads = pods.length;
  const totalReps = pods.reduce((acc, p) => acc + p.members.length, 0);

  return (
    <div className="space-y-5 animate-fade-in font-sans">
      {/* Toast */}
      {activeNotification && (
        <div className="fixed top-5 right-5 z-50 animate-bounce-in">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900 text-white shadow-2xl border border-slate-700 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>{activeNotification}</span>
          </div>
        </div>
      )}

      {/* 1. TOP COMMAND BAR: TEAM SUMMARY & CONTROLS */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>{deptTitle} &bull; Team Hierarchy &amp; Pods</span>
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {pods.length} Active Teams
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Operational team squads grouped with <strong>Team Leads at the top</strong>, direct report rosters, and live workload telemetry.
          </p>
        </div>

        {/* Pod Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
            <button
              onClick={() => setSelectedPodId('all')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                selectedPodId === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Teams ({pods.length})
            </button>
            {pods.map(pod => (
              <button
                key={pod.id}
                onClick={() => setSelectedPodId(pod.id)}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  selectedPodId === pod.id
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {pod.lead.name.split(' ')[0]}'s Pod ({pod.members.length + 1})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. TEAMS DISPLAY WITH TEAM LEADS ON TOP */}
      <div className="space-y-6">
        {displayedPods.map((pod) => {
          // Filter members by search query if any
          const filteredMembers = pod.members.filter(m =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.role.toLowerCase().includes(searchQuery.toLowerCase())
          );

          return (
            <div
              key={pod.id}
              className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden transition-all"
            >
              {/* Team Group Header */}
              <div className="px-6 py-4 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                    {pod.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>{pod.name}</span>
                      <span className="text-[11px] font-semibold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                        {pod.members.length + 1} Squad Members
                      </span>
                    </h4>
                    <p className="text-xs text-slate-500">{pod.description}</p>
                  </div>
                </div>

                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {pod.badge}
                </span>
              </div>

              <div className="p-6 space-y-6">
                {/* PROMINENT TEAM LEAD CARD (ON TOP OF THE TEAM) */}
                <div className="relative overflow-hidden rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-indigo-50/40 p-4 sm:p-5 shadow-xs">
                  <div className="absolute top-0 right-0 px-3.5 py-1 rounded-bl-xl bg-indigo-600 text-white text-[11px] font-bold tracking-wide flex items-center gap-1.5 shadow-xs">
                    <span>👑 TEAM LEAD</span>
                  </div>

                  <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5">
                      <div className="relative">
                        <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-indigo-600 to-slate-900 text-white font-extrabold text-base flex items-center justify-center shadow-md">
                          {pod.lead.avatar}
                        </div>
                        <span className={`w-3.5 h-3.5 rounded-full border-2 border-white absolute -bottom-0.5 -right-0.5 ${
                          pod.lead.status === 'Available' ? 'bg-emerald-500' : 'bg-blue-500'
                        }`} />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-base font-extrabold text-slate-900">{pod.lead.name}</h5>
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-white border border-indigo-200 text-indigo-800">
                            {pod.lead.id}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-600 mt-0.5">{pod.lead.title}</p>
                        
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            <span>{pod.lead.email}</span>
                          </span>
                          <span>&bull;</span>
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <span>{pod.lead.phone}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Team Lead Key Governance Metrics */}
                    <div className="flex items-center gap-2.5 self-stretch sm:self-auto justify-between sm:justify-start">
                      <div className="bg-white/90 border border-indigo-100 rounded-xl px-3.5 py-2 text-center shadow-2xs">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Direct Reports</span>
                        <span className="text-sm font-extrabold text-slate-900">{pod.lead.directReportsCount} Members</span>
                      </div>

                      <div className="bg-white/90 border border-indigo-100 rounded-xl px-3.5 py-2 text-center shadow-2xs">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Target / SLA</span>
                        <span className="text-sm font-extrabold text-indigo-700">{pod.lead.achievementRate}</span>
                      </div>

                      <button
                        onClick={() => triggerNotice(`Contact request dispatched to Team Lead ${pod.lead.name}`)}
                        className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95"
                      >
                        Nudge Lead
                      </button>
                    </div>
                  </div>
                </div>

                {/* TEAM MEMBERS SECTION (LISTED DIRECTLY BENEATH THEIR TEAM LEAD) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-600 border-b border-slate-100 pb-2">
                    <span className="uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span>Assigned Team Members ({filteredMembers.length})</span>
                    </span>
                    <span className="text-slate-400 font-normal">Supervised by {pod.lead.name}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    {filteredMembers.map((member) => (
                      <div
                        key={member.id}
                        className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-md p-4 transition-all flex flex-col justify-between space-y-3 group"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="relative">
                              <div className={`w-10 h-10 rounded-xl font-bold flex items-center justify-center text-xs shadow-2xs ${
                                member.type === 'Intern'
                                  ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                  : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                              }`}>
                                {member.avatar}
                              </div>
                              <span className={`w-2.5 h-2.5 rounded-full border-2 border-white absolute -bottom-0.5 -right-0.5 ${
                                member.status === 'Available'
                                  ? 'bg-emerald-500'
                                  : member.status === 'On Call'
                                  ? 'bg-blue-500'
                                  : member.status === 'In Chat'
                                  ? 'bg-purple-500'
                                  : 'bg-slate-400'
                              }`} />
                            </div>

                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              member.type === 'Intern'
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}>
                              {member.type}
                            </span>
                          </div>

                          <div>
                            <h6 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors">
                              {member.name}
                            </h6>
                            <span className="font-mono text-[11px] text-slate-400 block font-semibold">
                              {member.id}
                            </span>
                            <p className="text-xs text-slate-600 mt-1 line-clamp-1 font-medium">
                              {member.role}
                            </p>
                          </div>
                        </div>

                        {/* Member Telemetry */}
                        <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between text-slate-500">
                            <span>{member.workloadMetricLabel}:</span>
                            <span className="font-bold text-slate-800">{member.workloadMetricValue}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-500">
                            <span>Performance:</span>
                            <span className="font-semibold text-emerald-700">{member.quotaOrSla}</span>
                          </div>
                          <div className="flex items-center justify-between pt-1 text-[11px]">
                            <span className={`inline-flex items-center gap-1 font-semibold ${
                              member.status === 'Available'
                                ? 'text-emerald-600'
                                : member.status === 'On Call'
                                ? 'text-blue-600'
                                : member.status === 'In Chat'
                                ? 'text-purple-600'
                                : 'text-slate-400'
                            }`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-current" />
                              {member.status}
                            </span>
                            <button
                              onClick={() => triggerNotice(`Task assigned to ${member.name}`)}
                              className="text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                            >
                              Assign &rarr;
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
