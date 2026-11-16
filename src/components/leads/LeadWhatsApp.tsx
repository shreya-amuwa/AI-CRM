import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, MessageCircle, Plus, RefreshCw, X } from 'lucide-react';
import type { LeadWhatsAppMessage, LeadWhatsAppSettings, LeadWhatsAppVariable } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { leadWhatsAppApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { btn, ErrorBanner, Field, inputCls, Pill, type Tone } from '../team-member/pipeline/shared';

const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '-');

/** What each state means, in words a sales person can act on. ACCEPTED is deliberately not called "delivered". */
export const LEAD_WA_STATUS: Record<LeadWhatsAppMessage['status'], { tone: Tone; text: string; hint: string }> = {
  PENDING: { tone: 'orange', text: 'Waiting to be sent', hint: 'It will be sent in a moment.' },
  PROCESSING: { tone: 'indigo', text: 'Sending', hint: 'The message is being handed to WhatsApp.' },
  DRY_RUN: { tone: 'slate', text: 'Test run, not sent', hint: 'The server is in test mode: nothing was sent to the lead.' },
  ACCEPTED: { tone: 'indigo', text: 'Sent', hint: 'WhatsApp took the message. Delivery is confirmed separately.' },
  DELIVERED: { tone: 'green', text: 'Delivered', hint: 'The lead\'s phone received it.' },
  READ: { tone: 'green', text: 'Read', hint: 'The lead opened it.' },
  RETRY: { tone: 'orange', text: 'Will be tried again', hint: 'WhatsApp was busy. It is retried automatically.' },
  FAILED: { tone: 'red', text: 'Failed', hint: 'It could not be sent. You can send it again.' },
  SKIPPED: { tone: 'slate', text: 'Skipped', hint: 'It was not sent (see the reason).' }
};

export const LEAD_WA_VARIABLES: { value: LeadWhatsAppVariable; label: string }[] = [
  { value: 'LEAD_NAME', label: 'Lead name' },
  { value: 'LEAD_COMPANY', label: 'Lead business name' },
  { value: 'SALES_PERSON_NAME', label: 'Sales person name' },
  { value: 'SALES_PERSON_PHONE', label: 'Sales person phone' }
];
const variableLabel = (v: string) => LEAD_WA_VARIABLES.find(x => x.value === v)?.label ?? v;
const reason = (detail: string | null) => (detail ?? '').replace(/^[A-Z_]+: /, '');

/**
 * The welcome WhatsApp of one lead, on the lead's page: its state and, when it failed or was skipped, "Send again". Shows nothing when no
 * welcome message was queued for the lead (the feature is off, or the lead was assigned before it was switched on).
 */
export const LeadWhatsAppStatus: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [msg, setMsg] = useState<LeadWhatsAppMessage | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    leadWhatsAppApi.history(customerId).then(h => setMsg(h[0] ?? null), () => setMsg(null));
  }, [customerId]);
  useEffect(() => load(), [load]);

  if (!msg) return null;
  const st = LEAD_WA_STATUS[msg.status];
  const canResend = msg.status === 'FAILED' || msg.status === 'SKIPPED' || msg.status === 'DRY_RUN';
  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      setMsg(await leadWhatsAppApi.resend(customerId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-slate-200 p-3 space-y-2" aria-label="Welcome WhatsApp">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircle className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <h4 className="text-xs font-bold text-slate-800">Welcome WhatsApp</h4>
        <Pill tone={st.tone}>{st.text}</Pill>
        {canResend && (
          <button type="button" className={`${btn.secondary} ml-auto`} disabled={busy} onClick={() => void resend()}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Working…' : 'Send again'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Our services, sent once when the lead got its sales person. {st.hint}
        {msg.recipient ? ` ${msg.recipient}` : ''}
        {msg.deliveredAt ? ` · ${stamp(msg.deliveredAt)}` : msg.acceptedAt ? ` · ${stamp(msg.acceptedAt)}` : ''}
      </p>
      {msg.detail && msg.status !== 'DELIVERED' && msg.status !== 'READ' && <p role="alert" className="text-[11px] text-rose-700">{reason(msg.detail)}</p>}
      {error && <ErrorBanner message={error} />}
    </section>
  );
};

/** The lead welcome WhatsApp settings and the latest messages (Super Admin, Sales Department Head). */
export const LeadWhatsAppSettingsPage: React.FC = () => {
  const [s, setS] = useState<LeadWhatsAppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  // kept here: a save reloads the form (it starts again from the saved settings), and the confirmation must survive that
  const [justSaved, setJustSaved] = useState(false);
  const load = useCallback(() => {
    setError(null);
    setJustSaved(false);
    leadWhatsAppApi.settings().then(setS, e => setError(errorMessage(e)));
  }, []);
  useEffect(() => load(), [load]);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Lead Welcome WhatsApp"
        subtitle="One WhatsApp message about the services of Amuwa Corporation, sent to a lead once, when it is first given to a sales person."
        actions={<button type="button" className={btn.secondary} onClick={load}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!s && !error && <p role="status" className="text-sm text-slate-500">Loading…</p>}
      {s && (
        <>
          <ModeBanner s={s} />
          <SettingsForm key={s.updatedAt} settings={s} justSaved={justSaved} onSaved={v => { setS(v); setJustSaved(true); }} />
          <Recent s={s} />
        </>
      )}
    </div>
  );
};

const ModeBanner: React.FC<{ s: LeadWhatsAppSettings }> = ({ s }) => {
  const mode = s.delivery?.mode ?? 'dry_run';
  const tone: Tone = !s.enabled ? 'slate' : s.delivery?.ready && s.templateApproved ? 'green' : 'orange';
  const label = !s.enabled ? 'Switched off' : mode === 'live' && s.delivery?.ready ? (s.templateApproved ? 'Live' : 'Live, waiting for the template approval') : mode === 'off' ? 'Off on the server' : 'Test run';
  return (
    <section className="rounded-xl border border-slate-200 p-4 space-y-2" aria-label="Sending status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-800">Status</span>
        <Pill tone={tone}>{label}</Pill>
        <span className="text-[11px] text-slate-500">
          {s.counts.sent} sent · {s.counts.queued} waiting · {s.counts.failed} failed · {s.counts.skipped} skipped{s.counts.dryRun ? ` · ${s.counts.dryRun} test runs` : ''}
        </span>
      </div>
      {s.delivery && !s.delivery.ready && <p role="status" className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{s.delivery.note}</p>}
      <p className="text-[11px] text-slate-500">
        Who gets it: a lead whose first sales person is a Sales Team Member, Team Lead, Telecaller, field seller or Business Associate. A lead held by a
        Department Head waits until it reaches a sales person. Reassigning a lead never sends it again. Leads assigned before this was switched on are not messaged.
      </p>
    </section>
  );
};

const SettingsForm: React.FC<{ settings: LeadWhatsAppSettings; justSaved: boolean; onSaved: (s: LeadWhatsAppSettings) => void }> = ({ settings, justSaved, onSaved }) => {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [name, setName] = useState(settings.templateName ?? '');
  const [lang, setLang] = useState(settings.templateLanguage);
  const [approved, setApproved] = useState(settings.templateApproved);
  const [vars, setVars] = useState<LeadWhatsAppVariable[]>(settings.variables);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a changed template is not the approved one: the approval is asked again
  const changed = name.trim() !== (settings.templateName ?? '') || lang.trim() !== settings.templateLanguage || vars.join() !== settings.variables.join();
  useEffect(() => {
    if (changed && settings.templateApproved) setApproved(false);
  }, [changed, settings.templateApproved]);

  const move = (i: number, d: -1 | 1) => setVars(v => {
    const n = [...v];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await leadWhatsAppApi.saveSettings({ enabled, templateName: name.trim() || null, templateLanguage: lang.trim() || 'en', templateApproved: approved && !!name.trim(), variables: vars }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-slate-200 p-4 space-y-4" aria-label="Lead welcome WhatsApp settings">
      <h3 className="text-sm font-bold text-slate-900">Settings</h3>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Send the welcome WhatsApp to new leads</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Template name (exactly as registered with Wabastore / Meta)" htmlFor="lwa-template">
          <input id="lwa-template" className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. amuwa_services_intro" maxLength={255} />
        </Field>
        <Field label="Template language" htmlFor="lwa-lang">
          <input id="lwa-lang" className={inputCls} value={lang} onChange={e => setLang(e.target.value)} placeholder="en" maxLength={10} />
        </Field>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-700">Template variables, in order</p>
        {vars.length === 0 && <p className="text-[11px] text-slate-500">The template has no variables.</p>}
        <ol className="space-y-1.5">
          {vars.map((v, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-slate-500 w-10">{`{{${i + 1}}}`}</span>
              <select aria-label={`Variable ${i + 1}`} className={`${inputCls} !w-auto`} value={v} onChange={e => setVars(x => x.map((y, j) => (j === i ? (e.target.value as LeadWhatsAppVariable) : y)))}>
                {LEAD_WA_VARIABLES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button type="button" className={btn.secondary} aria-label={`Move variable ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" aria-hidden="true" /></button>
              <button type="button" className={btn.secondary} aria-label={`Move variable ${i + 1} down`} disabled={i === vars.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" aria-hidden="true" /></button>
              <button type="button" className={btn.secondary} aria-label={`Remove variable ${i + 1}`} onClick={() => setVars(x => x.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ol>
        {vars.length < 10 && (
          <button type="button" className={btn.secondary} onClick={() => setVars(x => [...x, 'LEAD_NAME'])}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a variable</button>
        )}
      </div>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={approved} disabled={!name.trim()} onChange={e => setApproved(e.target.checked)} />
        <span>The provider has approved this template{changed && settings.templateApproved ? ' (you changed it: tick again once the new one is approved)' : ''}. Nothing is sent until this is ticked.</span>
      </label>
      {error && <ErrorBanner message={error} />}
      {justSaved && !changed && <p role="status" className="text-[11px] text-emerald-700">Settings saved.</p>}
      <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</button>
      {settings.updatedBy && <p className="text-[11px] text-slate-400">Last changed by {settings.updatedBy}, {stamp(settings.updatedAt)}</p>}
    </section>
  );
};

const Recent: React.FC<{ s: LeadWhatsAppSettings }> = ({ s }) => (
  <section className="rounded-xl border border-slate-200 p-4 space-y-3" aria-label="Latest welcome messages">
    <h3 className="text-sm font-bold text-slate-900">Latest messages</h3>
    {s.recent.length === 0 ? (
      <p className="text-xs text-slate-500">No welcome message yet.</p>
    ) : (
      <ul className="divide-y divide-slate-100">
        {s.recent.map(m => {
          const st = LEAD_WA_STATUS[m.status];
          return (
            <li key={m.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-slate-900 min-w-0 break-words">{m.leadName || 'Lead'}</span>
              <span className="text-slate-500">{m.salesPerson ? `to ${m.salesPerson}'s lead` : ''}</span>
              <Pill tone={st.tone}>{st.text}</Pill>
              <span className="text-slate-400">{m.recipient ?? ''} · {stamp(m.createdAt)}</span>
              {m.detail && m.status !== 'DELIVERED' && m.status !== 'READ' && <span className="basis-full text-[11px] text-rose-700">{reason(m.detail)}</span>}
            </li>
          );
        })}
      </ul>
    )}
    <p className="text-[11px] text-slate-400">Variables in use: {s.variables.length ? s.variables.map((v, i) => `{{${i + 1}}} ${variableLabel(v)}`).join(', ') : 'none'}</p>
  </section>
);
