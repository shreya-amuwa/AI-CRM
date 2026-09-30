import React, { useState } from 'react';
import { 
  TrendingUp, Headphones, ArrowRight, ArrowLeft, 
  MessageCircle, Bot, Send, Users, Sparkles, CheckCircle2, Clock, 
  Target, ExternalLink, UserCheck, X, Globe, QrCode, FileSpreadsheet,
  Zap, Code, Share2, Filter, Search, Plus, Phone, Mail, UserPlus,
  Bot as RobotIcon, Building2, MessageSquare, PhoneCall, Database,
  CheckCircle, ArrowUpRight, Copy, Play, Check, ShieldCheck, Terminal,
  RefreshCw, Radio
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { useLeadStore } from '../../../context/LeadStoreContext';

import { VisualIngestionStreamAnimation } from '../../dashboard/VisualIngestionStreamAnimation';
import { DepartmentSalesOS } from '../shared/DepartmentSalesOS';
import { DEPARTMENT_SALES_CONFIGS } from '../../../data/departmentSalesData';

interface WhatsboxPanelProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onNavigateToLeads: () => void;
  whatsboxSubDept: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  onSelectSubDept: (subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => void;
}

// 10 Exact Lead Generation Sources with Dedicated Webhook Endpoints
const LEAD_SOURCES_CONFIG: Record<string, { 
  title: string; 
  name: string; 
  port: string; 
  endpoint: string;
  secret: string;
  desc: string; 
  icon: any; 
  color: string; 
  bg: string; 
  borderColor: string; 
  dotColor: string; 
  count: number; 
  pct: string;
  sampleJson: string;
}> = {
  lead_src_1: { 
    title: '1. WhatsApp API', 
    name: 'WhatsApp API', 
    port: 'Webhook Port #1080', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/whatsapp_api',
    secret: 'whsec_wa_api_9901827461',
    desc: 'Direct lead submissions via official WhatsApp Business API endpoints.', 
    icon: MessageSquare, 
    color: 'text-emerald-600', 
    bg: 'bg-emerald-50/70', 
    borderColor: 'border-l-4 border-l-emerald-500 border-slate-200', 
    dotColor: 'bg-emerald-500', 
    count: 40, 
    pct: '10.3%',
    sampleJson: JSON.stringify({ event: 'whatsapp_message_received', from: '+919820112345', name: 'Rajesh Sharma', message: 'Hi, I need Meta WhatsApp API automation for my retail chain.', timestamp: new Date().toISOString() }, null, 2)
  },
  lead_src_2: { 
    title: '2. Meta Ads', 
    name: 'Meta Ads', 
    port: 'Webhook Port #1081', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/meta_ads',
    secret: 'whsec_meta_ads_8817263510',
    desc: 'Leads captured directly from Facebook & Instagram sponsored lead form ads.', 
    icon: Target, 
    color: 'text-blue-600', 
    bg: 'bg-blue-50/70', 
    borderColor: 'border-l-4 border-l-blue-500 border-slate-200', 
    dotColor: 'bg-blue-500', 
    count: 37, 
    pct: '9.6%',
    sampleJson: JSON.stringify({ ad_id: 'ad_fb_9021', campaign: 'Q3 Enterprise Lead Gen', full_name: 'Ananya Verma', email: 'ananya@techcorp.com', phone: '+919711054321' }, null, 2)
  },
  lead_src_3: { 
    title: '3. Telecaller', 
    name: 'Telecaller', 
    port: 'Webhook Port #1082', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/telecaller',
    secret: 'whsec_telecaller_7726154091',
    desc: 'Inbound & outbound telecalling representative lead entries.', 
    icon: PhoneCall, 
    color: 'text-amber-600', 
    bg: 'bg-amber-50/70', 
    borderColor: 'border-l-4 border-l-amber-500 border-slate-200', 
    dotColor: 'bg-amber-500', 
    count: 33, 
    pct: '8.5%',
    sampleJson: JSON.stringify({ agent_id: 'TEL-402', caller_name: 'Vikram Sethi', phone: '+919810233445', disposition: 'High Intent Lead', notes: 'Wants product demo tomorrow 3 PM' }, null, 2)
  },
  lead_src_4: { 
    title: '4. Business Developer', 
    name: 'Business Developer', 
    port: 'Webhook Port #1083', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/business_developer',
    secret: 'whsec_bdm_6615243981',
    desc: 'Direct corporate field leads submitted by BDM staff.', 
    icon: UserPlus, 
    color: 'text-purple-600', 
    bg: 'bg-purple-50/70', 
    borderColor: 'border-l-4 border-l-purple-500 border-slate-200', 
    dotColor: 'bg-purple-500', 
    count: 44, 
    pct: '11.4%',
    sampleJson: JSON.stringify({ bdm_name: 'Priya Mehta', client_company: 'Patel Logistics Ltd', contact_person: 'Karan Patel', phone: '+919930088776', deal_size: '₹5,00,000' }, null, 2)
  },
  lead_src_5: { 
    title: '5. AI Calling', 
    name: 'AI Calling', 
    port: 'Webhook Port #1084', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/ai_calling',
    secret: 'whsec_aicall_5504132871',
    desc: 'Automated AI voice agent outbound calling qualification.', 
    icon: RobotIcon, 
    color: 'text-cyan-600', 
    bg: 'bg-cyan-50/70', 
    borderColor: 'border-l-4 border-l-cyan-500 border-slate-200', 
    dotColor: 'bg-cyan-500', 
    count: 42, 
    pct: '10.9%',
    sampleJson: JSON.stringify({ call_id: 'call_ai_8892', prospect_phone: '+919876543210', transcript_summary: 'Qualified lead interested in Whatsbox Pro Plan', sentiment: 'Positive' }, null, 2)
  },
  lead_src_6: { 
    title: '6. RCS Messages', 
    name: 'RCS Messages', 
    port: 'Webhook Port #1085', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/rcs_messages',
    secret: 'whsec_rcs_4493021761',
    desc: 'Rich Communication Services interactive messaging leads.', 
    icon: Send, 
    color: 'text-pink-600', 
    bg: 'bg-pink-50/70', 
    borderColor: 'border-l-4 border-l-pink-500 border-slate-200', 
    dotColor: 'bg-pink-500', 
    count: 40, 
    pct: '10.3%',
    sampleJson: JSON.stringify({ rcs_button_clicked: 'REQUEST_PRICING', msisdn: '+919123456789', name: 'Sanjay Dutt', rcs_campaign: 'Diwali Special Offer' }, null, 2)
  },
  lead_src_7: { 
    title: '7. Website', 
    name: 'Website', 
    port: 'Webhook Port #1086', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/website',
    secret: 'whsec_web_3382910651',
    desc: 'Organic lead forms from amuwa.com & whatsbox.in portals.', 
    icon: Globe, 
    color: 'text-indigo-600', 
    bg: 'bg-indigo-50/70', 
    borderColor: 'border-l-4 border-l-indigo-500 border-slate-200', 
    dotColor: 'bg-indigo-500', 
    count: 35, 
    pct: '9.0%',
    sampleJson: JSON.stringify({ page_url: 'https://amuwa.com/whatsbox', form_id: 'contact_form_footer', name: 'Megha Roy', email: 'megha@designstudio.in', phone: '+919988776655' }, null, 2)
  },
  lead_src_8: { 
    title: '8. References', 
    name: 'References', 
    port: 'Webhook Port #1087', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/references',
    secret: 'whsec_ref_2271809541',
    desc: 'Client referral program & partner word-of-mouth leads.', 
    icon: Share2, 
    color: 'text-teal-600', 
    bg: 'bg-teal-50/70', 
    borderColor: 'border-l-4 border-l-teal-500 border-slate-200', 
    dotColor: 'bg-teal-500', 
    count: 48, 
    pct: '12.4%',
    sampleJson: JSON.stringify({ referrer_client_id: 'CLT-809', referred_name: 'Rahul Nair', phone: '+919876001122', email: 'rahul@nairventures.com' }, null, 2)
  },
  lead_src_9: { 
    title: '9. Cold Calling', 
    name: 'Cold Calling', 
    port: 'Webhook Port #1088', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/cold_calling',
    secret: 'whsec_cold_1160798431',
    desc: 'Targeted cold call outreach prospecting entries.', 
    icon: Phone, 
    color: 'text-orange-600', 
    bg: 'bg-orange-50/70', 
    borderColor: 'border-l-4 border-l-orange-500 border-slate-200', 
    dotColor: 'bg-orange-500', 
    count: 31, 
    pct: '8.0%',
    sampleJson: JSON.stringify({ list_name: 'B2B Manufacturing Directory', prospect_name: 'Harish Rao', phone: '+919911223344', interested_in: 'API Integration' }, null, 2)
  },
  lead_src_10: { 
    title: '10. Third Party Sources', 
    name: 'Third Party Sources', 
    port: 'Webhook Port #1089', 
    endpoint: 'https://api.amuwa.com/v1/webhooks/whatsbox/third_party_sources',
    secret: 'whsec_3rdparty_0059687321',
    desc: 'External aggregator webhooks and partner API feeds.', 
    icon: Building2, 
    color: 'text-rose-600', 
    bg: 'bg-rose-50/70', 
    borderColor: 'border-l-4 border-l-rose-500 border-slate-200', 
    dotColor: 'bg-rose-500', 
    count: 37, 
    pct: '9.6%',
    sampleJson: JSON.stringify({ provider: 'JustDial / TradeIndia Ingest', lead_id: 'JD-90182', contact_name: 'Sunil Kumar', phone: '+919844332211', city: 'Mumbai' }, null, 2)
  }
};

export const WhatsboxPanel: React.FC<WhatsboxPanelProps> = ({ 
  activeTab, 
  onSelectTab,
  onNavigateToLeads,
  whatsboxSubDept,
  onSelectSubDept
}) => {
  const { getLeadsForDepartment, addWebhookLead } = useLeadStore();
  const leads = getLeadsForDepartment('whatsbox');

  // Sub-unit active user modal state
  const [selectedSubDeptForUsers, setSelectedSubDeptForUsers] = useState<'sales' | 'support' | 'education_training' | 'product_training' | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isInjectingWebhook, setIsInjectingWebhook] = useState(false);
  const [webhookSuccessMsg, setWebhookSuccessMsg] = useState<string | null>(null);

  // Mock Active User Sessions per sub-department (Max 3 each)
  const salesUsers = [
    { name: 'Priya Mehta', id: 'EMP-9041', email: 'priya.mehta@whatsbox.in' }
  ];
  const supportUsers = [
    { name: 'Alexander Wright', id: 'EMP-1102', email: 'alex.wright@whatsbox.in' }
  ];

  // Lead Source specific sample leads
  const defaultSampleLeads = [
    { id: 'LD-901', name: 'Rajesh Sharma', phone: '+91 98201 12345', email: 'rajesh@retailhub.in', company: 'RetailHub Pvt Ltd', status: 'New', time: '10:42 AM' },
    { id: 'LD-902', name: 'Ananya Verma', phone: '+91 97110 54321', email: 'ananya@techcorp.com', company: 'TechCorp Solutions', status: 'Contacted', time: '09:15 AM' },
    { id: 'LD-903', name: 'Karan Patel', phone: '+91 99300 88776', email: 'karan@logistics.co', company: 'Patel Logistics', status: 'Qualified', time: 'Yesterday' }
  ];

  const [localChannelLeads, setLocalChannelLeads] = useState<Record<string, any[]>>({
    lead_src_1: [
      { id: 'LD-901', name: 'Rajesh Sharma', phone: '+91 98201 12345', email: 'rajesh@retailhub.in', company: 'RetailHub Pvt Ltd', status: 'New', time: '10:42 AM' },
      { id: 'LD-902', name: 'Ananya Verma', phone: '+91 97110 54321', email: 'ananya@techcorp.com', company: 'TechCorp Solutions', status: 'Contacted', time: '09:15 AM' }
    ]
  });

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSimulateWebhookPayload = (srcKey: string) => {
    setIsInjectingWebhook(true);
    setWebhookSuccessMsg(null);

    const cfg = LEAD_SOURCES_CONFIG[srcKey];
    setTimeout(() => {
      const newLead = {
        id: `LD-${Math.floor(Math.random() * 899 + 100)}`,
        name: `Captured ${cfg.name} Lead`,
        phone: '+91 98' + Math.floor(Math.random() * 8990000 + 1000000),
        email: `lead.${Math.floor(Math.random() * 900 + 100)}@whatsbox.in`,
        company: `${cfg.name} Inbound Direct`,
        status: 'New',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setLocalChannelLeads(prev => ({
        ...prev,
        [srcKey]: [newLead, ...(prev[srcKey] || [])]
      }));

      // Also push into global lead store
      addWebhookLead('whatsbox', 'whatsapp', {
        name: newLead.name,
        phone: newLead.phone,
        email: newLead.email,
        company: newLead.company
      });

      setIsInjectingWebhook(false);
      setWebhookSuccessMsg(`HTTP 200 OK: Webhook payload captured successfully into ${cfg.name}!`);
      setTimeout(() => setWebhookSuccessMsg(null), 4000);
    }, 600);
  };

  // Route to the new Daily Sales Operating System for sales sub-department
  if (whatsboxSubDept === 'sales') {
    return (
      <DepartmentSalesOS
        config={DEPARTMENT_SALES_CONFIGS['whatsbox']}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        onNavigateToLeads={onNavigateToLeads}
        onBackToSelector={() => onSelectSubDept(null)}
      />
    );
  }

  // STEP 1: SUB-DEPARTMENT SELECTOR GRID SCREEN (WITH SUB-UNIT ACTIVE USERS COUNT BADGE MAX 3)
  if (!whatsboxSubDept) {
    return (
      <div className="space-y-8 animate-fade-in py-8 max-w-5xl mx-auto">
        
        {/* Header Title */}
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-mono font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>WHATSBOX &bull; META OFFICIAL PARTNERS</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold font-heading text-slate-900 tracking-tight">
            Select Whatsbox Sub-Department
          </h2>
        </div>

        {/* 2 Dedicated Cards Grid (Sales vs Support) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* CARD 1: WHATSBOX SALES DEPARTMENT */}
          <div
            onClick={() => onSelectSubDept('sales')}
            className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-blue-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 to-indigo-600 absolute top-0 left-0 right-0" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 group-hover:scale-110 transition-transform">
                  <TrendingUp className="w-8 h-8" />
                </div>

                {/* Sub-Department Active Users Count Badge (Max 3 Each) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubDeptForUsers('sales');
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 font-mono text-xs font-bold flex items-center gap-1.5 hover:bg-blue-100 transition-colors shadow-2xs"
                  title="Click to view active logged-in sales team"
                >
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  <span>{salesUsers.length}/3 Active</span>
                </button>
              </div>

              <div>
                <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-blue-600 transition-colors">
                  Whatsbox Sales Department
                </h3>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-blue-700 transition-colors">
                <span>Enter Sales Panel</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          {/* CARD 2: WHATSBOX SUPPORT DEPARTMENT */}
          <div
            onClick={() => onSelectSubDept('support')}
            className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-emerald-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 to-teal-600 absolute top-0 left-0 right-0" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 group-hover:scale-110 transition-transform">
                  <Headphones className="w-8 h-8" />
                </div>

                {/* Sub-Department Active Users Count Badge (Max 3 Each) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubDeptForUsers('support');
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-100 transition-colors shadow-2xs"
                  title="Click to view active logged-in support team"
                >
                  <Users className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{supportUsers.length}/3 Active</span>
                </button>
              </div>

              <div>
                <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-emerald-600 transition-colors">
                  Whatsbox Support Department
                </h3>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-emerald-700 transition-colors">
                <span>Enter Support Panel</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

        </div>

        {/* SUB-DEPARTMENT ACTIVE USERS NAMES MODAL */}
        {selectedSubDeptForUsers && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl animate-scale-up space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold font-heading text-slate-900 capitalize">
                      Whatsbox {selectedSubDeptForUsers} Sub-Department
                    </h3>
                    <span className="text-[10px] font-mono text-slate-500">Active Staff Roster (Max 3 Users)</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedSubDeptForUsers(null)}
                  className="p-1 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                {(selectedSubDeptForUsers === 'sales' ? salesUsers : supportUsers).map((usr, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-[10px]">
                        {usr.name.charAt(0)}
                      </div>
                      <div>
                        <strong className="text-slate-900 block">{usr.name}</strong>
                        <span className="text-[10px] text-slate-400">{usr.email}</span>
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                      ACTIVE USER
                    </span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setSelectedSubDeptForUsers(null)}
                className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-mono font-bold"
              >
                Close
              </button>
            </div>
          </div>
        )}

      </div>
    );
  }

  // STEP 2: INSIDE SELECTED SUB-DEPARTMENT PANEL
  const activeSourceConfig = LEAD_SOURCES_CONFIG[activeTab];

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectSubDept(null)}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-blue-600" />
            <span>Change Sub-Department</span>
          </button>

          <div>
            <h2 className="text-xl font-bold font-heading text-slate-900 uppercase">
              Whatsbox Support Operations Panel
            </h2>
            <p className="text-xs font-mono text-slate-500">
              10 Lead Generation Ways & Dedicated Webhooks &bull; www.whatsbox.in
            </p>
          </div>
        </div>

        <span className="px-3.5 py-1.5 rounded-full font-mono text-xs font-bold border bg-emerald-50 text-emerald-800 border-emerald-200">
          SUPPORT WORKSPACE
        </span>
      </div>

      {/* WHATSBOX SUPPORT PANEL VIEW */}
      {whatsboxSubDept === 'support' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* TAB 1: SUPPORT DASHBOARD WITH INTERACTIVE 10-SOURCE VISUAL INGESTION STREAM */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              
              {/* Header Title Section */}
              <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
                
                {/* Top Badge & Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-mono font-bold mb-2">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                      <span>10-SOURCE VISUAL INGESTION STREAM</span>
                    </div>
                    <h3 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">
                      10 Inbound Webhook Sources &rarr; Unified Lead Store
                    </h3>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-right min-w-[180px]">
                    <span className="text-[10px] font-mono text-slate-400 uppercase font-semibold block tracking-wider">CONVERGED TOTAL STORE</span>
                    <span className="text-3xl font-bold font-mono text-blue-600 block mt-0.5">387</span>
                    <span className="text-[10px] font-mono text-slate-500 font-bold uppercase block mt-0.5">LEADS INGESTED</span>
                  </div>
                </div>

                {/* Main Visual Stream Layout: Left 10 Interactive Source Cards + Middle Stream + Right Converging Stream */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center">
                  
                  {/* Left Column (7 cols): 10 Interactive Source Cards in 2 Grid Columns */}
                  <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Object.entries(LEAD_SOURCES_CONFIG).map(([key, src]) => {
                      return (
                        <div
                          key={key}
                          onClick={() => onSelectTab && onSelectTab(key as ActiveTab)}
                          className={`p-3 rounded-2xl bg-white border ${src.borderColor} hover:border-blue-500 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group shadow-2xs`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${src.dotColor} animate-pulse shrink-0`} />
                            <div>
                              <h4 className="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition-colors">
                                {src.name}
                              </h4>
                              <span className="text-[10px] font-mono text-slate-400 block">{src.port}</span>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-xs font-bold font-mono text-blue-600 block">{src.count}</span>
                            <span className="text-[9px] font-mono text-slate-400 block">{src.pct}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Middle Column (1 col): Animated Converging Data Stream Graphics */}
                  <div className="hidden lg:col-span-1 lg:flex items-center justify-center">
                    <VisualIngestionStreamAnimation />
                  </div>

                  {/* Right Column (4 cols): Single Unified Lead Store Converging Box */}
                  <div className="lg:col-span-4 bg-slate-50/80 border border-blue-100 rounded-3xl p-6 flex flex-col items-center text-center justify-center space-y-4 shadow-sm relative">
                    <div className="w-16 h-16 rounded-2xl bg-blue-100 border border-blue-200 text-blue-600 flex items-center justify-center shadow-xs">
                      <Database className="w-8 h-8" />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-blue-700 uppercase font-bold tracking-wider block">SINGLE UNIFIED STORE</span>
                      <h4 className="text-xl font-bold font-heading text-slate-900">Normalized Lead Database</h4>
                      <p className="text-xs text-slate-500 font-sans leading-relaxed">
                        All 10 source payloads are automatically parsed into this single shared table schema.
                      </p>
                    </div>

                    <div className="w-full pt-3 border-t border-slate-200/80 space-y-1.5 text-xs font-mono">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Active Endpoints:</span>
                        <strong className="text-emerald-600 font-bold">10 / 10 Active</strong>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Sync Mode:</span>
                        <strong className="text-blue-600 font-bold">Real-time Push</strong>
                      </div>
                    </div>

                    <button
                      onClick={onNavigateToLeads}
                      className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm mt-2"
                    >
                      <span>View Unified Database</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* TABS 2 - 11: SPECIFIC LEAD GENERATION SOURCE WORKSPACE WITH DEDICATED WEBHOOK CONNECTOR */}
          {activeSourceConfig && (
            <div className="space-y-6 animate-fade-in">
              
              {/* Header Title for this Lead Source */}
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className={`p-4 rounded-2xl border ${activeSourceConfig.bg}`}>
                    <activeSourceConfig.icon className={`w-7 h-7 ${activeSourceConfig.color}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold font-heading text-slate-900">{activeSourceConfig.title}</h3>
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold border border-emerald-300 flex items-center gap-1">
                        <Radio className="w-3 h-3 text-emerald-600 animate-pulse" />
                        <span>{activeSourceConfig.port}</span>
                      </span>
                    </div>
                    <p className="text-xs font-mono text-slate-500 mt-1">{activeSourceConfig.desc}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleSimulateWebhookPayload(activeTab)}
                    disabled={isInjectingWebhook}
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center gap-2 transition-all shadow-sm"
                  >
                    {isInjectingWebhook ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 fill-current" />
                    )}
                    <span>{isInjectingWebhook ? 'Receiving Webhook...' : 'Test Webhook Payload'}</span>
                  </button>
                </div>
              </div>

              {/* Success Notification Alert */}
              {webhookSuccessMsg && (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-mono text-xs flex items-center justify-between animate-fade-in shadow-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{webhookSuccessMsg}</span>
                  </div>
                </div>
              )}

              {/* DEDICATED WEBHOOK CONNECTOR & PAYLOAD DETAILS */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 1. Webhook Connection Endpoint Card */}
                <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-slate-700" />
                      <h4 className="font-bold text-sm font-heading text-slate-900">Dedicated Webhook Endpoint</h4>
                    </div>
                    <span className="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold">
                      HTTP POST
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-mono text-slate-400 uppercase font-bold block mb-1">
                        Target Ingestion URL ({activeSourceConfig.name})
                      </label>
                      <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800">
                        <span className="truncate flex-1 font-semibold">{activeSourceConfig.endpoint}</span>
                        <button
                          onClick={() => handleCopyText(activeSourceConfig.endpoint, 'url')}
                          className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                          title="Copy Webhook URL"
                        >
                          {copiedKey === 'url' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono text-slate-400 uppercase font-bold block mb-1">
                        Webhook Secret Signature Token
                      </label>
                      <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800">
                        <span className="truncate flex-1 font-semibold">{activeSourceConfig.secret}</span>
                        <button
                          onClick={() => handleCopyText(activeSourceConfig.secret, 'token')}
                          className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                          title="Copy Secret Token"
                        >
                          {copiedKey === 'token' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-100 text-slate-600 text-xs font-mono space-y-1">
                      <div className="flex items-center gap-1.5 text-blue-800 font-bold">
                        <ShieldCheck className="w-4 h-4 text-blue-600" />
                        <span>Meta API Protocol Verified</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Payloads sent to this endpoint are automatically validated and normalized into the unified lead store.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Webhook JSON Sample Payload */}
                <div className="p-6 rounded-3xl bg-slate-900 text-slate-100 shadow-sm space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Code className="w-5 h-5 text-blue-400" />
                        <h4 className="font-bold text-sm font-mono text-white">Webhook JSON Schema Payload</h4>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">Content-Type: application/json</span>
                    </div>

                    <pre className="mt-3 p-4 bg-slate-950 rounded-2xl font-mono text-xs text-blue-300 overflow-x-auto border border-slate-800 max-h-[160px]">
                      {activeSourceConfig.sampleJson}
                    </pre>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => handleSimulateWebhookPayload(activeTab)}
                      disabled={isInjectingWebhook}
                      className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Simulate Inbound Webhook Event</span>
                    </button>
                  </div>
                </div>

              </div>

              {/* Live Captured Leads Table for this Specific Source */}
              <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-base font-heading text-slate-900">
                    Leads Captured via {activeSourceConfig.name} Webhook
                  </h4>
                  <span className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 font-mono text-xs font-bold text-slate-700">
                    {(localChannelLeads[activeTab] || []).length + 3} Captured
                  </span>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 font-mono text-slate-500 uppercase">
                      <tr>
                        <th className="p-3.5">Lead Name &amp; Contact</th>
                        <th className="p-3.5">Company / Organization</th>
                        <th className="p-3.5">Timestamp</th>
                        <th className="p-3.5">Webhook Ingest Source</th>
                        <th className="p-3.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(localChannelLeads[activeTab] || defaultSampleLeads).map((lead, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors font-mono">
                          <td className="p-3.5 font-bold text-slate-900 font-sans">
                            {lead.name}
                            <span className="text-[11px] text-slate-400 font-mono block">{lead.phone} &bull; {lead.email}</span>
                          </td>
                          <td className="p-3.5 text-slate-700 font-semibold">{lead.company}</td>
                          <td className="p-3.5 text-slate-500">{lead.time}</td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200">
                              {activeSourceConfig.name} ({activeSourceConfig.port})
                            </span>
                          </td>
                          <td className="p-3.5">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Captured
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
};
