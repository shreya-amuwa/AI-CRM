import React, { useState } from 'react';
import { Search, Filter, ChevronRight, MoreVertical, Phone, MessageSquare, ArrowRight } from 'lucide-react';
import { Lead } from '../../types/crm';

interface MemberPipelineKanbanProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onAdvanceStage: (leadId: string, nextStage: Lead['stage']) => void;
  onCallLead: (lead: Lead) => void;
  onMessageLead: (lead: Lead) => void;
}

const STAGES: {
  id: Lead['stage'];
  label: string;
  countKey: string;
  badgeBg: string;
  badgeText: string;
  accentBorder: string;
  dotColor: string;
  nextStage?: Lead['stage'];
}[] = [
  {
    id: 'New',
    label: 'New',
    countKey: 'new',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    accentBorder: 'border-t-blue-500',
    dotColor: 'bg-blue-500',
    nextStage: 'Contacted'
  },
  {
    id: 'Contacted',
    label: 'Contacted',
    countKey: 'contacted',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
    accentBorder: 'border-t-amber-500',
    dotColor: 'bg-amber-500',
    nextStage: 'Interested'
  },
  {
    id: 'Interested',
    label: 'Interested',
    countKey: 'interested',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-700',
    accentBorder: 'border-t-emerald-500',
    dotColor: 'bg-emerald-500',
    nextStage: 'Proposal'
  },
  {
    id: 'Proposal',
    label: 'Proposal',
    countKey: 'proposal',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-700',
    accentBorder: 'border-t-purple-500',
    dotColor: 'bg-purple-500',
    nextStage: 'Won'
  },
  {
    id: 'Won',
    label: 'Won',
    countKey: 'won',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    accentBorder: 'border-t-emerald-600',
    dotColor: 'bg-emerald-600'
  }
];

export const MemberPipelineKanban: React.FC<MemberPipelineKanbanProps> = ({
  leads,
  onSelectLead,
  onAdvanceStage,
  onCallLead,
  onMessageLead
}) => {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});

  // Normalize stage matching
  const normalizeStage = (stage?: string): string => {
    if (!stage) return 'New';
    if (stage === 'New Lead') return 'New';
    if (stage === 'Demo') return 'Interested';
    if (stage === 'Negotiation') return 'Proposal';
    return stage;
  };

  // Filter leads by query
  const filteredLeads = leads.filter(l => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      l.name.toLowerCase().includes(q) ||
      (l.company && l.company.toLowerCase().includes(q))
    );
  });

  // Calculate counts
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
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-100">High</span>;
      case 'Medium':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-100">Medium</span>;
      case 'Low':
      default:
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">Low</span>;
    }
  };

  const toggleExpand = (stageId: string) => {
    setExpandedColumns(prev => ({ ...prev, [stageId]: !prev[stageId] }));
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
      
      {/* HEADER: Title, Search, Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-base font-bold font-heading text-slate-900">My Leads Pipeline</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-48 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Filter pipeline"
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* STAGE COUNT TABS */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 border-b border-slate-100 scrollbar-none">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          All Leads ({stageCounts.all})
        </button>
        {STAGES.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveTab(s.id as string)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === s.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {s.label} ({stageCounts[s.id as string] || 0})
          </button>
        ))}
      </div>

      {/* 5 KANBAN COLUMNS */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3.5 pt-4">
        {STAGES.map(stage => {
          // If a single tab is active and not 'all', hide other columns on smaller screens
          if (activeTab !== 'all' && activeTab !== stage.id) {
            return null;
          }

          const columnLeads = filteredLeads.filter(l => normalizeStage(l.stage) === stage.id);
          const isExpanded = !!expandedColumns[stage.id as string];
          const displayedLeads = isExpanded ? columnLeads : columnLeads.slice(0, 3);
          const hiddenCount = Math.max(0, columnLeads.length - 3);

          return (
            <div
              key={stage.id}
              className={`bg-slate-50/70 rounded-xl border border-slate-200/70 p-2.5 flex flex-col justify-between ${stage.accentBorder} border-t-2`}
            >
              <div>
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-200/60 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">{stage.label}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${stage.badgeBg} ${stage.badgeText}`}>
                    {columnLeads.length}
                  </span>
                </div>

                {/* Cards List */}
                <div className="space-y-2.5">
                  {displayedLeads.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-[11px]">
                      No leads in {stage.label}
                    </div>
                  ) : (
                    displayedLeads.map(lead => (
                      <div
                        key={lead.id}
                        onClick={() => onSelectLead(lead)}
                        className="bg-white rounded-xl p-3 border border-slate-200/70 hover:border-blue-400 hover:shadow-xs transition-all cursor-pointer group relative"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            {/* Circle Avatar with Initials */}
                            <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-[11px] shrink-0">
                              {getInitials(lead.name)}
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-slate-900 truncate leading-tight group-hover:text-blue-600 transition-colors">
                                {lead.name}
                              </h4>
                              <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                                {lead.company || 'Private Store'}
                              </p>
                              <span className="block text-[10px] text-slate-400 mt-1 font-mono">
                                {lead.lastActionDate || 'Recent'}
                              </span>
                            </div>
                          </div>

                          <div className="shrink-0">
                            {getPriorityBadge(lead.priority)}
                          </div>
                        </div>

                        {/* Quick action strip on hover */}
                        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between opacity-80 group-hover:opacity-100 transition-opacity">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCallLead(lead);
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                              title="Call lead"
                            >
                              <Phone className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onMessageLead(lead);
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                              title="Message lead"
                            >
                              <MessageSquare className="w-3 h-3" />
                            </button>
                          </div>

                          {stage.nextStage && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAdvanceStage(lead.id, stage.nextStage!);
                              }}
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-blue-600 py-0.5 px-1.5 rounded hover:bg-blue-50 transition-colors"
                              title={`Move to ${stage.nextStage}`}
                            >
                              <span>Next</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Column Footer: "+ X more" */}
              <div className="pt-2 mt-1">
                {hiddenCount > 0 || isExpanded ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(stage.id as string)}
                    className="w-full text-center text-[11px] font-semibold text-blue-600 hover:text-blue-700 py-1 rounded hover:bg-blue-50/50 transition-colors cursor-pointer"
                  >
                    {isExpanded ? 'Show less' : `+ ${hiddenCount} more`}
                  </button>
                ) : (
                  <div className="text-center text-[11px] text-slate-400 py-1">
                    + 0 more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
