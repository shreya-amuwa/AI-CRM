import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { OnboardingStage, PipelineCustomerDetail } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { ActivityCard } from './LeadForms';
import { Card, ErrorBanner, Spinner } from './shared';

/** The stages of a customer's journey, in order (shown on the Onboarding page and in My Customers). */
export const JOURNEY_STAGES: { key: OnboardingStage; label: string; hint: string }[] = [
  { key: 'SALES_CONSULTATION', label: 'Sales consultation', hint: 'Done when payment is confirmed' },
  { key: 'COLLECT_REQUIREMENTS', label: 'Collect requirements', hint: 'Mandatory documents' },
  { key: 'SETUP', label: 'Setup & configuration', hint: 'Technical Consultant' },
  { key: 'APPROVAL', label: 'Approval & testing', hint: 'Client sign-off' },
  { key: 'HANDOVER', label: 'Client handover', hint: 'After verification' }
];

/** "Onboarding stage": where the customer is on the journey. */
export const OnboardingStageCard: React.FC<{
  o: PipelineCustomerDetail['onboarding'];
  savedCount?: number;
  totalCount?: number;
  bare?: boolean;
}> = ({ o, savedCount, totalCount, bare }) => {
  const stageIndex = JOURNEY_STAGES.findIndex(s => s.key === (o?.stage === 'COMPLETED' ? 'HANDOVER' : o?.stage));
  const body = (
    <>
      <h2 className="text-sm font-bold text-slate-900 mb-3">Onboarding stage</h2>
      <ol className="space-y-0">
        {JOURNEY_STAGES.map((s, i) => {
          const done = i < stageIndex || o?.stage === 'COMPLETED';
          const now = i === stageIndex && o?.stage !== 'COMPLETED';
          return (
            <li key={s.key} className="flex gap-3" aria-current={now ? 'step' : undefined}>
              <div className="flex flex-col items-center">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    done ? 'bg-emerald-700 text-white' : now ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-400'
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                {i < JOURNEY_STAGES.length - 1 && <span className={`w-0.5 flex-1 min-h-4 ${done ? 'bg-emerald-700' : 'bg-slate-200'}`} />}
              </div>
              <div className="pb-3">
                <div className={`text-xs ${now || done ? 'font-bold text-slate-900' : 'font-semibold text-slate-600'}`}>{s.label}</div>
                <div className="text-[11px] text-slate-500">
                  {s.key === 'COLLECT_REQUIREMENTS' && now && savedCount !== undefined && totalCount !== undefined ? `In progress · ${savedCount} of ${totalCount}` : s.hint}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
  return bare ? <div>{body}</div> : <Card className="p-5">{body}</Card>;
};

/**
 * The customer journey (onboarding stage + recent activity) for one customer, loaded by id. Used where
 * only a customer's basic details are shown, for example the My Customers pop-up.
 */
export const CustomerJourney: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [c, setC] = useState<PipelineCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setC(null);
    setError(null);
    pipelineApi.get(customerId).then(
      r => live && setC(r),
      e => live && setError(errorMessage(e))
    );
    return () => {
      live = false;
    };
  }, [customerId]);

  if (error) return <ErrorBanner message={error} />;
  if (!c) return <Spinner label="Loading the customer journey" />;
  return (
    <div className="space-y-4" aria-label="Customer journey">
      <OnboardingStageCard o={c.onboarding} />
      <ActivityCard activities={c.activities} title="Recent activity" />
    </div>
  );
};
