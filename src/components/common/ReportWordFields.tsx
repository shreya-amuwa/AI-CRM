import React, { useLayoutEffect, useRef, useState } from 'react';
import { DAILY_REPORT_FIELDS, countWords, dailyReportProblems, type DailyReportFieldKey } from '../../../shared/validation';

/**
 * THE Daily Report fields of every department (20270308000100, 20270312000100): Work Completed (required, 10 to 150 words), Work Pending (optional, 100)
 * and Additional Note (optional, 50), in this order, with the same counters and messages everywhere. The same rules are checked by the shared schema,
 * the API and the database (private.report_word_limits). Each form keeps its own task section above and its own buttons below.
 */
export type ReportWordValues = Record<DailyReportFieldKey, string>;
export const EMPTY_REPORT_WORDS: ReportWordValues = { workCompleted: '', pendingWork: '', remarks: '' };
/** True when every field is within its maximum (a draft can be saved; Submit stays enabled). */
export const reportWordsWithinLimits = (v: ReportWordValues) => DAILY_REPORT_FIELDS.every(f => countWords(v[f.key]) <= f.maxWords);
/** True when the report can be submitted: Work Completed has at least 10 words and every field is within its maximum. */
export const reportWordsReady = (v: ReportWordValues) => Object.keys(dailyReportProblems(v)).length === 0;

const UI: Record<DailyReportFieldKey, { placeholder: string; hint: string; minRows: number; maxRows: number; wide: boolean }> = {
  workCompleted: { placeholder: 'What did you complete today? Name the tasks, clients or results.', hint: 'Required', minRows: 4, maxRows: 10, wide: true },
  pendingWork: { placeholder: 'What is still open, and what is next?', hint: 'Optional', minRows: 3, maxRows: 6, wide: false },
  remarks: { placeholder: 'Anything else your reviewer should know', hint: 'Optional', minRows: 3, maxRows: 4, wide: false }
};
const LINE_PX = 20;

/** A textarea that grows with its text between minRows and maxRows, then scrolls. */
const GrowingTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows: number; maxRows: number }> = ({ minRows, maxRows, value, className, ...rest }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const padding = 18;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minRows * LINE_PX + padding), maxRows * LINE_PX + padding)}px`;
  }, [value, minRows, maxRows]);
  return <textarea ref={ref} rows={minRows} value={value} className={`${className ?? ''} resize-none leading-5`} {...rest} />;
};

export const ReportWordFields: React.FC<{
  idPrefix: string;
  values: ReportWordValues;
  onChange: (key: DailyReportFieldKey, value: string) => void;
  /** Messages from the server or the form, by field. */
  errors?: Partial<Record<DailyReportFieldKey, string>>;
  disabled?: boolean;
  inputClassName: string;
  /** Show Work Completed's minimum even before the field was left (set by the form once Submit was pressed). */
  showMinimum?: boolean;
  /** The section heading and the line under it (the forms that have their own heading leave them out). */
  heading?: string;
  description?: React.ReactNode;
}> = ({ idPrefix, values, onChange, errors = {}, disabled, inputClassName, showMinimum = false, heading, description }) => {
  const [left, setLeft] = useState<Partial<Record<DailyReportFieldKey, boolean>>>({});
  return (
    <section className="space-y-3" data-testid="report-word-fields" aria-labelledby={heading ? `${idPrefix}-heading` : undefined}>
      {heading ? (
        <header>
          <h3 id={`${idPrefix}-heading`} className="text-sm font-bold text-slate-900">{heading}</h3>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </header>
      ) : null}
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
        {DAILY_REPORT_FIELDS.map(f => {
          const ui = UI[f.key];
          const n = countWords(values[f.key]);
          const over = n > f.maxWords;
          const short = f.minWords > 0 && n < f.minWords && (showMinimum || !!left[f.key]);
          const id = `${idPrefix}-${f.key}`;
          const message = over ? `${n - f.maxWords} ${n - f.maxWords === 1 ? 'word' : 'words'} over the limit. Shorten it to submit.`
            : short ? `Write at least ${f.minWords} words (${f.minWords - n} more needed).`
            : errors[f.key] || '';
          const invalid = over || short || !!errors[f.key];
          return (
            <div key={f.key} className={ui.wide ? 'md:col-span-2' : ''}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-xs font-semibold text-slate-700">
                  {f.label}{f.minWords > 0 ? <span className="text-rose-600" aria-hidden="true"> *</span> : null}
                </label>
                <span className={`text-[11px] ${f.minWords > 0 ? 'font-medium text-slate-600' : 'text-slate-400'}`}>
                  {f.minWords > 0 ? `${ui.hint} · ${f.minWords}–${f.maxWords} words` : `${ui.hint} · up to ${f.maxWords} words`}
                </span>
              </div>
              <GrowingTextarea id={id} minRows={ui.minRows} maxRows={ui.maxRows} value={values[f.key]} disabled={disabled} maxLength={4000}
                className={`${inputClassName} ${invalid ? '!border-rose-400 focus:!ring-rose-200' : ''}`}
                placeholder={ui.placeholder} aria-required={f.minWords > 0} aria-invalid={invalid}
                aria-describedby={`${id}-count${message ? ` ${id}-msg` : ''}`} data-testid={`report-field-${f.key}`}
                onBlur={() => { if (values[f.key].trim()) setLeft(x => ({ ...x, [f.key]: true })); }}
                onChange={e => onChange(f.key, e.target.value)} />
              <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 text-[11px]">
                <span id={`${id}-msg`} role={message ? 'alert' : undefined} className={message ? 'text-rose-700' : ''}>{message}</span>
                <span id={`${id}-count`} aria-live="polite" data-testid={`report-count-${f.key}`}
                  className={`ml-auto tabular-nums ${over ? 'font-semibold text-rose-700' : 'text-slate-400'}`}>
                  {n} / {f.maxWords} words
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
