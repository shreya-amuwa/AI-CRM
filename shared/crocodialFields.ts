/**
 * The Crocodial ↔ CRM field map (docs/CROCODIAL_INTEGRATION.md "Field mapping"). The single list of what Crocodial's Outbound API sends,
 * where the CRM keeps it, and how screens label it. The sync (server/crocodial/sync.ts), the database (crocodial_ext_* tables and the
 * croc_* helpers of 20270117000200) and every Sales screen follow it; tests check that they agree.
 *
 * Only these fields exist. Anything else on a Sales screen is a CRM record, never presented as coming from Crocodial.
 * Crocodial has no demo data and sends no webhooks: it is read by polling, and rows are stored once per (connection, Crocodial id).
 */

export type CrocodialFieldType = 'id' | 'text' | 'phone' | 'enum' | 'boolean' | 'integer' | 'timestamptz';
/** What a field is used for: who did it, which lead, its status, its time, or a plain value. */
export type CrocodialFieldRole = 'record-id' | 'employee' | 'lead' | 'status' | 'datetime' | 'value';

export interface CrocodialField {
  /** the field in Crocodial's JSON (a.b = the id inside an object) */
  source: string;
  /** the key the sync hands to the database (server/crocodial/sync.ts TO_STORE) */
  store: string;
  /** the column of the CRM table */
  column: string;
  type: CrocodialFieldType;
  role: CrocodialFieldRole;
}

/** Call logs → public.crocodial_ext_calls */
export const CROCODIAL_CALL_FIELDS: readonly CrocodialField[] = [
  { source: 'id', store: 'id', column: 'external_id', type: 'id', role: 'record-id' },
  // employee: the Crocodial user, turned into a CRM person ONLY through the approved mapping in effect at call_at (crocodial_employee_mappings)
  { source: 'called_by.id', store: 'calledBy', column: 'called_by_ext', type: 'id', role: 'employee' },
  // lead: the Crocodial lead (crocodial_ext_leads.external_id of the same connection); never matched to CRM leads by name
  { source: 'lead.id', store: 'lead', column: 'lead_ext', type: 'id', role: 'lead' },
  { source: 'phone_number', store: 'phone', column: 'phone_number', type: 'phone', role: 'value' },
  { source: 'contact_name', store: 'contactName', column: 'contact_name', type: 'text', role: 'value' },
  { source: 'call_type', store: 'callType', column: 'call_type', type: 'enum', role: 'status' },
  { source: 'call_at', store: 'callAt', column: 'call_at', type: 'timestamptz', role: 'datetime' },
  { source: 'duration_seconds', store: 'durationSeconds', column: 'duration_seconds', type: 'integer', role: 'value' },
  { source: 'connected', store: 'connected', column: 'connected', type: 'boolean', role: 'status' },
  { source: 'synced_at', store: 'syncedAt', column: 'external_synced_at', type: 'timestamptz', role: 'datetime' }
];

/** Leads → public.crocodial_ext_leads */
export const CROCODIAL_LEAD_FIELDS: readonly CrocodialField[] = [
  { source: 'id', store: 'id', column: 'external_id', type: 'id', role: 'record-id' },
  { source: 'name', store: 'name', column: 'name', type: 'text', role: 'value' },
  { source: 'phone_number', store: 'phone', column: 'phone_number', type: 'phone', role: 'value' },
  { source: 'company', store: 'company', column: 'company', type: 'text', role: 'value' },
  { source: 'city', store: 'city', column: 'city', type: 'text', role: 'value' },
  { source: 'status', store: 'status', column: 'status', type: 'text', role: 'status' },
  { source: 'source', store: 'source', column: 'source', type: 'text', role: 'value' },
  { source: 'assigned_to.id', store: 'assignedTo', column: 'assigned_to_ext', type: 'id', role: 'employee' },
  { source: 'created_by.id', store: 'createdBy', column: 'created_by_ext', type: 'id', role: 'employee' },
  { source: 'called', store: 'called', column: 'called', type: 'boolean', role: 'status' },
  { source: 'dialer_outcome', store: 'dialerOutcome', column: 'dialer_outcome', type: 'text', role: 'status' },
  { source: 'remark_count', store: 'remarkCount', column: 'remark_count', type: 'integer', role: 'value' },
  { source: 'next_followup_at', store: 'nextFollowupAt', column: 'next_followup_at', type: 'timestamptz', role: 'datetime' },
  { source: 'last_interaction_at', store: 'lastInteractionAt', column: 'last_interaction_at', type: 'timestamptz', role: 'datetime' },
  { source: 'created_at', store: 'createdAt', column: 'external_created_at', type: 'timestamptz', role: 'datetime' },
  { source: 'updated_at', store: 'updatedAt', column: 'external_updated_at', type: 'timestamptz', role: 'datetime' }
];

/** Follow-ups → public.crocodial_ext_followups */
export const CROCODIAL_FOLLOWUP_FIELDS: readonly CrocodialField[] = [
  { source: 'id', store: 'id', column: 'external_id', type: 'id', role: 'record-id' },
  { source: 'created_by.id', store: 'createdBy', column: 'created_by_ext', type: 'id', role: 'employee' },
  { source: 'lead.id', store: 'lead', column: 'lead_ext', type: 'id', role: 'lead' },
  { source: 'phone_number', store: 'phone', column: 'phone_number', type: 'phone', role: 'value' },
  { source: 'note', store: 'note', column: 'note', type: 'text', role: 'value' },
  { source: 'scheduled_at', store: 'scheduledAt', column: 'scheduled_at', type: 'timestamptz', role: 'datetime' },
  { source: 'done', store: 'done', column: 'done', type: 'boolean', role: 'status' },
  { source: 'completed_at', store: 'completedAt', column: 'completed_at', type: 'timestamptz', role: 'datetime' },
  { source: 'created_at', store: 'createdAt', column: 'external_created_at', type: 'timestamptz', role: 'datetime' },
  { source: 'updated_at', store: 'updatedAt', column: 'external_updated_at', type: 'timestamptz', role: 'datetime' }
];

/** Remarks → public.crocodial_ext_remarks */
export const CROCODIAL_REMARK_FIELDS: readonly CrocodialField[] = [
  { source: 'id', store: 'id', column: 'external_id', type: 'id', role: 'record-id' },
  { source: 'written_by.id', store: 'writtenBy', column: 'written_by_ext', type: 'id', role: 'employee' },
  { source: 'lead.id', store: 'lead', column: 'lead_ext', type: 'id', role: 'lead' },
  { source: 'phone_number', store: 'phone', column: 'phone_number', type: 'phone', role: 'value' },
  { source: 'remark', store: 'remark', column: 'remark', type: 'text', role: 'value' },
  { source: 'created_at', store: 'createdAt', column: 'external_created_at', type: 'timestamptz', role: 'datetime' },
  { source: 'updated_at', store: 'updatedAt', column: 'external_updated_at', type: 'timestamptz', role: 'datetime' }
];

export const CROCODIAL_FIELDS = {
  'call-logs': { table: 'crocodial_ext_calls', fields: CROCODIAL_CALL_FIELDS },
  leads: { table: 'crocodial_ext_leads', fields: CROCODIAL_LEAD_FIELDS },
  followups: { table: 'crocodial_ext_followups', fields: CROCODIAL_FOLLOWUP_FIELDS },
  remarks: { table: 'crocodial_ext_remarks', fields: CROCODIAL_REMARK_FIELDS }
} as const;

// ---- status mapping -----------------------------------------------------------------------------------------------------------------
/** call_type values Crocodial sends (the database check of crocodial_ext_calls allows exactly these). */
export const CROCODIAL_CALL_TYPES = ['incoming', 'outgoing', 'missed', 'voicemail', 'rejected', 'blocked', 'answered_elsewhere', 'unknown'] as const;
export type CrocodialCallType = (typeof CROCODIAL_CALL_TYPES)[number];
export const CALL_TYPE_LABEL: Record<CrocodialCallType, string> = {
  incoming: 'Incoming', outgoing: 'Outgoing', missed: 'Missed', voicemail: 'Voicemail', rejected: 'Rejected', blocked: 'Blocked',
  answered_elsewhere: 'Answered elsewhere', unknown: 'Unknown'
};
export const callTypeLabel = (t: string | null | undefined) => (t && t in CALL_TYPE_LABEL ? CALL_TYPE_LABEL[t as CrocodialCallType] : 'Unknown');

/** connected: true / false as Crocodial sent it; empty is "not reported", never "not connected". */
export function connectedLabel(connected: boolean | null | undefined): 'Connected' | 'Not connected' | 'Not reported' {
  return connected === true ? 'Connected' : connected === false ? 'Not connected' : 'Not reported';
}

/** A call's duration as shown ("—" when Crocodial sent none or the call did not connect). */
export function callDuration(seconds: number | null | undefined, connected?: boolean | null): string {
  if (connected === false || seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

// ---- the call figures every Sales screen shows ---------------------------------------------------------------------------------------
/** The figures counted from the call log (private.croc_call_summary). The same keys, labels and order everywhere. */
export const CROCODIAL_CALL_FIGURES = [
  { key: 'made', label: 'Total calls', hint: 'Outgoing calls (call_type outgoing)' },
  { key: 'connected', label: 'Connected', hint: 'Outgoing, connected = yes' },
  { key: 'notConnected', label: 'Not connected', hint: 'Outgoing, connected = no' },
  { key: 'uniqueNumbers', label: 'Unique numbers', hint: 'Different phone numbers called' },
  { key: 'talkSeconds', label: 'Talk time', hint: 'Duration of the connected calls' }
] as const;
export type CrocodialCallFigure = (typeof CROCODIAL_CALL_FIGURES)[number]['key'];
