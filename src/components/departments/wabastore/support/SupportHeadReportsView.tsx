import React, { useState } from 'react';
import {
  FileText, Download, Calendar, Filter, FileSpreadsheet,
  Printer, CheckCircle2, Sparkles, BarChart3, Search
} from 'lucide-react';

export const SupportHeadReportsView: React.FC = () => {
  const [dateRange, setDateRange] = useState('This Month');
  const [selectedAgent, setSelectedAgent] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedPriority, setSelectedPriority] = useState('All');

  const reportData = [
    { date: 'Sep 28, 2026', ticket: 'TICK-801', customer: 'Mehta Traders', category: 'Meta Templates', priority: 'Critical', agent: 'Neha Kulkarni', resTime: '25m', status: 'Open' },
    { date: 'Sep 28, 2026', ticket: 'TICK-802', customer: 'Patil Enterprises', category: 'Catalog Sync', priority: 'Critical', agent: 'Aakash Singhal', resTime: '1.2h', status: 'Escalated' },
    { date: 'Sep 28, 2026', ticket: 'TICK-803', customer: 'NextGen Living', category: 'Payments', priority: 'High', agent: 'Kavita Roy', resTime: '45m', status: 'Open' },
    { date: 'Sep 27, 2026', ticket: 'TICK-798', customer: 'Fashion House', category: 'User Access', priority: 'Medium', agent: 'Manish Sharma', resTime: '20m', status: 'Resolved' },
    { date: 'Sep 27, 2026', ticket: 'TICK-795', customer: 'Zenith Retail Chain', category: 'API & Webhooks', priority: 'Critical', agent: 'Neha Kulkarni', resTime: '3.5h', status: 'Resolved' },
    { date: 'Sep 26, 2026', ticket: 'TICK-791', customer: 'Singhania Textiles', category: 'Meta Templates', priority: 'Low', agent: 'Pooja Nair', resTime: '15m', status: 'Resolved' },
    { date: 'Sep 26, 2026', ticket: 'TICK-788', customer: 'Deshmukh Agro', category: 'Catalog Sync', priority: 'Low', agent: 'Deepak Verma', resTime: '10m', status: 'Resolved' },
    { date: 'Sep 25, 2026', ticket: 'TICK-782', customer: 'FreshRoot Organics', category: 'Meta Templates', priority: 'High', agent: 'Ritu Sen', resTime: '55m', status: 'Resolved' }
  ];

  const handleExport = (type: 'csv' | 'excel' | 'pdf') => {
    alert(`Generating and downloading Support Operations ${type.toUpperCase()} Report for ${dateRange}...`);
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <FileText className="w-6 h-6 text-teal-600" />
            <span>Support Analytics &amp; Reports Generator</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Filter, inspect, and export comprehensive support reports across date ranges, agents, categories, and SLA velocity
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExport('csv')}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="px-3.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel Export</span>
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>PDF Print</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Date Range</label>
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
            className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500 font-semibold"
          >
            <option value="Today">Today</option>
            <option value="This Week">This Week</option>
            <option value="This Month">This Month</option>
            <option value="Last 30 Days">Last 30 Days</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Support Employee</label>
          <select
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value)}
            className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
          >
            <option value="All">All Support Agents</option>
            <option value="Aakash Singhal">Aakash Singhal</option>
            <option value="Neha Kulkarni">Neha Kulkarni</option>
            <option value="Kavita Roy">Kavita Roy</option>
            <option value="Manish Sharma">Manish Sharma</option>
            <option value="Pooja Nair">Pooja Nair</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Issue Category</label>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
          >
            <option value="All">All Categories</option>
            <option value="Meta Templates">Meta Templates</option>
            <option value="API & Webhooks">API &amp; Webhooks</option>
            <option value="Catalog Sync">Catalog Sync</option>
            <option value="Payments">Payments</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Priority</label>
          <select
            value={selectedPriority}
            onChange={e => setSelectedPriority(e.target.value)}
            className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-teal-500"
          >
            <option value="All">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-teal-50/60 border border-teal-100 rounded-2xl p-4 text-xs">
        <div>
          <span className="text-teal-700 font-semibold block">Total Filtered Tickets</span>
          <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">{reportData.length} records</span>
        </div>
        <div>
          <span className="text-teal-700 font-semibold block">Resolution SLA %</span>
          <span className="text-xl font-bold font-mono text-emerald-700 mt-0.5 block">94.8%</span>
        </div>
        <div>
          <span className="text-teal-700 font-semibold block">Avg Resolution Speed</span>
          <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">42 mins</span>
        </div>
        <div>
          <span className="text-teal-700 font-semibold block">CSAT Adherence</span>
          <span className="text-xl font-bold font-mono text-amber-600 mt-0.5 block">4.8 / 5.0</span>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Ticket</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Assigned Agent</th>
                <th className="py-3 px-4">Resolution Speed</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {reportData.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 text-slate-500 font-sans">{row.date}</td>
                  <td className="py-3 px-4 font-bold text-slate-900">{row.ticket}</td>
                  <td className="py-3 px-4 font-sans font-semibold text-slate-800">{row.customer}</td>
                  <td className="py-3 px-4 font-sans text-slate-600">{row.category}</td>
                  <td className="py-3 px-4 font-sans">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      row.priority === 'Critical' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {row.priority}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-sans font-semibold text-slate-700">{row.agent}</td>
                  <td className="py-3 px-4 font-bold text-teal-700">{row.resTime}</td>
                  <td className="py-3 px-4 font-sans">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
