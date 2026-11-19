import React from 'react';
import { Globe } from 'lucide-react';
import type { AiWebsiteOnboarding } from '../../../../shared/contracts';
import { AI_WEBSITE_BUSINESS_TYPES, aiWebsiteOnboardingSchema, type AiWebsiteOnboardingBody } from '../../../../shared/validation';
import { Card, Field, inputCls } from './shared';

/**
 * AI Website client onboarding (migration 20270113000100): the details the AI Website team needs to start, asked when a lead chooses the
 * AI Website service (the same questions as the WebTara order form). One record per lead; the same Zod schema runs here and on the server,
 * and the database checks again (public.ai_website_onboarding_save).
 */
export interface AiWebsiteDraft {
  clientName: string;
  mobile: string;
  email: string;
  businessName: string;
  onGoogleMaps: '' | 'yes' | 'no';
  googleMapsLink: string;
  city: string;
  businessType: string;
  businessTypeOther: string;
}

export const emptyAiWebsiteDraft = (): AiWebsiteDraft => ({
  clientName: '', mobile: '', email: '', businessName: '', onGoogleMaps: '', googleMapsLink: '', city: '', businessType: '', businessTypeOther: ''
});

export const aiWebsiteDraftFrom = (o: AiWebsiteOnboarding): AiWebsiteDraft => ({
  clientName: o.clientName, mobile: o.mobile, email: o.email ?? '', businessName: o.businessName, onGoogleMaps: o.onGoogleMaps ? 'yes' : 'no',
  googleMapsLink: o.googleMapsLink ?? '', city: o.city, businessType: o.businessType, businessTypeOther: o.businessTypeOther ?? ''
});

/** A lead's mobile number as the 10 digits this form asks for (+91 / 91 / 0 and spaces removed); '' when it is not one. */
export const tenDigits = (phone: string): string => {
  const d = (phone || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^\d{10}$/.test(d) ? d : '';
};

/**
 * Starts the empty fields from what the lead form already has (the customer, business, mobile, e-mail, city and category), so nothing is
 * typed twice. A field already filled here is never replaced. Nothing is invented: an empty lead field leaves the field empty.
 */
export function prefillAiWebsite(
  draft: AiWebsiteDraft,
  lead: { name?: string | null; company?: string | null; phone?: string | null; email?: string | null; city?: string | null; businessCategory?: string | null }
): AiWebsiteDraft {
  const types = AI_WEBSITE_BUSINESS_TYPES as readonly string[];
  return {
    ...draft,
    clientName: draft.clientName || (lead.name ?? '').trim(),
    businessName: draft.businessName || (lead.company ?? '').trim(),
    mobile: draft.mobile || tenDigits(lead.phone ?? ''),
    email: draft.email || (lead.email ?? '').trim(),
    city: draft.city || (lead.city ?? '').trim(),
    businessType: draft.businessType || (lead.businessCategory && types.includes(lead.businessCategory) ? lead.businessCategory : '')
  };
}

export type AiWebsiteErrors = Partial<Record<keyof AiWebsiteDraft, string>>;

/** Checks the draft with the shared schema: the body to send, or the message of each field. */
export function checkAiWebsite(d: AiWebsiteDraft): { ok: true; body: AiWebsiteOnboardingBody } | { ok: false; errors: AiWebsiteErrors } {
  const body = {
    clientName: d.clientName, mobile: d.mobile, email: d.email, businessName: d.businessName,
    onGoogleMaps: d.onGoogleMaps === '' ? undefined : d.onGoogleMaps === 'yes',
    googleMapsLink: d.onGoogleMaps === 'yes' ? d.googleMapsLink : '', city: d.city, businessType: d.businessType || undefined,
    businessTypeOther: d.businessType === 'Other' ? d.businessTypeOther : ''
  };
  const parsed = aiWebsiteOnboardingSchema.safeParse(body);
  if (parsed.success) return { ok: true, body: body as AiWebsiteOnboardingBody };
  const errors: AiWebsiteErrors = {};
  for (const i of parsed.error.issues) {
    const k = String(i.path[0] ?? '') as keyof AiWebsiteDraft;
    if (k && !errors[k]) errors[k] = i.message;
  }
  return { ok: false, errors };
}

const choiceBtn = (on: boolean) =>
  `flex-1 px-3 py-2 rounded-xl border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-60 ${
    on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
  }`;

/** The editable section, shown only while AI Website is one of the lead's services. */
export const AiWebsiteOnboardingFields: React.FC<{
  value: AiWebsiteDraft;
  onChange: (next: AiWebsiteDraft) => void;
  errors?: AiWebsiteErrors;
  disabled?: boolean;
  /** Extra line under the heading (e.g. who saved it last). */
  footer?: React.ReactNode;
}> = ({ value, onChange, errors = {}, disabled, footer }) => {
  const set = <K extends keyof AiWebsiteDraft>(k: K, v: AiWebsiteDraft[K]) => onChange({ ...value, [k]: v });
  const text = (k: keyof AiWebsiteDraft, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`aiw-${k}`}
      className={`${inputCls} ${errors[k] ? 'border-rose-400' : ''}`}
      value={value[k]}
      onChange={e => set(k, e.target.value as never)}
      aria-invalid={!!errors[k]}
      aria-describedby={errors[k] ? `aiw-${k}-error` : undefined}
      disabled={disabled}
      {...props}
    />
  );
  return (
    <Card className="p-5">
      <section aria-labelledby="aiw-heading" data-testid="ai-website-onboarding">
        <div className="flex items-start gap-2 mb-1">
          <Globe className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="aiw-heading" className="text-sm font-bold text-slate-900">AI Website Client Onboarding Details</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              What the AI Website team needs to start the client&apos;s website. Fields marked * are required. They are saved with this lead and stay with it through every stage.
            </p>
          </div>
        </div>
        {footer}

        <h3 className="text-xs font-bold text-slate-700 mt-4 mb-2">Basic client details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Client name" required htmlFor="aiw-clientName" error={errors.clientName}>
            {text('clientName', { autoComplete: 'name', maxLength: 160, required: true })}
          </Field>
          <Field label="Mobile number" required htmlFor="aiw-mobile" error={errors.mobile}>
            {text('mobile', { type: 'tel', inputMode: 'numeric', placeholder: '10-digit mobile', autoComplete: 'tel', maxLength: 16, required: true })}
          </Field>
          <Field label="Email (optional)" htmlFor="aiw-email" error={errors.email}>
            {text('email', { type: 'email', placeholder: 'For the client’s receipt', autoComplete: 'email', maxLength: 254 })}
          </Field>
          <Field label="Business name" required htmlFor="aiw-businessName" error={errors.businessName}>
            {text('businessName', { autoComplete: 'organization', maxLength: 200, required: true })}
          </Field>
        </div>

        <h3 className="text-xs font-bold text-slate-700 mt-4 mb-2">Business details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <fieldset aria-describedby={errors.onGoogleMaps ? 'aiw-onGoogleMaps-error' : 'aiw-onGoogleMaps-hint'}>
              <legend className="block text-xs font-medium text-slate-600 mb-1">
                Is the business listed on Google Maps?<span aria-hidden="true"> *</span>
              </legend>
              <div className="flex gap-2" role="radiogroup" aria-label="Is the business listed on Google Maps?">
                {(['yes', 'no'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={value.onGoogleMaps === v}
                    className={choiceBtn(value.onGoogleMaps === v)}
                    onClick={() => onChange({ ...value, onGoogleMaps: v, googleMapsLink: v === 'no' ? '' : value.googleMapsLink })}
                    disabled={disabled}
                    data-testid={`aiw-maps-${v}`}
                  >
                    {v === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
              {errors.onGoogleMaps ? (
                <p id="aiw-onGoogleMaps-error" className="mt-1 text-[11px] text-rose-600">{errors.onGoogleMaps}</p>
              ) : (
                <p id="aiw-onGoogleMaps-hint" className="mt-1 text-[11px] text-slate-500">If not, the AI Website team asks a few questions about the business later.</p>
              )}
            </fieldset>
          </div>
          {value.onGoogleMaps === 'yes' && (
            <div className="sm:col-span-2">
              <Field label="Google Maps link (optional)" htmlFor="aiw-googleMapsLink" error={errors.googleMapsLink}>
                {text('googleMapsLink', { type: 'url', placeholder: 'https://maps.app.goo.gl/...', maxLength: 500 })}
              </Field>
            </div>
          )}
          <Field label="City" required htmlFor="aiw-city" error={errors.city}>
            {text('city', { placeholder: 'e.g. Mumbai', maxLength: 80, required: true })}
          </Field>
          <Field label="Type of business" required htmlFor="aiw-businessType" error={errors.businessType}>
            <select
              id="aiw-businessType"
              className={`${inputCls} ${errors.businessType ? 'border-rose-400' : ''}`}
              value={value.businessType}
              onChange={e => onChange({ ...value, businessType: e.target.value, businessTypeOther: e.target.value === 'Other' ? value.businessTypeOther : '' })}
              aria-invalid={!!errors.businessType}
              aria-describedby={errors.businessType ? 'aiw-businessType-error' : undefined}
              disabled={disabled}
              required
            >
              <option value="">Choose one</option>
              {AI_WEBSITE_BUSINESS_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          {value.businessType === 'Other' && (
            <Field label="Which type of business?" required htmlFor="aiw-businessTypeOther" error={errors.businessTypeOther}>
              {text('businessTypeOther', { placeholder: 'Type the type of business', maxLength: 120, required: true })}
            </Field>
          )}
        </div>
      </section>
    </Card>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
    <dd className="text-sm text-slate-800 break-words">{children}</dd>
  </div>
);

/** Read-only: the details on a lead / customer page, for everybody who can open the lead (Sales, onboarding, consultants, delivery). */
export const AiWebsiteOnboardingCard: React.FC<{ data: AiWebsiteOnboarding | null | undefined; hasService: boolean; className?: string }> = ({ data, hasService, className = '' }) => {
  if (!data && !hasService) return null;
  return (
    <section className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 ${className}`} aria-labelledby="aiw-card-heading" data-testid="ai-website-onboarding-card">
      <h3 id="aiw-card-heading" className="text-sm font-bold text-slate-900 flex items-center gap-2">
        <Globe className="w-4 h-4 text-indigo-600" aria-hidden="true" /> AI Website Client Onboarding Details
      </h3>
      {!data ? (
        <p className="mt-2 text-xs text-slate-500">No AI Website onboarding details were recorded for this lead yet.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          <Row label="Client name">{data.clientName}</Row>
          <Row label="Mobile number">
            <a className="text-indigo-700 hover:underline" href={`tel:+91${data.mobile}`}>{data.mobile}</a>
          </Row>
          <Row label="Email">{data.email ? <a className="text-indigo-700 hover:underline" href={`mailto:${data.email}`}>{data.email}</a> : <span className="text-slate-400">Not given</span>}</Row>
          <Row label="Business name">{data.businessName}</Row>
          <Row label="On Google Maps">{data.onGoogleMaps ? 'Yes' : 'No'}</Row>
          {data.onGoogleMaps && (
            <Row label="Google Maps link">
              {data.googleMapsLink ? (
                <a className="text-indigo-700 hover:underline break-all" href={data.googleMapsLink} target="_blank" rel="noopener noreferrer">{data.googleMapsLink}</a>
              ) : (
                <span className="text-slate-400">Not given</span>
              )}
            </Row>
          )}
          <Row label="City">{data.city}</Row>
          <Row label="Type of business">{data.businessType === 'Other' && data.businessTypeOther ? `Other: ${data.businessTypeOther}` : data.businessType}</Row>
        </dl>
      )}
    </section>
  );
};
