import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';

export interface TrainingRunSummary {
  day?: string;
  statusesChanged?: number;
  consolidatedReports?: number;
  reminders?: number;
  skipped?: string;
  note?: string;
}

/**
 * The daily training check (called by the daily dispatch; safe to call as often as you like). The database does the work: programs that are
 * over and not completed become Incomplete, the consolidated report of every finished training is made once, and the responsible HR
 * employee gets one reminder per program and day for the day reports that are still missing. No message leaves the CRM.
 */
export async function runTrainingAutomation(db?: SupabaseClient): Promise<TrainingRunSummary> {
  if (!db && !hasServiceClient()) return { note: 'The server has no service key.' };
  const { data, error } = await (db ?? getServiceClient()).rpc('hr_training_tick', { p_today: null });
  if (error) throw new Error(`hr_training_tick: ${error.message}`);
  return data as TrainingRunSummary;
}
