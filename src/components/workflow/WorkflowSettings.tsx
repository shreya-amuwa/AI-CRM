import React, { useCallback, useEffect, useState } from 'react';
import type { ServiceJourneySetting, VerificationRouteReviewItem, WorkflowSettings as Settings } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi, workflowApi } from '../../lib/api/endpoints';
import { btn, ErrorBanner, inputCls, Pill, Spinner } from '../team-member/pipeline/shared';
import { promptInput } from '../feedback/AppFeedback';

/** How long the Technical Consultant waits after the hand-over. There is no default: until it is set, follow-ups wait. */
const DelayCard: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(() => {
    workflowApi.settings().then(
      s => {
        setSettings(s);
        setDays(s.tcFollowupDelayDays === null ? '' : String(s.tcFollowupDelayDays));
      },
      e => setError(errorMessage(e))
    );
  }, []);
  useEffect(load, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = days.trim() === '' ? null : Number(days);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 365)) return setError('Enter a whole number of days between 1 and 365.');
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setSettings(await workflowApi.setFollowUpDelay(n));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3" aria-labelledby="tc-delay-heading">
      <div>
        <h2 id="tc-delay-heading" className="font-bold text-slate-900">
          Technical Consultant follow-up
        </h2>
        <p className="text-xs text-slate-500">
          After the Meta Verifier hands a customer over and the Department Head passes it on, the Technical Consultant gets a follow-up due this many days later.
        </p>
      </div>
      {!settings && !error && <Spinner label="Loading…" />}
      {settings && (
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-700">
            Days to wait
            <input
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              className={`${inputCls} mt-1 w-32`}
              value={days}
              onChange={e => setDays(e.target.value)}
              disabled={!settings.canEdit || busy}
              placeholder="Not set"
            />
          </label>
          {settings.canEdit && (
            <button type="submit" className={btn.primary} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
          {settings.tcFollowupDelayDays === null ? <Pill tone="orange">Not set: follow-ups are waiting</Pill> : <Pill tone="green">{settings.tcFollowupDelayDays} days</Pill>}
          {settings.awaiting > 0 && <span className="text-xs text-slate-500">{settings.awaiting} follow-up(s) are waiting for this to be set.</span>}
        </form>
      )}
      {saved && (
        <p role="status" className="text-xs text-emerald-800">
          Saved. Waiting follow-ups are scheduled now.
        </p>
      )}
      {error && <ErrorBanner message={error} />}
    </section>
  );
};

/** Which services are verified first by the Meta Verifier (the rest keep the Technical Consultant). */
const ServicesCard: React.FC = () => {
  const [services, setServices] = useState<ServiceJourneySetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    pipelineApi.serviceJourneys().then(setServices, e => setError(errorMessage(e)));
  }, []);
  const toggle = async (s: ServiceJourneySetting) => {
    setBusy(s.code);
    setError(null);
    try {
      setServices(await workflowApi.setServiceMetaVerification(s.code, !s.requiresMetaVerification));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3" aria-labelledby="meta-services-heading">
      <div>
        <h2 id="meta-services-heading" className="font-bold text-slate-900">
          Services verified by the Meta Verifier
        </h2>
        <p className="text-xs text-slate-500">
          For these services the first verification is done by a Meta Verifier. A customer already in verification keeps the route it started with.
        </p>
      </div>
      {!services && !error && <Spinner label="Loading services…" />}
      {services && (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl text-sm" aria-label="Services">
          {services
            .filter(s => s.requiresTechnicalConsultant)
            .map(s => (
              <li key={s.code} className="px-3 py-2 flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-800">{s.name}</span>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4" checked={!!s.requiresMetaVerification} disabled={busy === s.code} onChange={() => void toggle(s)} />
                  Meta Verifier
                </label>
              </li>
            ))}
        </ul>
      )}
      {error && <ErrorBanner message={error} />}
    </section>
  );
};

/** Customers already in verification whose services say another route than the one they started on. */
const RouteReviewCard: React.FC = () => {
  const [items, setItems] = useState<VerificationRouteReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    workflowApi.routeReview().then(setItems, e => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  const move = async (i: VerificationRouteReviewItem) => {
    const to = i.suggestedRoute === 'META' ? 'Meta Verifier' : 'Technical Consultant';
    const reason = await promptInput({
      title: `Move ${i.name} to the ${to}?`, description: `The customer's verification moves to the ${to}. The reason is recorded.`,
      label: 'Reason for moving', required: true, multiline: true, maxLength: 500, confirmLabel: `Move to ${to}`
    });
    if (reason === null) return;
    if (reason.trim().length < 3) { setError('Give a reason of at least 3 characters.'); return; }
    setBusy(i.customerId);
    setError(null);
    try {
      await workflowApi.reroute(i.customerId, i.suggestedRoute, reason.trim());
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  if (items && items.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-amber-200 p-5 space-y-3" aria-labelledby="route-review-heading">
      <div>
        <h2 id="route-review-heading" className="font-bold text-slate-900">
          Customers to review
        </h2>
        <p className="text-xs text-slate-500">These started verification before the Meta Verifier existed. Nothing moves unless you move it.</p>
      </div>
      {!items && !error && <Spinner label="Loading…" />}
      {items && (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl text-sm">
          {items.map(i => (
            <li key={i.customerId} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-semibold text-slate-800">{i.name}</span> <span className="text-xs text-slate-500">· {i.department} · now with the {i.route === 'META' ? 'Meta Verifier' : 'Technical Consultant'}</span>
              </span>
              <button type="button" className={btn.secondary} disabled={busy === i.customerId} onClick={() => void move(i)}>
                Move to the {i.suggestedRoute === 'META' ? 'Meta Verifier' : 'Technical Consultant'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorBanner message={error} />}
    </section>
  );
};

/** Super Admin: how the verification workflow is set up. */
export const WorkflowSettings: React.FC = () => (
  <div className="space-y-4 max-w-3xl" data-testid="workflow-settings">
    <DelayCard />
    <ServicesCard />
    <RouteReviewCard />
  </div>
);
