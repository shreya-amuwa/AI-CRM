import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { LEAD_STATUSES, LEAD_TAG_COLOURS, type LeadStatus, type LeadTag, type LeadTagColour } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { leadTagsApi } from '../../lib/api/leadTags';
import { btn, Card, ErrorBanner, Field, inputCls, LEAD_STATUS_LABEL, selectCls, Spinner } from '../team-member/pipeline/shared';
import { SWATCH, TagChip } from './TagChip';
import { useLeadTags } from './useLeadTags';

/**
 * Lead tags (migration 20270305000100): the Managing Director and the CEOs create tags, choose the lead status each counts as, and retire them.
 * The database decides who may manage which tag; this page hides what a person cannot do and shows the database's refusal inline.
 * `departments` are the departments the person may choose for a tag (the CEO's own, or all for the MD, who may also leave it company-wide).
 */
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const leadsText = (n: number) => `${n} lead${n === 1 ? '' : 's'}`;

/** True from the `sm` breakpoint up: a table there, cards below. */
function useIsWide(): boolean {
  const q = '(min-width: 640px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

export interface LeadTagsPageProps {
  departments: { id: string; name: string }[];
  /** The Managing Director may leave the departments empty: the tag is then company-wide. */
  canCompanyWide: boolean;
}

const TagForm: React.FC<{ tag: LeadTag | null; departments: { id: string; name: string }[]; canCompanyWide: boolean; onClose: () => void; onSaved: () => void }> = ({ tag, departments, canCompanyWide, onClose, onSaved }) => {
  const [label, setLabel] = useState(tag?.label ?? '');
  const [colour, setColour] = useState<LeadTagColour>(tag?.colour ?? 'slate');
  const [stage, setStage] = useState<LeadStatus>(tag?.stage ?? 'NEW');
  const [deptIds, setDeptIds] = useState<string[]>(tag ? tag.departmentIds : (!canCompanyWide && departments.length === 1 ? [departments[0]!.id] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const moves = !!tag && tag.stage !== stage && tag.leadCount > 0;
  const needsDept = !canCompanyWide && deptIds.length === 0 && !tag;
  const toggle = (id: string) => setDeptIds(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!label.trim()) { setError('Give the tag a label.'); return; }
    if (needsDept) { setError('Choose a department for the tag.'); return; }
    setBusy(true);
    setError('');
    try {
      await leadTagsApi.save({ ...(tag ? { id: tag.id } : {}), label: label.trim(), colour, stage, departmentIds: deptIds });
      onSaved();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <Card className="p-4 sm:p-5">
      <form data-testid="tag-form" onSubmit={submit} className="space-y-4" noValidate>
        <h3 className="text-sm font-bold text-slate-900">{tag ? 'Edit tag' : 'New tag'}</h3>
        <Field label="Label" htmlFor="lt-label" required>
          <input id="lt-label" className={inputCls} value={label} maxLength={40} onChange={e => setLabel(e.target.value)} />
        </Field>
        <div>
          <div className="text-xs font-medium text-slate-600 mb-1" id="lt-colour">Colour</div>
          <div role="radiogroup" aria-labelledby="lt-colour" className="flex flex-wrap gap-2">
            {LEAD_TAG_COLOURS.map(c => (
              <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={c} data-testid={`colour-${c}`} onClick={() => setColour(c)}
                className={`h-7 w-7 rounded-full ${SWATCH[c]} ${colour === c ? 'ring-2 ring-offset-2 ring-slate-800' : ''}`} />
            ))}
          </div>
        </div>
        <Field label="Counts as" htmlFor="lt-stage">
          <select id="lt-stage" className={`${selectCls} w-full`} value={stage} disabled={!!tag?.seed} onChange={e => setStage(e.target.value as LeadStatus)}>
            {LEAD_STATUSES.map(s => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        {moves && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">This moves {leadsText(tag!.leadCount)} to {LEAD_STATUS_LABEL[stage]}.</p>}
        <fieldset>
          <legend className="text-xs font-medium text-slate-600 mb-1">Departments</legend>
          {departments.map(d => (
            <label key={d.id} className="flex items-center gap-2 py-1 text-sm text-slate-700">
              <input type="checkbox" checked={deptIds.includes(d.id)} disabled={!!tag?.seed} onChange={() => toggle(d.id)} /> {d.name}
            </label>
          ))}
          <p className="text-[11px] text-slate-500 mt-1">{canCompanyWide ? 'Leave all unticked for a company-wide tag.' : 'Choose the departments you run that may use this tag.'}</p>
        </fieldset>
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Saving…' : 'Save tag'}</button>
        </div>
      </form>
    </Card>
  );
};

export const LeadTagsPage: React.FC<LeadTagsPageProps> = ({ departments, canCompanyWide }) => {
  const { tags, reload, loading, error } = useLeadTags();
  const wide = useIsWide();
  const [editing, setEditing] = useState<LeadTag | 'new' | null>(null);
  const [rowError, setRowError] = useState('');
  const [busyId, setBusyId] = useState('');
  const deptName = (id: string) => departments.find(d => d.id === id)?.name;
  const scopeText = (t: LeadTag) => (t.scope === 'COMPANY' ? 'Company-wide' : t.departmentIds.map(id => deptName(id) ?? 'Another department').join(', ') || 'Departments');

  const retire = async (t: LeadTag) => {
    if (busyId) return;
    setBusyId(t.id);
    setRowError('');
    try { await leadTagsApi.retire(t.id, !t.retired); reload(); } catch (e) { setRowError(errText(e)); } finally { setBusyId(''); }
  };
  const actions = (t: LeadTag) => !t.canManage ? null : (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btn.secondary} data-testid={`tag-edit-${t.id}`} onClick={() => { setRowError(''); setEditing(t); }}>Edit</button>
      {!t.seed && <button type="button" className={btn.danger} data-testid={`tag-retire-${t.id}`} disabled={busyId === t.id} onClick={() => retire(t)}>{t.retired ? 'Restore' : 'Retire'}</button>}
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">Lead tags</h2>
          <p className="text-xs text-slate-500 mt-0.5">Every lead has one tag. A tag counts as one lead status, so the pipeline keeps working whatever you name it.</p>
        </div>
        <button type="button" className={btn.primary} onClick={() => { setRowError(''); setEditing('new'); }}><Plus className="w-4 h-4" /> New tag</button>
      </div>
      {editing && (
        <TagForm key={editing === 'new' ? 'new' : editing.id} tag={editing === 'new' ? null : editing} departments={departments} canCompanyWide={canCompanyWide}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {rowError && <ErrorBanner message={rowError} />}
      {loading && !tags.length ? <Spinner /> : wide ? (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="text-left font-semibold px-4 py-2">Tag</th><th className="text-left font-semibold px-4 py-2">Counts as</th><th className="text-left font-semibold px-4 py-2">Where</th><th className="text-right font-semibold px-4 py-2">Leads</th><th className="px-4 py-2"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tags.map(t => (
                <tr key={t.id} data-testid={`tag-row-${t.id}`}>
                  <td className="px-4 py-2.5 max-w-[14rem]"><TagChip tag={t} />{t.retired && <span className="ml-2 text-[11px] text-slate-500">Retired</span>}</td>
                  <td className="px-4 py-2.5 text-slate-700">{LEAD_STATUS_LABEL[t.stage]}</td>
                  <td className="px-4 py-2.5 text-slate-600">{scopeText(t)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">{t.leadCount}</td>
                  <td className="px-4 py-2.5 text-right">{actions(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tags.length && !loading && <p className="p-6 text-center text-sm text-slate-500">No lead tags yet.</p>}
        </Card>
      ) : (
        <div className="space-y-2">
          {tags.map(t => (
            <Card key={t.id} className="p-3">
              <div data-testid={`tag-card-${t.id}`} className="space-y-2">
                <div className="flex items-center justify-between gap-2"><TagChip tag={t} />{t.retired && <span className="text-[11px] text-slate-500">Retired</span>}</div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-500">Counts as</dt><dd className="text-slate-800 text-right">{LEAD_STATUS_LABEL[t.stage]}</dd>
                  <dt className="text-slate-500">Leads</dt><dd className="text-slate-800 text-right tabular-nums">{t.leadCount}</dd>
                  <dt className="text-slate-500">Where</dt><dd className="text-slate-800 text-right break-words min-w-0">{scopeText(t)}</dd>
                </dl>
                {actions(t)}
              </div>
            </Card>
          ))}
          {!tags.length && !loading && <p className="p-6 text-center text-sm text-slate-500">No lead tags yet.</p>}
        </div>
      )}
    </div>
  );
};

export default LeadTagsPage;
