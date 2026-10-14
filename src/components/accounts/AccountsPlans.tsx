import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { AccountsPlanRequest, AccountsPlans as AccountsPlansData, MonthlyPlan } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { clientWorkApi } from '../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, Field, inputCls, longDate, notifyPipelineChanged, Pill, Spinner, todayIso, usePipelineRealtime, useServiceCatalog, type Tone } from '../team-member/pipeline/shared';
import { rupees } from '../invoices/invoiceShared';

const STATUS: Record<AccountsPlanRequest['status'], { label: string; tone: Tone }> = {
  REQUESTED: { label: 'To verify', tone: 'orange' }, APPROVED: { label: 'Approved - awaiting payment', tone: 'indigo' },
  ACTIVATED: { label: 'Activated', tone: 'green' }, REJECTED: { label: 'Declined', tone: 'red' }, CANCELLED: { label: 'Withdrawn', tone: 'slate' }
};
const KIND = { SELECT: 'New plan', UPGRADE: 'Upgrade', SWITCH: 'Switch' } as const;

/**
 * Accounts: the monthly plans customers can choose in their dashboard, and their plan requests.
 * A plan starts only after Accounts verifies the request AND confirms the payment; nothing recurs automatically.
 */
export const AccountsPlans: React.FC = () => {
  const [data, setData] = useState<AccountsPlansData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(MonthlyPlan & { isActive: boolean }) | 'new' | null>(null);
  const [deciding, setDeciding] = useState<{ request: AccountsPlanRequest; decision: 'REJECT' | 'ACTIVATE' } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    clientWorkApi.plans().then(d => { setData(d); setError(null); }, e => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  const approve = async (r: AccountsPlanRequest) => {
    setBusy(r.id); setError(null);
    try { await clientWorkApi.decidePlanRequest(r.id, { decision: 'APPROVE' }); load(); notifyPipelineChanged(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  };

  if (!data) return error ? <ErrorBanner message={error} onRetry={load} /> : <Spinner label="Loading plans…" />;
  const open = data.requests.filter(r => r.status === 'REQUESTED' || r.status === 'APPROVED');
  const closed = data.requests.filter(r => r.status !== 'REQUESTED' && r.status !== 'APPROVED').slice(0, 15);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Monthly Plans</h1>
        <p className="text-sm text-slate-500">The plans customers can choose in their dashboard, and their requests. A plan starts only after you verify the request and confirm the payment.</p>
      </header>
      {error && <ErrorBanner message={error} onRetry={load} />}

      <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-label="Plan requests">
        <h2 className="font-bold text-slate-900">Plan requests</h2>
        {open.length === 0 ? <p className="mt-3 text-sm text-slate-500">No plan requests waiting.</p> : (
          <ul className="mt-3 divide-y divide-slate-100">
            {open.map(r => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm font-semibold text-slate-900">{r.customer}</p>
                  <p className="text-xs text-slate-600">{KIND[r.kind]}: <b>{r.planName}</b> at {rupees(r.monthlyPrice)} / month{r.currentPlan ? ` (now on ${r.currentPlan})` : ''}</p>
                  {r.note && <p className="text-xs text-slate-500">"{r.note}"</p>}
                  <p className="text-[11px] text-slate-400">Requested {longDate(r.createdAt)}</p>
                </div>
                <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                {r.status === 'REQUESTED' && <button type="button" className={btn.primary} disabled={busy === r.id} onClick={() => approve(r)}>Approve</button>}
                <button type="button" className={btn.green} onClick={() => setDeciding({ request: r, decision: 'ACTIVATE' })}>Payment confirmed - activate</button>
                <button type="button" className={btn.danger} onClick={() => setDeciding({ request: r, decision: 'REJECT' })}>Decline</button>
              </li>
            ))}
          </ul>
        )}
        {closed.length > 0 && (
          <details className="mt-4"><summary className="text-xs font-semibold text-slate-600 cursor-pointer">Earlier requests</summary>
            <ul className="mt-2 text-xs text-slate-600 space-y-1">{closed.map(r => <li key={r.id}>{r.customer} - {r.planName} - {STATUS[r.status].label} ({longDate(r.createdAt)})</li>)}</ul></details>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-label="Plans">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-slate-900">Plans</h2>
          <button type="button" className={btn.primary} onClick={() => setEditing('new')}><Plus className="w-4 h-4" aria-hidden="true" /> Add plan</button>
        </div>
        {data.plans.length === 0 ? (
          <div className="mt-4 text-center text-sm text-slate-500 py-6"><Sparkles className="w-6 h-6 mx-auto text-slate-300" aria-hidden="true" /><p className="mt-2">No plans yet. Customers see none until you add one.</p></div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.plans.map(p => (
              <li key={p.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]"><p className="text-sm font-semibold text-slate-900">{p.name} <span className="text-xs font-mono text-slate-400">{p.code}</span></p>
                  <p className="text-xs text-slate-600">{rupees(p.monthlyPrice)} / month{p.features.length ? ` - ${p.features.join(', ')}` : ''}</p></div>
                <Pill tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Shown to customers' : 'Hidden'}</Pill>
                <button type="button" className={btn.secondary} onClick={() => setEditing(p)}>Edit</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deciding && <DecideDialog {...deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); load(); notifyPipelineChanged(); }} />}
    </div>
  );
};

const PlanDialog: React.FC<{ plan: (MonthlyPlan & { isActive: boolean }) | null; onClose: () => void; onSaved: () => void }> = ({ plan, onClose, onSaved }) => {
  const { items: catalog } = useServiceCatalog();
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [price, setPrice] = useState(plan ? String(plan.monthlyPrice) : '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [features, setFeatures] = useState((plan?.features ?? []).join('\n'));
  const [services, setServices] = useState<string[]>(plan?.services.map(s => s.code) ?? []);
  const [active, setActive] = useState(plan?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const monthlyPrice = Number(price);
    if (!name.trim()) return setError('Enter the plan name.');
    if (!plan && !code.trim()) return setError('Enter a short plan code (for example STANDARD).');
    if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) return setError('Enter the monthly price.');
    setBusy(true); setError(null);
    const body = { name: name.trim(), description: description.trim() || null, monthlyPrice, features: features.split('\n').map(f => f.trim()).filter(Boolean), services, isActive: active };
    try { if (plan) await clientWorkApi.updatePlan(plan.id, body); else await clientWorkApi.createPlan({ ...body, code: code.trim().toUpperCase() }); onSaved(); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Dialog title={plan ? `Edit ${plan.name}` : 'Add a monthly plan'} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Code" htmlFor="pl-code"><input id="pl-code" className={inputCls} value={code} disabled={!!plan} onChange={e => setCode(e.target.value)} placeholder="STANDARD" /></Field>
          <Field label="Name" htmlFor="pl-name" required><input id="pl-name" className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Monthly price (INR)" htmlFor="pl-price" required><input id="pl-price" className={inputCls} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></Field>
        </div>
        <Field label="Short description" htmlFor="pl-desc"><input id="pl-desc" className={inputCls} value={description} onChange={e => setDescription(e.target.value)} /></Field>
        <Field label="What is included (one per line)" htmlFor="pl-feat"><textarea id="pl-feat" className={inputCls} rows={4} value={features} onChange={e => setFeatures(e.target.value)} /></Field>
        <fieldset><legend className="text-xs font-medium text-slate-600 mb-1">Services in this plan (optional)</legend>
          <div className="grid sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2">
            {catalog.map(s => (
              <label key={s.code} className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={services.includes(s.code)} onChange={e => setServices(v => e.target.checked ? [...v, s.code] : v.filter(c => c !== s.code))} /> {s.name}
              </label>
            ))}
          </div></fieldset>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Show this plan to customers</label>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className={btn.secondary} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button></div>
      </div>
    </Dialog>
  );
};

const DecideDialog: React.FC<{ request: AccountsPlanRequest; decision: 'REJECT' | 'ACTIVATE'; onClose: () => void; onDone: () => void }> = ({ request, decision, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [paid, setPaid] = useState(false);
  const [renews, setRenews] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await clientWorkApi.decidePlanRequest(request.id, { decision, note: note.trim() || null, paymentConfirmed: paid, renewsOn: renews || null }); onDone(); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Dialog title={decision === 'ACTIVATE' ? `Activate ${request.planName}` : `Decline ${request.planName}`} description={request.customer} onClose={onClose}>
      <div className="space-y-3">
        {decision === 'ACTIVATE' && (<>
          <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-0.5" checked={paid} onChange={e => setPaid(e.target.checked)} /> I have verified and confirmed the customer's payment of {rupees(request.monthlyPrice)}.</label>
          <Field label="Next renewal date (optional)" htmlFor="pl-renew"><input id="pl-renew" type="date" min={todayIso()} className={inputCls} value={renews} onChange={e => setRenews(e.target.value)} /></Field>
        </>)}
        <Field label={decision === 'REJECT' ? 'Reason (the customer will read this)' : 'Note for the customer (optional)'} htmlFor="pl-note"><textarea id="pl-note" className={inputCls} rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className={btn.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={decision === 'ACTIVATE' ? btn.green : btn.danger} disabled={busy || (decision === 'ACTIVATE' && !paid) || (decision === 'REJECT' && !note.trim())} onClick={go}>{decision === 'ACTIVATE' ? 'Activate plan' : 'Decline request'}</button></div>
      </div>
    </Dialog>
  );
};
