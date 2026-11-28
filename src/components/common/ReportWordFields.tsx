import React from 'react';
import { DAILY_REPORT_FIELDS, countWords, type DailyReportFieldKey } from '../../../shared/validation';

/**
 * The three fields of a daily report, every department (20270308000100): Work Completed (150 words), Work Pending (100), Additional Note (50). All optional;
 * each has a live word counter, turns red over its limit and says so. The same limits are checked by the shared schema, the API and the database.
 */
export type ReportWordValues = Record<DailyReportFieldKey, string>;
export const EMPTY_REPORT_WORDS: ReportWordValues = { workCompleted: '', pendingWork: '', remarks: '' };
/** True when every field is within its limit (the form can be submitted). */
export const reportWordsWithinLimits = (v: ReportWordValues) => DAILY_REPORT_FIELDS.every(f => countWords(v[f.key]) <= f.maxWords);

const PLACEHOLDER: Record<DailyReportFieldKey, string> = {
  workCompleted: 'What did you complete today?',
  pendingWork: 'What is still pending?',
  remarks: 'Anything else your reviewer should know'
};

export const ReportWordFields: React.FC<{
  idPrefix: string;
  values: ReportWordValues;
  onChange: (key: DailyReportFieldKey, value: string) => void;
  errors?: Partial<Record<DailyReportFieldKey, string>>;
  disabled?: boolean;
  inputClassName: string;
}> = ({ idPrefix, values, onChange, errors = {}, disabled, inputClassName }) => (
  <div className="space-y-4" data-testid="report-word-fields">
    {DAILY_REPORT_FIELDS.map(f => {
      const n = countWords(values[f.key]);
      const over = n > f.maxWords;
      const id = `${idPrefix}-${f.key}`;
      return (
        <div key={f.key}>
          <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1">{f.label} <span className="font-normal text-slate-400">(optional)</span></label>
          <textarea id={id} rows={f.key === 'remarks' ? 2 : 3} className={inputClassName} value={values[f.key]} disabled={disabled} maxLength={4000}
            placeholder={PLACEHOLDER[f.key]} aria-invalid={over || !!errors[f.key]} aria-describedby={`${id}-count`} data-testid={`report-field-${f.key}`}
            onChange={e => onChange(f.key, e.target.value)} />
          <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs">
            <span id={`${id}-count`} aria-live="polite" data-testid={`report-count-${f.key}`} className={over ? 'font-semibold text-rose-700' : 'text-slate-500'}>
              {n}/{f.maxWords} words{over ? ` · ${n - f.maxWords} over the limit` : ''}
            </span>
            {errors[f.key] && !over ? <span role="alert" className="text-rose-700">{errors[f.key]}</span> : null}
          </div>
        </div>
      );
    })}
  </div>
);
