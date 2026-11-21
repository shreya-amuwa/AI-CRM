import type { SupabaseClient } from '@supabase/supabase-js';
import type { PayoutSlipData } from '../payouts/slip.js';
import { unwrap } from './base.js';

/** Incentive payouts (migration 20270123000100). Every call is a database function that decides who may see or do what. */
export class PayoutRepository {
  constructor(private readonly db: SupabaseClient) {}

  slipData(id: string) {
    return this.db.rpc('payout_slip_data', { p_id: id }).then(r => unwrap(r) as PayoutSlipData);
  }
}
