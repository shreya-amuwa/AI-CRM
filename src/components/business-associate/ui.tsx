import React, { useEffect, useState } from 'react';
import { BA_STAGE_LABELS, type BaContactRow, type BaStage } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';

/** Business Associate workspace: small shared pieces. Buttons, inputs, dialogs and the lead table are the ones the CRM already has. */
export const BA_CHANGED = 'crm:ba-changed';
export const notifyBaChanged = () => window.dispatchEvent(new CustomEvent(BA_CHANGED));

export const STAGE_STYLE: Record<BaStage, string> = {
  NEW: 'bg-sky-50 text-sky-700 ring-sky-200',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  QUOTATION_PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  DEMO_SCHEDULED: 'bg-violet-50 text-violet-700 ring-violet-200',
  SCOPE_PENDING: 'bg-orange-50 text-orange-800 ring-orange-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200'
};
export const StageBadge: React.FC<{ stage: BaStage }> = ({ stage }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ${STAGE_STYLE[stage]}`}>{BA_STAGE_LABELS[stage]}</span>
);

/** Draft or final; an AI draft that nobody has reviewed is marked, because it is not approved just because an AI wrote it. */
export const DocBadge: React.FC<{ status: 'DRAFT' | 'FINAL'; aiGenerated?: boolean; reviewed?: boolean }> = ({ status, aiGenerated, reviewed }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ring-1 ring-inset ${status === 'FINAL' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
      {status === 'FINAL' ? 'Final' : 'Draft'}
    </span>
    {status === 'DRAFT' && aiGenerated && !reviewed && <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">AI draft · not reviewed</span>}
  </span>
);

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n));

/** The Business Associate's assigned contacts (for the client pickers). */
export function useContactOptions() {
  const [items, setItems] = useState<BaContactRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    businessAssociateApi.contacts({ page: 1, pageSize: 100 }).then(r => setItems(r.items), err => (setError(errorMessage(err)), setItems([])));
  }, []);
  return { items, error };
}

/** Open a stored PDF through a short-lived signed link. */
export async function openFile(get: () => Promise<{ url: string }>): Promise<string | null> {
  try {
    const { url } = await get();
    window.open(url, '_blank', 'noopener,noreferrer');
    return null;
  } catch (err) {
    return errorMessage(err);
  }
}

export const LABEL = 'block text-xs font-medium text-slate-600 mb-1';
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
