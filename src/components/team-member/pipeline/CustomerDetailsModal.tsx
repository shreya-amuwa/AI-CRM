import React, { useEffect, useState } from 'react';
import { Building2, Check, FileText, IndianRupee, Mail, MapPin, MessageSquare, Phone, StickyNote, User, X } from 'lucide-react';
import type { PaymentOverview, PipelineCustomerDetail } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { PaymentHistory, PaymentStatusBadge, WorkflowBadge, fmtDateTime } from '../../payments/PaymentBits';
import { ErrorBanner, Loading } from '../../support-member/SupportParts';
import { JOURNEY_STAGES } from './CustomerJourney';
import { Pill, ServiceChips, longDate, money, useServiceCatalog, type Tone } from './shared';

const STAGE_LABEL: Record<string, { label: string; tone: Tone }> = {
  LEAD: { label: 'Lead', tone: 'indigo' },
  POTENTIAL: { label: 'Potential', tone: 'orange' },
  ONBOARDING: { label: 'Onboarding', tone: 'green' },
  CUSTOMER: { label: 'Customer', tone: 'green' },
  LOST: { label: 'Lost', tone: 'red' }
};

const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
};

const Fact: React.FC<{ label: string; value?: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-medium text-slate-400">{label}</dt>
    <dd className={`mt-0.5 text-sm font-semibold text-slate-900 break-words ${mono ? 'font-mono' : ''}`}>{value || <span className="text-slate-300">-</span>}</dd>
  </div>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
      <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center" aria-hidden="true">{icon}</span>
      {title}
    </h3>
    {children}
  </section>
);

/**
 * My Customers pop-up: everything captured when the lead was added (and kept up to date since), plus the
 * services bought, payments and where the customer is on the journey. Read-only.
 */
export const CustomerDetailsModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { byCode } = useServiceCatalog();
  const [c, setC] = useState<PipelineCustomerDetail | null>(null);
  const [pay, setPay] = useState<PaymentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setC(null);
    setError(null);
    pipelineApi.get(id).then(
      r => live && setC(r),
      e => live && setError(errorMessage(e))
    );
    pipelineApi.paymentOverview(id).then(
      r => live && setPay(r),
      () => live && setPay(null)
    );
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const digits = (c?.whatsapp || c?.phone || '').replace(/[^\d]/g, '');
  const stage = c ? STAGE_LABEL[c.lifecycleStage] : null;
  const stageIndex = c?.onboarding ? JOURNEY_STAGES.findIndex(s => s.key === (c.onboarding?.stage === 'COMPLETED' ? 'HANDOVER' : c.onboarding?.stage)) : -1;
  const journeyDone = c?.onboarding?.stage === 'COMPLETED';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={c ? `Customer ${c.company || c.name}` : 'Customer'}
        className="w-full max-w-5xl max-h-[calc(100vh-1.5rem)] overflow-hidden rounded-3xl bg-slate-50 shadow-2xl border border-slate-200 flex flex-col animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="relative px-5 sm:px-7 py-5 bg-gradient-to-br from-indigo-700 via-indigo-600 to-blue-600 text-white">
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
          {c ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 pr-8">
              <div className="w-16 h-16 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-xl font-bold shrink-0">{initialsOf(c.company || c.name)}</div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl sm:text-2xl font-bold leading-tight break-words">{c.company || c.name}</h2>
                <p className="text-sm text-indigo-100 mt-0.5 break-words">
                  {c.name}
                  {c.businessCategory ? ` · ${c.businessCategory}` : ''}
                  {c.city ? ` · ${c.city}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {stage && <Pill tone={stage.tone}>{stage.label}</Pill>}
                  <PaymentStatusBadge status={c.paymentStatus} />
                  <WorkflowBadge workflow={c.paymentWorkflow} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-indigo-700 text-xs font-bold hover:bg-indigo-50">
                    <Phone className="w-3.5 h-3.5" /> Call
                  </a>
                )}
                {digits && (
                  <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600">
                    <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="h-16 flex items-center text-sm text-indigo-100">{error ? 'Could not load this customer' : 'Loading customer...'}</div>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-4">
          {error ? (
            <ErrorBanner message={error} />
          ) : !c ? (
            <Loading label="Loading customer..." />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-4">
                  <Section icon={<User className="w-4 h-4" />} title="Customer & business details">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
                      <Fact label="Customer Name" value={c.name} />
                      <Fact label="Business name" value={c.company} />
                      <Fact label="Mobile number" value={c.phone} mono />
                      <Fact label="WhatsApp number" value={c.whatsapp || c.phone} mono />
                      <Fact label="E-mail" value={c.email} />
                      <Fact label="City" value={c.city} />
                      <Fact label="Business category" value={c.businessCategory} />
                      <Fact label="Lead source" value={c.leadSource} />
                    </dl>
                  </Section>

                  <Section icon={<Building2 className="w-4 h-4" />} title="Services">
                    {c.services.length > 0 ? <ServiceChips codes={c.services} catalog={byCode} max={20} /> : <p className="text-xs text-slate-500">No services selected.</p>}
                  </Section>

                  {c.notes && (
                    <Section icon={<StickyNote className="w-4 h-4" />} title="Notes">
                      <p className="text-sm text-slate-800 whitespace-pre-line break-words">{c.notes}</p>
                    </Section>
                  )}

                  {c.conversations.length > 0 && (
                    <Section icon={<MessageSquare className="w-4 h-4" />} title="Last conversation">
                      <p className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 whitespace-pre-line break-words">{c.conversations[0].note}</p>
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        {c.conversations[0].author ? `${c.conversations[0].author.fullName} · ` : ''}
                        {fmtDateTime(c.conversations[0].occurredAt)}
                      </p>
                    </Section>
                  )}
                </div>

                <div className="space-y-4">
                  <Section icon={<MapPin className="w-4 h-4" />} title="Lead information">
                    <dl className="grid grid-cols-2 lg:grid-cols-1 gap-x-6 gap-y-3.5">
                      <Fact label="Added by" value={c.createdBy?.fullName} />
                      <Fact label="Sales owner" value={c.owner?.fullName} />
                      <Fact label="Added on" value={longDate(c.createdAt)} />
                      <Fact label="Expected budget" value={c.expectedBudget !== null ? money(c.expectedBudget) : null} />
                      <Fact label="Next follow-up" value={c.nextFollowUpAt ? fmtDateTime(c.nextFollowUpAt) : null} />
                      <Fact label="Payment due" value={c.paymentDueDate ? longDate(c.paymentDueDate) : null} />
                    </dl>
                  </Section>

                  <Section icon={<IndianRupee className="w-4 h-4" />} title="Deal & payment">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                      <Fact label="Agreed amount" value={(pay?.dealAmount ?? c.dealAmount) !== null ? money(pay?.dealAmount ?? c.dealAmount) : null} />
                      <Fact label="Verified received" value={money(pay?.verified ?? c.amountVerified)} />
                      <Fact label="Pending verification" value={money(pay?.pending ?? Math.max(0, c.amountReceived - c.amountVerified))} />
                      <Fact label="Outstanding balance" value={pay ? money(pay.balance) : null} />
                    </dl>
                  </Section>
                </div>
              </div>

              {c.onboarding && (
                <Section icon={<Check className="w-4 h-4" />} title="Customer journey">
                  <ol className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                    {JOURNEY_STAGES.map((s, i) => {
                      const done = i < stageIndex || journeyDone;
                      const now = i === stageIndex && !journeyDone;
                      return (
                        <li key={s.key} className="flex sm:flex-col items-center sm:items-start gap-2.5" aria-current={now ? 'step' : undefined}>
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${done ? 'bg-emerald-700 text-white' : now ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-400'}`}>
                            {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                          </span>
                          <span className={`text-xs ${done || now ? 'font-bold text-slate-900' : 'font-semibold text-slate-500'}`}>{s.label}</span>
                        </li>
                      );
                    })}
                  </ol>
                </Section>
              )}

              {pay && pay.payments.length > 0 && (
                <Section icon={<FileText className="w-4 h-4" />} title="Payment history">
                  <PaymentHistory payments={pay.payments} />
                </Section>
              )}
            </>
          )}
        </div>

        <div className="px-5 sm:px-7 py-3 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            {c?.email && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-indigo-700">
                <Mail className="w-3.5 h-3.5" /> {c.email}
              </a>
            )}
          </span>
          <button type="button" onClick={onClose} className="px-5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
