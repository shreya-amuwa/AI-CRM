import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import type { PanelDetails, PanelDetailsService } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { workflowApi } from '../../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, inputCls, longDate, longDateTime, Spinner, usePipelineRealtime } from '../../team-member/pipeline/shared';

/**
 * The password the Meta Verifier set on the customer's WhatsApp panel (the CRM cannot set it on the external panel). It is typed once, sent to
 * the server over HTTPS, encrypted there and e-mailed to the customer's address on the record; nothing keeps it afterwards. `requestId` stays
 * the same across retries of one attempt, so a double click or a retry sends one e-mail.
 */
const PanelPasswordDialog: React.FC<{ customerId: string; service: PanelDetailsService; email: string | null | undefined; onClose: () => void; onSent: (d: PanelDetails) => void }> = ({ customerId, service, email, onClose, onSent }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const problem = password.length < 8 ? 'Use at least 8 characters.' : password !== confirm ? 'The two passwords are not the same.' : null;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await workflowApi.sendPanelCredentials(customerId, service.code, { password, requestId: requestId.current });
      setPassword('');
      setConfirm('');
      onSent(d);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`${service.name}: panel password`} description="Set on the panel, then sent to the customer by e-mail. The CRM does not keep it." onClose={() => !busy && onClose()}>
      <form onSubmit={send} className="space-y-3" autoComplete="off">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-0.5">
          <p>Panel login: <span className="font-mono break-all text-slate-900">{service.panelAccount || 'not saved yet'}</span></p>
          <p>E-mailed to: <span className="font-mono break-all text-slate-900">{email || 'no e-mail on the customer record'}</span></p>
          <p className="text-slate-500">This is the WhatsApp panel login. It is not the Client Dashboard login that Accounts creates.</p>
        </div>
        <label className="block text-xs font-semibold text-slate-700">
          Panel password
          <input className={`${inputCls} mt-1 font-mono`} type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} maxLength={128} autoComplete="new-password" spellCheck={false} disabled={busy} />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Type it again
          <input className={`${inputCls} mt-1 font-mono`} type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} maxLength={128} autoComplete="new-password" spellCheck={false} disabled={busy} />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show the password
        </label>
        {password && problem && <p className="text-xs text-rose-700">{problem}</p>}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={busy || !!problem || !email}>{busy ? 'Sending…' : 'E-mail it to the customer'}</button>
        </div>
      </form>
    </Dialog>
  );
};

/** One WhatsApp service: which panel, and the account / user ID on it. Saved on its own, so one row never overwrites another. */
const ServiceRow: React.FC<{ customerId: string; service: PanelDetailsService; canEdit: boolean; email: string | null | undefined; onSaved: (d: PanelDetails) => void }> = ({ customerId, service, canEdit, email, onSaved }) => {
  const [settingPassword, setSettingPassword] = useState(false);
  const [sentNotice, setSentNotice] = useState(false);
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
              placeholder="e-mail or ID (the password is set separately)"
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
      <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5" aria-label={`Panel password for ${service.name}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-700">Panel password</span>
          {service.credentials ? <span className="rounded-full bg-emerald-50 text-emerald-800 px-2 py-0.5 font-semibold">Configured</span> : <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 font-semibold">Not set</span>}
          {service.credentials?.email && (
            <span className={`rounded-full px-2 py-0.5 font-semibold ${service.credentials.email.status === 'SENT' ? 'bg-emerald-50 text-emerald-800' : service.credentials.email.status === 'FAILED' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
              {{ SENT: 'E-mail sent', QUEUED: 'E-mail waiting to be sent', SENDING: 'E-mail being sent', FAILED: 'E-mail could not be sent', SKIPPED: 'E-mail not sent', CANCELLED: 'E-mail cancelled' }[service.credentials.email.status] ?? service.credentials.email.status}
            </span>
          )}
        </div>
        {service.credentials && (
          <p className="text-xs text-slate-500">
            Set {longDateTime(service.credentials.setAt)}{service.credentials.setBy ? ` by ${service.credentials.setBy}` : ''}
            {service.credentials.email?.to ? ` · e-mailed to ${service.credentials.email.to}` : ''}
            {service.credentials.email?.sentAt ? ` · sent ${longDateTime(service.credentials.email.sentAt)}` : ''}
            . The password itself is not stored.
          </p>
        )}
        {service.credentials?.email && service.credentials.email.status !== 'SENT' && service.credentials.email.detail && (
          <p className="text-xs text-rose-700 break-words">{service.credentials.email.detail}</p>
        )}
        {sentNotice && <p role="status" className="text-xs font-semibold text-emerald-700">The password is on its way to the customer.</p>}
        {canEdit && (
          <div className="flex justify-end">
            <button type="button" className={btn.secondary} disabled={!service.panelAccount || dirty} title={service.panelAccount && !dirty ? undefined : 'Save the account / user ID first.'} onClick={() => { setSentNotice(false); setSettingPassword(true); }}>
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> {service.credentials ? 'Set a new password' : 'Set password and e-mail it'}
            </button>
          </div>
        )}
      </div>
      {settingPassword && (
        <PanelPasswordDialog
          customerId={customerId}
          service={service}
          email={email}
          onClose={() => setSettingPassword(false)}
          onSent={d => { setSettingPassword(false); setSentNotice(true); onSaved(d); }}
        />
      )}
    </li>
  );
};

/**
 * "Client login details" for the Meta Verifier: the customer's internal WhatsApp panel details (the account / user ID per WhatsApp service),
 * and the Client Dashboard login read only - Accounts creates that.
 * The panel password is NOT part of the account form: it has its own action, is encrypted and e-mailed once to the customer's address on the
 * record, and only who/when and the e-mail's state are kept - never the password. Saving the account / user ID never touches it.
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
          <p className="text-xs text-slate-500">The customer&apos;s WhatsApp panel login: the account / user ID, and the password you set on the panel, which is e-mailed to the customer and never stored. Separate from the Client Dashboard login.</p>
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
                <ServiceRow key={s.code} customerId={customerId} service={s} canEdit={data.canEdit} email={data.customerEmail} onSaved={setData} />
              ))}
            </ul>
          )}
          {!data.canEdit && data.services.length > 0 && <p className="text-xs text-slate-500">These details are closed for editing now. Ask the Department Head if one must change.</p>}
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Client Dashboard login (Accounts):</span>{' '}
            {data.dashboardLogin ? (
              <>
                <span className="font-mono break-all">{data.dashboardLogin.email}</span> · created {longDate(data.dashboardLogin.createdAt)}. It is separate from the panel login above.
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
