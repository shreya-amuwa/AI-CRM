import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CrocodialRefreshRequest, CrocodialRefreshScope, CrocodialRefreshState } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi } from '../../lib/api/endpoints';

/**
 * "Refresh My Data" / "Refresh My Team" / "Refresh Department" / "Refresh My Departments": one button for every Sales role.
 *
 * It decides nothing about who may refresh what: it sends a scope (and, for a department, its id) and the database works out the people
 * and Crocodial connections from the signed-in account (croc_refresh_request). One account-level read per connection serves everybody,
 * so a click joins a read already running instead of starting another. The button then follows the request (croc_refresh_status) and
 * only says "up to date" once the read has really finished; a long first read is reported as continuing in the background.
 */
const POLL_MS = 3_000;
const GIVE_UP_MS = 4 * 60_000;

const SUBJECT: Record<CrocodialRefreshScope, string> = {
  SELF: 'Your Crocodial data',
  TEAM: 'Your team’s Crocodial data',
  DEPARTMENT: 'This department’s Crocodial data',
  ALL: 'Crocodial data for your departments'
};

export function refreshMessage(scope: CrocodialRefreshScope, state: CrocodialRefreshState, outcome?: CrocodialRefreshRequest['outcome']): string {
  switch (state) {
    case 'UP_TO_DATE': return outcome === 'UP_TO_DATE' ? `${SUBJECT[scope]} is up to date (read less than 2 minutes ago).` : `${SUBJECT[scope]} is up to date.`;
    case 'REFRESH_QUEUED': return 'Refresh requested. Waiting for the Crocodial read to start…';
    case 'SYNCING': return 'Refreshing Crocodial data…';
    case 'PARTIALLY_SYNCED': return 'Part of the data is refreshed. The rest continues automatically in the next few minutes.';
    case 'RATE_LIMITED': return 'Crocodial asked us to slow down. The refresh continues automatically shortly.';
    case 'SYNC_FAILED': return 'The refresh did not finish. The last data stays visible; try again later.';
    case 'TOKEN_MISSING':
    case 'TOKEN_INVALID': return 'Crocodial is temporarily unavailable: the connection needs the administrator. The last data stays visible.';
    default: return 'Crocodial data is temporarily unavailable. The last data stays visible.';
  }
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const TONE: Partial<Record<CrocodialRefreshState, string>> = {
  UP_TO_DATE: 'text-emerald-700', PARTIALLY_SYNCED: 'text-amber-700', RATE_LIMITED: 'text-amber-700',
  SYNC_FAILED: 'text-rose-700', TOKEN_MISSING: 'text-rose-700', TOKEN_INVALID: 'text-rose-700', DATA_UNAVAILABLE: 'text-rose-700'
};

export const CrocodialRefreshControl: React.FC<{
  scope: CrocodialRefreshScope;
  departmentId?: string;
  label: string;
  /** the last complete read of what this control covers, shown as "Last synced" */
  lastSyncAt?: string | null;
  /** called once the read has finished (up to date or partly), to reload the figures */
  onCompleted?: () => void;
  /** a request of this scope made in the last few minutes (after a reload), to keep showing its progress */
  resume?: CrocodialRefreshRequest | null;
  variant?: 'primary' | 'secondary';
}> = ({ scope, departmentId, label, lastSyncAt, onCompleted, resume, variant = 'secondary' }) => {
  const [req, setReq] = useState<CrocodialRefreshRequest | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const started = useRef(0);
  const done = useRef<string | null>(null);
  const completed = useRef(onCompleted);
  completed.current = onCompleted;

  // a request made before a reload keeps being followed
  useEffect(() => {
    if (resume && resume.scope === scope && (resume.departmentId ?? undefined) === departmentId && !req) {
      started.current = new Date(resume.requestedAt).getTime();
      setReq(resume);
    }
  }, [resume, scope, departmentId, req]);

  // follow the request until it is finished (or for 4 minutes: the scheduled run finishes anything left)
  useEffect(() => {
    if (!req) return;
    if (req.finished) {
      if (done.current !== req.id) {
        done.current = req.id;
        if (req.state === 'UP_TO_DATE' || req.state === 'PARTIALLY_SYNCED') completed.current?.();
      }
      return;
    }
    if (Date.now() - started.current > GIVE_UP_MS) {
      setGaveUp(true);
      return;
    }
    const t = setTimeout(() => {
      crocodialApi.refreshStatus(req.id).then(setReq).catch(() => setGaveUp(true));
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [req]);

  const click = useCallback(async () => {
    setBusy(true);
    setError('');
    setGaveUp(false);
    try {
      const r = await crocodialApi.refresh(scope, departmentId);
      started.current = Date.now();
      done.current = null;
      setReq(r);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'The refresh could not be requested. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [scope, departmentId]);

  const running = !!req && !req.finished && !gaveUp;
  const shownLast = req?.lastSyncAt ?? lastSyncAt ?? null;
  const btn = variant === 'primary'
    ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50';

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end" data-testid={`croc-refresh-${scope.toLowerCase()}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-slate-500" data-testid="croc-last-synced">Last synced: {ago(shownLast)}</span>
        <button type="button" onClick={click} disabled={busy || running}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-60 ${btn}`}>
          <RefreshCw className={`w-3.5 h-3.5 ${running || busy ? 'animate-spin' : ''}`} aria-hidden />
          {label}
        </button>
      </div>
      <p className={`text-[11px] ${req ? TONE[req.state] ?? 'text-slate-600' : 'text-slate-600'} ${req || error ? '' : 'sr-only'}`} role="status" aria-live="polite"
        data-testid="croc-refresh-message">
        {error ? <span className="text-rose-700">{error}</span>
          : gaveUp && req && !req.finished ? 'Still waiting. The next scheduled sync finishes it; you can leave this page.'
          : req ? refreshMessage(scope, req.state, req.outcome) : ''}
      </p>
    </div>
  );
};

export default CrocodialRefreshControl;
