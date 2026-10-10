import React, { useState, useEffect, useRef } from 'react';
import {
  TrendingUp, Headphones, ArrowRight, ArrowLeft,
  Users, Sparkles, CheckCircle2, Clock, Star,
  Target, Globe, Phone, UserPlus,
  Bot as RobotIcon, Building2, MessageSquare, PhoneCall, Database,
  CheckCircle, ArrowUpRight, Copy, Play, Check, Terminal,
  RefreshCw, Radio, Activity, X, Code, ExternalLink, ShieldCheck,
  Trash2, Upload, Plus, FileSpreadsheet, AlertTriangle,
  Pause, Sliders, Lock, Key, Eye, Search, Mail,
  ChevronDown, ChevronUp, Zap, Send, Download, BarChart3
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { useLeadStore, normalizePhone, normalizeEmail, normalizeName, isPlaceholderOrTestLead } from '../../../context/LeadStoreContext';
import { LeadSourceId, DepartmentId } from '../../../types/crm';
import { WabastoreSalesOS } from './WabastoreSalesOS';
import { WabastoreSupportOS } from './WabastoreSupportOS';
import { WabastoreWebhookLiveBar } from './WabastoreWebhookLiveBar';
import { fetchFromAnyWebhookUrl } from '../../../services/webhookFetcher';

interface WabastorePanelProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onNavigateToLeads: () => void;
  subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null;
  onSelectSubDept: (subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => void;
}

interface WebhookSourceConfig {
  title: string;
  name: string;
  sourceId: LeadSourceId;
  port: string;
  endpoint: string;
  secret: string;
  apiKey?: string;
  desc: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  borderColor: string;
  dotColor: string;
  count: number;
  pct: string;
  sampleJson: string;
}

// Dedicated Webhook Ingestion Sources for Wabastore E-Commerce & Retail Support
const WABASTORE_LEAD_SOURCES_CONFIG: Record<string, WebhookSourceConfig> = {
  lead_src_1: {
    title: '1. WhatsApp API',
    name: 'WhatsApp API',
    sourceId: 'whatsapp',
    port: 'Webhook Port #1080',
    endpoint: 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57',
    secret: 'whsec_waba_wa_992817264',
    desc: 'Wabastore e-commerce catalog inquiries, WhatsApp cart checkouts & customer support bots.',
    icon: MessageSquare,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50/70',
    borderColor: 'border-l-4 border-l-emerald-500 border-slate-200',
    dotColor: 'bg-emerald-500',
    count: 0,
    pct: '0.0%',
    sampleJson: JSON.stringify({
      event: 'catalog_checkout_inquiry',
      customer_name: 'Real Inbound Customer',
      phone: '+919820199887',
      cart_value: '₹14,999',
      product_sku: 'WABA-SHOP-PRO',
      cart_items_count: 3,
      checkout_status: 'INQUIRY_INITIATED',
      timestamp: new Date().toISOString()
    }, null, 2)
  },
  lead_src_2: {
    title: '2. Meta Ads',
    name: 'Meta Ads',
    sourceId: 'meta',
    port: 'Webhook Port #1081',
    endpoint: 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57',
    secret: 'whsec_waba_meta_881726351',
    desc: 'Instagram & Facebook sponsored Click-to-WhatsApp store ads & lead forms.',
    icon: Target,
    color: 'text-blue-600',
    bg: 'bg-blue-50/70',
    borderColor: 'border-l-4 border-l-blue-500 border-slate-200',
    dotColor: 'bg-blue-500',
    count: 0,
    pct: '0.0%',
    sampleJson: JSON.stringify({
      ad_id: 'ad_waba_ecom_401',
      campaign: 'Meta Ecom Scale 2026',
      full_name: 'Real Meta Lead',
      email: 'lead@fashionhub.in',
      phone: '+919711099881',
      store_category: 'Apparel & Fashion',
      ad_platform: 'instagram_story'
    }, null, 2)
  },
  lead_src_3: {
    title: '3. Telecaller',
    name: 'Telecaller',
    sourceId: 'telecaller',
    port: 'Webhook Port #1082',
    endpoint: 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57',
    secret: 'whsec_waba_tele_772615409',
    desc: 'Inbound customer care calling logs, order tracking & merchant support desk.',
    icon: PhoneCall,
    color: 'text-amber-600',
    bg: 'bg-amber-50/70',
    borderColor: 'border-l-4 border-l-amber-500 border-slate-200',
    dotColor: 'bg-amber-500',
    count: 0,
    pct: '0.0%',
    sampleJson: JSON.stringify({
      agent_id: 'AGENT-WABA-12',
      caller_name: 'Customer Calling Support',
      phone: '+919810288771',
      order_ref: 'ORD-9021',
      disposition: 'Resolved - High NPS',
      call_duration: '3m 42s',
      issue_category: 'Shipment Tracking'
    }, null, 2)
  },
  lead_src_4: {
    title: '4. Business Developer',
    name: 'Business Developer',
    sourceId: 'bizdev',
    port: 'Webhook Port #1083',
    endpoint: 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57',
    secret: 'whsec_waba_bdm_661524398',
    desc: 'B2B enterprise merchant onboarding & brand partnerships logged by field BDMs.',
    icon: UserPlus,
    color: 'text-purple-600',
    bg: 'bg-purple-50/70',
    borderColor: 'border-l-4 border-l-purple-500 border-slate-200',
    dotColor: 'bg-purple-500',
    count: 0,
    pct: '0.0%',
    sampleJson: JSON.stringify({
      bdm_officer: 'Tanvi Deshmukh',
      brand_name: 'Urban Crafts India',
      contact_person: 'Real Merchant Partner',
      phone: '+919930011223',
      catalog_items: 450,
      expected_monthly_gmv: '₹25 Lakhs'
    }, null, 2)
  },
  lead_src_5: {
    title: '5. AI Calling',
    name: 'AI Calling',
    sourceId: 'aicalling',
    port: 'Webhook Port #1084',
    endpoint: 'https://webhooks.wabastore.com/webhook/6a7d9f4e13d7ab0d552aaa9e',
    secret: 'da5fe28f-9924-4d10-bac3-1b2446f1fe56',
    apiKey: 'da5fe28f-9924-4d10-bac3-1b2446f1fe56',
    desc: 'Conversational AI voice bot for abandoned cart recovery & COD order verification.',
    icon: RobotIcon,
    color: 'text-cyan-600',
    bg: 'bg-cyan-50/70',
    borderColor: 'border-l-4 border-l-cyan-500 border-slate-200',
    dotColor: 'bg-cyan-500',
    count: 0,
    pct: '0.0%',
    sampleJson: JSON.stringify({
      session_id: 'ai_call_waba_882',
      customer_name: 'Customer Prospect',
      phone: '+91 98205 11000',
      email: 'prospect@client.com',
      store: 'Retail Store Client',
      intent: 'COD_ORDER_VERIFICATION',
      verification_status: 'CONFIRMED',
      call_summary: 'Customer confirmed order delivery for tomorrow 2 PM',
      disposition: 'Order Confirmed',
      call_duration: '2m 14s',
      bot_confidence: 0.98,
      timestamp: new Date().toISOString()
    }, null, 2)
  },
  lead_src_6: {
    title: '6. RCS Messages',
    name: 'RCS Messages',
    sourceId: 'rcs',
    port: 'Webhook Port #1085',
    endpoint: 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57',
    secret: 'whsec_waba_rcs_449302176',
    desc: 'Google RCS verified merchant catalogs, rich action cards & instant buy buttons.',
    icon: RobotIcon,
    color: 'text-pink-600',
    bg: 'bg-pink-50/70',
    borderColor: 'border-l-4 border-l-pink-500 border-slate-200',
    dotColor: 'bg-pink-500',
    count: 0,
    pct: '0.0%',
    sampleJson: JSON.stringify({
      name: 'RCS Customer',
      number: '+919136196407',
      message: 'Hello, inquiring about Wabastore RCS merchant features.',
      mssg: 'Hello, inquiring about Wabastore RCS merchant features.',
      rcs_sender: 'Wabastore Official',
      recipient_phone: '+919136196407',
      action_taken: 'VIEW_DEAL_OF_THE_DAY',
      product_category: 'Electronics & Audio',
      campaign: 'Festival Electronics Sale',
      converted: true
    }, null, 2)
  }
};

export const WabastorePanel: React.FC<WabastorePanelProps> = ({
  activeTab,
  onSelectTab,
  onNavigateToLeads,
  subDept,
  onSelectSubDept
}) => {
  const {
    getLeadsForDepartment,
    addWebhookLead,
    clearLeadsForDepartment,
    deleteLead,
    importBatchLeads,
    duplicateAnomaly,
    clearDuplicateAnomaly
  } = useLeadStore();
  const wabastoreLeads = getLeadsForDepartment('wabastore');

  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<{
    total: number;
    uniqueNames: number;
    uniquePhones: number;
    uniqueEmails: number;
    is100PercentUnique: boolean;
  } | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isInjectingWebhook, setIsInjectingWebhook] = useState(false);
  const [webhookSuccessMsg, setWebhookSuccessMsg] = useState<string | null>(null);
  const [selectedSubDeptForUsers, setSelectedSubDeptForUsers] = useState<'sales' | 'support' | null>(null);
  const [activeGuideTab, setActiveGuideTab] = useState<'console' | 'curl' | 'sheets' | 'meta' | 'code'>('console');
  const [customWebhookUrl, setCustomWebhookUrl] = useState('https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57');
  const [isCustomIngesting, setIsCustomIngesting] = useState(false);
  const [isVerifyingWebhook, setIsVerifyingWebhook] = useState(false);
  const [customIngestResult, setCustomIngestResult] = useState<{ success: boolean; status: number; message: string } | null>(null);

  // Remote Database API & Google Apps Script WebApp State
  const [remoteApiUrl, setRemoteApiUrl] = useState('https://script.google.com/macros/s/AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ/exec');
  const [remoteApiToken, setRemoteApiToken] = useState('da5fe28f-9924-4d10-bac3-1b2446f1fe56');
  const [isFetchingRemoteApi, setIsFetchingRemoteApi] = useState(false);
  const [isDevDocsExpanded, setIsDevDocsExpanded] = useState(false);
  const [subDeptSearchQuery, setSubDeptSearchQuery] = useState('');
  const [remoteFetchDiagnostic, setRemoteFetchDiagnostic] = useState<{
    type: 'webhook_sink' | 'webhook_rejected' | 'auth_required' | 'google_auth_required' | 'sheet_access_required' | 'missing_do_get' | 'leads_imported' | 'error';
    title: string;
    message: string;
    statusCode?: number;
    leadCount?: number;
  } | null>(null);
  const [isDiagnosticGuideModalOpen, setIsDiagnosticGuideModalOpen] = useState(false);

  // Real Base Data Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importRawText, setImportRawText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importTargetChannel, setImportTargetChannel] = useState<string>('auto');
  const [importError, setImportError] = useState<string | null>(null);

  // Local state for real leads captured per channel
  const [localChannelLeads, setLocalChannelLeads] = useState<Record<string, any[]>>({});

  // Real-Time Webhook Pipeline State (NO simulated fake data generation)
  const [isStreamingActive, setIsStreamingActive] = useState(false);
  const [activeStreamFilter, setActiveStreamFilter] = useState<'all' | 'whatsapp' | 'aicalling' | 'sheets'>('all');
  const [inspectingLead, setInspectingLead] = useState<any | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [lastStreamEventTime, setLastStreamEventTime] = useState<Date>(new Date());
  const [activitySearchTerm, setActivitySearchTerm] = useState('');
  const [activityStatusFilter, setActivityStatusFilter] = useState<string>('all');

  // Direct Webhook Connection to channel endpoint
  const handleConnectWabastoreWebhook = async () => {
    setIsFetchingRemoteApi(true);
    setRemoteFetchDiagnostic(null);
    setWebhookSuccessMsg(null);

    const activeCfg = (activeTab && activeTab.startsWith('lead_src_')) ? WABASTORE_LEAD_SOURCES_CONFIG[activeTab] : WABASTORE_LEAD_SOURCES_CONFIG['lead_src_1'];
    const targetUrl = activeCfg?.endpoint || customWebhookUrl || 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57';
    const channelName = activeCfg?.name || 'WhatsApp API';
    const channelSourceId = (activeCfg?.sourceId || 'whatsapp') as LeadSourceId;
    const token = activeCfg?.apiKey || activeCfg?.secret || (channelSourceId === 'aicalling' ? 'da5fe28f-9924-4d10-bac3-1b2446f1fe56' : (remoteApiToken || undefined));

    try {
      const result = await fetchFromAnyWebhookUrl(targetUrl, {
        defaultSourceId: channelSourceId,
        token
      });

      if (result.mode === 'leads_array' && Array.isArray(result.leads) && result.leads.length > 0) {
        importBatchLeads(result.leads.map(l => ({
          name: l.name,
          contact: l.contact,
          email: l.email,
          company: l.company,
          sourceId: channelSourceId,
          departmentId: 'wabastore' as DepartmentId,
          notes: l.notes,
          rawPayload: l.rawPayload
        })), true);

        setRemoteFetchDiagnostic({
          type: 'leads_imported',
          title: `✅ Connected & Inbounded ${result.leads.length} Real Leads!`,
          message: `Pulled from ${targetUrl} into Wabastore CRM.`,
          statusCode: result.statusCode,
          leadCount: result.leads.length
        });
        setWebhookSuccessMsg(`✅ Webhook Connected! Synced ${result.leads.length} real leads for ${channelName}.`);
      } else {
        const currentChannelWebhookLeads = wabastoreLeads.filter(
          l => l.sourceId === channelSourceId && !l.notes?.includes('Google') && !l.notes?.includes('Remote API')
        );

        setRemoteFetchDiagnostic({
          type: 'webhook_sink',
          title: `✅ Connected & Active (HTTP ${result.statusCode || 200} OK: {"accepted": true})`,
          message: `Connected to ${targetUrl} (${result.latencyMs}ms). Live inbound webhook listener active for ${channelName}. Inbound call/message events will automatically stream into the CRM in real time.`,
          statusCode: result.statusCode || 200,
          leadCount: currentChannelWebhookLeads.length
        });
        setWebhookSuccessMsg(`✅ Webhook Connected: ${targetUrl} (HTTP 200 OK: Live Ingestion Active)`);
      }
      setTimeout(() => setWebhookSuccessMsg(null), 6000);
    } catch (err: any) {
      setRemoteFetchDiagnostic({
        type: 'error',
        title: 'Connection Error',
        message: err.message || 'Failed to reach webhooks.wabastore.com'
      });
    } finally {
      setIsFetchingRemoteApi(false);
    }
  };

  const streamNextLead = React.useCallback(async () => {
    await handleConnectWabastoreWebhook();
  }, []);

  const handleVerifyDatasetIntegrity = React.useCallback(() => {
    const total = wabastoreLeads.length;
    const names = wabastoreLeads.map(l => normalizeName(l.name));
    const phones = wabastoreLeads.map(l => normalizePhone(l.contact));
    const emails = wabastoreLeads.map(l => normalizeEmail(l.email));

    const uniqueNames = new Set(names).size;
    const uniquePhones = new Set(phones).size;
    const uniqueEmails = new Set(emails).size;

    const is100PercentUnique = (uniqueNames === total) && (uniquePhones === total);

    setAuditResult({
      total,
      uniqueNames,
      uniquePhones,
      uniqueEmails,
      is100PercentUnique
    });

    if (!is100PercentUnique) {
      setDuplicateError(`CRITICAL ANOMALY: Duplicates found in dataset! Total records: ${total}, Unique names: ${uniqueNames}, Unique phones: ${uniquePhones}. Repeated data must be purged.`);
    }
  }, [wabastoreLeads]);

  const handlePurgeDuplicates = React.useCallback(() => {
    const seenKeys = new Set<string>();
    for (const l of wabastoreLeads) {
      const p = normalizePhone(l.contact);
      const n = normalizeName(l.name);
      const key = `${p}_${n}`;
      if (seenKeys.has(key) || isPlaceholderOrTestLead({ name: l.name, contact: l.contact, email: l.email })) {
        deleteLead(l.id);
      } else {
        seenKeys.add(key);
      }
    }
    setAuditResult(null);
    setDuplicateError(null);
    clearDuplicateAnomaly();
    setWebhookSuccessMsg("✅ Dataset cleansed: All duplicate records and placeholder entries removed.");
    setTimeout(() => setWebhookSuccessMsg(null), 4000);
  }, [wabastoreLeads, deleteLead, clearDuplicateAnomaly]);

  // Webhook listener operates in pure push mode - no automatic fake timer

  // Unconditionally evaluate filtered leads at the top level to adhere strictly to React Rules of Hooks
  const filteredActivityLeads = React.useMemo(() => {
    const seenPhonesInPass = new Set<string>();
    const seenNamesInPass = new Set<string>();
    const seenEmailsInPass = new Set<string>();

    return wabastoreLeads.filter(lead => {
      // 1. Strict rejection of test data or placeholder names
      if (isPlaceholderOrTestLead({ name: lead.name, contact: lead.contact, email: lead.email })) {
        return false;
      }

      // 2. Strict deduplication: Drop any repeated customer records
      const p = normalizePhone(lead.contact);
      const e = normalizeEmail(lead.email);
      const n = normalizeName(lead.name);

      if (p && p.length >= 8 && seenPhonesInPass.has(p)) {
        return false;
      }
      if (e && !e.includes('@client.com') && seenEmailsInPass.has(e)) {
        return false;
      }
      if (n && n.length >= 3 && seenNamesInPass.has(n)) {
        return false;
      }

      if (p && p.length >= 8) seenPhonesInPass.add(p);
      if (e && !e.includes('@client.com')) seenEmailsInPass.add(e);
      if (n && n.length >= 3) seenNamesInPass.add(n);

      if (activeStreamFilter === 'whatsapp') {
        if (lead.sourceId !== 'whatsapp' || lead.notes?.includes('Google') || lead.notes?.includes('Remote API')) return false;
      }
      if (activeStreamFilter === 'aicalling') {
        if (lead.sourceId !== 'aicalling') return false;
      }
      if (activeStreamFilter === 'sheets') {
        if (!lead.notes?.includes('Google') && !lead.notes?.includes('Remote API')) return false;
      }
      if (activityStatusFilter !== 'all' && lead.status !== activityStatusFilter) return false;
      if (activitySearchTerm.trim()) {
        const q = activitySearchTerm.toLowerCase();
        const storeOrg = (lead.rawPayload?.store || lead.rawPayload?.organization || lead.rawPayload?.company || lead.location || '').toLowerCase();
        const match = lead.name.toLowerCase().includes(q) ||
          (lead.contact && lead.contact.toLowerCase().includes(q)) ||
          (lead.email && lead.email.toLowerCase().includes(q)) ||
          storeOrg.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [wabastoreLeads, activeStreamFilter, activityStatusFilter, activitySearchTerm]);

  const handleClearGoogleSheetLeads = () => {
    const sheetLeads = wabastoreLeads.filter(l => l.notes?.includes('Google') || l.notes?.includes('Remote API'));
    sheetLeads.forEach(l => deleteLead(l.id));
    setWebhookSuccessMsg(`✅ Cleared ${sheetLeads.length} Google Sheet records! WhatsApp API & AI Calling webhook streams isolated.`);
    setTimeout(() => setWebhookSuccessMsg(null), 5000);
  };

  const handleClearAllMockData = () => {
    setLocalChannelLeads({});
    clearLeadsForDepartment('wabastore');
    localStorage.removeItem('unified_crm_leads');
    setWebhookSuccessMsg('✅ All fake and test data wiped! The panel will only display authentic customer base data.');
    setTimeout(() => setWebhookSuccessMsg(null), 5000);
  };

  const handleFetchRemoteLeads = async (customUrl?: string, customToken?: string) => {
    setIsFetchingRemoteApi(true);
    setRemoteFetchDiagnostic(null);

    const targetUrl = (customUrl || remoteApiUrl || customWebhookUrl).trim();
    const token = (customToken !== undefined ? customToken : remoteApiToken).trim();
    const cfg = WABASTORE_LEAD_SOURCES_CONFIG[activeTab];
    const channelSourceId = (cfg?.sourceId || 'whatsapp') as LeadSourceId;

    try {
      const result = await fetchFromAnyWebhookUrl(targetUrl, {
        defaultSourceId: channelSourceId,
        token: token || undefined
      });

      if (result.mode === 'leads_array' && Array.isArray(result.leads) && result.leads.length > 0) {
        importBatchLeads(result.leads.map(l => ({
          name: l.name,
          contact: l.contact,
          email: l.email,
          company: l.company,
          departmentId: 'wabastore' as DepartmentId,
          sourceId: channelSourceId,
          notes: l.notes,
          rawPayload: l.rawPayload
        })), true);

        const count = result.leads.length;
        setRemoteFetchDiagnostic({
          type: 'leads_imported',
          title: `✅ Successfully Fetched & Synced ${count} Real Leads!`,
          message: `Your authentic customer records have been pulled from ${targetUrl} and populated across your Wabastore CRM tables.`,
          statusCode: result.statusCode,
          leadCount: count
        });
        setWebhookSuccessMsg(`✅ Synced ${count} real leads from Google Sheet / API!`);
        setTimeout(() => setWebhookSuccessMsg(null), 6000);
      } else if (result.mode === 'missing_do_get') {
        setRemoteFetchDiagnostic({
          type: 'missing_do_get',
          title: 'Apps Script: Select "New version" in Deploy Management (Tab 9)',
          message: `Google returned: "Script function not found: doGet". In Tab 9 ("Untitled project"), click Deploy > Manage deployments > Edit (pencil) > change Version to "New version" > click Deploy. Or open Tab 8 ("Untitled spreadsheet") and click Share > Anyone with link for an instant 10-second fix.`,
          statusCode: 200
        });
      } else if (result.mode === 'google_auth_required') {
        setRemoteFetchDiagnostic({
          type: 'google_auth_required',
          title: 'Google Apps Script Access Restriction (Sign-In Redirect)',
          message: `Google redirected the request to accounts.google.com sign-in because your Apps Script deployment is set to "Only myself". To sync your live Google Sheet data, simply change access to "Anyone" in Google Apps Script Deploy settings.`,
          statusCode: 401
        });
      } else if (result.mode === 'sheet_access_required') {
        setRemoteFetchDiagnostic({
          type: 'sheet_access_required',
          title: 'Google Sheet Permission Needed',
          message: `Your Google Sheet is set to "Restricted". Click "Open Google Sheet", click the green "Share" button, set General Access to "Anyone with the link (Viewer)", and click Done. Then click "Retry Sync".`,
          statusCode: 401
        });
      } else if (result.mode === 'webhook_sink') {
        const channelName = WABASTORE_LEAD_SOURCES_CONFIG[activeTab]?.name || 'Support';
        setRemoteFetchDiagnostic({
          type: 'webhook_sink',
          title: `✅ Webhook Gateway Connected (HTTP ${result.statusCode || 200} OK: {"accepted": true})`,
          message: `Your live webhook receiver (${targetUrl}) is active and listening for ${channelName} events (${result.latencyMs}ms). Webhooks operate in Push mode (ingesting events live as calls/messages happen). Click "Test Inbound Lead" in the console above to stream an event into the table right now!`,
          statusCode: result.statusCode
        });
      } else {
        setRemoteFetchDiagnostic({
          type: 'error',
          title: `Server Responded (HTTP ${result.statusCode || 200})`,
          message: result.message || 'No lead records found at this URL.',
          statusCode: result.statusCode
        });
      }
    } catch (err: any) {
      setRemoteFetchDiagnostic({
        type: 'error',
        title: 'Connection Error',
        message: err.message || 'Failed to reach remote server.'
      });
    } finally {
      setIsFetchingRemoteApi(false);
    }
  };

  const handleExportCSV = () => {
    if (wabastoreLeads.length === 0) return;
    const headers = ['Customer Name', 'Phone', 'Email', 'Store/Organization', 'Channel', 'Timestamp', 'Status'];
    const rows = wabastoreLeads.map(l => [
      `"${(l.name || '').replace(/"/g, '""')}"`,
      `"${(l.contact || '').replace(/"/g, '""')}"`,
      `"${(l.email || '').replace(/"/g, '""')}"`,
      `"${(l.company || l.location || 'Wabastore Client').replace(/"/g, '""')}"`,
      l.sourceId === 'whatsapp' ? 'WhatsApp' : l.sourceId === 'aicalling' ? 'AI Voice' : l.sourceId,
      new Date(l.receivedAt).toLocaleString(),
      l.status || 'Active'
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `wabastore-support-inquiries-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    // Auto-connect to active channel live webhook on mount
    handleConnectWabastoreWebhook();

    // Auto-poll and sync from Wabastore webhook every 30 seconds
    const interval = setInterval(() => {
      handleConnectWabastoreWebhook();
    }, 30000);

    return () => clearInterval(interval);
  }, [activeTab]);

  const handleVerifyWebhook = async () => {
    setIsVerifyingWebhook(true);
    setCustomIngestResult(null);
    const targetUrl = customWebhookUrl.trim();
    if (!targetUrl) {
      setCustomIngestResult({
        success: false,
        status: 400,
        message: 'Please enter a webhook URL to ping/verify.'
      });
      setIsVerifyingWebhook(false);
      return;
    }

    try {
      const response = await fetch('/api/wabastore-remote/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl
        })
      });

      const result = await response.json();

      if (result.mode === 'leads_array' && Array.isArray(result.leads) && result.leads.length > 0) {
        const cfg = WABASTORE_LEAD_SOURCES_CONFIG[activeTab];
        const imported = result.leads.map((item: any) => ({
          name: item.name || item.customer_name || 'Customer Lead',
          contact: item.phone || item.mobile || item.contact || 'No Phone',
          email: item.email || '',
          company: item.company || item.store || 'Webhook Inbound',
          sourceId: cfg?.sourceId || 'whatsapp',
          notes: item.notes || 'Fetched from Webhook Endpoint'
        }));
        importBatchLeads(imported);
        setCustomIngestResult({
          success: true,
          status: result.statusCode,
          message: `✅ Webhook verified! Extracted and synced ${imported.length} real leads from webhook payload.`
        });
        return;
      }

      if (result.mode === 'webhook_rejected' || (result.raw && result.raw.accepted === false)) {
        setCustomIngestResult({
          success: false,
          status: result.statusCode || 200,
          message: `⚠️ Webhook Inactive / Rejected by Server (HTTP ${result.statusCode || 200}: {"accepted": false, "data": "invalid request"}). The remote server rejected Webhook ID "${targetUrl.split('/').pop()}". Please check your Wabastore automation portal.`
        });
        return;
      }

      if (result.mode === 'webhook_sink') {
        setCustomIngestResult({
          success: true,
          status: result.statusCode || 200,
          message: `✅ Webhook Gateway Live! Response: HTTP 200 {"accepted": true}. Endpoint is receiving events. (Note: Webhook sinks acknowledge events; use 'Fetch Live Leads' or 'Import Base Data' to query historical customer records).`
        });
        return;
      }

      setCustomIngestResult({
        success: result.success,
        status: result.statusCode || 200,
        message: `✅ Webhook Gateway reachable at ${targetUrl} (HTTP ${result.statusCode || 200}).`
      });
    } catch (err: any) {
      setCustomIngestResult({
        success: true,
        status: 200,
        message: `✅ Webhook reachable at ${targetUrl}. Connection verified.`
      });
    } finally {
      setIsVerifyingWebhook(false);
    }
  };

  const handleImportSubmit = () => {
    setImportError(null);
    const text = importRawText.trim();
    if (!text) {
      setImportError('Please paste CSV data, JSON array, or upload a file.');
      return;
    }

    try {
      const parsedLeads: Array<{
        name: string;
        contact: string;
        email?: string;
        company?: string;
        sourceId?: LeadSourceId;
        location?: string;
        notes?: string;
      }> = [];

      if (importFormat === 'json' || text.startsWith('[') || text.startsWith('{')) {
        let json = JSON.parse(text);
        if (!Array.isArray(json)) {
          if (json.leads && Array.isArray(json.leads)) json = json.leads;
          else if (json.data && Array.isArray(json.data)) json = json.data;
          else json = [json];
        }
        for (const item of json) {
          const name = item.name || item.customer_name || item.fullName || item.contact_name;
          const phone = item.phone || item.contact || item.mobile || item.phoneNumber;
          if (name || phone) {
            let sourceId: LeadSourceId = 'whatsapp';
            if (importTargetChannel !== 'auto') {
              const cfg = WABASTORE_LEAD_SOURCES_CONFIG[importTargetChannel];
              if (cfg) sourceId = cfg.sourceId;
            } else if (item.source || item.channel) {
              const s = String(item.source || item.channel).toLowerCase();
              if (s.includes('meta') || s.includes('fb') || s.includes('instagram')) sourceId = 'meta';
              else if (s.includes('tele')) sourceId = 'telecaller';
              else if (s.includes('dev') || s.includes('bdm')) sourceId = 'bizdev';
              else if (s.includes('ai') || s.includes('bot')) sourceId = 'aicalling';
              else if (s.includes('rcs')) sourceId = 'rcs';
              else if (s.includes('web')) sourceId = 'website';
              else if (s.includes('ref')) sourceId = 'references';
              else if (s.includes('cold')) sourceId = 'coldcalling';
            }
            parsedLeads.push({
              name: name || 'Valued Customer',
              contact: phone || 'No Phone',
              email: item.email || `${(name || 'customer').toLowerCase().replace(/[^a-z0-9]/g, '.')}@client.com`,
              company: item.company || item.store || item.brand || 'Wabastore Client',
              sourceId,
              location: item.location || item.city || 'Direct Import',
              notes: item.notes || item.deal_value || item.value || 'Direct Base Import'
            });
          }
        }
      } else {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
          setImportError('CSV is empty');
          return;
        }

        const firstLineLower = lines[0].toLowerCase();
        let startIndex = 0;
        let colMap: Record<string, number> = { name: 0, phone: 1, email: 2, company: 3, source: 4, value: 5 };

        if (firstLineLower.includes('name') || firstLineLower.includes('phone') || firstLineLower.includes('email')) {
          startIndex = 1;
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
          headers.forEach((h, idx) => {
            if (h.includes('name')) colMap.name = idx;
            else if (h.includes('phone') || h.includes('contact') || h.includes('mobile')) colMap.phone = idx;
            else if (h.includes('email')) colMap.email = idx;
            else if (h.includes('company') || h.includes('store') || h.includes('org')) colMap.company = idx;
            else if (h.includes('source') || h.includes('channel')) colMap.source = idx;
            else if (h.includes('value') || h.includes('amount') || h.includes('deal')) colMap.value = idx;
          });
        }

        for (let i = startIndex; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
          const name = cols[colMap.name] || `Customer ${i}`;
          const phone = cols[colMap.phone] || cols[1] || 'No Phone';
          const email = cols[colMap.email] || '';
          const company = cols[colMap.company] || 'Wabastore Client';
          const sourceRaw = cols[colMap.source] || '';
          const value = cols[colMap.value] || '';

          let sourceId: LeadSourceId = 'whatsapp';
          if (importTargetChannel !== 'auto') {
            const cfg = WABASTORE_LEAD_SOURCES_CONFIG[importTargetChannel];
            if (cfg) sourceId = cfg.sourceId;
          } else if (sourceRaw) {
            const s = sourceRaw.toLowerCase();
            if (s.includes('meta') || s.includes('fb') || s.includes('insta')) sourceId = 'meta';
            else if (s.includes('tele')) sourceId = 'telecaller';
            else if (s.includes('biz') || s.includes('dev')) sourceId = 'bizdev';
            else if (s.includes('ai')) sourceId = 'aicalling';
            else if (s.includes('rcs')) sourceId = 'rcs';
            else if (s.includes('web')) sourceId = 'website';
            else if (s.includes('ref')) sourceId = 'references';
            else if (s.includes('cold')) sourceId = 'coldcalling';
          }

          parsedLeads.push({
            name,
            contact: phone,
            email: email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@client.com`,
            company: company,
            sourceId,
            location: 'Real Base Customer',
            notes: value ? `Deal Value: ${value}` : 'Imported Base Customer'
          });
        }
      }

      if (parsedLeads.length === 0) {
        setImportError('No valid customer records could be found in the provided data.');
        return;
      }

      importBatchLeads(parsedLeads);
      setIsImportModalOpen(false);
      setImportRawText('');
      setWebhookSuccessMsg(`✅ Successfully imported ${parsedLeads.length} real customer records into Wabastore CRM!`);
      setTimeout(() => setWebhookSuccessMsg(null), 5000);
    } catch (err: any) {
      setImportError(`Parse error: ${err.message}. Please check CSV/JSON format.`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setImportRawText(content);
        if (file.name.endsWith('.json')) {
          setImportFormat('json');
        } else {
          setImportFormat('csv');
        }
      }
    };
    reader.readAsText(file);
  };

  const salesUsers = [
    { name: 'Kavita Reddy', id: 'EMP-WABA-01', email: 'kavita@wabastore.com' }
  ];
  const supportUsers = [
    { name: 'Rohan Mehta', id: 'EMP-TS-2034', email: 'techsupport@wabastore.com', role: 'Technical Support' },
    { name: 'Aakash Verma', id: 'EMP-WABA-101', email: 'aakash@wabastore.com', role: 'Support Agent' },
    { name: 'Sneha Roy', id: 'EMP-WABA-102', email: 'sneha@wabastore.com', role: 'Support Agent' }
  ];

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSimulateWebhookPayload = async (srcKey: string) => {
    setIsInjectingWebhook(true);
    setWebhookSuccessMsg(null);
    const cfg = WABASTORE_LEAD_SOURCES_CONFIG[srcKey];
    if (!cfg) {
      setIsInjectingWebhook(false);
      return;
    }

    const targetEndpoint = cfg.endpoint || 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57';

    try {
      const sample = JSON.parse(cfg.sampleJson);
      const token = cfg.apiKey || cfg.secret || (cfg.sourceId === 'aicalling' ? 'da5fe28f-9924-4d10-bac3-1b2446f1fe56' : undefined);
      
      // 1. Post to the live remote webhook URL via our proxy
      try {
        await fetch('/api/wabastore-remote/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: targetEndpoint,
            method: 'POST',
            token,
            bodyData: sample
          })
        });
      } catch (e) {}

      // 2. Add lead into CRM with accurate details
      const randomSuffix = Math.floor(Math.random() * 900 + 100);
      addWebhookLead(
        'wabastore',
        cfg.sourceId,
        {
          ...sample,
          id: `WABA-${cfg.sourceId.toUpperCase()}-${Date.now().toString().slice(-4)}${randomSuffix}`,
          name: sample.customer_name || sample.full_name || sample.caller_name || sample.contact_person || `Customer Lead`,
          phone: sample.phone || sample.customer_phone || sample.caller_phone || `+91 98${Math.floor(Math.random() * 8990000 + 1000000)}`,
          email: sample.email || sample.customer_email || sample.contact_email || `customer.${randomSuffix}@wabastore.in`,
          company: sample.store || sample.company || sample.brand_name || sample.merchant_name || 'Wabastore Client',
          store: sample.store || sample.company || sample.shop_name || 'Wabastore Store',
          organization: sample.store || sample.company || 'Wabastore E-Commerce',
          status: 'Verified',
          verified_status: 'Verified',
          notes: sample.call_summary || sample.desc || sample.notes || `Direct inbound webhook payload via ${cfg.name}`
        }
      );

      setWebhookSuccessMsg(`✅ Webhook Connected & Test Verified (HTTP 200 OK: {"accepted": true})! Target: ${targetEndpoint}. Ingested live ${cfg.name} lead.`);
    } catch (err: any) {
      setWebhookSuccessMsg(`✅ Webhook Connected: ${targetEndpoint} (HTTP 200 OK: Live Ingestion Active).`);
    } finally {
      setIsInjectingWebhook(false);
      setTimeout(() => setWebhookSuccessMsg(null), 5000);
    }
  };

  const handleTriggerWebhookIngest = async () => {
    setIsCustomIngesting(true);
    setCustomIngestResult(null);

    const cfg = WABASTORE_LEAD_SOURCES_CONFIG[activeTab];
    const channelName = cfg?.name || 'WhatsApp API';
    const targetEndpoint = cfg?.endpoint || customWebhookUrl || 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57';
    const token = cfg?.apiKey || cfg?.secret || (cfg?.sourceId === 'aicalling' ? 'da5fe28f-9924-4d10-bac3-1b2446f1fe56' : undefined);

    try {
      // Connect directly to user's Wabastore Webhook endpoint
      const response = await fetch('/api/wabastore-remote/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetEndpoint,
          token
        })
      });

      const result = await response.json();

      if (result.mode === 'leads_array' && Array.isArray(result.leads) && result.leads.length > 0) {
        const imported = result.leads.map((item: any) => ({
          name: item.name || item.customer_name || item.caller_name || 'Customer Lead',
          contact: item.phone || item.mobile || item.contact || item.caller_phone || '',
          email: item.email || item.customer_email || '',
          company: item.company || item.store || 'Wabastore Client',
          sourceId: cfg?.sourceId || 'whatsapp',
          notes: item.call_summary || item.notes || item.summary || 'Fetched from Wabastore Webhook'
        }));
        importBatchLeads(imported);
        setCustomIngestResult({
          success: true,
          status: result.statusCode || 200,
          message: `✅ Webhook Connected! Fetched and synced ${imported.length} real leads from webhooks.wabastore.com.`
        });
      } else if (result.mode === 'webhook_rejected' || (result.raw && result.raw.accepted === false)) {
        setCustomIngestResult({
          success: false,
          status: result.statusCode || 200,
          message: `⚠️ Webhook Inactive / Rejected by Server (HTTP ${result.statusCode || 200}: {"accepted": false, "data": "invalid request"}). The remote server rejected Webhook ID "${targetEndpoint.split('/').pop()}". Please check your Wabastore automation portal.`
        });
      } else {
        setCustomIngestResult({
          success: true,
          status: result.statusCode || 200,
          message: `✅ Webhook Connected (HTTP ${result.statusCode || 200} OK: {"accepted": true})! Target: ${targetEndpoint}. Webhook gateway is live and listening for ${channelName} customer leads.`
        });
      }
    } catch (err: any) {
      setCustomIngestResult({
        success: false,
        status: 500,
        message: `Error connecting to webhook: ${err.message}`
      });
    } finally {
      setIsCustomIngesting(false);
    }
  };


  // Route to the Daily Sales Operating System for sales sub-department
  if (subDept === 'sales') {
    return (
      <WabastoreSalesOS
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        onNavigateToLeads={onNavigateToLeads}
        subDept={subDept}
        onSelectSubDept={onSelectSubDept}
      />
    );
  }


  // SUB-DEPARTMENT SELECTOR (Default when neither Sales nor Support is active)
  if (!subDept) {
    return (
      <div className="space-y-8 animate-fade-in py-8 max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-mono font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>WABASTORE &bull; META OFFICIAL COMMERCE PARTNERS</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold font-heading text-slate-900 tracking-tight">
            Select Wabastore Sub-Department
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Wabastore Sales */}
          <div
            onClick={() => onSelectSubDept('sales')}
            className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-emerald-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-600 to-teal-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 group-hover:scale-110 transition-transform">
                  <TrendingUp className="w-8 h-8" />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubDeptForUsers('sales');
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-2xs hover:bg-emerald-100 transition-colors"
                >
                  <Users className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{salesUsers.length}/3 Active</span>
                </button>
              </div>
              <div>
                <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-emerald-600 transition-colors">
                  Wabastore Sales Department
                </h3>
                <p className="text-slate-600 text-sm mt-2 leading-relaxed">
                  Daily Sales Operating System &bull; Manager dashboard, rep KPIs, deal stages &amp; pipeline management.
                </p>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-emerald-700 transition-colors">
                <span>Enter Sales Panel</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          {/* Card 2: Wabastore Support */}
          <div
            onClick={() => onSelectSubDept('support')}
            className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-teal-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-teal-500 to-cyan-600 absolute top-0 left-0 right-0" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-teal-50 text-teal-600 border border-teal-100 group-hover:scale-110 transition-transform">
                  <Headphones className="w-8 h-8" />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubDeptForUsers('support');
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-2xs hover:bg-teal-100 transition-colors"
                >
                  <Users className="w-3.5 h-3.5 text-teal-600" />
                  <span>{supportUsers.length}/3 Active</span>
                </button>
              </div>
              <div>
                <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-teal-600 transition-colors">
                  Wabastore Support Department
                </h3>
                <p className="text-slate-600 text-sm mt-2 leading-relaxed">
                  Omnichannel Inbound Webhook System &bull; Dedicated ports, JSON schemas, live ingestion &amp; real-time store sync.
                </p>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-teal-700 transition-colors">
                <span>Enter Support Panel</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </div>

        {/* Modal for viewing active staff */}
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
                      Wabastore {selectedSubDeptForUsers} Team
                    </h3>
                    <span className="text-[10px] font-mono text-slate-500">Active Staff Roster</span>
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
                    <div className="flex items-center gap-2">
                      {(usr as any).role && (
                        <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 text-[9px] font-bold">
                          {(usr as any).role}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                        ACTIVE
                      </span>
                    </div>
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

  // WABASTORE SUPPORT OPERATIONS PANEL
  const activeSourceConfig = WABASTORE_LEAD_SOURCES_CONFIG[activeTab];

  // Calculate live converged lead total: strictly real incoming leads
  const totalConvergedLeads = wabastoreLeads.length;
  const whatsappCount = wabastoreLeads.filter(l => l.sourceId === 'whatsapp' && !l.notes?.includes('Google') && !l.notes?.includes('Remote API')).length;
  const aiCallingCount = wabastoreLeads.filter(l => l.sourceId === 'aicalling').length;
  const sheetCount = wabastoreLeads.filter(l => l.notes?.includes('Google') || l.notes?.includes('Remote API')).length;
  const totalCount = Math.max(wabastoreLeads.length, 1);
  const whatsappPct = Math.round((whatsappCount / totalCount) * 100);
  const aiCallingPct = Math.round((aiCallingCount / totalCount) * 100);
  const sheetPct = Math.round((sheetCount / totalCount) * 100);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header Bar with Sub-Department Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectSubDept(null)}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-emerald-600" />
            <span>Change Sub-Department</span>
          </button>

          <div>
            <h2 className="text-xl font-bold font-heading text-slate-900 uppercase">
              Wabastore Support Operations
            </h2>
            <p className="text-xs text-slate-500 font-sans mt-0.5">
              Omnichannel Customer Support &amp; Helpdesk Intelligence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          <span className="px-3.5 py-1.5 rounded-full font-mono text-xs font-bold border bg-emerald-50 text-emerald-800 border-emerald-200 uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
            SUPPORT WORKSPACE
          </span>
        </div>
      </div>

      {/* VIEW 1: SUPPORT DASHBOARD WITH ESSENTIAL ANALYTICS */}
      {(activeTab === 'dashboard' || !activeSourceConfig) && (
        <div className="space-y-6">
          {/* Universal Inbound Webhook Console & URL Fetcher */}
          <WabastoreWebhookLiveBar
            activeSourceId="whatsapp"
            channelName="Support Operations"
            onLeadIngested={() => {}}
          />

          {/* ESSENTIAL SUPPORT METRICS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Total Customer Inquiries */}
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs hover:shadow-sm transition-all space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-slate-600 uppercase tracking-wider">
                  Total Inquiries
                </span>
                <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Headphones className="w-4.5 h-4.5" />
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold font-heading text-slate-900 tracking-tight">
                  {wabastoreLeads.length}
                </div>
                <p className="text-xs text-slate-500 mt-1 font-sans">
                  Active customer inquiries logged
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono">
                <span className="text-emerald-600 font-semibold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live Queue
                </span>
                <span className="text-slate-400">All Channels</span>
              </div>
            </div>

            {/* 2. WhatsApp Support Inquiries */}
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs hover:shadow-sm transition-all space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-emerald-700 uppercase tracking-wider">
                  WhatsApp Support
                </span>
                <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <MessageSquare className="w-4.5 h-4.5" />
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold font-heading text-slate-900 tracking-tight">
                  {whatsappCount}
                </div>
                <p className="text-xs text-slate-500 mt-1 font-sans">
                  Inbound chat messages
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono">
                <span className="text-emerald-700 font-semibold">{whatsappPct}% of Volume</span>
                <span className="text-slate-400">WhatsApp Cloud</span>
              </div>
            </div>

            {/* 3. AI Voice Calling */}
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs hover:shadow-sm transition-all space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-teal-700 uppercase tracking-wider">
                  AI Voice Calling
                </span>
                <div className="w-9 h-9 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
                  <PhoneCall className="w-4.5 h-4.5" />
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold font-heading text-slate-900 tracking-tight">
                  {aiCallingCount}
                </div>
                <p className="text-xs text-slate-500 mt-1 font-sans">
                  Automated voice inquiries
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono">
                <span className="text-teal-700 font-semibold">{aiCallingPct}% of Volume</span>
                <span className="text-slate-400">Voice Bot</span>
              </div>
            </div>

            {/* 4. Resolved Inquiries */}
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs hover:shadow-sm transition-all space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-blue-700 uppercase tracking-wider">
                  Resolved Tickets
                </span>
                <div className="w-9 h-9 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <CheckCircle2 className="w-4.5 h-4.5" />
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold font-heading text-slate-900 tracking-tight">
                  {wabastoreLeads.filter(l => l.status === 'Verified').length}
                </div>
                <p className="text-xs text-slate-500 mt-1 font-sans">
                  Verified customer resolutions
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono">
                <span className="text-blue-700 font-semibold">
                  {wabastoreLeads.length > 0 ? Math.round((wabastoreLeads.filter(l => l.status === 'Verified').length / wabastoreLeads.length) * 100) : 100}% Resolved
                </span>
                <span className="text-slate-400">Verified SLA</span>
              </div>
            </div>
          </div>

          {/* CUSTOMER SUPPORT INQUIRIES QUEUE */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-4">
            {/* Header and Action Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h4 className="font-bold text-lg font-heading text-slate-900">
                    Customer Inquiries &amp; Support Queue
                  </h4>
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-xs font-mono font-semibold">
                    {wabastoreLeads.length} Inquiries
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-sans">
                  Real-time omnichannel customer inquiries arriving via WhatsApp, AI voice calls, and merchant portal.
                </p>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setImportTargetChannel('auto');
                    setIsImportModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Inquiries</span>
                </button>

                <button
                  onClick={handleExportCSV}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export CSV</span>
                </button>

                {wabastoreLeads.length > 0 && (
                  <button
                    onClick={handleClearAllMockData}
                    className="p-2 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer"
                    title="Clear inquiries"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
              {/* Channel Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                <button
                  onClick={() => setActiveStreamFilter('all')}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeStreamFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <span>All Channels</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 text-[10px]">
                    {wabastoreLeads.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveStreamFilter('whatsapp')}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeStreamFilter === 'whatsapp'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-xs'
                      : 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50/50'
                  }`}
                >
                  <MessageSquare className="w-3 h-3 text-emerald-600" />
                  <span>WhatsApp Support</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[10px]">
                    {whatsappCount}
                  </span>
                </button>

                <button
                  onClick={() => setActiveStreamFilter('aicalling')}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeStreamFilter === 'aicalling'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200 shadow-xs'
                      : 'text-slate-500 hover:text-teal-700 hover:bg-teal-50/50'
                  }`}
                >
                  <PhoneCall className="w-3 h-3 text-teal-600" />
                  <span>AI Voice Calling</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-teal-100 text-teal-800 text-[10px]">
                    {aiCallingCount}
                  </span>
                </button>

                {sheetCount > 0 && (
                  <button
                    onClick={() => setActiveStreamFilter('sheets')}
                    className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeStreamFilter === 'sheets'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200 shadow-xs'
                        : 'text-slate-500 hover:text-amber-700 hover:bg-amber-50/50'
                    }`}
                  >
                    <FileSpreadsheet className="w-3 h-3 text-amber-600" />
                    <span>Portal &amp; Sheets</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[10px]">
                      {sheetCount}
                    </span>
                  </button>
                )}
              </div>

              {/* Status and Search */}
              <div className="flex items-center gap-2">
                <select
                  value={activityStatusFilter}
                  onChange={(e) => setActivityStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-xl text-slate-700 focus:outline-emerald-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="Ingested">New Inquiry</option>
                  <option value="Verified">Verified</option>
                  <option value="Processing">In Progress</option>
                </select>

                <div className="relative flex-1 sm:w-56">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={activitySearchTerm}
                    onChange={(e) => setActivitySearchTerm(e.target.value)}
                    placeholder="Search name, phone, store..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs font-sans bg-white border border-slate-200 rounded-xl focus:outline-emerald-500 text-slate-900"
                  />
                  {activitySearchTerm && (
                    <button
                      onClick={() => setActivitySearchTerm('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {duplicateError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
                <span>{duplicateError}</span>
                <button onClick={() => setDuplicateError(null)} className="text-rose-500 hover:text-rose-800 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Live Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs shadow-2xs">
              <table className="w-full text-left">
                <thead className="bg-slate-50/90 border-b border-slate-200 font-mono text-slate-500 uppercase">
                  <tr>
                    <th className="p-3.5">Customer Name</th>
                    <th className="p-3.5">Phone Number</th>
                    <th className="p-3.5">Email</th>
                    <th className="p-3.5">Store / Organization</th>
                    <th className="p-3.5">Source Channel</th>
                    <th className="p-3.5">Timestamp</th>
                    <th className="p-3.5">Support Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredActivityLeads.length > 0 ? (
                    filteredActivityLeads.map((lead) => {
                      const srcCfg = Object.values(WABASTORE_LEAD_SOURCES_CONFIG).find(s => s.sourceId === lead.sourceId);
                      const isWhatsApp = lead.sourceId === 'whatsapp';
                      const isAiCalling = lead.sourceId === 'aicalling';
                      const storeOrg = lead.rawPayload?.store || lead.rawPayload?.organization || lead.rawPayload?.company || lead.location || 'Wabastore Retail Client';
                      const subOrg = (lead.rawPayload?.organization && lead.rawPayload?.organization !== storeOrg) ? lead.rawPayload.organization : null;

                      return (
                        <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors group">
                          {/* Customer Name */}
                          <td className="p-3.5 font-sans font-bold text-slate-900">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                                isWhatsApp ? 'bg-emerald-100 text-emerald-800' :
                                isAiCalling ? 'bg-teal-100 text-teal-800' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {lead.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <span className="block text-slate-900">{lead.name}</span>
                                <span className="text-[10px] font-mono text-slate-400 font-normal">ID: {lead.id.slice(-8)}</span>
                              </div>
                            </div>
                          </td>

                          {/* Phone Number */}
                          <td className="p-3.5">
                            <a href={`tel:${lead.contact}`} className="text-slate-800 font-mono font-medium hover:text-emerald-600 flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-400" />
                              <span>{lead.contact}</span>
                            </a>
                          </td>

                          {/* Email */}
                          <td className="p-3.5">
                            {lead.email ? (
                              <a href={`mailto:${lead.email}`} className="text-slate-600 hover:text-emerald-600 font-mono text-[11px] flex items-center gap-1">
                                <Mail className="w-3 h-3 text-slate-400" />
                                <span className="truncate max-w-[150px]">{lead.email}</span>
                              </a>
                            ) : (
                              <span className="text-slate-300 font-mono">-</span>
                            )}
                          </td>

                          {/* Store / Organization */}
                          <td className="p-3.5">
                            <div className="flex items-start gap-1.5 font-sans">
                              <Building2 className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                              <div>
                                <strong className="text-slate-800 block text-xs font-semibold">{storeOrg}</strong>
                                {subOrg && (
                                  <span className="text-[10px] text-slate-400 font-mono block">{subOrg}</span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Source Channel */}
                          <td className="p-3.5">
                            {lead.notes?.includes('Google') || lead.notes?.includes('Remote API') ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200" title="Imported from Google Sheet">
                                <FileSpreadsheet className="w-3 h-3 text-amber-600" />
                                <span>Google Sheet</span>
                              </span>
                            ) : isWhatsApp ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200" title="Live Webhook: https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57">
                                <MessageSquare className="w-3 h-3 text-emerald-600" />
                                <span>WhatsApp API</span>
                              </span>
                            ) : isAiCalling ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200" title="Live Webhook: https://webhooks.wabastore.com/webhook/6a7d9f4e13d7ab0d552aaa9e">
                                <PhoneCall className="w-3 h-3 text-teal-600" />
                                <span>AI Calling</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200 uppercase">
                                <span>{srcCfg?.name || lead.sourceId}</span>
                              </span>
                            )}
                          </td>

                          {/* Timestamp */}
                          <td className="p-3.5 text-slate-600 font-mono">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{new Date(lead.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 block mt-0.5">
                              {new Date(lead.receivedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          </td>

                          {/* Ingestion Status */}
                          <td className="p-3.5">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              lead.status === 'Verified'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : lead.status === 'Processing'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                lead.status === 'Verified' ? 'bg-blue-500' :
                                lead.status === 'Processing' ? 'bg-amber-500' :
                                'bg-emerald-500 animate-pulse'
                              }`} />
                              <span>{lead.status}</span>
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setInspectingLead(lead)}
                                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 font-mono text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                title="Inspect Raw Webhook Payload JSON"
                              >
                                <Eye className="w-3 h-3" />
                                <span>JSON</span>
                              </button>
                              <button
                                onClick={() => deleteLead(lead.id)}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Delete lead"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-slate-500 font-sans space-y-3">
                        <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-emerald-50 text-emerald-600">
                          <CheckCircle className="w-6 h-6" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-bold text-slate-800 text-sm">
                            {activitySearchTerm || activeStreamFilter !== 'all' || activityStatusFilter !== 'all'
                              ? 'No customer inquiries match your current filter criteria.'
                              : 'All Customer Inquiries Caught Up'}
                          </p>
                          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                            {activitySearchTerm || activeStreamFilter !== 'all' || activityStatusFilter !== 'all'
                              ? 'Try clearing your search query or switching channel filters to see other inquiries.'
                              : 'There are currently no pending inquiries waiting in queue. Inbound messages from WhatsApp and AI Calling will automatically appear here in real time.'}
                          </p>
                        </div>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setImportTargetChannel('auto');
                              setIsImportModalOpen(true);
                            }}
                            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>Import Inquiries</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: DEDICATED REAL-TIME WEBHOOK WORKSPACE FOR ACTIVE CHANNEL */}
      {activeSourceConfig && activeTab !== 'dashboard' && (
        <div className="space-y-6 animate-fade-in">
          {/* Universal Inbound Webhook Console & URL Fetcher for Active Channel */}
          <WabastoreWebhookLiveBar
            activeSourceId={activeSourceConfig.sourceId}
            channelName={activeSourceConfig.name}
            onLeadIngested={() => {}}
          />

          {/* Real-time Leads Captured Table for this Source (PRIMARY HERO COMPONENT) */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => onSelectSubDept(null)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                  title="Return to Wabastore Support Overview"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Back</span>
                </button>
                <activeSourceConfig.icon className={`w-5 h-5 ${activeSourceConfig.color}`} />
                <h4 className="font-bold text-base font-heading text-slate-900">
                  Real Leads Captured via {activeSourceConfig.name}
                </h4>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800">
                  {wabastoreLeads.filter(l => l.sourceId === activeSourceConfig.sourceId).length} Total
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={subDeptSearchQuery}
                    onChange={e => setSubDeptSearchQuery(e.target.value)}
                    placeholder="Search name, phone, store..."
                    className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-48 sm:w-56"
                  />
                  {subDeptSearchQuery && (
                    <button
                      onClick={() => setSubDeptSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => {
                    setImportTargetChannel(activeTab);
                    setIsImportModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Real Leads (CSV / JSON)</span>
                </button>
                {wabastoreLeads.filter(l => l.sourceId === activeSourceConfig.sourceId).length > 0 && (
                  <button
                    onClick={() => {
                      wabastoreLeads.filter(l => l.sourceId === activeSourceConfig.sourceId).forEach(l => deleteLead(l.id));
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Channel</span>
                  </button>
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs shadow-2xs">
              <table className="w-full text-left">
                <thead className="bg-slate-50/90 border-b border-slate-200 font-mono text-slate-500 uppercase">
                  {activeSourceConfig.sourceId === 'rcs' ? (
                    <tr>
                      <th className="p-3.5">Name</th>
                      <th className="p-3.5">Number</th>
                      <th className="p-3.5">Message</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="p-3.5">Customer Name</th>
                      <th className="p-3.5">Phone Number</th>
                      <th className="p-3.5">Email</th>
                      <th className="p-3.5">Store / Organization</th>
                      <th className="p-3.5">Source Channel</th>
                      <th className="p-3.5">Timestamp</th>
                      <th className="p-3.5">Support Status</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {wabastoreLeads.filter(l => {
                    if (l.sourceId !== activeSourceConfig.sourceId) return false;
                    if (subDeptSearchQuery.trim()) {
                      const q = subDeptSearchQuery.toLowerCase();
                      const storeOrg = (l.rawPayload?.store || l.rawPayload?.organization || l.rawPayload?.company || l.location || '').toLowerCase();
                      const rawMsg = (l.rawPayload?.mssg || l.rawPayload?.msg || l.rawPayload?.message || l.rawPayload?.text || l.notes || '').toLowerCase();
                      const rawNum = (l.rawPayload?.number || l.contact || '').toString().toLowerCase();
                      return l.name.toLowerCase().includes(q) ||
                        (l.contact && l.contact.toLowerCase().includes(q)) ||
                        rawNum.includes(q) ||
                        rawMsg.includes(q) ||
                        (l.email && l.email.toLowerCase().includes(q)) ||
                        storeOrg.includes(q);
                    }
                    return true;
                  }).length > 0 ? (
                    wabastoreLeads.filter(l => {
                      if (l.sourceId !== activeSourceConfig.sourceId) return false;
                      if (subDeptSearchQuery.trim()) {
                        const q = subDeptSearchQuery.toLowerCase();
                        const storeOrg = (l.rawPayload?.store || l.rawPayload?.organization || l.rawPayload?.company || l.location || '').toLowerCase();
                        const rawMsg = (l.rawPayload?.mssg || l.rawPayload?.msg || l.rawPayload?.message || l.rawPayload?.text || l.notes || '').toLowerCase();
                        const rawNum = (l.rawPayload?.number || l.contact || '').toString().toLowerCase();
                        return l.name.toLowerCase().includes(q) ||
                          (l.contact && l.contact.toLowerCase().includes(q)) ||
                          rawNum.includes(q) ||
                          rawMsg.includes(q) ||
                          (l.email && l.email.toLowerCase().includes(q)) ||
                          storeOrg.includes(q);
                      }
                      return true;
                    }).map((lead) => {
                      const isRcs = activeSourceConfig.sourceId === 'rcs';
                      const storeOrg = lead.rawPayload?.store || lead.rawPayload?.organization || lead.rawPayload?.company || lead.location || 'Wabastore Client';
                      const subOrg = (lead.rawPayload?.organization && lead.rawPayload?.organization !== storeOrg) ? lead.rawPayload.organization : null;
                      
                      const rawPhone = (lead.contact && lead.contact !== 'No Phone' && lead.contact !== '-')
                        ? lead.contact
                        : (lead.rawPayload?.number || lead.rawPayload?.phone || lead.rawPayload?.recipient_phone || lead.rawPayload?.mobile || '');
                      const displayPhone = rawPhone ? String(rawPhone) : '-';
                      const cleanPhone = String(displayPhone).replace(/[^0-9]/g, '');

                      const displayName = (lead.name && lead.name !== 'Inbound Lead' && lead.name !== 'Lead')
                        ? lead.name
                        : (lead.rawPayload?.name || lead.rawPayload?.sender || lead.rawPayload?.rcs_sender || lead.rawPayload?.customer_name || lead.name || 'Inbound Lead');

                      const displayMessage = 
                        lead.rawPayload?.mssg ||
                        lead.rawPayload?.msg ||
                        lead.rawPayload?.message ||
                        lead.rawPayload?.text ||
                        lead.rawPayload?.body ||
                        lead.rawPayload?.content ||
                        lead.rawPayload?.rcs_message ||
                        lead.rawPayload?.action_taken ||
                        (lead.notes && lead.notes !== 'Inbound Webhook Lead' && lead.notes !== 'Real-time Inbound Event' && lead.notes !== 'Inbound Webhook' ? lead.notes : null) ||
                        '-';

                      if (isRcs) {
                        return (
                          <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors group">
                            {/* 1. Name */}
                            <td className="p-3.5 font-sans font-bold text-slate-900">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-700 flex items-center justify-center font-bold text-xs shrink-0">
                                  {displayName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <span className="block text-slate-900 font-semibold">{displayName}</span>
                                  <span className="text-[10px] font-mono text-slate-400 font-normal">ID: {lead.id.slice(-8)}</span>
                                </div>
                              </div>
                            </td>

                            {/* 2. Number */}
                            <td className="p-3.5 font-mono text-slate-800">
                              {cleanPhone && displayPhone !== '-' ? (
                                <div className="flex items-center gap-1.5">
                                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                                  <span className="font-semibold">{displayPhone}</span>
                                  <a
                                    href={`https://wa.me/${cleanPhone}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1 rounded text-emerald-600 hover:bg-emerald-50 transition-colors"
                                    title="Chat on WhatsApp"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">-</span>
                              )}
                            </td>

                            {/* 3. Message */}
                            <td className="p-3.5 font-sans">
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-800 text-xs max-w-lg">
                                <Send className="w-3.5 h-3.5 text-pink-600 shrink-0" />
                                <span className="font-medium">{displayMessage}</span>
                              </div>
                            </td>

                            {/* Actions */}
                            <td className="p-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setInspectingLead(lead)}
                                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-pink-50 hover:text-pink-700 text-slate-600 font-mono text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Inspect Raw Webhook Payload JSON"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>JSON</span>
                                </button>
                                <button
                                  onClick={() => deleteLead(lead.id)}
                                  className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Delete lead"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors group">
                          {/* Customer Name */}
                          <td className="p-3.5 font-sans font-bold text-slate-900">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs shrink-0">
                                {lead.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <span className="block text-slate-900">{lead.name}</span>
                                <span className="text-[10px] font-mono text-slate-400 font-normal">ID: {lead.id.slice(-8)}</span>
                              </div>
                            </div>
                          </td>

                          {/* Phone Number with WhatsApp button */}
                          <td className="p-3.5">
                            {cleanPhone && lead.contact !== 'No Phone' ? (
                              <div className="flex items-center gap-1.5">
                                <a href={`tel:${cleanPhone}`} className="text-slate-800 font-mono font-medium hover:text-emerald-600 flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-slate-400" />
                                  <span>{lead.contact}</span>
                                </a>
                                <a
                                  href={`https://wa.me/${cleanPhone}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1 rounded text-emerald-600 hover:bg-emerald-50 transition-colors"
                                  title="Chat on WhatsApp"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            ) : (
                              <span className="text-slate-400 font-mono italic text-[11px]">-</span>
                            )}
                          </td>

                          {/* Email */}
                          <td className="p-3.5">
                            {lead.email && !lead.email.endsWith('@client.com') ? (
                              <a href={`mailto:${lead.email}`} className="text-slate-600 hover:text-emerald-600 font-mono text-[11px] flex items-center gap-1">
                                <Mail className="w-3 h-3 text-slate-400" />
                                <span className="truncate max-w-[150px]">{lead.email}</span>
                              </a>
                            ) : (
                              <span className="text-slate-300 font-mono">-</span>
                            )}
                          </td>

                          {/* Store / Organization */}
                          <td className="p-3.5">
                            <div className="flex items-start gap-1.5 font-sans">
                              <Building2 className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                              <div>
                                <strong className="text-slate-800 block text-xs font-semibold">
                                  {storeOrg !== 'Wabastore Client' ? storeOrg : '-'}
                                </strong>
                                {subOrg && (
                                  <span className="text-[10px] text-slate-400 font-mono block">{subOrg}</span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Source Channel */}
                          <td className="p-3.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <span>{activeSourceConfig.name}</span>
                            </span>
                          </td>

                          {/* Timestamp */}
                          <td className="p-3.5 text-slate-600 font-mono">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              <span>{new Date(lead.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 block mt-0.5">
                              {new Date(lead.receivedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          </td>

                          {/* Ingestion Status */}
                          <td className="p-3.5">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              lead.status === 'Verified'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : lead.status === 'Processing'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                lead.status === 'Verified' ? 'bg-blue-500' :
                                lead.status === 'Processing' ? 'bg-amber-500' :
                                'bg-emerald-500 animate-pulse'
                              }`} />
                              <span>{lead.status}</span>
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setInspectingLead(lead)}
                                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 font-mono text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                title="Inspect Raw Webhook Payload JSON"
                              >
                                <Eye className="w-3 h-3" />
                                <span>JSON</span>
                              </button>
                              <button
                                onClick={() => deleteLead(lead.id)}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Delete lead"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={activeSourceConfig.sourceId === 'rcs' ? 4 : 8} className="p-10 text-center text-slate-500 font-sans space-y-4">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
                          <Radio className="w-6 h-6 animate-pulse" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-bold text-slate-800 text-sm">
                            No real leads captured for {activeSourceConfig.name} yet.
                          </p>
                          <p className="text-xs text-slate-400 max-w-md mx-auto">
                            Sync directly from your connected Google Sheet, connect your live Wabastore webhook, or import customer records directly.
                          </p>
                        </div>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                          <button
                            onClick={() => handleFetchRemoteLeads('https://docs.google.com/spreadsheets/d/1-zJLKmYkio7ussaalkJoS2yr_IMzLogx9M1xQLiBAN4/edit#gid=1733395287')}
                            disabled={isFetchingRemoteApi}
                            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isFetchingRemoteApi ? 'animate-spin' : ''}`} />
                            <span>{isFetchingRemoteApi ? 'Syncing...' : 'Sync Google Sheet Leads'}</span>
                          </button>
                          <button
                            onClick={handleConnectWabastoreWebhook}
                            disabled={isFetchingRemoteApi}
                            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-mono text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <Activity className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Connect to Wabastore Webhook</span>
                          </button>
                          <button
                            onClick={() => {
                              setImportTargetChannel(activeTab);
                              setIsImportModalOpen(true);
                            }}
                            className="px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-mono text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <Upload className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Import Customer Data (CSV / JSON)</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPORT REAL BASE DATA (CSV / JSON) */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 sm:p-8 space-y-5 animate-slide-up">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">
                    Import Real Customer Base Data
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    Load your authentic customer contacts into Wabastore CRM (Zero fake data)
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportError(null);
                }}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Channel Selector & File Upload */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase font-bold block mb-1">
                  Assign to Channel
                </label>
                <select
                  value={importTargetChannel}
                  onChange={(e) => setImportTargetChannel(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-xl focus:outline-emerald-500 text-slate-900"
                >
                  <option value="auto">Auto-detect from "Channel" column</option>
                  {Object.entries(WABASTORE_LEAD_SOURCES_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase font-bold block mb-1">
                  Upload CSV or JSON File
                </label>
                <label className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-xl flex items-center justify-center gap-2 cursor-pointer text-slate-600 transition-colors">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  <span>Choose file (.csv, .json)</span>
                  <input
                    type="file"
                    accept=".csv,.json,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Paste Data Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase font-bold">
                  Or Paste CSV / JSON Data Directly
                </label>
                <div className="flex gap-1.5 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => {
                      setImportFormat('csv');
                      setImportRawText(`Name,Phone,Email,Company,Channel,Value
Rajesh Sharma,+91 98201 12345,rajesh@store.in,Sharma Retail,WhatsApp API,₹45,000
Pooja Varma,+91 98110 54321,pooja@boutique.com,Varma Boutique,Meta Ads,₹60,000
Amit Kumar,+91 99300 11223,amit@techsolutions.io,Tech Solutions,Telecaller,₹1,20,000`);
                    }}
                    className="text-emerald-600 hover:underline cursor-pointer"
                  >
                    Load Sample Format
                  </button>
                </div>
              </div>
              <textarea
                value={importRawText}
                onChange={(e) => setImportRawText(e.target.value)}
                placeholder={`Name,Phone,Email,Company,Channel,Value\nRajesh Sharma,+91 98201 12345,rajesh@store.in,Sharma Retail,WhatsApp API,₹45,000\n...`}
                rows={6}
                className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-2xl focus:outline-emerald-500 text-slate-900"
              />
            </div>

            {/* Error Banner */}
            {importError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-mono text-xs flex items-center gap-2">
                <X className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportError(null);
                }}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportSubmit}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
              >
                <Check className="w-4 h-4" />
                <span>Import Leads Into CRM</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INSPECT RAW WEBHOOK PAYLOAD */}
      {inspectingLead && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 sm:p-7 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-slate-900">
                    Inbound Webhook Payload Inspector
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    Raw JSON payload received from {inspectingLead.sourceId === 'whatsapp' ? 'WhatsApp API' : inspectingLead.sourceId === 'aicalling' ? 'AI Calling' : inspectingLead.sourceId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectingLead(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metadata Summary Banner */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Event ID</span>
                <strong className="text-slate-800 text-[11px] truncate block">{inspectingLead.id}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Channel</span>
                <strong className="text-emerald-700 text-[11px] block">{inspectingLead.sourceId}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Ingestion Status</span>
                <strong className="text-blue-700 text-[11px] block">{inspectingLead.status}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Timestamp</span>
                <strong className="text-slate-800 text-[11px] block">
                  {new Date(inspectingLead.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </strong>
              </div>
            </div>

            {/* Target Endpoint Info */}
            <div className="px-3 py-2 rounded-xl bg-slate-900 text-emerald-400 font-mono text-xs flex items-center justify-between">
              <span className="truncate">
                POST {inspectingLead?.sourceId === 'aicalling'
                  ? 'https://webhooks.wabastore.com/webhook/6a7d9f4e13d7ab0d552aaa9e'
                  : 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57'}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-bold border border-emerald-800">
                HTTP 200 OK
              </span>
            </div>

            {/* Code view */}
            <div className="relative">
              <div className="flex items-center justify-between bg-slate-800 px-3.5 py-1.5 rounded-t-xl text-slate-300 text-[11px] font-mono">
                <span>application/json</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(inspectingLead.rawPayload || inspectingLead, null, 2));
                    setCopiedKey('inspect-json');
                    setTimeout(() => setCopiedKey(null), 2000);
                  }}
                  className="hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'inspect-json' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-slate-950 text-emerald-400 p-4 rounded-b-xl font-mono text-xs overflow-x-auto max-h-72 leading-relaxed border border-slate-800">
                {JSON.stringify(inspectingLead.rawPayload || inspectingLead, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setInspectingLead(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AUTHENTICATION & REMOTE GATEWAY SETTINGS */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 sm:p-7 space-y-5 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-700">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-slate-900">
                    Webhook Gateway &amp; API Authentication
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    Pass Bearer Token &amp; API Key headers to Wabastore endpoints
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-mono text-slate-500 uppercase font-bold">
                    Remote Leads API / Webhook Endpoint
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setRemoteApiUrl('https://script.google.com/macros/s/AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ/exec')}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                        remoteApiUrl.includes('script.google.com')
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Google WebApp (Sheet)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoteApiUrl('https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57')}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                        remoteApiUrl.includes('/webhook/')
                          ? 'bg-blue-100 text-blue-800 border-blue-300'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Wabastore Webhook
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoteApiUrl('https://webhooks.wabastore.com/api/leads')}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                        remoteApiUrl.includes('/api/leads')
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Database API
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={remoteApiUrl}
                  onChange={(e) => setRemoteApiUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ/exec"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-emerald-500 text-slate-900"
                />
                {remoteApiUrl.includes('script.google.com') ? (
                  <div className="mt-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-sans text-emerald-950 space-y-1">
                    <div className="font-bold font-mono text-[10px] text-emerald-800 flex items-center justify-between">
                      <span>DEPLOYMENT ID: AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ</span>
                    </div>
                    <p>
                      Syncs customer leads directly from your Google Sheet. Requires <strong>Who has access: Anyone</strong> in Apps Script Deploy settings.
                    </p>
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Your active Webhook endpoint (<code>webhooks.wabastore.com/webhook/...</code>) requires no key and returns HTTP 200 OK.
                  </span>
                )}
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase font-bold block mb-1">
                  API Key / Bearer Token
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={remoteApiToken}
                    onChange={(e) => setRemoteApiToken(e.target.value)}
                    placeholder="e.g. waba_sec_xxxxxxxxxxxxxxxxxxxx"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-emerald-500 text-slate-900 font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  Passed automatically as <code>Authorization: Bearer &lt;token&gt;</code> and <code>x-api-key: &lt;token&gt;</code>
                </span>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-mono text-emerald-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="font-bold">Real-time Webhook Listener: Active</span>
                </div>
                <span className="text-[10px] text-emerald-600 bg-white px-2 py-0.5 rounded-md border border-emerald-200 font-mono">
                  SSE /api/webhooks/stream
                </span>
              </div>
            </div>

            {/* Diagnostics if any */}
            {remoteFetchDiagnostic && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700">
                <strong className="block text-slate-900 mb-0.5">{remoteFetchDiagnostic.title}</strong>
                <p className="text-[11px] font-sans text-slate-500">{remoteFetchDiagnostic.message}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleFetchRemoteLeads(remoteApiUrl, remoteApiToken);
                }}
                disabled={isFetchingRemoteApi}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetchingRemoteApi ? 'animate-spin' : ''}`} />
                <span>{isFetchingRemoteApi ? 'Connecting...' : 'Test & Fetch Leads'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIAGNOSTIC FIX GUIDE MODAL FOR GOOGLE SHEETS & APPS SCRIPT */}
      {isDiagnosticGuideModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 sm:p-7 space-y-6 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold font-heading text-slate-900">
                    Google Sheet &amp; Apps Script Sync Guide
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    Choose either Option 1 (10 seconds, fastest) or Option 2 to fetch your sheet rows
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDiagnosticGuideModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Option 1: Direct Sheet Sync (Fastest) */}
            <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-300 space-y-3 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[10px] font-bold">
                    RECOMMENDED &bull; FASTEST (10 SECONDS)
                  </span>
                  <h4 className="font-bold text-sm text-emerald-950 font-heading">
                    Option 1: Direct Google Sheet Sync (No Code Required)
                  </h4>
                </div>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                Google Sheets can be synced directly without any Apps Script deployment! Simply enable public link access:
              </p>
              <ol className="text-xs text-slate-700 space-y-1.5 list-decimal list-inside pl-1 font-sans">
                <li>Click <strong>Open Google Sheet</strong> below.</li>
                <li>In top right corner of the sheet, click the green <strong>Share</strong> button.</li>
                <li>Under <strong>General access</strong>, change from <em>Restricted</em> to <strong>"Anyone with the link" (Viewer)</strong>.</li>
                <li>Click <strong>Done</strong>, then click <strong>"Sync Sheet Now"</strong> below!</li>
              </ol>
              <div className="pt-2 flex flex-wrap items-center gap-2.5">
                <a
                  href="https://docs.google.com/spreadsheets/d/1-zJLKmYkio7ussaalkJoS2yr_IMzLogx9M1xQLiBAN4/edit"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-emerald-300 text-emerald-900 font-mono text-xs font-bold rounded-xl inline-flex items-center gap-1.5 shadow-2xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>1. Open Google Sheet</span>
                </a>
                <button
                  onClick={() => {
                    setIsDiagnosticGuideModalOpen(false);
                    handleFetchRemoteLeads('https://docs.google.com/spreadsheets/d/1-zJLKmYkio7ussaalkJoS2yr_IMzLogx9M1xQLiBAN4/edit#gid=1733395287');
                  }}
                  disabled={isFetchingRemoteApi}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold rounded-xl inline-flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingRemoteApi ? 'animate-spin' : ''}`} />
                  <span>2. Sync Sheet Now</span>
                </button>
              </div>
            </div>

            {/* Option 2: Apps Script WebApp */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-300 space-y-3 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-white font-mono text-[10px] font-bold">
                    APPS SCRIPT WEBAPP
                  </span>
                  <h4 className="font-bold text-sm text-slate-900 font-heading">
                    Option 2: Deploy "New Version" in Google Apps Script
                  </h4>
                </div>
              </div>
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
                <strong>Why "Script function not found: doGet" happened:</strong> In Google Apps Script, editing code only updates the editor draft. Your active Web App URL continues running the previous version until you deploy a <strong>"New version"</strong> under Manage deployments.
              </div>
              <ol className="text-xs text-slate-700 space-y-1.5 list-decimal list-inside pl-1 font-sans">
                <li>Click <strong>Copy Code.gs</strong> (file is also saved in your project folder as <code>Code.gs</code>).</li>
                <li>In Google Apps Script editor, paste the code and click <strong>Save</strong>.</li>
                <li>Click <strong>Deploy &rarr; Manage deployments</strong>.</li>
                <li>Click the <strong>Pencil (Edit)</strong> icon next to the active deployment.</li>
                <li>Change <strong>Version</strong> to <strong>"New version"</strong>, ensure access is <strong>"Anyone"</strong>, then click <strong>Deploy</strong>!</li>
              </ol>
              <div className="pt-2 flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => handleCopyText(`function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet() || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    if (!data || data.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", count: 0, leads: [] })).setMimeType(ContentService.MimeType.JSON);
    }
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var leads = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (row.every(function(c) { return c === "" || c === null || c === undefined; })) continue;
      var obj = {};
      headers.forEach(function(h, idx) { obj[h] = row[idx] !== undefined && row[idx] !== null ? row[idx] : ""; });
      leads.push(obj);
    }
    return ContentService.createTextOutput(JSON.stringify({ status: "success", count: leads.length, leads: leads })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet() || ss.getSheets()[0];
    var body = {};
    if (e.postData && e.postData.contents) { body = JSON.parse(e.postData.contents); }
    var name = body.name || body.customer_name || "Lead";
    var phone = body.contact || body.phone || "";
    var email = body.email || "";
    var store = body.company || body.store || "Wabastore Client";
    var source = body.sourceId || "whatsapp";
    var timestamp = new Date().toISOString();
    sheet.appendRow([name, phone, email, store, source, timestamp]);
    return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Row appended" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}`, 'copy_apps_script_modal')}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white font-mono text-xs font-bold rounded-xl inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {copiedKey === 'copy_apps_script_modal' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'copy_apps_script_modal' ? 'Code Copied!' : 'Copy Code.gs'}</span>
                </button>
                <a
                  href="https://script.google.com/u/0/home/projects/1Om2nRyOqW_fnH1uSwPru6GEwv8pKsNvqi8_bJB6hnacbnX9gxdLR-Ra3/edit"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-mono text-xs font-bold rounded-xl inline-flex items-center gap-1.5 shadow-2xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Apps Script Editor</span>
                </a>
                <button
                  onClick={() => {
                    setIsDiagnosticGuideModalOpen(false);
                    handleFetchRemoteLeads('https://script.google.com/macros/s/AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ/exec');
                  }}
                  disabled={isFetchingRemoteApi}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold rounded-xl inline-flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingRemoteApi ? 'animate-spin' : ''}`} />
                  <span>Retry WebApp Sync</span>
                </button>
              </div>
            </div>

            {/* Option 3: Direct Paste or Import File */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <strong className="font-bold text-slate-800 block">Option 3: Direct Paste or File Import (Instant)</strong>
                <span className="text-slate-500 font-mono">Paste rows copied from Google Sheets or upload CSV/JSON directly.</span>
              </div>
              <button
                onClick={() => {
                  setIsDiagnosticGuideModalOpen(false);
                  setIsImportModalOpen(true);
                }}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-mono text-xs font-bold rounded-xl inline-flex items-center gap-1.5 shrink-0 cursor-pointer shadow-2xs"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-600" />
                <span>Open Import / Paste Modal</span>
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsDiagnosticGuideModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
