/**
 * /health/database (for an uptime monitor): 503 when the database does not answer or answers slower than 3 s, 200 otherwise, with the
 * measured time; a result is reused for 10 s, so monitors never add load to a struggling database. Runs with a stand-in database ping.
 */
import { databaseReadiness, resetDatabaseReadinessForTests } from '../../server/health.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
let clock = 1_000_000;
const now = () => clock;
let pings = 0;
const ping = (ms: number, fail = false) => async () => { pings++; clock += ms; if (fail) throw new Error('connection refused'); };

let r = await databaseReadiness({ ping: ping(120), now });
check(r.status === 200 && r.body.database === 'ok' && r.body.latencyMs === 120, 'a quick answer: 200 with the time taken', r);
r = await databaseReadiness({ ping: ping(120), now });
check(pings === 1 && r.status === 200 && r.body.cached === true, 'asked again within 10 s: the last result is reused (no database call)', { pings, r });
clock += 11_000;
resetDatabaseReadinessForTests();
r = await databaseReadiness({ ping: ping(4_500), now });
check(r.status === 503 && r.body.database === 'slow' && r.body.latencyMs === 4500, 'slower than 3 s: 503 "slow" (the office feels a freeze)', r);
resetDatabaseReadinessForTests();
r = await databaseReadiness({ ping: ping(50, true), now });
check(r.status === 503 && r.body.database === 'down' && !JSON.stringify(r).includes('refused'), 'no answer: 503 "down", without the error text', r);
resetDatabaseReadinessForTests();
let hung = 0;
r = await databaseReadiness({ ping: () => new Promise<void>(() => { hung++; }), now, timeoutMs: 20 });
check(r.status === 503 && r.body.database === 'down' && hung === 1, 'a database that never answers: 503 after the time limit, not a hanging check', r);
resetDatabaseReadinessForTests();
let calls = 0;
let answer: () => void = () => undefined;
const slowPing = () => new Promise<void>(res => { calls++; answer = res; });
const many = [1, 2, 3, 4, 5].map(() => databaseReadiness({ ping: slowPing, now }));
answer();
const all = await Promise.all(many);
check(calls === 1 && all.every(x => x.status === 200), 'five checks at once while the database is slow: one database call, shared', { calls });
console.log(`=== DATABASE HEALTH CHECKS PASSED (${passed}) ===`);
