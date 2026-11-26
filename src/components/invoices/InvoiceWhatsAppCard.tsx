import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, RefreshCw, Settings } from 'lucide-react';
import type { InvoiceWhatsAppDispatch, InvoiceWhatsAppSettings, InvoiceWhatsAppStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { generatedInvoicesApi } from '../../lib/api/endpoints';
import { btn, ErrorBanner, Field, inputCls, Pill, type Tone } from '../team-member/pipeline/shared';

const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '-');

/** What each state means, in words Accounts can act on. ACCEPTED is deliberately not called "sent" or "delivered". */
const STATUS: Record<InvoiceWhatsAppStatus, { tone: Tone; text: string; hint: string }> = {
  PENDING: { tone: 'orange', text: 'Waiting to be sent', hint: 'It will be sent in a moment.' },
  PROCESSING: { tone: 'indigo', text: 'Sending', hint: 'The message is being handed to WhatsApp.' },
  DRY_RUN: { tone: 'slate', text: 'Test run, not sent', hint: 'This server is in test mode: nothing was sent to the customer.' },
  ACCEPTED: { tone: 'indigo', text: 'Accepted by WhatsApp', hint: 'The sending service took the message. Delivery is confirmed separately.' },
  DELIVERED: { tone: 'green', text: 'Delivered', hint: 'The customer\'s phone received it.' },
  READ: { tone: 'green', text: 'Read', hint: 'The customer opened it.' },
  RETRY: { tone: 'orange', text: 'Will be tried again', hint: 'The sending service was busy. It is retried automatically.' },
  FAILED: { tone: 'red', text: 'Failed', hint: 'It could not be sent. You can send it again.' },
  SKIPPED: { tone: 'slate', text: 'Skipped', hint: 'It was not sent (see the reason).' }
};

/**
 * Send the PAID invoice to the customer's WhatsApp number (Accounts). One click, one message: a repeated click returns the same dispatch.
 * The PDF is never attached from here; the server hands the sending service a short-lived link. Settings (switch, automatic sending, template) are for the
 * Super Admin and the Accounts Department Head.
 */
export const InvoiceWhatsAppCard: React.FC<{ invoiceId: string; invoiceNumber: string }> = ({ invoiceId, invoiceNumber }) => {
  const [history, setHistory] = useState<InvoiceWhatsAppDispatch[] | null>(null);
  const [settings, setSettings] = useState<InvoiceWhatsAppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([generatedInvoicesApi.whatsAppHistory(invoiceId), generatedInvoicesApi.whatsAppSettings()]);
      setHistory(h);
      setSettings(s);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [invoiceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const latest = history?.[0] ?? null;
  const send = async (resend: boolean) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await generatedInvoicesApi.sendWhatsApp(invoiceId, resend);
      if (r.mode === 'dry_run') setInfo('Test mode: the message was prepared and logged, but nothing was sent to the customer.');
      else if (r.note) setInfo(r.note);
      else if (r.replayed) setInfo('This invoice was already sent to this number. Nothing new was sent.');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const canResend = latest && (latest.status === 'FAILED' || latest.status === 'DRY_RUN' || latest.status === 'SKIPPED' || latest.status === 'ACCEPTED');
  const st = latest ? STATUS[latest.status] : null;

  return (
    <section className="rounded-xl border border-slate-200 p-4 space-y-3" aria-label="Send the invoice by WhatsApp">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircle className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <h4 className="text-xs font-bold text-slate-800">Paid invoice on WhatsApp</h4>
        {st && <Pill tone={st.tone}>{st.text}</Pill>}
        {settings && !settings.enabled && <Pill tone="slate">Switched off</Pill>}
        {settings?.canEdit && (
          <button type="button" className={`${btn.secondary} ml-auto`} onClick={() => setEditing(v => !v)} aria-expanded={editing}>
            <Settings className="w-3.5 h-3.5" aria-hidden="true" /> Settings
          </button>
        )}
      </div>
      {settings && !settings.enabled && (
        <p role="status" className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Sending invoices by WhatsApp is switched off. {settings.canEdit ? 'Open Settings and tick "Allow sending paid invoices by WhatsApp".' : 'Ask the Managing Director or the Accounts Department Head to switch it on.'}
        </p>
      )}
      {settings?.delivery && !settings.delivery.ready && (
        <p role="status" className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {settings.delivery.note}
        </p>
      )}
      {st && latest && (
        <p className="text-[11px] text-slate-500">
          {st.hint} {latest.recipient} · {latest.attempts} attempt{latest.attempts === 1 ? '' : 's'}
          {latest.deliveredAt ? ` · delivered ${stamp(latest.deliveredAt)}` : latest.acceptedAt ? ` · accepted ${stamp(latest.acceptedAt)}` : ''}
        </p>
      )}
      {latest?.detail && latest.status !== 'DELIVERED' && latest.status !== 'READ' && <p role="alert" className="text-[11px] text-rose-700">{latest.detail}</p>}
      {!latest && history && <p className="text-[11px] text-slate-500">Not sent by WhatsApp yet. The customer's WhatsApp number on their record is used.</p>}
      <div className="flex flex-wrap gap-2">
        {!latest && (
          <button type="button" className={btn.primary} disabled={busy || (settings ? !settings.enabled : true)} onClick={() => void send(false)} aria-label={`Send invoice ${invoiceNumber} by WhatsApp`}>
            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : 'Send invoice via WhatsApp'}
          </button>
        )}
        {canResend && (
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => void send(true)}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Working…' : 'Send again'}
          </button>
        )}
        <button type="button" className={btn.secondary} disabled={busy} onClick={() => void load()}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh status
        </button>
      </div>
      {info && <p role="status" className="text-[11px] text-slate-600">{info}</p>}
      {error && <ErrorBanner message={error} />}
      {history && history.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-slate-600 font-semibold">History</summary>
          <ul className="mt-2 space-y-2">
            {history.map(d => (
              <li key={d.id} className="border border-slate-100 rounded-lg px-3 py-2">
                <div className="font-semibold text-slate-800">{d.recipient} · {STATUS[d.status].text}</div>
                <ol className="mt-1 space-y-0.5 text-slate-500">
                  {d.events.map((e, i) => (
                    <li key={i}>{stamp(e.at)} · {e.kind.replace(/_/g, ' ').toLowerCase()}{e.attempt ? ` (attempt ${e.attempt})` : ''}{e.detail ? `: ${e.detail}` : ''}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </details>
      )}
      {editing && settings && <SettingsForm settings={settings} onSaved={s => { setSettings(s); setEditing(false); }} />}
    </section>
  );
};

const SettingsForm: React.FC<{ settings: InvoiceWhatsAppSettings; onSaved: (s: InvoiceWhatsAppSettings) => void }> = ({ settings, onSaved }) => {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [auto, setAuto] = useState(settings.autoSend);
  const [name, setName] = useState(settings.templateName ?? '');
  const [lang, setLang] = useState(settings.templateLanguage);
  const [approved, setApproved] = useState(settings.templateApproved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await generatedInvoicesApi.setWhatsAppSettings({ enabled, autoSend: auto && enabled, templateName: name.trim() || null, templateLanguage: lang.trim() || 'en', templateApproved: approved && !!name.trim() }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3" role="group" aria-label="Invoice WhatsApp settings">
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Allow sending paid invoices by WhatsApp</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={auto && enabled} disabled={!enabled} onChange={e => setAuto(e.target.checked)} /> Send automatically as soon as the paid invoice is ready</label>
      {settings.delivery?.provider === 'BUILDER' && (
        <p className="text-[11px] text-slate-600">
          Messages go through the WhatsApp Automation Builder, where the template is chosen: in the builder, add a route for <b>stage_code = INVOICE_PAID</b> (the event carries the customer, the invoice number, amount, date and a short-lived PDF link). The template fields below are not used for it.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Template name (exactly as registered with the provider)" htmlFor="iwa-template">
          <input id="iwa-template" className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. invoice_paid" maxLength={255} />
        </Field>
        <Field label="Template language" htmlFor="iwa-lang">
          <input id="iwa-lang" className={inputCls} value={lang} onChange={e => setLang(e.target.value)} placeholder="en" maxLength={10} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={approved} disabled={!name.trim()} onChange={e => setApproved(e.target.checked)} /> <span>The provider has approved this template. Nothing is sent through Wabastore until this is ticked.</span></label>
      {error && <ErrorBanner message={error} />}
      <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</button>
    </div>
  );
};
