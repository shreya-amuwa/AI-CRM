import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BellPlus } from 'lucide-react';
import type { ZodError } from 'zod';
import {
  ADS_NOTICE_CATEGORIES, ADS_NOTICE_CATEGORY_LABELS, ADS_NOTICE_STATUSES, ADS_NOTICE_STATUS_LABELS, ADS_PRIORITIES, ADS_PRIORITY_LABELS,
  type AdsNotice, type AdsNoticeCategory, type AdsNoticeStatus, type AdsPriority
} from '../../../shared/contracts';
import { adsNoticeCreateSchema } from '../../../shared/validation';
import { notifyAdsChanged, takePendingAds, useOpenAdsRequest } from './adsEvents';
import {
  aiDesignStudioApi, Card, CardHead, ClientSelect, EmptyState, ErrorLine, errorMessage, fieldCls, FormField, fmtDateTime, Flash, ghostBtn, isMember, LoadingLine,
  NoticeStatusBadge, PriorityBadge, primaryBtn, Tabs, textareaCls, useAdsData, useAdsSession, ROLE_TITLE
} from './adsUi';

type StatusFilter = 'ALL' | AdsNoticeStatus;

interface NoticeForm { clientId: string; title: string; category: AdsNoticeCategory; description: string; priority: AdsPriority; assignedTo: string }
const EMPTY_FORM: NoticeForm = { clientId: '', title: '', category: 'IMPORTANT', description: '', priority: 'MEDIUM', assignedTo: '' };

function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const key = String(i.path[0] ?? 'form');
    if (!out[key]) out[key] = i.message;
  }
  return out;
}

/** The status moves that make sense from where a notice is now (the database still decides who may do them). */
const ACTIONS: Record<AdsNoticeStatus, { to: AdsNoticeStatus; label: string }[]> = {
  OPEN: [{ to: 'ACKNOWLEDGED', label: 'Acknowledge' }, { to: 'RESOLVED', label: 'Resolve' }],
  ACKNOWLEDGED: [{ to: 'RESOLVED', label: 'Resolve' }, { to: 'OPEN', label: 'Reopen' }],
  RESOLVED: [{ to: 'OPEN', label: 'Reopen' }]
};

/** Client Notice: communication and important updates about AI Design Studio clients. */
export const AdsClientNotices: React.FC = () => {
  const { ctx, people } = useAdsSession();
  const member = isMember(ctx);
  const [form, setForm] = useState<NoticeForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [filterClient, setFilterClient] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(() => takePendingAds('ads_notice'));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const clientsData = useAdsData(() => aiDesignStudioApi.clients(), []);
  const { data: notices, loading, error, reload } = useAdsData(
    () => aiDesignStudioApi.notices({ clientId: filterClient || undefined, status: status === 'ALL' ? undefined : status }),
    [filterClient, status]
  );

  useOpenAdsRequest(useCallback(d => { if (d.entityType === 'ads_notice') setHighlight(takePendingAds('ads_notice') ?? d.id ?? null); }, []));
  // a notification opened this page on one notice: show it in full and bring it into view
  useEffect(() => {
    if (!highlight || !notices) return;
    setExpanded(prev => new Set(prev).add(highlight));
    document.getElementById(`ads-notice-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, notices]);

  const clients = clientsData.data || [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    setFlash(null);
    const parsed = adsNoticeCreateSchema.safeParse({ ...form, assignedTo: member ? undefined : form.assignedTo });
    if (!form.clientId) { setErrors({ ...(parsed.success ? {} : fieldErrors(parsed.error)), clientId: 'Choose a client.' }); setServerError(null); return; }
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); setServerError(null); return; }
    setErrors({});
    setServerError(null);
    busy.current = true;
    setSaving(true);
    try {
      const created = await aiDesignStudioApi.createNotice(parsed.data);
      setForm({ ...EMPTY_FORM, clientId: form.clientId });
      setFlash(`Notice "${created.title}" was published. The people working on ${created.clientName || 'the client'} have been notified.`);
      reload();
      notifyAdsChanged();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const move = async (n: AdsNotice, to: AdsNoticeStatus) => {
    if (actingId) return;
    setActionError(null);
    setActingId(n.id);
    try {
      await aiDesignStudioApi.noticeStatus(n.id, to);
      reload();
      notifyAdsChanged();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActingId(null);
    }
  };

  const toggle = (id: string) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-slate-900">Client Notice</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">Instructions, feedback, revisions, approvals and delivery updates from your clients. Publishing a notice tells the people working on that client.</p>
      </div>

      <Card label="New notice">
        <CardHead title="New notice" hint="Choose one of your clients and say what changed." />
        <form onSubmit={submit} noValidate className="px-5 pb-5 space-y-4" aria-label="New client notice">
          <Flash text={flash} onClose={() => setFlash(null)} />
          <ErrorLine message={serverError} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Client" htmlFor="ads-notice-client" required error={errors.clientId}>
              <ClientSelect id="ads-notice-client" value={form.clientId} onChange={v => setForm({ ...form, clientId: v })} clients={clients} disabled={saving} invalid={!!errors.clientId} />
              {!clientsData.loading && clients.length === 0 && !clientsData.error && <p className="text-xs text-slate-500 mt-1">You have no clients yet. Add one on the Client Add page first.</p>}
            </FormField>
            <FormField label="Notice Title" htmlFor="ads-notice-title" required error={errors.title}>
              <input id="ads-notice-title" className={fieldCls} value={form.title} maxLength={200} disabled={saving} aria-invalid={!!errors.title}
                aria-describedby={errors.title ? 'ads-notice-title-error' : undefined} onChange={e => setForm({ ...form, title: e.target.value })} />
            </FormField>
            <FormField label="Category" htmlFor="ads-notice-category" error={errors.category}>
              <select id="ads-notice-category" className={fieldCls} value={form.category} disabled={saving} onChange={e => setForm({ ...form, category: e.target.value as AdsNoticeCategory })}>
                {ADS_NOTICE_CATEGORIES.map(c => <option key={c} value={c}>{ADS_NOTICE_CATEGORY_LABELS[c]}</option>)}
              </select>
            </FormField>
            <FormField label="Priority" htmlFor="ads-notice-priority" error={errors.priority}>
              <select id="ads-notice-priority" className={fieldCls} value={form.priority} disabled={saving} onChange={e => setForm({ ...form, priority: e.target.value as AdsPriority })}>
                {ADS_PRIORITIES.map(p => <option key={p} value={p}>{ADS_PRIORITY_LABELS[p]}</option>)}
              </select>
            </FormField>
            <FormField label="Notice Description" htmlFor="ads-notice-description" required error={errors.description} className="sm:col-span-2">
              <textarea id="ads-notice-description" rows={4} className={textareaCls} value={form.description} maxLength={4000} disabled={saving} aria-invalid={!!errors.description}
                aria-describedby={errors.description ? 'ads-notice-description-error' : undefined} onChange={e => setForm({ ...form, description: e.target.value })} />
            </FormField>
            {!member && (
              <FormField label="Assign to (optional)" htmlFor="ads-notice-assignee" error={errors.assignedTo} hint="The person who should act on this notice." className="sm:col-span-2">
                <select id="ads-notice-assignee" className={fieldCls} value={form.assignedTo} disabled={saving} onChange={e => setForm({ ...form, assignedTo: e.target.value })}>
                  <option value="">Nobody in particular</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name} · {ROLE_TITLE[p.role]}</option>)}
                </select>
              </FormField>
            )}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" className={ghostBtn} disabled={saving} onClick={() => { setForm(EMPTY_FORM); setErrors({}); setServerError(null); }}>Clear</button>
            <button type="submit" className={primaryBtn} disabled={saving}><BellPlus className="w-4 h-4" /> {saving ? 'Publishing…' : 'Publish notice'}</button>
          </div>
        </form>
      </Card>

      <Card label="Notices">
        <CardHead title="Notices" hint="Notices about the clients you may see, newest first." />
        <div className="px-5 pb-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64">
              <label htmlFor="ads-notice-filter-client" className="sr-only">Filter by client</label>
              <select id="ads-notice-filter-client" className={fieldCls} value={filterClient} onChange={e => setFilterClient(e.target.value)}>
                <option value="">All clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.clientName}{c.companyName ? ` · ${c.companyName}` : ''}</option>)}
              </select>
            </div>
            <Tabs<StatusFilter>
              label="Filter notices by status"
              value={status}
              onChange={setStatus}
              options={[{ id: 'ALL', label: 'All' }, ...ADS_NOTICE_STATUSES.map(s => ({ id: s, label: ADS_NOTICE_STATUS_LABELS[s] }))]}
            />
          </div>
          <ErrorLine message={actionError} />
          <ErrorLine message={error} onRetry={reload} />
          {loading && !notices ? <LoadingLine /> : notices && notices.length === 0 ? (
            <EmptyState
              title={filterClient || status !== 'ALL' ? 'No notice matches these filters.' : 'No notices yet.'}
              hint={filterClient || status !== 'ALL' ? 'Choose another client or status.' : 'When a client sends feedback or a change, publish it here with the form above.'}
            />
          ) : notices ? (
            <ul className="space-y-3">
              {notices.map(n => {
                const open = expanded.has(n.id);
                return (
                  <li key={n.id} id={`ads-notice-${n.id}`} className={`rounded-2xl border p-4 ${highlight === n.id ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-extrabold text-slate-900 break-words">{n.title}</h3>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {n.clientName || 'Client'} · {ADS_NOTICE_CATEGORY_LABELS[n.category]} · {fmtDateTime(n.createdAt)} · by {n.createdByName || 'someone'}
                          {n.assignedToName ? ` · assigned to ${n.assignedToName}` : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <PriorityBadge priority={n.priority} />
                        <NoticeStatusBadge status={n.status} />
                      </div>
                    </div>
                    <p className={`text-[13px] text-slate-700 mt-2 whitespace-pre-wrap break-words ${open ? '' : 'line-clamp-2'}`}>{n.description}</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button type="button" className={`${ghostBtn} !h-8 !px-3 !text-xs`} aria-expanded={open} onClick={() => toggle(n.id)}>{open ? 'Show less' : 'Show more'}</button>
                      {ACTIONS[n.status].map(a => (
                        <button key={a.to} type="button" className={`${ghostBtn} !h-8 !px-3 !text-xs`} disabled={actingId !== null} onClick={() => void move(n, a.to)}>
                          {actingId === n.id ? 'Saving…' : a.label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </Card>
    </div>
  );
};
