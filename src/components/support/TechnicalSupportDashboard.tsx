import React, { useState, useEffect, useRef } from 'react';
import {
  Users, UserCheck, ShieldCheck, Plus, CheckCircle2,
  Clock, ArrowRight, Search, Trash2, Phone, Mail, Building2,
  Tag, Sparkles, X, Check, AlertCircle, LogOut, RefreshCw,
  Layers, ExternalLink, UserPlus, DollarSign,
  FileText, Upload, Download, Eye, FileCheck
} from 'lucide-react';
import {
  technicalSupportStore,
  TechSupportLead,
  TechSupportContact,
  TechSupportCustomer,
  TechSupportInvoice
} from '../../services/technicalSupportStore';
import {
  generateOfficialInvoicePdf,
  readUploadedPdfFile,
  openPdfInNewTab,
  downloadPdfFile
} from '../../utils/invoicePdfGenerator';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { OnboardingVerificationWorkspace } from '../team-member/pipeline/VerificationViews';

interface TechnicalSupportDashboardProps {
  currentUserId?: string;
  userName?: string;
  onLogout?: () => void;
}

const COMMON_SERVICES = [
  'WhatsApp Business API',
  'Webhooks & Endpoints',
  'Chatbot & Automation',
  'RCS Messaging',
  'Catalog Commerce',
  'Meta Cloud API Onboarding',
  'Custom Technical Support'
];

export const TechnicalSupportDashboard: React.FC<TechnicalSupportDashboardProps> = ({
  currentUserId = 'EMP-2034',
  userName = 'Rohan Mehta',
  onLogout
}) => {
  const { logout, user } = useAuth();

  // Navigation tab: 'leads' | 'contacts' | 'customers'
  const [activeTab, setActiveTab] = useState<'verification' | 'leads' | 'contacts' | 'customers'>('verification');

  // Real-time store state (STRICTLY ZERO DUMMY DATA)
  const [leads, setLeads] = useState<TechSupportLead[]>(() => technicalSupportStore.getLeads());
  const [contacts, setContacts] = useState<TechSupportContact[]>(() => technicalSupportStore.getContacts());
  const [customers, setCustomers] = useState<TechSupportCustomer[]>(() => technicalSupportStore.getCustomers());

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [convertTarget, setConvertTarget] = useState<{
    type: 'lead' | 'contact';
    item: TechSupportLead | TechSupportContact;
  } | null>(null);

  // Add Lead Form State
  const [formName, setFormName] = useState('');
  const [formBusinessName, setFormBusinessName] = useState('');
  const [formSelectedServices, setFormSelectedServices] = useState<string[]>(['WhatsApp Business API']);
  const [formCustomService, setFormCustomService] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Convert to Customer Form State
  const [convertPaymentAmount, setConvertPaymentAmount] = useState<string>('');
  const [convertPaymentMode, setConvertPaymentMode] = useState('UPI / Bank Transfer');
  const [invoiceNumberInput, setInvoiceNumberInput] = useState('');
  const [attachedInvoice, setAttachedInvoice] = useState<TechSupportInvoice | null>(null);
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Invoice viewer modal state (for customers tab)
  const [viewingCustomerInvoice, setViewingCustomerInvoice] = useState<TechSupportCustomer | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Sync state on store changes
  useEffect(() => {
    const handleStoreChange = () => {
      setLeads(technicalSupportStore.getLeads());
      setContacts(technicalSupportStore.getContacts());
      setCustomers(technicalSupportStore.getCustomers());
    };

    window.addEventListener('tech_support_data_changed', handleStoreChange);
    return () => window.removeEventListener('tech_support_data_changed', handleStoreChange);
  }, []);

  const refreshAll = () => {
    setLeads(technicalSupportStore.getLeads());
    setContacts(technicalSupportStore.getContacts());
    setCustomers(technicalSupportStore.getCustomers());
  };

  // Toggle service chip in Add Lead modal
  const handleToggleService = (svc: string) => {
    if (formSelectedServices.includes(svc)) {
      setFormSelectedServices(formSelectedServices.filter(s => s !== svc));
    } else {
      setFormSelectedServices([...formSelectedServices, svc]);
    }
  };

  // Add Custom Service chip
  const handleAddCustomService = () => {
    const trimmed = formCustomService.trim();
    if (trimmed && !formSelectedServices.includes(trimmed)) {
      setFormSelectedServices([...formSelectedServices, trimmed]);
      setFormCustomService('');
    }
  };

  // Submit Add Lead Form
  const handleCreateLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formBusinessName.trim()) return;

    const newLead = technicalSupportStore.addLead({
      name: formName.trim(),
      businessName: formBusinessName.trim(),
      services: formSelectedServices.length > 0 ? formSelectedServices : ['Technical Support'],
      phone: formPhone.trim(),
      email: formEmail.trim(),
      notes: formNotes.trim()
    });

    refreshAll();
    setShowAddLeadModal(false);
    // Reset Form
    setFormName('');
    setFormBusinessName('');
    setFormSelectedServices(['WhatsApp Business API']);
    setFormCustomService('');
    setFormPhone('');
    setFormEmail('');
    setFormNotes('');

    showToast(`Lead "${newLead.name}" (${newLead.businessName}) added successfully!`);
  };

  // Move Lead -> Contact (Potential Customer - Payment Pending)
  const handleMoveToContact = (leadId: string, leadName: string) => {
    const contact = technicalSupportStore.convertToContact(leadId);
    if (contact) {
      refreshAll();
      showToast(`Moved "${leadName}" to Potential Contacts (Payment Pending)!`, 'info');
    }
  };

  // Open convert modal with clean invoice initialization
  const handleOpenConvertModal = (type: 'lead' | 'contact', item: TechSupportLead | TechSupportContact) => {
    setConvertTarget({ type, item });
    const expected = type === 'contact' ? (item as TechSupportContact).expectedAmount : undefined;
    setConvertPaymentAmount(expected ? String(expected) : '');
    setConvertPaymentMode('UPI / QR');
    const autoNum = `INV-TS-${Date.now().toString().slice(-5)}`;
    setInvoiceNumberInput(autoNum);
    setAttachedInvoice(null);
  };

  // Upload PDF Handler
  const handleFileUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsReadingPdf(true);
    try {
      const inv = await readUploadedPdfFile(file, invoiceNumberInput.trim() || undefined);
      setAttachedInvoice({
        invoiceNumber: inv.invoiceNumber,
        fileName: inv.fileName,
        fileSize: inv.fileSize,
        dataUrl: inv.dataUrl,
        uploadedAt: new Date().toISOString()
      });
      showToast(`Invoice PDF "${inv.fileName}" attached successfully!`);
    } catch (err: any) {
      showToast(err.message || 'Failed to read PDF file', 'info');
    } finally {
      setIsReadingPdf(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 1-Click Auto-Generate PDF Invoice
  const handleAutoGenerateInvoice = () => {
    if (!convertTarget) return;
    const num = invoiceNumberInput.trim() || `INV-TS-${Date.now().toString().slice(-5)}`;
    const amt = convertPaymentAmount ? parseFloat(convertPaymentAmount) : 0;
    const generated = generateOfficialInvoicePdf({
      invoiceNumber: num,
      customerName: convertTarget.item.name,
      businessName: convertTarget.item.businessName,
      services: convertTarget.item.services,
      amount: amt,
      paymentMode: convertPaymentMode,
      dateStr: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    });
    setAttachedInvoice({
      invoiceNumber: num,
      fileName: generated.fileName,
      fileSize: generated.fileSize,
      dataUrl: generated.dataUrl,
      uploadedAt: new Date().toISOString()
    });
    showToast(`Official PDF Invoice "${generated.fileName}" generated!`);
  };

  // Confirm Convert to Customer (Payment Done & PDF Invoice saved)
  const handleConfirmConvertToCustomer = () => {
    if (!convertTarget) return;

    const amount = convertPaymentAmount ? parseFloat(convertPaymentAmount) : undefined;

    // Use attached invoice, or auto-generate on the fly if user didn't attach one
    let finalInvoice = attachedInvoice;
    if (!finalInvoice) {
      const num = invoiceNumberInput.trim() || `INV-TS-${Date.now().toString().slice(-5)}`;
      const gen = generateOfficialInvoicePdf({
        invoiceNumber: num,
        customerName: convertTarget.item.name,
        businessName: convertTarget.item.businessName,
        services: convertTarget.item.services,
        amount: amount || 0,
        paymentMode: convertPaymentMode,
        dateStr: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      });
      finalInvoice = {
        invoiceNumber: num,
        fileName: gen.fileName,
        fileSize: gen.fileSize,
        dataUrl: gen.dataUrl,
        uploadedAt: new Date().toISOString()
      };
    }

    if (convertTarget.type === 'lead') {
      technicalSupportStore.convertToCustomerFromLead(
        convertTarget.item.id,
        amount,
        convertPaymentMode,
        finalInvoice
      );
    } else {
      technicalSupportStore.convertToCustomerFromContact(
        convertTarget.item.id,
        amount,
        convertPaymentMode,
        finalInvoice
      );
    }

    refreshAll();
    const name = convertTarget.item.name;
    const biz = convertTarget.item.businessName;
    setConvertTarget(null);
    setConvertPaymentAmount('');
    setAttachedInvoice(null);
    showToast(`🎉 "${name}" (${biz}) converted to Paid Customer with Invoice PDF attached!`);
  };

  // Deletions
  const handleDeleteLead = (id: string, name: string) => {
    if (window.confirm(`Delete lead "${name}"?`)) {
      technicalSupportStore.deleteLead(id);
      refreshAll();
    }
  };

  const handleDeleteContact = (id: string, name: string) => {
    if (window.confirm(`Delete contact "${name}"?`)) {
      technicalSupportStore.deleteContact(id);
      refreshAll();
    }
  };

  const handleDeleteCustomer = (id: string, name: string) => {
    if (window.confirm(`Delete customer "${name}"?`)) {
      technicalSupportStore.deleteCustomer(id);
      refreshAll();
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  // Filtered queries
  const q = searchQuery.toLowerCase().trim();
  const filteredLeads = leads.filter(l =>
    !q ||
    l.name.toLowerCase().includes(q) ||
    l.businessName.toLowerCase().includes(q) ||
    l.services.some(s => s.toLowerCase().includes(q))
  );

  const filteredContacts = contacts.filter(c =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    c.businessName.toLowerCase().includes(q) ||
    c.services.some(s => s.toLowerCase().includes(q))
  );

  const filteredCustomers = customers.filter(c =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    c.businessName.toLowerCase().includes(q) ||
    c.services.some(s => s.toLowerCase().includes(q))
  );

  const handleLogout = () => {
    if (onLogout) onLogout();
    else logout();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans antialiased">
      
      {/* =========================================================================
          TOP PERSISTENT HEADER
          ========================================================================= */}
      <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <AmuwaLogo size="sm" />
          <div className="h-5 w-px bg-slate-200 hidden sm:block" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-heading font-extrabold text-sm sm:text-base text-slate-900 tracking-tight">
                Wabastore Support
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-pink-100 text-pink-700 border border-pink-200">
                Technical Support
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono hidden sm:block">
              Team Member Dashboard &bull; Position: Technical Support
            </p>
          </div>
        </div>

        {/* User Badge & Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 text-xs">
            <div className="w-7 h-7 rounded-lg bg-pink-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
              {userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="text-left hidden md:block">
              <p className="font-semibold text-slate-900 leading-tight">{userName}</p>
              <p className="text-[10px] text-slate-500 font-mono">techsupport@wabastore.com</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Log Out of Technical Support"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-bold text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* =========================================================================
          MAIN CONTAINER WITH 3-TAB SIDE PANEL
          ========================================================================= */}
      <div className="flex-1 flex flex-col md:flex-row">
        
        {/* =========================================================================
            SIDE PANEL (EXACTLY 3 ITEMS: LEADS, CONTACTS, CUSTOMERS)
            ========================================================================= */}
        <aside className="w-full md:w-64 bg-white border-r border-slate-200 p-4 md:p-5 flex flex-col justify-between shrink-0">
          <div className="space-y-4">
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400 block px-2 mb-2">
                SUPPORT PIPELINE (3 TIERS)
              </span>

              <nav className="space-y-1.5 font-mono text-xs font-bold">
                
                {/* Onboarding verification (database-backed) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('verification')}
                  aria-current={activeTab === 'verification' ? 'page' : undefined}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl transition-all cursor-pointer ${
                    activeTab === 'verification' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className={`w-4 h-4 ${activeTab === 'verification' ? 'text-indigo-300' : 'text-slate-500'}`} />
                    <span>Onboarding verification</span>
                  </div>
                </button>

                {/* 1. Leads */}
                <button
                  type="button"
                  onClick={() => setActiveTab('leads')}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl transition-all cursor-pointer ${
                    activeTab === 'leads'
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <UserPlus className={`w-4 h-4 ${activeTab === 'leads' ? 'text-pink-400' : 'text-slate-500'}`} />
                    <span>1. Leads</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'leads' ? 'bg-slate-800 text-pink-300' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {leads.length}
                  </span>
                </button>

                {/* 2. Contacts (Potential Customers - Payment Pending) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('contacts')}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl transition-all cursor-pointer ${
                    activeTab === 'contacts'
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Clock className={`w-4 h-4 ${activeTab === 'contacts' ? 'text-amber-400' : 'text-slate-500'}`} />
                    <span>2. Contacts</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'contacts' ? 'bg-slate-800 text-amber-300' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {contacts.length}
                  </span>
                </button>

                {/* 3. Customers (Payment Done) */}
                <button
                  type="button"
                  onClick={() => setActiveTab('customers')}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl transition-all cursor-pointer ${
                    activeTab === 'customers'
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className={`w-4 h-4 ${activeTab === 'customers' ? 'text-emerald-400' : 'text-slate-500'}`} />
                    <span>3. Customers</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'customers' ? 'bg-slate-800 text-emerald-300' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {customers.length}
                  </span>
                </button>

              </nav>
            </div>

            {/* Quick Helper Info */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-sans space-y-1.5">
              <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-pink-500" />
                Pipeline Logic
              </p>
              <p className="text-[10px] text-slate-500 leading-snug">
                &bull; <strong>Leads:</strong> Add inquiries manually.<br />
                &bull; <strong>Contacts:</strong> Potential customers with payment pending.<br />
                &bull; <strong>Customers:</strong> Completed payments.
              </p>
            </div>
          </div>

          {/* Sub-department footer tag */}
          <div className="pt-4 mt-4 border-t border-slate-100 text-[10px] font-mono text-slate-400">
            <span>Sub-Department: Wabastore Support</span>
          </div>
        </aside>

        {/* =========================================================================
            MAIN WORKSPACE CONTENT AREA
            ========================================================================= */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto max-w-6xl w-full mx-auto space-y-6">
          
          {/* Toast Notification Banner */}
          {toastMessage && (
            <div className={`p-3.5 rounded-2xl border text-xs font-mono flex items-center justify-between shadow-md animate-fade-in ${
              toastMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{toastMessage.text}</span>
              </div>
              <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {activeTab === 'verification' && <OnboardingVerificationWorkspace />}

          {activeTab !== 'verification' && (
          <>
          {/* Search Box Bar */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, business name, services..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-pink-500 text-slate-900 placeholder:text-slate-400"
              />
            </div>

            {/* If on Leads tab, show prominent '+ Add Lead' button right here */}
            {activeTab === 'leads' && (
              <button
                type="button"
                onClick={() => setShowAddLeadModal(true)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-mono font-bold text-xs shadow-sm transition-all active:scale-95 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add Lead (Manual)</span>
              </button>
            )}
          </div>

          </>
          )}

          {/* =========================================================================
              VIEW 1: LEADS VIEW
              ========================================================================= */}
          {activeTab === 'leads' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-pink-600" />
                    <span>Technical Support Leads</span>
                    <span className="text-xs font-mono font-semibold text-slate-500">
                      ({filteredLeads.length} total)
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Manually add new inquiries and qualify them into contacts or convert to customers.
                  </p>
                </div>
              </div>

              {/* Leads Table */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                        <th className="py-3.5 px-5">Name</th>
                        <th className="py-3.5 px-5">Business Name</th>
                        <th className="py-3.5 px-6">Services</th>
                        <th className="py-3.5 px-4">Contact</th>
                        <th className="py-3.5 px-5 text-right">Convert / Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-sans">
                      {filteredLeads.length > 0 ? (
                        filteredLeads.map((lead) => (
                          <tr key={lead.id} className="hover:bg-slate-50/70 transition-colors group">
                            
                            {/* 1. Name */}
                            <td className="py-3.5 px-5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-700 flex items-center justify-center font-bold text-xs shrink-0">
                                  {lead.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-900 block">{lead.name}</span>
                                  <span className="text-[10px] font-mono text-slate-400">ID: {lead.id}</span>
                                </div>
                              </div>
                            </td>

                            {/* 2. Business Name */}
                            <td className="py-3.5 px-5">
                              <div className="flex items-center gap-1.5 font-medium text-slate-800">
                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                <span>{lead.businessName}</span>
                              </div>
                            </td>

                            {/* 3. Services */}
                            <td className="py-3.5 px-6">
                              <div className="flex flex-wrap gap-1.5 max-w-sm">
                                {lead.services.map((svc, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-block px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200 font-medium"
                                  >
                                    {svc}
                                  </span>
                                ))}
                              </div>
                            </td>

                            {/* 4. Contact */}
                            <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {lead.phone && (
                                <div className="flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-slate-400" />
                                  <span>{lead.phone}</span>
                                </div>
                              )}
                              {lead.email && (
                                <div className="flex items-center gap-1 text-slate-500 text-[10px]">
                                  <Mail className="w-3 h-3 text-slate-400" />
                                  <span>{lead.email}</span>
                                </div>
                              )}
                              {!lead.phone && !lead.email && <span className="text-slate-400">—</span>}
                            </td>

                            {/* 5. Convert Buttons in Last Column */}
                            <td className="py-3.5 px-5 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2">
                                {/* Move to Contacts (Potential - Unpaid) */}
                                <button
                                  type="button"
                                  onClick={() => handleMoveToContact(lead.id, lead.name)}
                                  title="Mark as Potential Contact (Payment Pending)"
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-mono text-[11px] font-bold transition-colors cursor-pointer"
                                >
                                  Mark Potential
                                </button>

                                {/* Convert to Customer (Payment Done) */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenConvertModal('lead', lead)}
                                  title="Convert to Paid Customer"
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[11px] font-bold shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Convert to Customer</span>
                                </button>

                                {/* Delete */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLead(lead.id, lead.name)}
                                  title="Delete Lead"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>

                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-16 text-center text-slate-400">
                            <UserPlus className="w-10 h-10 mx-auto mb-2 opacity-30 text-pink-500" />
                            <p className="font-semibold text-slate-700 text-sm">No leads in the queue.</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                              Add new customer technical inquiries manually using the button below.
                            </p>
                            <button
                              type="button"
                              onClick={() => setShowAddLeadModal(true)}
                              className="mt-4 px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-mono font-bold text-xs shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5"
                            >
                              <Plus className="w-4 h-4" />
                              <span>+ Manually Add Lead</span>
                            </button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              VIEW 2: CONTACTS VIEW (POTENTIAL CUSTOMERS - PAYMENT NOT DONE YET)
              ========================================================================= */}
          {activeTab === 'contacts' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-600" />
                    <span>Potential Contacts (Payment Pending)</span>
                    <span className="text-xs font-mono font-semibold text-slate-500">
                      ({filteredContacts.length} total)
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Leads identified as potential customers whose payment has not been completed yet.
                  </p>
                </div>
              </div>

              {/* Contacts Table */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                        <th className="py-3.5 px-5">Name</th>
                        <th className="py-3.5 px-5">Business Name</th>
                        <th className="py-3.5 px-6">Services</th>
                        <th className="py-3.5 px-4">Payment Status</th>
                        <th className="py-3.5 px-5 text-right">Convert to Customer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-sans">
                      {filteredContacts.length > 0 ? (
                        filteredContacts.map((contact) => (
                          <tr key={contact.id} className="hover:bg-slate-50/70 transition-colors group">
                            
                            {/* 1. Name */}
                            <td className="py-3.5 px-5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0">
                                  {contact.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-900 block">{contact.name}</span>
                                  <span className="text-[10px] font-mono text-slate-400">ID: {contact.id}</span>
                                </div>
                              </div>
                            </td>

                            {/* 2. Business Name */}
                            <td className="py-3.5 px-5 font-medium text-slate-800">
                              <div className="flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                <span>{contact.businessName}</span>
                              </div>
                            </td>

                            {/* 3. Services */}
                            <td className="py-3.5 px-6">
                              <div className="flex flex-wrap gap-1.5 max-w-sm">
                                {contact.services.map((svc, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-block px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200 font-medium"
                                  >
                                    {svc}
                                  </span>
                                ))}
                              </div>
                            </td>

                            {/* 4. Payment Status */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <Clock className="w-3 h-3 text-amber-600 animate-pulse" />
                                <span>Payment Pending</span>
                              </span>
                            </td>

                            {/* 5. Convert to Customer Button (Main requirement) */}
                            <td className="py-3.5 px-5 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenConvertModal('contact', contact)}
                                  title="Mark payment as done and convert to Customer"
                                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Convert to Customer</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteContact(contact.id, contact.name)}
                                  title="Delete Contact"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>

                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-16 text-center text-slate-400">
                            <Clock className="w-10 h-10 mx-auto mb-2 opacity-30 text-amber-500" />
                            <p className="font-semibold text-slate-700 text-sm">No contacts pending payment.</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                              When you qualify leads in the Leads tab, click "Mark Potential" to track them here.
                            </p>
                            <button
                              type="button"
                              onClick={() => setActiveTab('leads')}
                              className="mt-4 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5"
                            >
                              <span>Go to Leads Tab</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              VIEW 3: CUSTOMERS VIEW (PAYMENT DONE)
              ========================================================================= */}
          {activeTab === 'customers' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>Converted Customers (Payment Done)</span>
                    <span className="text-xs font-mono font-semibold text-slate-500">
                      ({filteredCustomers.length} total)
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Clients whose onboarding payments are fully received and verified.
                  </p>
                </div>
              </div>

              {/* Customers Table */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                        <th className="py-3.5 px-5">Name</th>
                        <th className="py-3.5 px-5">Business Name</th>
                        <th className="py-3.5 px-6">Services</th>
                        <th className="py-3.5 px-4">Payment Status</th>
                        <th className="py-3.5 px-4">Amount / Mode</th>
                        <th className="py-3.5 px-4">Invoice (PDF)</th>
                        <th className="py-3.5 px-4">Client Status</th>
                        <th className="py-3.5 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-sans">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map((cust) => (
                          <tr key={cust.id} className="hover:bg-slate-50/70 transition-colors group">
                            
                            {/* 1. Name */}
                            <td className="py-3.5 px-5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                                  {cust.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-900 block">{cust.name}</span>
                                  <span className="text-[10px] font-mono text-slate-400">ID: {cust.id}</span>
                                </div>
                              </div>
                            </td>

                            {/* 2. Business Name */}
                            <td className="py-3.5 px-5 font-medium text-slate-800">
                              <div className="flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                <span>{cust.businessName}</span>
                              </div>
                            </td>

                            {/* 3. Services */}
                            <td className="py-3.5 px-6">
                              <div className="flex flex-wrap gap-1.5 max-w-sm">
                                {cust.services.map((svc, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-block px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200 font-medium"
                                  >
                                    {svc}
                                  </span>
                                ))}
                              </div>
                            </td>

                            {/* 4. Payment Status */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Payment Done</span>
                              </span>
                            </td>

                            {/* 5. Amount / Mode */}
                            <td className="py-3.5 px-4 font-mono text-[11px] whitespace-nowrap">
                              <span className="font-bold text-slate-900 block">
                                {cust.paymentAmount && cust.paymentAmount > 0 ? formatCurrency(cust.paymentAmount) : 'Paid'}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {cust.paymentMode || 'Direct Transfer'}
                              </span>
                            </td>

                            {/* 6. Invoice (PDF) */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {cust.invoice ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setViewingCustomerInvoice(cust)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-mono font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer group/pdf shadow-2xs"
                                    title="View Invoice Document"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-rose-600 group-hover/pdf:scale-110 transition-transform" />
                                    <span className="max-w-[120px] truncate">{cust.invoice.fileName || 'Invoice.pdf'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openPdfInNewTab(cust.invoice?.dataUrl || '')}
                                    title="Preview in new tab"
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => downloadPdfFile(cust.invoice?.dataUrl || '', cust.invoice?.fileName || 'Invoice.pdf')}
                                    title="Download PDF"
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const num = `INV-TS-${Date.now().toString().slice(-5)}`;
                                    const gen = generateOfficialInvoicePdf({
                                      invoiceNumber: num,
                                      customerName: cust.name,
                                      businessName: cust.businessName,
                                      services: cust.services,
                                      amount: cust.paymentAmount || 0,
                                      paymentMode: cust.paymentMode || 'UPI / Instant Transfer',
                                      dateStr: new Date(cust.convertedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                    });
                                    technicalSupportStore.attachInvoiceToCustomer(cust.id, {
                                      invoiceNumber: num,
                                      fileName: gen.fileName,
                                      fileSize: gen.fileSize,
                                      dataUrl: gen.dataUrl,
                                      uploadedAt: new Date().toISOString()
                                    });
                                    refreshAll();
                                    showToast(`Generated & attached PDF invoice for ${cust.name}!`);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono text-rose-600 hover:bg-rose-50 border border-dashed border-rose-300 transition-colors cursor-pointer"
                                  title="Attach or generate invoice PDF"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Attach PDF</span>
                                </button>
                              )}
                            </td>

                            {/* 7. Client Status */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <ShieldCheck className="w-3 h-3" />
                                <span>Active Client</span>
                              </span>
                            </td>

                            {/* 8. Action */}
                            <td className="py-3.5 px-4 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomer(cust.id, cust.name)}
                                title="Delete Customer"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>

                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="py-16 text-center text-slate-400">
                            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30 text-emerald-500" />
                            <p className="font-semibold text-slate-700 text-sm">No customers converted yet.</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                              Once leads or contacts complete their payment, click "Convert to Customer" to add them here.
                            </p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* =========================================================================
          MODAL 1: MANUALLY ADD LEAD
          ========================================================================= */}
      {showAddLeadModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center font-bold">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">Manually Add Lead</h3>
                  <p className="text-xs text-slate-500">Capture new merchant technical inquiry</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddLeadModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="space-y-4 pt-4 text-xs font-sans">
              
              {/* 1. Name */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                  Customer / Contact Person Name *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Anand Rathi"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-pink-500 text-slate-900"
                />
              </div>

              {/* 2. Business Name */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                  Business Name / Company *
                </label>
                <input
                  type="text"
                  required
                  value={formBusinessName}
                  onChange={e => setFormBusinessName(e.target.value)}
                  placeholder="e.g. Apex Retail Solutions"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-pink-500 text-slate-900"
                />
              </div>

              {/* 3. Services Selection */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1.5">
                  Services Required *
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {COMMON_SERVICES.map((svc) => {
                    const isSelected = formSelectedServices.includes(svc);
                    return (
                      <button
                        key={svc}
                        type="button"
                        onClick={() => handleToggleService(svc)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-pink-600 text-white shadow-2xs'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                      >
                        {isSelected && '✓ '}
                        {svc}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formCustomService}
                    onChange={e => setFormCustomService(e.target.value)}
                    placeholder="Or type custom service & click Add..."
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-pink-500 text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomService}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold rounded-xl cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Phone / Contact
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-pink-500 text-slate-900"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    placeholder="contact@business.com"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-pink-500 text-slate-900"
                  />
                </div>
              </div>

              {/* Initial Notes */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                  Inquiry Notes / Technical Specs
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="e.g. Needs high volume WhatsApp Cloud API webhook receiver setup"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-pink-500 text-slate-900"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddLeadModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-mono font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-xs font-mono font-bold shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  Save Lead
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: CONVERT TO CUSTOMER (PAYMENT DONE CONFIRMATION)
          ========================================================================= */}
      {convertTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-slate-900">Convert to Paid Customer</h3>
                  <p className="text-[11px] text-slate-500">Confirm payment received &amp; attach invoice to move to Customers</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="py-4 space-y-3.5 text-xs">
              {/* Contact Header Badge */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                <p className="font-bold text-slate-900 text-sm">{convertTarget.item.name}</p>
                <p className="text-slate-600 font-medium">{convertTarget.item.businessName}</p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {convertTarget.item.services.map((s, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-slate-200 text-slate-700">
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Payment Amount */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                  Payment Amount Received (₹)
                </label>
                <input
                  type="number"
                  value={convertPaymentAmount}
                  onChange={e => setConvertPaymentAmount(e.target.value)}
                  placeholder="e.g. 25000 (Optional)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-emerald-500 text-slate-900"
                />
              </div>

              {/* Payment Mode */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                  Payment Mode
                </label>
                <select
                  value={convertPaymentMode}
                  onChange={e => setConvertPaymentMode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-emerald-500 text-slate-900 cursor-pointer"
                >
                  <option value="UPI / QR">UPI / QR (Instant)</option>
                  <option value="Bank Transfer / NEFT / IMPS">Bank Transfer (NEFT / IMPS)</option>
                  <option value="Credit / Debit Card">Credit / Debit Card</option>
                  <option value="Razorpay Payment Link">Razorpay Payment Link</option>
                  <option value="Cash / Cheque">Cash / Cheque</option>
                </select>
              </div>

              {/* Invoice (PDF) Section */}
              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-mono font-bold text-slate-700 uppercase flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-rose-600" />
                    <span>Attach Invoice (PDF Form)</span>
                  </label>
                  <span className="text-[10px] font-mono bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full font-bold">
                    PDF Document
                  </span>
                </div>

                {/* Invoice Number Input */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">Invoice #:</span>
                  <input
                    type="text"
                    value={invoiceNumberInput}
                    onChange={e => setInvoiceNumberInput(e.target.value)}
                    placeholder="e.g. INV-2026-0042"
                    className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:border-rose-400"
                  />
                </div>

                {/* Hidden file input for PDF file upload */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="application/pdf,.pdf"
                  onChange={handleFileUploadChange}
                  className="hidden"
                />

                {!attachedInvoice ? (
                  <div className="space-y-2">
                    {/* Upload PDF Box */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-300 hover:border-rose-400 rounded-2xl p-4 text-center bg-slate-50/70 hover:bg-rose-50/30 transition-all cursor-pointer group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-rose-600 group-hover:scale-105 flex items-center justify-center mx-auto mb-1.5 shadow-2xs transition-transform">
                        <Upload className="w-5 h-5 text-rose-600" />
                      </div>
                      <p className="text-xs font-bold text-slate-800">
                        {isReadingPdf ? 'Attaching PDF...' : <>Click to upload Invoice <span className="text-rose-600 font-mono">(.pdf)</span></>}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Select customer billing invoice from device in PDF format
                      </p>
                    </div>

                    {/* Instant Auto-Generate Button */}
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] text-slate-600 font-medium">Don't have a PDF ready?</span>
                      <button
                        type="button"
                        onClick={handleAutoGenerateInvoice}
                        className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-xs font-mono font-bold shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-rose-500" />
                        <span>Generate Invoice PDF</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Attached PDF Card Preview */
                  <div className="p-3 rounded-2xl bg-rose-50/80 border border-rose-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-2xs font-bold">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate font-mono">
                            {attachedInvoice.fileName}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            Invoice #{attachedInvoice.invoiceNumber} • {attachedInvoice.fileSize || 'PDF'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openPdfInNewTab(attachedInvoice.dataUrl || '')}
                          title="Preview PDF"
                          className="p-1.5 rounded-lg bg-white hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">View</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadPdfFile(attachedInvoice.dataUrl || '', attachedInvoice.fileName)}
                          title="Download PDF"
                          className="p-1.5 rounded-lg bg-white hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttachedInvoice(null)}
                          title="Remove PDF"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-white cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[10px] text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-mono flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Invoice PDF attached! Ready to convert into Customer.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-mono font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmConvertToCustomer}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirm &amp; Convert to Customer</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: INVOICE VIEWER / DETAILS MODAL
          ========================================================================= */}
      {viewingCustomerInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-slate-900">
                    Customer Invoice Document
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {viewingCustomerInvoice.invoice?.invoiceNumber || 'Official Invoice'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingCustomerInvoice(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Document Visual Preview Card */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 font-sans text-xs">
              <div className="flex items-start justify-between pb-3 border-b border-slate-200">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">WABASTORE SUPPORT</h4>
                  <p className="text-[10px] text-slate-500 font-mono">Official Integration &amp; Tech Solutions</p>
                </div>
                <div className="text-right font-mono">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    PAID / SETTLED
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {viewingCustomerInvoice.invoice?.invoiceNumber}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Client Name</span>
                  <strong className="text-slate-900">{viewingCustomerInvoice.name}</strong>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Business Name</span>
                  <strong className="text-slate-900">{viewingCustomerInvoice.businessName}</strong>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Total Amount</span>
                  <strong className="text-emerald-700 font-mono">
                    {viewingCustomerInvoice.paymentAmount ? formatCurrency(viewingCustomerInvoice.paymentAmount) : 'Paid'}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Payment Mode</span>
                  <span className="text-slate-700 font-mono">{viewingCustomerInvoice.paymentMode}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-mono text-slate-400 uppercase block mb-1">Services Covered</span>
                <div className="flex flex-wrap gap-1">
                  {viewingCustomerInvoice.services.map((s, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-slate-200 text-slate-700">
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>File: {viewingCustomerInvoice.invoice?.fileName}</span>
                <span>{viewingCustomerInvoice.invoice?.fileSize || 'PDF Format'}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setViewingCustomerInvoice(null)}
                className="px-4 py-2 rounded-xl text-xs font-mono font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => downloadPdfFile(viewingCustomerInvoice.invoice?.dataUrl || '', viewingCustomerInvoice.invoice?.fileName || 'Invoice.pdf')}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => openPdfInNewTab(viewingCustomerInvoice.invoice?.dataUrl || '')}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Open PDF in Viewer</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
