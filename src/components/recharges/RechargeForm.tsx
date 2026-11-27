import React, { useRef, useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import type { RechargeKind, SupportRecharge } from '../../../shared/contracts';
import { RECHARGE_MAX_FILE_BYTES, rechargeBodySchema } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { rechargesApi } from '../../lib/api/endpoints';
import { looksLike } from '../../lib/checklistUpload';
import { uploadToTicket } from '../../lib/uploadToTicket';
import { Dialog, ErrorBanner, Field, btn, inputCls } from '../team-member/pipeline/shared';
import { KIND_LABEL, amountNumber, cleanAmount, rechargeMoney, sumAmounts, todayIndia } from './rechargeParts';

const PROOF_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
const ACCEPT = Object.keys(PROOF_TYPES).map(e => `.${e}`).join(',');
const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12));

interface Shot { id: string; name: string; size: number }

/** Create (existing absent) or edit (existing present) one recharge. The server checks everything again; nothing about the owner or department is sent. */
export const RechargeForm: React.FC<{ kind: RechargeKind; existing?: SupportRecharge; onClose: () => void; onSaved: (r: SupportRecharge) => void }> = ({ kind, existing, onClose, onSaved }) => {
  const [customerName, setCustomerName] = useState(existing?.customerName ?? '');
  const [rechargeDate, setRechargeDate] = useState(existing?.rechargeDate?.slice(0, 10) ?? todayIndia());
  const [gst, setGst] = useState(existing && existing.gstAmount > 0 ? String(existing.gstAmount) : '');
  const [gstDetails, setGstDetails] = useState(existing?.gstDetails ?? '');
  const [non, setNon] = useState(existing && existing.nonGstAmount > 0 ? String(existing.nonGstAmount) : '');
  const [nonDetails, setNonDetails] = useState(existing?.nonGstDetails ?? '');
  const [remarks, setRemarks] = useState(existing?.remarks ?? '');
  const [shot, setShot] = useState<Shot | null>(existing?.screenshot ? { id: existing.screenshot.id, name: existing.screenshot.name, size: existing.screenshot.size } : null);
  const [newShot, setNewShot] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestId = useRef(newRequestId());
  const pick = useRef<HTMLInputElement>(null);
  const total = sumAmounts(gst, non);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    setErrors(e => ({ ...e, screenshot: '' }));
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = PROOF_TYPES[ext];
    if (!mime) { setErrors(e => ({ ...e, screenshot: 'The payment proof must be an image (PNG, JPEG or WebP) or a PDF.' })); return; }
    if (file.size === 0) { setErrors(e => ({ ...e, screenshot: 'This file is empty.' })); return; }
    if (file.size > RECHARGE_MAX_FILE_BYTES) { setErrors(e => ({ ...e, screenshot: 'The file is larger than 5 MB.' })); return; }
    setUploading(true);
    let id: string | null = null;
    try {
      if (!(await looksLike(file, mime))) throw new Error(`${file.name} is not a real ${ext.toUpperCase()} file.`);
      const ticket = await rechargesApi.beginUpload({ fileName: file.name, mimeType: mime, sizeBytes: file.size });
      id = ticket.attachment.id;
      await uploadToTicket(ticket, file, mime);
      const done = await rechargesApi.completeUpload(id);
      id = null;
      setShot({ id: done.id, name: done.name, size: done.size });
      setNewShot(true);
    } catch (e) {
      setErrors(x => ({ ...x, screenshot: errorMessage(e) }));
      if (id) void rechargesApi.abortUpload(id).catch(() => undefined);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploading) return;
    setProblem('');
    const body = {
      customerName, rechargeDate, gstAmount: amountNumber(gst), gstDetails, nonGstAmount: amountNumber(non), nonGstDetails: nonDetails, totalAmount: total, remarks,
      screenshotId: existing && !newShot ? existing.screenshot?.id ?? null : shot?.id ?? null
    };
    const parsed = rechargeBodySchema.safeParse(body);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) { const k = i.path[0] === 'screenshotId' ? 'screenshot' : String(i.path[0] ?? 'form'); next[k] = next[k] ?? i.message; }
    if (!shot) next.screenshot = 'Upload the screenshot of the payment.';
    if (rechargeDate > todayIndia()) next.rechargeDate = 'The recharge date cannot be in the future.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;
    setSaving(true);
    try {
      const saved = existing
        ? await rechargesApi.update(existing.id, { ...parsed.data, screenshotId: newShot ? shot?.id : undefined })
        : await rechargesApi.create(kind, parsed.data, requestId.current);
      onSaved(saved);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const err = (k: string) => errors[k] || undefined;
  return (
    <Dialog title={existing ? `Edit ${KIND_LABEL[kind]} · ${existing.reference}` : `New ${KIND_LABEL[kind]}`} onClose={onClose} size="xl" persistent>
      <form onSubmit={e => void submit(e)} className="space-y-4" noValidate data-testid="recharge-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Customer name" htmlFor="rc-name" required error={err('customerName')}>
            <input id="rc-name" className={inputCls} value={customerName} maxLength={150} autoComplete="off" onChange={e => setCustomerName(e.target.value)} aria-invalid={!!err('customerName')} />
          </Field>
          <Field label="Recharge date" htmlFor="rc-date" required error={err('rechargeDate')}>
            <input id="rc-date" type="date" className={inputCls} value={rechargeDate} max={todayIndia()} onChange={e => setRechargeDate(e.target.value)} aria-invalid={!!err('rechargeDate')} />
          </Field>
          <Field label="GST amount (₹)" htmlFor="rc-gst" error={err('gstAmount')}>
            <input id="rc-gst" className={inputCls} inputMode="decimal" placeholder="0.00" value={gst} onChange={e => setGst(cleanAmount(e.target.value))} aria-invalid={!!err('gstAmount')} />
          </Field>
          <Field label="GST details" htmlFor="rc-gst-d" error={err('gstDetails')}>
            <input id="rc-gst-d" className={inputCls} value={gstDetails} maxLength={500} placeholder="GST invoice no., rate…" onChange={e => setGstDetails(e.target.value)} />
          </Field>
          <Field label="Non-GST amount (₹)" htmlFor="rc-non" error={err('nonGstAmount')}>
            <input id="rc-non" className={inputCls} inputMode="decimal" placeholder="0.00" value={non} onChange={e => setNon(cleanAmount(e.target.value))} aria-invalid={!!err('nonGstAmount')} />
          </Field>
          <Field label="Non-GST details" htmlFor="rc-non-d" error={err('nonGstDetails')}>
            <input id="rc-non-d" className={inputCls} value={nonDetails} maxLength={500} placeholder="Reference, note…" onChange={e => setNonDetails(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2" data-testid="recharge-total">
          <span className="text-xs font-medium text-slate-600">Total recharge amount (GST + non-GST)</span>
          <span className="text-sm font-extrabold text-slate-900">{rechargeMoney(total)}</span>
        </div>
        {errors.totalAmount && <p className="text-[11px] text-rose-600">{errors.totalAmount}</p>}

        <div>
          <span className="block text-xs font-medium text-slate-600 mb-1">Screenshot of the payment<span aria-hidden="true"> *</span></span>
          <input ref={pick} type="file" accept={ACCEPT} hidden data-testid="recharge-file" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn.secondary} onClick={() => pick.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Upload className="w-3.5 h-3.5" aria-hidden />}
              {shot ? 'Replace screenshot' : 'Upload screenshot'}
            </button>
            {shot && (
              <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700">
                <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden /><span className="truncate" title={shot.name}>{shot.name}</span>
                {!existing && <button type="button" onClick={() => setShot(null)} aria-label={`Remove ${shot.name}`}><X className="w-3 h-3" /></button>}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">PNG, JPEG, WebP or PDF, up to 5 MB. It is stored privately; only authorised Support staff can open it.</p>
          {errors.screenshot && <p className="mt-1 text-[11px] text-rose-600" role="alert">{errors.screenshot}</p>}
        </div>

        <Field label="Remarks / notes" htmlFor="rc-rem" error={err('remarks')}>
          <textarea id="rc-rem" className={inputCls} rows={3} maxLength={1000} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </Field>
        {existing?.status === 'REJECTED' && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Saving a corrected recharge sends it back to Pending for checking.</p>}
        {problem && <ErrorBanner message={problem} />}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={saving || uploading}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
            {existing ? 'Save changes' : 'Create recharge'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
