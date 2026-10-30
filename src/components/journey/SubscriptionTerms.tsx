import React from 'react';
import { SUBSCRIPTION_DURATIONS, SUBSCRIPTION_DURATION_LABEL, type SubscriptionDurationCode, type SubscriptionInfo } from '../../../shared/contracts';
import { subscriptionTermsSchema } from '../../../shared/validation';
import { Field, inputCls } from '../team-member/pipeline/shared';

/**
 * What Sales enters for each service: the plan, the duration, the amount and the message credits. There is deliberately no date here: the
 * subscription starts on the date the team confirms the panel activation, and the expiry is calculated from the duration by the server.
 */
export interface TermsDraft {
  plan: string;
  durationCode: SubscriptionDurationCode | '';
  customMonths: string;
  customDays: string;
  amount: string;
  messageCredits: string;
  panel: string;
}
export const emptyTerms = (): TermsDraft => ({ plan: '', durationCode: '', customMonths: '', customDays: '', amount: '', messageCredits: '', panel: '' });
export const termsFrom = (s: SubscriptionInfo): TermsDraft => ({
  plan: s.plan ?? '',
  durationCode: s.durationCode ?? '',
  customMonths: s.durationCode === 'CUSTOM' && s.durationMonths ? String(s.durationMonths) : '',
  customDays: s.durationCode === 'CUSTOM' && s.durationDays ? String(s.durationDays) : '',
  amount: s.amount !== null && s.amount !== undefined ? String(s.amount) : '',
  messageCredits: s.messageCredits !== null && s.messageCredits !== undefined ? String(s.messageCredits) : '',
  panel: s.panel ?? ''
});

export type TermsErrors = Partial<Record<keyof TermsDraft, string>>;

/** The request body (or the field errors) for one service's terms. The server checks everything again. */
export function checkTerms(d: TermsDraft): { ok: true; body: Record<string, unknown> } | { ok: false; errors: TermsErrors } {
  const parsed = subscriptionTermsSchema.safeParse({
    plan: d.plan, durationCode: d.durationCode || undefined, customMonths: d.customMonths, customDays: d.customDays,
    amount: d.amount, messageCredits: d.messageCredits, panel: d.panel
  });
  if (parsed.success) {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined && v !== null) body[k] = v;
    return { ok: true, body };
  }
  const errors: TermsErrors = {};
  for (const i of parsed.error.issues) {
    const key = String(i.path[0] ?? '') as keyof TermsDraft;
    if (key && !errors[key]) errors[key] = i.message;
  }
  return { ok: false, errors };
}

export const TermsFields: React.FC<{
  idPrefix: string;
  value: TermsDraft;
  onChange: (v: TermsDraft) => void;
  errors?: TermsErrors;
  disabled?: boolean;
}> = ({ idPrefix, value, onChange, errors = {}, disabled }) => {
  const set = (patch: Partial<TermsDraft>) => onChange({ ...value, ...patch });
  const custom = value.durationCode === 'CUSTOM';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Field label="Subscription plan" required htmlFor={`${idPrefix}-plan`} error={errors.plan}>
        <input id={`${idPrefix}-plan`} className={inputCls} value={value.plan} maxLength={120} disabled={disabled} onChange={e => set({ plan: e.target.value })} placeholder="e.g. Growth" />
      </Field>
      <Field label="Subscription duration" required htmlFor={`${idPrefix}-duration`} error={errors.durationCode}>
        <select id={`${idPrefix}-duration`} className={inputCls} value={value.durationCode} disabled={disabled}
          onChange={e => set({ durationCode: e.target.value as SubscriptionDurationCode | '', ...(e.target.value === 'CUSTOM' ? {} : { customMonths: '', customDays: '' }) })}>
          <option value="">Choose…</option>
          {SUBSCRIPTION_DURATIONS.map(c => <option key={c} value={c}>{SUBSCRIPTION_DURATION_LABEL[c]}</option>)}
        </select>
      </Field>
      {custom && (
        <Field label="Custom duration (months or days)" required htmlFor={`${idPrefix}-cm`} error={errors.customMonths}>
          <div className="flex items-center gap-2">
            <input id={`${idPrefix}-cm`} className={inputCls} inputMode="numeric" value={value.customMonths} disabled={disabled || value.customDays !== ''} placeholder="Months"
              onChange={e => set({ customMonths: e.target.value.replace(/\D/g, '') })} aria-label="Custom months" />
            <span className="text-xs text-slate-500">or</span>
            <input className={inputCls} inputMode="numeric" value={value.customDays} disabled={disabled || value.customMonths !== ''} placeholder="Days"
              onChange={e => set({ customDays: e.target.value.replace(/\D/g, '') })} aria-label="Custom days" />
          </div>
        </Field>
      )}
      <Field label="Subscription amount (₹)" required htmlFor={`${idPrefix}-amount`} error={errors.amount}>
        <input id={`${idPrefix}-amount`} className={inputCls} inputMode="decimal" value={value.amount} disabled={disabled} onChange={e => set({ amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 12000" />
      </Field>
      <Field label="Message credits / limit" htmlFor={`${idPrefix}-credits`} error={errors.messageCredits}>
        <input id={`${idPrefix}-credits`} className={inputCls} inputMode="numeric" value={value.messageCredits} disabled={disabled} onChange={e => set({ messageCredits: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 50000" />
      </Field>
      <Field label="Panel" htmlFor={`${idPrefix}-panel`} error={errors.panel}>
        <input id={`${idPrefix}-panel`} className={inputCls} value={value.panel} maxLength={120} disabled={disabled} onChange={e => set({ panel: e.target.value })} placeholder="e.g. Wabastore panel" />
      </Field>
    </div>
  );
};
