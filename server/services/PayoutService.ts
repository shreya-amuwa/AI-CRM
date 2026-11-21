import { uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { PayoutRepository } from '../repositories/PayoutRepository.js';

// pdf-lib is loaded only when a slip is actually drawn
const slipPdf = () => import('../payouts/slip.js');

/** Incentive payouts: the payout slip (the person paid and Accounts; the database checks and audits each download). */
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async slip(id: string): Promise<{ fileName: string; contentBase64: string }> {
    const data = await this.repo.slipData(parse(uuidSchema, id));
    const bytes = await (await slipPdf()).renderPayoutSlip(data);
    return { fileName: `Payout-${data.slipNo}.pdf`, contentBase64: Buffer.from(bytes).toString('base64') };
  }
}
