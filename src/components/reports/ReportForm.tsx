import React, { useId, useMemo, useState } from 'react';
import { Plus, Save, Send, Trash2 } from 'lucide-react';
import type { WorkReportContent, WorkReportDetail } from '../../../shared/contracts';
import { REPORT_FIELDS, type ReportFieldKey, type ReportKind } from '../../../shared/reportFields';
import { reportSaveSchema } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { workReportsApi, type WorkReportForm } from '../../lib/api/workReports';
import { btn, Card, ErrorBanner, Field, inputCls } from '../team-member/pipeline/shared';
import { notifyReportsChanged } from './reportEvents';
import { PeriodBar, presetPeriod, todayIso, type Period } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const TITLES: Record<Exclude<ReportKind, 'MEMBER'>, string> = { TEAM_LEAD: 'My individual report', DEPARTMENT_HEAD: 'My individual report' };
const MAX_LINKS = 5;

/**
 * The report form for a Team Lead's and a Department Head's individual report (the Team Member report has its own, simpler form). The sections come from the shared field list (the server uses the same one), "Save as
 * draft" keeps it private to the author and "Submit report" sends it to the reviewer the database chose (never typed here). A report that
 * was sent back opens in the same form; submitting it again keeps the earlier version in the history.
 */
export const ReportForm: React.FC<{
  kind: Exclude<ReportKind, 'MEMBER'>;
  reportsTo: string[];
  initial?: WorkReportDetail | null;
  onDone: (r: WorkReportDetail, submitted: boolean) => void;
  onCancel?: () => void;
}> = ({ kind, reportsTo, initial, onDone, onCancel }) => {
  const uid = useId();
  const fields = REPORT_FIELDS[kind];
  const [title, setTitle] = useState(initial?.title ?? '');
  const [reportDate, setReportDate] = useState(initial?.reportDate ?? todayIso());
  const [period, setPeriod] = useState<Period>(initial ? { type: initial.periodType, from: initial.periodStart, to: initial.periodEnd } : presetPeriod('TODAY'));
  const [content, setContent] = useState<Partial<Record<ReportFieldKey, string>>>(() => {
    const c: Partial<Record<ReportFieldKey, string>> = {};
    for (const f of fields) c[f.key as ReportFieldKey] = (initial?.content?.[f.key as ReportFieldKey] as string | undefined) ?? '';
    return c;
  });
  const [links, setLinks] = useState<{ name: string; url: string }[]>(() => (initial?.content?.attachments ?? []).map(a => ({ name: a.name ?? '', url: a.url })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const clr = (k: string) => setErrors(x => (x[k] ? { ...x, [k]: '' } : x));

  const body = useMemo((): WorkReportForm => {
    const c: WorkReportContent = {};
    for (const f of fields) { const v = (content[f.key as ReportFieldKey] ?? '').trim(); if (v) c[f.key as ReportFieldKey] = v; }
    const a = links.map(l => ({ name: l.name.trim() || undefined, url: l.url.trim() })).filter(l => l.url);
    if (a.length) c.attachments = a;
    return { title: title.trim(), reportDate, periodType: period.type, periodStart: period.from, periodEnd: period.to, content: c };
  }, [fields, content, links, title, reportDate, period]);

  const validate = (forSubmit: boolean): boolean => {
    const e: Record<string, string> = {};
    const parsed = reportSaveSchema.safeParse(body);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const key = i.path[0] === 'content' ? (i.path[1] === 'attachments' ? 'links' : String(i.path[1])) : String(i.path[0]);
        e[key] ??= i.message;
      }
    }
    if (forSubmit && (body.content.workCompleted ?? '').length < 3) e.workCompleted = 'Describe the work completed before submitting.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const run = async (submit: boolean) => {
    setProblem('');
    setNote('');
    if (!validate(submit)) return;
    setBusy(submit ? 'submit' : 'draft');
    try {
      let saved = savedId ? await workReportsApi.update(savedId, body) : await workReportsApi.create(body);
      setSavedId(saved.id);
      if (submit) saved = await workReportsApi.submit(saved.id);
      notifyReportsChanged();
      if (submit) onDone(saved, true);
      else { setNote('Draft saved. Only you can see it until you submit.'); onDone(saved, false); }
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy('');
    }
  };

  const sentBack = initial?.status === 'REVISION_REQUIRED';
  return (
    <Card className="p-5">
      <form onSubmit={e => { e.preventDefault(); void run(true); }} noValidate className="space-y-4" aria-label={TITLES[kind]}>
        <div>
          <h2 className="text-base font-bold text-slate-900">{initial ? (sentBack ? 'Revise your report' : 'Edit your draft') : TITLES[kind]}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {reportsTo.length > 0 ? <>It goes to <b>{reportsTo.join(', ')}</b> when you submit.</> : 'No reviewer is assigned to you yet; you can save drafts, but submitting needs a reviewer.'}
          </p>
        </div>

        {sentBack && initial?.reviewComment ? (
          <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <b>{initial.reviewedBy ?? 'Your reviewer'} asked for a revision:</b> {initial.reviewComment}
          </div>
        ) : null}
        {problem ? <ErrorBanner message={problem} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Report title" required htmlFor={`${uid}-title`} error={errors.title}>
              <input id={`${uid}-title`} className={inputCls} value={title} maxLength={200} onChange={e => { setTitle(e.target.value); clr('title'); }} aria-invalid={!!errors.title} aria-describedby={errors.title ? `${uid}-title-error` : undefined} />
            </Field>
          </div>
          <Field label="Report date" required htmlFor={`${uid}-date`} error={errors.reportDate}>
            <input id={`${uid}-date`} type="date" className={inputCls} value={reportDate} onChange={e => { setReportDate(e.target.value); clr('reportDate'); }} />
          </Field>
          <div>
            <PeriodBar value={period} onChange={p => { setPeriod(p); clr('periodEnd'); }} />
            {errors.periodEnd ? <p className="mt-1 text-[11px] text-rose-600">{errors.periodEnd}</p> : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(f => {
            const id = `${uid}-${f.key}`;
            const wide = f.key === 'workCompleted' || f.key === 'departmentOverview';
            return (
              <div key={f.key} className={wide ? 'sm:col-span-2' : ''}>
                <Field label={f.label} required={'required' in f && f.required} htmlFor={id} error={errors[f.key]}>
                  <textarea
                    id={id}
                    className={`${inputCls} min-h-24`}
                    value={content[f.key as ReportFieldKey] ?? ''}
                    maxLength={5000}
                    placeholder={f.hint}
                    onChange={e => { setContent(c => ({ ...c, [f.key]: e.target.value })); clr(f.key); }}
                    aria-invalid={!!errors[f.key]}
                    aria-describedby={errors[f.key] ? `${id}-error` : undefined}
                  />
                </Field>
              </div>
            );
          })}
        </div>

        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">Supporting attachments (links)</legend>
          <p className="text-[11px] text-slate-500 mb-2">Add a link to each supporting file (a shared folder, a document or a screenshot). Up to {MAX_LINKS}.</p>
          <div className="space-y-2">
            {links.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <input aria-label={`Attachment ${i + 1} name`} className={inputCls} placeholder="Name (optional)" value={l.name} maxLength={120} onChange={e => setLinks(x => x.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)))} />
                <input aria-label={`Attachment ${i + 1} link`} className={inputCls} placeholder="https://..." value={l.url} maxLength={500} onChange={e => { setLinks(x => x.map((v, j) => (j === i ? { ...v, url: e.target.value } : v))); clr('links'); }} />
                <button type="button" className={btn.secondary} aria-label={`Remove attachment ${i + 1}`} onClick={() => setLinks(x => x.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          {errors.links ? <p className="mt-1 text-[11px] text-rose-600">{errors.links}</p> : null}
          {links.length < MAX_LINKS ? (
            <button type="button" className={`${btn.secondary} mt-2`} onClick={() => setLinks(x => [...x, { name: '', url: '' }])}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a link</button>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={() => void run(false)} disabled={!!busy}><Save className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'draft' ? 'Saving...' : 'Save as draft'}</button>
          <button type="submit" className={btn.primary} disabled={!!busy}><Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'submit' ? 'Submitting...' : sentBack ? 'Resubmit report' : 'Submit report'}</button>
          {onCancel ? <button type="button" className={btn.secondary} onClick={onCancel} disabled={!!busy}>Cancel</button> : null}
          {note ? <span role="status" className="text-xs text-emerald-700">{note}</span> : null}
        </div>
      </form>
    </Card>
  );
};
