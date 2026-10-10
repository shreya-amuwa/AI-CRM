import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { ExpenseRow, ExpensesPage } from '../../../../shared/contracts';
import { expenseSchema } from '../../../../shared/validation';
import { errorMessage } from '../../../lib/api/client';
import { financeApi } from '../../../lib/api/endpoints';
import { Badge } from '../../payments/PaymentBits';
import { Empty, ErrorBanner, FormField, inputClass, Loading, Modal, PageHeader, Pager } from '../../support-member/SupportParts';
import { fmtDay, money, notifyFinanceChanged, todayIso, useFinanceRefresh } from './FinanceBits';
import { useDepartments } from './AccountsIncome';

const PAGE = 15;

const ExpenseForm: React.FC<{ editing: ExpenseRow | null; categories: string[]; onClose: () => void; onSaved: () => void }> = ({ editing, categories, onClose, onSaved }) => {
  const departments = useDepartments();
  const [date, setDate] = useState(editing?.date ?? todayIso());
  const [description, setDescription] = useState(editing?.description ?? '');
  const [department, setDepartment] = useState(editing?.departmentId ?? '');
  const [category, setCategory] = useState(editing?.category ?? '');
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [status, setStatus] = useState<'PAID' | 'PENDING'>(editing?.status ?? 'PAID');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { date, description: description.trim(), departmentId: department || null, category: category.trim(), amount: Number(amount), status, notes: notes.trim() || null };
    const parsed = expenseSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0] ?? '')] ||= i.message;
      setFields(next);
      return setError('Please fix the highlighted fields.');
    }
    setFields({});
    setError(null);
    setBusy(true);
    try {
      if (editing) await financeApi.updateExpense(editing.id, parsed.data);
      else await financeApi.addExpense(parsed.data);
      notifyFinanceChanged();
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? 'Edit expense' : 'Add expense'} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Date" htmlFor="exp-date" required error={fields.date}>
            <input id="exp-date" type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} />
          </FormField>
          <FormField label="Amount (₹)" htmlFor="exp-amount" required error={fields.amount}>
            <input id="exp-amount" type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Description" htmlFor="exp-desc" required error={fields.description}>
          <input id="exp-desc" className={inputClass} maxLength={300} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Office rent for October" />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Department" htmlFor="exp-dept" hint="Leave as company-wide if it belongs to no single department." error={fields.departmentId}>
            <select id="exp-dept" className={inputClass} value={department} onChange={e => setDepartment(e.target.value)}>
              <option value="">Company-wide</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Category" htmlFor="exp-cat" required error={fields.category}>
            <input id="exp-cat" list="exp-categories" className={inputClass} maxLength={80} value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Rent, Salaries, Software" />
            <datalist id="exp-categories">
              {categories.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>
        </div>
        <FormField label="Payment status" htmlFor="exp-status">
          <select id="exp-status" className={inputClass} value={status} onChange={e => setStatus(e.target.value as 'PAID' | 'PENDING')}>
            <option value="PAID">Paid</option>
            <option value="PENDING">Pending</option>
          </select>
        </FormField>
        <FormField label="Notes (optional)" htmlFor="exp-notes" error={fields.notes}>
          <textarea id="exp-notes" rows={2} maxLength={1000} className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} />
        </FormField>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Add expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

/** Expenses: the real expense records, with add / edit / delete (own records, or any for an Accounts lead or head). */
export const AccountsExpenses: React.FC = () => {
  const departments = useDepartments();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'' | 'PAID' | 'PENDING'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ExpensesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing: ExpenseRow | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    const n = ++seq.current;
    financeApi
      .expenses({
        search: term || undefined,
        departmentId: department && department !== 'COMPANY' ? department : undefined,
        companyWide: department === 'COMPANY' || undefined,
        category: category || undefined,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: PAGE
      })
      .then(
        r => {
          if (n !== seq.current) return;
          setData(r);
          setError(null);
        },
        e => n === seq.current && setError(errorMessage(e))
      );
  }, [term, department, category, status, from, to, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [term, department, category, status, from, to]);
  useFinanceRefresh(load);

  const remove = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await financeApi.deleteExpense(confirmDelete.id);
      notifyFinanceChanged();
      setNotice('Expense deleted.');
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(errorMessage(e));
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = !!(term || department || category || status || from || to);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        subtitle="Every recorded expense. New expenses are saved to the CRM and counted in the totals straight away."
        action={
          <button type="button" onClick={() => setForm({ editing: null })} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
            <Plus className="w-4 h-4" aria-hidden="true" /> Add expense
          </button>
        }
      />
      <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
        Google Sheet: <strong>not connected</strong>. Expenses are stored in the CRM database. Each record keeps a source and an external ID so a sheet export can be imported later without duplicates.
      </p>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-2">
        <div className="flex flex-col lg:flex-row gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search expenses</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description, category or notes" className={`${inputClass} pl-9`} />
          </label>
          <select aria-label="Filter by department" className={`${inputClass} lg:w-52`} value={department} onChange={e => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            <option value="COMPANY">Company-wide</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select aria-label="Filter by category" className={`${inputClass} lg:w-44`} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {data?.categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select aria-label="Filter by payment status" className={`${inputClass} lg:w-40`} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
            <option value="">Paid and pending</option>
            <option value="PAID">Paid</option>
            <option value="PENDING">Pending</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <label className="flex items-center gap-1.5">
            From
            <input type="date" aria-label="From date" className={`${inputClass} !w-auto !py-1.5`} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input type="date" aria-label="To date" className={`${inputClass} !w-auto !py-1.5`} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      {notice && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!data && !error ? (
        <Loading label="Loading expenses..." />
      ) : data && data.items.length === 0 ? (
        <Empty
          title={filtered ? 'No expenses match these filters' : 'No expenses recorded yet'}
          hint={filtered ? 'Clear the search or filters to see everything.' : 'Add the first expense with the button above.'}
        />
      ) : (
        data && (
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
            <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-100">
              <span className="text-slate-500">
                {data.total} expense{data.total === 1 ? '' : 's'}
                {data.pending > 0 ? ` · ${money(data.pending)} pending` : ''}
              </span>
              <span className="font-bold text-rose-700" data-testid="expense-sum">
                Total {money(data.sum)}
              </span>
            </div>
            <div className="hidden lg:grid grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_4.5rem] gap-4 px-5 py-2.5 bg-slate-50/70 text-[11px] font-medium text-slate-500" aria-hidden="true">
              <span>Date</span>
              <span>Description</span>
              <span>Department</span>
              <span>Category</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
              <span />
            </div>
            <ul className="divide-y divide-slate-100" aria-label="Expenses">
              {data.items.map(x => (
                <li key={x.id} className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_4.5rem] gap-1 lg:gap-4 items-center px-5 py-3">
                  <span className="text-xs text-slate-600">{fmtDay(x.date)}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">{x.description}</span>
                    {(x.notes || x.createdBy) && (
                      <span className="block text-[11px] text-slate-500 truncate">
                        {x.notes ? `${x.notes} · ` : ''}
                        {x.createdBy ? `added by ${x.createdBy}` : ''}
                        {x.source !== 'MANUAL' ? ` · ${x.source === 'GOOGLE_SHEET' ? 'from Google Sheet' : 'imported'}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-700 truncate">{x.department ?? 'Company-wide'}</span>
                  <span className="text-xs text-slate-700 truncate">{x.category}</span>
                  <span className="text-sm font-bold text-rose-700 lg:text-right">{money(x.amount)}</span>
                  <span>
                    <Badge tone={x.status === 'PAID' ? 'green' : 'amber'}>{x.status === 'PAID' ? 'Paid' : 'Pending'}</Badge>
                  </span>
                  <span className="flex gap-1 lg:justify-end">
                    {x.canChange && (
                      <>
                        <button type="button" onClick={() => setForm({ editing: x })} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`Edit ${x.description}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(x)} className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50" aria-label={`Delete ${x.description}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
          </div>
        )
      )}

      {form && (
        <ExpenseForm
          editing={form.editing}
          categories={data?.categories ?? []}
          onClose={() => setForm(null)}
          onSaved={() => {
            setNotice(form.editing ? 'Expense updated.' : 'Expense added.');
            setForm(null);
            load();
          }}
        />
      )}
      {confirmDelete && (
        <Modal title="Delete this expense?" onClose={() => !deleting && setConfirmDelete(null)}>
          <p className="text-sm text-slate-700">
            {confirmDelete.description} · {money(confirmDelete.amount)}. It is removed from the totals. This is recorded in the audit log.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} disabled={deleting} className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => void remove()} disabled={deleting} className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50">
              {deleting ? 'Deleting...' : 'Delete expense'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
