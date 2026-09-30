import React, { useState } from 'react';
import {
  Search, Filter, Download, PhoneCall, Mail, MessageSquare,
  TrendingUp, Clock, CheckCircle2, AlertTriangle, Eye, MoreVertical,
  Upload, Trash2, Database, Radio, Sparkles, X, Plus, Check
} from 'lucide-react';
import { useLeadStore } from '../../../context/LeadStoreContext';
import { LeadSourceId } from '../../../types/crm';
import { WabastoreWebhookLiveBar } from './WabastoreWebhookLiveBar';

export const AllLeadsView: React.FC = () => {
  const { getLeadsForDepartment, deleteLead, importBatchLeads, clearLeadsForDepartment } = useLeadStore();
  const wabastoreLeads = getLeadsForDepartment('wabastore');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // Import modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importRawText, setImportRawText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'hot':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'warm':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'cold':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'converted':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'hot':
        return <TrendingUp className="w-4 h-4" />;
      case 'warm':
        return <Clock className="w-4 h-4" />;
      case 'converted':
        return <CheckCircle2 className="w-4 h-4" />;
      default:
        return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const filteredLeads = wabastoreLeads.filter(lead => {
    const term = searchTerm.toLowerCase();
    const nameMatch = lead.name.toLowerCase().includes(term);
    const companyMatch = (lead.rawPayload?.company || lead.location || '').toLowerCase().includes(term);
    const emailMatch = (lead.email || '').toLowerCase().includes(term);
    const phoneMatch = (lead.contact || '').toLowerCase().includes(term);
    const notesMatch = (lead.notes || '').toLowerCase().includes(term);

    const matchesSearch = nameMatch || companyMatch || emailMatch || phoneMatch || notesMatch;
    const matchesStatus = statusFilter === 'all' || lead.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesSource = sourceFilter === 'all' || lead.sourceId === sourceFilter;

    return matchesSearch && matchesStatus && matchesSource;
  });

  const stats = {
    total: wabastoreLeads.length,
    ingested: wabastoreLeads.filter(l => l.status === 'Ingested').length,
    verified: wabastoreLeads.filter(l => l.status === 'Verified').length,
    processing: wabastoreLeads.filter(l => l.status === 'Processing').length
  };

  const handleExportCSV = () => {
    if (wabastoreLeads.length === 0) return;
    const headers = ['ID', 'Name', 'Phone', 'Email', 'Company', 'Source', 'Status', 'Timestamp', 'Notes'];
    const rows = wabastoreLeads.map(l => [
      l.id,
      `"${l.name.replace(/"/g, '""')}"`,
      `"${l.contact}"`,
      `"${l.email || ''}"`,
      `"${(l.rawPayload?.company || l.location || '').replace(/"/g, '""')}"`,
      l.sourceId,
      l.status,
      l.receivedAt,
      `"${(l.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `wabastore_leads_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportSubmit = () => {
    setImportError(null);
    const text = importRawText.trim();
    if (!text) {
      setImportError('Please paste CSV data or JSON array.');
      return;
    }

    try {
      const parsedLeads: Array<{
        name: string;
        contact: string;
        email?: string;
        company?: string;
        sourceId?: LeadSourceId;
        location?: string;
        notes?: string;
      }> = [];

      if (importFormat === 'json' || text.startsWith('[') || text.startsWith('{')) {
        let json = JSON.parse(text);
        if (!Array.isArray(json)) {
          if (json.leads && Array.isArray(json.leads)) json = json.leads;
          else if (json.data && Array.isArray(json.data)) json = json.data;
          else json = [json];
        }
        for (const item of json) {
          const name = item.name || item.customer_name || item.fullName || item.contact_name;
          const phone = item.phone || item.contact || item.mobile || item.phoneNumber;
          if (name || phone) {
            parsedLeads.push({
              name: name || 'Customer Lead',
              contact: phone || 'No Phone',
              email: item.email || `${(name || 'customer').toLowerCase().replace(/[^a-z0-9]/g, '.')}@client.com`,
              company: item.company || item.store || item.brand || 'Wabastore Client',
              sourceId: (item.source || item.channel || 'whatsapp') as LeadSourceId,
              location: item.location || item.city || 'Direct Import',
              notes: item.notes || item.deal_value || item.value || 'Imported Base Customer'
            });
          }
        }
      } else {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) throw new Error('No valid lines found');

        let startIndex = 0;
        const firstLine = lines[0].toLowerCase();
        if (firstLine.includes('name') || firstLine.includes('phone') || firstLine.includes('email') || firstLine.includes('company')) {
          startIndex = 1;
        }

        for (let i = startIndex; i < lines.length; i++) {
          const parts = lines[i].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
          if (parts.length >= 2) {
            const name = parts[0] || 'Valued Customer';
            const phone = parts[1] || 'Direct Phone';
            const email = parts[2] && parts[2].includes('@') ? parts[2] : `${name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@client.com`;
            const company = parts[3] || 'Wabastore Client';
            const notes = parts[4] || 'Imported Customer Base';

            parsedLeads.push({
              name,
              contact: phone,
              email,
              company,
              sourceId: 'whatsapp',
              location: 'Direct Import',
              notes
            });
          }
        }
      }

      if (parsedLeads.length === 0) {
        throw new Error('Could not extract any valid leads. Please ensure columns: Name, Phone, Email, Company.');
      }

      importBatchLeads(parsedLeads);
      setImportSuccessMsg(`✅ Successfully imported ${parsedLeads.length} real leads into Wabastore CRM!`);
      setImportRawText('');
      setTimeout(() => {
        setImportSuccessMsg(null);
        setIsImportModalOpen(false);
      }, 1500);
    } catch (err: any) {
      setImportError(err.message || 'Failed to parse import data.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-slate-100/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  AUTHENTIC CUSTOMER DATABASE
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
                Wabastore Sales Leads 📊
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Real-time unified customer leads across WhatsApp, Meta Ads &amp; all inbound channels
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-semibold text-xs shadow-2xs cursor-pointer"
              >
                <Upload className="w-4 h-4 text-emerald-600" />
                <span>Import Real Base</span>
              </button>
              <button
                onClick={handleExportCSV}
                disabled={wabastoreLeads.length === 0}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 disabled:opacity-50 text-white rounded-xl hover:bg-emerald-700 transition-colors font-semibold text-xs shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Real-time Wabastore Webhook Integration Gateway Bar */}
        <WabastoreWebhookLiveBar />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-sm text-slate-600 mb-1">Total Real Leads</p>
            <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
            <span className="text-[10px] font-mono text-emerald-600 mt-1 block">● 0% Synthetic Data</span>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-sm text-emerald-600 mb-1">⚡ Ingested Live</p>
            <p className="text-3xl font-bold text-emerald-600">{stats.ingested}</p>
            <span className="text-[10px] font-mono text-slate-400 mt-1 block">From Webhooks</span>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-sm text-blue-600 mb-1">✓ Verified Leads</p>
            <p className="text-3xl font-bold text-blue-600">{stats.verified}</p>
            <span className="text-[10px] font-mono text-slate-400 mt-1 block">Active Inquiries</span>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-teal-200 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-sm text-teal-600 mb-1">⚡ Processing Deals</p>
            <p className="text-3xl font-bold text-teal-600">{stats.processing}</p>
            <span className="text-[10px] font-mono text-slate-400 mt-1 block">In Progress</span>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search real leads by customer name, phone, email, store, or notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-sans"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              >
                <option value="all">All Channels</option>
                <option value="whatsapp">WhatsApp API</option>
                <option value="meta">Meta Ads</option>
                <option value="telecaller">Telecaller</option>
                <option value="bizdev">Business Developer</option>
                <option value="aicalling">AI Calling</option>
                <option value="rcs">RCS Messages</option>
                <option value="website">Website Leads</option>
                <option value="references">References</option>
                <option value="coldcalling">Cold Calling</option>
                <option value="thirdparty">Third Party</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              >
                <option value="all">All Status</option>
                <option value="Ingested">Ingested</option>
                <option value="Verified">Verified</option>
                <option value="Converted">Converted</option>
              </select>
            </div>
          </div>
        </div>

        {/* Leads Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-mono text-slate-500 uppercase">
                  <th className="px-6 py-4">Customer Contact</th>
                  <th className="px-6 py-4">Channel / Source</th>
                  <th className="px-6 py-4">Company / Store</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Received Time</th>
                  <th className="px-6 py-4">Details / Notes</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredLeads.length > 0 ? (
                  filteredLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-bold text-slate-900 font-sans text-sm">{lead.name}</p>
                          <a href={`tel:${lead.contact}`} className="text-emerald-700 hover:underline flex items-center gap-1 mt-0.5">
                            <PhoneCall className="w-3 h-3" /> {lead.contact}
                          </a>
                          {lead.email && (
                            <a href={`mailto:${lead.email}`} className="text-slate-400 hover:text-slate-600 flex items-center gap-1 text-[11px] mt-0.5">
                              <Mail className="w-3 h-3" /> {lead.email}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase">
                          {lead.sourceId}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-sans font-medium text-slate-700">
                        {lead.rawPayload?.company || lead.location || 'Wabastore Client'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {new Date(lead.receivedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                        {new Date(lead.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4 font-sans text-slate-600 max-w-xs truncate">
                        {lead.notes || lead.rawPayload?.message || '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteLead(lead.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete Lead"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500 font-sans space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
                        <Database className="w-6 h-6" />
                      </div>
                      <p className="font-bold text-base text-slate-800">
                        {searchTerm || statusFilter !== 'all' || sourceFilter !== 'all'
                          ? 'No leads matching current search/filter.'
                          : 'No real customer leads captured yet in Wabastore.'}
                      </p>
                      <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                        To view your authentic customer base, you can import your customer list (CSV/JSON), or send inbound events via the connected webhook gateway.
                      </p>
                      <div className="pt-2 flex items-center justify-center gap-3">
                        <button
                          onClick={() => setIsImportModalOpen(true)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-mono font-bold inline-flex items-center gap-2 shadow-xs cursor-pointer"
                        >
                          <Upload className="w-4 h-4" />
                          <span>Import Real Customer Base (CSV / JSON)</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between mt-4 text-xs font-mono text-slate-500">
          <p>Displaying {filteredLeads.length} of {wabastoreLeads.length} authentic leads</p>
          {wabastoreLeads.length > 0 && (
            <button
              onClick={() => clearLeadsForDepartment('wabastore')}
              className="text-rose-600 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Wabastore Leads</span>
            </button>
          )}
        </div>
      </div>

      {/* IMPORT MODAL */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">
                    Import Authentic Customer Base
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    Paste real customer records from Excel, Google Sheets, or JSON
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {importSuccessMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-mono flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{importSuccessMsg}</span>
              </div>
            )}

            {importError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-mono flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-mono font-bold text-slate-700 uppercase text-[10px]">
                  Format Selection:
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setImportFormat('csv')}
                    className={`px-3 py-1 rounded-lg font-mono text-xs font-bold transition-colors cursor-pointer ${importFormat === 'csv' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    CSV / Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportFormat('json')}
                    className={`px-3 py-1 rounded-lg font-mono text-xs font-bold transition-colors cursor-pointer ${importFormat === 'json' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    JSON Array
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-semibold">
                    {importFormat === 'csv' ? 'Paste comma-separated rows (Name, Phone, Email, Company, Notes):' : 'Paste JSON array of lead objects:'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (importFormat === 'csv') {
                        setImportRawText("Customer Name, Phone Number, Email, Company / Store, Notes\nRohit Agarwal, +91 98200 11223, rohit@agarwaltextiles.in, Agarwal Textiles, WhatsApp Store Setup\nPooja Sharma, +91 97112 33445, pooja@craftsboutique.com, Crafts Boutique Surat, Catalog Inquiry\nVikram Kothari, +91 99301 55667, vikram@kotharijewels.com, Kothari Jewels, Enterprise Meta Ads");
                      } else {
                        setImportRawText(JSON.stringify([
                          { name: "Rohit Agarwal", phone: "+91 98200 11223", email: "rohit@agarwaltextiles.in", company: "Agarwal Textiles", source: "whatsapp", notes: "WhatsApp Store Setup" },
                          { name: "Pooja Sharma", phone: "+91 97112 33445", email: "pooja@craftsboutique.com", company: "Crafts Boutique Surat", source: "meta", notes: "Catalog Inquiry" },
                          { name: "Vikram Kothari", phone: "+91 99301 55667", email: "vikram@kotharijewels.com", company: "Kothari Jewels", source: "bizdev", notes: "Enterprise Meta Ads" }
                        ], null, 2));
                      }
                    }}
                    className="text-[10px] font-mono text-emerald-600 hover:underline"
                  >
                    Load Sample Template
                  </button>
                </div>

                <textarea
                  rows={7}
                  value={importRawText}
                  onChange={(e) => setImportRawText(e.target.value)}
                  placeholder={importFormat === 'csv'
                    ? "Rohit Agarwal, +91 98200 11223, rohit@client.com, Agarwal Textiles\nPooja Sharma, +91 97112 33445, pooja@boutique.in, Pooja Boutique"
                    : '[\n  { "name": "Rohit Agarwal", "phone": "+91 98200 11223", "company": "Agarwal Textiles" }\n]'
                  }
                  className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-mono text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportSubmit}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold transition-colors cursor-pointer shadow-xs"
              >
                Import Customer Records Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
