import React, { useState } from 'react';
import { 
  QrCode, Sparkles, Plus, Search, User, Building2, Phone, Mail, 
  Download, Eye, Copy, Check, Edit3, ArrowLeft, Users, 
  Smartphone, MapPin, RefreshCw, X, Zap, Upload, Image as ImageIcon, Globe, Trash2, Link as LinkIcon, RotateCcw
} from 'lucide-react';
import { INITIAL_AIQR_CLIENTS, AiqrClient, AiqrScanLog, CustomAppLink, DEFAULT_APP_LINKS } from '../../data/initialAiqrData';

import { AiqrTab } from './AiqrSidebar';

interface AiqrStudioPanelProps {
  departmentName?: string;
  subDept?: string | null;
  activeTab?: AiqrTab;
  onSelectTab?: (tab: AiqrTab) => void;
  onClientCountChange?: (count: number) => void;
  onScanCountChange?: (count: number) => void;
}

export const AiqrStudioPanel: React.FC<AiqrStudioPanelProps> = ({ 
  departmentName = 'Support Unit', 
  subDept = 'support',
  activeTab = 'studio',
  onSelectTab,
  onClientCountChange,
  onScanCountChange
}) => {
  // Clients State (Persisted in localStorage for real-time mobile sync with strict Array validation)
  const [clients, setClients] = useState<AiqrClient[]>(() => {
    try {
      const saved = localStorage.getItem('aiqr_clients_data');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (err) {
      console.error(err);
    }
    return INITIAL_AIQR_CLIENTS;
  });

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Persist clients data globally to localStorage & notify parent
  React.useEffect(() => {
    try {
      localStorage.setItem('aiqr_clients_data', JSON.stringify(clients));
    } catch (err) {
      console.error(err);
    }

    if (onClientCountChange) onClientCountChange(clients.length);
    const totalScansCalc = clients.reduce((sum, c) => sum + (c.scanLogs ? c.scanLogs.length : 0), 0);
    if (onScanCountChange) onScanCountChange(totalScansCalc);
  }, [clients, onClientCountChange, onScanCountChange]);

  // Modals State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);
  const [isEditLinkModalOpen, setIsEditLinkModalOpen] = useState(false);
  const [isFullscreenQrOpen, setIsFullscreenQrOpen] = useState(false);

  // Form State for Adding New Client
  const [newClientForm, setNewClientForm] = useState({
    name: '',
    companyName: '',
    phone: '',
    email: '',
    logoUrl: '',
    industry: 'Enterprise Technology'
  });

  // Form State for Editing Client
  const [editClientForm, setEditClientForm] = useState<AiqrClient | null>(null);

  // Form State for Adding Connected App Link
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkIconUrl, setNewLinkIconUrl] = useState('');

  // Form State for Editing/Resetting App Link
  const [editingAppLink, setEditingAppLink] = useState<CustomAppLink | null>(null);

  // Save Status Notice Feedback
  const [saveStatusNotice, setSaveStatusNotice] = useState(false);

  // Currently Selected Client object
  const selectedClient = clients.find(c => c.id === selectedClientId) || null;

  // Filtered Clients list based on search
  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.uniqueQrId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery)
  );

  // Total Scans Calculation
  const totalScans = clients.reduce((sum, c) => sum + c.scanLogs.length, 0);

  // Real-time server polling for incoming mobile scanner logs (Name, Phone, Email, Device, Location)
  React.useEffect(() => {
    const fetchServerScans = async () => {
      let allScans: any[] = [];
      try {
        const res = await fetch('/api/aiqr/scans');
        if (res.ok) {
          const serverScans = await res.json();
          if (Array.isArray(serverScans)) allScans = serverScans;
        }
      } catch (err) {}

      try {
        const localScans = JSON.parse(localStorage.getItem('aiqr_real_scans') || '[]');
        if (Array.isArray(localScans)) {
          const existingIds = new Set(allScans.map(s => s.id));
          localScans.forEach(ls => {
            if (!existingIds.has(ls.id)) allScans.push(ls);
          });
        }
      } catch (err) {}

      if (allScans.length > 0) {
        setClients(prev => prev.map(c => {
          const clientRealScans = allScans.filter((s: any) => s && s.qrId === c.uniqueQrId);
          if (clientRealScans.length > 0) {
            const existingIds = new Set(c.scanLogs.map(l => l.id));
            const newScansToAdd = clientRealScans.filter((s: any) => !existingIds.has(s.id));
            if (newScansToAdd.length > 0) {
              return {
                ...c,
                scansCount: c.scansCount + newScansToAdd.length,
                scanLogs: [...newScansToAdd, ...c.scanLogs]
              };
            }
          }
          return c;
        }));
      }
    };

    fetchServerScans();
    window.addEventListener('storage', fetchServerScans);
    window.addEventListener('visibilitychange', fetchServerScans);
    return () => {
      window.removeEventListener('storage', fetchServerScans);
      window.removeEventListener('visibilitychange', fetchServerScans);
    };
  }, []);

  // Helper: Get Mobile-Scannable Web Link for QR Encoding (Replaces localhost with Wi-Fi IP so phone cameras scan 100% reliably)
  const getScannableQrUrl = (uniqueQrId: string) => {
    let host = '192.168.1.10:3000';
    if (typeof window !== 'undefined' && window.location.host) {
      const currentHost = window.location.host;
      if (!currentHost.includes('localhost') && !currentHost.includes('127.0.0.1')) {
        host = currentHost;
      }
    }
    return `http://${host}/?qr_id=${encodeURIComponent(uniqueQrId)}`;
  };

  // Helper: File Upload from Computer for Company Logo
  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (isEdit && editClientForm) {
          setEditClientForm({ ...editClientForm, logoUrl: result });
        } else {
          setNewClientForm({ ...newClientForm, logoUrl: result });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Helper: File Upload from Computer for App Connection Logo/Icon
  const handleAppIconUpload = (e: React.ChangeEvent<HTMLInputElement>, isEditMode: boolean = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (isEditMode && editingAppLink) {
          setEditingAppLink({ ...editingAppLink, iconUrl: result });
        } else {
          setNewLinkIconUrl(result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle Add New Client Submit
  const handleAddClientSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientForm.name || !newClientForm.companyName) return;

    const randomNum = Math.floor(Math.random() * 8999 + 1000);
    const uniqueQrId = `AIQR-${newClientForm.companyName.substring(0, 5).toUpperCase().replace(/\s/g, '')}-${randomNum}`;
    
    const newClient: AiqrClient = {
      id: `cli-${Date.now()}`,
      uniqueQrId: uniqueQrId,
      name: newClientForm.name,
      companyName: newClientForm.companyName,
      phone: newClientForm.phone || '+91 98200 00000',
      email: newClientForm.email || `contact@${newClientForm.companyName.toLowerCase().replace(/\s/g, '')}.com`,
      logoUrl: newClientForm.logoUrl || 'https://images.unsplash.com/photo-1572021335469-31706a17aaef?w=150&auto=format&fit=crop&q=80',
      targetUrl: `http://192.168.1.10:3000/?qr_id=${uniqueQrId}`,
      industry: newClientForm.industry || 'General Business',
      createdAt: new Date().toISOString().split('T')[0],
      scansCount: 0,
      scanLogs: [],
      appLinks: DEFAULT_APP_LINKS
    };

    setClients([newClient, ...clients]);
    setNewClientForm({
      name: '',
      companyName: '',
      phone: '',
      email: '',
      logoUrl: '',
      industry: 'Enterprise Technology'
    });
    setIsAddModalOpen(false);
    setSelectedClientId(newClient.id);
  };

  // Handle Edit Client Submit
  const handleEditClientSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editClientForm) return;

    setClients(prev => prev.map(c => c.id === editClientForm.id ? editClientForm : c));
    setIsEditModalOpen(false);
  };

  // Helper: Synchronize clients state locally & push directly to server memory
  const syncClientsStateAndServer = (updatedClients: AiqrClient[]) => {
    setClients(updatedClients);
    try {
      localStorage.setItem('aiqr_clients_data', JSON.stringify(updatedClients));
      window.dispatchEvent(new CustomEvent('aiqr_clients_updated', { detail: updatedClients }));
      fetch('/api/aiqr/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedClients)
      }).catch(err => console.error('Server sync notice:', err));
    } catch (err) {
      console.error(err);
    }
  };

  // Handle Add Connected App Link for Selected Client
  const handleAddAppLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !newLinkName) return;

    const newLink: CustomAppLink = {
      id: `link-${Date.now()}`,
      name: newLinkName,
      url: newLinkUrl || 'https://amuwa.com',
      iconUrl: newLinkIconUrl || '/app_icons/whatsapp.png'
    };

    const updatedLinks = [...(selectedClient.appLinks || DEFAULT_APP_LINKS), newLink];
    const updatedClients = clients.map(c => c.id === selectedClient.id ? { ...c, appLinks: updatedLinks } : c);

    syncClientsStateAndServer(updatedClients);
    
    setNewLinkName('');
    setNewLinkUrl('');
    setNewLinkIconUrl('');
    setIsAddLinkModalOpen(false);
  };

  // Handle Edit Connected App Link Submit
  const handleEditAppLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !editingAppLink) return;

    const updatedLinks = (selectedClient.appLinks || DEFAULT_APP_LINKS).map(link => 
      link.id === editingAppLink.id ? editingAppLink : link
    );
    const updatedClients = clients.map(c => c.id === selectedClient.id ? { ...c, appLinks: updatedLinks } : c);

    syncClientsStateAndServer(updatedClients);
    setIsEditLinkModalOpen(false);
    setEditingAppLink(null);
  };

  // Delete App Link
  const handleDeleteAppLink = (linkId: string) => {
    if (!selectedClient) return;
    const updatedLinks = (selectedClient.appLinks || []).filter(l => l.id !== linkId);
    const updatedClients = clients.map(c => c.id === selectedClient.id ? { ...c, appLinks: updatedLinks } : c);

    syncClientsStateAndServer(updatedClients);
  };

  // Reset All App Links to Default
  const handleResetAppLinksToDefault = () => {
    if (!selectedClient) return;
    const updatedClients = clients.map(c => c.id === selectedClient.id ? { ...c, appLinks: DEFAULT_APP_LINKS } : c);

    syncClientsStateAndServer(updatedClients);
  };

  // Explicit Save & Publish All App Connections
  const handleSaveAndPublishAppLinks = () => {
    if (!selectedClient) return;

    syncClientsStateAndServer(clients);

    setSaveStatusNotice(true);
    setTimeout(() => setSaveStatusNotice(false), 3500);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12 font-sans">
      
      {/* ========================================================================= */}
      {/* TOP STATS & HEADER BANNER */}
      {/* ========================================================================= */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-mono font-semibold mb-2">
            <Sparkles className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
            <span>AIQR ENGINE &bull; DYNAMIC APP CONNECTIONS MANAGER</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">
            AIQR Management Portal &bull; {departmentName}
          </h2>
          <p className="text-xs font-mono text-slate-500 mt-1">
            Generate unique AIQR codes per client, manage connected app buttons &amp; URLs, and view scanner logs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 text-right">
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold block">TOTAL CLIENTS</span>
            <span className="text-xl font-bold font-mono text-purple-600">{clients.length}</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 text-right">
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold block">TOTAL SCANS</span>
            <span className="text-xl font-bold font-mono text-emerald-600">{totalScans}</span>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="py-3 px-5 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-mono text-xs font-bold flex items-center gap-2 shadow-md transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add New AIQR Client</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: CLIENTS DIRECTORY GRID */}
      {/* ========================================================================= */}
      {!selectedClient ? (
        <div className="space-y-6">
          
          {/* Search & Filter Bar */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by client name, company, or QR ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white transition-all"
              />
            </div>

            <span className="text-xs font-mono text-slate-500 font-semibold">
              Showing {filteredClients.length} of {clients.length} Registered AIQR Clients
            </span>
          </div>

          {/* Clients Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClients.map(client => (
              <div
                key={client.id}
                onClick={() => setSelectedClientId(client.id)}
                className="bg-white rounded-3xl p-6 border border-slate-200 hover:border-purple-500 hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer flex flex-col justify-between space-y-5 group relative overflow-hidden shadow-sm"
              >
                <div className="h-1.5 w-full bg-gradient-to-r from-purple-500 to-indigo-600 absolute top-0 left-0 right-0" />

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <img
                      src={client.logoUrl}
                      alt={client.companyName}
                      className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shadow-xs group-hover:scale-105 transition-transform"
                    />

                    <span className="px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 font-mono text-[10px] font-bold flex items-center gap-1">
                      <QrCode className="w-3 h-3 text-purple-600" />
                      {client.uniqueQrId}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xl font-bold font-heading text-slate-900 group-hover:text-purple-600 transition-colors">
                      {client.companyName}
                    </h3>
                    <p className="text-xs text-slate-500 font-sans mt-0.5">
                      Client Admin: <strong>{client.name}</strong> &bull; {client.industry}
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-500 font-bold">Connected Apps:</span>
                    <strong className="text-purple-600 font-bold">{(client.appLinks || DEFAULT_APP_LINKS).length} Apps Active</strong>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-purple-600">
                  <span>View Profile &amp; Manage Links</span>
                  <ArrowLeft className="w-4 h-4 rotate-180 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            ))}
          </div>

        </div>
      ) : (
        /* ========================================================================= */
        /* VIEW 2: CLIENT DETAIL WORKSPACE (PROFILE, APP LINKS MANAGER & UNIQUE QR) */
        /* ========================================================================= */
        <div className="space-y-8 animate-fade-in">
          
          {/* Top Return Navigation Bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedClientId(null)}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono font-bold flex items-center gap-2 border border-slate-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-purple-600" />
              <span>Back to Clients Directory</span>
            </button>

            <span className="text-xs font-mono text-slate-500">
              Assigned Unique AIQR: <strong className="text-purple-600">{selectedClient.uniqueQrId}</strong>
            </span>
          </div>

          {/* MAIN CLIENT PROFILE & ASSIGNED UNIQUE AIQR BOX (2 COLUMNS) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* LEFT COLUMN (7 COLS): CLIENT PROFILE & APP LINKS MANAGER */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col justify-between space-y-6">
              
              <div className="space-y-6">
                
                {/* Header Logo + Action Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => { setEditClientForm(selectedClient); setIsEditModalOpen(true); }}
                      className="group relative"
                      title="Click to edit company logo"
                    >
                      <img
                        src={selectedClient.logoUrl}
                        alt={selectedClient.companyName}
                        className="w-20 h-20 rounded-2xl object-cover border-2 border-purple-200 shadow-md group-hover:opacity-80 transition-opacity"
                      />
                      <div className="absolute inset-0 bg-slate-900/40 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-mono">
                        Edit Logo
                      </div>
                    </button>

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-2xl font-bold font-heading text-slate-900">
                          {selectedClient.companyName}
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-mono font-bold">
                          {selectedClient.industry}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-500 mt-1">
                        Assigned Client Admin: <strong>{selectedClient.name}</strong>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => { setEditClientForm(selectedClient); setIsEditModalOpen(true); }}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono font-bold flex items-center gap-1.5 border border-slate-200 transition-colors shrink-0"
                  >
                    <Edit3 className="w-4 h-4 text-purple-600" />
                    <span>Edit Profile</span>
                  </button>
                </div>

                {/* Profile Contact Specs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">CONTACT PHONE</span>
                    <strong className="text-slate-900 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-purple-600" />
                      {selectedClient.phone}
                    </strong>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">EMAIL ADDRESS</span>
                    <strong className="text-slate-900 flex items-center gap-1.5 truncate">
                      <Mail className="w-3.5 h-3.5 text-purple-600" />
                      {selectedClient.email}
                    </strong>
                  </div>
                </div>

                {/* DYNAMIC CONNECTED APP LINKS MANAGER (TAP ANY TILE TO EDIT / RESET URL & LOGO) */}
                <div className="p-5 bg-purple-50/50 rounded-2xl border border-purple-100 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono text-purple-800 font-bold block uppercase">
                        CONNECTED APP LINKS &amp; BUTTONS MANAGER
                      </span>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                        Tap any app tile to edit name, reset URL, or change logo!
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleResetAppLinksToDefault}
                        className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-mono font-bold flex items-center gap-1 border border-slate-300 transition-colors"
                        title="Reset links to default"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
                        <span>Reset All</span>
                      </button>

                      <button
                        onClick={() => setIsAddLinkModalOpen(true)}
                        className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-sm transition-all shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add App Link</span>
                      </button>
                    </div>
                  </div>

                  {/* List of Active App Links (Tapping opens Edit/Reset Modal) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(selectedClient.appLinks || DEFAULT_APP_LINKS).filter(link => link && typeof link === 'object' && link.name).map((link, idx) => (
                      <div 
                        key={link.id || idx} 
                        onClick={() => { setEditingAppLink(link); setIsEditLinkModalOpen(true); }}
                        className="p-3 bg-white rounded-xl border border-purple-100 shadow-2xs flex items-center justify-between gap-3 hover:border-purple-500 hover:shadow-md transition-all cursor-pointer group"
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          {link.iconUrl && (link.iconUrl.startsWith('/') || link.iconUrl.startsWith('data:') || link.iconUrl.startsWith('http')) ? (
                            <img src={link.iconUrl} alt={link.name || 'App'} className="w-8 h-8 rounded-lg object-contain shrink-0 border border-slate-100 group-hover:scale-105 transition-transform" />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition-transform">
                              <Globe className="w-4 h-4" />
                            </div>
                          )}
                          <div className="truncate">
                            <strong className="text-xs font-bold text-slate-900 block truncate group-hover:text-purple-600 transition-colors">{link.name || 'App Connection'}</strong>
                            <span className="text-[10px] text-slate-400 font-mono truncate block">{link.url || 'https://amuwa.com'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditingAppLink(link); setIsEditLinkModalOpen(true); }}
                            className="p-1 rounded-lg text-purple-600 hover:bg-purple-50 text-[10px] font-mono font-bold flex items-center gap-0.5"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteAppLink(link.id); }}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Remove link"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* PROMINENT SAVE & PUBLISH BUTTON BELOW APP TILES LIST */}
                  <div className="pt-3.5 border-t border-purple-200/80 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {saveStatusNotice ? (
                        <span className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono text-xs font-bold flex items-center gap-1.5 animate-fade-in shadow-2xs">
                          <Check className="w-4 h-4 text-emerald-600" />
                          <span>App Connections Saved &amp; Live on Mobile Screens!</span>
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono text-slate-500 font-semibold">
                          Click Save to publish changes immediately to mobile screens.
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveAndPublishAppLinks}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-95 shrink-0 border border-purple-500/30"
                    >
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>SAVE &amp; PUBLISH APP CONNECTIONS</span>
                    </button>
                  </div>
                </div>

              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-mono text-slate-400">
                <span>Created On: {selectedClient.createdAt}</span>
                <span>Unique ID: {selectedClient.uniqueQrId}</span>
              </div>
            </div>

            {/* RIGHT COLUMN (5 COLS): UNIQUE ASSIGNED AIQR BOX */}
            <div className="lg:col-span-5 bg-slate-900 text-white rounded-3xl p-6 sm:p-8 border border-slate-800 shadow-xl flex flex-col items-center justify-between text-center space-y-6 relative overflow-hidden">
              
              <div className="absolute top-0 right-0 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />

              <div className="space-y-4 w-full">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-mono font-bold">
                  <QrCode className="w-3.5 h-3.5 text-purple-400" />
                  <span>HIGH-SPEED MOBILE SCANNABLE AIQR</span>
                </div>

                <div>
                  <h4 className="text-xl font-bold font-heading text-white">
                    {selectedClient.uniqueQrId}
                  </h4>
                  <p className="text-xs font-mono text-slate-400 mt-0.5">
                    Scans directly via iPhone &amp; Android Cameras
                  </p>
                </div>

                <div className="w-56 h-56 bg-white p-4 rounded-3xl mx-auto shadow-2xl relative flex items-center justify-center border-4 border-purple-500/40">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=H&margin=2&data=${encodeURIComponent(getScannableQrUrl(selectedClient.uniqueQrId))}`}
                    alt={selectedClient.uniqueQrId}
                    className="w-full h-full object-contain rounded-xl"
                  />

                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <img
                      src={selectedClient.logoUrl}
                      alt="Logo"
                      className="w-8 h-8 rounded-lg object-cover border-2 border-white shadow-md bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full space-y-2 pt-2 border-t border-slate-800">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setIsFullscreenQrOpen(true)}
                    className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
                  >
                    <Eye className="w-4 h-4 text-purple-400" />
                    <span>View QR</span>
                  </button>

                  <a
                    href={`https://api.qrserver.com/v1/create-qr-code/?size=800x800&ecc=H&margin=2&data=${encodeURIComponent(getScannableQrUrl(selectedClient.uniqueQrId))}`}
                    target="_blank"
                    download={`${selectedClient.uniqueQrId}.png`}
                    className="py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-mono font-bold flex items-center justify-center gap-1.5 shadow-md transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download</span>
                  </a>
                </div>
              </div>

            </div>

          </div>

          {/* ========================================================================= */}
          {/* BOTTOM SECTION: SCANNED VISITORS & CAPTURED LEADS TABLE */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-mono font-semibold mb-1.5">
                  <Users className="w-3.5 h-3.5 text-emerald-600" />
                  <span>CLIENT SCANNER ACTIVITY LOG</span>
                </div>
                <h3 className="text-xl font-bold font-heading text-slate-900">
                  People Who Scanned {selectedClient.uniqueQrId}
                </h3>
              </div>
            </div>

            {/* Table of Scanned Visitors */}
            {selectedClient.scanLogs.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
                <QrCode className="w-8 h-8 text-slate-400 mx-auto" />
                <h4 className="text-sm font-bold text-slate-700 font-heading">No Scans Recorded Yet</h4>
                <p className="text-xs font-mono text-slate-400">
                  When users scan this client's unique AIQR code, their contact logs will appear here in real time.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 uppercase text-[10px] font-bold">
                      <th className="p-3">Visitor Name</th>
                      <th className="p-3">Phone Number</th>
                      <th className="p-3">Email Address</th>
                      <th className="p-3">Device / Browser</th>
                      <th className="p-3">City / Location</th>
                      <th className="p-3">Scan Time</th>
                      <th className="p-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedClient.scanLogs.map(log => (
                      <tr key={log.id} className="hover:bg-purple-50/30 transition-colors">
                        <td className="p-3 font-bold text-slate-900 flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 font-bold flex items-center justify-center text-[10px]">
                            {log.visitorName.charAt(0)}
                          </div>
                          <span>{log.visitorName}</span>
                        </td>
                        <td className="p-3 text-slate-700">{log.phone}</td>
                        <td className="p-3 text-slate-500">{log.email}</td>
                        <td className="p-3 text-slate-500">{log.device}</td>
                        <td className="p-3 text-slate-700 font-bold">{log.city}</td>
                        <td className="p-3 text-slate-400">{log.scannedAt}</td>
                        <td className="p-3 text-right">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            log.status === 'Ingested' ? 'bg-emerald-100 text-emerald-800' :
                            log.status === 'Followed Up' ? 'bg-blue-100 text-blue-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD NEW USER / CLIENT FORM */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-slate-200 shadow-2xl space-y-6 animate-scale-up max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-bold font-heading text-slate-900">Add New AIQR Client</h3>
                  <p className="text-xs font-mono text-slate-400">Generate a unique AIQR code for this client</p>
                </div>
              </div>

              <button onClick={() => setIsAddModalOpen(false)} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddClientSubmit} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block font-bold text-slate-700 mb-1">CLIENT FULL NAME *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vikram Sharma"
                  value={newClientForm.name}
                  onChange={e => setNewClientForm({ ...newClientForm, name: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">COMPANY / BUSINESS NAME *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Nexus Tech Solutions"
                  value={newClientForm.companyName}
                  onChange={e => setNewClientForm({ ...newClientForm, companyName: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  COMPANY LOGO (ADD FROM COMPUTER) *
                </label>
                
                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-purple-200 hover:border-purple-500 transition-colors flex flex-col items-center justify-center text-center space-y-3">
                  {newClientForm.logoUrl ? (
                    <div className="flex items-center gap-3 w-full bg-white p-2.5 rounded-xl border border-purple-200 shadow-2xs">
                      <img src={newClientForm.logoUrl} alt="Uploaded Logo Preview" className="w-12 h-12 rounded-xl object-cover border border-slate-200" />
                      <div className="text-left flex-1 truncate">
                        <span className="font-bold text-slate-900 block text-xs">Image Selected</span>
                        <span className="text-[10px] text-emerald-600 font-bold block">Ready for AIQR Embedding</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewClientForm({ ...newClientForm, logoUrl: '' })}
                        className="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <label htmlFor="logo-file-input" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs cursor-pointer inline-flex items-center gap-1.5 shadow-sm transition-colors">
                          <ImageIcon className="w-4 h-4" />
                          <span>Select Image from Computer</span>
                        </label>
                        <input
                          id="logo-file-input"
                          type="file"
                          accept="image/*"
                          onChange={e => handleLogoFileUpload(e, false)}
                          className="hidden"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400">Supports PNG, JPG, WEBP or SVG image files</p>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">PHONE NUMBER</label>
                  <input
                    type="tel"
                    placeholder="+91 98200 12345"
                    value={newClientForm.phone}
                    onChange={e => setNewClientForm({ ...newClientForm, phone: e.target.value })}
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">EMAIL ADDRESS</label>
                  <input
                    type="email"
                    placeholder="client@company.com"
                    value={newClientForm.email}
                    onChange={e => setNewClientForm({ ...newClientForm, email: e.target.value })}
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-colors shadow-md"
                >
                  Create Client &amp; Assign Unique QR
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT CLIENT PROFILE MODAL */}
      {/* ========================================================================= */}
      {isEditModalOpen && editClientForm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-slate-200 shadow-2xl space-y-6 animate-scale-up max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-purple-600" />
                <h3 className="text-xl font-bold font-heading text-slate-900">Edit Client Profile</h3>
              </div>
              <button onClick={() => setIsEditModalOpen(false)} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditClientSubmit} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block font-bold text-slate-700 mb-1">COMPANY NAME</label>
                <input
                  type="text"
                  value={editClientForm.companyName}
                  onChange={e => setEditClientForm({ ...editClientForm, companyName: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">CLIENT FULL NAME</label>
                <input
                  type="text"
                  value={editClientForm.name}
                  onChange={e => setEditClientForm({ ...editClientForm, name: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  UPDATE COMPANY LOGO (ADD FROM COMPUTER)
                </label>
                
                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-purple-200 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="flex items-center gap-3 w-full bg-white p-2.5 rounded-xl border border-purple-200 shadow-2xs">
                    <img src={editClientForm.logoUrl} alt="Logo Preview" className="w-12 h-12 rounded-xl object-cover border border-slate-200" />
                    <div className="text-left flex-1 truncate">
                      <span className="font-bold text-slate-900 block text-xs">Current Logo Active</span>
                      <span className="text-[10px] text-purple-600 font-bold block">Click below to change</span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="edit-logo-file-input" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs cursor-pointer inline-flex items-center gap-1.5 shadow-sm transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>Select New Image from Computer</span>
                    </label>
                    <input
                      id="edit-logo-file-input"
                      type="file"
                      accept="image/*"
                      onChange={e => handleLogoFileUpload(e, true)}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-md"
                >
                  Save Profile Changes
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: ADD CONNECTED APP LINK MODAL WITH COMPUTER LOGO UPLOADER */}
      {/* ========================================================================= */}
      {isAddLinkModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-slate-200 shadow-2xl space-y-6 animate-scale-up max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
                  <LinkIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-bold font-heading text-slate-900">Add Connected App Link</h3>
                  <p className="text-xs font-mono text-slate-400">Add a new app icon tile to this client's mobile page</p>
                </div>
              </div>

              <button onClick={() => setIsAddLinkModalOpen(false)} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddAppLinkSubmit} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block font-bold text-slate-700 mb-1">APP / CONNECTION NAME *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Instagram, Telegram, LinkedIn, Catalogue..."
                  value={newLinkName}
                  onChange={e => setNewLinkName(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">TARGET URL LINK *</label>
                <input
                  type="url"
                  required
                  placeholder="https://..."
                  value={newLinkUrl}
                  onChange={e => setNewLinkUrl(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                />
              </div>

              {/* APP ICON - SELECT FROM COMPUTER */}
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  APP LOGO / ICON (SELECT FROM COMPUTER)
                </label>
                
                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-purple-200 flex flex-col items-center justify-center text-center space-y-3">
                  {newLinkIconUrl ? (
                    <div className="flex items-center gap-3 w-full bg-white p-2.5 rounded-xl border border-purple-200 shadow-2xs">
                      <img src={newLinkIconUrl} alt="App Icon Preview" className="w-10 h-10 rounded-lg object-contain border border-slate-200" />
                      <div className="text-left flex-1 truncate">
                        <span className="font-bold text-slate-900 block text-xs">App Icon Selected</span>
                        <span className="text-[10px] text-emerald-600 font-bold block">Ready for Display</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewLinkIconUrl('')}
                        className="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <label htmlFor="app-icon-file-input" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs cursor-pointer inline-flex items-center gap-1.5 shadow-sm transition-colors">
                          <ImageIcon className="w-4 h-4" />
                          <span>Select App Logo from Computer</span>
                        </label>
                        <input
                          id="app-icon-file-input"
                          type="file"
                          accept="image/*"
                          onChange={e => handleAppIconUpload(e, false)}
                          className="hidden"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400">Upload PNG, JPG, or SVG icon image</p>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddLinkModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-md"
                >
                  Add App Connection
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: EDIT / RESET CONNECTED APP LINK MODAL */}
      {/* ========================================================================= */}
      {isEditLinkModalOpen && editingAppLink && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-slate-200 shadow-2xl space-y-6 animate-scale-up max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-purple-600" />
                <h3 className="text-xl font-bold font-heading text-slate-900">Edit / Reset App Connection</h3>
              </div>
              <button onClick={() => { setIsEditLinkModalOpen(false); setEditingAppLink(null); }} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditAppLinkSubmit} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block font-bold text-slate-700 mb-1">APP / CONNECTION NAME</label>
                <input
                  type="text"
                  required
                  value={editingAppLink.name}
                  onChange={e => setEditingAppLink({ ...editingAppLink, name: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">RESET / EDIT TARGET URL LINK</label>
                <input
                  type="url"
                  required
                  value={editingAppLink.url}
                  onChange={e => setEditingAppLink({ ...editingAppLink, url: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white font-bold text-purple-700"
                />
              </div>

              {/* APP ICON - SELECT NEW FROM COMPUTER */}
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  UPDATE APP LOGO (ADD FROM COMPUTER)
                </label>
                
                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-purple-200 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="flex items-center gap-3 w-full bg-white p-2.5 rounded-xl border border-purple-200 shadow-2xs">
                    {editingAppLink.iconUrl && (editingAppLink.iconUrl.startsWith('/') || editingAppLink.iconUrl.startsWith('data:') || editingAppLink.iconUrl.startsWith('http')) ? (
                      <img src={editingAppLink.iconUrl} alt={editingAppLink.name || 'App'} className="w-10 h-10 rounded-lg object-contain border border-slate-200" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold text-xs">
                        <Globe className="w-5 h-5" />
                      </div>
                    )}
                    <div className="text-left flex-1 truncate">
                      <span className="font-bold text-slate-900 block text-xs">Current Logo Active</span>
                      <span className="text-[10px] text-purple-600 font-bold block">Click below to change</span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="edit-app-icon-file-input" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs cursor-pointer inline-flex items-center gap-1.5 shadow-sm transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>Select New Logo from Computer</span>
                    </label>
                    <input
                      id="edit-app-icon-file-input"
                      type="file"
                      accept="image/*"
                      onChange={e => handleAppIconUpload(e, true)}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setIsEditLinkModalOpen(false); setEditingAppLink(null); }}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-md"
                >
                  Save &amp; Sync Link
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: FULLSCREEN QR PREVIEW MODAL */}
      {/* ========================================================================= */}
      {isFullscreenQrOpen && selectedClient && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 border border-slate-200 shadow-2xl text-center space-y-6 animate-scale-up relative">
            <button onClick={() => setIsFullscreenQrOpen(false)} className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:bg-slate-100">
              <X className="w-5 h-5" />
            </button>

            <div>
              <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-mono text-[10px] font-bold">
                {selectedClient.uniqueQrId}
              </span>
              <h3 className="text-2xl font-bold font-heading text-slate-900 mt-2">
                {selectedClient.companyName}
              </h3>
            </div>

            <div className="w-64 h-64 bg-white p-4 rounded-3xl mx-auto border-4 border-purple-500 shadow-2xl relative flex items-center justify-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&ecc=H&margin=2&data=${encodeURIComponent(getScannableQrUrl(selectedClient.uniqueQrId))}`}
                alt={selectedClient.uniqueQrId}
                className="w-full h-full object-contain rounded-xl"
              />
              <img
                src={selectedClient.logoUrl}
                alt="Logo"
                className="absolute w-10 h-10 rounded-xl object-cover border-2 border-white shadow-lg bg-white"
              />
            </div>

            <a
              href={`https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&ecc=H&margin=2&data=${encodeURIComponent(getScannableQrUrl(selectedClient.uniqueQrId))}`}
              target="_blank"
              download={`${selectedClient.uniqueQrId}.png`}
              className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-mono font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-colors block"
            >
              <Download className="w-4 h-4" />
              <span>Download Ultra HD PNG</span>
            </a>
          </div>
        </div>
      )}

    </div>
  );
};
