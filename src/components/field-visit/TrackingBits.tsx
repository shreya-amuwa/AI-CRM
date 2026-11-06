import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { TrackedPosition } from '../../../shared/contracts';
import type { Freshness } from '../../services/fieldVisitTracking';
import { Pill, type Tone } from '../team-member/pipeline/shared';

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  LIVE: 'Live',
  STALE: 'Stale',
  OFFLINE: 'Offline',
  ENDED: 'Ended',
  WAITING: 'Waiting for location',
  NOT_SHARED: 'Not shared'
};
const FRESHNESS_TONE: Record<Freshness, Tone> = { LIVE: 'green', STALE: 'orange', OFFLINE: 'red', ENDED: 'slate', WAITING: 'indigo', NOT_SHARED: 'slate' };
const FRESHNESS_HINT: Record<Freshness, string> = {
  LIVE: 'A position arrived in the last 2 minutes.',
  STALE: 'The last position is more than 2 minutes old, or the phone reported a location problem since.',
  OFFLINE: 'No position for more than 10 minutes: the browser may be closed, the phone locked or offline.',
  ENDED: 'Location sharing has ended for this visit.',
  WAITING: 'Sharing has started; the phone has not sent a position yet.',
  NOT_SHARED: 'The employee has not shared a live location for this visit.'
};

export const FreshnessPill: React.FC<{ value: Freshness }> = ({ value }) => (
  <span title={FRESHNESS_HINT[value]} data-testid="tracking-freshness" data-value={value}>
    <Pill tone={FRESHNESS_TONE[value]}>{FRESHNESS_LABEL[value]}</Pill>
  </span>
);

/** Re-renders every 30 s so "2 min ago" and Live / Stale / Offline age without any request. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function agoText(iso: string | null | undefined, now: number): string {
  if (!iso) return '-';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export const clockText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';

export const coordText = (p: Pick<TrackedPosition, 'latitude' | 'longitude'>) => `${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}`;

/** The position on a map (OpenStreetMap, no key, nothing installed) and a link to open it in Google Maps. */
export const MapPreview: React.FC<{ position: Pick<TrackedPosition, 'latitude' | 'longitude' | 'accuracyMeters'>; label: string }> = ({ position, label }) => {
  const lat = Number(position.latitude);
  const lng = Number(position.longitude);
  const d = 0.006;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <div className="space-y-1.5">
      <iframe title={`Map: ${label}`} src={src} className="w-full h-56 sm:h-64 rounded-xl border border-slate-200 bg-slate-100" loading="lazy" referrerPolicy="no-referrer" data-testid="tracking-map" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          {coordText(position)} · accuracy ±{position.accuracyMeters} m
        </span>
        <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
          Open in Google Maps <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
};
