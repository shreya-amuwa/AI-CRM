import React, { useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import type { CrocodialLeadActivity } from '../../../shared/contracts';
import { crocodialApi } from '../../lib/api/endpoints';
import { Paged } from '../common/Paged';

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`);
const STATUS: Record<string, string> = {
  LINKED: 'Linked', PROTECTED: 'Linked for reference (past the lead stage: Crocodial changes are not applied)', FAILED: 'Reconciliation failed'
};

/**
 * On a lead's page: what Crocodial knows about it (20270304000100). Shown only for a lead linked to a Crocodial lead; read-only. The caller of a
 * call is the person who made it (not the lead's current owner). Data from a provider outage stays and is labelled with its last sync time.
 */
export const CrocodialLeadActivityCard: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [d, setD] = useState<CrocodialLeadActivity | null>(null);
  useEffect(() => {
    let live = true;
    crocodialApi.leadActivity(customerId).then(x => live && setD(x), () => live && setD(null));
    return () => { live = false; };
  }, [customerId]);
  if (!d || !d.linked) return null;
  const stale = d.lastSyncAt ? Date.now() - new Date(d.lastSyncAt).getTime() > 24 * 3600_000 : true;
  const c = d.calls;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Crocodial activity" data-testid="croc-lead-activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5"><PhoneCall className="w-4 h-4 text-indigo-600" aria-hidden /> Crocodial activity</h3>
        <span className="text-[11px] text-slate-500">Lead #{d.externalLeadId} · last sync {when(d.lastSyncAt)}</span>
      </div>
      {stale && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1" role="status">This data may be stale (no Crocodial sync in the last 24 hours).</p>}
      {d.missingAtSource && <p className="text-xs text-amber-800">Crocodial no longer returns this lead. Nothing was deleted in the CRM.</p>}
      {d.ownershipDiffers && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1" data-testid="croc-owner-differs">Ownership differs: Crocodial assigns it to {d.externalOwnerProfile ?? d.externalOwner ?? 'someone else'}; the CRM owner is {d.crmOwner ?? 'not set'}{d.assignmentMode === 'CRM_OVERRIDE' ? ' (changed in the CRM, kept)' : ''}.</p>}
      {d.reason && !d.ownershipDiffers && <p className="text-xs text-slate-600">{d.reason}</p>}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><dt className="text-[11px] text-slate-500">Crocodial status</dt><dd className="font-semibold text-slate-900">{d.externalStatus ?? '-'}{d.disposition ? <span className="block text-[11px] font-normal text-slate-500">CRM: {d.disposition.replace(/_/g, ' ').toLowerCase()}</span> : null}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Crocodial owner</dt><dd className="font-semibold text-slate-900">{d.externalOwnerProfile ?? d.externalOwner ?? '-'}</dd></div>
        <div><dt className="text-[11px] text-slate-500">CRM owner</dt><dd className="font-semibold text-slate-900">{d.crmOwner ?? '-'}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Link</dt><dd className="text-slate-900">{d.status ? STATUS[d.status] ?? d.status : '-'}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Calls</dt><dd className="font-semibold text-slate-900">{c?.total ?? 0}<span className="block text-[11px] font-normal text-slate-500">{c?.outgoing ?? 0} out · {c?.incoming ?? 0} in · {c?.missed ?? 0} missed</span></dd></div>
        <div><dt className="text-[11px] text-slate-500">Connected (outgoing)</dt><dd className="font-semibold text-slate-900">{c?.connected ?? 0}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Talk time</dt><dd className="font-semibold text-slate-900">{dur(c?.talkSeconds ?? 0)}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Last call</dt><dd className="text-slate-900">{when(c?.lastCallAt)}</dd></div>
      </dl>
      {d.followups && d.followups.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-bold text-slate-800">Follow-ups ({d.followups.length})</summary>
          <ul className="mt-1 space-y-1">{d.followups.map((f, i) => <li key={i} className="text-xs text-slate-700">{when(f.scheduledAt)} · {f.done ? `done ${when(f.completedAt)}` : 'open'}{f.by ? ` · ${f.by}` : ''}{f.note ? ` — ${f.note}` : ''}</li>)}</ul>
        </details>
      )}
      {d.remarks && d.remarks.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-bold text-slate-800">Remarks ({d.remarks.length})</summary>
          <ul className="mt-1 space-y-1">{d.remarks.map((r, i) => <li key={i} className="text-xs text-slate-700 break-words">{when(r.at)}{r.by ? ` · ${r.by}` : ''} — {r.text}</li>)}</ul>
        </details>
      )}
      {d.callHistory && d.callHistory.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-bold text-slate-800">Call history ({d.callHistory.length})</summary>
          <Paged items={d.callHistory} noun="calls">{rows => (
          <ul className="mt-1 space-y-1">{rows.map((h, i) => <li key={i} className="text-xs text-slate-700">{when(h.at)} · {h.type}{h.connected === true ? ' · connected' : h.connected === false ? ' · not connected' : ''} · {dur(h.seconds)}{h.by ? ` · by ${h.by}` : ''}</li>)}</ul>
          )}</Paged>
        </details>
      )}
      {d.ownerHistory && d.ownerHistory.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-bold text-slate-800">Assignment seen by the CRM ({d.ownerHistory.length})</summary>
          <p className="text-[11px] text-slate-500 mt-1">Times are when a sync first saw the assignment; Crocodial does not say who assigned it.</p>
          <Paged items={d.ownerHistory} noun="changes">{rows => (
          <ul className="mt-1 space-y-1">{rows.map((h, i) => <li key={i} className="text-xs text-slate-700">{when(h.observedAt)} · {h.owner ?? 'unassigned'}</li>)}</ul>
          )}</Paged>
        </details>
      )}
    </section>
  );
};
