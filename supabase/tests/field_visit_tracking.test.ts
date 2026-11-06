// Field Visit: how often a live position is sent, how its age reads (Live / Stale / Offline / Ended) and how a photo fills the Add Lead form
// without ever replacing what the employee typed (src/services/fieldVisitTracking.ts, src/lib/ocr/scanFill.ts).
import { distanceMeters, freshness, shouldSend, LIVE_MS, STALE_MS } from '../../src/services/fieldVisitTracking';
import { leadOffers, planLeadFill } from '../../src/lib/ocr/scanFill';
import type { ShopScan } from '../../src/lib/ocr/shopText';

let passed = 0;
const check = (ok: boolean, name: string) => { if (!ok) { console.error('not ok -', name); process.exit(1); } passed++; console.log('ok -', name); };

// ---- sending positions sparingly
const t0 = Date.parse('2026-11-06T10:00:00.000Z');
const at = (ms: number) => new Date(t0 + ms).toISOString();
const p = (lat: number, lng: number, ms: number) => ({ latitude: lat, longitude: lng, accuracyMeters: 10, recordedAt: at(ms) });
check(Math.abs(distanceMeters(p(18.52, 73.85, 0), p(18.53, 73.85, 0)) - 1112) < 5, 'distance: 0.01° of latitude is about 1.1 km');
check(shouldSend(null, p(18.52, 73.85, 0)), 'the first position is sent');
check(!shouldSend(p(18.52, 73.85, 0), p(18.53, 73.85, 10_000)), 'never twice within 15 s, even after a long move');
check(shouldSend(p(18.52, 73.85, 0), p(18.5205, 73.85, 20_000)), 'a move of ~55 m is sent');
check(!shouldSend(p(18.52, 73.85, 0), p(18.52005, 73.85, 30_000)), 'standing still (~5 m) is not sent before a minute');
check(shouldSend(p(18.52, 73.85, 0), p(18.52005, 73.85, 61_000)), 'standing still is sent once a minute');

// ---- what a manager reads
const now = t0 + 60 * 60_000;
const s = (o: Partial<Parameters<typeof freshness>[0]>) => freshness({ trackingStatus: 'ACTIVE', visitStatus: 'IN_PROGRESS', lastLocation: null, issue: null, issueAt: null, ...o }, now);
const last = (ageMs: number) => ({ latitude: 18.52, longitude: 73.85, accuracyMeters: 12, recordedAt: new Date(now - ageMs).toISOString() });
check(s({ lastLocation: last(30_000) }) === 'LIVE', 'a position 30 s old is Live');
check(s({ lastLocation: last(LIVE_MS + 1000) }) === 'STALE', 'older than 2 minutes is Stale');
check(s({ lastLocation: last(STALE_MS + 1000) }) === 'OFFLINE', 'older than 10 minutes is Offline (browser closed or phone locked)');
check(s({ lastLocation: last(10_000), issue: 'POSITION_UNAVAILABLE', issueAt: new Date(now - 5_000).toISOString() }) === 'STALE', 'a GPS problem reported after the last position makes it Stale, not Live');
check(s({ lastLocation: last(5_000), issue: 'POSITION_UNAVAILABLE', issueAt: new Date(now - 10_000).toISOString() }) === 'LIVE', 'a position after the problem is Live again');
check(s({ trackingStatus: 'STOPPED', lastLocation: last(5_000) }) === 'ENDED', 'stopped sharing is Ended, never Live');
check(s({ visitStatus: 'COMPLETED', lastLocation: last(5_000) }) === 'ENDED', 'a finished visit is Ended');
check(s({ trackingStatus: 'OFF' }) === 'NOT_SHARED', 'a visit without sharing is Not shared');
check(s({}) === 'WAITING', 'sharing started, no position yet: Waiting');

// ---- the photo fills the lead form
const v = (value: string, check = false) => ({ value, check });
const scan = (o: Partial<ShopScan>): ShopScan => ({ shopName: null, nameAlternatives: [], phones: [], email: null, website: null, gstin: null, pincode: null, address: null, category: null, rawText: '', ...o });
const CATS = ['Jewellery / Gold', 'Retail', 'Restaurant / Food', 'Healthcare', 'Other'];
const empty = { company: '', phone: '', address: '', email: '', businessCategory: '', notes: '' };

const first = scan({ shopName: v('Shrl Ganesh Jewelers'), phones: [v('+91 98114 00001')], address: v('12 MG Road, Pune'), email: v('ganesh@shop.in'), category: 'Jewellers', gstin: v('27ABCDE1234F1Z5', true) });
const offers = leadOffers(first, CATS);
check(!('name' in offers), 'the customer\'s own name is never taken from a shop board');
check(offers.businessCategory?.value === 'Jewellery / Gold', 'a shop type with the same meaning picks the form\'s category');
check((offers.notes?.value ?? '').includes('GSTIN 27ABCDE1234F1Z5 (check)'), 'other details (GSTIN) go to the notes, marked to check');
check(!leadOffers(scan({ category: 'Mobile & electronics' }), CATS).businessCategory, 'a shop type without an equal category is not guessed into the category');
let plan = planLeadFill(offers, empty, {});
check(plan.values.company === 'Shrl Ganesh Jewelers' && plan.values.phone === '+91 98114 00001' && plan.values.address === '12 MG Road, Pune' && plan.values.email === 'ganesh@shop.in',
  'an empty form gets the business name, phone, address and e-mail');
check(!!plan.fromPhoto.company && plan.conflicts.length === 0, 'and they are marked as read from the photo');

// acceptance 1: the photo read the name wrong; the employee corrects it; a second photo does not undo the correction
const corrected = { ...empty, ...plan.values, company: 'Shri Ganesh Jewellers' };
const flags = { ...plan.fromPhoto, company: false }; // editing a field makes it the employee's own
plan = planLeadFill(leadOffers(scan({ shopName: v('SHRI GANESH JEWELRS'), phones: [v('+91 98114 00002')] }), CATS), corrected, flags);
check(plan.values.company === undefined, 'a corrected business name is not replaced by the next photo');
check(plan.conflicts.some(c => c.field === 'company' && c.value === 'SHRI GANESH JEWELRS'), 'the new reading is offered for the employee to accept or ignore');
check(plan.values.phone === '+91 98114 00002', 'a value still as the earlier photo read it is refreshed by the new photo');
const same = planLeadFill(leadOffers(scan({ shopName: v('shri  ganesh jewellers') }), CATS), corrected, flags);
check(same.conflicts.length === 0, 'the same text (case and spaces aside) is not a conflict');

// acceptance 2: no phone on the photo; the employee types it; the form keeps it
plan = planLeadFill(leadOffers(scan({ shopName: v('Kiran Stores') }), CATS), { ...empty, phone: '9811400003' }, {});
check(plan.values.phone === undefined && plan.conflicts.length === 0, 'a photo without a phone leaves the typed phone alone');
check(plan.values.company === 'Kiran Stores', 'and still fills what it found');

console.log(`=== ${passed} FIELD VISIT TRACKING / PHOTO FILL UNIT TESTS PASSED ===`);
