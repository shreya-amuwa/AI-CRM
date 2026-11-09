import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';

/**
 * Attendance place names (migration 20261230000600): the coordinates of each Punch In / Punch Out are turned ONCE into a readable place
 * ("Baner Road, Baner, Pune, Maharashtra 411045") and stored with the punch; it is erased with the coordinates after the retention period.
 *
 * Provider: Google Geocoding when GOOGLE_MAPS_API_KEY is set (better Indian addresses, billed by Google), otherwise OpenStreetMap Nominatim
 * (free; its usage policy asks for at most one request a second, a descriptive User-Agent and caching - we look each punch up once and store
 * it). A failed lookup is retried later, at most 3 times (the database counts the attempts); the punch keeps its coordinates either way.
 */
export type Geocoder = (lat: number, lng: number) => Promise<string | null>;

const env = (k: string) => (typeof process !== 'undefined' ? process.env[k] : undefined)?.trim() || undefined;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A short, readable address from Nominatim's parts (falls back to its display name). */
export function nominatimPlace(json: unknown): string | null {
  const j = (json ?? {}) as { display_name?: string; address?: Record<string, string> };
  const a = j.address ?? {};
  const parts = [
    a.road || a.pedestrian || a.footway,
    a.neighbourhood || a.suburb || a.quarter || a.residential,
    a.city || a.town || a.village || a.city_district || a.county,
    [a.state, a.postcode].filter(Boolean).join(' ')
  ].map(x => (x ?? '').trim()).filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  const text = unique.length >= 2 ? unique.join(', ') : (j.display_name ?? '').trim();
  return text ? text.slice(0, 300) : null;
}

export function defaultGeocoder(fetchImpl: typeof fetch = fetch): Geocoder {
  const google = env('GOOGLE_MAPS_API_KEY');
  if (google) {
    return async (lat, lng) => {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&key=${encodeURIComponent(google)}`;
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Google Geocoding HTTP ${r.status}`);
      const j = await r.json() as { status?: string; results?: { formatted_address?: string }[] };
      if (j.status === 'ZERO_RESULTS') return null;
      if (j.status !== 'OK') throw new Error(`Google Geocoding ${j.status ?? 'error'}`);
      return j.results?.[0]?.formatted_address?.slice(0, 300) ?? null;
    };
  }
  const agent = env('GEOCODER_USER_AGENT') || 'Amuwa-CRM/1.0 (employee attendance; reverse geocoding of punch locations)';
  return async (lat, lng) => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`;
    const r = await fetchImpl(url, { headers: { 'User-Agent': agent, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
    return nominatimPlace(await r.json());
  };
}

export interface PlacesSummary { looked: number; named: number; failed: number }

/** Names the punches that have coordinates and no place yet. Spaced out (one lookup a second) and bounded in time; never throws. */
export async function resolveAttendancePlaces(opts: { db?: SupabaseClient; geocoder?: Geocoder; limit?: number; budgetMs?: number; spacingMs?: number } = {}): Promise<PlacesSummary> {
  const summary: PlacesSummary = { looked: 0, named: 0, failed: 0 };
  if (!opts.db && !hasServiceClient()) return summary;
  const db = opts.db ?? getServiceClient();
  const geocode = opts.geocoder ?? defaultGeocoder();
  const deadline = Date.now() + (opts.budgetMs ?? 8000);
  const spacing = opts.spacingMs ?? (env('GOOGLE_MAPS_API_KEY') ? 0 : 1100);
  try {
    const { data, error } = await db.rpc('attendance_places_pending', { p_limit: opts.limit ?? 5 });
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as { id: number; latitude: number; longitude: number }[]) {
      if (Date.now() + spacing > deadline) break;
      if (summary.looked > 0 && spacing) await sleep(spacing);
      summary.looked++;
      let place: string | null = null;
      try { place = await geocode(Number(p.latitude), Number(p.longitude)); } catch (e) {
        console.error(JSON.stringify({ level: 'warn', msg: 'attendance place lookup failed', error: (e as Error)?.message }));
      }
      const { error: setError } = await db.rpc('attendance_set_place', { p_event: p.id, p_place: place });
      if (setError) throw new Error(setError.message);
      if (place) summary.named++; else summary.failed++;
    }
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'attendance places failed', error: (e as Error)?.message }));
  }
  return summary;
}
