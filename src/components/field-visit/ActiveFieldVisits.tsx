import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import type { TrackingBoard, TrackingBoardItem, TrackingTrail } from '../../../shared/contracts';
import { ApiError, errorMessage } from '../../lib/api/client';
import { fieldVisitApi } from '../../lib/api/endpoints';
import { listenToTables } from '../../lib/realtimeShared';
import { freshness, type Freshness } from '../../services/fieldVisitTracking';
import { PageTitle } from '../layout/shell';
import { Card, ErrorBanner, Spinner, btn, inputCls } from '../team-member/pipeline/shared';
import { EmptyState } from '../telecaller/ui';
import { VisitStatusPill } from './FieldVisitDialogs';
import { FreshnessPill, FRESHNESS_LABEL, MapPreview, agoText, clockText, coordText, useNow } from './TrackingBits';

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const EVENT_LABEL: Record<string, string> = {
  STARTED: 'Started sharing', STOPPED: 'Stopped sharing', VISIT_ENDED: 'Visit ended', PERMISSION_DENIED: 'Location permission withdrawn',
  POSITION_UNAVAILABLE: 'No GPS position', TIMEOUT: 'GPS took too long'
};

/**
 * Active Field Visits: the Sales field visitors the viewer may track (their own Team Members for a Team Lead, their departments for a Sales
 * Department Head, the Sales side of their departments for a Sales Operations Head, everyone for HR), decided by the database. The list
 * follows Supabase Realtime (a new position, a visit that starts or ends) and ages Live / Stale / Offline on its own; nothing is polled.
 */
export const ActiveFieldVisits: React.FC<{ audience: 'manager' | 'hr' }> = ({ audience }) => {
  const [date, setDate] = useState(istToday());
  const [board, setBoard] = useState<TrackingBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrackingTrail | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);
  const now = useNow(30_000);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const b = await fieldVisitApi.trackingBoard(date);
      if (n !== seq.current) return;
      setBoard(b);
      setError(null);
    } catch (err) {
      if (n !== seq.current) return;
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(errorMessage(err));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // new positions and visit changes arrive through Realtime (only rows this viewer may read); a burst is folded into one reload
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rtTick, setRtTick] = useState(0);
  useEffect(() => {
    const off = listenToTables(['lead_visit_locations', 'lead_visits'], () => {
      if (tick.current) clearTimeout(tick.current);
      tick.current = setTimeout(() => { void load(); setRtTick(t => t + 1); }, 1500);
    });
    return () => { off(); if (tick.current) clearTimeout(tick.current); };
  }, [load]);

  useEffect(() => {
    if (!selected) { setTrail(null); return; }
    let live = true;
    fieldVisitApi.trackingTrail(selected).then(t => live && (setTrail(t), setTrailError(null)), err => live && setTrailError(errorMessage(err)));
    return () => { live = false; };
  }, [selected, rtTick]);

  const rows = useMemo(() => (board?.items ?? []).map(item => ({ item, state: freshness(item, now) })), [board, now]);
  const counts = useMemo(() => {
    const c: Partial<Record<Freshness, number>> = {};
    for (const r of rows) c[r.state] = (c[r.state] ?? 0) + 1;
    return c;
  }, [rows]);
  const current = rows.find(r => r.item.visitId === selected) ?? null;

  if (forbidden) {
    return (
      <Card className="p-6">
        <EmptyState title="Not available">Field visit tracking is for Team Leads, Sales Department Heads, Sales CEOs and HR.</EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-5" data-testid="active-field-visits">
      <PageTitle
        title={audience === 'hr' ? 'Field Visit Tracking' : 'Active Field Visits'}
        subtitle={
          audience === 'hr'
            ? 'Work-related location records of field visits, for HR. Locations are shared by the employee only while a visit is in progress; every view is recorded.'
            : 'Where your field visitors are while a visit is in progress. The location comes from the employee’s browser only while the page is open: a closed browser or a locked phone shows the last known position as stale or offline.'
        }
      />
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-600">
              Day
              <input type="date" className={`${inputCls} mt-1 w-44`} value={date} max={istToday()} onChange={e => { setSelected(null); setDate(e.target.value || istToday()); }} data-testid="tracking-date" />
            </label>
            <button type="button" className={btn.secondary} onClick={() => void load()} aria-label="Refresh the list">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]" aria-label="Tracking status counts">
            {(['LIVE', 'STALE', 'OFFLINE', 'ENDED', 'NOT_SHARED'] as Freshness[]).map(f => (
              <span key={f} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                {FRESHNESS_LABEL[f]}: <b>{counts[f] ?? 0}</b>
              </span>
            ))}
          </div>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !board ? (
        <Spinner label="Loading field visits…" />
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No field visit to show">{date === istToday() ? 'Visits in progress today, and visits tracked today, appear here.' : 'No tracked visit on this day.'}</EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <Card className="xl:col-span-3 overflow-hidden">
            <ul className="divide-y divide-slate-100" data-testid="tracking-rows">
              {rows.map(({ item, state }) => (
                <li key={item.visitId}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.visitId === selected ? null : item.visitId)}
                    aria-pressed={item.visitId === selected}
                    className={`w-full text-left p-4 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${item.visitId === selected ? 'bg-indigo-50/60' : ''}`}
                    data-testid="tracking-row"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{item.employee.fullName}</span>
                      <span className="flex items-center gap-1.5">
                        <VisitStatusPill status={item.visitStatus} />
                        <FreshnessPill value={state} />
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {[item.department, item.team, item.teamLead ? `Team Lead: ${item.teamLead}` : null].filter(Boolean).join(' · ')}
                    </div>
                    <div className="text-xs text-slate-700 mt-1">
                      {item.lead.name}
                      {item.lead.company ? ` · ${item.lead.company}` : ''}
                    </div>
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-[11px]">
                      <div><dt className="text-slate-500">Visit started</dt><dd className="text-slate-800">{clockText(item.startedAt)}</dd></div>
                      <div><dt className="text-slate-500">Last update</dt><dd className="text-slate-800">{item.lastLocation ? agoText(item.lastLocation.recordedAt, now) : '-'}</dd></div>
                      <div><dt className="text-slate-500">GPS accuracy</dt><dd className="text-slate-800">{item.lastLocation ? `±${item.lastLocation.accuracyMeters} m` : '-'}</dd></div>
                      <div><dt className="text-slate-500">Positions</dt><dd className="text-slate-800">{item.points}</dd></div>
                    </dl>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="xl:col-span-2" data-testid="tracking-detail"><Card className="p-4 space-y-3">
            {!current ? (
              <p className="text-xs text-slate-500">Choose a visit to see its location on the map and its history.</p>
            ) : (
              <>
                <div>
                  <p className="font-bold text-slate-900">{current.item.employee.fullName}</p>
                  <p className="text-xs text-slate-500">{current.item.purpose}{current.item.lead.address ? ` · ${current.item.lead.address}` : ''}</p>
                </div>
                {current.item.lastLocation ? (
                  <>
                    <MapPreview position={current.item.lastLocation} label={`last position of ${current.item.employee.fullName}`} />
                    <p className="text-[11px] text-slate-600">
                      Last position {clockText(current.item.lastLocation.recordedAt)} ({agoText(current.item.lastLocation.recordedAt, now)}). {current.state !== 'LIVE' && current.state !== 'ENDED' ? 'This is the last known position, not a live one.' : ''}
                    </p>
                  </>
                ) : current.item.checkin ? (
                  <>
                    <MapPreview position={{ ...current.item.checkin, accuracyMeters: current.item.checkin.accuracyMeters ?? 0 }} label={`check-in of ${current.item.employee.fullName}`} />
                    <p className="text-[11px] text-slate-600">Position when the visit started (no live location was shared).</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">No position was shared for this visit.</p>
                )}
                {trailError && <ErrorBanner message={trailError} />}
                {trail && (
                  <>
                    {trail.events.length > 0 && (
                      <ol className="text-[11px] space-y-0.5" aria-label="Tracking events">
                        {trail.events.map((e, i) => (
                          <li key={`${e.at}-${i}`} className="text-slate-600">{clockText(e.at)} · {EVENT_LABEL[e.event] ?? e.event}</li>
                        ))}
                      </ol>
                    )}
                    {trail.locations.length > 0 && (
                      <ol className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 text-[11px]" aria-label="Location history">
                        {trail.locations.map(p => (
                          <li key={`${p.recordedAt}-${p.latitude}-${p.longitude}`} className="px-2.5 py-1.5 flex justify-between gap-2">
                            <span className="flex items-center gap-1.5 font-mono"><MapPin className="w-3 h-3 text-indigo-500" aria-hidden="true" />{coordText(p)}</span>
                            <span className="text-slate-500">{clockText(p.recordedAt)} · ±{p.accuracyMeters} m</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
              </>
            )}
          </Card></div>
        </div>
      )}
    </div>
  );
};
