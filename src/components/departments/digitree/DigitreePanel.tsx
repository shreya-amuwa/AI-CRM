import React, { useState } from 'react';
import { 
  TrendingUp, Headphones, ArrowRight, ArrowLeft, 
  QrCode, BarChart3, Send, Users, Sparkles, CheckCircle2, Clock, 
  Target, ExternalLink, UserCheck, X, Globe, FileSpreadsheet,
  Zap, Code, Share2, Filter, Search, Plus, Phone, Mail, UserPlus,
  Bot as RobotIcon, Building2, MessageSquare, Database, PhoneCall,
  CheckCircle, ArrowUpRight, Copy, Play, Check, ShieldCheck, Terminal,
  RefreshCw, Radio
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { useLeadStore } from '../../../context/LeadStoreContext';
import { VisualIngestionStreamAnimation } from '../../dashboard/VisualIngestionStreamAnimation';
import { DepartmentSalesOS } from '../shared/DepartmentSalesOS';
import { DEPARTMENT_SALES_CONFIGS } from '../../../data/departmentSalesData';

interface DigitreePanelProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onNavigateToLeads: () => void;
  subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  onSelectSubDept: (subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => void;
}

const LEAD_SOURCES_CONFIG: Record<string, { 
  title: string; name: string; port: string; endpoint: string; secret: string; desc: string; icon: any; color: string; bg: string; borderColor: string; dotColor: string; count: number; pct: string; sampleJson: string;
}> = {
  lead_src_1: { title: '1. WhatsApp API', name: 'WhatsApp API', port: 'Webhook Port #4080', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/whatsapp_api', secret: 'whsec_digi_wa_101', desc: 'Digitree software engineering & API leads.', icon: MessageSquare, color: 'text-emerald-600', bg: 'bg-emerald-50/70', borderColor: 'border-l-4 border-l-emerald-500 border-slate-200', dotColor: 'bg-emerald-500', count: 54, pct: '12.8%', sampleJson: JSON.stringify({ project: 'Custom SaaS Development', phone: '+919820112345' }, null, 2) },
  lead_src_2: { title: '2. Meta Ads', name: 'Meta Ads', port: 'Webhook Port #4081', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/meta_ads', secret: 'whsec_digi_meta_202', desc: 'Software engineering & cloud tech ad leads.', icon: Target, color: 'text-blue-600', bg: 'bg-blue-50/70', borderColor: 'border-l-4 border-l-blue-500 border-slate-200', dotColor: 'bg-blue-500', count: 46, pct: '10.9%', sampleJson: JSON.stringify({ ad_id: 'ad_digi_90', phone: '+919711054321' }, null, 2) },
  lead_src_3: { title: '3. Telecaller', name: 'Telecaller', port: 'Webhook Port #4082', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/telecaller', secret: 'whsec_digi_tele_303', desc: 'Enterprise software inquiry call logs.', icon: PhoneCall, color: 'text-amber-600', bg: 'bg-amber-50/70', borderColor: 'border-l-4 border-l-amber-500 border-slate-200', dotColor: 'bg-amber-500', count: 37, pct: '8.7%', sampleJson: JSON.stringify({ agent: 'Nikhil Mehta', phone: '+919810233445' }, null, 2) },
  lead_src_4: { title: '4. Business Developer', name: 'Business Developer', port: 'Webhook Port #4083', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/business_developer', secret: 'whsec_digi_bdm_404', desc: 'Cloud migration & software contract leads.', icon: UserPlus, color: 'text-purple-600', bg: 'bg-purple-50/70', borderColor: 'border-l-4 border-l-purple-500 border-slate-200', dotColor: 'bg-purple-500', count: 48, pct: '11.3%', sampleJson: JSON.stringify({ bdm: 'Arjun Kapoor', client: 'TCS Subcontract' }, null, 2) },
  lead_src_5: { title: '5. AI Calling', name: 'AI Calling', port: 'Webhook Port #4084', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/ai_calling', secret: 'whsec_digi_ai_505', desc: 'AI voice agent tech requirement gathering.', icon: RobotIcon, color: 'text-cyan-600', bg: 'bg-cyan-50/70', borderColor: 'border-l-4 border-l-cyan-500 border-slate-200', dotColor: 'bg-cyan-500', count: 42, pct: '9.9%', sampleJson: JSON.stringify({ req: 'AWS Cloud Architecture' }, null, 2) },
  lead_src_6: { title: '6. RCS Messages', name: 'RCS Messages', port: 'Webhook Port #4085', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/rcs_messages', secret: 'whsec_digi_rcs_606', desc: 'RCS app development catalog clicks.', icon: Send, color: 'text-pink-600', bg: 'bg-pink-50/70', borderColor: 'border-l-4 border-l-pink-500 border-slate-200', dotColor: 'bg-pink-500', count: 32, pct: '7.5%', sampleJson: JSON.stringify({ msisdn: '+919123456789' }, null, 2) },
  lead_src_7: { title: '7. Website', name: 'Website', port: 'Webhook Port #4086', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/website', secret: 'whsec_digi_web_707', desc: 'Digitree.in software inquiry form submissions.', icon: Globe, color: 'text-indigo-600', bg: 'bg-indigo-50/70', borderColor: 'border-l-4 border-l-indigo-500 border-slate-200', dotColor: 'bg-indigo-500', count: 59, pct: '13.9%', sampleJson: JSON.stringify({ url: 'https://digitree.in/contact' }, null, 2) },
  lead_src_8: { title: '8. References', name: 'References', port: 'Webhook Port #4087', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/references', secret: 'whsec_digi_ref_808', desc: 'Software client referrals.', icon: Share2, color: 'text-teal-600', bg: 'bg-teal-50/70', borderColor: 'border-l-4 border-l-teal-500 border-slate-200', dotColor: 'bg-teal-500', count: 34, pct: '8.0%', sampleJson: JSON.stringify({ client: 'Infosys Lead' }, null, 2) },
  lead_src_9: { title: '9. Cold Calling', name: 'Cold Calling', port: 'Webhook Port #4088', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/cold_calling', secret: 'whsec_digi_cold_909', desc: 'Outsourced engineering cold calls.', icon: Phone, color: 'text-orange-600', bg: 'bg-orange-50/70', borderColor: 'border-l-4 border-l-orange-500 border-slate-200', dotColor: 'bg-orange-500', count: 31, pct: '7.3%', sampleJson: JSON.stringify({ tech_stack: 'React + Node' }, null, 2) },
  lead_src_10: { title: '10. Third Party Sources', name: 'Third Party Sources', port: 'Webhook Port #4089', endpoint: 'https://api.amuwa.com/v1/webhooks/digitree/third_party_sources', secret: 'whsec_digi_3rd_010', desc: 'GitHub / Upwork / Clutch webhooks.', icon: Building2, color: 'text-rose-600', bg: 'bg-rose-50/70', borderColor: 'border-l-4 border-l-rose-500 border-slate-200', dotColor: 'bg-rose-500', count: 39, pct: '9.2%', sampleJson: JSON.stringify({ source: 'Clutch API Webhook' }, null, 2) }
};

export const DigitreePanel: React.FC<DigitreePanelProps> = ({ 
  activeTab, 
  onSelectTab,
  onNavigateToLeads,
  subDept,
  onSelectSubDept
}) => {
  const { getLeadsForDepartment, addWebhookLead } = useLeadStore();
  const leads = getLeadsForDepartment('digitree');

  const [selectedSubDeptForUsers, setSelectedSubDeptForUsers] = useState<'sales' | 'support' | 'education_training' | 'product_training' | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isInjectingWebhook, setIsInjectingWebhook] = useState(false);
  const [webhookSuccessMsg, setWebhookSuccessMsg] = useState<string | null>(null);

  const salesUsers = [{ name: 'Vikram Sethi', id: 'EMP-6601', email: 'vikram@digitree.in' }];
  const supportUsers = [{ name: 'Sunita Rao', id: 'EMP-2210', email: 'sunita@digitree.in' }];

  const defaultSampleLeads = [
    { id: 'DG-901', name: 'Manish Pandey', phone: '+91 98201 77889', email: 'manish@tech.in', company: 'Pandey Tech Solutions', status: 'New', time: '10:42 AM' }
  ];

  const [localChannelLeads, setLocalChannelLeads] = useState<Record<string, any[]>>({});

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
        id: `DG-${Math.floor(Math.random() * 899 + 100)}`,
        name: `Digitree ${cfg.name} Lead`,
        phone: '+91 98' + Math.floor(Math.random() * 8990000 + 1000000),
        email: `dev.${Math.floor(Math.random() * 900 + 100)}@digitree.in`,
        company: `${cfg.name} Cloud Client`,
        status: 'New',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setLocalChannelLeads(prev => ({
        ...prev,
        [srcKey]: [newLead, ...(prev[srcKey] || [])]
      }));

      addWebhookLead('digitree', 'whatsapp', { name: newLead.name, phone: newLead.phone });
      setIsInjectingWebhook(false);
      setWebhookSuccessMsg(`HTTP 200 OK: Webhook captured into Digitree ${cfg.name}!`);
      setTimeout(() => setWebhookSuccessMsg(null), 4000);
    }, 600);
  };

  // Route to the new Daily Sales Operating System for sales sub-department
  if (subDept === 'sales') {
    return (
      <DepartmentSalesOS
        config={DEPARTMENT_SALES_CONFIGS['digitree']}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        onNavigateToLeads={onNavigateToLeads}
        onBackToSelector={() => onSelectSubDept(null)}
      />
    );
  }

  if (!subDept) {
    return (
      <div className="space-y-8 animate-fade-in py-8 max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-50 border border-purple-200 text-purple-800 text-xs font-mono font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />
            <span>DIGITREE INFOTECH &bull; SOFTWARE &amp; CLOUD INFRASTRUCTURE</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold font-heading text-slate-900 tracking-tight">Select Digitree Sub-Department</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div onClick={() => onSelectSubDept('sales')} className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-purple-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md">
            <div className="h-1.5 w-full bg-gradient-to-r from-purple-600 to-indigo-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100 group-hover:scale-110 transition-transform"><TrendingUp className="w-8 h-8" /></div>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedSubDeptForUsers('sales'); }} className="px-3.5 py-1.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                  <Users className="w-3.5 h-3.5 text-purple-600" /><span>{salesUsers.length}/3 Active</span>
                </button>
              </div>
              <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-purple-600 transition-colors">Digitree Sales Department</h3>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-purple-700 transition-colors">
                <span>Enter Sales Panel</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          <div onClick={() => onSelectSubDept('support')} className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-indigo-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md">
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 to-purple-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 group-hover:scale-110 transition-transform"><Headphones className="w-8 h-8" /></div>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedSubDeptForUsers('support'); }} className="px-3.5 py-1.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                  <Users className="w-3.5 h-3.5 text-indigo-600" /><span>{supportUsers.length}/3 Active</span>
                </button>
              </div>
              <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-indigo-600 transition-colors">Digitree Support Department</h3>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-indigo-700 transition-colors">
                <span>Enter Support Panel</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </div>

        {selectedSubDeptForUsers && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2"><Users className="w-5 h-5 text-purple-600" /><h3 className="text-base font-bold font-heading text-slate-900 capitalize">Digitree {selectedSubDeptForUsers} Roster</h3></div>
                <button onClick={() => setSelectedSubDeptForUsers(null)} className="p-1 text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
              </div>
              {(selectedSubDeptForUsers === 'sales' ? salesUsers : supportUsers).map((usr, idx) => (
                <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs font-mono">
                  <div><strong className="text-slate-900 block">{usr.name}</strong><span className="text-[10px] text-slate-400">{usr.email}</span></div>
                  <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[9px] font-bold">ACTIVE</span>
                </div>
              ))}
              <button onClick={() => setSelectedSubDeptForUsers(null)} className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-mono font-bold">Close</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const activeSourceConfig = LEAD_SOURCES_CONFIG[activeTab];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => onSelectSubDept(null)} className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-mono font-bold flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4 text-purple-600" /><span>Change Sub-Department</span>
          </button>
          <div>
            <h2 className="text-xl font-bold font-heading text-slate-900 uppercase">Digitree {subDept} Department Panel</h2>
            <p className="text-xs font-mono text-slate-500">Software Engineering &amp; Webhook Control</p>
          </div>
        </div>
        <span className="px-3.5 py-1.5 rounded-full font-mono text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200 uppercase">{subDept} WORKSPACE</span>
      </div>

      {subDept === 'support' && (
        <div className="space-y-6 animate-fade-in">
          {activeTab === 'dashboard' && (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-100 text-purple-700 text-xs font-mono font-bold mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600 animate-pulse" /><span>10-SOURCE VISUAL INGESTION STREAM</span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">10 Inbound Webhook Sources &rarr; Unified Lead Store</h3>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-right min-w-[180px]">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-semibold block">CONVERGED TOTAL</span>
                  <span className="text-3xl font-bold font-mono text-purple-600 block">424</span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center">
                <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(LEAD_SOURCES_CONFIG).map(([key, src]) => (
                    <div key={key} onClick={() => onSelectTab && onSelectTab(key as ActiveTab)} className={`p-3 rounded-2xl bg-white border ${src.borderColor} hover:border-purple-500 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group shadow-2xs`}>
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${src.dotColor} animate-pulse shrink-0`} />
                        <div><h4 className="font-bold text-xs text-slate-900 group-hover:text-purple-600 transition-colors">{src.name}</h4><span className="text-[10px] font-mono text-slate-400 block">{src.port}</span></div>
                      </div>
                      <div className="text-right"><span className="text-xs font-bold font-mono text-purple-600 block">{src.count}</span><span className="text-[9px] font-mono text-slate-400 block">{src.pct}</span></div>
                    </div>
                  ))}
                </div>

                <div className="hidden lg:col-span-1 lg:flex items-center justify-center">
                  <VisualIngestionStreamAnimation />
                </div>

                <div className="lg:col-span-4 bg-slate-50/80 border border-purple-100 rounded-3xl p-6 flex flex-col items-center text-center justify-center space-y-4 shadow-sm">
                  <div className="w-16 h-16 rounded-2xl bg-purple-100 border border-purple-200 text-purple-600 flex items-center justify-center shadow-xs"><Database className="w-8 h-8" /></div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono text-purple-700 uppercase font-bold tracking-wider block">SINGLE UNIFIED STORE</span>
                    <h4 className="text-xl font-bold font-heading text-slate-900">Digitree Lead Database</h4>
                  </div>
                  <button onClick={onNavigateToLeads} className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-mono font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm mt-2">
                    <span>View Unified Database</span><ArrowUpRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSourceConfig && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className={`p-4 rounded-2xl border ${activeSourceConfig.bg}`}><activeSourceConfig.icon className={`w-7 h-7 ${activeSourceConfig.color}`} /></div>
                  <div>
                    <h3 className="text-xl font-bold font-heading text-slate-900">{activeSourceConfig.title}</h3>
                    <p className="text-xs font-mono text-slate-500 mt-0.5">{activeSourceConfig.desc}</p>
                  </div>
                </div>
                <button onClick={() => handleSimulateWebhookPayload(activeTab)} disabled={isInjectingWebhook} className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center gap-2 shadow-sm">
                  {isInjectingWebhook ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>Test Webhook Payload</span>
                </button>
              </div>

              {webhookSuccessMsg && (
                <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 font-mono text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-purple-600 shrink-0" /><span>{webhookSuccessMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2"><Terminal className="w-5 h-5 text-slate-700" /><h4 className="font-bold text-sm font-heading text-slate-900">Dedicated Webhook Endpoint</h4></div>
                    <span className="px-2.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-mono font-bold">HTTP POST</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-mono text-slate-400 uppercase font-bold block mb-1">Target Ingestion URL</label>
                      <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800">
                        <span className="truncate flex-1 font-semibold">{activeSourceConfig.endpoint}</span>
                        <button onClick={() => handleCopyText(activeSourceConfig.endpoint, 'url')} className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600">
                          {copiedKey === 'url' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 rounded-3xl bg-slate-900 text-slate-100 shadow-sm space-y-3 flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-sm font-mono text-white pb-2 border-b border-slate-800">Webhook JSON Schema Payload</h4>
                    <pre className="mt-3 p-4 bg-slate-950 rounded-2xl font-mono text-xs text-purple-400 overflow-x-auto border border-slate-800 max-h-[160px]">{activeSourceConfig.sampleJson}</pre>
                  </div>
                  <button onClick={() => handleSimulateWebhookPayload(activeTab)} disabled={isInjectingWebhook} className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center justify-center gap-2">
                    <Play className="w-4 h-4 fill-current" /><span>Simulate Inbound Webhook Event</span>
                  </button>
                </div>
              </div>

              <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
                <h4 className="font-bold text-base font-heading text-slate-900">Leads Captured via {activeSourceConfig.name} Webhook</h4>
                <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 font-mono text-slate-500 uppercase">
                      <tr><th className="p-3.5">Lead Contact</th><th className="p-3.5">Company</th><th className="p-3.5">Timestamp</th><th className="p-3.5">Status</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(localChannelLeads[activeTab] || defaultSampleLeads).map((lead, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors font-mono">
                          <td className="p-3.5 font-bold text-slate-900 font-sans">{lead.name}<span className="text-[11px] text-slate-400 font-mono block">{lead.phone}</span></td>
                          <td className="p-3.5 text-slate-700 font-semibold">{lead.company}</td>
                          <td className="p-3.5 text-slate-500">{lead.time}</td>
                          <td className="p-3.5"><span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">Captured</span></td>
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
