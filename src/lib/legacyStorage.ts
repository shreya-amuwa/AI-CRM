/**
 * One-time migration of data the previous version kept in localStorage.
 *
 * - Keys holding credentials or authorization state are purged on startup:
 *   they contained plain-text passwords and client-trusted roles, and cannot
 *   be migrated safely (users are provisioned/approved in Supabase instead).
 * - Customers are offered for import into Supabase. Local rows are removed
 *   only after the server confirms they were stored.
 */
import type { CustomerCreateInput } from '../../shared/validation';

const INSECURE_KEYS = [
  'unified_crm_user', // role/identity trusted from the browser
  'amuwa_user_registrations_v2', // plain-text passwords + statuses
  'amuwa_supabase_url', // user-overridable backend endpoint
  'amuwa_supabase_anon_key'
];

export const LEGACY_CUSTOMERS_KEY = 'amuwa_crm_team_member_customers_v3';

export function purgeInsecureLegacyKeys(): void {
  try {
    INSECURE_KEYS.forEach(k => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

interface LegacyCustomer {
  id?: string;
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  segment?: string;
  status?: string;
  lastOrderDate?: string;
  lastOrderAmount?: number;
  totalSpent?: number;
  orderCount?: number;
}

const SEGMENTS: Record<string, CustomerCreateInput['segment']> = {
  Retail: 'RETAIL',
  Wholesale: 'WHOLESALE',
  Corporate: 'CORPORATE',
  Others: 'OTHER'
};

function toIsoDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function readLegacyCustomers(): LegacyCustomer[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_CUSTOMERS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function countLegacyCustomers(): number {
  return readLegacyCustomers().length;
}

export function legacyCustomersAsImport(): CustomerCreateInput[] {
  return readLegacyCustomers()
    .filter(c => c && c.name)
    .map(c => ({
      name: String(c.name).slice(0, 200),
      company: c.company || null,
      email: c.email ? String(c.email).toLowerCase() : null,
      phone: c.phone || null,
      segment: SEGMENTS[c.segment || ''] || 'OTHER',
      status: c.status === 'Inactive' ? 'INACTIVE' : 'ACTIVE',
      lastOrderDate: toIsoDate(c.lastOrderDate),
      lastOrderAmount: typeof c.lastOrderAmount === 'number' ? c.lastOrderAmount : null,
      totalSpent: typeof c.totalSpent === 'number' ? c.totalSpent : undefined,
      orderCount: typeof c.orderCount === 'number' ? c.orderCount : undefined
    }));
}

/** Keep only the rows the server did not accept (by index in the import payload). */
export function retainLegacyCustomers(keepIndexes: number[]): void {
  const rows = readLegacyCustomers().filter(c => c && c.name);
  const remaining = keepIndexes.map(i => rows[i]).filter(Boolean);
  try {
    if (remaining.length) localStorage.setItem(LEGACY_CUSTOMERS_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(LEGACY_CUSTOMERS_KEY);
  } catch {
    /* ignore */
  }
}
