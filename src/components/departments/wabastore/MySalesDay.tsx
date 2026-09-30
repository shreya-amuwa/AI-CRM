import React, { useState, useEffect } from 'react';
import {
  Clock, Phone, MessageCircle, Send, AlertCircle, TrendingUp,
  CheckCircle2, ArrowRight, Zap, Target, DollarSign, Users,
  Bell, Settings, LogOut, MoreVertical, Filter, Plus,
  ChevronRight, Briefcase, Calendar, MapPin
} from 'lucide-react';
import { LeadQuickUpdate } from './LeadQuickUpdate';
import { LeadActivityTimeline } from './LeadActivityTimeline';
import { DailySalesScore } from './DailySalesScore';

interface Lead {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  product: string;
  lastInteraction: string;
  stage: 'new' | 'contacted' | 'qualified' | 'follow-up' | 'demo' | 'proposal' | 'negotiation' | 'won' | 'lost';
  nextAction: string;
  nextFollowUp: string;
  priority: 'high' | 'medium' | 'low';
  assignedTo: string;
  createdAt: string;
  activities: Array<{
    date: string;
    action: string;
    notes: string;
  }>;
}

interface SalesMetrics {
  newLeads: number;
  followUpsDue: number;
  overdueFollowups: number;
  demosToday: number;
  proposalsPending: number;
  paymentsPending: number;
  salesTarget: number;
  salesAchieved: number;
}

export const MySalesDay: React.FC = () => {
  const [salespersonName] = useState('Ananya Verma');
  const [todayDate] = useState(new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }));

  const [metrics, setMetrics] = useState<SalesMetrics>({
    newLeads: 5,
    followUpsDue: 8,
    overdueFollowups: 2,
    demosToday: 3,
    proposalsPending: 4,
    paymentsPending: 2,
    salesTarget: 50000,
    salesAchieved: 35000
  });

  const [leads, setLeads] = useState<Lead[]>([
    {
      id: 'L-001',
      name: 'ABC Fashion',
      company: 'ABC Fashion Retail',
      phone: '+91 98201 11223',
      email: 'info@abcfashion.com',
      product: 'E-commerce Platform',
      lastInteraction: '15 Sept - Customer interested',
      stage: 'qualified',
      nextAction: 'Follow-up Required',
      nextFollowUp: '16 Sept, 3:00 PM',
      priority: 'high',
      assignedTo: salespersonName,
      createdAt: '2026-09-15',
      activities: [
        { date: '15 Sept', action: 'Lead received', notes: 'Website inquiry' },
        { date: '15 Sept', action: 'Called customer', notes: 'Connected successfully' },
        { date: '15 Sept', action: 'Customer interested', notes: 'Wants E-commerce Platform' }
      ]
    },
    {
      id: 'L-002',
      name: 'XYZ Boutique',
      company: 'XYZ Boutique',
      phone: '+91 97110 99887',
      email: 'contact@xyzboutique.com',
      product: 'Catalog Management',
      lastInteraction: '14 Sept - Follow-up completed',
      stage: 'follow-up',
      nextAction: 'Demo Required',
      nextFollowUp: '17 Sept, 2:30 PM',
      priority: 'high',
      assignedTo: salespersonName,
      createdAt: '2026-09-14',
      activities: [
        { date: '14 Sept', action: 'Follow-up completed', notes: 'Customer ready for demo' }
      ]
    },
    {
      id: 'L-003',
      name: 'RetailMart',
      company: 'RetailMart India',
      phone: '+91 98765 43210',
      email: 'manager@retailmart.com',
      product: 'Payment Integration',
      lastInteraction: '12 Sept - No follow-up scheduled',
      stage: 'contacted',
      nextAction: 'Follow-up Required',
      nextFollowUp: 'No date set',
      priority: 'medium',
      assignedTo: salespersonName,
      createdAt: '2026-09-12',
      activities: [
        { date: '12 Sept', action: 'Called customer', notes: 'Customer busy, promised to call back' }
      ]
    },
    {
      id: 'L-004',
      name: 'Brand Express',
      company: 'Brand Express Ltd',
      phone: '+91 99900 88776',
      email: 'sales@brandexpress.com',
      product: 'White Label Solution',
      lastInteraction: '13 Sept - Demo completed',
      stage: 'proposal',
      nextAction: 'Proposal Follow-up',
      nextFollowUp: '18 Sept, 10:00 AM',
      priority: 'high',
      assignedTo: salespersonName,
      createdAt: '2026-09-10',
      activities: [
        { date: '13 Sept', action: 'Demo completed', notes: 'Customer satisfied with features' },
        { date: '14 Sept', action: 'Proposal sent', notes: 'Email sent with pricing' }
      ]
    },
    {
      id: 'L-005',
      name: 'Megha Roy',
      company: 'Independent Seller',
      phone: '+91 98765 12345',
      email: 'megha@independent.com',
      product: 'Starter Package',
      lastInteraction: '15 Sept - Inquiry received',
      stage: 'new',
      nextAction: 'Contact Lead',
      nextFollowUp: '15 Sept (Overdue)',
      priority: 'high',
      assignedTo: salespersonName,
      createdAt: '2026-09-15',
      activities: [
        { date: '15 Sept', action: 'Lead received', notes: 'WhatsApp API inquiry' }
      ]
    }
  ]);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showUpdatePanel, setShowUpdatePanel] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [filterStage, setFilterStage] = useState<'all' | Lead['stage']>('all');

  const getStageIcon = (stage: Lead['stage']) => {
    const stageIcons: Record<Lead['stage'], JSX.Element> = {
      'new': <AlertCircle className="w-4 h-4 text-blue-500" />,
      'contacted': <Phone className="w-4 h-4 text-amber-500" />,
      'qualified': <CheckCircle2 className="w-4 h-4 text-green-500" />,
      'follow-up': <Clock className="w-4 h-4 text-purple-500" />,
      'demo': <Target className="w-4 h-4 text-indigo-500" />,
      'proposal': <Send className="w-4 h-4 text-cyan-500" />,
      'negotiation': <TrendingUp className="w-4 h-4 text-orange-500" />,
      'won': <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
      'lost': <AlertCircle className="w-4 h-4 text-red-500" />
    };
    return stageIcons[stage];
  };

  const getStageLabel = (stage: Lead['stage']) => {
    return stage.charAt(0).toUpperCase() + stage.slice(1).replace('-', ' ');
  };

  const getPriorityColor = (priority: 'high' | 'medium' | 'low') => {
    return {
      high: 'bg-red-50 text-red-700 border border-red-200',
      medium: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
      low: 'bg-green-50 text-green-700 border border-green-200'
    }[priority];
  };

  const categorizeLeads = () => {
    const overdue = leads.filter(l => l.priority === 'high' && l.stage === 'new');
    const dueToday = leads.filter(l => (l.stage === 'contacted' || l.stage === 'follow-up') && l.priority === 'high');
    const newLeads = leads.filter(l => l.stage === 'new').slice(1);
    const demos = leads.filter(l => l.stage === 'demo');
    const payments = leads.filter(l => l.stage === 'negotiation' || l.stage === 'proposal');

    return { overdue, dueToday, newLeads, demos, payments };
  };

  const { overdue, dueToday, newLeads, demos, payments } = categorizeLeads();

  const filteredLeads = leads.filter(lead => {
    const priorityMatch = filterPriority === 'all' || lead.priority === filterPriority;
    const stageMatch = filterStage === 'all' || lead.stage === filterStage;
    return priorityMatch && stageMatch;
  });

  const handleLeadUpdate = (leadId: string, updates: Partial<Lead>) => {
    setLeads(leads.map(lead =>
      lead.id === leadId ? { ...lead, ...updates } : lead
    ));
    setShowUpdatePanel(false);
    setSelectedLead(null);
  };

  const progressPercentage = (metrics.salesAchieved / metrics.salesTarget) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-slate-100/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-mono text-slate-500">{todayDate}</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
                Good Morning, {salespersonName} 👋
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors">
                <Bell className="w-5 h-5 text-slate-600" />
              </button>
              <button className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors">
                <Settings className="w-5 h-5 text-slate-600" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Cards - Improved Grid Layout */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard icon={AlertCircle} label="NEW LEADS" value={metrics.newLeads} color="text-blue-600" borderColor="border-blue-200" />
          <MetricCard icon={Clock} label="DUE TODAY" value={metrics.followUpsDue} color="text-amber-600" borderColor="border-amber-200" />
          <MetricCard icon={AlertCircle} label="OVERDUE" value={metrics.overdueFollowups} color="text-red-600" borderColor="border-red-200" />
          <MetricCard icon={Target} label="DEMOS" value={metrics.demosToday} color="text-indigo-600" borderColor="border-indigo-200" />
          <MetricCard icon={Send} label="PROPOSALS" value={metrics.proposalsPending} color="text-cyan-600" borderColor="border-cyan-200" />
          <MetricCard icon={DollarSign} label="PAYMENTS" value={metrics.paymentsPending} color="text-orange-600" borderColor="border-orange-200" />
          <MetricCard icon={TrendingUp} label="TODAY SALES" value={`₹${Math.floor(metrics.salesAchieved / 1000)}K`} color="text-emerald-600" borderColor="border-emerald-200" />
          <MetricCard icon={Target} label="TARGET" value={`₹${Math.floor(metrics.salesTarget / 1000)}K`} color="text-slate-600" borderColor="border-slate-200" />
        </div>

        {/* Daily Sales Score */}
        <div className="mb-8">
          <DailySalesScore
            achieved={metrics.salesAchieved}
            target={metrics.salesTarget}
            activities={{
              calls: 18,
              followups: 9,
              demos: 2,
              proposals: 3,
              won: 1
            }}
          />
        </div>

        {/* TODAY'S WORK Section */}
        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-slate-50 px-6 sm:px-8 py-4 flex items-center justify-between">
            <h2 className="text-xl font-bold font-heading text-slate-900">TODAY'S WORK</h2>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors text-slate-700 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                Filter
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {/* Overdue Section */}
            {overdue.length > 0 && (
              <div className="p-6 sm:p-8 bg-red-50/40 border-l-4 border-l-red-500">
                <SectionHeader icon={AlertCircle} label="OVERDUE" count={overdue.length} color="text-red-600" bgColor="bg-red-50" />
                <div style={{ marginTop: '1rem' }}></div>
                <div className="space-y-3">
                  {overdue.map(lead => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onUpdate={() => { setSelectedLead(lead); setShowUpdatePanel(true); }}
                      onViewTimeline={() => { setSelectedLead(lead); setShowTimeline(true); }}
                      stageIcon={getStageIcon(lead.stage)}
                      stageLabel={getStageLabel(lead.stage)}
                      priorityColor={getPriorityColor(lead.priority)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Due Today Section */}
            {dueToday.length > 0 && (
              <div className="p-6 sm:p-8 bg-yellow-50/40 border-l-4 border-l-yellow-500">
                <SectionHeader icon={Clock} label="DUE TODAY" count={dueToday.length} color="text-amber-600" bgColor="bg-yellow-50" />
                <div style={{ marginTop: '1rem' }}></div>
                <div className="space-y-3">
                  {dueToday.map(lead => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onUpdate={() => { setSelectedLead(lead); setShowUpdatePanel(true); }}
                      onViewTimeline={() => { setSelectedLead(lead); setShowTimeline(true); }}
                      stageIcon={getStageIcon(lead.stage)}
                      stageLabel={getStageLabel(lead.stage)}
                      priorityColor={getPriorityColor(lead.priority)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* New Leads Section */}
            {newLeads.length > 0 && (
              <div className="p-6 sm:p-8 bg-blue-50/40 border-l-4 border-l-blue-500">
                <SectionHeader icon={AlertCircle} label="NEW LEADS" count={newLeads.length} color="text-blue-600" bgColor="bg-blue-50" />
                <div style={{ marginTop: '1rem' }}></div>
                <div className="space-y-3">
                  {newLeads.map(lead => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onUpdate={() => { setSelectedLead(lead); setShowUpdatePanel(true); }}
                      onViewTimeline={() => { setSelectedLead(lead); setShowTimeline(true); }}
                      stageIcon={getStageIcon(lead.stage)}
                      stageLabel={getStageLabel(lead.stage)}
                      priorityColor={getPriorityColor(lead.priority)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Demos Section */}
            {demos.length > 0 && (
              <div className="p-6 sm:p-8 bg-green-50/40 border-l-4 border-l-green-500">
                <SectionHeader icon={Target} label="DEMOS" count={demos.length} color="text-green-600" bgColor="bg-green-50" />
                <div style={{ marginTop: '1rem' }}></div>
                <div className="space-y-3">
                  {demos.map(lead => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onUpdate={() => { setSelectedLead(lead); setShowUpdatePanel(true); }}
                      onViewTimeline={() => { setSelectedLead(lead); setShowTimeline(true); }}
                      stageIcon={getStageIcon(lead.stage)}
                      stageLabel={getStageLabel(lead.stage)}
                      priorityColor={getPriorityColor(lead.priority)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Payment Follow-ups Section */}
            {payments.length > 0 && (
              <div className="p-6 sm:p-8 bg-orange-50/40 border-l-4 border-l-orange-500">
                <SectionHeader icon={DollarSign} label="PAYMENT FOLLOW-UPS" count={payments.length} color="text-orange-600" bgColor="bg-orange-50" />
                <div style={{ marginTop: '1rem' }}></div>
                <div className="space-y-3">
                  {payments.map(lead => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onUpdate={() => { setSelectedLead(lead); setShowUpdatePanel(true); }}
                      onViewTimeline={() => { setSelectedLead(lead); setShowTimeline(true); }}
                      stageIcon={getStageIcon(lead.stage)}
                      stageLabel={getStageLabel(lead.stage)}
                      priorityColor={getPriorityColor(lead.priority)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Update Panel */}
      {showUpdatePanel && selectedLead && (
        <LeadQuickUpdate
          lead={selectedLead}
          onClose={() => setShowUpdatePanel(false)}
          onUpdate={handleLeadUpdate}
        />
      )}

      {/* Timeline Panel */}
      {showTimeline && selectedLead && (
        <LeadActivityTimeline
          lead={selectedLead}
          onClose={() => setShowTimeline(false)}
        />
      )}
    </div>
  );
};

// Section Header Component - Professional badges
interface SectionHeaderProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  color: string;
  bgColor: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ icon: Icon, label, count, color, bgColor }) => {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`p-2.5 rounded-lg ${bgColor}`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <span className={`text-xs font-bold uppercase tracking-widest ${color}`}>{label}</span>
        <p className="text-sm text-slate-600 mt-0.5">{count} item{count !== 1 ? 's' : ''}</p>
      </div>
    </div>
  );
};

// Metric Card Component - Improved styling
interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  color: string;
  borderColor: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon: Icon, label, value, color, borderColor }) => {
  return (
    <div className={`bg-white rounded-2xl p-5 border-2 ${borderColor} hover:shadow-lg hover:scale-105 transition-all duration-200 cursor-pointer`}>
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`p-2 rounded-lg bg-${color.split('-')[1]}-50`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-slate-900 leading-tight">{value}</p>
    </div>
  );
};

// Lead Card Component
interface LeadCardProps {
  lead: Lead;
  onUpdate: () => void;
  onViewTimeline: () => void;
  stageIcon: JSX.Element;
  stageLabel: string;
  priorityColor: string;
}

const LeadCard: React.FC<LeadCardProps> = ({
  lead,
  onUpdate,
  onViewTimeline,
  stageIcon,
  stageLabel,
  priorityColor
}) => {
  return (
    <div className="bg-white rounded-2xl border-2 border-slate-100 hover:border-slate-300 hover:shadow-lg transition-all p-5 group">
      {/* Top Row: Name, Company, Priority */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <h4 className="font-bold text-slate-900 text-base">{lead.name}</h4>
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${priorityColor}`}>
              {lead.priority.toUpperCase()}
            </span>
          </div>
          <p className="text-sm text-slate-600">{lead.company}</p>
        </div>
        <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
          <MoreVertical className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Middle Row: Key Info */}
      <div className="grid grid-cols-3 gap-4 mb-4 py-3 border-y border-slate-100">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Contact</span>
          <p className="text-sm text-slate-900 font-mono truncate">{lead.phone}</p>
        </div>
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Product</span>
          <p className="text-sm text-slate-900 truncate">{lead.product}</p>
        </div>
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Last Interaction</span>
          <p className="text-sm text-slate-900 truncate">{lead.lastInteraction}</p>
        </div>
      </div>

      {/* Bottom Row: Stage and Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-slate-50 to-slate-50 rounded-lg border border-slate-150">
          <div className="text-slate-600">{stageIcon}</div>
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{stageLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {}}
            className="p-2 hover:bg-emerald-50 rounded-lg transition-colors"
            title="Call"
          >
            <Phone className="w-4 h-4 text-emerald-600" />
          </button>
          <button
            onClick={() => {}}
            className="p-2 hover:bg-green-50 rounded-lg transition-colors"
            title="WhatsApp"
          >
            <MessageCircle className="w-4 h-4 text-green-600" />
          </button>
          <button
            onClick={onUpdate}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md"
          >
            <Zap className="w-3.5 h-3.5" />
            Update
          </button>
        </div>
      </div>
    </div>
  );
};
