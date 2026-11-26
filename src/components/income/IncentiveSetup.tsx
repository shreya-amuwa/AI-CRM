import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Square, Trash2 } from 'lucide-react';
import {
  EVENT_LABEL, LEVELS, SCOPE_LABEL, SUB_ROLES, incomeApi, rupees,
  type AmountType, type GivenRow, type IncentiveEvent, type IncentiveOptions, type IncentiveScope, type IncentiveSetupData, type RuleInput, type SetupRule
} from '../../lib/income';
import { PageTitle } from '../layout/shell';
import { confirmAction } from '../feedback/AppFeedback';

/**
 * Incentive setup (20270119000100, 20270121000100; docs/SALES_INCENTIVES.md).
 * - Super Admin: creates, edits, ends and deletes rules, and sets after how many days in the company incentives start.
 * - Operations Head / Department Head / Team Lead: for each sales rule, the amount each person directly below gets (never more than their
 *   own) and the share they keep.
 * - The Sales Department Head: the telecaller / Business Associate split.
 * The database checks every change; its message is shown as it is.
 */
const btn = {
  primary: 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50',
  secondary: 'inline-flex items-center justify-center gap-2 h-10 px-3 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50',
  danger: 'inline-flex items-center justify-center gap-2 h-10 px-3 rounded-xl border border-rose-200 bg-white text-rose-700 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50'
};
const input = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const LEVEL_NAME: Record<string, string> = { DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member', OPERATIONS_HEAD: 'CEO' };

const Panel: React.FC<{ title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }> = ({ title, hint, children, right }) => (
  <section aria-label={title} className="rounded-2xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <div><h2 className="text-sm font-bold text-slate-900">{title}</h2>{hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}</div>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </section>
);
const Alert: React.FC<{ tone: 'error' | 'ok'; children: React.ReactNode }> = ({ tone, children }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{children}</div>
);

export function scopeText(r: Pick<SetupRule, 'scopeType' | 'scopeValue'>, o: IncentiveOptions | null): string {
  const v = r.scopeValue;
  const find = (list: { id: string; name: string }[] | undefined) => list?.find(x => x.id === v)?.name;
  switch (r.scopeType) {
    case 'OPERATIONS_HEAD': return `CEO: ${find(o?.operationsHeads) ?? 'removed'}`;
    case 'LEVEL': return LEVELS.find(l => l.value === v)?.label ?? String(v);
    case 'SUB_ROLE': return SUB_ROLES.find(l => l.value === v)?.label ?? String(v);
    case 'DEPARTMENT': return `Department: ${find(o?.departments) ?? '—'}`;
    case 'TEAM': return `Team: ${find(o?.teams) ?? '—'}`;
    case 'PERSON': return find(o?.people) ?? 'One person';
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Super Admin: the rule form (create and edit)
// ---------------------------------------------------------------------------------------------------------------------------------
interface FormState {
  name: string; eventType: IncentiveEvent; serviceCode: string; amount: string; targetUnits: string; scopeType: IncentiveScope; scopeValue: string; monthlyCap: string;
  /** Support business only (20270222000100): a fixed amount or a percentage of each payment, and the business the month must reach first */
  amountType: AmountType; minMonthlyBusiness: string;
}
const blank: FormState = { name: '', eventType: 'SALE_PAID', serviceCode: '', amount: '', targetUnits: '', scopeType: 'OPERATIONS_HEAD', scopeValue: '', monthlyCap: '', amountType: 'FIXED', minMonthlyBusiness: '' };
/** How a rule pays, in a few words: "₹500 per unit", "₹200 each", "10% of each payment" */
export const amountText = (r: Pick<SetupRule, 'eventType' | 'amount' | 'amountType'>) =>
  r.amountType === 'PERCENT' ? `${r.amount}% of each payment` : `${rupees(r.amount)}${r.eventType === 'SALE_PAID' ? ' per unit' : r.eventType === 'SUPPORT_BUSINESS' ? ' per payment' : ' each'}`;
const fromRule = (r: SetupRule): FormState => ({
  name: r.name, eventType: r.eventType, serviceCode: r.serviceCode ?? '', amount: String(r.amount), targetUnits: r.targetUnits == null ? '' : String(r.targetUnits),
  scopeType: r.scopeType, scopeValue: r.scopeValue ?? '', monthlyCap: r.monthlyCap == null ? '' : String(r.monthlyCap),
  amountType: r.amountType ?? 'FIXED', minMonthlyBusiness: r.minMonthlyBusiness == null ? '' : String(r.minMonthlyBusiness)
});
const toInput = (f: FormState): RuleInput => ({
  name: f.name.trim(), eventType: f.eventType, serviceCode: f.eventType === 'SALE_PAID' ? f.serviceCode || null : null, amount: Number(f.amount),
  targetUnits: f.eventType === 'SALE_PAID' && f.targetUnits ? Number(f.targetUnits) : null,
  scopeType: f.eventType === 'SALE_PAID' ? 'OPERATIONS_HEAD' : f.scopeType, scopeValue: f.scopeValue || null,
  monthlyCap: f.eventType !== 'SALE_PAID' && f.monthlyCap ? Number(f.monthlyCap) : null,
  amountType: f.eventType === 'SUPPORT_BUSINESS' ? f.amountType : 'FIXED',
  minMonthlyBusiness: f.eventType === 'SUPPORT_BUSINESS' && f.minMonthlyBusiness ? Number(f.minMonthlyBusiness) : null
});

const RuleForm: React.FC<{ rule?: SetupRule; options: IncentiveOptions; onCancel: () => void; onSaved: (note: string) => void }> = ({ rule, options, onCancel, onSaved }) => {
  const [f, setF] = useState<FormState>(() => (rule ? fromRule(rule) : blank));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF(x => ({ ...x, [k]: v }));
  const sale = f.eventType === 'SALE_PAID';
  const support = f.eventType === 'SUPPORT_BUSINESS';
  const amountLabel = sale ? 'Amount per unit for the CEO (₹)' : support ? (f.amountType === 'PERCENT' ? 'Percentage of each payment (%)' : 'Amount per payment (₹)') : 'Amount per event (₹)';
  const scopeChoices: { value: string; label: string }[] = useMemo(() => {
    switch (sale ? 'OPERATIONS_HEAD' : f.scopeType) {
      case 'OPERATIONS_HEAD': return options.operationsHeads.map(p => ({ value: p.id, label: p.name }));
      case 'LEVEL': return LEVELS;
      case 'SUB_ROLE': return SUB_ROLES;
      case 'DEPARTMENT': return options.departments.map(d => ({ value: d.id, label: d.name }));
      case 'TEAM': return options.teams.map(t => ({ value: t.id, label: t.name }));
      default: return options.people.map(p => ({ value: p.id, label: p.name }));
    }
  }, [f.scopeType, options, sale]);
  // a rule's current person, Operations Head or product may no longer be listed (left, inactive): keep it selectable so the rule can still be edited
  const withCurrent = (list: { value: string; label: string }[], current: string | null | undefined, sameKind: boolean) =>
    current && sameKind && !list.some(c => c.value === current) ? [...list, { value: current, label: '(current, no longer listed)' }] : list;
  const scopeOptions = withCurrent(scopeChoices, rule?.scopeValue, !!rule && (sale || f.scopeType === rule.scopeType));
  const serviceOptions = withCurrent(options.services.map(s => ({ value: s.code, label: s.name })), rule?.serviceCode, true);
  const sameSale = !!rule && sale && (f.serviceCode || null) === rule.serviceCode && (f.scopeValue || null) === rule.scopeValue;
  // what changes "from now on" (the old version ends, a new one starts): shown before saving
  const replaces = !!rule && (Number(f.amount) !== rule.amount || (sale && (f.serviceCode || null) !== rule.serviceCode)
    || (!sale && f.scopeType !== rule.scopeType) || (f.scopeValue || null) !== rule.scopeValue
    || (support && (f.amountType !== (rule.amountType ?? 'FIXED') || (f.minMonthlyBusiness ? Number(f.minMonthlyBusiness) : null) !== (rule.minMonthlyBusiness ?? null))));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      if (rule) {
        const next = toInput(f);
        const changes: Partial<RuleInput> = sale ? { name: next.name, targetUnits: next.targetUnits } : { name: next.name, monthlyCap: next.monthlyCap };
        if (replaces) Object.assign(changes, { amount: next.amount, serviceCode: next.serviceCode, scopeType: next.scopeType, scopeValue: next.scopeValue },
          support ? { amountType: next.amountType, minMonthlyBusiness: next.minMonthlyBusiness } : {});
        await incomeApi.updateRule(rule.id, changes);
        onSaved(replaces ? 'Saved. The new amount applies from now on; earnings already recorded keep the amount they were earned at.' : 'Saved.');
      } else {
        await incomeApi.createRule(toInput(f));
        onSaved('Rule created.');
      }
    } catch (err) {
      setError(msg(err)); setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label={rule ? 'Edit rule' : 'Create Incentive'} className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm font-medium text-slate-700">Name
          <input className={input} aria-label="Name" value={f.name} maxLength={120} onChange={e => set('name', e.target.value)} required />
        </label>
        <label className="text-sm font-medium text-slate-700">For
          <select className={input} aria-label="For" value={f.eventType} disabled={!!rule} onChange={e => { set('eventType', e.target.value as IncentiveEvent); set('scopeValue', ''); set('amountType', 'FIXED'); set('minMonthlyBusiness', ''); set('scopeType', e.target.value === 'SALE_PAID' ? 'OPERATIONS_HEAD' : e.target.value === 'SUPPORT_BUSINESS' ? 'DEPARTMENT' : 'LEVEL'); }}>
            {(Object.keys(EVENT_LABEL) as IncentiveEvent[]).map(k => <option key={k} value={k}>{EVENT_LABEL[k]}</option>)}
          </select>
        </label>
        {sale && (
          <label className="text-sm font-medium text-slate-700">Product
            <select className={input} aria-label="Product" value={f.serviceCode} onChange={e => set('serviceCode', e.target.value)} required>
              <option value="">Choose a product</option>
              {serviceOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        )}
        {support && (
          <label className="text-sm font-medium text-slate-700">Incentive type
            <select className={input} aria-label="Incentive type" value={f.amountType} onChange={e => set('amountType', e.target.value as AmountType)}>
              <option value="FIXED">Fixed amount per payment</option>
              <option value="PERCENT">Percentage of each payment</option>
            </select>
          </label>
        )}
        <label className="text-sm font-medium text-slate-700">{amountLabel}
          <input className={input} aria-label={amountLabel} type="number" inputMode="decimal" min="0.01" step="0.01" value={f.amount} onChange={e => set('amount', e.target.value)} required />
        </label>
        {!sale && (
          <label className="text-sm font-medium text-slate-700">Who it is for
            <select className={input} aria-label="Who it is for" value={f.scopeType} onChange={e => { set('scopeType', e.target.value as IncentiveScope); set('scopeValue', ''); }}>
              {((support ? ['DEPARTMENT', 'TEAM', 'PERSON'] : ['LEVEL', 'SUB_ROLE', 'DEPARTMENT', 'TEAM', 'PERSON']) as IncentiveScope[]).map(k => <option key={k} value={k}>{SCOPE_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm font-medium text-slate-700">{sale ? 'CEO' : 'Choose'}
          <select className={input} aria-label={sale ? 'CEO' : 'Choose'} value={f.scopeValue} onChange={e => set('scopeValue', e.target.value)} required>
            <option value="">Choose</option>
            {scopeOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {sale ? (
          <label className="text-sm font-medium text-slate-700">Target units (optional, a goal only)
            <input className={input} aria-label="Target units (optional, a goal only)" type="number" inputMode="numeric" min="1" step="1" value={f.targetUnits} onChange={e => set('targetUnits', e.target.value)} />
          </label>
        ) : (
          <label className="text-sm font-medium text-slate-700">Monthly cap per person (₹, optional)
            <input className={input} aria-label="Monthly cap per person (₹, optional)" type="number" inputMode="decimal" min="0.01" step="0.01" value={f.monthlyCap} onChange={e => set('monthlyCap', e.target.value)} />
          </label>
        )}
        {support && (
          <label className="text-sm font-medium text-slate-700">Monthly business minimum (₹, optional)
            <input className={input} aria-label="Monthly business minimum (₹, optional)" type="number" inputMode="decimal" min="0.01" step="0.01" value={f.minMonthlyBusiness} onChange={e => set('minMonthlyBusiness', e.target.value)} />
            <span className="mt-1 block text-[11px] font-normal text-slate-500">Nothing is earned until the verified business of the customers this person looks after reaches this amount in the month.</span>
          </label>
        )}
      </div>
      {replaces && <p className="text-xs text-amber-800" data-testid="replace-note">
        This change applies from now on: the current version stops and a new one starts{sameSale ? ', keeping the amounts already passed down' : ''}. Earnings already recorded stay as they were.
        {sale && !sameSale && ' With a different product or CEO, every level must set its amounts again: until they do, the people below earn nothing from this rule.'}
      </p>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={btn.primary} disabled={saving}>{saving ? 'Saving…' : rule ? 'Save' : 'Create Incentive'}</button>
      </div>
    </form>
  );
};

const AdminRules: React.FC<{ data: IncentiveSetupData; reload: () => void }> = ({ data, reload }) => {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [note, setNote] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const options = data.options!;
  const current = (r: SetupRule) => r.current ?? r.active;
  const rules = data.rules.filter(r => showEnded || current(r));
  const saved = (text: string) => { setEditing(null); setNote({ tone: 'ok', text }); reload(); };
  const act = async (r: SetupRule, kind: 'end' | 'delete') => {
    const ok = await confirmAction(kind === 'end'
      ? { title: `Stop "${r.name}" now?`, description: 'Nothing more is earned from it. Past earnings stay.', confirmLabel: 'Stop rule', cancelLabel: 'Keep running', variant: 'destructive' }
      : r.earnedCount
        ? { title: `Stop "${r.name}" instead of deleting it?`, description: 'It has earnings, so it is stopped rather than deleted: earned money is never erased.', confirmLabel: 'Stop rule', cancelLabel: 'Keep running', variant: 'destructive' }
        : { title: `Delete "${r.name}"?`, description: 'Nobody has earned from it yet.', confirmLabel: 'Delete rule', cancelLabel: 'Keep rule', variant: 'destructive' });
    if (!ok) return;
    setBusy(r.id); setNote(null);
    try {
      if (kind === 'end') { await incomeApi.endRule(r.id); setNote({ tone: 'ok', text: `"${r.name}" stopped.` }); }
      else {
        const res = await incomeApi.deleteRule(r.id);
        setNote({ tone: 'ok', text: res.deleted ? `"${r.name}" deleted.` : `"${r.name}" had earnings, so it was stopped instead of deleted.` });
      }
      reload();
    } catch (err) {
      setNote({ tone: 'error', text: msg(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Incentive rules"
      hint="Sales rules go to a CEO, who passes amounts down. Demo, field visit and Support business rewards go straight to the people you choose."
      right={<div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} /> Show stopped rules</label>
        <button type="button" className={btn.primary} onClick={() => setEditing('new')}><Plus className="w-4 h-4" aria-hidden="true" /> Create Incentive</button>
      </div>}
    >
      <div className="space-y-3">
        {note && <Alert tone={note.tone}>{note.text}</Alert>}
        {editing === 'new' && <RuleForm options={options} onCancel={() => setEditing(null)} onSaved={saved} />}
        {rules.length === 0 && editing !== 'new' && <p className="py-6 text-center text-sm text-slate-500">No rules yet. Create the first one.</p>}
        <ul className="space-y-3">
          {rules.map(r => (
            <li key={r.id} className="rounded-xl border border-slate-200 p-3" data-testid="rule-row">
              {editing === r.id ? <RuleForm rule={r} options={options} onCancel={() => setEditing(null)} onSaved={saved} /> : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 break-words">
                      {r.name} {!current(r) && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Stopped</span>}
                      {current(r) && !r.active && <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Starts {r.activeFrom}</span>}
                    </p>
                    <p className="text-xs text-slate-600">
                      {EVENT_LABEL[r.eventType]}{r.serviceName ? ` · ${r.serviceName}` : ''} · <strong>{amountText(r)}</strong> · {scopeText(r, options)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.targetUnits ? `Target ${r.targetUnits} units · ` : ''}{r.monthlyCap ? `Cap ${rupees(r.monthlyCap)} a month · ` : ''}{r.minMonthlyBusiness ? `From ${rupees(r.minMonthlyBusiness)} business a month · ` : ''}From {r.activeFrom}{r.earnedCount ? ` · earned ${r.earnedCount} times` : ''}
                    </p>
                  </div>
                  {current(r) && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btn.secondary} onClick={() => setEditing(r.id)} disabled={busy === r.id} aria-label={`Edit ${r.name}`}><Pencil className="w-4 h-4" aria-hidden="true" /> Edit</button>
                      <button type="button" className={btn.secondary} onClick={() => void act(r, 'end')} disabled={busy === r.id} aria-label={`Stop ${r.name}`}><Square className="w-4 h-4" aria-hidden="true" /> Stop</button>
                      <button type="button" className={btn.danger} onClick={() => void act(r, 'delete')} disabled={busy === r.id} aria-label={`Delete ${r.name}`}><Trash2 className="w-4 h-4" aria-hidden="true" /> Delete</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
};

const StartDays: React.FC<{ days: number; reload: () => void }> = ({ days, reload }) => {
  const [value, setValue] = useState(String(days));
  const [note, setNote] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  useEffect(() => setValue(String(days)), [days]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setNote(null);
    try { await incomeApi.setStartAfterDays(Number(value)); setNote({ tone: 'ok', text: 'Saved.' }); reload(); } catch (err) { setNote({ tone: 'error', text: msg(err) }); }
  };
  return (
    <Panel title="When incentives start" hint="New employees earn incentives once they have been in the company this many days.">
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-medium text-slate-700">Days in the company
          <input className={`${input} w-32`} aria-label="Days in the company" type="number" min="0" max="365" step="1" value={value} onChange={e => setValue(e.target.value)} required />
        </label>
        <button type="submit" className={btn.primary}>Save</button>
      </form>
      {note && <div className="mt-3"><Alert tone={note.tone}>{note.text}</Alert></div>}
    </Panel>
  );
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Heads and Team Leads: the amount for each person directly below
// ---------------------------------------------------------------------------------------------------------------------------------
const GivenEditor: React.FC<{ rule: SetupRule; row: GivenRow; reload: () => void }> = ({ rule, row, reload }) => {
  const [value, setValue] = useState(String(row.amount));
  const [note, setNote] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(String(row.amount)), [row.amount]);
  const n = Number(value);
  const kept = Number.isFinite(n) ? Math.round((rule.myAmount - n) * 100) / 100 : null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setNote(null);
    try { await incomeApi.setAllocation(rule.id, row.recipientId, n); setNote({ tone: 'ok', text: 'Saved.' }); reload(); } catch (err) { setNote({ tone: 'error', text: msg(err) }); } finally { setSaving(false); }
  };
  return (
    <li className="py-3" data-testid="given-row">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <p className="text-sm font-semibold text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">{LEVEL_NAME[row.level] ?? row.level}</p>
        </div>
        <label className="text-xs font-medium text-slate-600">Gets per unit (₹)
          <input className={`${input} w-32`} type="number" inputMode="decimal" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)} aria-label={`Amount for ${row.name}`} required />
        </label>
        <div className="text-xs text-slate-600 min-w-[7rem]">You keep<br /><strong className="text-sm text-slate-900 tabular-nums" data-testid="kept">{kept == null ? '—' : rupees(kept)}</strong></div>
        <button type="submit" className={btn.secondary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </form>
      {note && <div className="mt-2"><Alert tone={note.tone}>{note.text}</Alert></div>}
    </li>
  );
};

const MyAllocations: React.FC<{ data: IncentiveSetupData; reload: () => void }> = ({ data, reload }) => {
  const rules = data.rules.filter(r => r.eventType === 'SALE_PAID' && r.active && r.myAmount > 0);
  if (!rules.length) {
    return <Panel title="Amounts for your team"><p className="py-4 text-center text-sm text-slate-500">No sales incentive reaches you yet. The Managing Director sets them.</p></Panel>;
  }
  return (
    <>
      {rules.map(r => (
        <Panel key={r.id} title={r.serviceName ? `${r.serviceName}: ${r.name}` : r.name}
          hint={`You get ${rupees(r.myAmount)} per unit. Set what each person below you gets; you keep the difference on their sales.`}>
          {r.given.length === 0
            ? <p className="text-sm text-slate-500">Nobody reports to you directly, so you keep the whole amount on your own sales.</p>
            : <ul className="divide-y divide-slate-100">{r.given.map(g => <GivenEditor key={g.recipientId} rule={r} row={g} reload={reload} />)}</ul>}
        </Panel>
      ))}
    </>
  );
};

const SplitForm: React.FC<{ split: { departmentId: string | null; telecallerPct: number }; reload: () => void }> = ({ split, reload }) => {
  const [pct, setPct] = useState(String(split.telecallerPct));
  const [note, setNote] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  useEffect(() => setPct(String(split.telecallerPct)), [split.telecallerPct]);
  const n = Number(pct);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setNote(null);
    if (!split.departmentId) { setNote({ tone: 'error', text: 'Your account is not in a department.' }); return; }
    try { await incomeApi.setSplit(split.departmentId, n); setNote({ tone: 'ok', text: 'Saved.' }); reload(); } catch (err) { setNote({ tone: 'error', text: msg(err) }); }
  };
  return (
    <Panel title="Telecaller and Business Associate split" hint="When a telecaller's lead is closed by a Business Associate, the closer's amount is shared this way.">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">Telecaller's share (%)
          <input className={`${input} w-32`} aria-label="Telecaller's share (%)" type="number" min="0" max="100" step="1" value={pct} onChange={e => setPct(e.target.value)} required />
        </label>
        <p className="text-sm text-slate-600 pb-2">Business Associate: <strong data-testid="ba-share">{Number.isFinite(n) && n >= 0 && n <= 100 ? `${100 - n}%` : '—'}</strong></p>
        <button type="submit" className={btn.primary}>Save</button>
      </form>
      {note && <div className="mt-3"><Alert tone={note.tone}>{note.text}</Alert></div>}
    </Panel>
  );
};

export const IncentiveSetup: React.FC = () => {
  const [data, setData] = useState<IncentiveSetupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    incomeApi.setup().then(d => { setData(d); setError(null); }).catch(err => setError(msg(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageTitle title={data?.isAdmin ? 'Incentive Management' : 'Incentive setup'} subtitle={data?.isAdmin
        ? 'Create, change and stop the incentives Sales and Support staff earn. Every incentive is credited to the person\'s Wallet. A change to an amount applies from now on.'
        : 'What each person below you earns per unit sold. You keep the difference.'} />
      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {data?.isAdmin && data.options && <AdminRules data={data} reload={load} />}
      {data?.isAdmin && <StartDays days={data.startAfterDays} reload={load} />}
      {data && !data.isAdmin && <MyAllocations data={data} reload={load} />}
      {data?.canSplit && data.split && !data.isAdmin && <SplitForm split={data.split} reload={load} />}
    </div>
  );
};

export default IncentiveSetup;
