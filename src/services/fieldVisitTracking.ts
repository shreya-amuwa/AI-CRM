import { useSyncExternalStore } from 'react';
import type { TrackedPosition, VisitTrackingIssue, VisitTrackingState } from '../../shared/contracts';
import { ApiError } from '../lib/api/client';
import { fieldVisitApi } from '../lib/api/endpoints';

/**
 * Live location of ONE field visit in progress, from this browser tab (navigator.geolocation.watchPosition).
 *
 * - It starts only when the employee taps "Share live location" on a visit that is in progress, and the browser asks for permission.
 * - Positions are sent sparingly: when the person moved ~25 m, or every 60 s while standing still (never more than one per 15 s).
 *   A position taken while the phone is offline is kept (up to 200) and sent with its own time when the connection is back.
 * - It stops when the employee taps Stop, when the visit ends, or when the permission is withdrawn. Closing the tab or locking the phone stops
 *   the browser from reporting: there is no background tracking. Managers then see the last position and how old it is.
 * Nothing is simulated: every position is one the device reported.
 */
export type TrackerPhase = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable' | 'unsupported' | 'stopped';

export interface TrackerSnapshot {
  visitId: string | null;
  phase: TrackerPhase;
  /** The last position the device reported (sent or still waiting to be sent). */
  lastFix: TrackedPosition | null;
  /** When the server last confirmed a position. */
  lastSentAt: string | null;
  queued: number;
  online: boolean;
  error: string | null;
  server: VisitTrackingState | null;
}

export const MOVE_METERS = 25;
export const MAX_SILENCE_MS = 60_000;
export const MIN_GAP_MS = 15_000;
const QUEUE_LIMIT = 200;
const BATCH = 50;

/** Great-circle distance in metres. */
export function distanceMeters(a: Pick<TrackedPosition, 'latitude' | 'longitude'>, b: Pick<TrackedPosition, 'latitude' | 'longitude'>): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether a new position is worth a write: moved far enough, or quiet for a minute; never twice within 15 s. */
export function shouldSend(prev: TrackedPosition | null, next: TrackedPosition): boolean {
  if (!prev) return true;
  const gap = Date.parse(next.recordedAt) - Date.parse(prev.recordedAt);
  if (gap < MIN_GAP_MS) return false;
  return gap >= MAX_SILENCE_MS || distanceMeters(prev, next) >= MOVE_METERS;
}

export type Freshness = 'LIVE' | 'STALE' | 'OFFLINE' | 'ENDED' | 'WAITING' | 'NOT_SHARED';
export const LIVE_MS = 2 * 60_000;
export const STALE_MS = 10 * 60_000;

/**
 * What a manager should read from a visit's tracking state at time `now`: Live (a position in the last 2 minutes and no reported problem),
 * Stale (older, up to 10 minutes, or the phone reported a problem since), Offline (nothing for 10 minutes), Ended, Waiting (sharing just
 * started, no position yet) or Not shared (the employee did not start sharing).
 */
export function freshness(s: Pick<VisitTrackingState, 'trackingStatus' | 'visitStatus' | 'lastLocation' | 'issue' | 'issueAt'>, now: number): Freshness {
  if (s.trackingStatus === 'OFF') return 'NOT_SHARED';
  if (s.trackingStatus === 'STOPPED' || s.visitStatus !== 'IN_PROGRESS') return 'ENDED';
  if (!s.lastLocation) return 'WAITING';
  const age = now - Date.parse(s.lastLocation.recordedAt);
  const problemSince = s.issue && s.issueAt && Date.parse(s.issueAt) >= Date.parse(s.lastLocation.recordedAt);
  if (age > STALE_MS) return 'OFFLINE';
  if (age > LIVE_MS || problemSince) return 'STALE';
  return 'LIVE';
}

const ISSUE_TEXT: Record<VisitTrackingIssue, string> = {
  PERMISSION_DENIED: 'Location permission is off for this site. Allow it in the browser settings, then tap Share live location again.',
  POSITION_UNAVAILABLE: 'The phone cannot find its position right now (no GPS signal). Sharing continues when it does.',
  TIMEOUT: 'The phone is taking long to find its position. Sharing continues when it does.'
};

class VisitTracker {
  private snap: TrackerSnapshot = { visitId: null, phase: 'idle', lastFix: null, lastSentAt: null, queued: 0, online: typeof navigator === 'undefined' ? true : navigator.onLine !== false, error: null, server: null };
  private listeners = new Set<() => void>();
  private watchId: number | null = null;
  private queue: TrackedPosition[] = [];
  private lastAccepted: TrackedPosition | null = null;
  private flushing = false;
  private started = false;
  private reportedIssue: VisitTrackingIssue | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.set({ online: true }); void this.flush(); });
      window.addEventListener('offline', () => this.set({ online: false }));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.flush(); });
    }
  }

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  get = () => this.snap;
  private set(p: Partial<TrackerSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach(l => l()); }

  /** Asks the browser for the position (the permission prompt appears now, after the employee's tap) and starts sharing. */
  start(visitId: string) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.set({ visitId, phase: 'unsupported', error: 'This browser cannot share a location.' });
      return;
    }
    if (this.watchId !== null && this.snap.visitId === visitId) return; // already sharing this visit
    this.stopWatching();
    this.queue = [];
    this.lastAccepted = null;
    this.started = false;
    this.reportedIssue = null;
    this.set({ visitId, phase: 'starting', error: null, queued: 0, lastFix: null, lastSentAt: null, server: null });
    this.watchId = navigator.geolocation.watchPosition(
      pos => void this.onFix({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyMeters: Math.min(100_000, Math.round(pos.coords.accuracy || 0)), recordedAt: new Date(pos.timestamp || Date.now()).toISOString() }),
      err => void this.onError(err),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 }
    );
  }

  private async onFix(fix: TrackedPosition) {
    const visitId = this.snap.visitId;
    if (!visitId) return;
    this.set({ lastFix: fix, error: null, phase: this.snap.phase === 'unavailable' ? 'live' : this.snap.phase });
    this.reportedIssue = null;
    if (!this.started) {
      // the first position starts sharing on the server (it refuses when the visit is not in progress)
      this.started = true;
      try {
        const server = await fieldVisitApi.trackingStart(visitId, fix);
        this.lastAccepted = fix;
        this.set({ phase: 'live', server, lastSentAt: new Date().toISOString() });
      } catch (err) {
        this.started = false;
        if (err instanceof ApiError && (err.status === 409 || err.status === 404 || err.status === 403)) {
          this.stopWatching();
          this.set({ phase: 'stopped', error: err.message });
        } else {
          this.set({ error: 'Could not reach the CRM. The position will be sent when the connection is back.' });
        }
      }
      return;
    }
    if (!shouldSend(this.lastAccepted, fix)) return;
    this.lastAccepted = fix;
    this.queue.push(fix);
    if (this.queue.length > QUEUE_LIMIT) this.queue.splice(0, this.queue.length - QUEUE_LIMIT);
    this.set({ queued: this.queue.length });
    await this.flush();
  }

  private async onError(err: GeolocationPositionError) {
    const visitId = this.snap.visitId;
    const issue: VisitTrackingIssue = err.code === err.PERMISSION_DENIED ? 'PERMISSION_DENIED' : err.code === err.TIMEOUT ? 'TIMEOUT' : 'POSITION_UNAVAILABLE';
    if (issue === 'PERMISSION_DENIED') {
      this.stopWatching();
      this.set({ phase: 'denied', error: ISSUE_TEXT.PERMISSION_DENIED });
    } else {
      this.set({ phase: this.started ? 'unavailable' : this.snap.phase, error: ISSUE_TEXT[issue] });
    }
    // told to the server once per kind, and only once sharing had started (before that there is nothing to mark as stale)
    if (visitId && this.started && this.reportedIssue !== issue) {
      this.reportedIssue = issue;
      try { this.set({ server: await fieldVisitApi.trackingIssue(visitId, issue) }); } catch { /* offline: the position simply ages */ }
    }
  }

  private async flush() {
    const visitId = this.snap.visitId;
    if (!visitId || this.flushing || this.queue.length === 0 || !this.started) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0 && this.snap.visitId === visitId) {
        const batch = this.queue.slice(0, BATCH);
        try {
          const server = await fieldVisitApi.trackingPoints(visitId, batch);
          this.queue.splice(0, batch.length);
          this.set({ server, queued: this.queue.length, lastSentAt: new Date().toISOString(), error: null });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
            // the visit ended (or sharing was stopped elsewhere): stop collecting
            this.queue = [];
            this.stopWatching();
            this.set({ phase: 'stopped', queued: 0, error: err.message });
          } else if (err instanceof ApiError && err.status === 422) {
            this.queue.splice(0, batch.length); // a position the server cannot accept is dropped, not retried for ever
            this.set({ queued: this.queue.length });
          } else {
            this.set({ error: 'Offline: positions are kept on this phone and sent when the connection is back.' });
          }
          if (!(err instanceof ApiError && err.status === 422)) return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** The employee stops sharing (or the visit ended): collection stops on this phone first, then the server is told. */
  async stop(reason: 'employee' | 'visit-ended' = 'employee') {
    const visitId = this.snap.visitId;
    if (reason === 'employee') await this.flush();
    this.stopWatching();
    this.queue = [];
    this.set({ phase: 'stopped', queued: 0 });
    if (visitId && reason === 'employee') {
      try { this.set({ server: await fieldVisitApi.trackingStop(visitId) }); } catch (err) { this.set({ error: err instanceof Error ? err.message : 'Could not stop sharing on the server.' }); }
    }
  }

  private stopWatching() {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /** Whether this tab is collecting positions for the visit right now. */
  isCollecting(visitId: string) { return this.watchId !== null && this.snap.visitId === visitId; }
}

export const visitTracker = new VisitTracker();
export function useVisitTracker(): TrackerSnapshot {
  return useSyncExternalStore(visitTracker.subscribe, visitTracker.get, visitTracker.get);
}
