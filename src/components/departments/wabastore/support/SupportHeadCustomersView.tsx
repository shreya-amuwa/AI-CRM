import React, { useState } from 'react';
import {
  Users, Search, Filter, MessageSquare, Phone, Mail, Clock,
  CheckCircle2, AlertTriangle, Eye, X, Building2, ShieldCheck, HeartPulse
} from 'lucide-react';

interface SupportCustomer {
  id: string;
  name: string;
  company: string;
  segment: 'Enterprise' | 'Wholesale' | 'Corporate' | 'Retail';
  phone: string;
  email: string;
  sentiment: 'Healthy' | 'Neutral' | 'At-Risk';
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  assignedRep: string;
  lastContactDate: string;
  recentIssue: string;
}

export const SUPPORT_CUSTOMERS_DATA: SupportCustomer[] = [
  {
    id: 'SCUST-01',
    name: 'Rajesh Mehta',
    company: 'Mehta Traders',
    segment: 'Enterprise',
    phone: '+91 98765 43210',
    email: 'rajesh@mehta.com',
    sentiment: 'Healthy',
    totalTickets: 15,
    openTickets: 1,
    resolvedTickets: 14,
    assignedRep: 'Neha Kulkarni',
    lastContactDate: 'Today, 09:15 AM',
    recentIssue: 'Meta WhatsApp Template 504 timeout during festive broadcast'
  },
  {
    id: 'SCUST-02',
    name: 'Sneha Patil',
    company: 'Patil Enterprises',
    segment: 'Wholesale',
    phone: '+91 98234 56789',
    email: 'sneha@patil.com',
    sentiment: 'At-Risk',
    totalTickets: 11,
    openTickets: 2,
    resolvedTickets: 9,
    assignedRep: 'Aakash Singhal',
    lastContactDate: 'Today, 08:30 AM',
    recentIssue: 'Inventory Catalog webhook sync mismatch on 12 SKU variants'
  },
  {
    id: 'SCUST-03',
    name: 'Amit Joshi',
    company: 'NextGen Living',
    segment: 'Corporate',
    phone: '+91 97654 32109',
    email: 'amit@nextgen.com',
    sentiment: 'Neutral',
    totalTickets: 7,
    openTickets: 1,
    resolvedTickets: 6,
    assignedRep: 'Kavita Roy',
    lastContactDate: 'Today, 09:45 AM',
    recentIssue: 'Razorpay webhook confirmation SMS trigger delay'
  },
  {
    id: 'SCUST-04',
    name: 'Isha Verma',
    company: 'Fashion House',
    segment: 'Enterprise',
    phone: '+91 96543 21098',
    email: 'isha@fashionhouse.com',
    sentiment: 'Healthy',
    totalTickets: 18,
    openTickets: 1,
    resolvedTickets: 17,
    assignedRep: 'Manish Sharma',
    lastContactDate: 'Today, 10:10 AM',
    recentIssue: 'Request to add 3 new telecaller agents to desk'
  },
  {
    id: 'SCUST-05',
    name: 'Vikram Malhotra',
    company: 'Zenith Retail Chain',
    segment: 'Enterprise',
    phone: '+91 95432 10987',
    email: 'vikram@zenithretail.in',
    sentiment: 'At-Risk',
    totalTickets: 24,
    openTickets: 2,
    resolvedTickets: 22,
    assignedRep: 'Neha Kulkarni',
    lastContactDate: 'Today, 07:50 AM',
    recentIssue: 'Webhook HMAC-SHA256 signature verification failing'
  },
  {
    id: 'SCUST-06',
    name: 'Pooja Singhania',
    company: 'Singhania Textiles',
    segment: 'Wholesale',
    phone: '+91 94321 09876',
    email: 'pooja@singhaniatex.com',
    sentiment: 'Neutral',
    totalTickets: 6,
    openTickets: 1,
    resolvedTickets: 5,
    assignedRep: 'Manish Sharma',
    lastContactDate: 'Today, 09:00 AM',
    recentIssue: 'Out-of-office autoreply workflow scheduling configuration'
  },
  {
    id: 'SCUST-07',
    name: 'Deepak Deshmukh',
    company: 'Deshmukh Agro',
    segment: 'Retail',
    phone: '+91 93210 98765',
    email: 'deepak@deshmukhagro.in',
    sentiment: 'Healthy',
    totalTickets: 8,
    openTickets: 0,
    resolvedTickets: 8,
    assignedRep: 'Pooja Nair',
    lastContactDate: 'Yesterday, 04:30 PM',
    recentIssue: 'Catalog image resolution requirements for WhatsApp Carousel'
  },
  {
    id: 'SCUST-08',
    name: 'Anil Agarwal',
    company: 'FreshRoot Organics',
    segment: 'Corporate',
    phone: '+91 92109 87654',
    email: 'anil@freshroot.com',
    sentiment: 'Healthy',
    totalTickets: 12,
    openTickets: 1,
    resolvedTickets: 11,
    assignedRep: 'Deepak Verma',
    lastContactDate: 'Today, 09:20 AM',
    recentIssue: 'Delivery notification template wording rejection appeal'
  }
];

export const SupportHeadCustomersView: React.FC = () => {
  const [customers] = useState<SupportCustomer[]>(SUPPORT_CUSTOMERS_DATA);
  const [searchQuery, setSearchQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('All');
  const [sentimentFilter, setSentimentFilter] = useState('All');
  const [selectedCust, setSelectedCust] = useState<SupportCustomer | null>(null);

  const filtered = customers.filter(c => {
    if (segmentFilter !== 'All' && c.segment !== segmentFilter) return false;
    if (sentimentFilter !== 'All' && c.sentiment !== sentimentFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.recentIssue.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getSentimentBadge = (s: string) => {
    switch (s) {
      case 'Healthy':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Healthy</span>;
      case 'Neutral':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">Neutral</span>;
      case 'At-Risk':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">At-Risk</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">{s}</span>;
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <Users className="w-6 h-6 text-teal-600" />
              <span>Support Customer Directory &amp; History</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              View customer profiles, support touchpoints, previous issues, and health sentiment
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl">
              {filtered.length} Accounts Monitored
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by customer, company, or issue..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Segment:</span>
            <select
              value={segmentFilter}
              onChange={e => setSegmentFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
            >
              <option value="All">All Customer Segments</option>
              <option value="Enterprise">Enterprise</option>
              <option value="Wholesale">Wholesale</option>
              <option value="Corporate">Corporate</option>
              <option value="Retail">Retail</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Health:</span>
            <select
              value={sentimentFilter}
              onChange={e => setSentimentFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
            >
              <option value="All">All Sentiment States</option>
              <option value="Healthy">Healthy</option>
              <option value="Neutral">Neutral</option>
              <option value="At-Risk">At-Risk</option>
            </select>
          </div>
        </div>
      </div>

      {/* Customer Cards & Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Customer &amp; Company</th>
                <th className="py-3.5 px-4">Segment</th>
                <th className="py-3.5 px-4">Health Sentiment</th>
                <th className="py-3.5 px-4">Tickets Logged</th>
                <th className="py-3.5 px-4">Active Open</th>
                <th className="py-3.5 px-4">Assigned CSM / Rep</th>
                <th className="py-3.5 px-4">Latest Interaction</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-800 font-bold flex items-center justify-center text-xs">
                        {c.name.charAt(0)}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 block">{c.name}</span>
                        <span className="text-[11px] text-slate-500">{c.company}</span>
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                      {c.segment}
                    </span>
                  </td>

                  <td className="py-3.5 px-4">
                    {getSentimentBadge(c.sentiment)}
                  </td>

                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    {c.totalTickets} Total
                  </td>

                  <td className="py-3.5 px-4 font-mono font-bold">
                    {c.openTickets > 0 ? (
                      <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                        {c.openTickets} Open
                      </span>
                    ) : (
                      <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                        0 Active
                      </span>
                    )}
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="font-semibold text-slate-800 block">{c.assignedRep}</span>
                    <span className="text-[10px] text-slate-400">Tier-2 Specialist</span>
                  </td>

                  <td className="py-3.5 px-4 max-w-xs">
                    <span className="text-slate-700 block truncate">{c.recentIssue}</span>
                    <span className="text-[10px] text-slate-400">{c.lastContactDate}</span>
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => setSelectedCust(c)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-600 hover:text-teal-700 transition-colors"
                      title="Inspect Customer Dossier"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Support Dossier Modal */}
      {selectedCust && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
                  {selectedCust.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{selectedCust.name}</h3>
                  <p className="text-xs text-slate-500">{selectedCust.company} &bull; {selectedCust.segment}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCust(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-2xl text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Health Status</span>
                <div className="mt-1">{getSentimentBadge(selectedCust.sentiment)}</div>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Ticket Volume</span>
                <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                  {selectedCust.totalTickets} Logged &bull; {selectedCust.resolvedTickets} Resolved
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Assigned Specialist</span>
                <span className="font-semibold text-slate-800">{selectedCust.assignedRep}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Last Touchpoint</span>
                <span className="text-slate-600 font-mono text-[11px]">{selectedCust.lastContactDate}</span>
              </div>
            </div>

            <div className="p-3 bg-teal-50/60 rounded-xl border border-teal-100 text-xs space-y-1">
              <span className="font-bold text-teal-800 text-[10px] uppercase block">Latest Inquired Issue</span>
              <p className="text-slate-800 leading-relaxed">{selectedCust.recentIssue}</p>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setSelectedCust(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
