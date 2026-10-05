import React, { useState } from 'react';
import {
  Receipt, DollarSign, Filter, Search, Plus, Calendar,
  Building2, CheckCircle2, ShieldCheck, Tag, ArrowRight,
  FileSpreadsheet, Download, RefreshCw, AlertCircle, Check,
  Copy, X, Trash2, ExternalLink, HelpCircle, Sparkles
} from 'lucide-react';
import {
  accountsStore,
  CorporateExpense
} from '../../../services/accountsStore';

export const ExpenseView: React.FC = () => {
  // Core Expenses state from accountsStore
  const [expenses, setExpenses] = useState<CorporateExpense[]>(() => accountsStore.getExpenses());
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Google Sheet integration state
  const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1J92L09UJQSu9yKsxf_gXzLwtYqJww9AN8j3kroeoocs/edit?gid=0#gid=0');
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Manual Expense Form State
  const [newDeptId, setNewDeptId] = useState('wabastore');
  const [newCategory, setNewCategory] = useState<CorporateExpense['category']>('Cloud & Server Infrastructure');
  const [newReason, setNewReason] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newPaymentMode, setNewPaymentMode] = useState('Corporate Wire (HDFC Current A/C)');
  const [newApprovedBy, setNewApprovedBy] = useState('Accounts Head (Rajiv Khanna)');
  const [newInvoiceRef, setNewInvoiceRef] = useState('');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const departmentsList = [
    { id: 'all', name: 'All Departments' },
    { id: 'wabastore', name: 'Wabastore' },
    { id: 'wabastar', name: 'Wabastar' },
    { id: 'whatsbox', name: 'Whatsbox' },
    { id: 'dtalk', name: 'D Talk Corporation' },
    { id: 'digitree', name: 'Digitree Infotech' },
    { id: 'mpillar', name: 'M Pillar Corporation' }
  ];

  const categoriesList: CorporateExpense['category'][] = [
    'Cloud & Server Infrastructure',
    'API Subscriptions & Telecom',
    'Software & SaaS Licenses',
    'Corporate Office & Facilities',
    'Payroll & Executive Compensation',
    'Client Acquisition & Ad Spend',
    'Legal, Compliance & Retainers',
    'Hardware & Workstations'
  ];

  // Helper function to extract fields from dynamic sheet row keys
  const getField = (row: Record<string, any>, candidateKeys: string[]): string => {
    if (!row || typeof row !== 'object') return '';
    const rowKeys = Object.keys(row);
    for (const cand of candidateKeys) {
      const cleanCand = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const k of rowKeys) {
        if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCand) {
          const val = row[k];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return String(val).trim();
          }
        }
      }
    }
    return '';
  };

  // Parse CSV text into array of row objects
  const parseCsvToObjects = (csvText: string): Record<string, any>[] => {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const parseLine = (line: string): string[] => {
      const values: string[] = [];
      let insideQuotes = false;
      let current = '';

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
          values.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim().replace(/^["']|["']$/g, ''));
      return values;
    };

    // Dynamically detect header row index (handles sheets with top title banners / report info at rows 1-6)
    let headerLineIdx = 0;
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const lower = lines[i].toLowerCase();
      if (
        (lower.includes('particular') || lower.includes('description') || lower.includes('expense') || lower.includes('item')) &&
        (lower.includes('amount') || lower.includes('type') || lower.includes('cost') || lower.includes('sr') || lower.includes('mode') || lower.includes('payment'))
      ) {
        headerLineIdx = i;
        break;
      }
    }

    const headers = parseLine(lines[headerLineIdx]);
    const rows: Record<string, any>[] = [];

    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      if (values.every(v => !v || v.trim() === '')) continue;

      const rowObj: Record<string, any> = {};
      headers.forEach((h, idx) => {
        if (h && h.trim()) {
          rowObj[h.trim()] = values[idx] || '';
        }
      });
      rows.push(rowObj);
    }
    return rows;
  };

  const normalizeDepartment = (input: string) => {
    const s = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.includes('wabastore') || s.includes('store')) return { id: 'wabastore', name: 'Wabastore' };
    if (s.includes('wabastar') || s.includes('star')) return { id: 'wabastar', name: 'Wabastar' };
    if (s.includes('whatsbox') || s.includes('box')) return { id: 'whatsbox', name: 'Whatsbox' };
    if (s.includes('dtalk') || s.includes('talk')) return { id: 'dtalk', name: 'D Talk Corporation' };
    if (s.includes('digitree') || s.includes('tree')) return { id: 'digitree', name: 'Digitree Infotech' };
    if (s.includes('mpillar') || s.includes('pillar')) return { id: 'mpillar', name: 'M Pillar Corporation' };
    return { id: 'wabastore', name: input || 'Wabastore' };
  };

  const normalizeCategory = (input: string): CorporateExpense['category'] => {
    const s = String(input || '').toLowerCase();
    if (s.includes('cloud') || s.includes('server') || s.includes('aws') || s.includes('host')) return 'Cloud & Server Infrastructure';
    if (s.includes('telecom') || s.includes('whatsapp') || s.includes('sms') || s.includes('rcs') || s.includes('waba') || s.includes('communication') || s.includes('mobile recharge') || s.includes('phone')) return 'API Subscriptions & Telecom';
    if (s.includes('software') || s.includes('saas') || s.includes('license') || s.includes('it & software') || s.includes('agency') || s.includes('panel') || s.includes('operation')) return 'Software & SaaS Licenses';
    if (s.includes('office') || s.includes('rent') || s.includes('premises') || s.includes('utilit') || s.includes('electric') || s.includes('water') || s.includes('welfare') || s.includes('tea') || s.includes('snack') || s.includes('facility')) return 'Corporate Office & Facilities';
    if (s.includes('salary') || s.includes('payroll') || s.includes('professional') || s.includes('employee') || s.includes('management') || s.includes('stipend') || s.includes('compensation')) return 'Payroll & Executive Compensation';
    if (s.includes('ad') || s.includes('marketing') || s.includes('campaign') || s.includes('acquisition') || s.includes('meta')) return 'Client Acquisition & Ad Spend';
    if (s.includes('legal') || s.includes('compliance') || s.includes('audit') || s.includes('tax') || s.includes('finance') || s.includes('emi') || s.includes('loan')) return 'Legal, Compliance & Retainers';
    if (s.includes('hardware') || s.includes('laptop') || s.includes('repair') || s.includes('maintenance') || s.includes('workstation') || s.includes('device') || s.includes('equipment')) return 'Hardware & Workstations';
    return 'Corporate Office & Facilities';
  };

  // Google Sheet Sync Handler
  const handleSyncGoogleSheet = async () => {
    const rawUrl = sheetUrl.trim();
    if (!rawUrl) {
      setSyncFeedback({
        type: 'error',
        message: 'Please paste your Google Sheet link or Apps Script Webhook URL.'
      });
      return;
    }

    setIsSyncingSheet(true);
    setSyncFeedback(null);

    try {
      let objects: Record<string, any>[] = [];

      // Check if it's a Google Sheet URL
      const sheetMatch = rawUrl.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (sheetMatch) {
        const sheetId = sheetMatch[1];
        let gid = '0';
        const gidMatch = rawUrl.match(/[#&?]gid=([0-9]+)/);
        if (gidMatch) gid = gidMatch[1];

        const csvExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

        let csvText = '';
        try {
          const res = await fetch(csvExportUrl);
          if (res.ok) {
            csvText = await res.text();
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch {
          // Fallback to proxy
          const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(csvExportUrl)}`);
          if (proxyRes.ok) {
            csvText = await proxyRes.text();
          } else {
            throw new Error('Unable to access Google Sheet. Please check permissions.');
          }
        }

        if (csvText.includes('accounts.google.com') || csvText.includes('ServiceLogin')) {
          setSyncFeedback({
            type: 'error',
            message: 'Google Sheet is Restricted. In Google Sheets, click "Share" -> set to "Anyone with the link (Viewer)".'
          });
          setIsSyncingSheet(false);
          return;
        }

        objects = parseCsvToObjects(csvText);
      } else {
        // Apps Script JSON endpoint
        let resData: any = null;
        try {
          const res = await fetch(rawUrl);
          resData = await res.json();
        } catch {
          const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(rawUrl)}`);
          resData = await proxyRes.json();
        }

        if (Array.isArray(resData)) {
          objects = resData;
        } else if (resData && Array.isArray(resData.expenses)) {
          objects = resData.expenses;
        } else if (resData && Array.isArray(resData.leads)) {
          objects = resData.leads;
        } else if (resData && Array.isArray(resData.data)) {
          objects = resData.data;
        }
      }

      if (!objects || objects.length === 0) {
        setSyncFeedback({
          type: 'info',
          message: 'Connected to Sheet successfully, but no expense rows were found.'
        });
        setIsSyncingSheet(false);
        return;
      }

      // Convert objects to CorporateExpense items
      const newExpenses: Array<Omit<CorporateExpense, 'id'>> = [];

      for (const row of objects) {
        const rawAmount = getField(row, ['amount', 'amountrs', 'amountinr', 'cost', 'total', 'price', 'spend', 'rs', 'inr', 'value']);
        const cleanAmountStr = String(rawAmount || '0').replace(/[^0-9.-]/g, '');
        const amount = parseFloat(cleanAmountStr);
        if (isNaN(amount) || amount <= 0) continue;

        const description = getField(row, [
          'expenseparticular', 'particular', 'particulars', 'item', 'description', 'reason',
          'expense', 'corporate_reason', 'notes', 'title', 'details', 'name'
        ]) || 'Operational Expense';

        const rawDept = getField(row, ['department', 'dept', 'store', 'unit', 'business_unit']) || 'wabastore';
        const dept = normalizeDepartment(rawDept);

        const rawCat = getField(row, ['expensetype', 'category', 'type', 'expense_type', 'tag']);
        const category = normalizeCategory(rawCat || description);

        const rawDate = getField(row, ['date', 'timestamp', 'day', 'created_at']);
        const date = rawDate ? new Date(rawDate).toISOString().split('T')[0] : '2026-04-01';

        const paymentMode = getField(row, ['paymentmode', 'payment', 'mode', 'method', 'account']) || 'IMPS';
        const approvedBy = getField(row, ['approvedby', 'approver', 'manager', 'approved', 'preparedby']) || 'Accounts Department';
        const invoiceRef = getField(row, ['invoiceref', 'ref', 'po', 'voucher', 'bill_no', 'srno']) || `EXP-APR-${Math.floor(1000 + Math.random() * 9000)}`;

        newExpenses.push({
          departmentId: dept.id,
          departmentName: dept.name,
          category,
          corporateReason: description,
          amount,
          date,
          paymentMode,
          approvedBy,
          invoiceRef,
          status: 'Settled'
        });
      }

      if (newExpenses.length === 0) {
        setSyncFeedback({
          type: 'info',
          message: 'Found rows in sheet, but could not detect valid amount or description columns.'
        });
        setIsSyncingSheet(false);
        return;
      }

      const count = accountsStore.importExpenses(newExpenses);
      setExpenses(accountsStore.getExpenses());
      setSyncFeedback({
        type: 'success',
        message: `Successfully synchronized and imported ${count} expense(s) from Google Sheet!`
      });
    } catch (err: any) {
      setSyncFeedback({
        type: 'error',
        message: `Sync failed: ${err.message || 'Please verify sheet URL and sharing settings.'}`
      });
    } finally {
      setIsSyncingSheet(false);
    }
  };

  // Delete an individual expense
  const handleDeleteExpense = (id: string) => {
    accountsStore.deleteExpense(id);
    setExpenses(accountsStore.getExpenses());
  };

  // Reset to default demo data
  const handleResetToDefault = () => {
    if (window.confirm('Reset all expenses back to default initial records?')) {
      accountsStore.resetExpensesToDefault();
      setExpenses(accountsStore.getExpenses());
      setSyncFeedback({
        type: 'info',
        message: 'Reset expenses to default initial records.'
      });
    }
  };

  // Manual Create Expense Handler
  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReason || !newAmount) return;

    const deptObj = departmentsList.find(d => d.id === newDeptId);
    accountsStore.addCorporateExpense({
      departmentId: newDeptId,
      departmentName: deptObj?.name || 'Wabastore',
      category: newCategory,
      corporateReason: newReason,
      amount: parseFloat(newAmount),
      date: new Date().toISOString().split('T')[0],
      paymentMode: newPaymentMode,
      approvedBy: newApprovedBy,
      invoiceRef: newInvoiceRef || `EXP-${Math.floor(1000 + Math.random() * 9000)}`,
      status: 'Settled'
    });

    setExpenses(accountsStore.getExpenses());
    setShowAddModal(false);
    setNewReason('');
    setNewAmount('');
    setNewInvoiceRef('');
  };

  // Filtering
  const filteredExpenses = expenses.filter(exp => {
    const matchDept = selectedDept === 'all' || exp.departmentId === selectedDept;
    const matchCat = selectedCategory === 'all' || exp.category === selectedCategory;
    const matchSearch =
      searchQuery === '' ||
      exp.corporateReason.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.departmentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.invoiceRef.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchDept && matchCat && matchSearch;
  });

  const totalFilteredAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalAllAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  const totalSettledAmount = expenses.filter(e => e.status === 'Settled').reduce((sum, e) => sum + e.amount, 0);

  const sampleAppsScriptCode = `/**
 * Google Apps Script to automatically push new expense rows to your CRM
 */
const WEBHOOK_URL = "https://ai-crm-drab.vercel.app/api/webhook";

function onEdit(e) {
  if (!e || !e.range) return;
  const row = e.range.getRow();
  if (row <= 1) return; // Skip headers

  const sheet = e.range.getSheet();
  const rowData = sheet.getRange(row, 1, 1, 7).getValues()[0];
  
  // Format: [Department, Description, Category, Amount, Date, PaymentMode, ApprovedBy]
  const department = rowData[0];
  const description = rowData[1];
  const category = rowData[2];
  const amount = rowData[3];
  
  if (!description || !amount) return;

  const payload = {
    department: department || "Wabastore",
    description: description,
    category: category || "Operational",
    amount: amount,
    date: rowData[4] || new Date().toISOString().split('T')[0],
    payment_mode: rowData[5] || "Corporate Wire",
    approved_by: rowData[6] || "Accounts Head"
  };

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}`;

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      {/* =========================================================================
          PAGE HEADER
          ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
              <Receipt className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-extrabold font-heading text-slate-900 tracking-tight">
                  Expenses
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-100 text-rose-700">
                  {expenses.length} Records
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Track, record, and synchronize operational and departmental expenses across all business units.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGuideModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono font-bold text-xs transition-all cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            <span>Sheet Guide</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>Record Expense</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          GOOGLE SHEET CONNECTOR BAR
          ========================================================================= */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-800">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Attach &amp; Sync Google Sheet</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              Live Ingest
            </span>
          </div>

          <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
            <span>Make sheet link shared as "Anyone with link (Viewer)"</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <FileSpreadsheet className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Paste Google Sheet URL (https://docs.google.com/spreadsheets/d/...)"
              value={sheetUrl}
              onChange={e => setSheetUrl(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-emerald-500 text-slate-900 placeholder:text-slate-400"
            />
          </div>

          <button
            onClick={handleSyncGoogleSheet}
            disabled={isSyncingSheet}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-mono font-bold text-xs shadow-xs transition-all cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
            <span>{isSyncingSheet ? 'Syncing Sheet...' : 'Sync from Google Sheet'}</span>
          </button>
        </div>

        {/* Sync Feedback Alert */}
        {syncFeedback && (
          <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-2 animate-fade-in ${
            syncFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : syncFeedback.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            <div className="flex items-center gap-2">
              {syncFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{syncFeedback.message}</span>
            </div>
            <button
              onClick={() => setSyncFeedback(null)}
              className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* =========================================================================
          KPI SUMMARY CARDS
          ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Spend */}
        <div className="p-5 rounded-2xl bg-rose-50/70 border border-rose-200/80 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-rose-800">
            <span className="text-xs font-mono font-bold uppercase tracking-wider">Total Expenses</span>
            <Receipt className="w-4 h-4 text-rose-600" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold font-mono text-rose-950 pt-1">
            {formatCurrency(totalAllAmount)}
          </h3>
          <p className="text-xs text-rose-700 font-mono">
            Across {expenses.length} total entries
          </p>
        </div>

        {/* Card 2: Settled & Paid */}
        <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-emerald-800">
            <span className="text-xs font-mono font-bold uppercase tracking-wider">Settled &amp; Paid</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold font-mono text-emerald-950 pt-1">
            {formatCurrency(totalSettledAmount)}
          </h3>
          <p className="text-xs text-emerald-700 font-mono">
            Fully audited &amp; accounted
          </p>
        </div>

        {/* Card 3: Filtered Total */}
        <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-200/80 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-blue-800">
            <span className="text-xs font-mono font-bold uppercase tracking-wider">Filtered View Total</span>
            <DollarSign className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold font-mono text-blue-950 pt-1">
            {formatCurrency(totalFilteredAmount)}
          </h3>
          <p className="text-xs text-blue-700 font-mono">
            {filteredExpenses.length} matching entries
          </p>
        </div>

        {/* Card 4: Active Categories */}
        <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200/80 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-amber-800">
            <span className="text-xs font-mono font-bold uppercase tracking-wider">Categories</span>
            <Building2 className="w-4 h-4 text-amber-600" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold font-mono text-amber-950 pt-1">
            {categoriesList.length} Types
          </h3>
          <p className="text-xs text-amber-700 font-mono">
            Across 6 operating departments
          </p>
        </div>

      </div>

      {/* =========================================================================
          FILTER AND SEARCH BAR
          ========================================================================= */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        
        {/* Department Buttons Row */}
        <div>
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-2">
            DEPARTMENT:
          </span>
          <div className="flex flex-wrap gap-2">
            {departmentsList.map(dept => (
              <button
                key={dept.id}
                onClick={() => setSelectedDept(dept.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                  selectedDept === dept.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {dept.name}
              </button>
            ))}
          </div>
        </div>

        {/* Category & Search Row */}
        <div className="flex flex-col md:flex-row gap-3 pt-3 border-t border-slate-100 items-stretch md:items-center justify-between">
          
          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
            <span className="text-xs font-mono text-slate-400 shrink-0">Category:</span>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:border-slate-400 cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categoriesList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search reason, invoice ref, category..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-slate-400 text-slate-900"
              />
            </div>

            <button
              onClick={handleResetToDefault}
              title="Reset to default initial records"
              className="px-3 py-2 rounded-xl text-xs font-mono font-medium text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer shrink-0"
            >
              Reset
            </button>
          </div>

        </div>

      </div>

      {/* =========================================================================
      {/* =========================================================================
          EXPENSES TABLE - AMUWA CORPORATION EXPENSE REGISTER
          ========================================================================= */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        
        {/* Register Banner */}
        <div className="bg-slate-900 text-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <h2 className="text-base sm:text-lg font-bold font-heading tracking-wide uppercase">
                AMUWA CORPORATION &ndash; EXPENSE REGISTER
              </h2>
            </div>
            <p className="text-xs text-slate-300 font-mono mt-0.5">
              Office Expense Report &bull; Accounts / Management &bull; Report Period: Apr 2026
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
              Department: Accounts / Management
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-mono text-slate-700 uppercase tracking-wider">
                <th className="py-3.5 px-4 text-center w-16">Sr. No.</th>
                <th className="py-3.5 px-4 w-28">Date</th>
                <th className="py-3.5 px-6">Expense Particular</th>
                <th className="py-3.5 px-5">Expense Type</th>
                <th className="py-3.5 px-5 text-right">Amount (₹)</th>
                <th className="py-3.5 px-4">Payment Mode</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-center w-16">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-sans">
              {filteredExpenses.length > 0 ? (
                filteredExpenses.map((exp, idx) => (
                  <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors group">
                    
                    {/* 1. Sr. No. */}
                    <td className="py-3.5 px-4 font-mono text-slate-400 font-bold text-center">
                      {idx + 1}
                    </td>

                    {/* 2. Date */}
                    <td className="py-3.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {exp.date}
                    </td>

                    {/* 3. Expense Particular */}
                    <td className="py-3.5 px-6 font-medium text-slate-900">
                      <div className="font-semibold text-slate-900 leading-snug">
                        {exp.corporateReason}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        Ref: {exp.invoiceRef}
                      </span>
                    </td>

                    {/* 4. Expense Type */}
                    <td className="py-3.5 px-5 whitespace-nowrap">
                      <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                        {exp.category}
                      </span>
                    </td>

                    {/* 5. Amount */}
                    <td className="py-3.5 px-5 text-right font-mono font-bold text-rose-700 text-sm whitespace-nowrap">
                      {exp.amount > 0 ? formatCurrency(exp.amount) : '—'}
                    </td>

                    {/* 6. Payment Mode */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                        {exp.paymentMode}
                      </span>
                    </td>

                    {/* 7. Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                        exp.status === 'Settled'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        <ShieldCheck className="w-3 h-3" />
                        {exp.status}
                      </span>
                    </td>

                    {/* 8. Action */}
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => handleDeleteExpense(exp.id)}
                        title="Delete expense entry"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>

                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-medium text-slate-600">No expenses found matching your filter criteria.</p>
                    <p className="text-xs text-slate-400 mt-1">Try clearing your search query or sync new rows from Google Sheet.</p>
                  </td>
                </tr>
              )}
            </tbody>
            {filteredExpenses.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-mono font-bold text-slate-900">
                  <td colSpan={4} className="py-4 px-6 text-right uppercase tracking-wider text-xs text-slate-600">
                    TOTAL AUDITED EXPENSES:
                  </td>
                  <td className="py-4 px-5 text-right text-rose-700 text-base font-extrabold whitespace-nowrap">
                    {formatCurrency(totalFilteredAmount)}
                  </td>
                  <td colSpan={3} className="py-4 px-4 text-slate-400 text-xs font-normal">
                    {filteredExpenses.length} Register Records Verified
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* =========================================================================
          RECORD EXPENSE MODAL
          ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">Record Expense</h3>
                  <p className="text-xs text-slate-500">Record a new departmental operational expense</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Department
                  </label>
                  <select
                    value={newDeptId}
                    onChange={e => setNewDeptId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:border-slate-400 cursor-pointer"
                  >
                    {departmentsList.filter(d => d.id !== 'all').map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Category
                  </label>
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:border-slate-400 cursor-pointer"
                  >
                    {categoriesList.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                  Reason / Description *
                </label>
                <textarea
                  required
                  rows={2}
                  value={newReason}
                  onChange={e => setNewReason(e.target.value)}
                  placeholder="e.g. AWS Multi-AZ Cloud Database hosting renewal for e-commerce API"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-slate-400 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newAmount}
                    onChange={e => setNewAmount(e.target.value)}
                    placeholder="e.g. 45000"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-slate-400 text-slate-900"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Invoice / PO Ref
                  </label>
                  <input
                    type="text"
                    value={newInvoiceRef}
                    onChange={e => setNewInvoiceRef(e.target.value)}
                    placeholder="e.g. PO-CORP-8821"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-slate-400 text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Payment Mode
                  </label>
                  <input
                    type="text"
                    value={newPaymentMode}
                    onChange={e => setNewPaymentMode(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-slate-400 text-slate-900"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Approved By
                  </label>
                  <input
                    type="text"
                    value={newApprovedBy}
                    onChange={e => setNewApprovedBy(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-slate-400 text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-mono font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-mono font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          GOOGLE SHEET GUIDE MODAL
          ========================================================================= */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">How to Attach Google Sheet</h3>
                  <p className="text-xs text-slate-500">2 easy methods: 1-Click Link Sync or Automatic Apps Script</p>
                </div>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-6 pt-5 text-xs text-slate-600 font-sans">
              
              {/* Method 1 */}
              <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200/70 space-y-2">
                <div className="flex items-center gap-2 text-emerald-900 font-bold font-heading text-sm">
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">1</span>
                  <span>Method 1: Direct 1-Click Sheet Sync (Recommended)</span>
                </div>
                <p className="leading-relaxed">
                  You can paste your Google Sheet link directly into the connector bar on this page!
                </p>
                <div className="space-y-1.5 pt-1 font-mono text-[11px] text-emerald-800">
                  <p>1. In your Google Sheet, click <strong>Share</strong> (top right).</p>
                  <p>2. Under <em>General access</em>, change to: <strong>"Anyone with the link"</strong> set to <strong>Viewer</strong>.</p>
                  <p>3. Copy the URL from your browser address bar.</p>
                  <p>4. Paste it into the <em>Attach &amp; Sync Google Sheet</em> input above and click <strong>Sync from Google Sheet</strong>.</p>
                </div>
              </div>

              {/* Required Columns Structure */}
              <div className="space-y-2.5">
                <h4 className="font-bold font-heading text-slate-900 text-sm">
                  Recommended Google Sheet Column Headers (Row 1):
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden font-mono text-[11px]">
                  <table className="w-full text-left">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="p-2.5">Col A</th>
                        <th className="p-2.5">Col B</th>
                        <th className="p-2.5">Col C</th>
                        <th className="p-2.5">Col D</th>
                        <th className="p-2.5">Col E</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr className="bg-white">
                        <td className="p-2.5 font-bold text-slate-900">Department</td>
                        <td className="p-2.5 font-bold text-slate-900">Description</td>
                        <td className="p-2.5 font-bold text-slate-900">Category</td>
                        <td className="p-2.5 font-bold text-slate-900">Amount</td>
                        <td className="p-2.5 font-bold text-slate-900">Date</td>
                      </tr>
                      <tr className="bg-slate-50 text-slate-500">
                        <td className="p-2.5">Wabastore</td>
                        <td className="p-2.5">AWS Server hosting</td>
                        <td className="p-2.5">Cloud &amp; Server</td>
                        <td className="p-2.5">45000</td>
                        <td className="p-2.5">2026-10-05</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400">
                  <em>Note: Headers are flexible (e.g., "Reason" or "Particulars" works for Description, "Cost" works for Amount).</em>
                </p>
              </div>

              {/* Method 2: Apps script */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-900 font-bold font-heading text-sm">
                    <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">2</span>
                    <span>Method 2: Automatic Webhook on Edit (Google Apps Script)</span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(sampleAppsScriptCode);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Script'}</span>
                  </button>
                </div>
                <p className="text-slate-500">
                  In Google Sheets: go to <strong>Extensions &gt; Apps Script</strong>, paste the script below, and save:
                </p>
                <pre className="p-3 bg-slate-950 text-slate-200 rounded-xl font-mono text-[10px] overflow-x-auto leading-relaxed">
                  {sampleAppsScriptCode}
                </pre>
              </div>

            </div>

            <div className="pt-5 mt-4 flex items-center justify-end border-t border-slate-100">
              <button
                onClick={() => setShowGuideModal(false)}
                className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-mono font-bold cursor-pointer"
              >
                Close Guide
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
