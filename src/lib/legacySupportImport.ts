/**
 * One-time move of Technical Support records that the old dashboard kept in
 * this browser (localStorage) into the database pipeline. A record is removed
 * from the browser only after the server has stored it.
 */
import type { LeadCreateInput } from '../../shared/validation';
import { errorMessage } from './api/client';
import { pipelineApi } from './api/endpoints';

const KEY = 'wabastore_tech_support_data_v1';

interface OldRecord {
  id: string;
  name?: string;
  businessName?: string;
  services?: string[];
  phone?: string;
  email?: string;
  notes?: string;
  expectedAmount?: number;
  paymentAmount?: number;
  paymentMode?: string;
}
interface OldData {
  leads: OldRecord[];
  contacts: OldRecord[];
  customers: OldRecord[];
}

/** Old free-text service names → catalogue codes (unknown names are kept in the notes). */
const SERVICE_MAP: Record<string, string> = {
  'WhatsApp Business API': 'WHATSAPP_API_BLUE_TICK',
  'Meta Cloud API Onboarding': 'WHATSAPP_API_BLUE_TICK',
  'Webhooks & Endpoints': 'CROCODILE_CHANNEL_WEBHOOK',
  'Chatbot & Automation': 'AI_CRM',
  'RCS Messaging': 'RCS_REGISTRATION'
};

function read(): OldData {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      customers: Array.isArray(parsed.customers) ? parsed.customers : []
    };
  } catch {
    return { leads: [], contacts: [], customers: [] };
  }
}

export function pendingSupportRecords(): number {
  const d = read();
  return d.leads.length + d.contacts.length + d.customers.length;
}

export interface ImportOutcome {
  imported: number;
  skipped: { name: string; reason: string }[];
}

export async function importSupportRecords(): Promise<ImportOutcome> {
  const data = read();
  const outcome: ImportOutcome = { imported: 0, skipped: [] };
  const keep: OldData = { leads: [], contacts: [], customers: [] };

  for (const kind of ['leads', 'contacts', 'customers'] as const) {
    for (const r of data[kind]) {
      const name = r.name || r.businessName || 'Unnamed';
      const services = [...new Set((r.services || []).map(s => SERVICE_MAP[s]).filter(Boolean))];
      const unknown = (r.services || []).filter(s => !SERVICE_MAP[s]);
      if (!r.phone) {
        outcome.skipped.push({ name, reason: 'no phone number' });
        keep[kind].push(r);
        continue;
      }
      if (!services.length) {
        outcome.skipped.push({ name, reason: `no matching service for "${(r.services || []).join(', ') || 'none'}"` });
        keep[kind].push(r);
        continue;
      }
      const history =
        kind === 'contacts'
          ? `Was a contact with payment pending${r.expectedAmount ? ` (expected ₹${r.expectedAmount})` : ''}.`
          : kind === 'customers'
            ? `Was a paid customer${r.paymentAmount ? ` (₹${r.paymentAmount}${r.paymentMode ? ` via ${r.paymentMode}` : ''})` : ''}. Move to Potential and confirm the payment to restore onboarding.`
            : '';
      const notes = [r.notes, history, unknown.length ? `Other services mentioned: ${unknown.join(', ')}` : '', 'Imported from the old browser-only support dashboard.']
        .filter(Boolean)
        .join('\n');
      const body: LeadCreateInput = {
        name: r.name || r.businessName || 'Unnamed',
        company: r.businessName || r.name || 'Unnamed',
        phone: r.phone,
        email: r.email || null,
        leadSource: 'Other',
        leadStatus: kind === 'leads' ? 'NEW' : 'READY_TO_BUY',
        expectedBudget: r.expectedAmount ?? r.paymentAmount ?? null,
        notes,
        services
      } as LeadCreateInput;
      try {
        await pipelineApi.createLead(body);
        outcome.imported++;
      } catch (err) {
        outcome.skipped.push({ name, reason: errorMessage(err) });
        keep[kind].push(r);
      }
    }
  }
  try {
    if (keep.leads.length + keep.contacts.length + keep.customers.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    /* storage unavailable */
  }
  return outcome;
}
