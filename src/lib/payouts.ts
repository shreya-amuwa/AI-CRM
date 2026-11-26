import { getSupabase } from '../services/supabaseClient';
import { api } from './api/client';

/**
 * Incentive payouts (migration 20270123000100): payout details, withdrawal requests, and the Accounts queue. The database decides who may
 * see and do what (full payout details only for the person and Accounts; nobody pays their own withdrawal).
 */
export type PayoutKind = 'BANK' | 'UPI' | 'OTHER';
export type PayoutStatus = 'REQUESTED' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'CANCELLED' | 'FAILED' | 'REVERSED';
export interface PayoutMethod {
  kind: PayoutKind; holderName: string; accountNumber?: string | null; ifsc?: string | null; upiId?: string | null; otherDetails?: string | null;
  pan?: string | null; updatedAt?: string;
}
export interface PayoutMethodInput { kind: PayoutKind; holderName: string; accountNumber?: string; ifsc?: string; upiId?: string; otherDetails?: string; pan?: string }
export interface PayoutRequest {
  id: string; profileId: string; name: string; department: string | null; amount: number; status: PayoutStatus; requestedAt: string;
  decidedAt: string | null; decidedBy: string | null; channel: 'MANUAL' | 'RAZORPAY' | null; reference: string | null; paidOn: string | null;
  tdsAmount: number; netAmount: number | null; reason: string | null; finalSettlement: boolean; method: PayoutMethod | null;
  available?: number;
}
export interface PayoutDetail extends PayoutRequest {
  available: number; withdrawn: number; personActive: boolean;
  recentEarnings: { earnedAt: string; eventType: string; role: string; amount: number; status: string; ruleName: string }[];
}
export interface Leaver { profileId: string; name: string; department: string | null; status: string; available: number; method: PayoutMethod | null }

export const STATUS_LABEL: Record<PayoutStatus, string> = {
  REQUESTED: 'Waiting for Accounts', PROCESSING: 'Being sent', PAID: 'Paid', REJECTED: 'Rejected', CANCELLED: 'Cancelled', FAILED: 'Failed', REVERSED: 'Reversed'
};
export const STATUS_TONE: Record<PayoutStatus, string> = {
  REQUESTED: 'bg-amber-50 text-amber-800', PROCESSING: 'bg-sky-50 text-sky-800', PAID: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-rose-50 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-600', FAILED: 'bg-rose-50 text-rose-700', REVERSED: 'bg-rose-50 text-rose-700'
};
export const MIN_WITHDRAWAL = 500;

/** The method in one line: "HDFC0001234 · ••••9012", "UPI meera@okhdfcbank", "International transfer". */
export function methodLine(m: PayoutMethod | null | undefined): string {
  if (!m) return 'No payout details';
  if (m.kind === 'BANK') return `Bank account ${m.accountNumber ?? ''}${m.ifsc ? ` · IFSC ${m.ifsc}` : ''}`;
  if (m.kind === 'UPI') return `UPI ${m.upiId ?? ''}`;
  return 'International transfer';
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const db = getSupabase();
  if (!db) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^[A-Z_]+:\s*/, ''));
  return data as T;
}
export const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const payoutsApi = {
  method: () => rpc<PayoutMethod | null>('payout_method_get'),
  saveMethod: (p: PayoutMethodInput) => rpc<PayoutMethod>('payout_method_save', { p }),
  request: (amount: number, requestId: string) => rpc<PayoutRequest>('payout_request', { p_amount: amount, p_request_id: requestId }),
  cancel: (id: string) => rpc<PayoutRequest>('payout_cancel', { p_id: id }),
  mine: () => rpc<PayoutRequest[]>('payout_my_requests'),
  queue: (status: PayoutStatus) => rpc<PayoutRequest[]>('payout_queue', { p_status: status }),
  counts: () => rpc<{ requested: number; processing: number }>('payout_counts'),
  detail: (id: string) => rpc<PayoutDetail>('payout_detail', { p_id: id }),
  markPaid: (id: string, reference: string, paidOn: string, tds: number) =>
    rpc<PayoutRequest>('payout_mark_paid', { p_id: id, p_reference: reference, p_paid_on: paidOn, p_tds: tds }),
  reject: (id: string, reason: string) => rpc<PayoutRequest>('payout_reject', { p_id: id, p_reason: reason }),
  leavers: () => rpc<Leaver[]>('payout_leavers'),
  /** amount = what Accounts saw and sent; the database refuses it if the balance changed meanwhile. */
  settle: (profileId: string, amount: number, reference: string, paidOn: string, tds: number) =>
    rpc<PayoutRequest>('payout_final_settlement', { p_profile: profileId, p_amount: amount, p_reference: reference, p_paid_on: paidOn, p_tds: tds }),
  /** RazorpayX (20270125000100): is it set up; send a withdrawal through it (net = amount - TDS); ask about one being sent. */
  razorpayStatus: () => api.get<{ configured: boolean }>('/payouts/razorpay/status'),
  payViaRazorpay: (id: string, tds: number) => api.post<{ id: string; status: PayoutStatus; razorpayStatus: string }>(`/payouts/${id}/razorpay`, { tds }),
  checkRazorpay: (id: string) => api.post<{ id: string; status: PayoutStatus; razorpayStatus: string }>(`/payouts/${id}/razorpay/check`, {}),
  /** The payout slip PDF, saved by the browser (the API draws it; the database checks who may have it and logs the download). */
  async downloadSlip(id: string): Promise<void> {
    const r = await api.get<{ fileName: string; contentBase64: string }>(`/payouts/${id}/slip`);
    const bytes = Uint8Array.from(atob(r.contentBase64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = r.fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
};

/** Today's office date (Asia/Kolkata) as YYYY-MM-DD. */
export const officeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
