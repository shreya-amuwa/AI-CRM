import React from 'react';
import type { RechargeKind, RechargeStatus } from '../../../shared/contracts';
import { Pill, type Tone } from '../team-member/pipeline/shared';

export const KIND_LABEL: Record<RechargeKind, string> = { PANEL: 'Panel Recharge', MESSAGE: 'Message Recharge' };
export const STATUS_LABEL: Record<RechargeStatus, string> = { PENDING: 'Pending', VERIFIED: 'Verified', COMPLETED: 'Completed', REJECTED: 'Rejected' };
export const STATUS_TONE: Record<RechargeStatus, Tone> = { PENDING: 'orange', VERIFIED: 'indigo', COMPLETED: 'green', REJECTED: 'red' };
export const STATUSES: RechargeStatus[] = ['PENDING', 'VERIFIED', 'COMPLETED', 'REJECTED'];

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Whole rupees without paise (₹1,000), anything with paise always with two decimals (₹618.50). */
export const rechargeMoney = (n: number | null | undefined) => { const v = Number(n ?? 0); return Math.round(v * 100) % 100 === 0 ? inr0.format(v) : inr2.format(v); };
export const rechargeDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export const rechargeDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** today in India as YYYY-MM-DD (the business day) */
export const todayIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export const RechargeStatusPill: React.FC<{ status: RechargeStatus }> = ({ status }) => <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;

/** Money typed in a box: digits and one dot, at most 2 decimals; anything else is dropped as it is typed. */
export const cleanAmount = (v: string) => {
  const s = v.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = s.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};
export const amountNumber = (v: string) => (v === '' || v === '.' ? 0 : Number(v));
export const sumAmounts = (a: string, b: string) => Math.round(amountNumber(a) * 100 + amountNumber(b) * 100) / 100;
