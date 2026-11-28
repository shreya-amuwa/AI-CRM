import React from 'react';
import type { RechargeBillingType, RechargeInvoiceStatus, RechargeKind, RechargePaymentStatus } from '../../../shared/contracts';
import { Pill, type Tone } from '../team-member/pipeline/shared';

export const KIND_LABEL: Record<RechargeKind, string> = { PANEL: 'Panel Recharge', MESSAGE: 'Message Recharge' };
export const BILLING_LABEL: Record<RechargeBillingType, string> = { GST: 'GST', NON_GST: 'Non-GST' };
export const PAYMENT_LABEL: Record<RechargePaymentStatus, string> = {
  PENDING_VERIFICATION: 'Pending verification', PAYMENT_RECEIVED: 'Payment received', PAYMENT_NOT_RECEIVED: 'Payment not received', REJECTED: 'Rejected'
};
export const PAYMENT_TONE: Record<RechargePaymentStatus, Tone> = { PENDING_VERIFICATION: 'orange', PAYMENT_RECEIVED: 'green', PAYMENT_NOT_RECEIVED: 'red', REJECTED: 'slate' };
export const PAYMENT_STATUSES: RechargePaymentStatus[] = ['PENDING_VERIFICATION', 'PAYMENT_RECEIVED', 'PAYMENT_NOT_RECEIVED', 'REJECTED'];
export const INVOICE_LABEL: Record<RechargeInvoiceStatus, string> = {
  NOT_GENERATED: 'Not generated', GENERATED: 'Generated', SENT: 'Sent', EMAIL_SENT: 'Email sent', WHATSAPP_SENT: 'WhatsApp sent', PARTIALLY_SENT: 'Partially sent', FAILED: 'Failed'
};
export const INVOICE_TONE: Record<RechargeInvoiceStatus, Tone> = { NOT_GENERATED: 'slate', GENERATED: 'indigo', SENT: 'green', EMAIL_SENT: 'green', WHATSAPP_SENT: 'green', PARTIALLY_SENT: 'orange', FAILED: 'red' };
/** words for the timeline */
export const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Submitted to Accounts', EDITED: 'Edited', RESUBMITTED: 'Corrected and submitted again', BILLING_CORRECTED: 'Billing details corrected by Accounts', PAYMENT_RECEIVED: 'Payment received',
  PAYMENT_NOT_RECEIVED: 'Payment not received', REJECTED: 'Rejected', INVOICE_GENERATED: 'Invoice generated', INVOICE_SENT_EMAIL: 'Invoice e-mailed', INVOICE_SENT_WHATSAPP: 'Invoice sent on WhatsApp',
  INVOICE_RESENT: 'Invoice sent again', INVOICE_SEND_FAILED: 'Invoice sending failed'
};

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Whole rupees without paise (₹1,000), anything with paise always with two decimals (₹618.50). */
export const rechargeMoney = (n: number | null | undefined) => { const v = Number(n ?? 0); return Math.round(v * 100) % 100 === 0 ? inr0.format(v) : inr2.format(v); };
export const rechargeDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export const rechargeDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** today in India as YYYY-MM-DD (the business day) */
export const todayIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export const PaymentPill: React.FC<{ status: RechargePaymentStatus }> = ({ status }) => <Pill tone={PAYMENT_TONE[status]}>{PAYMENT_LABEL[status]}</Pill>;
export const InvoicePill: React.FC<{ status: RechargeInvoiceStatus }> = ({ status }) => <Pill tone={INVOICE_TONE[status]}>{INVOICE_LABEL[status]}</Pill>;

/** Money typed in a box: digits and one dot, at most 2 decimals; anything else is dropped as it is typed. */
export const cleanAmount = (v: string) => {
  const s = v.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = s.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};
export const amountNumber = (v: string) => (v === '' || v === '.' ? 0 : Number(v));
export const sumAmounts = (a: string, b: string) => Math.round(amountNumber(a) * 100 + amountNumber(b) * 100) / 100;
