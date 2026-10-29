import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { FinanceMailItem, FinanceMailList, FinanceMailStatus } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi } from '../../../lib/api/endpoints';
import { Badge } from '../../payments/PaymentBits';
import { Empty, ErrorBanner, Loading, PageHeader, inputClass } from '../../support-member/SupportParts';
import { money, useFinanceRefresh } from './FinanceBits';

const KIND: Record<FinanceMailItem['kind'], string> = { PAYMENT_RECORDED: 'Payment pending verification', PAYMENT_VERIFIED: 'Payment verified', EXPENSE_ADDED: 'Expense allocated' };
const STATUS: Record<FinanceMailStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  QUEUED: { label: 'Waiting to be sent', tone: 'amber' },
  SENDING: { label: 'Being sent', tone: 'amber' },
  SENT: { label: 'Sent', tone: 'green' },
  FAILED: { label: 'Could not be sent', tone: 'red' },
  SKIPPED: { label: 'Not sent', tone: 'amber' },
  NO_RECIPIENT: { label: 'No Department Head', tone: 'red' },
  CANCELLED: { label: 'Closed', tone: 'slate' }
};

/**
 * Accounts: every e-mail to a Department Head about a payment or an expense, one line per recipient with its own status. A failed, unsent or
 * recipient-less one can be sent again (for a department with no head: once one has been assigned).
 */
export const FinanceMails: React.FC = () => {
  const [status, setStatus] = useState<'' | FinanceMailStatus>('');
  const [data, setData] = useState<FinanceMailList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    financeApi.financeMail({ status: status || undefined, limit: 100 }).then(
      r => {
        if (n !== seq.current) return;
        setData(r);
        setError(null);
      },
      e => n === seq.current && setError(errorMessage(e))
    );
  }, [status]);
  useEffect(load, [load]);
  useFinanceRefresh(load);

  const retry = async (x: FinanceMailItem) => {
    if (busy) return;
    setBusy(x.id);
    setNotice(null);
    setError(null);
    try {
      await financeApi.retryFinanceMail(x.id);
      setNotice('Queued again.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Finance e-mails" subtitle="The e-mails sent to Department Heads when a payment is recorded or verified, or an expense is allocated to their department. One line per head, with its own status." />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filter by status" className={`${inputClass} !w-auto`} value={status} onChange={e => setStatus(e.target.value as '' | FinanceMailStatus)}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS) as FinanceMailStatus[]).map(s => (
            <option key={s} value={s}>
              {STATUS[s].label}{data?.counts[s] ? ` (${data.counts[s]})` : ''}
            </option>
          ))}
        </select>
      </div>
      {notice && <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error ? (
        <Loading label="Loading e-mails..." />
      ) : data && data.items.length === 0 ? (
        <Empty title="No e-mails" hint="They appear here as soon as a payment or an expense is recorded." />
      ) : (
        data && (
          <ul className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100" aria-label="E-mails to Department Heads" data-testid="finance-mail-list">
            {data.items.map(x => (
              <li key={x.id} className="px-5 py-3 grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{KIND[x.kind]}</div>
                  <div className="text-[11px] text-slate-500 truncate">{x.customer ? `${x.customer} · ` : ''}{x.amount != null ? money(x.amount) : ''}</div>
                </div>
                <div className="min-w-0 text-xs text-slate-700">
                  <div className="truncate">{x.department}</div>
                  <div className="text-[11px] text-slate-500 truncate">{x.recipient ? `${x.recipient} · ${x.to}` : 'no recipient'}</div>
                </div>
                <div className="text-[11px] text-slate-500">{new Date(x.sentAt ?? x.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                <div className="min-w-0">
                  <Badge tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Badge>
                  {x.status !== 'SENT' && x.detail && <div className="text-[11px] text-slate-500 break-words mt-0.5">{x.detail}</div>}
                </div>
                <div className="flex lg:justify-end">
                  {x.canRetry && (
                    <button type="button" disabled={busy === x.id} onClick={() => void retry(x)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-50">
                      <RefreshCw className="w-3 h-3" aria-hidden="true" /> Send again
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
};
