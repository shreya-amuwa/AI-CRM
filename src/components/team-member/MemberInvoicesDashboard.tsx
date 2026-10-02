import React, { useState, useEffect } from 'react';
import {
  FileText,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Download,
  Share2,
  X,
  Search,
  Filter,
  Building2,
  Check,
  Printer,
  ChevronDown,
  Sparkles,
  Layers,
  Tag,
  ShieldCheck,
  Mail,
  Phone
} from 'lucide-react';
import { Invoice } from '../../types/crm';
import { teamMemberStore } from '../../services/teamMemberStore';
import { useAuth } from '../../context/AuthContext';
import { accountsStore, normalizeDepartmentId } from '../../services/accountsStore';

interface MemberInvoicesDashboardProps {
  currentUserId: string;
}

export interface DepartmentConfig {
  id: string;
  name: string;
  group: string;
  division?: string;
  prefix: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  accentColor: string;
  billingEmail: string;
  billingPhone: string;
  terms: string;
  defaultService: string;
  defaultAmount: number;
}

export const SYSTEM_DEPARTMENTS: DepartmentConfig[] = [
  // 1. Wabastore - Sales
  {
    id: 'wabastore-sales',
    name: 'Wabastore (Sales Division)',
    group: 'Wabastore',
    division: 'Sales',
    prefix: 'WAB-SLS-2026-',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-800',
    badgeBorder: 'border-emerald-200',
    accentColor: '#059669',
    billingEmail: 'billing@wabastore.com',
    billingPhone: '+91 80 4912 2001',
    terms: 'Net 15 days. Subject to Meta Cloud WhatsApp Commerce terms.',
    defaultService: 'Wabastore E-Commerce Storefront Engine & Catalog Sync',
    defaultAmount: 185000
  },
  // 2. Wabastore - Support
  {
    id: 'wabastore-support',
    name: 'Wabastore (Support Division)',
    group: 'Wabastore',
    division: 'Support',
    prefix: 'WAB-SUP-2026-',
    badgeBg: 'bg-teal-50',
    badgeText: 'text-teal-800',
    badgeBorder: 'border-teal-200',
    accentColor: '#0D9488',
    billingEmail: 'support@wabastore.com',
    billingPhone: '+91 80 4912 2002',
    terms: 'Covers webhook integrations, SLA maintenance, and store bugfixes.',
    defaultService: 'Catalog Webhook Maintenance & Dedicated Support AMC',
    defaultAmount: 35000
  },
  // 3. Wabastar - Sales
  {
    id: 'wabastar-sales',
    name: 'Wabastar (Sales Division)',
    group: 'Wabastar',
    division: 'Sales',
    prefix: 'WBS-SLS-2026-',
    badgeBg: 'bg-green-50',
    badgeText: 'text-green-800',
    badgeBorder: 'border-green-200',
    accentColor: '#16A34A',
    billingEmail: 'sales@wabastar.com',
    billingPhone: '+91 80 4912 2005',
    terms: 'Net 15 days. High-throughput marketing automation SLA applies.',
    defaultService: 'Wabastar High-Throughput Marketing Automation License',
    defaultAmount: 230000
  },
  // 4. Wabastar - Support
  {
    id: 'wabastar-support',
    name: 'Wabastar (Support Division)',
    group: 'Wabastar',
    division: 'Support',
    prefix: 'WBS-SUP-2026-',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-800',
    badgeBorder: 'border-emerald-200',
    accentColor: '#059669',
    billingEmail: 'support@wabastar.com',
    billingPhone: '+91 80 4912 2006',
    terms: 'Broadcast channel bandwidth and 24/7 campaign queue support.',
    defaultService: 'Dedicated Broadcast Infrastructure & Campaign AMC',
    defaultAmount: 40000
  },
  // 5. Whatsbox - Sales
  {
    id: 'whatsbox-sales',
    name: 'Whatsbox (Sales Division)',
    group: 'Whatsbox',
    division: 'Sales',
    prefix: 'WBX-SLS-2026-',
    badgeBg: 'bg-cyan-50',
    badgeText: 'text-cyan-800',
    badgeBorder: 'border-cyan-200',
    accentColor: '#0891B2',
    billingEmail: 'sales@whatsbox.com',
    billingPhone: '+91 80 4912 3001',
    terms: 'Annual subscription billed upfront with 99.9% uptime SLA.',
    defaultService: 'Whatsbox Multi-Agent Unified Inbox License (25 Seats)',
    defaultAmount: 215000
  },
  // 6. Whatsbox - Support
  {
    id: 'whatsbox-support',
    name: 'Whatsbox (Support Division)',
    group: 'Whatsbox',
    division: 'Support',
    prefix: 'WBX-SUP-2026-',
    badgeBg: 'bg-sky-50',
    badgeText: 'text-sky-800',
    badgeBorder: 'border-sky-200',
    accentColor: '#0284C7',
    billingEmail: 'support@whatsbox.com',
    billingPhone: '+91 80 4912 3002',
    terms: 'Includes 24/7 dedicated technical account manager & priority queue.',
    defaultService: 'Whatsbox 24/7 Premium Tier Technical Support Retainer',
    defaultAmount: 45000
  },
  // 9. D-Talk - Sales
  {
    id: 'dtalk-sales',
    name: 'D-Talk (Sales Division)',
    group: 'D-Talk Corporation',
    division: 'Sales',
    prefix: 'DTK-SLS-2026-',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-800',
    badgeBorder: 'border-purple-200',
    accentColor: '#7C3AED',
    billingEmail: 'sales@dtalk.com',
    billingPhone: '+91 20 6711 5001',
    terms: 'Includes 100-channel PRI line allocation. TRAI compliance guidelines apply.',
    defaultService: 'Enterprise 100-Channel PRI SIP Trunking & Dialer Suite',
    defaultAmount: 240000
  },
  // 10. D-Talk - Support
  {
    id: 'dtalk-support',
    name: 'D-Talk (Support Division)',
    group: 'D-Talk Corporation',
    division: 'Support',
    prefix: 'DTK-SUP-2026-',
    badgeBg: 'bg-violet-50',
    badgeText: 'text-violet-800',
    badgeBorder: 'border-violet-200',
    accentColor: '#6D28D9',
    billingEmail: 'support@dtalk.com',
    billingPhone: '+91 20 6711 5002',
    terms: 'Monthly carrier trunk monitoring and encrypted voice recording vault SLA.',
    defaultService: 'Telecom PBX Encrypted Call Recording Vault Maintenance',
    defaultAmount: 40000
  },
  // 11. Digitree - Sales
  {
    id: 'digitree-sales',
    name: 'Digitree (Sales Division)',
    group: 'Digitree Infotech',
    division: 'Sales',
    prefix: 'DGT-SLS-2026-',
    badgeBg: 'bg-pink-50',
    badgeText: 'text-pink-800',
    badgeBorder: 'border-pink-200',
    accentColor: '#DB2777',
    billingEmail: 'sales@digitree.com',
    billingPhone: '+91 124 459 8001',
    terms: 'Software license valid for 12 months with unlimited dynamic QR generations.',
    defaultService: 'Digitree Dynamic AIQR Enterprise Multi-Brand Platform',
    defaultAmount: 195000
  },
  // 12. Digitree - Support
  {
    id: 'digitree-support',
    name: 'Digitree (Support Division)',
    group: 'Digitree Infotech',
    division: 'Support',
    prefix: 'DGT-SUP-2026-',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-800',
    badgeBorder: 'border-rose-200',
    accentColor: '#E11D48',
    billingEmail: 'support@digitree.com',
    billingPhone: '+91 124 459 8002',
    terms: 'High-frequency API support & 99.99% redirect resolution uptime guarantee.',
    defaultService: 'High-Availability AIQR Cloud DNS & CDN Support Retainer',
    defaultAmount: 38000
  },
  // 13. M Pillar - Sales
  {
    id: 'mpillar-sales',
    name: 'M Pillar (Sales Division)',
    group: 'M Pillar Corporation',
    division: 'Sales',
    prefix: 'MPL-SLS-2026-',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-900',
    badgeBorder: 'border-amber-300',
    accentColor: '#D97706',
    billingEmail: 'sales@mpillar.com',
    billingPhone: '+91 22 6889 6001',
    terms: 'Mobilization within 14 business days. Milestone billing upon site setup.',
    defaultService: 'Smart Construction Site Safety & Daily Attendance IoT Suite',
    defaultAmount: 280000
  },
  // 14. M Pillar - Support
  {
    id: 'mpillar-support',
    name: 'M Pillar (Support Division)',
    group: 'M Pillar Corporation',
    division: 'Support',
    prefix: 'MPL-SUP-2026-',
    badgeBg: 'bg-orange-50',
    badgeText: 'text-orange-900',
    badgeBorder: 'border-orange-300',
    accentColor: '#EA580C',
    billingEmail: 'support@mpillar.com',
    billingPhone: '+91 22 6889 6002',
    terms: 'Field sensor maintenance and weighbridge ticket calibration support.',
    defaultService: 'On-Site IoT Hardware Calibration & Blueprint Cloud AMC',
    defaultAmount: 48000
  }
];

export const MemberInvoicesDashboard: React.FC<MemberInvoicesDashboardProps> = ({ currentUserId }) => {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>(() => teamMemberStore.getInvoices(currentUserId));
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Real-time synchronization listener with Accounts Dashboard
  useEffect(() => {
    const handleInvoiceCreated = () => {
      setInvoices(teamMemberStore.getInvoices(currentUserId));
    };
    window.addEventListener('amuwa_crm_invoice_created', handleInvoiceCreated);
    window.addEventListener('storage', handleInvoiceCreated);
    return () => {
      window.removeEventListener('amuwa_crm_invoice_created', handleInvoiceCreated);
      window.removeEventListener('storage', handleInvoiceCreated);
    };
  }, [currentUserId]);

  // Success Notification state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form State (with "Remember Last Department" persistent UX)
  const [form, setForm] = useState({
    customerName: '',
    company: '',
    departmentId: '',
    amount: 185000,
    dueDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
    itemDescription: '',
    status: 'Pending' as Invoice['status']
  });

  const [formError, setFormError] = useState<string | null>(null);

  // Load "Remember Last Department" on modal open or mount
  useEffect(() => {
    try {
      const savedDeptId = localStorage.getItem('amuwa_crm_last_invoice_department');
      if (savedDeptId && SYSTEM_DEPARTMENTS.some(d => d.id === savedDeptId)) {
        const found = SYSTEM_DEPARTMENTS.find(d => d.id === savedDeptId);
        setForm(prev => ({
          ...prev,
          departmentId: savedDeptId,
          amount: found ? found.defaultAmount : prev.amount,
          itemDescription: found ? found.defaultService : prev.itemDescription
        }));
      } else {
        // Default to Wabastore (Sales) as primary
        const def = SYSTEM_DEPARTMENTS.find(d => d.id === 'wabastore-sales') || SYSTEM_DEPARTMENTS[0];
        setForm(prev => ({
          ...prev,
          departmentId: def.id,
          amount: def.defaultAmount,
          itemDescription: def.defaultService
        }));
      }
    } catch {}
  }, []);

  // Handle department change in form
  const handleDepartmentChange = (deptId: string) => {
    const deptConfig = SYSTEM_DEPARTMENTS.find(d => d.id === deptId);
    setForm(prev => ({
      ...prev,
      departmentId: deptId,
      amount: deptConfig ? deptConfig.defaultAmount : prev.amount,
      itemDescription: deptConfig ? deptConfig.defaultService : prev.itemDescription
    }));
    setFormError(null);

    // Save to localStorage
    try {
      if (deptId) {
        localStorage.setItem('amuwa_crm_last_invoice_department', deptId);
      }
    } catch {}
  };

  // Filtered Invoices & Scoping
  const filteredInvoices = invoices.filter(inv => {
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.customerName.toLowerCase().includes(q) ||
      inv.company.toLowerCase().includes(q) ||
      (inv.departmentName && inv.departmentName.toLowerCase().includes(q)) ||
      (inv.division && inv.division.toLowerCase().includes(q));

    const matchDept =
      selectedDeptFilter === 'all' ||
      inv.departmentId === selectedDeptFilter ||
      (selectedDeptFilter.includes('-') && inv.departmentId?.startsWith(selectedDeptFilter.split('-')[0]));

    const matchStatus =
      selectedStatusFilter === 'all' ||
      inv.status === selectedStatusFilter;

    return matchSearch && matchDept && matchStatus;
  });

  // Dynamic KPI Metrics (Recalculated based on active department scoping)
  const scopedForKpis = selectedDeptFilter === 'all'
    ? invoices
    : invoices.filter(inv => inv.departmentId === selectedDeptFilter || (selectedDeptFilter.includes('-') && inv.departmentId?.startsWith(selectedDeptFilter.split('-')[0])));

  const totalBilled = scopedForKpis.reduce((acc, inv) => acc + inv.amount, 0);
  const paidInvoices = scopedForKpis.filter(inv => inv.status === 'Paid');
  const paidAmount = paidInvoices.reduce((acc, inv) => acc + inv.amount, 0);
  const pendingInvoices = scopedForKpis.filter(inv => inv.status === 'Pending');
  const pendingAmount = pendingInvoices.reduce((acc, inv) => acc + inv.amount, 0);
  const overdueInvoices = scopedForKpis.filter(inv => inv.status === 'Overdue');
  const overdueAmount = overdueInvoices.reduce((acc, inv) => acc + inv.amount, 0);

  // Form Submission
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.customerName.trim()) {
      setFormError('Please enter the customer name.');
      return;
    }
    if (!form.company.trim()) {
      setFormError('Please enter the client company name.');
      return;
    }
    if (!form.departmentId) {
      setFormError('Please select a department for this invoice.');
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setFormError('Please enter a valid amount.');
      return;
    }

    const dept = SYSTEM_DEPARTMENTS.find(d => d.id === form.departmentId) || SYSTEM_DEPARTMENTS[0];
    const generatedSeq = Math.floor(100 + Math.random() * 900);
    const invoiceNum = `${dept.prefix}${generatedSeq}`;

    const amountVal = Number(form.amount);
    const itemsDetail = [
      {
        description: form.itemDescription.trim() || dept.defaultService,
        quantity: 1,
        rate: amountVal,
        amount: amountVal
      }
    ];

    const newInvoiceData = {
      invoiceNumber: invoiceNum,
      customerName: form.customerName.trim(),
      company: form.company.trim(),
      amount: amountVal,
      issueDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      dueDate: form.dueDate,
      status: form.status,
      departmentId: dept.id,
      departmentName: dept.name,
      division: dept.division || 'Commercial',
      contactEmail: dept.billingEmail,
      contactPhone: dept.billingPhone,
      terms: dept.terms,
      items: itemsDetail
    };

    // 1. Add to Team Member Store
    teamMemberStore.addInvoice(newInvoiceData);

    // 2. Add to Central Accounts Department Store (connected to accounts dashboard)
    accountsStore.addInvoice({
      invoiceNumber: invoiceNum,
      departmentId: dept.id,
      departmentName: dept.name,
      clientName: form.customerName.trim(),
      clientCompany: form.company.trim(),
      clientAddress: 'HQ Corporate Commercials, Tech Park, Bangalore',
      clientEmail: dept.billingEmail,
      clientPhone: dept.billingPhone,
      teamMemberId: user?.id || currentUserId || 'tm-priya',
      teamMemberName: user?.name || 'Priya Mehta',
      teamMemberRole: user?.role === 'team-lead' ? 'Senior Sales Lead' : 'Account Sales Executive',
      issuedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      dueDate: form.dueDate,
      status: form.status as 'Paid' | 'Pending' | 'Overdue',
      items: itemsDetail,
      subtotal: amountVal,
      taxRate: 18,
      taxAmount: Math.round(amountVal * 0.18),
      totalAmount: amountVal,
      notes: dept.terms
    });

    const updated = teamMemberStore.getInvoices(currentUserId);
    setInvoices(updated);

    // Save department persistence
    try {
      localStorage.setItem('amuwa_crm_last_invoice_department', dept.id);
    } catch {}

    setIsCreateOpen(false);
    setSuccessMessage(`Invoice successfully created for ${dept.name} (${invoiceNum}) and synced to Accounts Dashboard!`);
    setTimeout(() => setSuccessMessage(null), 6000);

    // Reset Form
    setForm({
      customerName: '',
      company: '',
      departmentId: dept.id,
      amount: dept.defaultAmount,
      dueDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
      itemDescription: dept.defaultService,
      status: 'Pending'
    });
    setFormError(null);
  };

  const getStatusBadge = (status: Invoice['status']) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Paid
          </span>
        );
      case 'Pending':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Pending
          </span>
        );
      case 'Overdue':
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            Overdue
          </span>
        );
    }
  };

  const getDepartmentConfig = (deptId?: string) => {
    return SYSTEM_DEPARTMENTS.find(d => d.id === deptId) || null;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-sans">
      
      {/* SUCCESS NOTIFICATION TOAST */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-2xl flex items-center justify-between shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5" />
            </div>
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Invoices &amp; Billing
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
              Multi-Department
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Generate department-specific invoices, monitor receivables, and review billing metrics across all corporate divisions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setIsCreateOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-2xl text-xs font-bold hover:bg-blue-700 shadow-md transition-all active:scale-95 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4 text-emerald-300" />
          <span>Generate New Invoice</span>
        </button>
      </div>

      {/* KPI METRIC CARDS (SCOPED TO ACTIVE DEPARTMENT FILTER) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span>Total Billed</span>
              {selectedDeptFilter !== 'all' && (
                <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.2 rounded">Scoped</span>
              )}
            </div>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              ₹ {totalBilled.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block font-mono">
              {scopedForKpis.length} invoices
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Paid Invoices</span>
            <div className="text-xl font-bold font-heading text-emerald-700 mt-1">
              ₹ {paidAmount.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 block">
              {paidInvoices.length} collected
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Pending Amount</span>
            <div className="text-xl font-bold font-heading text-amber-700 mt-1">
              ₹ {pendingAmount.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-amber-600 font-semibold mt-1 block">
              {pendingInvoices.length} awaiting payment
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Overdue</span>
            <div className="text-xl font-bold font-heading text-rose-700 mt-1">
              ₹ {overdueAmount.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-rose-500 font-semibold mt-1 block">
              {overdueInvoices.length} requires follow-up
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* FILTER AND SEARCH BAR WITH DEPARTMENT SCOPING */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search invoice #, customer, company, department..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Department Filter Dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400 hidden sm:inline-block">Department:</span>
              <div className="relative">
                <select
                  value={selectedDeptFilter}
                  onChange={e => setSelectedDeptFilter(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none cursor-pointer"
                >
                  <option value="all">All Departments ({invoices.length})</option>
                  <optgroup label="Wabastore">
                    <option value="wabastore-sales">Wabastore (Sales)</option>
                    <option value="wabastore-support">Wabastore (Support)</option>
                  </optgroup>
                  <optgroup label="Wabastar">
                    <option value="wabastar-sales">Wabastar (Sales)</option>
                    <option value="wabastar-support">Wabastar (Support)</option>
                  </optgroup>
                  <optgroup label="Whatsbox">
                    <option value="whatsbox-sales">Whatsbox (Sales)</option>
                    <option value="whatsbox-support">Whatsbox (Support)</option>
                  </optgroup>
                  <optgroup label="D-Talk Corporation">
                    <option value="dtalk-sales">D-Talk (Sales)</option>
                    <option value="dtalk-support">D-Talk (Support)</option>
                  </optgroup>
                  <optgroup label="Digitree Infotech">
                    <option value="digitree-sales">Digitree (Sales)</option>
                    <option value="digitree-support">Digitree (Support)</option>
                  </optgroup>
                  <optgroup label="M Pillar Corporation">
                    <option value="mpillar-sales">M Pillar (Sales)</option>
                    <option value="mpillar-support">M Pillar (Support)</option>
                  </optgroup>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={selectedStatusFilter}
                  onChange={e => setSelectedStatusFilter(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="Paid">Paid</option>
                  <option value="Pending">Pending</option>
                  <option value="Overdue">Overdue</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {(selectedDeptFilter !== 'all' || selectedStatusFilter !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setSelectedDeptFilter('all');
                  setSelectedStatusFilter('all');
                  setSearchQuery('');
                }}
                className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition-colors font-semibold"
              >
                Reset Filters
              </button>
            )}
          </div>

        </div>
      </div>

      {/* INVOICE TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[11px] font-bold text-slate-400 border-b border-slate-100 uppercase tracking-wider">
                <th className="py-3 pl-2 pr-3">Invoice #</th>
                <th className="py-3 pr-3">Department</th>
                <th className="py-3 pr-3">Customer &amp; Company</th>
                <th className="py-3 pr-3">Issue Date</th>
                <th className="py-3 pr-3">Due Date</th>
                <th className="py-3 pr-3">Amount</th>
                <th className="py-3 pr-3">Status</th>
                <th className="py-3 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredInvoices.map(inv => {
                const deptConf = getDepartmentConfig(inv.departmentId);
                return (
                  <tr
                    key={inv.id}
                    className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                    onClick={() => setSelectedInvoice(inv)}
                  >
                    {/* Invoice Number */}
                    <td className="py-3.5 pl-2 pr-3 font-mono font-bold text-blue-600 whitespace-nowrap">
                      {inv.invoiceNumber}
                    </td>

                    {/* Department Badge */}
                    <td className="py-3.5 pr-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        deptConf ? `${deptConf.badgeBg} ${deptConf.badgeText} ${deptConf.badgeBorder}` : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}>
                        <Building2 className="w-3 h-3 shrink-0" />
                        <span className="truncate max-w-[140px]">
                          {inv.departmentName || deptConf?.name || 'General Corporate'}
                        </span>
                      </span>
                    </td>

                    {/* Customer & Company */}
                    <td className="py-3.5 pr-3">
                      <div className="font-bold text-slate-900">{inv.company}</div>
                      <div className="text-[11px] text-slate-500">{inv.customerName}</div>
                    </td>

                    {/* Issue Date */}
                    <td className="py-3.5 pr-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                      {inv.issueDate}
                    </td>

                    {/* Due Date */}
                    <td className="py-3.5 pr-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                      {inv.dueDate}
                    </td>

                    {/* Amount */}
                    <td className="py-3.5 pr-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                      ₹ {inv.amount.toLocaleString('en-IN')}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 pr-3 whitespace-nowrap">
                      {getStatusBadge(inv.status)}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 pr-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => alert(`Downloading PDF for ${inv.invoiceNumber} (${inv.departmentName || 'Corporate'}).`)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title="Download PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => alert(`Official payment link for ${inv.invoiceNumber} copied to clipboard!`)}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title="Share Payment Link"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredInvoices.length === 0 && (
          <div className="text-center py-12 text-slate-400 font-mono text-xs">
            No invoices match the selected criteria.
          </div>
        )}
      </div>

      {/* =========================================================================
          CREATE INVOICE MODAL WITH MANDATORY DEPARTMENT SELECTION
          ========================================================================= */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 my-8">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-slate-900 font-heading">
                    Generate New Invoice
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Select department context to apply specific billing rates and templates.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Validation Error Banner */}
            {formError && (
              <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4 mt-4 text-xs font-sans">
              
              {/* Field 1: Customer Name */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">
                  Customer Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rajesh Mehra"
                  value={form.customerName}
                  onChange={e => {
                    setForm({ ...form, customerName: e.target.value });
                    setFormError(null);
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
                />
              </div>

              {/* Field 2: Company */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">
                  Company <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Titan Company Limited"
                  value={form.company}
                  onChange={e => {
                    setForm({ ...form, company: e.target.value });
                    setFormError(null);
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
                />
              </div>

              {/* Field 3: DEPARTMENT DROPDOWN (NEW & MANDATORY) */}
              <div>
                <label className="flex items-center gap-1.5 text-slate-800 font-bold mb-1 uppercase text-[11px]">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Select Department</span>
                  <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={form.departmentId}
                  onChange={e => handleDepartmentChange(e.target.value)}
                  className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900 font-medium cursor-pointer ${
                    !form.departmentId ? 'border-rose-300 text-slate-400' : 'border-slate-200'
                  }`}
                >
                  <option value="" disabled>Choose a department...</option>

                  <optgroup label="Wabastore">
                    <option value="wabastore-sales">Wabastore (Sales Division)</option>
                    <option value="wabastore-support">Wabastore (Support Division)</option>
                  </optgroup>

                  <optgroup label="Wabastar">
                    <option value="wabastar-sales">Wabastar (Sales Division)</option>
                    <option value="wabastar-support">Wabastar (Support Division)</option>
                  </optgroup>

                  <optgroup label="Whatsbox">
                    <option value="whatsbox-sales">Whatsbox (Sales Division)</option>
                    <option value="whatsbox-support">Whatsbox (Support Division)</option>
                  </optgroup>

                  <optgroup label="D-Talk Corporation">
                    <option value="dtalk-sales">D-Talk (Sales Division)</option>
                    <option value="dtalk-support">D-Talk (Support Division)</option>
                  </optgroup>

                  <optgroup label="Digitree Infotech">
                    <option value="digitree-sales">Digitree (Sales Division)</option>
                    <option value="digitree-support">Digitree (Support Division)</option>
                  </optgroup>

                  <optgroup label="M Pillar Corporation">
                    <option value="mpillar-sales">M Pillar (Sales Division)</option>
                    <option value="mpillar-support">M Pillar (Support Division)</option>
                  </optgroup>
                </select>

                {/* Selected Department Info Card */}
                {form.departmentId && (
                  <div className="mt-2 p-3 rounded-xl bg-blue-50/60 border border-blue-100 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800">
                          {SYSTEM_DEPARTMENTS.find(d => d.id === form.departmentId)?.name}
                        </span>
                        <span className="text-slate-500 block">
                          Prefix: <code className="font-mono text-blue-700">{SYSTEM_DEPARTMENTS.find(d => d.id === form.departmentId)?.prefix}XXX</code>
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-700 font-bold bg-emerald-100/70 px-2 py-0.5 rounded-full">
                      Terms Applied
                    </span>
                  </div>
                )}
              </div>

              {/* Field 4: Description / Item Service (Auto-filled with department standard) */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">
                  Service / Item Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Enterprise WhatsApp Storefront Engine"
                  value={form.itemDescription}
                  onChange={e => setForm({ ...form, itemDescription: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none text-slate-800"
                />
              </div>

              {/* Field 5: Amount & Due Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">
                    Amount (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={form.amount}
                    onChange={e => {
                      setForm({ ...form, amount: Number(e.target.value) });
                      setFormError(null);
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-mono text-slate-800"
                  />
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2"
                >
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>Create Invoice</span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          INVOICE PREVIEW MODAL WITH FULL DEPARTMENT CONTEXT
          ========================================================================= */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 my-8">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base text-blue-600">
                    {selectedInvoice.invoiceNumber}
                  </span>
                  {getStatusBadge(selectedInvoice.status)}
                </div>
                <h3 className="text-lg font-bold font-heading text-slate-900">
                  {selectedInvoice.company}
                </h3>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Department Context Card */}
            <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider">
                  ISSUING DEPARTMENT:
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-100/70 text-blue-800 font-semibold">
                  {selectedInvoice.division || 'Commercial Division'}
                </span>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">
                    {selectedInvoice.departmentName || 'Wabastore Sales OS'}
                  </h4>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono mt-0.5">
                    {selectedInvoice.contactEmail && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-400" />
                        {selectedInvoice.contactEmail}
                      </span>
                    )}
                    {selectedInvoice.contactPhone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {selectedInvoice.contactPhone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Customer & Dates Info */}
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Customer Name:</span>
                <span className="font-bold text-slate-900">{selectedInvoice.customerName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Issue Date:</span>
                <span className="font-mono text-slate-800">{selectedInvoice.issueDate}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Payment Due Date:</span>
                <span className="font-mono text-slate-800">{selectedInvoice.dueDate}</span>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="mt-4 border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-mono text-slate-500 uppercase border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Item / Service</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedInvoice.items && selectedInvoice.items.length > 0) ? (
                    selectedInvoice.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="py-2.5 px-3">
                          <strong className="text-slate-900 block">{item.description}</strong>
                          <span className="text-[10px] text-slate-400 font-mono">Qty: {item.quantity} &bull; SAC: 998314</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          ₹ {item.amount.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-2.5 px-3">
                        <strong className="text-slate-900 block">Department Commercial Services</strong>
                        <span className="text-[10px] text-slate-400 font-mono">SAC: 998314</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        ₹ {selectedInvoice.amount.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="p-3 bg-slate-50/70 border-t border-slate-200 flex justify-between items-center text-sm font-bold">
                <span className="text-slate-700">Total Billed:</span>
                <span className="font-mono text-blue-600 text-base">
                  ₹ {selectedInvoice.amount.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Terms and Conditions */}
            {selectedInvoice.terms && (
              <div className="mt-3 p-3 rounded-xl bg-amber-50/60 border border-amber-100 text-[11px] text-amber-900">
                <strong className="block mb-0.5">Department Terms:</strong>
                <p>{selectedInvoice.terms}</p>
              </div>
            )}

            {/* Modal Actions */}
            <div className="mt-5 flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 text-xs font-semibold"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  alert(`Printing official Tax Invoice ${selectedInvoice.invoiceNumber}...`);
                }}
                className="px-3.5 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5 text-slate-500" />
                <span>Print</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  alert(`Invoice ${selectedInvoice.invoiceNumber} PDF generated and downloaded.`);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
