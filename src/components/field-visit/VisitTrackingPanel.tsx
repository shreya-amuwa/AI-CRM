import React, { useEffect, useState } from 'react';
import { LocateFixed, MapPin, Square, WifiOff } from 'lucide-react';
import type { LeadVisit, TrackingTrail } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { fieldVisitApi } from '../../lib/api/endpoints';
import { freshness, useVisitTracker, visitTracker } from '../../services/fieldVisitTracking';
import { btn } from '../team-member/pipeline/shared';
import { FreshnessPill, MapPreview, agoText, clockText, coordText, useNow } from './TrackingBits';

/**
 * Live location for one visit in progress, on the employee's phone. The employee starts it (the browser then asks for permission), sees
 * what is shared, and can stop at any time. It never starts by itself, and it ends when the visit ends.
 */
export const VisitTrackingPanel: React.FC<{ visit: LeadVisit }> = ({ visit }) => {
  const t = useVisitTracker();
  const now = useNow(15_000);
  const mine = t.visitId === visit.id;
  const collecting = mine && (t.phase === 'starting' || t.phase === 'live' || t.phase === 'unavailable');
  const [trail, setTrail] = useState<TrackingTrail | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [stopping, setStopping] = useState(false);
  const serverActive = visit.trackingStatus === 'ACTIVE';

  // the history list follows what was sent
  useEffect(() => {
    if (!showHistory) return;
    let live = true;
    fieldVisitApi.trackingTrail(visit.id).then(x => live && (setTrail(x), setTrailError(null)), err => live && setTrailError(errorMessage(err)));
    return () => { live = false; };
  }, [showHistory, visit.id, t.lastSentAt]);

  if (visit.status !== 'IN_PROGRESS') return null;
  if (visit.trackingStatus === undefined) return null; // the database has not been updated for live location yet

  const last = (mine ? t.lastFix : null) ?? trail?.lastLocation ?? null;
  const state = mine && t.server ? t.server : null;
  const status = collecting
    ? freshness({ trackingStatus: 'ACTIVE', visitStatus: 'IN_PROGRESS', lastLocation: t.lastFix, issue: t.phase === 'unavailable' ? 'POSITION_UNAVAILABLE' : null, issueAt: t.phase === 'unavailable' ? new Date(now).toISOString() : null }, now)
    : null;

  const stop = async () => {
    setStopping(true);
    await visitTracker.stop('employee');
    setStopping(false);
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-2.5 text-xs" data-testid="visit-tracking">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-indigo-900 flex items-center gap-1.5">
          <LocateFixed className="w-4 h-4" aria-hidden="true" /> Live location
        </p>
        {status && <FreshnessPill value={status} />}
        {!collecting && serverActive && <FreshnessPill value="STALE" />}
      </div>

      {!collecting && (
        <>
          <p className="text-slate-700" data-testid="tracking-disclosure">
            Share your location while this visit is in progress so your Team Lead, your Sales Department Head, the Sales CEO of your
            department and HR can see where you are for this work visit. It is shared only while this page is open and the visit is in progress, and
            stops when you tap Stop or record the outcome. A browser cannot share it while it is closed or the phone is locked.
          </p>
          {serverActive && (
            <p className="text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5" role="status">
              Sharing was interrupted on this phone (the page was closed or reloaded). Your managers see your last position as not live until you resume.
            </p>
          )}
          {mine && t.error && (
            <p className="text-rose-700" role="alert" data-testid="tracking-error">
              {t.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} onClick={() => visitTracker.start(visit.id)} data-testid="tracking-start">
              <LocateFixed className="w-4 h-4" aria-hidden="true" /> {serverActive ? 'Resume sharing' : 'Share live location'}
            </button>
            {serverActive && (
              <button type="button" className={btn.secondary} onClick={() => void stop()} disabled={stopping} data-testid="tracking-stop">
                <Square className="w-3.5 h-3.5" aria-hidden="true" /> Stop sharing
              </button>
            )}
          </div>
        </>
      )}

      {collecting && (
        <>
          {t.phase === 'starting' && !t.lastFix && <p className="text-slate-700" role="status">Waiting for the phone's position… Allow location when the browser asks.</p>}
          {t.error && (
            <p className={`${t.online ? 'text-orange-800' : 'text-slate-700'} flex items-start gap-1.5`} role="status" data-testid="tracking-error">
              {!t.online && <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />} {t.error}
            </p>
          )}
          {last && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
              <div>
                <dt className="text-slate-500">Current location</dt>
                <dd className="font-mono text-slate-800" data-testid="tracking-coords">{coordText(last)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Accuracy</dt>
                <dd className="text-slate-800">±{last.accuracyMeters} m</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last update</dt>
                <dd className="text-slate-800">{clockText(last.recordedAt)} · {agoText(last.recordedAt, now)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sent to the CRM</dt>
                <dd className="text-slate-800">
                  {t.lastSentAt ? agoText(t.lastSentAt, now) : 'not yet'}
                  {t.queued > 0 ? ` · ${t.queued} waiting` : ''}
                </dd>
              </div>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.danger} onClick={() => void stop()} disabled={stopping} data-testid="tracking-stop">
              <Square className="w-3.5 h-3.5" aria-hidden="true" /> {stopping ? 'Stopping…' : 'Stop sharing'}
            </button>
          </div>
        </>
      )}

      {(collecting || serverActive || (state && state.points > 0)) && (
        <div>
          <button type="button" className="text-indigo-700 font-semibold underline" onClick={() => setShowHistory(s => !s)} aria-expanded={showHistory} data-testid="tracking-history-toggle">
            {showHistory ? 'Hide location history' : 'Show location history'}
          </button>
          {showHistory && (
            <div className="mt-2 space-y-2" data-testid="tracking-history">
              {trailError && <p className="text-rose-700" role="alert">{trailError}</p>}
              {trail && trail.lastLocation && <MapPreview position={trail.lastLocation} label="your last position" />}
              {trail && trail.locations.length === 0 && <p className="text-slate-500">No position was sent yet.</p>}
              {trail && trail.locations.length > 0 && (
                <ol className="max-h-48 overflow-y-auto divide-y divide-indigo-100 bg-white rounded-lg border border-indigo-100">
                  {trail.locations.slice(0, 50).map(p => (
                    <li key={`${p.recordedAt}-${p.latitude}`} className="px-2.5 py-1.5 flex justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-mono"><MapPin className="w-3 h-3 text-indigo-500" aria-hidden="true" />{coordText(p)}</span>
                      <span className="text-slate-500">{clockText(p.recordedAt)} · ±{p.accuracyMeters} m</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
