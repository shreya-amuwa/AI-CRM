import React, { useState } from 'react';
import {
  Search,
  Filter,
  Phone,
  MessageSquare,
  ChevronRight,
  ArrowRight,
  TrendingUp,
  LayoutGrid,
  List,
  MoreVertical,
  SlidersHorizontal
} from 'lucide-react';
import { Lead } from '../../types/crm';
import { MemberPipelineKanban } from './MemberPipelineKanban';

interface MemberPipelineRowsProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onAdvanceStage: (leadId: string, nextStage: Lead['stage']) => void;
  onCallLead: (lead: Lead) => void;
  onMessageLead: (lead: Lead) => void;
}

const STAGES: {
  id: Lead['stage'];
  label: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
  nextStage?: Lead['stage'];
}[] = [
  {
    id: 'New',
    label: 'New',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700 border-blue-200',
    dotColor: 'bg-blue-500',
    nextStage: 'Contacted'
  },
  {
    id: 'Contacted',
    label: 'Contacted',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700 border-amber-200',
    dotColor: 'bg-amber-500',
    nextStage: 'Interested'
  },
  {
    id: 'Interested',
    label: 'Interested',
    badgeBg: 'bg-teal-50',
    badgeText: 'text-teal-700 border-teal-200',
    dotColor: 'bg-teal-500',
    nextStage: 'Proposal'
  },
  {
    id: 'Proposal',
    label: 'Proposal',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-700 border-purple-200',
    dotColor: 'bg-purple-500',
    nextStage: 'Won'
  },
  {
    id: 'Won',
    label: 'Won',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-800 border-emerald-300 font-bold',
    dotColor: 'bg-emerald-600'
  }
];

export const MemberPipelineRows: React.FC<MemberPipelineRowsProps> = ({
  leads,
  onSelectLead,
  onAdvanceStage,
  onCallLead,
  onMessageLead
}) => {
  const [activeStage, setActiveStage] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'rows' | 'board'>('rows');

  const normalizeStage = (stage?: string): string => {
    if (!stage) return 'New';
    if (stage === 'New Lead') return 'New';
    if (stage === 'Demo') return 'Interested';
    if (stage === 'Negotiation') return 'Proposal';
    return stage;
  };

  // Stage Counts
  const stageCounts: Record<string, number> = {
    all: leads.length,
    New: 0,
    Contacted: 0,
    Interested: 0,
    Proposal: 0,
    Won: 0
  };

  leads.forEach(l => {
    const s = normalizeStage(l.stage);
    if (s in stageCounts) {
      stageCounts[s]++;
    }
  });

  // Filter leads
  const filteredLeads = leads.filter(l => {
    const stageMatch = activeStage === 'all' || normalizeStage(l.stage) === activeStage;
    const priorityMatch = priorityFilter === 'all' || l.priority === priorityFilter;
    const searchMatch =
      !searchQuery.trim() ||
      l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (l.company && l.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (l.contact && l.contact.includes(searchQuery));
    return stageMatch && priorityMatch && searchMatch;
  });

  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case 'High':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200">
            High
          </span>
        );
      case 'Medium':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">
            Medium
          </span>
        );
      case 'Low':
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">
            Low
          </span>
        );
    }
  };

  const getStageBadge = (stage?: string) => {
    const s = normalizeStage(stage);
    const stageInfo = STAGES.find(x => x.id === s);
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
          stageInfo?.badgeBg || 'bg-slate-50'
        } ${stageInfo?.badgeText || 'text-slate-700'}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${stageInfo?.dotColor || 'bg-slate-400'}`} />
        <span>{stageInfo?.label || s}</span>
      </span>
    );
  };

  const getNextStage = (stage?: string): Lead['stage'] | undefined => {
    const s = normalizeStage(stage);
    const currIdx = STAGES.findIndex(x => x.id === s);
    if (currIdx >= 0 && currIdx < STAGES.length - 1) {
      return STAGES[currIdx + 1].id;
    }
    return undefined;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
      {/* HEADER: Title, Controls, View Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h2 className="text-lg font-bold font-heading text-slate-900">My Leads Pipeline</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage your assigned leads pipeline in structured row format with quick actions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('rows')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'rows'
                  ? 'bg-white text-blue-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Row View"
            >
              <List className="w-3.5 h-3.5" />
              <span>Rows</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('board')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'board'
                  ? 'bg-white text-blue-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Kanban Board View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Board</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative w-44 sm:w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">All Priority</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      {/* STAGE COUNT TABS */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-100 scrollbar-none">
        <button
          onClick={() => setActiveStage('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            activeStage === 'all'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          All Leads ({stageCounts.all})
        </button>
        {STAGES.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveStage(s.id as string)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeStage === s.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {s.label} ({stageCounts[s.id as string] || 0})
          </button>
        ))}
      </div>

      {/* IF BOARD VIEW SELECTED */}
      {viewMode === 'board' ? (
        <MemberPipelineKanban
          leads={filteredLeads}
          onSelectLead={onSelectLead}
          onAdvanceStage={onAdvanceStage}
          onCallLead={onCallLead}
          onMessageLead={onMessageLead}
        />
      ) : (
        /* ROW MANNER TABLE */
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[11px] font-bold text-slate-400 border-b border-slate-100 uppercase tracking-wider">
                <th className="pb-3 pl-2 font-semibold">Lead / Customer</th>
                <th className="pb-3 px-3 font-semibold">Contact Info</th>
                <th className="pb-3 px-3 font-semibold">Pipeline Stage</th>
                <th className="pb-3 px-3 font-semibold">Priority</th>
                <th className="pb-3 px-3 font-semibold">Deal Value</th>
                <th className="pb-3 px-3 font-semibold">Last Action</th>
                <th className="pb-3 pr-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No leads found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredLeads.map(lead => {
                  const nextStage = getNextStage(lead.stage);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => onSelectLead(lead)}
                      className="hover:bg-blue-50/40 transition-colors group cursor-pointer"
                    >
                      {/* Lead / Customer */}
                      <td className="py-3.5 pl-2 pr-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                            {getInitials(lead.name)}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 leading-tight group-hover:text-blue-600 transition-colors">
                              {lead.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">
                              {lead.company || 'Private Store'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Contact Info */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="text-slate-800 font-mono text-[11px]">{lead.contact}</div>
                        <div className="text-slate-400 text-[10px] truncate max-w-[140px]">{lead.email || '—'}</div>
                      </td>

                      {/* Pipeline Stage */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {getStageBadge(lead.stage)}
                      </td>

                      {/* Priority */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {getPriorityBadge(lead.priority)}
                      </td>

                      {/* Deal Value */}
                      <td className="py-3.5 px-3 whitespace-nowrap font-bold text-slate-800 font-mono">
                        ₹{(lead.dealValue || 35000).toLocaleString('en-IN')}
                      </td>

                      {/* Last Action */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-slate-500 text-[11px] font-mono">
                        {lead.lastActionDate || 'Recent'}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pr-2 pl-3 text-right whitespace-nowrap">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => onCallLead(lead)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Call Lead"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onMessageLead(lead)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title="Send WhatsApp"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>

                          {nextStage && (
                            <button
                              type="button"
                              onClick={() => onAdvanceStage(lead.id, nextStage)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 transition-all shadow-2xs"
                              title={`Advance to ${nextStage}`}
                            >
                              <span>Next</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
