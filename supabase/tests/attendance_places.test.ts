// Unit test of the attendance place names (server/automations/attendancePlaces.ts): the address made from Nominatim's parts, and the lookup
// loop against a fake database and a fake geocoder (no network): named, failed (counted as an attempt), spaced, bounded.
import { nominatimPlace, resolveAttendancePlaces } from '../../server/automations/attendancePlaces';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };

check(nominatimPlace({ display_name: 'x', address: { road: 'Baner Road', suburb: 'Baner', city: 'Pune', state: 'Maharashtra', postcode: '411045' } }) === 'Baner Road, Baner, Pune, Maharashtra 411045',
  'a readable place from the address parts');
check(nominatimPlace({ display_name: 'Some Place, Pune, India', address: { state: 'Maharashtra' } }) === 'Some Place, Pune, India', 'too few parts: the display name');
check(nominatimPlace({}) === null, 'nothing: no place');

const rows = [{ id: 1, latitude: 18.52, longitude: 73.85 }, { id: 2, latitude: 19.07, longitude: 72.87 }, { id: 3, latitude: 12.97, longitude: 77.59 }];
const stored: { id: number; place: string | null }[] = [];
const db: any = {
  rpc: async (fn: string, args: any) => {
    if (fn === 'attendance_places_pending') return { data: rows.slice(0, args.p_limit), error: null };
    if (fn === 'attendance_set_place') { stored.push({ id: args.p_event, place: args.p_place }); return { data: null, error: null }; }
    return { data: null, error: { message: 'unexpected ' + fn } };
  }
};
const calls: number[] = [];
const geocoder = async (lat: number) => { calls.push(Date.now()); if (lat === 19.07) throw new Error('HTTP 503'); return lat === 18.52 ? 'Baner, Pune' : 'MG Road, Bengaluru'; };
const s = await resolveAttendancePlaces({ db, geocoder, limit: 3, spacingMs: 50, budgetMs: 5000 });
check(s.looked === 3 && s.named === 2 && s.failed === 1, 'three looked up: two named, one failed', s);
check(stored[0].place === 'Baner, Pune' && stored[1].place === null && stored[2].place === 'MG Road, Bengaluru', 'each result is stored; a failure is stored as an attempt (no name)', stored);
check(calls[1] - calls[0] >= 45 && calls[2] - calls[1] >= 45, 'lookups are spaced out (the free geocoder allows one a second)');
const t0 = Date.now();
const s2 = await resolveAttendancePlaces({ db, geocoder: async () => 'X', limit: 3, spacingMs: 400, budgetMs: 500 });
check(s2.looked < 3 && Date.now() - t0 < 1500, 'the time budget is kept', s2);
const s3 = await resolveAttendancePlaces({ db: { rpc: async () => ({ data: null, error: { message: 'down' } }) } as any, geocoder: async () => 'X' });
check(s3.looked === 0, 'a database error never throws');
console.log(`=== ATTENDANCE PLACES TESTS PASSED (${passed}) ===`);
