import React, { useState } from 'react';
import { 
  Search, Code, Download, MapPin, Clock, Database, CheckCircle2
} from 'lucide-react';
import { DepartmentId, Lead, LeadSourceId } from '../../types/crm';
import { useLeadStore } from '../../context/LeadStoreContext';
import { LEAD_SOURCES, LEAD_SOURCE_LIST } from '../../data/leadSources';
import { LeadPayloadModal } from './LeadPayloadModal';

interface LeadsTableProps {
  departmentId: DepartmentId;
  onOpenWebhookSimulator?: () => void;
}

export const LeadsTable: React.FC<LeadsTableProps> = ({ departmentId }) => {
  const { getLeadsForDepartment } = useLeadStore();

  const [selectedSource, setSelectedSource] = useState<LeadSourceId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLeadForModal, setSelectedLeadForModal] = useState<Lead | null>(null);

  const deptLeads = getLeadsForDepartment(departmentId);

  // Filter leads based on source and search
  const filteredLeads = deptLeads.filter(lead => {
    const matchesSource = selectedSource === 'all' || lead.sourceId === selectedSource;
    const q = searchQuery.toLowerCase();
    const matchesSearch = 
      !searchQuery ||
      lead.name.toLowerCase().includes(q) ||
      lead.contact.toLowerCase().includes(q) ||
      (lead.email && lead.email.toLowerCase().includes(q)) ||
      lead.id.toLowerCase().includes(q);

    return matchesSource && matchesSearch;
  });

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['ID', 'Name', 'Contact', 'Email', 'Source', 'Received At', 'Status', 'Location'];
    const rows = filteredLeads.map(l => [
      l.id,
      `"${l.name}"`,
      `"${l.contact}"`,
      `"${l.email || ''}"`,
      LEAD_SOURCES[l.sourceId]?.name || l.sourceId,
      l.receivedAt,
      l.status,
      `"${l.location || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `leads_${departmentId}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-mono text-blue-600 font-semibold uppercase">
              UNIFIED LEADS DATABASE
            </span>
          </div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">
            Leads Table
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono font-medium flex items-center gap-2 transition-colors border border-slate-200"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT CSV</span>
          </button>
        </div>
      </div>

      {/* Filter Bar & 10 Lead Source Pills */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
        
        {/* Search Input & Source Dropdown */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search leads by name, phone, email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 font-mono"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto font-mono text-xs text-slate-500">
            <span>SHOWING:</span>
            <strong className="text-slate-900 font-bold">{filteredLeads.length}</strong>
            <span>OF</span>
            <strong className="text-blue-600 font-bold">{deptLeads.length}</strong>
            <span>LEADS</span>
          </div>
        </div>

        {/* 10 Source Color Tag Filter Pills */}
        <div>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-2 font-semibold">
            Filter by Lead Source (10 Channels):
          </span>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedSource('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all border ${
                selectedSource === 'all'
                  ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:text-slate-900'
              }`}
            >
              All Sources ({deptLeads.length})
            </button>

            {LEAD_SOURCE_LIST.map(src => {
              const count = deptLeads.filter(l => l.sourceId === src.id).length;
              const isSelected = selectedSource === src.id;

              return (
                <button
                  key={src.id}
                  onClick={() => setSelectedSource(src.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all border flex items-center gap-1.5 ${
                    isSelected
                      ? `${src.bgClass} ${src.textClass} ${src.borderClass} shadow-sm font-bold`
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:text-slate-900'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: src.color }} />
                  <span>{src.badgeLabel}</span>
                  <span className="text-[10px] opacity-75 font-bold">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* Main Unified Leads Table */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider text-[10px] font-semibold">
              <tr>
                <th className="py-3.5 px-4">Lead ID</th>
                <th className="py-3.5 px-4">Prospect Name</th>
                <th className="py-3.5 px-4">Contact Details</th>
                <th className="py-3.5 px-4">Inbound Source</th>
                <th className="py-3.5 px-4">Received Timestamp</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Raw Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-mono">
                    <Database className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-700">No leads found matching your search</p>
                  </td>
                </tr>
              ) : (
                filteredLeads.map(lead => {
                  const srcObj = LEAD_SOURCES[lead.sourceId];

                  return (
                    <tr key={lead.id} className="hover:bg-slate-50 transition-colors group">
                      {/* ID */}
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {lead.id}
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 font-sans text-sm group-hover:text-blue-600 transition-colors">
                          {lead.name}
                        </div>
                        {lead.location && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            {lead.location}
                          </span>
                        )}
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4">
                        <div className="text-blue-600 font-bold">{lead.contact}</div>
                        {lead.email && <div className="text-[11px] text-slate-500">{lead.email}</div>}
                      </td>

                      {/* Source Tag Badge */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${srcObj.bgClass} ${srcObj.textClass} ${srcObj.borderClass}`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: srcObj.color }} />
                          <span>{srcObj.badgeLabel}</span>
                        </span>
                      </td>

                      {/* Received Timestamp */}
                      <td className="py-3.5 px-4 text-slate-600">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{new Date(lead.receivedAt).toLocaleDateString()}</span>
                          <span className="text-slate-400">{new Date(lead.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] uppercase font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{lead.status}</span>
                        </span>
                      </td>

                      {/* Raw Payload Inspector */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => setSelectedLeadForModal(lead)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-mono border border-slate-200 flex items-center gap-1 ml-auto transition-colors"
                        >
                          <Code className="w-3.5 h-3.5 text-slate-500" />
                          <span>{'{...}'} JSON</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Payload Modal */}
      <LeadPayloadModal
        lead={selectedLeadForModal}
        onClose={() => setSelectedLeadForModal(null)}
      />
    </div>
  );
};
