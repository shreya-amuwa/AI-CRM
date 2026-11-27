import React, { useMemo, useState } from 'react';
import { dashboardById, departmentBySlug, improvementRequestSchema, type PreviewViewport } from '../../../shared/dashboardExplorer';
import { dashboardExplorerApi } from '../../lib/api/dashboardExplorer';
import { errorMessage } from '../../lib/api/client';
import { toast } from '../feedback/AppFeedback';
import { Dialog } from '../team-member/pipeline/shared';
import { fieldCls, ghostBtn, primaryBtn } from '../tasks/head/headParts';

/**
 * "Suggest Improvement" from a preview: files a Developer Team issue (Feature request) as the Managing Director, with the previewed position,
 * department, page and screen size captured automatically. This is the Managing Director's own authenticated request from this page - the
 * preview frame itself has no access to the API. The same Zod schema is checked here, on the server and (again) by the database.
 */
export interface SuggestContext { dashboardId: string; department: string; page: string; pageTitle: string; viewport: PreviewViewport }

const BUILD = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APP_VERSION ?? '').slice(0, 80);
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `dx-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// at module level: defined inside the form it would be a new component on every keystroke and the field would lose the cursor
const Field: React.FC<{ id: string; label: string; error?: string; hint?: string; children: React.ReactNode }> = ({ id, label, error, hint, children }) => (
  <div className="space-y-1">
    <label htmlFor={id} className="block text-xs font-semibold text-slate-700">{label}</label>
    {children}
    {hint && !error && <p className="text-[11px] text-slate-500">{hint}</p>}
    {error && <p id={`${id}-error`} className="text-[11px] text-rose-600" role="alert">{error}</p>}
  </div>
);


export const SuggestImprovement: React.FC<{ context: SuggestContext; onClose: () => void; onSent: () => void }> = ({ context, onClose, onSent }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expected, setExpected] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // one id for this form: a double click or a retry after a network error files the request once
  const requestId = useMemo(newRequestId, []);
  const entry = dashboardById(context.dashboardId);
  const dept = departmentBySlug(context.department);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setServerError(null);
    const parsed = improvementRequestSchema.safeParse({ ...context, build: BUILD, title, description, expected, priority, attachmentIds: [], clientRequestId: requestId });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await dashboardExplorerApi.suggest(parsed.data);
      toast.success(res.duplicate ? `Already sent as ${res.reference}.` : `Sent to the CRM Development Team as ${res.reference}.`);
      onSent();
    } catch (err) {
      setServerError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Dialog title="Suggest an improvement" description="Sent to the CRM Development Team as a feature request. You can follow it in Dashboard Explorer." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <dl className="grid grid-cols-2 gap-2 text-xs bg-slate-50 border border-slate-200 rounded-xl p-3" aria-label="Captured automatically">
          <div><dt className="text-slate-500">Position</dt><dd className="font-semibold text-slate-800">{entry?.position ?? context.dashboardId}</dd></div>
          <div><dt className="text-slate-500">Department</dt><dd className="font-semibold text-slate-800">{dept?.name ?? context.department}</dd></div>
          <div><dt className="text-slate-500">Page</dt><dd className="font-semibold text-slate-800 break-words">{context.pageTitle || context.page || 'Not recorded'}</dd></div>
          <div><dt className="text-slate-500">Screen</dt><dd className="font-semibold text-slate-800 capitalize">{context.viewport}</dd></div>
        </dl>
        <Field id="dx-title" label="Improvement title" error={errors.title}>
          <input id="dx-title" className={fieldCls} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'dx-title-error' : undefined} placeholder="Show overdue tickets at the top" />
        </Field>
        <Field id="dx-desc" label="Detailed description" error={errors.description}>
          <textarea id="dx-desc" className={`${fieldCls} !h-28 py-2`} value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'dx-desc-error' : undefined} />
        </Field>
        <Field id="dx-expected" label="Expected behaviour (optional)" error={errors.expected}>
          <textarea id="dx-expected" className={`${fieldCls} !h-20 py-2`} value={expected} onChange={e => setExpected(e.target.value)} maxLength={3000} />
        </Field>
        <Field id="dx-priority" label="Priority" hint="Screenshots: attach them to the issue later from the Developer Team's thread (not available in this first version).">
          <select id="dx-priority" className={fieldCls} value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
            <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
          </select>
        </Field>
        {serverError && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={saving}>{saving ? 'Sending…' : 'Send to the Development Team'}</button>
        </div>
      </form>
    </Dialog>
  );
};
