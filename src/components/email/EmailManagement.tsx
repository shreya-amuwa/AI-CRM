import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Mail, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import type { EmailHistoryItem, EmailHistoryPage, EmailOverview, EmailProviderCheck, EmailRule, EmailRulePreview, EmailSettings, EmailSuppression, Profile } from '../../../shared/contracts';
import { EMAIL_APPLICATIONS, EMAIL_CATEGORIES, EMAIL_RULE_TARGETS, EMAIL_SENSITIVE_CATEGORIES } from '../../../shared/validation';
import { emailApi, usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { useDepartments } from '../../context/DepartmentContext';

/**
 * Super Admin → Email Management (migration 20270130000100). Real data only: provider state comes from real accepted e-mails, provider
 * answers and on-request checks; "Accepted" means the provider took the e-mail (delivery is confirmed only by its webhook event).
 * No key, message body, link or code is ever shown. Authentication and credential e-mails can never be copied (enforced by the server).
 */
const card = 'rounded-2xl border border-slate-200 bg-white p-4 space-y-3';
const btn = 'inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${btn} bg-blue-700 text-white hover:bg-blue-800`;
const secondary = `${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const field = 'h-9 px-2 rounded-xl border border-slate-200 text-sm bg-white';
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never';
const label = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
const SENSITIVE = EMAIL_SENSITIVE_CATEGORIES as readonly string[];
const PROVIDER_NAME: Record<string, string> = { resend: 'Resend', ses: 'Amazon SES', smtp: 'SMTP mailbox', brevo: 'Brevo' };
const EXCLUDED: Record<string, string> = { NOT_CONFIGURED: 'credentials not set', SES_NOT_APPROVED: 'waiting for AWS production access (EMAIL_SES_PRODUCTION_ENABLED is off)', FALLBACK_OFF: 'fallback switched off' };
const STATUS_TONE: Record<string, string> = {
  ACCEPTED: 'bg-blue-50 text-blue-800 border-blue-200', DELIVERY_CONFIRMED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BOUNCED: 'bg-red-50 text-red-800 border-red-200', COMPLAINED: 'bg-red-50 text-red-800 border-red-200', FAILED: 'bg-red-50 text-red-800 border-red-200',
  UNKNOWN_ACCEPTANCE: 'bg-amber-50 text-amber-800 border-amber-200', RETRY_PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  DEFERRED: 'bg-amber-50 text-amber-800 border-amber-200', SUPPRESSED: 'bg-slate-100 text-slate-700 border-slate-200'
};
const Note: React.FC<{ n: { ok: boolean; text: string } | null }> = ({ n }) =>
  n ? <p role={n.ok ? 'status' : 'alert'} className={`text-sm ${n.ok ? 'text-emerald-700' : 'text-red-700'}`}>{n.text}</p> : null;

type Tab = 'overview' | 'providers' | 'senders' | 'rules' | 'history' | 'failures' | 'usage';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'providers', label: 'Email Providers' }, { id: 'senders', label: 'Sender Addresses' },
  { id: 'rules', label: 'CC/BCC Rules' }, { id: 'history', label: 'Email History' }, { id: 'failures', label: 'Delivery Failures' }, { id: 'usage', label: 'Usage & Limits' }
];

// ---------------------------------------------------------------------------
const Overview: React.FC<{ o: EmailOverview }> = ({ o }) => {
  const t = o.today;
  const resend = o.providers.find(p => p.provider === 'resend');
  const tiles: [string, number | string, string?][] = [
    ['Submitted today', t.submitted], ['Accepted today', t.accepted], ['Delivery confirmed', t.deliveryConfirmed], ['Failed', t.failed, t.failed ? 'text-red-700' : ''],
    ['Bounced', t.bounced, t.bounced ? 'text-red-700' : ''], ['Complaints', t.complained, t.complained ? 'text-red-700' : ''], ['Outcome unknown', t.unknown, t.unknown ? 'text-amber-700' : ''],
    ['Waiting to retry', t.retryPending, t.retryPending ? 'text-amber-700' : ''], ['Sent by a fallback', t.fallbacks], ['Suppressed addresses', o.suppressions]
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {tiles.map(([k, v, tone]) => <div key={k} className={card}><span className={`block text-2xl font-extrabold ${tone || 'text-slate-900'}`}>{v}</span><span className="text-xs text-slate-600">{k}</span></div>)}
      </div>
      <section className={card} aria-label="Sending now">
        <h2 className="text-sm font-extrabold">Sending now</h2>
        <p className="text-sm">Provider order: <span className="font-semibold">{o.diagnostics.route.map(p => PROVIDER_NAME[p]).join(' → ') || 'none — e-mail is not configured'}</span>
          {o.settings.providerOrder ? ' (Super Admin order)' : ''}</p>
        {o.diagnostics.excluded.map(x => <p key={x.provider} className="text-xs text-slate-600">{PROVIDER_NAME[x.provider]} not used: {EXCLUDED[x.reason] ?? x.reason}</p>)}
        <p className="text-xs text-slate-600">Resend today: {resend?.usedToday ?? 0} of {o.settings.resendDailyLimit} (counted by the CRM){resend?.reportedDaily ? ` · Resend reports ${resend.reportedDaily} today, ${resend.reportedMonthly ?? '?'} this month (${when(resend.reportedAt)})` : ''}</p>
        <p className="text-xs text-slate-600">Delivery events received in 24 h: {o.webhookEvents24h} · last {when(o.lastWebhookAt)}{o.diagnostics.resendWebhookSecret ? '' : ' · RESEND_WEBHOOK_SECRET is not set, so delivery cannot be confirmed'}</p>
      </section>
      <p className="text-xs text-slate-500">"Accepted" means the provider took the e-mail; "Delivery confirmed" needs the provider's own delivery event. Message contents are never stored.</p>
    </div>
  );
};

// ---------------------------------------------------------------------------
const Providers: React.FC<{ o: EmailOverview }> = ({ o }) => {
  const [checks, setChecks] = useState<Record<string, EmailProviderCheck>>({});
  const [busy, setBusy] = useState('');
  const d = o.diagnostics;
  const run = async (p: 'resend' | 'ses' | 'smtp') => {
    setBusy(p);
    try { const c = await emailApi.checkProvider(p); setChecks(x => ({ ...x, [p]: c })); }
    catch (e) { setChecks(x => ({ ...x, [p]: { provider: p, ok: false, checkedAt: new Date().toISOString(), summary: errorMessage(e), details: {} } })); }
    finally { setBusy(''); }
  };
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {(['resend', 'ses', 'smtp'] as const).map(p => {
        const st = o.providers.find(x => x.provider === p);
        const c = checks[p];
        const inRoute = d.route.includes(p);
        return (
          <section key={p} className={card} aria-label={PROVIDER_NAME[p]} data-testid={`provider-${p}`}>
            <h2 className="flex items-center gap-2 text-sm font-extrabold"><Mail className="w-4 h-4" aria-hidden="true" /> {PROVIDER_NAME[p]}</h2>
            <p className="text-sm">{d.configured[p] ? 'Credentials set' : 'Not configured'} · {inRoute ? `position ${d.route.indexOf(p) + 1} in the order` : 'not used'}</p>
            {p === 'ses' && <p className="text-xs text-slate-600">Region {d.sesRegion ?? '—'}{d.sesRegion && !d.sesRegionExplicit ? ' (default: set SES_REGION explicitly)' : ''} · production sending {d.sesProductionEnabled ? 'enabled' : 'not enabled'}{d.sesConfigurationSet ? ' · configuration set' : ''}</p>}
            {p === 'smtp' && d.smtpHost && <p className="text-xs text-slate-600">Host {d.smtpHost}</p>}
            <p className="text-xs text-slate-600">Last accepted e-mail: {when(st?.lastSuccessAt)}</p>
            {st?.lastErrorAt && <p className="text-xs text-red-700">Last error {when(st.lastErrorAt)}: {label(st.lastErrorCategory ?? 'error')}</p>}
            {st?.pausedUntil && new Date(st.pausedUntil) > new Date() && <p className="text-xs text-amber-700">Paused until {when(st.pausedUntil)} ({label(st.pauseReason ?? '')})</p>}
            {p !== 'smtp' && <p className="text-xs text-slate-600">Accepted today {st?.usedToday ?? 0} · this month {st?.usedMonth ?? 0} (counted by the CRM)</p>}
            <button type="button" className={secondary} disabled={busy === p} onClick={() => void run(p)}>{busy === p ? 'Checking…' : 'Check now'}</button>
            {c && <p className={`text-xs ${c.ok ? 'text-emerald-700' : 'text-red-700'}`} data-testid={`check-${p}`}>{c.ok ? <CheckCircle2 className="inline w-3.5 h-3.5" aria-hidden="true" /> : <XCircle className="inline w-3.5 h-3.5" aria-hidden="true" />} {c.summary} <span className="text-slate-500">({when(c.checkedAt)})</span></p>}
          </section>
        );
      })}
      <p className="md:col-span-3 text-xs text-slate-500">Keys stay Cloudflare secrets and are never shown. The order is set by EMAIL_PROVIDER / EMAIL_PROVIDER_ORDER on the Worker; Usage & Limits can reorder the providers the Worker allows. Amazon SES joins only after EMAIL_SES_PRODUCTION_ENABLED=true (after AWS approves production access).</p>
    </div>
  );
};

// ---------------------------------------------------------------------------
const SENDER_DEFAULTS: Record<string, string> = { AUTH: 'auth', RECRUITMENT: 'careers', INTERVIEW: 'careers', HR: 'hr', SALES: 'sales', SUPPORT: 'support', ACCOUNTS: 'accounts', INVOICE: 'accounts', PAYMENT: 'accounts', TECHNICAL: 'tech', GENERAL: 'no-reply' };
const Senders: React.FC<{ o: EmailOverview; onChange: (o: EmailOverview) => void }> = ({ o, onChange }) => {
  const domain = o.settings.allowedSenderDomains[0] ?? 'amuwa.com';
  const [form, setForm] = useState({ category: 'RECRUITMENT', fromEmail: `careers@${domain}`, fromName: 'Amuwa Careers', replyTo: '', enabled: true });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true); setNote(null);
    try { onChange(await emailApi.saveSender({ ...form, replyTo: form.replyTo || null })); setNote({ ok: true, text: 'Saved.' }); }
    catch (e) { setNote({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  const remove = async (category: string) => {
    try { onChange(await emailApi.deleteSender(category)); } catch (e) { setNote({ ok: false, text: errorMessage(e) }); }
  };
  return (
    <div className="space-y-4">
      <section className={card} aria-label="Sender addresses">
        <h2 className="text-sm font-extrabold">Sender per category</h2>
        <p className="text-xs text-slate-600">Only addresses on {o.settings.allowedSenderDomains.join(', ')} (verified with the provider). A category without its own sender uses the GENERAL sender, else the Worker's EMAIL_FROM ({o.diagnostics.fromEmail}).</p>
        {o.senders.length === 0 ? <p className="text-sm text-slate-500">No sender saved yet.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="pr-3">Category</th><th className="pr-3">From</th><th className="pr-3">Reply-to</th><th className="pr-3">State</th><th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>{o.senders.map(x => (
              <tr key={x.category} className="border-t border-slate-100"><td className="pr-3 py-1">{label(x.category)}</td><td className="pr-3">{x.fromName} &lt;{x.fromEmail}&gt;</td>
                <td className="pr-3">{x.replyTo ?? '—'}</td><td className="pr-3">{x.enabled ? 'on' : 'off'}</td>
                <td><button type="button" className="text-red-700" aria-label={`Remove the ${label(x.category)} sender`} onClick={() => void remove(x.category)}><Trash2 className="w-4 h-4" aria-hidden="true" /></button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <section className={card} aria-label="Add or change a sender">
        <h2 className="text-sm font-extrabold">Add or change</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold">Category
            <select className={`${field} block mt-1 w-full`} value={form.category}
              onChange={e => { const c = e.target.value; setForm(f => ({ ...f, category: c, fromEmail: `${SENDER_DEFAULTS[c] ?? 'no-reply'}@${domain}` })); }}>
              {EMAIL_CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}
            </select></label>
          <label className="text-xs font-semibold">From address<input className={`${field} block mt-1 w-full`} value={form.fromEmail} onChange={e => setForm(f => ({ ...f, fromEmail: e.target.value }))} /></label>
          <label className="text-xs font-semibold">From name<input className={`${field} block mt-1 w-full`} value={form.fromName} onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))} /></label>
          <label className="text-xs font-semibold">Reply-to (optional)<input className={`${field} block mt-1 w-full`} value={form.replyTo} onChange={e => setForm(f => ({ ...f, replyTo: e.target.value }))} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} /> In use</label>
        <div className="flex items-center gap-3"><button type="button" className={primary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save sender'}</button><Note n={note} /></div>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
const TARGET_LABEL: Record<string, string> = {
  CUSTOMER_OWNER: 'The customer\'s owner (sales)', RELATIONSHIP_MANAGER: 'The customer\'s relationship manager', META_VERIFIER: 'The assigned Meta Verifier',
  ACCOUNTS_OWNER: 'The customer\'s Accounts owner', TECHNICAL_CONSULTANT: 'The technical consultant on the customer', RECRUITER: 'The vacancy\'s recruiter',
  PROFILE: 'Named employees', ADDRESS: 'Company mailboxes'
};
const emptyRule = (): Partial<EmailRule> => ({ name: '', category: 'META_VERIFICATION', mode: 'CC', target: 'META_VERIFIER', profileIds: [], addresses: [], priority: 100, enabled: false, application: null, departmentId: null, workflow: null });
const Rules: React.FC<{ o: EmailOverview; onChange: (o: EmailOverview) => void }> = ({ o, onChange }) => {
  const { departments } = useDepartments();
  const [rule, setRule] = useState<Partial<EmailRule>>(emptyRule);
  const [addresses, setAddresses] = useState('');
  const [staff, setStaff] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ id: string; record: string; result: EmailRulePreview | null; error: string }>({ id: '', record: '', result: null, error: '' });
  useEffect(() => { if (rule.target === 'PROFILE' && !staff.length) usersApi.list({ status: 'ACTIVE', pageSize: 200 }).then(p => setStaff(p.items), () => undefined); }, [rule.target, staff.length]);
  const save = async () => {
    setBusy(true); setNote(null);
    try {
      onChange(await emailApi.saveRule({ ...rule, addresses: addresses.split(/[\s,;]+/).filter(Boolean) }));
      setNote({ ok: true, text: 'Saved. A new rule starts switched off: preview it, then switch it on.' }); setRule(emptyRule()); setAddresses('');
    } catch (e) { setNote({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  const toggle = async (r: EmailRule) => { try { onChange(await emailApi.saveRule({ ...r, enabled: !r.enabled })); } catch (e) { setNote({ ok: false, text: errorMessage(e) }); } };
  const remove = async (r: EmailRule) => { try { onChange(await emailApi.deleteRule(r.id)); } catch (e) { setNote({ ok: false, text: errorMessage(e) }); } };
  const runPreview = async (r: EmailRule) => {
    const v = preview.record.trim();
    setPreview(p => ({ ...p, id: r.id, result: null, error: '' }));
    try {
      const isApp = ['RECRUITMENT', 'INTERVIEW'].includes(r.category);
      setPreview(p => ({ ...p, result: null }));
      const result = await emailApi.previewRule(r.id, isApp ? { applicationId: v } : { customerId: v });
      setPreview(p => ({ ...p, id: r.id, result, error: '' }));
    } catch (e) { setPreview(p => ({ ...p, id: r.id, error: errorMessage(e) })); }
  };
  return (
    <div className="space-y-4">
      <section className={card} aria-label="Rules">
        <h2 className="text-sm font-extrabold">Automatic copies</h2>
        <p className="text-xs text-slate-600">Resolved at the moment of sending from the record's live assignments: an employee who left, was suspended or lost the assignment is never copied. Authentication and credential e-mails are never copied, whatever the rules say. At most {o.settings.maxAutoRecipients} automatic recipients per e-mail.</p>
        {o.rules.length === 0 ? <p className="text-sm text-slate-500">No rules yet: nobody is copied automatically.</p> : (
          <ul className="divide-y divide-slate-100">{o.rules.map(r => (
            <li key={r.id} className="py-2 space-y-1" data-testid="email-rule">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{r.name}</span>
                <span className="text-xs text-slate-600">{label(r.category)} → {r.mode} {TARGET_LABEL[r.target] ?? r.target}{r.addresses.length ? ` (${r.addresses.join(', ')})` : ''}{r.profileIds.length ? ` (${r.profileIds.length} employee${r.profileIds.length === 1 ? '' : 's'})` : ''}</span>
                <span className={`text-xs font-bold ${r.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>{r.enabled ? 'on' : 'off'}</span>
                <button type="button" className={secondary} onClick={() => void toggle(r)}>{r.enabled ? 'Switch off' : 'Switch on'}</button>
                <button type="button" className={secondary} onClick={() => void remove(r)} aria-label={`Delete rule ${r.name}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input className={field} placeholder={['RECRUITMENT', 'INTERVIEW'].includes(r.category) ? 'Job application id' : 'Customer id'} aria-label={`Preview ${r.name} with a record id`}
                  value={preview.id === r.id ? preview.record : ''} onChange={e => setPreview({ id: r.id, record: e.target.value, result: null, error: '' })} />
                <button type="button" className={secondary} onClick={() => void runPreview(r)}>Preview recipients</button>
                {preview.id === r.id && preview.error && <span className="text-red-700">{preview.error}</span>}
                {preview.id === r.id && preview.result && (
                  <span data-testid="rule-preview">{preview.result.recipients.length === 0 ? 'Nobody would be copied for this record.'
                    : preview.result.recipients.map(x => `${x.mode} ${x.name ? `${x.name} ` : ''}<${x.email}>`).join(', ')}</span>
                )}
              </div>
            </li>
          ))}</ul>
        )}
        <p className="text-xs text-slate-500">Every change is in Security &amp; Audit Logs (before and after).</p>
      </section>
      <section className={card} aria-label="New rule">
        <h2 className="text-sm font-extrabold">New rule</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-semibold">Name<input className={`${field} block mt-1 w-full`} value={rule.name ?? ''} onChange={e => setRule(r => ({ ...r, name: e.target.value }))} placeholder="Meta Verification → assigned verifier" /></label>
          <label className="text-xs font-semibold">E-mail category
            <select className={`${field} block mt-1 w-full`} value={rule.category} onChange={e => setRule(r => ({ ...r, category: e.target.value }))}>
              {EMAIL_CATEGORIES.filter(c => !SENSITIVE.includes(c)).map(c => <option key={c} value={c}>{label(c)}</option>)}
            </select></label>
          <label className="text-xs font-semibold">Copy as
            <select className={`${field} block mt-1 w-full`} value={rule.mode} onChange={e => setRule(r => ({ ...r, mode: e.target.value as 'CC' | 'BCC' }))}>
              <option value="CC">CC (visible to the recipient)</option><option value="BCC">BCC (hidden, still receives the content)</option>
            </select></label>
          <label className="text-xs font-semibold">Who is copied
            <select className={`${field} block mt-1 w-full`} value={rule.target} onChange={e => setRule(r => ({ ...r, target: e.target.value }))}>
              {EMAIL_RULE_TARGETS.map(t => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
            </select></label>
          <label className="text-xs font-semibold">Application (optional)
            <select className={`${field} block mt-1 w-full`} value={rule.application ?? ''} onChange={e => setRule(r => ({ ...r, application: e.target.value || null }))}>
              <option value="">Any</option>{EMAIL_APPLICATIONS.map(a => <option key={a} value={a}>{label(a)}</option>)}
            </select></label>
          <label className="text-xs font-semibold">Department (optional)
            <select className={`${field} block mt-1 w-full`} value={rule.departmentId ?? ''} onChange={e => setRule(r => ({ ...r, departmentId: e.target.value || null }))}>
              <option value="">Any</option>{departments.map(d => <option key={d.dbId} value={d.dbId}>{d.name}</option>)}
            </select></label>
          <label className="text-xs font-semibold">Priority (1 = first)<input type="number" min={1} max={1000} className={`${field} block mt-1 w-full`} value={rule.priority ?? 100} onChange={e => setRule(r => ({ ...r, priority: Number(e.target.value) }))} /></label>
        </div>
        {rule.target === 'ADDRESS' && <label className="block text-xs font-semibold">Company addresses (comma separated, @{o.settings.allowedSenderDomains.join(' / @')} only)
          <input className={`${field} block mt-1 w-full`} value={addresses} onChange={e => setAddresses(e.target.value)} placeholder={`cto@${o.settings.allowedSenderDomains[0] ?? 'amuwa.com'}`} /></label>}
        {rule.target === 'PROFILE' && (
          <label className="block text-xs font-semibold">Employees (active only)
            <select multiple className="block mt-1 w-full min-h-[8rem] rounded-xl border border-slate-200 text-sm" value={rule.profileIds ?? []}
              onChange={e => setRule(r => ({ ...r, profileIds: Array.from(e.target.selectedOptions).map(o => o.value) }))}>
              {staff.filter(p => p.role !== 'SUPER_ADMIN').map(p => <option key={p.id} value={p.id}>{p.fullName} — {p.email}</option>)}
            </select></label>
        )}
        <div className="flex items-center gap-3"><button type="button" className={primary} disabled={busy || !rule.name} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rule (off)'}</button><Note n={note} /></div>
        <p className="text-xs text-slate-500">Prefer CRM notifications over e-mail copies for broad management visibility. Never copy HR or candidate information to unrelated departments.</p>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
const HistoryRow: React.FC<{ m: EmailHistoryItem; canReview: boolean; onReviewed: () => void }> = ({ m, canReview, onReviewed }) => {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ attempts: { provider: string; outcome: string; errorCategory: string | null; statusCode: number | null; at: string }[]; events: { type: string; bounceType: string | null; at: string }[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (open && !detail) emailApi.historyDetail(m.id).then(setDetail, e => setErr(errorMessage(e))); }, [open, detail, m.id]);
  const review = async (received: boolean) => { try { await emailApi.review(m.id, received); onReviewed(); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <>
      <tr className="border-t border-slate-100 align-top" data-testid="email-history-row">
        <td className="pr-3 py-1 whitespace-nowrap"><button type="button" className="text-blue-700 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{when(m.createdAt)}</button></td>
        <td className="pr-3">{label(m.application)}</td><td className="pr-3">{label(m.category)}</td>
        <td className="pr-3 break-all">{m.recipient}{m.cc.length ? <span className="block text-xs text-slate-500">CC {m.cc.join(', ')}</span> : null}{m.bccCount ? <span className="block text-xs text-slate-500">BCC {m.bcc ? m.bcc.join(', ') : `${m.bccCount} hidden`}</span> : null}</td>
        <td className="pr-3">{m.provider ? PROVIDER_NAME[m.provider] : '—'}{m.fallbackUsed ? <span className="block text-xs text-amber-700">fallback</span> : null}</td>
        <td className="pr-3"><span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-bold ${STATUS_TONE[m.status] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>{label(m.status)}</span>
          {m.errorCategory ? <span className="block text-xs text-slate-500">{label(m.errorCategory)}</span> : null}</td>
      </tr>
      {open && <tr><td colSpan={6} className="pb-2 text-xs bg-slate-50/60">
        {err && <p className="text-red-700">{err}</p>}
        {detail && <>
          <p className="pt-1"><span className="font-semibold">Attempts:</span> {detail.attempts.length ? detail.attempts.map(a => `${PROVIDER_NAME[a.provider] ?? a.provider} ${label(a.outcome)}${a.errorCategory ? ` (${label(a.errorCategory)})` : ''}${a.statusCode ? ` ${a.statusCode}` : ''} ${when(a.at)}`).join(' · ') : 'none'}</p>
          <p><span className="font-semibold">Provider events:</span> {detail.events.length ? detail.events.map(e => `${e.type.replace('email.', '')}${e.bounceType ? ` (${e.bounceType})` : ''} ${when(e.at)}`).join(' · ') : 'none received'}</p>
        </>}
        {canReview && m.status === 'UNKNOWN_ACCEPTANCE' && (
          <p className="pt-1 flex flex-wrap items-center gap-2">The provider did not answer in time, so the CRM does not know whether this went out. Check the provider's log, then:
            <button type="button" className={secondary} onClick={() => void review(true)}>It was sent</button>
            <button type="button" className={secondary} onClick={() => void review(false)}>Not sent — allow sending again</button></p>
        )}
      </td></tr>}
    </>
  );
};

/** The e-mail history: also used outside Email Management (HR and others see what their work allows). */
export const EmailHistory: React.FC<{ problemsOnly?: boolean; canReview?: boolean }> = ({ problemsOnly = false, canReview = false }) => {
  const [f, setF] = useState({ application: '', category: '', status: problemsOnly ? 'PROBLEMS' : '', provider: '', recipient: '', from: '', to: '' });
  const [page, setPage] = useState<EmailHistoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    emailApi.history({ ...f, limit: 50, offset }).then(setPage, e => setError(errorMessage(e)));
  }, [f, offset]);
  useEffect(load, [load]);
  const set = (k: keyof typeof f, v: string) => { setOffset(0); setF(x => ({ ...x, [k]: v })); };
  return (
    <section className={card} aria-label={problemsOnly ? 'Delivery failures' : 'Email history'}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold">Application<select className={`${field} block mt-1`} value={f.application} onChange={e => set('application', e.target.value)}><option value="">All</option>{EMAIL_APPLICATIONS.map(a => <option key={a} value={a}>{label(a)}</option>)}</select></label>
        <label className="text-xs font-semibold">Category<select className={`${field} block mt-1`} value={f.category} onChange={e => set('category', e.target.value)}><option value="">All</option>{EMAIL_CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
        <label className="text-xs font-semibold">Status<select className={`${field} block mt-1`} value={f.status} onChange={e => set('status', e.target.value)}>
          <option value="">All</option><option value="PROBLEMS">Problems (failed, bounced, complained, unknown, suppressed)</option>
          {['ACCEPTED', 'DELIVERY_CONFIRMED', 'DEFERRED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'RETRY_PENDING', 'UNKNOWN_ACCEPTANCE', 'SUPPRESSED'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
        <label className="text-xs font-semibold">Provider<select className={`${field} block mt-1`} value={f.provider} onChange={e => set('provider', e.target.value)}><option value="">All</option>{['resend', 'ses', 'smtp'].map(p => <option key={p} value={p}>{PROVIDER_NAME[p]}</option>)}</select></label>
        <label className="text-xs font-semibold">Recipient<input className={`${field} block mt-1`} value={f.recipient} onChange={e => set('recipient', e.target.value)} /></label>
        <label className="text-xs font-semibold">From<input type="date" className={`${field} block mt-1`} value={f.from} onChange={e => set('from', e.target.value)} /></label>
        <label className="text-xs font-semibold">To<input type="date" className={`${field} block mt-1`} value={f.to} onChange={e => set('to', e.target.value)} /></label>
        <button type="button" className={secondary} onClick={load} aria-label="Reload"><RefreshCw className="w-4 h-4" aria-hidden="true" /></button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!page && !error && <p role="status" className="text-sm text-slate-500">Loading…</p>}
      {page && page.items.length === 0 && <p className="text-sm text-slate-500">No e-mail matches.</p>}
      {page && page.items.length > 0 && (
        <div className="relative overflow-x-auto"><table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="pr-3">When</th><th className="pr-3">Application</th><th className="pr-3">Category</th><th className="pr-3">Recipient</th><th className="pr-3">Provider</th><th>Status</th></tr></thead>
          <tbody>{page.items.map(m => <HistoryRow key={m.id} m={m} canReview={canReview} onReviewed={load} />)}</tbody>
        </table></div>
      )}
      {page && page.total > 50 && (
        <div className="flex items-center gap-2 text-xs"><button type="button" className={secondary} disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - 50))}>Newer</button>
          <span>{offset + 1}–{Math.min(offset + 50, page.total)} of {page.total}</span>
          <button type="button" className={secondary} disabled={offset + 50 >= page.total} onClick={() => setOffset(o => o + 50)}>Older</button></div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
const Suppressions: React.FC = () => {
  const [list, setList] = useState<EmailSuppression[] | null>(null);
  const [form, setForm] = useState({ email: '', note: '' });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { emailApi.suppressions().then(setList, e => setNote({ ok: false, text: errorMessage(e) })); }, []);
  const set = async (email: string, active: boolean, why = '') => {
    try { setList(await emailApi.setSuppression({ email, active, ...(why ? { note: why } : {}) })); setNote({ ok: true, text: active ? 'Suppressed.' : 'Suppression lifted.' }); }
    catch (e) { setNote({ ok: false, text: errorMessage(e) }); }
  };
  return (
    <section className={card} aria-label="Suppressed addresses">
      <h2 className="flex items-center gap-2 text-sm font-extrabold"><ShieldAlert className="w-4 h-4" aria-hidden="true" /> Suppressed addresses</h2>
      <p className="text-xs text-slate-600">A hard bounce or a complaint reported by any provider stops all providers from e-mailing the address. Lift a suppression only when the address is known to work again (audited).</p>
      {list === null ? <p className="text-sm text-slate-500">Loading…</p> : list.length === 0 ? <p className="text-sm text-slate-500">No suppressed address.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">{list.map(x => (
          <li key={x.email} className="py-1 flex flex-wrap items-center gap-2"><span className="font-semibold break-all">{x.email}</span>
            <span className="text-xs text-slate-600">{label(x.reason)} · {x.source} · {when(x.updatedAt)}{x.note ? ` · ${x.note}` : ''}</span>
            {x.active ? <button type="button" className={secondary} onClick={() => void set(x.email, false, 'lifted by the Super Admin')}>Lift</button> : <span className="text-xs text-slate-500">lifted</span>}</li>
        ))}</ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold">Address<input className={`${field} block mt-1`} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></label>
        <label className="text-xs font-semibold">Note<input className={`${field} block mt-1`} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></label>
        <button type="button" className={secondary} disabled={!form.email} onClick={() => void set(form.email, true, form.note)}>Suppress</button>
      </div>
      <Note n={note} />
    </section>
  );
};

// ---------------------------------------------------------------------------
const Usage: React.FC<{ o: EmailOverview; onSaved: () => void }> = ({ o, onSaved }) => {
  const [s, setS] = useState<EmailSettings>(o.settings);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const allowed = useMemo(() => (['resend', 'ses', 'smtp'] as const).filter(p => o.diagnostics.configured[p]), [o.diagnostics]);
  const num = (k: keyof EmailSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setS(x => ({ ...x, [k]: e.target.value === '' ? null : Number(e.target.value) }));
  const save = async () => {
    setBusy(true); setNote(null);
    try { setS(await emailApi.saveSettings({ ...s, updatedAt: undefined } as EmailSettings)); setNote({ ok: true, text: 'Saved.' }); onSaved(); }
    catch (e) { setNote({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  const resend = o.providers.find(p => p.provider === 'resend');
  const pct = (used: number, limit: number) => (limit ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  return (
    <div className="space-y-4">
      <section className={card} aria-label="Usage">
        <h2 className="text-sm font-extrabold">Resend usage</h2>
        {[['Today (UTC day)', resend?.usedToday ?? 0, s.resendDailyLimit], ['This month', resend?.usedMonth ?? 0, s.resendMonthlyLimit]].map(([k, used, limit]) => (
          <div key={k as string} className="text-sm">
            <p>{k}: {used} of {limit} recipients ({pct(used as number, limit as number)}%) — counted by the CRM</p>
            <div className="h-2 rounded bg-slate-100" role="progressbar" aria-valuenow={pct(used as number, limit as number)} aria-valuemin={0} aria-valuemax={100} aria-label={`${k} usage`}>
              <div className="h-2 rounded bg-blue-600" style={{ width: `${pct(used as number, limit as number)}%` }} /></div>
          </div>
        ))}
        <p className="text-xs text-slate-600">{resend?.reportedAt ? `Resend itself reported ${resend.reportedDaily ?? '?'} (day) / ${resend.reportedMonthly ?? '?'} (month) at ${when(resend.reportedAt)}.` : 'Resend has not reported its own count yet.'} The account's real usage includes anything else sent from it, so Resend's own figure is the authority.</p>
      </section>
      <section className={card} aria-label="Limits and routing">
        <h2 className="text-sm font-extrabold">Limits and routing</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-semibold">Resend daily limit<input type="number" min={0} className={`${field} block mt-1 w-full`} value={s.resendDailyLimit} onChange={num('resendDailyLimit')} /></label>
          <label className="text-xs font-semibold">Resend monthly limit<input type="number" min={0} className={`${field} block mt-1 w-full`} value={s.resendMonthlyLimit} onChange={num('resendMonthlyLimit')} /></label>
          <label className="text-xs font-semibold">SES daily limit (empty = from AWS)<input type="number" min={0} className={`${field} block mt-1 w-full`} value={s.sesDailyLimit ?? ''} onChange={num('sesDailyLimit')} /></label>
          <label className="text-xs font-semibold">Kept for sign-in e-mails (per day / month)<input type="number" min={0} className={`${field} block mt-1 w-full`} value={s.criticalReserve} onChange={num('criticalReserve')} /></label>
          <label className="text-xs font-semibold">Max automatic CC/BCC per e-mail<input type="number" min={0} max={20} className={`${field} block mt-1 w-full`} value={s.maxAutoRecipients} onChange={num('maxAutoRecipients')} /></label>
          <label className="text-xs font-semibold">Alert at (%, comma separated)<input className={`${field} block mt-1 w-full`} value={s.quotaThresholds.join(', ')}
            onChange={e => setS(x => ({ ...x, quotaThresholds: e.target.value.split(/[\s,]+/).filter(Boolean).map(Number) }))} /></label>
          <label className="text-xs font-semibold">Sender domains<input className={`${field} block mt-1 w-full`} value={s.allowedSenderDomains.join(', ')}
            onChange={e => setS(x => ({ ...x, allowedSenderDomains: e.target.value.split(/[\s,]+/).filter(Boolean) }))} /></label>
        </div>
        <fieldset className="space-y-1"><legend className="text-xs font-semibold">Provider order</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={s.providerOrder === null} onChange={() => setS(x => ({ ...x, providerOrder: null }))} /> As configured on the Worker ({o.diagnostics.route.map(p => PROVIDER_NAME[p]).join(' → ') || 'none'})</label>
          {allowed.length > 1 && [allowed, [...allowed].reverse()].map(order => (
            <label key={order.join()} className="flex items-center gap-2 text-sm"><input type="radio" checked={s.providerOrder?.join() === order.join()} onChange={() => setS(x => ({ ...x, providerOrder: [...order] }))} /> {order.map(p => PROVIDER_NAME[p]).join(' → ')}</label>
          ))}
          <p className="text-xs text-slate-500">Only providers the Worker has configured and allows are ever used, whatever is chosen here (SES needs EMAIL_SES_PRODUCTION_ENABLED=true).</p>
        </fieldset>
        <div className="flex items-center gap-3"><button type="button" className={primary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button><Note n={note} /></div>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
export const EmailManagement: React.FC = () => {
  const [tab, setTab] = useState<Tab>('overview');
  const [o, setO] = useState<EmailOverview | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { emailApi.overview().then(x => { setO(x); setError(''); }, e => setError(errorMessage(e))); }, []);
  useEffect(load, [load]);
  return (
    <div className="space-y-4" data-testid="email-management">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Email Management</h1>
          <p className="mt-1 text-sm text-slate-600">Providers, senders, automatic copies and the delivery of every e-mail from the CRM, the Candidate Portal and the Client Portal.</p>
        </div>
        <button type="button" className={secondary} onClick={load}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh</button>
      </div>
      <div role="tablist" aria-label="Email Management" className="flex flex-wrap gap-2">
        {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
          className={`px-3.5 h-9 rounded-xl text-sm font-bold border ${tab === t.id ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}`}>{t.label}</button>)}
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {!o && !error && <p role="status" className="text-sm text-slate-500">Loading…</p>}
      {o && tab === 'overview' && <Overview o={o} />}
      {o && tab === 'providers' && <Providers o={o} />}
      {o && tab === 'senders' && <Senders o={o} onChange={setO} />}
      {o && tab === 'rules' && <Rules o={o} onChange={setO} />}
      {tab === 'history' && <EmailHistory canReview />}
      {tab === 'failures' && <div className="space-y-4"><EmailHistory problemsOnly canReview /><Suppressions /></div>}
      {o && tab === 'usage' && <Usage o={o} onSaved={load} />}
    </div>
  );
};

export default EmailManagement;
