import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { EXPERIENCE_PLACEHOLDERS, OFFER_PLACEHOLDERS, PLACEHOLDER_HELP, type HrExperienceContent, type HrLetterType, type HrOfferContent } from '../../../../shared/hrLetters';

/**
 * Edits the wording of an Offer or Experience Letter: used for ONE letter (HrDocumentStudio, before it is generated) and for the master template
 * (LetterTemplateManager, saved as a new version). {placeholders} are filled with the employee's values when the letter is made; **text** is bold.
 */
const inputCls = 'w-full px-3 py-2 rounded-xl bg-white border border-slate-200 focus:outline-blue-500 text-xs font-sans disabled:bg-slate-50 disabled:text-slate-600';
const labelCls = 'block text-[11px] font-bold text-slate-700 mb-1';

const iconBtn = 'p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed';

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

const TextList: React.FC<{ id: string; label: string; items: string[]; onChange: (v: string[]) => void; rows?: number; max: number; maxItems: number; minItems?: number; disabled?: boolean; addLabel: string }> =
  ({ id, label, items, onChange, rows = 2, max, maxItems, minItems = 0, disabled, addLabel }) => (
    <fieldset className="space-y-1.5">
      <legend className={labelCls}>{label}</legend>
      {items.map((t, i) => (
        <div key={i} className="flex gap-1.5 items-start">
          <label htmlFor={`${id}-${i}`} className="sr-only">{`${label} ${i + 1}`}</label>
          <textarea id={`${id}-${i}`} className={inputCls} rows={rows} maxLength={max} value={t} disabled={disabled} onChange={e => onChange(items.map((x, k) => (k === i ? e.target.value : x)))} />
          {!disabled && (
            <div className="flex flex-col gap-1">
              <button type="button" className={iconBtn} onClick={() => onChange(move(items, i, -1))} disabled={i === 0} aria-label={`Move ${label.toLowerCase()} ${i + 1} up`}><ArrowUp className="w-3 h-3" /></button>
              <button type="button" className={iconBtn} onClick={() => onChange(move(items, i, 1))} disabled={i === items.length - 1} aria-label={`Move ${label.toLowerCase()} ${i + 1} down`}><ArrowDown className="w-3 h-3" /></button>
              <button type="button" className={iconBtn} onClick={() => onChange(items.filter((_, k) => k !== i))} disabled={items.length <= minItems} aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}><Trash2 className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      ))}
      {!disabled && items.length < maxItems && (
        <button type="button" className="text-[11px] font-bold text-blue-700 hover:underline flex items-center gap-1" onClick={() => onChange([...items, ''])}><Plus className="w-3 h-3" /> {addLabel}</button>
      )}
    </fieldset>
  );

const Line: React.FC<{ id: string; label: string; value: string; onChange: (v: string) => void; max: number; disabled?: boolean }> = ({ id, label, value, onChange, max, disabled }) => (
  <div>
    <label htmlFor={id} className={labelCls}>{label}</label>
    <input id={id} className={inputCls} value={value} maxLength={max} disabled={disabled} onChange={e => onChange(e.target.value)} />
  </div>
);

export const PlaceholderHelp: React.FC<{ type: HrLetterType }> = ({ type }) => (
  <details className="text-[11px] text-slate-600 font-sans">
    <summary className="cursor-pointer font-bold text-slate-700">Placeholders you can use</summary>
    <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
      {(type === 'OFFER' ? OFFER_PLACEHOLDERS : EXPERIENCE_PLACEHOLDERS).map(p => <li key={p}><code className="text-blue-700">{`{${p}}`}</code> {PLACEHOLDER_HELP[p]}</li>)}
    </ul>
    <p className="mt-1">Write <code>**text**</code> to print it in bold.</p>
  </details>
);

export const OfferWordingEditor: React.FC<{ value: HrOfferContent; onChange: (v: HrOfferContent) => void; disabled?: boolean; idPrefix: string }> = ({ value: c, onChange, disabled, idPrefix }) => {
  const set = <K extends keyof HrOfferContent>(k: K, v: HrOfferContent[K]) => onChange({ ...c, [k]: v });
  return (
    <div className="space-y-3">
      <Line id={`${idPrefix}-subject`} label="Subject" value={c.subject} onChange={v => set('subject', v)} max={200} disabled={disabled} />
      <Line id={`${idPrefix}-salutation`} label="Salutation" value={c.salutation} onChange={v => set('salutation', v)} max={120} disabled={disabled} />
      <TextList id={`${idPrefix}-para`} label="Paragraphs" items={c.paragraphs} onChange={v => set('paragraphs', v)} rows={3} max={1500} maxItems={6} minItems={1} disabled={disabled} addLabel="Add a paragraph" />
      <Line id={`${idPrefix}-resp-h`} label="Responsibilities heading" value={c.responsibilitiesHeading} onChange={v => set('responsibilitiesHeading', v)} max={60} disabled={disabled} />
      <TextList id={`${idPrefix}-resp`} label="Responsibilities" items={c.responsibilities} onChange={v => set('responsibilities', v)} rows={1} max={300} maxItems={15} disabled={disabled} addLabel="Add a responsibility" />
      <Line id={`${idPrefix}-terms-h`} label="Employment terms heading" value={c.termsHeading} onChange={v => set('termsHeading', v)} max={60} disabled={disabled} />
      <fieldset className="space-y-1.5">
        <legend className={labelCls}>Employment terms</legend>
        {c.terms.map((t, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <label htmlFor={`${idPrefix}-term-l-${i}`} className="sr-only">{`Term ${i + 1} name`}</label>
            <input id={`${idPrefix}-term-l-${i}`} className={`${inputCls} !w-2/5`} value={t.label} maxLength={60} disabled={disabled} onChange={e => set('terms', c.terms.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
            <label htmlFor={`${idPrefix}-term-v-${i}`} className="sr-only">{`Term ${i + 1} value`}</label>
            <input id={`${idPrefix}-term-v-${i}`} className={inputCls} value={t.value} maxLength={200} disabled={disabled} onChange={e => set('terms', c.terms.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} />
            {!disabled && (
              <>
                <button type="button" className={iconBtn} onClick={() => set('terms', move(c.terms, i, -1))} disabled={i === 0} aria-label={`Move term ${i + 1} up`}><ArrowUp className="w-3 h-3" /></button>
                <button type="button" className={iconBtn} onClick={() => set('terms', c.terms.filter((_, k) => k !== i))} disabled={c.terms.length <= 1} aria-label={`Remove term ${i + 1}`}><Trash2 className="w-3 h-3" /></button>
              </>
            )}
          </div>
        ))}
        {!disabled && c.terms.length < 15 && (
          <button type="button" className="text-[11px] font-bold text-blue-700 hover:underline flex items-center gap-1" onClick={() => set('terms', [...c.terms, { label: '', value: '' }])}><Plus className="w-3 h-3" /> Add a term (for example Work Location)</button>
        )}
      </fieldset>
      <TextList id={`${idPrefix}-closing`} label="Closing paragraphs" items={c.closing} onChange={v => set('closing', v)} rows={2} max={600} maxItems={4} disabled={disabled} addLabel="Add a closing paragraph" />
      <Line id={`${idPrefix}-signoff`} label="Sign-off" value={c.signOff} onChange={v => set('signOff', v)} max={80} disabled={disabled} />
      <Line id={`${idPrefix}-acc-h`} label="Acceptance heading" value={c.acceptanceHeading} onChange={v => set('acceptanceHeading', v)} max={60} disabled={disabled} />
      <div>
        <label htmlFor={`${idPrefix}-acc`} className={labelCls}>Acceptance text</label>
        <textarea id={`${idPrefix}-acc`} className={inputCls} rows={3} maxLength={800} value={c.acceptance} disabled={disabled} onChange={e => set('acceptance', e.target.value)} />
      </div>
    </div>
  );
};

export const ExperienceWordingEditor: React.FC<{ value: HrExperienceContent; onChange: (v: HrExperienceContent) => void; disabled?: boolean; idPrefix: string }> = ({ value: c, onChange, disabled, idPrefix }) => (
  <div className="space-y-3">
    <Line id={`${idPrefix}-greeting`} label="Greeting" value={c.greeting} onChange={v => onChange({ ...c, greeting: v })} max={120} disabled={disabled} />
    <TextList id={`${idPrefix}-para`} label="Paragraphs" items={c.paragraphs} onChange={v => onChange({ ...c, paragraphs: v })} rows={3} max={1500} maxItems={6} minItems={1} disabled={disabled} addLabel="Add a paragraph" />
    <Line id={`${idPrefix}-signoff`} label="Closing word" value={c.signOff} onChange={v => onChange({ ...c, signOff: v })} max={60} disabled={disabled} />
  </div>
);
