import React, { useState } from 'react';
import {
  FileText,
  Download,
  Calendar,
  Filter,
  Users,
  Building2,
  DollarSign,
  TrendingUp,
  Share2,
  CheckCircle2,
  Printer,
  Sparkles
} from 'lucide-react';

export const SalesHeadReportsView: React.FC = () => {
  const [dateRange, setDateRange] = useState('This Month (Sep 2026)');
  const [teamFilter, setTeamFilter] = useState('All Teams');
  const [employeeFilter, setEmployeeFilter] = useState('All Employees');
  const [sourceFilter, setSourceFilter] = useState('All Sources');
  const [productFilter, setProductFilter] = useState('All Products');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const handleExport = (format: string) => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      setExportSuccessMsg(`✅ Generated and downloaded WabaStore Sales Report (${format}) for ${dateRange}.`);
      setTimeout(() => setExportSuccessMsg(null), 4000);
    }, 1000);
  };

  const reportRows = [
    { id: 'REP-ROW-1', date: 'Sep 28, 2026', employee: 'Priya Nair', team: 'Pod Alpha', client: 'Singhania Textiles', source: 'WhatsApp Direct', product: 'WhatsApp Official API', value: 175000, status: 'Won' },
    { id: 'REP-ROW-2', date: 'Sep 27, 2026', employee: 'Amit Patel', team: 'Pod Alpha', client: 'Apex Logistics Hub', source: 'Website Catalog', product: 'Multi-Agent Support Desk', value: 210000, status: 'Won' },
    { id: 'REP-ROW-3', date: 'Sep 26, 2026', employee: 'Rahul Kumar', team: 'Pod Alpha', client: 'Zenith Retail Chain', source: 'Meta Ads', product: 'WhatsApp Catalog & Cart', value: 380000, status: 'Won' },
    { id: 'REP-ROW-4', date: 'Sep 25, 2026', employee: 'Sameer Kulkarni', team: 'Pod Beta', client: 'Kuber Logistics Corp', source: 'Website Form', product: 'Enterprise Webhook Sync', value: 240000, status: 'Proposal' },
    { id: 'REP-ROW-5', date: 'Sep 24, 2026', employee: 'Ananya Verma', team: 'Pod Beta', client: 'Metro Healthcare Clinics', source: 'Telecalling Desk', product: 'Multi-Agent Support Desk', value: 185000, status: 'Proposal' },
    { id: 'REP-ROW-6', date: 'Sep 23, 2026', employee: 'Sneha Deshmukh', team: 'Pod Alpha', client: 'Deshmukh Agro Foods', source: 'WhatsApp Direct', product: 'WhatsApp Official API', value: 195000, status: 'Negotiation' },
    { id: 'REP-ROW-7', date: 'Sep 22, 2026', employee: 'Rohan Varma', team: 'Pod Alpha', client: 'BrightEdge Learning', source: 'Meta Ads', product: 'Cart Recovery Workflows', value: 140000, status: 'Proposal' },
    { id: 'REP-ROW-8', date: 'Sep 21, 2026', employee: 'Rajesh Patel', team: 'Pod Beta', client: 'Urban Crafts Studio', source: 'Website Form', product: 'WhatsApp Catalog & Cart', value: 85000, status: 'Lost' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Toast */}
      {exportSuccessMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white py-3 px-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold">{exportSuccessMsg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Department Sales Intelligence & Reports
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              Export Center
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Generate detailed sales reports filtered by date, employee, sales team, lead source, and product catalog.
          </p>
        </div>

        {/* Action Export Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExport('Excel')}
            disabled={isExporting}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel (.xlsx)</span>
          </button>
          <button
            onClick={() => handleExport('CSV')}
            disabled={isExporting}
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>CSV</span>
          </button>
          <button
            onClick={() => handleExport('PDF')}
            disabled={isExporting}
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print PDF</span>
          </button>
        </div>
      </div>

      {/* Multi-Dimensional Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold font-heading text-slate-900">
              Report Parameters & Dimensions
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">Live Query Engine</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* Date Range */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Date Period:</label>
            <select
              value={dateRange}
              onChange={e => setDateRange(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="Today">Today</option>
              <option value="This Week">This Week</option>
              <option value="This Month (Sep 2026)">This Month (Sep 2026)</option>
              <option value="Last Month">Last Month (Aug 2026)</option>
              <option value="Q3 2026">Q3 2026 to Date</option>
            </select>
          </div>

          {/* Team / Pod */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Sales Team / Pod:</label>
            <select
              value={teamFilter}
              onChange={e => setTeamFilter(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="All Teams">All Pods (Alpha & Beta)</option>
              <option value="Pod Alpha">Pod Alpha (Vikram)</option>
              <option value="Pod Beta">Pod Beta (Rajesh)</option>
            </select>
          </div>

          {/* Employee */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Employee / Rep:</label>
            <select
              value={employeeFilter}
              onChange={e => setEmployeeFilter(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="All Employees">All Employees (14 Reps)</option>
              <option value="Priya Nair">Priya Nair</option>
              <option value="Amit Patel">Amit Patel</option>
              <option value="Sameer Kulkarni">Sameer Kulkarni</option>
              <option value="Rahul Kumar">Rahul Kumar</option>
              <option value="Ananya Verma">Ananya Verma</option>
            </select>
          </div>

          {/* Lead Source */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Lead Source:</label>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="All Sources">All Lead Sources</option>
              <option value="WhatsApp Direct">WhatsApp Direct</option>
              <option value="Meta Ads">Meta & Instagram Ads</option>
              <option value="Website Form">Website Catalog Form</option>
              <option value="Telecalling Desk">Telecalling Desk</option>
            </select>
          </div>

          {/* Product */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Product / Solution:</label>
            <select
              value={productFilter}
              onChange={e => setProductFilter(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="All Products">All SaaS Products</option>
              <option value="WhatsApp Official API">WhatsApp Official API</option>
              <option value="Multi-Agent Support Desk">Multi-Agent Support Desk</option>
              <option value="WhatsApp Catalog & Cart">WhatsApp Catalog & Cart</option>
              <option value="Cart Recovery Workflows">Cart Recovery Workflows</option>
            </select>
          </div>
        </div>
      </div>

      {/* Generated Aggregate KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Inquiries Evaluated</span>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-1 font-mono">428</p>
          <span className="text-[10px] text-slate-400">Total volume</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Deals Won</span>
          <p className="text-2xl font-bold font-heading text-emerald-600 mt-1 font-mono">88</p>
          <span className="text-[10px] text-emerald-700 font-bold">20.6% Net Win Rate</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Total Billed Revenue</span>
          <p className="text-2xl font-bold font-heading text-emerald-700 mt-1 font-mono">
            {formatINR(8450000)}
          </p>
          <span className="text-[10px] text-slate-400">Average ticket ₹96,022</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Target Attainment</span>
          <p className="text-2xl font-bold font-heading text-indigo-600 mt-1 font-mono">76.8%</p>
          <span className="text-[10px] text-indigo-700">Goal: ₹1.10 Cr</span>
        </div>
      </div>

      {/* Report Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Sales Pod</th>
                <th className="py-3 px-4">Customer Account</th>
                <th className="py-3 px-4">Lead Source</th>
                <th className="py-3 px-4">Product / Service</th>
                <th className="py-3 px-4">Contract Value</th>
                <th className="py-3 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {reportRows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3.5 px-4 text-slate-500">
                    {row.date}
                  </td>
                  <td className="py-3.5 px-4 font-bold text-slate-900">
                    {row.employee}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600">
                    {row.team}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-slate-800">
                    {row.client}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                      {row.source}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600">
                    {row.product}
                  </td>
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    {formatINR(row.value)}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      row.status === 'Won'
                        ? 'bg-emerald-100 text-emerald-800'
                        : row.status === 'Lost'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}>
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
