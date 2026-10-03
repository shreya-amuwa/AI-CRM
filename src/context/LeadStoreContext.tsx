import React, { createContext, useContext, useState, useEffect } from 'react';
import { Lead, DepartmentId, LeadSourceId } from '../types/crm';
import { INITIAL_LEADS } from '../data/initialLeads';
import { LEAD_SOURCE_LIST } from '../data/leadSources';
import { DEPARTMENTS } from '../data/departments';
import { getSupabase } from '../services/supabaseClient';

export interface DuplicateAnomaly {
  customer: string;
  phone: string;
  email: string;
  field: 'name' | 'phone' | 'email';
  reason: string;
  timestamp: string;
}

export const normalizePhone = (phone?: string): string => {
  return (phone || '').replace(/\D/g, '').slice(-10);
};

export const normalizeEmail = (email?: string): string => {
  return (email || '').trim().toLowerCase();
};

export const normalizeName = (name?: string): string => {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
};

export const KNOWN_SYNTHETIC_NAMES = new Set([
  'girish kulkarni', 'sunita sethi', 'manish tiwari', 'tanvi agarwal',
  'rohan deshmukh', 'bhavna patel', 'kalyan sundaram', 'alok chatterjee',
  'jaspreet singh', 'pradeep varma', 'kavita reddy', 'deepak bajaj',
  'meenakshi iyer', 'naveen choudhary', 'swati mukherjee', 'arun mathur',
  'geeta nayak', 'harish somani', 'devendra bansal', 'ritu kumar',
  'rohan mehra', 'sunita deshmukh', 'vikram singhania', 'pooja sharma', 'gaurav nair', 'ananya roy',
  'suresh oberoi', 'deepika nair', 'kiran more', 'harish mehta', 'meenakshi sundaram', 'voice bot verified lead'
]);

export const extractCustomerDetailsFromWebhook = (payload: any) => {
  if (!payload || typeof payload !== 'object') {
    return { name: '', phone: '', email: '', store: '', notes: '' };
  }

  const unwrapped = payload.body && typeof payload.body === 'object'
    ? payload.body
    : (payload.data && typeof payload.data === 'object' ? payload.data : payload);

  // 1. WhatsApp Cloud API / Meta Webhook structure
  try {
    const entry = unwrapped.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (change) {
      const contact = change.contacts?.[0];
      const message = change.messages?.[0];
      const profileName = contact?.profile?.name || '';
      const waPhone = contact?.wa_id || message?.from || '';
      const msgText = message?.text?.body || message?.caption || (message?.type ? `WhatsApp ${message.type}` : '');
      const metaStore = change.metadata?.display_phone_number ? `WhatsApp Store (${change.metadata.display_phone_number})` : '';

      if (profileName || waPhone) {
        return {
          name: profileName || `WhatsApp User ${waPhone.slice(-4)}`,
          phone: waPhone.startsWith('+') ? waPhone : `+${waPhone}`,
          email: unwrapped.email || '',
          store: metaStore || unwrapped.store || unwrapped.organization || 'WhatsApp Cloud Client',
          notes: msgText || 'Inbound WhatsApp Message'
        };
      }
    }
  } catch {}

  // 2. Standard webhook & AI Calling payload
  const name = (
    unwrapped.customer_name ||
    unwrapped.customerName ||
    unwrapped.name ||
    unwrapped.full_name ||
    unwrapped.fullName ||
    unwrapped.contact_name ||
    unwrapped.contactPerson ||
    unwrapped.profile_name ||
    unwrapped.caller_name ||
    unwrapped.caller ||
    unwrapped.prospect_name ||
    ''
  ).trim();

  const phone = (
    unwrapped.phone ||
    unwrapped.customer_phone ||
    unwrapped.customerPhone ||
    unwrapped.caller_phone ||
    unwrapped.phone_number ||
    unwrapped.phoneNumber ||
    unwrapped.caller_id ||
    unwrapped.callerId ||
    unwrapped.mobile ||
    unwrapped.contact ||
    unwrapped.number ||
    unwrapped.recipient_phone ||
    unwrapped.from ||
    unwrapped.wa_id ||
    ''
  ).toString().trim();

  const email = (
    unwrapped.email ||
    unwrapped.customer_email ||
    unwrapped.customerEmail ||
    unwrapped.mail ||
    ''
  ).toString().trim();

  const store = (
    unwrapped.store ||
    unwrapped.store_name ||
    unwrapped.organization ||
    unwrapped.company ||
    unwrapped.brand_name ||
    unwrapped.shop_name ||
    unwrapped.client ||
    'Wabastore Client'
  ).toString().trim();

  const notes = (
    unwrapped.mssg ||
    unwrapped.msg ||
    unwrapped.message ||
    unwrapped.text ||
    unwrapped.body ||
    unwrapped.rcs_message ||
    unwrapped.call_summary ||
    unwrapped.summary ||
    unwrapped.transcript ||
    unwrapped.disposition ||
    unwrapped.notes ||
    unwrapped.inquiry ||
    unwrapped.product ||
    unwrapped.event ||
    (unwrapped.cart_value ? `Cart: ${unwrapped.cart_value}` : '') ||
    'Inbound Webhook'
  ).toString().trim();

  return { name, phone, email, store, notes };
};

export const isPlaceholderOrTestLead = (lead: { id?: string; name?: string; contact?: string; email?: string; notes?: string }): boolean => {
  const name = (lead.name || '').toLowerCase().trim();
  const phone = (lead.contact || '').replace(/\D/g, '');
  const email = (lead.email || '').toLowerCase().trim();
  const notes = (lead.notes || '').toLowerCase();
  const id = (lead.id || '').toUpperCase();

  // Reject dummy ID patterns
  if (
    id.startsWith('I-') ||
    id.startsWith('D-') ||
    id.startsWith('SIM-') ||
    id.startsWith('LD-9') ||
    id.startsWith('LD-TEST-') ||
    id.startsWith('LD-DUMMY-')
  ) {
    return true;
  }

  // Reject empty name
  if (!name) return true;

  // Test / placeholder / mock names
  if (
    name === 'inbound lead' ||
    name === 'direct ingest' ||
    name === 'customer lead' ||
    name === 'real customer' ||
    name === 'real inbound customer' ||
    name === 'real meta lead' ||
    name.includes('test') ||
    name.includes('dummy') ||
    name.includes('placeholder') ||
    name.includes('fake') ||
    name.includes('sample') ||
    name.includes('john doe') ||
    name.includes('jane doe') ||
    name.includes('mock') ||
    name.includes('voice bot') ||
    name.startsWith('lead-') ||
    KNOWN_SYNTHETIC_NAMES.has(name)
  ) {
    return true;
  }

  // Detect synthetic notes
  if (
    notes.includes('waba multi-store retail pos') ||
    notes.includes('fmcg barcode & inventory suite') ||
    notes.includes('commercial tools invoice generated') ||
    notes.includes('textile saree erp connector') ||
    notes.includes('weatherproof exterior emulsion') ||
    notes.includes('voice bot verified')
  ) {
    return true;
  }

  // Placeholder phone numbers (e.g. repeated 9s, 0s, 12345, or synthetic +91 98201 3xxxx) - only checked if phone is provided
  if (phone.length > 0) {
    if (
      phone.length < 8 ||
      phone === '9999999999' ||
      phone === '0000000000' ||
      phone === '1234567890' ||
      phone.startsWith('982013') ||
      /^(\d)\1{7,}$/.test(phone)
    ) {
      return true;
    }
  }

  // Test email domains - only checked if email is provided
  if (email.length > 0) {
    if (
      email.includes('@example.com') ||
      email.includes('@test.com') ||
      email.includes('@sample.com') ||
      email.includes('placeholder') ||
      email.includes('dummy') ||
      email.endsWith('store.in')
    ) {
      return true;
    }
  }

  return false;
};

interface LeadStoreContextType {
  leads: Lead[];
  isAutoSimulating: boolean;
  duplicateAnomaly: DuplicateAnomaly | null;
  clearDuplicateAnomaly: () => void;
  addWebhookLead: (
    departmentId: DepartmentId,
    sourceId: LeadSourceId,
    customPayload?: Record<string, any>,
    contactName?: string,
    contactPhone?: string,
    allowTestLead?: boolean
  ) => Lead | null;
  getLeadsForDepartment: (departmentId: DepartmentId) => Lead[];
  getLeadsBySource: (sourceId: LeadSourceId, departmentId?: DepartmentId) => Lead[];
  toggleAutoSimulation: () => void;
  clearLeadsForDepartment: (departmentId: DepartmentId) => void;
  deleteLead: (leadId: string) => void;
  importBatchLeads: (newLeadsData: Array<{
    departmentId?: DepartmentId;
    sourceId?: LeadSourceId;
    name: string;
    contact: string;
    email?: string;
    company?: string;
    location?: string;
    notes?: string;
    rawPayload?: Record<string, any>;
  }>, allowTest?: boolean) => Lead[];
}

const LeadStoreContext = createContext<LeadStoreContextType | undefined>(undefined);

export const LeadStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [duplicateAnomaly, setDuplicateAnomaly] = useState<DuplicateAnomaly | null>(null);

  const [leads, setLeads] = useState<Lead[]>(() => {
    const saved = localStorage.getItem('unified_crm_leads');
    if (saved) {
      try {
        const parsed: Lead[] = JSON.parse(saved);
        // Strictly filter out test data, placeholder names, and deduplicate all records!
        const seenPhones = new Set<string>();
        const seenEmails = new Set<string>();
        const seenNames = new Set<string>();
        const cleaned: Lead[] = [];

        for (const l of parsed) {
          if (!l || !l.name) continue;
          if (isPlaceholderOrTestLead(l)) continue;

          const p = normalizePhone(l.contact);
          const e = normalizeEmail(l.email);
          const n = normalizeName(l.name);

          // Enforce uniqueness across phone, email, and name
          if (p && p.length >= 8 && seenPhones.has(p)) continue;
          if (e && !e.includes('@client.com') && seenEmails.has(e)) continue;
          if (n && n.length >= 3 && seenNames.has(n)) continue;

          if (p && p.length >= 8) seenPhones.add(p);
          if (e && !e.includes('@client.com')) seenEmails.add(e);
          if (n && n.length >= 3) seenNames.add(n);

          cleaned.push(l);
        }

        // Strictly purge any dummy records (including legacy LD-9, I-*, D-*, SIM-*)
        const finalCleaned = cleaned.filter(
          l => !l.id.startsWith('LD-9') &&
               !l.id.startsWith('I-') &&
               !l.id.startsWith('D-') &&
               !l.id.startsWith('SIM-') &&
               !l.id.startsWith('LD-TEST-') &&
               !l.id.startsWith('LD-DUMMY-') &&
               !KNOWN_SYNTHETIC_NAMES.has(l.name.toLowerCase().trim()) &&
               !(l.departmentId === 'wabastore' && (
                 (l.sourceId === 'aicalling' && (
                   l.name.toLowerCase().includes('rohan mehra') ||
                   l.name.toLowerCase().includes('sunita deshmukh') ||
                   l.name.toLowerCase().includes('suresh oberoi') ||
                   l.name.toLowerCase().includes('deepika nair') ||
                   l.name.toLowerCase().includes('kiran more') ||
                   l.name.toLowerCase().includes('harish mehta') ||
                   l.name.toLowerCase().includes('meenakshi sundaram') ||
                   l.name.toLowerCase().includes('voice bot') ||
                   l.id.startsWith('WABA-AICALL-')
                 )) ||
                 (l.sourceId === 'whatsapp' && (
                   l.name.toLowerCase().includes('vikram singhania') ||
                   l.name.toLowerCase().includes('pooja sharma') ||
                   l.name.toLowerCase().includes('gaurav nair') ||
                   l.id.startsWith('WABA-WHATSAPP-')
                 ))
               ))
        );

        // Immediately purge from localStorage if stale demo data was removed
        if (finalCleaned.length !== parsed.length) {
          try {
            localStorage.setItem('unified_crm_leads', JSON.stringify(finalCleaned));
          } catch {}
        }

        return finalCleaned;
      } catch {
        return INITIAL_LEADS;
      }
    }
    return INITIAL_LEADS;
  });

  // Disabled by default: Only real webhook data is shown unless explicitly toggled
  const [isAutoSimulating, setIsAutoSimulating] = useState(false);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('unified_crm_leads', JSON.stringify(leads));
  }, [leads]);

  const clearDuplicateAnomaly = () => setDuplicateAnomaly(null);

  // Live Webhook Ingestion Engine: strictly unique, non-duplicate, verified real customer leads
  const addWebhookLead = (
    departmentId: DepartmentId,
    sourceId: LeadSourceId,
    customPayload?: Record<string, any>,
    contactName?: string,
    contactPhone?: string,
    allowTestLead: boolean = false
  ): Lead | null => {
    const sourceObj = LEAD_SOURCE_LIST.find(s => s.id === sourceId);
    const payload = customPayload || {};
    const extracted = extractCustomerDetailsFromWebhook(payload);

    const realName = (contactName || extracted.name || '').trim();
    const realPhone = (contactPhone || extracted.phone || '').trim();
    const realEmail = (extracted.email || payload.email || '').trim();
    const realCompany = (extracted.store || payload.store || payload.organization || payload.company || `${sourceObj?.name || sourceId} Store`).trim();
    const realLocation = payload.location || payload.city || 'Live Webhook';
    const realStatus = (payload.status === 'Verified' || payload.status === 'Processing') ? payload.status : 'Verified';
    const realTime = payload.timestamp || new Date().toISOString();

    // Must have at least name or phone
    if (!realName && !realPhone) {
      console.warn('[LeadStore] Rejected lead with missing customer name and phone.');
      return null;
    }

    // 1. Filter out all test data and placeholder names (unless testing explicitly enabled)
    if (!allowTestLead && isPlaceholderOrTestLead({ name: realName, contact: realPhone, email: realEmail, notes: extracted.notes })) {
      console.warn(`[LeadStore Deduplication] Filtered out test/placeholder lead: "${realName}" (${realPhone}). Rejected from dataset.`);
      return null;
    }

    // 2. Strict Deduplication Check against all existing leads in the dataset
    const normPhone = normalizePhone(realPhone);
    const normEmail = normalizeEmail(realEmail);
    const normName = normalizeName(realName);

    for (const existing of leads) {
      if (existing.departmentId === departmentId) {
        // Match by phone number
        if (normPhone && normPhone.length >= 8 && normalizePhone(existing.contact) === normPhone) {
          const errReason = `Duplicate phone number (${realPhone}) matches existing customer "${existing.name}". Duplicate rejected!`;
          console.error(`[LeadStore STOP] ${errReason}`);
          setDuplicateAnomaly({
            customer: realName,
            phone: realPhone,
            email: realEmail,
            field: 'phone',
            reason: errReason,
            timestamp: new Date().toISOString()
          });
          return null; // STOP and flag error!
        }

        // Match by email
        if (normEmail && !normEmail.includes('@client.com') && normalizeEmail(existing.email) === normEmail) {
          const errReason = `Duplicate email address (${realEmail}) matches existing customer "${existing.name}". Duplicate rejected!`;
          console.error(`[LeadStore STOP] ${errReason}`);
          setDuplicateAnomaly({
            customer: realName,
            phone: realPhone,
            email: realEmail,
            field: 'email',
            reason: errReason,
            timestamp: new Date().toISOString()
          });
          return null; // STOP and flag error!
        }

        // Match by customer name
        if (normName && normName.length >= 3 && normalizeName(existing.name) === normName) {
          const errReason = `Duplicate customer name ("${realName}") already exists in the dataset. Duplicate rejected!`;
          console.error(`[LeadStore STOP] ${errReason}`);
          setDuplicateAnomaly({
            customer: realName,
            phone: realPhone,
            email: realEmail,
            field: 'name',
            reason: errReason,
            timestamp: new Date().toISOString()
          });
          return null; // STOP and flag error!
        }
      }
    }

    // 3. Lead is 100% unique, fresh, and non-duplicate
    const channelPrefix = sourceId === 'aicalling' ? 'AICALL' : sourceId === 'whatsapp' ? 'WA' : sourceId.toUpperCase();
    const newLead: Lead = {
      id: payload.id || `WABA-${channelPrefix}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`,
      name: realName,
      contact: realPhone,
      email: realEmail,
      sourceId,
      departmentId,
      receivedAt: realTime,
      status: realStatus,
      location: realLocation,
      notes: payload.notes || payload.message || payload.call_summary || payload.transcript || payload.intent || `Verified real-time ${sourceId === 'aicalling' ? 'AI Voice Call' : 'WhatsApp'} interaction for ${realCompany}`,
      rawPayload: {
        ...payload,
        name: realName,
        phone: realPhone,
        email: realEmail,
        store: realCompany,
        company: realCompany,
        organization: payload.organization || realCompany,
        verified_channel: sourceId,
        interaction_timestamp: realTime
      }
    };

    setLeads(prev => [newLead, ...prev]);
    return newLead;
  };

  // Auto-simulation loop removed: CRM runs strictly in real-time webhook push mode

  // 1. Supabase Realtime Cloud Listener & Inbound Stream
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    // Initial Hydration: Load any recent persistent leads from Supabase crm_leads table
    const hydrateCloudLeads = async () => {
      try {
        const { data, error } = await supabase
          .from('crm_leads')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        if (!error && Array.isArray(data) && data.length > 0) {
          setLeads(prev => {
            const seenIds = new Set(prev.map(p => p.id));
            const seenPhones = new Set(prev.map(p => normalizePhone(p.contact)).filter(Boolean));
            const newToAdd: Lead[] = [];

            data.forEach((row: any) => {
              if (!row) return;
              if (seenIds.has(row.id)) return;
              const rawPayload = row.raw_payload || row || {};
              const phoneVal = (row.phone || rawPayload.number || rawPayload.phone || rawPayload.recipient_phone || '').toString().trim();
              const p = normalizePhone(phoneVal);
              if (p && p.length >= 8 && seenPhones.has(p)) return;

              const channelId = (row.channel || 'whatsapp') as LeadSourceId;
              const deptId = (row.department || 'wabastore') as DepartmentId;
              const nameVal = (row.name && row.name !== 'Inbound Lead' && row.name !== 'Lead')
                ? row.name
                : (rawPayload.name || rawPayload.sender || rawPayload.rcs_sender || row.name || 'Inbound Lead');
              const msgVal = row.notes || rawPayload.mssg || rawPayload.msg || rawPayload.message || rawPayload.text || rawPayload.body || 'Inbound Webhook Lead';

              newToAdd.push({
                id: row.id,
                name: nameVal,
                contact: phoneVal || '',
                email: row.email || rawPayload.email || '',
                sourceId: channelId,
                departmentId: deptId,
                receivedAt: row.created_at || new Date().toISOString(),
                status: row.status || 'Verified',
                location: row.company || rawPayload.company || rawPayload.store || 'Supabase Cloud',
                notes: msgVal,
                rawPayload: rawPayload
              });
              if (p && p.length >= 8) seenPhones.add(p);
            });

            if (newToAdd.length === 0) return prev;
            return [...newToAdd, ...prev];
          });
        }
      } catch (err) {
        console.warn('[LeadStore] Supabase cloud hydration warning:', err);
      }
    };

    hydrateCloudLeads();

    // Live WebSocket Subscription: 0-second latency real-time push from external webhooks & n8n
    const channel = supabase
      .channel('public:crm_leads:realtime_inbound')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'crm_leads' },
        (payload) => {
          const row = payload.new;
          if (row) {
            console.log('[Supabase Realtime] Inbound lead arrived live:', row);
            const channelId = (row.channel || 'whatsapp') as LeadSourceId;
            const deptId = (row.department || 'wabastore') as DepartmentId;
            const rawPayload = row.raw_payload || row || {};
            const phoneVal = (row.phone || rawPayload.number || rawPayload.phone || rawPayload.recipient_phone || '').toString().trim();
            const nameVal = (row.name && row.name !== 'Inbound Lead' && row.name !== 'Lead')
              ? row.name
              : (rawPayload.name || rawPayload.sender || rawPayload.rcs_sender || row.name || 'Inbound Lead');
            const msgVal = row.notes || rawPayload.mssg || rawPayload.msg || rawPayload.message || rawPayload.text || rawPayload.body || 'Real-time Inbound Event';

            const newLead: Lead = {
              id: row.id || `SUPA-${Date.now()}`,
              name: nameVal,
              contact: phoneVal || '',
              email: row.email || rawPayload.email || '',
              sourceId: channelId,
              departmentId: deptId,
              receivedAt: row.created_at || new Date().toISOString(),
              status: row.status || 'Verified',
              location: row.company || rawPayload.company || rawPayload.store || 'Live Inbound Webhook',
              notes: msgVal,
              rawPayload: rawPayload
            };

            setLeads(prev => {
              if (prev.some(p => p.id === newLead.id)) return prev;
              const pPhone = normalizePhone(newLead.contact);
              if (pPhone && pPhone.length >= 8 && prev.some(p => normalizePhone(p.contact) === pPhone)) return prev;
              return [newLead, ...prev];
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('[Supabase Realtime Stream status]:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 2. Real-Time Server-Sent Events Listener (Local Development Fallback)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalhost) return;

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/webhooks/stream');
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'lead_inbound') {
            const rawSource = String(data.source || '').toLowerCase();
            const sourceMap: Record<string, LeadSourceId> = {
              whatsapp: 'whatsapp',
              whatsapp_api: 'whatsapp',
              lead_src_1: 'whatsapp',
              meta: 'meta',
              meta_ads: 'meta',
              lead_src_2: 'meta',
              telecaller: 'telecaller',
              lead_src_3: 'telecaller',
              bizdev: 'bizdev',
              business_developer: 'bizdev',
              lead_src_4: 'bizdev',
              aicalling: 'aicalling',
              ai_calling: 'aicalling',
              lead_src_5: 'aicalling',
              rcs: 'rcs',
              rcs_messages: 'rcs',
              lead_src_6: 'rcs',
              website: 'website',
              lead_src_7: 'website',
              references: 'references',
              lead_src_8: 'references',
              coldcalling: 'coldcalling',
              cold_calling: 'coldcalling',
              lead_src_9: 'coldcalling',
              thirdparty: 'thirdparty',
              third_party: 'thirdparty',
              lead_src_10: 'thirdparty'
            };

            const matchedSource: LeadSourceId = sourceMap[rawSource] || 'whatsapp';
            const payload = data.payload || {};
            const extracted = extractCustomerDetailsFromWebhook(payload);

            addWebhookLead(
              (data.department || 'wabastore') as DepartmentId,
              matchedSource,
              payload,
              extracted.name,
              extracted.phone
            );
          }
        } catch (parseErr) {
          console.warn('[Webhook SSE] Parse error:', parseErr);
        }
      };
    } catch (err) {
      console.warn('[Webhook SSE] Connection error:', err);
    }

    return () => {
      if (es) es.close();
    };
  }, []);

  const getLeadsForDepartment = (departmentId: DepartmentId) => {
    return leads.filter(l => l.departmentId === departmentId);
  };

  const getLeadsBySource = (sourceId: LeadSourceId, departmentId?: DepartmentId) => {
    return leads.filter(l => l.sourceId === sourceId && (!departmentId || l.departmentId === departmentId));
  };

  const clearLeadsForDepartment = (departmentId: DepartmentId) => {
    setLeads(prev => {
      const filtered = prev.filter(l => l.departmentId !== departmentId);
      try {
        localStorage.setItem('unified_crm_leads', JSON.stringify(filtered));
      } catch {}
      return filtered;
    });
  };

  const deleteLead = (leadId: string) => {
    setLeads(prev => {
      const filtered = prev.filter(l => l.id !== leadId);
      try {
        localStorage.setItem('unified_crm_leads', JSON.stringify(filtered));
      } catch {}
      return filtered;
    });
  };

  const importBatchLeads = (
    newLeadsData: Array<{
      departmentId?: DepartmentId;
      sourceId?: LeadSourceId;
      name: string;
      contact: string;
      email?: string;
      company?: string;
      location?: string;
      notes?: string;
      rawPayload?: Record<string, any>;
    }>,
    allowTest: boolean = false
  ): Lead[] => {
    const deduplicatedBatch: Lead[] = [];
    const currentList = [...leads];

    for (const d of newLeadsData) {
      if (!allowTest && isPlaceholderOrTestLead({ name: d.name, contact: d.contact, email: d.email })) {
        continue;
      }

      const candPhone = normalizePhone(d.contact);
      const candEmail = normalizeEmail(d.email);
      const candName = normalizeName(d.name);

      let isDup = false;
      for (const ex of currentList) {
        if (
          (candPhone && candPhone.length >= 8 && normalizePhone(ex.contact) === candPhone) ||
          (candEmail && candEmail.length > 0 && normalizeEmail(ex.email) === candEmail) ||
          (candName && candName.length >= 3 && normalizeName(ex.name) === candName)
        ) {
          isDup = true;
          break;
        }
      }

      if (isDup) continue;

      const sourceObj = LEAD_SOURCE_LIST.find(s => s.id === (d.sourceId || 'whatsapp'));
      const newL: Lead = {
        id: `LD-REAL-${Date.now().toString().slice(-4)}${deduplicatedBatch.length}${Math.floor(Math.random() * 90 + 10)}`,
        name: d.name,
        contact: d.contact || 'No Phone',
        email: d.email || '',
        sourceId: d.sourceId || 'whatsapp',
        departmentId: d.departmentId || 'wabastore',
        receivedAt: new Date().toISOString(),
        status: 'Verified',
        location: d.location || 'Real Customer',
        notes: d.notes || d.company || `Verified customer lead from ${sourceObj?.name || 'Wabastore'}`,
        rawPayload: d.rawPayload || { ...d, company: d.company, imported: true }
      };

      deduplicatedBatch.push(newL);
      currentList.unshift(newL);
    }

    if (deduplicatedBatch.length > 0) {
      setLeads(prev => {
        const updated = [...deduplicatedBatch, ...prev];
        try {
          localStorage.setItem('unified_crm_leads', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    }

    return deduplicatedBatch;
  };

  const toggleAutoSimulation = () => setIsAutoSimulating(prev => !prev);

  return (
    <LeadStoreContext.Provider
      value={{
        leads,
        isAutoSimulating,
        duplicateAnomaly,
        clearDuplicateAnomaly,
        addWebhookLead,
        getLeadsForDepartment,
        getLeadsBySource,
        toggleAutoSimulation,
        clearLeadsForDepartment,
        deleteLead,
        importBatchLeads
      }}
    >
      {children}
    </LeadStoreContext.Provider>
  );
};

export const useLeadStore = () => {
  const context = useContext(LeadStoreContext);
  if (!context) throw new Error('useLeadStore must be used within LeadStoreProvider');
  return context;
};
