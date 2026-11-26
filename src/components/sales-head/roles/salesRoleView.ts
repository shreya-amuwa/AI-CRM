/**
 * Sales Department Head role-wise sections (migration 20270117000300): what each role's list shows, the CSV export and the weekly / monthly
 * roll-up of the daily figures. Pure functions, so the rules are tested without a browser. Every number comes from the database.
 */
import type { SalesRole, SalesRoleList, SalesRoleMetrics } from '../../../../shared/contracts';
import { CROCODIAL_CALL_FIGURES, type CrocodialCallFigure } from '../../../../shared/crocodialFields';

export type MetricKey = Exclude<keyof SalesRoleMetrics, 'crocodial'>;
export type MetricFormat = 'count' | 'percent' | 'money' | 'duration';
/** where a figure comes from: Crocodial's call log, or a CRM record (shown so nothing CRM-made looks like it came from Crocodial) */
export type MetricSource = 'CROCODIAL' | 'CRM';
export interface MetricColumn { key: MetricKey; label: string; format: MetricFormat; source: MetricSource; sortable?: boolean }

export interface RoleConfig {
  role: SalesRole;
  title: string;
  /** what one person is called in sentences */
  noun: string;
  subtitle: string;
  columns: MetricColumn[];
  /** the cards at the top of a person's dashboard */
  cards: MetricColumn[];
  /** the daily series and what each is called */
  series: { key: string; label: string; source: MetricSource }[];
}

// the call figures: the same keys, labels and order as every other Crocodial screen (shared/crocodialFields.ts)
const FIGURE_KEY: Record<CrocodialCallFigure, MetricKey> = { made: 'calls', connected: 'connected', notConnected: 'notConnected', uniqueNumbers: 'uniqueNumbers', talkSeconds: 'talkSeconds' };
const CALL_COLUMNS: MetricColumn[] = CROCODIAL_CALL_FIGURES.map(f => ({
  key: FIGURE_KEY[f.key], label: f.label, format: f.key === 'talkSeconds' ? 'duration' : 'count', source: 'CROCODIAL', sortable: true
}));

export const ROLE_CONFIG: Record<SalesRole, RoleConfig> = {
  TELECALLER: {
    role: 'TELECALLER',
    title: 'Telecaller List',
    noun: 'Telecaller',
    subtitle: 'Every Telecaller of your Sales teams: their calls from Crocodial, and the leads they created and converted in the CRM.',
    columns: [
      ...CALL_COLUMNS,
      { key: 'leadsCreated', label: 'Leads created', format: 'count', source: 'CRM', sortable: true },
      { key: 'convertedLeads', label: 'Converted', format: 'count', source: 'CRM', sortable: true }
    ],
    cards: [
      ...CALL_COLUMNS,
      { key: 'connectRate', label: 'Connect rate', format: 'percent', source: 'CROCODIAL' },
      { key: 'leadsCreated', label: 'Leads created', format: 'count', source: 'CRM' },
      { key: 'convertedLeads', label: 'Converted to a Business Associate', format: 'count', source: 'CRM' }
    ],
    series: [
      { key: 'calls', label: 'Total calls', source: 'CROCODIAL' },
      { key: 'connected', label: 'Connected', source: 'CROCODIAL' },
      { key: 'leads', label: 'Leads created', source: 'CRM' },
      { key: 'converted', label: 'Converted', source: 'CRM' }
    ]
  },
  BUSINESS_ASSOCIATE: {
    role: 'BUSINESS_ASSOCIATE',
    title: 'Business Associate List',
    noun: 'Business Associate',
    subtitle: 'Every Business Associate of your Sales teams: their calls from Crocodial, and their leads, demos, quotations and deals in the CRM.',
    columns: [
      { key: 'calls', label: 'Total calls', format: 'count', source: 'CROCODIAL', sortable: true },
      { key: 'connected', label: 'Connected', format: 'count', source: 'CROCODIAL', sortable: true },
      { key: 'leadsAssigned', label: 'Leads assigned', format: 'count', source: 'CRM', sortable: true },
      { key: 'demosScheduled', label: 'Demos scheduled', format: 'count', source: 'CRM', sortable: true },
      { key: 'demosCompleted', label: 'Demos completed', format: 'count', source: 'CRM', sortable: true },
      { key: 'quotations', label: 'Quotations', format: 'count', source: 'CRM', sortable: true },
      { key: 'dealsClosed', label: 'Deals closed', format: 'count', source: 'CRM', sortable: true },
      { key: 'dealValue', label: 'Deal value', format: 'money', source: 'CRM', sortable: true }
    ],
    cards: [
      ...CALL_COLUMNS,
      { key: 'leadsAssigned', label: 'Leads assigned', format: 'count', source: 'CRM' },
      { key: 'demosScheduled', label: 'Demos scheduled', format: 'count', source: 'CRM' },
      { key: 'demosCompleted', label: 'Demos completed', format: 'count', source: 'CRM' },
      { key: 'demosUpcoming', label: 'Upcoming demos', format: 'count', source: 'CRM' },
      { key: 'demosCancelled', label: 'Cancelled demos', format: 'count', source: 'CRM' },
      { key: 'quotations', label: 'Final quotations', format: 'count', source: 'CRM' },
      { key: 'dealsClosed', label: 'Deals closed', format: 'count', source: 'CRM' },
      { key: 'dealValue', label: 'Deal value', format: 'money', source: 'CRM' }
    ],
    series: [
      { key: 'assigned', label: 'Leads assigned', source: 'CRM' },
      { key: 'demos', label: 'Demos scheduled', source: 'CRM' },
      { key: 'demosCompleted', label: 'Demos completed', source: 'CRM' },
      { key: 'deals', label: 'Deals closed', source: 'CRM' }
    ]
  }
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
/** A figure as shown: a missing figure (not connected to Crocodial, nothing to divide) is "–", never 0. */
export function formatMetric(value: number | null | undefined, format: MetricFormat): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '–';
  const n = Number(value);
  if (format === 'percent') return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
  if (format === 'money') return inr.format(n);
  if (format === 'duration') return n >= 3600 ? `${Math.floor(n / 3600)} h ${Math.round((n % 3600) / 60)} min` : `${Math.round(n / 60)} min`;
  return n.toLocaleString('en-IN');
}

/** What the Crocodial columns show for a person who has no call figures. */
export const CROCODIAL_STATE_TEXT: Record<'OFF' | 'NOT_SYNCED', string> = {
  OFF: 'Not connected to Crocodial',
  NOT_SYNCED: 'Crocodial not synced yet'
};

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', SUSPENDED: 'Suspended', REVOKED: 'Access removed' };
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

/** The rows of the CSV export: the same columns as the list, plain numbers (no currency signs) so a spreadsheet can add them up. */
export function exportRows(list: SalesRoleList): string[][] {
  const cfg = ROLE_CONFIG[list.role];
  const unit = (c: MetricColumn) => (c.format === 'money' ? ' (INR)' : c.format === 'percent' ? ' (%)' : c.format === 'duration' ? ' (seconds)' : '');
  const head = ['Name', 'Employee ID', 'Team', 'Team Lead', 'Status', 'E-mail', 'Phone', 'Crocodial',
    ...cfg.columns.map(c => `${c.label}${unit(c)}${c.source === 'CROCODIAL' ? ' [Crocodial]' : ''}`)];
  const rows = list.items.map(p => [
    p.name, p.employeeCode, p.teamName ?? '', p.teamLeadName ?? '', statusLabel(p.status), p.email ?? '', p.phone ?? '',
    p.metrics.crocodial === 'ON' ? 'Connected' : CROCODIAL_STATE_TEXT[p.metrics.crocodial],
    ...cfg.columns.map(c => {
      const v = p.metrics[c.key];
      return v === null || v === undefined ? '' : String(v);
    })
  ]);
  return [head, ...rows];
}

export const exportFileName = (list: SalesRoleList) => `${ROLE_CONFIG[list.role].noun} list ${list.from} to ${list.to}.csv`;

export type Grain = 'DAY' | 'WEEK' | 'MONTH';
/** Monday of the ISO week of a YYYY-MM-DD day (calendar arithmetic in UTC so no time zone moves the day). */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The daily rows added up by week (starting Monday) or by month. A figure that is missing on every day of a bucket (not connected to
 *  Crocodial) stays null, so it is shown as "–", never as 0. */
export function rollUp(daily: ({ day: string } & Record<string, number | string | null>)[], keys: string[], grain: Grain): { label: string; start: string; values: Record<string, number | null> }[] {
  const out = new Map<string, { label: string; start: string; values: Record<string, number | null> }>();
  for (const row of daily) {
    const day = String(row.day).slice(0, 10);
    const bucket = grain === 'DAY' ? day : grain === 'WEEK' ? weekStart(day) : `${day.slice(0, 7)}-01`;
    let b = out.get(bucket);
    if (!b) {
      b = { label: bucketLabel(bucket, grain), start: day, values: Object.fromEntries(keys.map(k => [k, null])) };
      out.set(bucket, b);
    }
    for (const k of keys) {
      const v = row[k];
      if (v === null || v === undefined || v === '') continue;
      b.values[k] = (b.values[k] ?? 0) + (Number(v) || 0);
    }
  }
  return [...out.values()];
}

function bucketLabel(start: string, grain: Grain): string {
  const d = new Date(`${start}T00:00:00Z`);
  if (grain === 'MONTH') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const text = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return grain === 'WEEK' ? `Week of ${text}` : text;
}
