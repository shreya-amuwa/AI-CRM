import React, { useCallback, useEffect, useState } from 'react';
import { History, Loader2, RefreshCw, Save } from 'lucide-react';
import type { HrLetterTemplateState, HrLetterTemplateVersion } from '../../../../shared/contracts';
import type { HrExperienceContent, HrLetterType, HrOfferContent } from '../../../../shared/hrLetters';
import { hrLetterTemplateSaveSchema } from '../../../../shared/validation';
import { hrDocumentsApi } from '../../../lib/api/endpoints';
import { ExperienceWordingEditor, OfferWordingEditor, PlaceholderHelp } from './LetterWordingEditor';

/**
 * The master template of the Offer or Experience Letter. Every HR staff member sees the current wording and its history; only the Super Admin and the
 * HR Admin Head (the database's canEdit) save a new version. A save is always a NEW version on top of the one being edited: if someone else saved in
 * the meantime the database refuses it (CONFLICT), so nobody's change is lost. Letters already issued keep their own wording.
 */
const LABEL: Record<HrLetterType, string> = { OFFER: 'Offer Letter', EXPERIENCE: 'Experience Letter' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^[A-Z_]+:\s*/, '');

export const LetterTemplateManager: React.FC<{ type: HrLetterType; onSuccessToast?: (m: string) => void }> = ({ type, onSuccessToast }) => {
  const [state, setState] = useState<HrLetterTemplateState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<HrOfferContent | HrExperienceContent | null>(null);
  const [note, setNote] = useState('');
  const [viewing, setViewing] = useState<HrLetterTemplateVersion | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null); setConflict(false);
    try {
      const s = await hrDocumentsApi.templateState(type);
      setState(s); setDraft(s.current?.content ?? null); setViewing(null); setNote(''); setError(null);
    } catch (e) { setLoadError(msg(e)); }
  }, [type]);
  useEffect(() => { setState(null); void load(); }, [load]);

  const view = async (version: number) => {
    setError(null);
    try { setViewing(await hrDocumentsApi.templateVersion(type, version)); } catch (e) { setError(msg(e)); }
  };

  const current = state?.current ?? null;
  const changed = !!current && !!draft && JSON.stringify(draft) !== JSON.stringify(current.content);

  const save = async () => {
    if (!current || !draft || saving) return;
    const parsed = hrLetterTemplateSaveSchema.safeParse({ type, content: draft, baseVersion: current.version, note: note.trim() || undefined });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the wording.'); return; }
    setSaving(true); setError(null);
    try {
      const v = await hrDocumentsApi.saveTemplate(type, { content: draft, baseVersion: current.version, note: note.trim() || undefined });
      onSuccessToast?.(`✅ ${LABEL[type]} template saved as version ${v.version}. Letters already issued are not changed.`);
      await load();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.startsWith('CONFLICT')) setConflict(true);
      setError(msg(e));
    } finally { setSaving(false); }
  };

  if (loadError) {
    return (
      <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-sans flex items-center justify-between gap-3">
        <span>{loadError}</span>
        <button type="button" onClick={() => void load()} className="px-3 py-1.5 rounded-xl bg-white border border-rose-200 font-bold">Try again</button>
      </div>
    );
  }
  if (!state) return <div className="p-6 text-xs text-slate-500 font-sans flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading the template…</div>;
  if (!current || !draft) return <div className="p-6 text-xs text-slate-600 font-sans">The {LABEL[type]} template is not set up yet. Run the latest database migration.</div>;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 font-sans" data-testid={`template-manager-${type}`}>
      <section className="xl:col-span-2 bg-white border border-slate-200 rounded-3xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-slate-900">{LABEL[type]} master template</h3>
            <p className="text-[11px] text-slate-500">Current version <b>v{current.version}</b>, saved by {current.createdBy || '–'} on {when(current.createdAt)}.</p>
          </div>
          {!state.canEdit && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">Read only: only the Super Admin and the HR Admin Head edit the template</span>}
        </div>
        <p className="text-[11px] text-slate-600 bg-blue-50 border border-blue-100 rounded-2xl p-3">
          New letters start from this wording. Saving makes a new version; letters already issued keep the wording they were made with.
        </p>
        <PlaceholderHelp type={type} />
        {type === 'OFFER'
          ? <OfferWordingEditor idPrefix="tpl" value={draft as HrOfferContent} onChange={setDraft} disabled={!state.canEdit || saving} />
          : <ExperienceWordingEditor idPrefix="tpl" value={draft as HrExperienceContent} onChange={setDraft} disabled={!state.canEdit || saving} />}
        {state.canEdit && (
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label htmlFor="tpl-note" className="block text-[11px] font-bold text-slate-700">What changed (optional)</label>
            <input id="tpl-note" className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="For example: new probation wording" />
            {error && (
              <div role="alert" className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex flex-wrap items-center justify-between gap-2">
                <span>{error}</span>
                {conflict && <button type="button" onClick={() => void load()} className="font-bold underline flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Load the newest version</button>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void save()} disabled={!changed || saving}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save as version {current.version + 1}
              </button>
              {changed && <button type="button" onClick={() => setDraft(current.content)} disabled={saving} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700">Discard changes</button>}
            </div>
          </div>
        )}
        {!state.canEdit && error && <div role="alert" className="text-[11px] text-rose-700">{error}</div>}
      </section>

      <aside className="bg-white border border-slate-200 rounded-3xl p-5 space-y-3">
        <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5"><History className="w-4 h-4" /> Version history</h4>
        <ul className="space-y-2">
          {state.versions.map(v => (
            <li key={v.version} className={`p-3 rounded-2xl border text-[11px] ${v.version === current.version ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-800">v{v.version}{v.version === current.version ? ' · current' : ''}</span>
                <button type="button" onClick={() => void view(v.version)} className="font-bold text-blue-700 hover:underline" aria-label={`View version ${v.version}`}>View</button>
              </div>
              <div className="text-slate-500">{v.createdBy || '–'} · {when(v.createdAt)}</div>
              {v.note && <div className="text-slate-700 mt-0.5">{v.note}</div>}
            </li>
          ))}
        </ul>
        {viewing && (
          <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50 space-y-2" data-testid="template-version-view">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-800">Version {viewing.version}</span>
              <button type="button" onClick={() => setViewing(null)} className="text-[11px] text-slate-500 hover:underline">Close</button>
            </div>
            {type === 'OFFER'
              ? <OfferWordingEditor idPrefix={`tplv${viewing.version}`} value={viewing.content as HrOfferContent} onChange={() => undefined} disabled />
              : <ExperienceWordingEditor idPrefix={`tplv${viewing.version}`} value={viewing.content as HrExperienceContent} onChange={() => undefined} disabled />}
            {state.canEdit && viewing.version !== current.version && (
              <button type="button" onClick={() => { setDraft(viewing.content); setViewing(null); }} className="text-[11px] font-bold text-blue-700 hover:underline">
                Start from this version (saved as a new version)
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};
