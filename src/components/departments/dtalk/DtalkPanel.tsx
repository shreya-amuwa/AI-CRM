import React, { useState } from 'react';
import { 
  TrendingUp, Headphones, ArrowRight, ArrowLeft, 
  PhoneCall, PhoneForwarded, Send, Users, Sparkles, CheckCircle2, Clock, 
  Target, ExternalLink, UserCheck, X, Globe, QrCode, FileSpreadsheet,
  Zap, Code, Share2, Filter, Search, Plus, Phone, Mail, UserPlus,
  Bot as RobotIcon, Building2, MessageSquare, Database,
  CheckCircle, ArrowUpRight, Copy, Play, Check, ShieldCheck, Terminal,
  RefreshCw, Radio
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { useLeadStore } from '../../../context/LeadStoreContext';
import { VisualIngestionStreamAnimation } from '../../dashboard/VisualIngestionStreamAnimation';
import { DepartmentSalesOS } from '../shared/DepartmentSalesOS';
import { DEPARTMENT_SALES_CONFIGS } from '../../../data/departmentSalesData';

interface DtalkPanelProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onNavigateToLeads: () => void;
  subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  onSelectSubDept: (subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => void;
}

const LEAD_SOURCES_CONFIG: Record<string, { 
  title: string; name: string; port: string; endpoint: string; secret: string; desc: string; icon: any; color: string; bg: string; borderColor: string; dotColor: string; count: number; pct: string; sampleJson: string;
}> = {
  lead_src_1: { title: '1. WhatsApp API', name: 'WhatsApp API', port: 'Webhook Port #3080', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/whatsapp_api', secret: 'whsec_dtalk_wa_101', desc: 'D Talk enterprise voice & WhatsApp SIP triggers.', icon: MessageSquare, color: 'text-emerald-600', bg: 'bg-emerald-50/70', borderColor: 'border-l-4 border-l-emerald-500 border-slate-200', dotColor: 'bg-emerald-500', count: 64, pct: '14.2%', sampleJson: JSON.stringify({ event: 'sip_whatsapp_trigger', phone: '+919820112345' }, null, 2) },
  lead_src_2: { title: '2. Meta Ads', name: 'Meta Ads', port: 'Webhook Port #3081', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/meta_ads', secret: 'whsec_dtalk_meta_202', desc: 'Enterprise voice trunking ad lead submissions.', icon: Target, color: 'text-blue-600', bg: 'bg-blue-50/70', borderColor: 'border-l-4 border-l-blue-500 border-slate-200', dotColor: 'bg-blue-500', count: 42, pct: '9.3%', sampleJson: JSON.stringify({ campaign: 'Cloud IVR 2026', phone: '+919711054321' }, null, 2) },
  lead_src_3: { title: '3. Telecaller', name: 'Telecaller', port: 'Webhook Port #3082', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/telecaller', secret: 'whsec_dtalk_tele_303', desc: 'Cloud call center representative log entries.', icon: PhoneCall, color: 'text-amber-600', bg: 'bg-amber-50/70', borderColor: 'border-l-4 border-l-amber-500 border-slate-200', dotColor: 'bg-amber-500', count: 58, pct: '12.8%', sampleJson: JSON.stringify({ agent: 'Vikram Sethi', call_duration: '4m 12s' }, null, 2) },
  lead_src_4: { title: '4. Business Developer', name: 'Business Developer', port: 'Webhook Port #3083', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/business_developer', secret: 'whsec_dtalk_bdm_404', desc: 'B2B telecom infrastructure proposal requests.', icon: UserPlus, color: 'text-purple-600', bg: 'bg-purple-50/70', borderColor: 'border-l-4 border-l-purple-500 border-slate-200', dotColor: 'bg-purple-500', count: 39, pct: '8.6%', sampleJson: JSON.stringify({ company: 'Reliance Communications', contact: '+919930088776' }, null, 2) },
  lead_src_5: { title: '5. AI Calling', name: 'AI Calling', port: 'Webhook Port #3084', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/ai_calling', secret: 'whsec_dtalk_ai_505', desc: 'Conversational voice bot pre-qualification results.', icon: RobotIcon, color: 'text-cyan-600', bg: 'bg-cyan-50/70', borderColor: 'border-l-4 border-l-cyan-500 border-slate-200', dotColor: 'bg-cyan-500', count: 47, pct: '10.4%', sampleJson: JSON.stringify({ bot: 'IVR Bot #4', qualified: true }, null, 2) },
  lead_src_6: { title: '6. RCS Messages', name: 'RCS Messages', port: 'Webhook Port #3085', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/rcs_messages', secret: 'whsec_dtalk_rcs_606', desc: 'RCS voice demo booking submissions.', icon: Send, color: 'text-pink-600', bg: 'bg-pink-50/70', borderColor: 'border-l-4 border-l-pink-500 border-slate-200', dotColor: 'bg-pink-500', count: 31, pct: '6.8%', sampleJson: JSON.stringify({ msisdn: '+919123456789' }, null, 2) },
  lead_src_7: { title: '7. Website', name: 'Website', port: 'Webhook Port #3086', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/website', secret: 'whsec_dtalk_web_707', desc: 'DTalk.com cloud voice quote request forms.', icon: Globe, color: 'text-indigo-600', bg: 'bg-indigo-50/70', borderColor: 'border-l-4 border-l-indigo-500 border-slate-200', dotColor: 'bg-indigo-500', count: 52, pct: '11.5%', sampleJson: JSON.stringify({ url: 'https://dtalk.com/cloud-ivr' }, null, 2) },
  lead_src_8: { title: '8. References', name: 'References', port: 'Webhook Port #3087', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/references', secret: 'whsec_dtalk_ref_808', desc: 'Telecom reseller partner referrals.', icon: Share2, color: 'text-teal-600', bg: 'bg-teal-50/70', borderColor: 'border-l-4 border-l-teal-500 border-slate-200', dotColor: 'bg-teal-500', count: 38, pct: '8.4%', sampleJson: JSON.stringify({ reseller_id: 'RSL-402' }, null, 2) },
  lead_src_9: { title: '9. Cold Calling', name: 'Cold Calling', port: 'Webhook Port #3088', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/cold_calling', secret: 'whsec_dtalk_cold_909', desc: 'Voice trunk cold prospect submissions.', icon: Phone, color: 'text-orange-600', bg: 'bg-orange-50/70', borderColor: 'border-l-4 border-l-orange-500 border-slate-200', dotColor: 'bg-orange-500', count: 36, pct: '8.0%', sampleJson: JSON.stringify({ prospect: 'Airtel Enterprise' }, null, 2) },
  lead_src_10: { title: '10. Third Party Sources', name: 'Third Party Sources', port: 'Webhook Port #3089', endpoint: 'https://api.amuwa.com/v1/webhooks/dtalk/third_party_sources', secret: 'whsec_dtalk_3rd_010', desc: 'Asterisk / Twilio / Vicidial API webhooks.', icon: Building2, color: 'text-rose-600', bg: 'bg-rose-50/70', borderColor: 'border-l-4 border-l-rose-500 border-slate-200', dotColor: 'bg-rose-500', count: 45, pct: '10.0%', sampleJson: JSON.stringify({ provider: 'Twilio Webhook Ingestion' }, null, 2) }
};

export const DtalkPanel: React.FC<DtalkPanelProps> = ({ 
  activeTab, 
  onSelectTab,
  onNavigateToLeads,
  subDept,
  onSelectSubDept
}) => {
  const { getLeadsForDepartment, addWebhookLead } = useLeadStore();
  const leads = getLeadsForDepartment('dtalk');

  const [selectedSubDeptForUsers, setSelectedSubDeptForUsers] = useState<'sales' | 'support' | 'education_training' | 'product_training' | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isInjectingWebhook, setIsInjectingWebhook] = useState(false);
  const [webhookSuccessMsg, setWebhookSuccessMsg] = useState<string | null>(null);

  const salesUsers = [{ name: 'Karan Patel', id: 'EMP-7701', email: 'karan@dtalk.com' }];
  const supportUsers = [{ name: 'Pooja Hegde', id: 'EMP-3310', email: 'pooja@dtalk.com' }];

  const defaultSampleLeads = [
    { id: 'DT-901', name: 'Deepak Merchant', phone: '+91 98201 44556', email: 'deepak@telecom.in', company: 'Telecom Solutions Ltd', status: 'New', time: '10:42 AM' }
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
        id: `DT-${Math.floor(Math.random() * 899 + 100)}`,
        name: `D Talk ${cfg.name} Lead`,
        phone: '+91 98' + Math.floor(Math.random() * 8990000 + 1000000),
        email: `call.${Math.floor(Math.random() * 900 + 100)}@dtalk.com`,
        company: `${cfg.name} SIP Inbound`,
        status: 'New',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setLocalChannelLeads(prev => ({
        ...prev,
        [srcKey]: [newLead, ...(prev[srcKey] || [])]
      }));

      addWebhookLead('dtalk', 'whatsapp', { name: newLead.name, phone: newLead.phone });
      setIsInjectingWebhook(false);
      setWebhookSuccessMsg(`HTTP 200 OK: Webhook captured into D Talk ${cfg.name}!`);
      setTimeout(() => setWebhookSuccessMsg(null), 4000);
    }, 600);
  };

  // Route to the new Daily Sales Operating System for sales sub-department
  if (subDept === 'sales') {
    return (
      <DepartmentSalesOS
        config={DEPARTMENT_SALES_CONFIGS['dtalk']}
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
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs font-mono font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse" />
            <span>D TALK CORPORATION &bull; ENTERPRISE TELECOM</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold font-heading text-slate-900 tracking-tight">Select D Talk Sub-Department</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div onClick={() => onSelectSubDept('sales')} className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-cyan-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md">
            <div className="h-1.5 w-full bg-gradient-to-r from-cyan-600 to-blue-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-cyan-50 text-cyan-600 border border-cyan-100 group-hover:scale-110 transition-transform"><TrendingUp className="w-8 h-8" /></div>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedSubDeptForUsers('sales'); }} className="px-3.5 py-1.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                  <Users className="w-3.5 h-3.5 text-cyan-600" /><span>{salesUsers.length}/3 Active</span>
                </button>
              </div>
              <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-cyan-600 transition-colors">D Talk Sales Department</h3>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-cyan-700 transition-colors">
                <span>Enter Sales Panel</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          <div onClick={() => onSelectSubDept('support')} className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-blue-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md">
            <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 to-indigo-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 group-hover:scale-110 transition-transform"><Headphones className="w-8 h-8" /></div>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedSubDeptForUsers('support'); }} className="px-3.5 py-1.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                  <Users className="w-3.5 h-3.5 text-blue-600" /><span>{supportUsers.length}/3 Active</span>
                </button>
              </div>
              <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-blue-600 transition-colors">D Talk Support Department</h3>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-blue-700 transition-colors">
                <span>Enter Support Panel</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </div>

        {selectedSubDeptForUsers && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2"><Users className="w-5 h-5 text-cyan-600" /><h3 className="text-base font-bold font-heading text-slate-900 capitalize">D Talk {selectedSubDeptForUsers} Roster</h3></div>
                <button onClick={() => setSelectedSubDeptForUsers(null)} className="p-1 text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
              </div>
              {(selectedSubDeptForUsers === 'sales' ? salesUsers : supportUsers).map((usr, idx) => (
                <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs font-mono">
                  <div><strong className="text-slate-900 block">{usr.name}</strong><span className="text-[10px] text-slate-400">{usr.email}</span></div>
                  <span className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 text-[9px] font-bold">ACTIVE</span>
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
            <ArrowLeft className="w-4 h-4 text-cyan-600" /><span>Change Sub-Department</span>
          </button>
          <div>
            <h2 className="text-xl font-bold font-heading text-slate-900 uppercase">D Talk {subDept} Department Panel</h2>
            <p className="text-xs font-mono text-slate-500">Enterprise Telecom &amp; Webhook Control</p>
          </div>
        </div>
        <span className="px-3.5 py-1.5 rounded-full font-mono text-xs font-bold bg-cyan-50 text-cyan-800 border border-cyan-200 uppercase">{subDept} WORKSPACE</span>
      </div>

      {subDept === 'support' && (
        <div className="space-y-6 animate-fade-in">
          {activeTab === 'dashboard' && (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50 border border-cyan-100 text-cyan-700 text-xs font-mono font-bold mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-600 animate-pulse" /><span>10-SOURCE VISUAL INGESTION STREAM</span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">10 Inbound Webhook Sources &rarr; Unified Lead Store</h3>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-right min-w-[180px]">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-semibold block">CONVERGED TOTAL</span>
                  <span className="text-3xl font-bold font-mono text-cyan-600 block">452</span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center">
                <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(LEAD_SOURCES_CONFIG).map(([key, src]) => (
                    <div key={key} onClick={() => onSelectTab && onSelectTab(key as ActiveTab)} className={`p-3 rounded-2xl bg-white border ${src.borderColor} hover:border-cyan-500 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group shadow-2xs`}>
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${src.dotColor} animate-pulse shrink-0`} />
                        <div><h4 className="font-bold text-xs text-slate-900 group-hover:text-cyan-600 transition-colors">{src.name}</h4><span className="text-[10px] font-mono text-slate-400 block">{src.port}</span></div>
                      </div>
                      <div className="text-right"><span className="text-xs font-bold font-mono text-cyan-600 block">{src.count}</span><span className="text-[9px] font-mono text-slate-400 block">{src.pct}</span></div>
                    </div>
                  ))}
                </div>

                <div className="hidden lg:col-span-1 lg:flex items-center justify-center">
                  <VisualIngestionStreamAnimation />
                </div>

                <div className="lg:col-span-4 bg-slate-50/80 border border-cyan-100 rounded-3xl p-6 flex flex-col items-center text-center justify-center space-y-4 shadow-sm">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-100 border border-cyan-200 text-cyan-600 flex items-center justify-center shadow-xs"><Database className="w-8 h-8" /></div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono text-cyan-700 uppercase font-bold tracking-wider block">SINGLE UNIFIED STORE</span>
                    <h4 className="text-xl font-bold font-heading text-slate-900">D Talk Lead Database</h4>
                  </div>
                  <button onClick={onNavigateToLeads} className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-mono font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm mt-2">
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
                <button onClick={() => handleSimulateWebhookPayload(activeTab)} disabled={isInjectingWebhook} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center gap-2 shadow-sm">
                  {isInjectingWebhook ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>Test Webhook Payload</span>
                </button>
              </div>

              {webhookSuccessMsg && (
                <div className="p-4 rounded-2xl bg-cyan-50 border border-cyan-200 text-cyan-900 font-mono text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-cyan-600 shrink-0" /><span>{webhookSuccessMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2"><Terminal className="w-5 h-5 text-slate-700" /><h4 className="font-bold text-sm font-heading text-slate-900">Dedicated Webhook Endpoint</h4></div>
                    <span className="px-2.5 py-0.5 rounded bg-cyan-100 text-cyan-800 text-[10px] font-mono font-bold">HTTP POST</span>
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
                    <pre className="mt-3 p-4 bg-slate-950 rounded-2xl font-mono text-xs text-cyan-400 overflow-x-auto border border-slate-800 max-h-[160px]">{activeSourceConfig.sampleJson}</pre>
                  </div>
                  <button onClick={() => handleSimulateWebhookPayload(activeTab)} disabled={isInjectingWebhook} className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center justify-center gap-2">
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
                          <td className="p-3.5"><span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-100 text-cyan-800">Captured</span></td>
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
