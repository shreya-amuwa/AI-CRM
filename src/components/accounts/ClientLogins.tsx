import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Mail, RefreshCw, Search } from 'lucide-react';
import type { AccountNotificationState, ClientAccessMethod, ClientEmailProblem, ClientLoginStatus, ProvisioningFilter, ProvisioningQueue, ProvisioningRow } from '../../../shared/contracts';
import { pipelineApi } from '../../lib/api/endpoints';
import { useRealtime } from '../../lib/support';
import { btn, Dialog, ErrorBanner, Field, inputCls, longDate, money, notifyPipelineChanged, Pager, Pill, Spinner, useDebounced, usePipelineRealtime, type Tone } from '../team-member/pipeline/shared';
import { toast } from '../feedback/AppFeedback';
import { userMessage } from '../../lib/feedback/errors';

const TABS: { key: ProvisioningFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'NOT_STARTED', label: 'To create' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'PENDING', label: 'Being created' },
  { key: 'CREATED', label: 'Created' }
];
const STATUS_TONE: Record<ClientLoginStatus, Tone> = { NOT_STARTED: 'slate', PENDING: 'orange', CREATED: 'green', FAILED: 'red' };
const STATUS_LABEL: Record<ClientLoginStatus, string> = { NOT_STARTED: 'To create', PENDING: 'Being created', CREATED: 'Created', FAILED: 'Failed' };
const EMAIL_PROBLEM: Record<ClientEmailProblem, string> = {
  MISSING: 'No e-mail on the customer record.',
  INVALID: 'The e-mail on the record is not valid.',
  IN_USE: 'That e-mail already has a login.'
};
const MESSAGE_TONE: Record<AccountNotificationState['status'], Tone> = { QUEUED: 'slate', SENDING: 'orange', SENT: 'green', FAILED: 'red', SKIPPED: 'orange', CANCELLED: 'slate' };
const MESSAGE_LABEL: Record<AccountNotificationState['status'], string> = {
  QUEUED: 'waiting to be sent',
  SENDING: 'being sent',
  SENT: 'sent',
  FAILED: 'could not be sent',
  SKIPPED: 'not sent',
  CANCELLED: 'cancelled'
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '-';

const MessageLine: React.FC<{ label: string; m: AccountNotificationState | null | undefined }> = ({ label, m }) =>
  m ? (
    <li className="flex flex-wrap items-center gap-1.5">
      <span className="text-slate-500">{label}</span>
      <Pill tone={MESSAGE_TONE[m.status]}>{MESSAGE_LABEL[m.status]}</Pill>
      {m.status !== 'SENT' && m.detail ? <span className="text-slate-500 break-words">{m.detail}</span> : null}
    </li>
  ) : null;

/** The e-mail on the record can be corrected (with a reason) until a login exists. */
const FixEmailDialog: React.FC<{ row: ProvisioningRow; onClose: () => void; onDone: () => void }> = ({ row, onClose, onDone }) => {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.correctCustomerEmail(row.customerId, { email: email.trim(), reason: reason.trim() });
      notifyPipelineChanged();
      onDone();
    } catch (err) {
      setError(userMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Correct the customer e-mail" description={`${row.company || row.name}: the login is made with the e-mail on the record. The change is audited.`} onClose={() => !busy && onClose()}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-xs text-slate-500">
          Now: <span className="font-mono break-all">{row.email || 'none'}</span>
        </p>
        <Field label="Correct e-mail" htmlFor="fix-email" required>
          <input id="fix-email" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" disabled={busy} />
        </Field>
        <Field label="Why is it being changed?" htmlFor="fix-reason" required>
          <input id="fix-reason" className={inputCls} value={reason} maxLength={300} onChange={e => setReason(e.target.value)} disabled={busy} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.primary} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || reason.trim().length < 3}>
            {busy ? 'Saving…' : 'Save the e-mail'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

/**
 * How the client gets in. Nothing is typed here and no password is shown: with the temporary password the SERVER makes one and e-mails it
 * to the address on the record, and the client must choose their own at the first sign-in.
 */
const CreateLoginDialog: React.FC<{ row: ProvisioningRow; busy: boolean; onClose: () => void; onCreate: (method: ClientAccessMethod) => void }> = ({ row, busy, onClose, onCreate }) => {
  const [method, setMethod] = useState<ClientAccessMethod>('LINK');
  return (
    <Dialog title="Create the client dashboard login" description={`${row.company || row.name}: the login is made with the e-mail on the customer record.`} onClose={() => !busy && onClose()}>
      <form onSubmit={e => { e.preventDefault(); onCreate(method); }} className="space-y-3">
        <p className="text-xs text-slate-600">
          Login e-mail: <span className="font-mono break-all text-slate-900">{row.email || 'none'}</span>
        </p>
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-slate-700 mb-1">How should the client get in?</legend>
          <label className="flex items-start gap-2 text-sm rounded-xl border border-slate-200 p-3 cursor-pointer has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50/50">
            <input type="radio" name="access-method" className="mt-1" checked={method === 'LINK'} onChange={() => setMethod('LINK')} disabled={busy} />
            <span><b>Set-password link</b> (recommended)<br /><span className="text-xs text-slate-500">The client gets an e-mail with a one-time link and chooses their own password. No password is ever sent.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm rounded-xl border border-slate-200 p-3 cursor-pointer has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50/50">
            <input type="radio" name="access-method" className="mt-1" checked={method === 'TEMPORARY'} onChange={() => setMethod('TEMPORARY')} disabled={busy} />
            <span><b>Temporary password</b><br /><span className="text-xs text-slate-500">A random password is made on the server and e-mailed to the client once; you never see it. The client must choose their own password the first time they sign in.</span></span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Working…' : 'Create login'}</button>
        </div>
      </form>
    </Dialog>
  );
};

/**
 * Accounts: the client dashboard login of every customer with a verified payment, for every service. Each row shows the customer, its ID
 * and order, the e-mail on the record, the state of the login with its time and result (a failure keeps its reason), and what can be done:
 * create it, try again, correct the e-mail, or send the set-password e-mail again. Nobody types or sees a password.
 */
export const ClientLogins: React.FC = () => {
  const [status, setStatus] = useState<ProvisioningFilter>('ALL');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<ProvisioningQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fixing, setFixing] = useState<ProvisioningRow | null>(null);
  const [creating, setCreating] = useState<ProvisioningRow | null>(null);

  const load = useCallback(() => {
    pipelineApi.clientLogins({ status, search: debounced || undefined, page, pageSize }).then(
      d => {
        setData(d);
        setError(null);
      },
      e => setError(userMessage(e))
    );
  }, [status, debounced, page, pageSize]);
  useEffect(load, [load]);
  // a login is made / a message is sent in the database: the rows follow it (no timer)
  usePipelineRealtime(load);
  useRealtime('automation_jobs', load);
  useEffect(() => setPage(1), [status, debounced]);

  const act = async (row: ProvisioningRow, run: () => Promise<unknown>, done: string) => {
    if (busyId) return;
    setBusyId(row.customerId);
    setError(null);
    try {
      await run();
      toast.success(done);
      notifyPipelineChanged();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusyId(null);
      load();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Client Logins</h1>
        <p className="text-sm text-slate-500">
          Accounts creates the dashboard login of every customer once a payment is verified, with the e-mail on the customer record. The customer gets either a link to choose their own password or a temporary password they must replace at the first sign-in. This is the Client Dashboard login - the WhatsApp panel login is set by the Meta Verifier.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Login status" className="flex flex-wrap gap-1.5">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setStatus(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${status === t.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
            >
              {t.label}
              {data ? <span className="ml-1.5 opacity-80">{data.counts[t.key]}</span> : null}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Search customers</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input className={`${inputCls} pl-9`} placeholder="Name, company, ID…" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <Spinner label="Loading client logins…" />}

      {data && data.items.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500 bg-white rounded-2xl border border-slate-200/80">No customers here. A customer appears once a payment is verified.</p>
      )}

      {data && data.items.length > 0 && (
        <ul className="space-y-2" aria-label="Customers and their client logins">
          {data.items.map(r => {
            const busy = busyId === r.customerId;
            const problem = r.emailProblem ? EMAIL_PROBLEM[r.emailProblem] : null;
            return (
              <li key={r.customerId} className="bg-white rounded-2xl border border-slate-200/80 p-4 grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto] items-start" data-testid="client-login-row">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate">{r.company || r.name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {r.code ? `${r.code} · ` : ''}
                    {r.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {r.order.services.length ? r.order.services.join(', ') : 'No service'}
                    <span className="text-slate-400"> · </span>
                    {money(r.order.verified)} verified
                    {r.order.balance > 0 ? ` · ${money(r.order.balance)} due` : ''}
                  </p>
                </div>
                <div className="min-w-0 text-xs space-y-1">
                  <p className="text-slate-500">{r.status === 'CREATED' ? 'Login e-mail' : 'E-mail on the record'}</p>
                  <p className={`font-mono break-all ${problem && r.status !== 'CREATED' ? 'text-rose-700' : 'text-slate-900'}`}>{(r.status === 'CREATED' ? r.loginEmail : r.email) || 'none'}</p>
                  {problem && r.status !== 'CREATED' && <p className="text-rose-700">{problem}</p>}
                </div>
                <div className="min-w-0 text-xs space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                    <span className="text-slate-500">
                      {r.status === 'CREATED' ? longDate(r.createdAt) : r.updatedAt ? when(r.updatedAt) : ''}
                      {r.createdBy && r.status === 'CREATED' ? ` · ${r.createdBy}` : ''}
                    </span>
                  </div>
                  {r.status === 'CREATED' && (
                    <p className="text-slate-600">
                      {r.accessMethod === 'TEMPORARY'
                        ? r.mustChangePassword ? 'Temporary password sent - the client has not chosen their own yet.' : `Temporary password replaced by the client${r.passwordChangedAt ? ` on ${when(r.passwordChangedAt)}` : ''}.`
                        : 'Set-password link sent.'}
                    </p>
                  )}
                  {r.status === 'FAILED' && r.lastError && <p className="text-rose-700 break-words">{r.lastError} ({r.attempts} {r.attempts === 1 ? 'attempt' : 'attempts'})</p>}
                  {r.notification && (
                    <ul className="space-y-0.5" aria-label="Messages to the customer">
                      <MessageLine label="E-mail" m={r.notification.email} />
                      <MessageLine label="WhatsApp" m={r.notification.whatsapp} />
                      {!r.notification.email && !r.notification.whatsapp && <li className="text-slate-500">No account message was sent for this login.</li>}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap lg:flex-col gap-2 lg:items-stretch">
                  {r.status !== 'CREATED' && (
                    <button
                      type="button"
                      className={btn.primary}
                      disabled={busy || !r.can.create}
                      title={r.can.create ? undefined : problem ?? 'The login is being created.'}
                      onClick={() => setCreating(r)}
                    >
                      {r.status === 'FAILED' ? <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> : <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />}
                      {busy ? 'Working…' : r.status === 'FAILED' ? 'Try again' : 'Create login'}
                    </button>
                  )}
                  {r.can.fixEmail && (
                    <button type="button" className={btn.secondary} disabled={busy || r.status === 'PENDING'} onClick={() => setFixing(r)}>
                      Correct e-mail
                    </button>
                  )}
                  {r.can.resend && (
                    <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act(r, () => pipelineApi.resendAccountEmail(r.customerId), r.accessMethod === 'TEMPORARY' && r.mustChangePassword ? 'A new temporary password was made and the sign-in e-mail queued again. The earlier one no longer works.' : 'The set-password e-mail was queued again.')}>
                      <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Send e-mail again
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.total > 0 && <Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="customers" onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />}

      {creating && (
        <CreateLoginDialog
          row={creating}
          busy={busyId === creating.customerId}
          onClose={() => setCreating(null)}
          onCreate={method => {
            const row = creating;
            void act(row, () => pipelineApi.accountsCreateClientLogin(row.customerId, method),
              method === 'TEMPORARY' ? 'The client login was created. The sign-in e-mail with the temporary password is on its way.' : 'The client login was created. The set-password e-mail is on its way.')
              .then(() => setCreating(null));
          }}
        />
      )}
      {fixing && (
        <FixEmailDialog
          row={fixing}
          onClose={() => setFixing(null)}
          onDone={() => {
            setFixing(null);
            toast.success('The e-mail on the record was corrected.');
            load();
          }}
        />
      )}
    </div>
  );
};
