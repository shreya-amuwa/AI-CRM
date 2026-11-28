import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, RefreshCw, Unlink } from 'lucide-react';
import type { SheetSyncConnectResult, SheetSyncConnection } from '../../../shared/contracts';
import { api } from '../../lib/api/client';
import { buildSheetSyncScript } from '../../lib/sheetSyncScript';
import { useAuth } from '../../context/AuthContext';
import { btn, Card, ErrorBanner, Pill } from '../team-member/pipeline/shared';
import { userMessage } from '../../lib/feedback/errors';

/**
 * Google Sheet sync (docs/CUSTOMER_SHEET_SYNC.md): connect the team's customer sheet once, paste the script, then "CRM Sync > Sync now"
 * in the sheet sends the new and changed rows. The key is shown once, inside the script; the CRM keeps only its hash.
 */
const SYNC_PATH = '/api/v1/integrations/customer-sheet/sync';
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

export const SheetSyncPanel: React.FC = () => {
  const { profile } = useAuth();
  const [conn, setConn] = useState<SheetSyncConnection | null | undefined>(undefined);
  const [script, setScript] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'connect' | 'disconnect'>('');
  const [confirm, setConfirm] = useState<'' | 'replace' | 'disconnect'>('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConn(await api.get<SheetSyncConnection | null>('/customers/sheet-sync'));
    } catch (e) {
      setConn(null);
      setError(userMessage(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    setConfirm('');
    try {
      const r = await api.post<SheetSyncConnectResult>('/customers/sheet-sync', {});
      setConn(r.connection);
      setScript(buildSheetSyncScript({
        url: `${window.location.origin}${SYNC_PATH}`, key: r.key, connectedBy: profile?.fullName ?? 'you',
        date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      }));
      setCopied(false);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy('');
    }
  };
  const disconnect = async () => {
    setBusy('disconnect');
    setError(null);
    setConfirm('');
    try {
      await api.delete('/customers/sheet-sync');
      setScript(null);
      await load();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy('');
    }
  };
  const copy = async () => {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch {
      setError('Copying was blocked by the browser. Select the script below and copy it with Ctrl+C.');
    }
  };

  return (
    <Card className="p-5" >
      <div data-testid="sheet-sync" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Google Sheet sync
              {conn ? <Pill tone="green">Connected</Pill> : conn === null ? <Pill tone="slate">Not connected</Pill> : null}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Keep one shared Google Sheet (the one-sheet template above) and send it to the CRM with <b>CRM Sync &gt; Sync now</b> inside the sheet: only new and
              changed rows are sent, each row gets its result in a "CRM Status" column, and a mobile number that is already a customer is never added twice.
              Customers are saved with your permissions. Client passwords are never taken from the sheet: clients get an e-mail to set their own.
            </p>
          </div>
          {conn === null && (
            <button type="button" className={btn.primary} onClick={() => void connect()} disabled={!!busy} data-testid="sheet-sync-connect">
              <Link2 className="w-4 h-4" aria-hidden="true" /> {busy === 'connect' ? 'Connecting…' : 'Connect Google Sheet'}
            </button>
          )}
        </div>

        {error && <ErrorBanner message={error} />}

        {conn && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><dt className="text-slate-500">Key</dt><dd className="font-bold text-slate-900">…{conn.keyHint}</dd></div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><dt className="text-slate-500">Connected</dt><dd className="font-bold text-slate-900">{when(conn.createdAt)}</dd></div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><dt className="text-slate-500">Last sync</dt><dd className="font-bold text-slate-900" data-testid="sheet-sync-last">{when(conn.lastSyncAt)}</dd></div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><dt className="text-slate-500">Syncs so far</dt><dd className="font-bold text-slate-900">{conn.syncCount}</dd></div>
            </dl>
            {conn.runs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="sheet-sync-runs">
                  <caption className="sr-only">Recent syncs</caption>
                  <thead><tr className="text-left text-slate-500"><th className="py-1 pr-3 font-semibold">When</th><th className="pr-3 font-semibold">Rows</th><th className="pr-3 font-semibold">Added</th><th className="pr-3 font-semibold">Updated</th><th className="pr-3 font-semibold">Saved</th><th className="pr-3 font-semibold">Duplicates held</th><th className="pr-3 font-semibold">To fix</th></tr></thead>
                  <tbody>
                    {conn.runs.map(r => (
                      <tr key={r.at} className="border-t border-slate-100">
                        <td className="py-1 pr-3">{when(r.at)}</td><td className="pr-3">{r.rows}</td><td className="pr-3">{r.added}</td><td className="pr-3">{r.updated}</td><td className="pr-3">{r.saved}</td>
                        <td className="pr-3">{r.duplicates}</td><td className="pr-3">{r.rejected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!script && (
              <div className="flex flex-wrap items-center gap-2">
                {confirm === 'replace' ? (
                  <>
                    <span className="text-xs text-slate-700">The script in your sheet stops working; you paste the new one. Continue?</span>
                    <button type="button" className={btn.primary} onClick={() => void connect()} disabled={!!busy}>Yes, get a new script</button>
                    <button type="button" className={btn.secondary} onClick={() => setConfirm('')}>Cancel</button>
                  </>
                ) : confirm === 'disconnect' ? (
                  <>
                    <span className="text-xs text-slate-700">The sheet can no longer send customers to the CRM. Customers already saved stay. Continue?</span>
                    <button type="button" className={btn.secondary} onClick={() => void disconnect()} disabled={!!busy} data-testid="sheet-sync-disconnect-yes">Yes, disconnect</button>
                    <button type="button" className={btn.secondary} onClick={() => setConfirm('')}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={btn.secondary} onClick={() => setConfirm('replace')} disabled={!!busy} data-testid="sheet-sync-replace">
                      <RefreshCw className="w-4 h-4" aria-hidden="true" /> Get a new script (replaces the key)
                    </button>
                    <button type="button" className={btn.secondary} onClick={() => setConfirm('disconnect')} disabled={!!busy} data-testid="sheet-sync-disconnect">
                      <Unlink className="w-4 h-4" aria-hidden="true" /> Disconnect
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {script && (
          <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <ol className="list-decimal pl-5 text-xs text-slate-700 space-y-1">
              <li>Copy the script below. <b>It is shown only now</b>: it holds the sheet's secret key.</li>
              <li>Open your customer Google Sheet &gt; <b>Extensions &gt; Apps Script</b>. Delete what is there, paste the script and click <b>Save</b>.</li>
              <li>Reload the sheet. A <b>CRM Sync</b> menu appears: click <b>Sync now</b>. The first time, Google asks you to allow the script: allow it.</li>
              <li>Each row gets its result in the <b>CRM Status</b> column. Fix the rows marked ❌ or ⚠️ in the sheet and click Sync now again.</li>
            </ol>
            <div className="flex gap-2">
              <button type="button" className={btn.primary} onClick={() => void copy()} data-testid="sheet-sync-copy">
                {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />} {copied ? 'Copied' : 'Copy script'}
              </button>
              <button type="button" className={btn.secondary} onClick={() => setScript(null)}>Done</button>
            </div>
            <label className="block text-[11px] font-semibold text-slate-600" htmlFor="sheet-sync-script">Apps Script</label>
            <textarea id="sheet-sync-script" readOnly value={script} data-testid="sheet-sync-script" className="w-full h-48 font-mono text-[11px] rounded-xl border border-slate-200 p-2 bg-white" onFocus={e => e.currentTarget.select()} />
          </div>
        )}
      </div>
    </Card>
  );
};
