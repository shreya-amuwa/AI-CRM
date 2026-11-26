import type { SupabaseClient } from '@supabase/supabase-js';
import type { PayoutSlipData } from '../payouts/slip.js';
import { unwrap } from './base.js';

/** Incentive payouts (migration 20270123000100). Every call is a database function that decides who may see or do what. */
export class PayoutRepository {
  constructor(private readonly db: SupabaseClient) {}

  /** Is the caller allowed to handle this withdrawal (Accounts)? payout_detail answers only for Accounts staff. */
  detail(id: string) {
    return this.db.rpc('payout_detail', { p_id: id }).then(r => unwrap(r) as { id: string; status: string; profileId: string });
  }

  slipData(id: string) {
    return this.db.rpc('payout_slip_data', { p_id: id }).then(r => unwrap(r) as PayoutSlipData);
  }
}
