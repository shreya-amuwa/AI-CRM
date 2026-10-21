import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { PipelineCustomer, PipelineStage } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { rupees, PaymentStatusBadge } from '../payments/PaymentBits';
import { PageTitle } from '../layout/shell';
import { Card, fieldCls, ghostBtn, LoadingLine, Tabs } from '../tasks/head/headParts';

const PAGE_SIZE = 20;
type Tab = PipelineStage | 'WITH_ACCOUNTS';
const STAGES: { id: Tab; label: string }[] = [
  { id: 'LEAD', label: 'Leads' },
  { id: 'POTENTIAL', label: 'Potential' },
  // leads Sales has sent to Accounts for payment confirmation (they are not worked on in Leads meanwhile)
  { id: 'WITH_ACCOUNTS', label: 'With Accounts' },
  { id: 'ONBOARDING', label: 'Onboarding' }
];

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '-');

/**
 * Team Lead: the customers of the team, by stage. The list is the same pipeline the members work in, read through the Team Lead's own
 * access: the database returns only their team's customers.
 */
export const TeamCustomers: React.FC = () => {
  const [stage, setStage] = useState<Tab>('LEAD');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PipelineCustomer[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(typed.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(() => {
    setRows(null);
    pipelineApi.list({ stage: stage === 'WITH_ACCOUNTS' ? 'LEAD' : stage, accounts: stage === 'WITH_ACCOUNTS' ? 'WITH_ACCOUNTS' : undefined, page, pageSize: PAGE_SIZE, search: search || undefined }).then(
      r => {
        setRows(r.items);
        setTotal(r.total);
        setError(null);
      },
      e => {
        setError(errorMessage(e));
        setRows([]);
      }
    );
  }, [stage, page, search]);
  useEffect(load, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="space-y-5">
      <PageTitle title="Team Customers" subtitle="Everyone your team is working with, by stage." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Stage"
          value={stage}
          options={STAGES}
          onChange={s => {
            setStage(s);
            setPage(1);
          }}
        />
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search customers</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
          <input className={`${fieldCls} pl-9`} placeholder="Name, business or phone" value={typed} onChange={e => setTyped(e.target.value)} maxLength={100} />
        </label>
      </div>
      {error && <p role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">{error}</p>}
      <Card label="Customers">
        {rows === null ? (
          <LoadingLine label="Loading customers…" />
        ) : rows.length === 0 && !error ? (
          <p className="py-12 text-center text-sm text-slate-500" role="status">{search ? 'No customer matches the search.' : stage === 'WITH_ACCOUNTS' ? 'Nobody is waiting for Accounts.' : 'Nobody is at this stage yet.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[44rem]">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="py-2.5 pl-5 pr-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Owner</th>
                  <th className="py-2.5 px-3 font-semibold">Services</th>
                  <th className="py-2.5 px-3 font-semibold">Next follow-up</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Deal</th>
                  <th className="py-2.5 pl-3 pr-5 font-semibold">Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 pl-5 pr-3">
                      <div className="font-bold text-slate-900">{c.company || c.name}</div>
                      {c.company && <div className="text-xs text-slate-500">{c.name}</div>}
                    </td>
                    <td className="py-3 px-3 text-slate-700">{c.owner?.fullName ?? '-'}</td>
                    <td className="py-3 px-3 text-slate-600">{c.services.length ? `${c.services.length} service${c.services.length === 1 ? '' : 's'}` : '-'}</td>
                    <td className={`py-3 px-3 ${c.nextFollowUpAt && new Date(c.nextFollowUpAt) < new Date() && stage !== 'ONBOARDING' && stage !== 'WITH_ACCOUNTS' ? 'font-bold text-rose-700' : 'text-slate-600'}`}>{fmt(c.nextFollowUpAt)}</td>
                    <td className="py-3 px-3 text-right">{rupees(c.dealAmount)}</td>
                    <td className="py-3 pl-3 pr-5">{c.paymentStatus ? <PaymentStatusBadge status={c.paymentStatus} /> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 text-sm text-slate-600">
          <span>{total === 0 ? '0 customers' : `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
          <div className="flex items-center gap-2">
            <button type="button" className={`${ghostBtn} !h-9 !px-3`} disabled={page <= 1 || rows === null} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="text-xs">Page {page} of {pages}</span>
            <button type="button" className={`${ghostBtn} !h-9 !px-3`} disabled={page >= pages || rows === null} onClick={() => setPage(p => p + 1)} aria-label="Next page">
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
};
