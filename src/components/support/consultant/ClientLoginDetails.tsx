import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import type { PanelDetails, PanelDetailsService } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { workflowApi } from '../../../lib/api/endpoints';
import { btn, ErrorBanner, inputCls, longDate, Spinner, usePipelineRealtime } from '../../team-member/pipeline/shared';

/** One WhatsApp service: which panel, and the account / user ID on it. Saved on its own, so one row never overwrites another. */
const ServiceRow: React.FC<{ customerId: string; service: PanelDetailsService; canEdit: boolean; onSaved: (d: PanelDetails) => void }> = ({ customerId, service, canEdit, onSaved }) => {
  const [platform, setPlatform] = useState(service.platform ?? '');
  const [account, setAccount] = useState(service.panelAccount ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = platform.trim() !== (service.platform ?? '') || account.trim() !== (service.panelAccount ?? '');

  // a value saved elsewhere (another tab, the Department Head) replaces what is shown, unless this row is being edited
  useEffect(() => {
    if (!dirty) {
      setPlatform(service.platform ?? '');
      setAccount(service.panelAccount ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.platform, service.panelAccount]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await workflowApi.setPanelDetails(customerId, service.code, { platform: platform.trim() || null, account: account.trim() || null }));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <form onSubmit={save} aria-label={`Panel login details for ${service.name}`} className="space-y-2">
        <div className="text-sm font-bold text-slate-900">{service.name}</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-700">
            Panel
            <input className={`${inputCls} mt-1`} value={platform} maxLength={120} onChange={e => { setPlatform(e.target.value); setSaved(false); }} disabled={!canEdit || busy} placeholder="e.g. the panel the number was created on" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Account / user ID
            <input
              className={`${inputCls} mt-1 font-mono`}
              value={account}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              onChange={e => { setAccount(e.target.value); setSaved(false); }}
              disabled={!canEdit || busy}
              placeholder="e-mail or ID - never a password"
            />
          </label>
        </div>
        {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {saved && !dirty && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Saved</span>}
            <button type="submit" className={btn.primary} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </li>
  );
};

/**
 * "Client login details" for the Meta Verifier: the customer's internal WhatsApp panel details (the account / user ID per WhatsApp service),
 * and the Client Dashboard login read only - Accounts creates that, and the client chooses their own password from an e-mailed link.
 * There is no password field here, on purpose: a password is never typed into, stored in or sent from the CRM by the verifier.
 */
export const ClientLoginDetails: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [data, setData] = useState<PanelDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    workflowApi.panelDetails(customerId).then(
      d => {
        setData(d);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [customerId]);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4" aria-labelledby="client-login-details-heading">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0" aria-hidden="true">
          <KeyRound className="w-4 h-4" />
        </span>
        <div>
          <h2 id="client-login-details-heading" className="font-bold text-slate-900">
            Client login details
          </h2>
          <p className="text-xs text-slate-500">The customer&apos;s WhatsApp panel account. Record the account or user ID only - never a password.</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <Spinner label="Loading login details…" />}
      {data && (
        <>
          {data.services.length === 0 ? (
            <p className="text-sm text-slate-500">This customer has no WhatsApp service that needs panel login details.</p>
          ) : (
            <ul className="space-y-3">
              {data.services.map(s => (
                <ServiceRow key={s.code} customerId={customerId} service={s} canEdit={data.canEdit} onSaved={setData} />
              ))}
            </ul>
          )}
          {!data.canEdit && data.services.length > 0 && <p className="text-xs text-slate-500">These details are closed for editing now. Ask the Department Head if one must change.</p>}
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Client Dashboard login (Accounts):</span>{' '}
            {data.dashboardLogin ? (
              <>
                <span className="font-mono break-all">{data.dashboardLogin.email}</span> · created {longDate(data.dashboardLogin.createdAt)}. The client chooses their own password from an e-mailed link.
              </>
            ) : (
              'not created yet. Accounts creates it; you do not need to wait for it.'
            )}
          </div>
        </>
      )}
    </section>
  );
};
