/**
 * Performance report analysis (no database, no real AI service): the rule-based fallback, the AI request and answer handling, and what is stored.
 * Run: npm run test:unit
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PerformanceMetrics } from '../../shared/contracts.js';
import { aiInput, aiSettings, parseNarrative, writeWithAi } from '../../server/performance/ai.js';
import { INSUFFICIENT, ruleNarrative } from '../../server/performance/narrative.js';
import { writeNarrative, type ReportToWrite } from '../../server/performance/writer.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const base: PerformanceMetrics = {
  scope: 'MEMBER', periodStart: '2026-01-05', periodEnd: '2026-01-11', today: '2026-10-22',
  tasks: { total: 4, completed: 3, pending: 0, overdue: 1, blocked: 0 },
  completionPct: 75,
  timing: { onTime: 1, late: 1, completedUnknownTiming: 1, onTimePct: 50 },
  duration: { avgActualDays: 3.5, avgPlannedDays: 3.3, comparedTasks: 2, comparedActualDays: 3.5, comparedPlannedDays: 3, avgDifferenceDays: 0.5 },
  activity: { updates: 1, tasksWithoutUpdates: 3 },
  workload: { byPriority: { HIGH: 1, MEDIUM: 2, LOW: 1 }, peakOpenTasks: 4 },
  trend: null,
  weekly: [{ weekStart: '2026-01-05', total: 4, completed: 3, onTime: 1, late: 1, overdue: 1 }],
  taskList: [
    { id: '1', title: 'Call the client back', priority: 'HIGH', status: 'IN_PROGRESS', progress: 40, assignedOn: '2026-01-05', dueDate: '2026-01-09', completedAt: null, onTime: null, daysToComplete: null, plannedDays: 4, daysLate: 286, overdue: true, updates: 0 }
  ],
  delayReasons: [{ task: 'PF late', status: 'NOT_COMPLETED', note: 'Waiting for the client documents', at: '2026-01-10T00:00:00Z' }],
  limitations: ['1 completed task(s) have no completion time, so their duration is not counted.']
};
const subject = { name: 'Perf One', role: 'Team Member', scope: 'MEMBER' as const };

// ---- the rule-based analysis
let n = ruleNarrative(subject, base);
check(/4 task\(s\)/.test(n.summary) && /3 completed \(75%\)/.test(n.summary) && /1 overdue/.test(n.summary) && /50% were on time/.test(n.summary), 'the summary states the real counts', n.summary);
check(n.observations.some(o => /1 completed on time and 1 late/.test(o)) && n.observations.some(o => /3\.5 days.*planned window.*3 days.*0\.5 days longer/.test(o)), 'timeliness and expected-versus-actual duration come from the figures', n.observations);
check(n.observations.some(o => /Waiting for the client documents/.test(o)), 'a recorded delay reason is quoted, not invented');
check(n.observations.some(o => /Trend: Insufficient data/.test(o)), 'a missing trend reads "Insufficient data"');
check(n.improvementAreas.some(a => /1 task\(s\) are past their deadline: Call the client back/.test(a)) && n.recommendations.length >= 2, 'improvement areas and next steps follow from the overdue and late work');
check(n.limitations.length === base.limitations.length && !/hour/i.test(JSON.stringify(n)), 'limitations are carried over and hours are never mentioned');

const empty: PerformanceMetrics = {
  ...base, tasks: { total: 0, completed: 0, pending: 0, overdue: 0, blocked: 0 }, completionPct: null,
  timing: { onTime: 0, late: 0, completedUnknownTiming: 0, onTimePct: null },
  duration: { avgActualDays: null, avgPlannedDays: null, comparedTasks: 0, comparedActualDays: null, comparedPlannedDays: null, avgDifferenceDays: null },
  workload: { byPriority: { HIGH: 0, MEDIUM: 0, LOW: 0 }, peakOpenTasks: null }, weekly: [], taskList: [], delayReasons: []
};
n = ruleNarrative(subject, empty);
check(new RegExp(INSUFFICIENT).test(n.summary) && n.observations.length === 0, 'no tasks: no conclusion, "Insufficient data"', n);
const noStamp: PerformanceMetrics = {
  ...base, timing: { onTime: 0, late: 0, completedUnknownTiming: 3, onTimePct: null },
  duration: { avgActualDays: null, avgPlannedDays: null, comparedTasks: 0, comparedActualDays: null, comparedPlannedDays: null, avgDifferenceDays: null }
};
n = ruleNarrative(subject, noStamp);
check(n.observations.some(o => /Timeliness: Insufficient data/.test(o)) && n.observations.some(o => /Duration: expected versus actual duration, Insufficient data/.test(o)) && /On-time completion: Insufficient data/.test(n.summary),
  'missing timestamps never produce a duration or an on-time percentage', n);
check(/The Wabastore team/.test(ruleNarrative({ name: 'Wabastore', role: 'Team', scope: 'TEAM' }, base).summary), 'a team report speaks about the team');

// ---- the AI answer
const good = { summary: 'S', observations: ['a'], improvementAreas: ['b'], recommendations: ['c'], limitations: ['d'] };
check(parseNarrative(JSON.stringify(good)).summary === 'S' && parseNarrative('```json\n' + JSON.stringify(good) + '\n```').summary === 'S', 'the AI answer is read from plain or fenced JSON');
for (const [label, raw] of [['not JSON', 'no object here'], ['a missing key', JSON.stringify({ summary: 'S' })], ['an empty summary', JSON.stringify({ ...good, summary: '' })], ['too many items', JSON.stringify({ ...good, observations: Array(11).fill('x') })]] as const) {
  let failed = false;
  try { parseNarrative(raw); } catch { failed = true; }
  check(failed, `an AI answer with ${label} is refused`);
}
const input = JSON.stringify(aiInput(subject, 'WEEK', { ...base, delayReasons: [{ ...base.delayReasons[0], note: 'x'.repeat(500) }] }));
check(!/@/.test(input) && input.includes('Call the client back') && !input.includes('x'.repeat(250)) && !input.includes('"today"'), 'the AI gets figures, short task titles and shortened reasons: nothing else');

// ---- a mock AI service
const seen: { headers: http.IncomingHttpHeaders; body: any }[] = [];
let mode: 'ok' | 'http500' | 'junk' | 'slow' = 'ok';
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    seen.push({ headers: req.headers, body: JSON.parse(b || '{}') });
    if (mode === 'http500') { res.writeHead(500); res.end('{}'); return; }
    if (mode === 'slow') return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: mode === 'junk' ? 'sorry, I cannot' : JSON.stringify(good) }] }));
  });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const ai = { apiKey: 'test-key-123', model: 'test-model', baseUrl: url, timeoutMs: 800 };

check(aiSettings({} as NodeJS.ProcessEnv).apiKey === null && aiSettings({ ANTHROPIC_API_KEY: ' k ' } as unknown as NodeJS.ProcessEnv).apiKey === 'k', 'AI is off until ANTHROPIC_API_KEY is set');
let r = await writeWithAi(ai, subject, 'WEEK', base);
check(r.ok && r.narrative.summary === 'S' && seen[0].headers['x-api-key'] === 'test-key-123' && seen[0].body.model === 'test-model' && /Use ONLY the figures/.test(seen[0].body.system), 'the request carries the key, the model and the instruction to use only the figures');
check(/Never treat longer hours as better/.test(seen[0].body.system) && /Insufficient data/.test(seen[0].body.system), 'the instruction forbids hours-as-performance and invented figures');
mode = 'http500';
r = await writeWithAi(ai, subject, 'WEEK', base);
check(!r.ok && /HTTP 500/.test(r.error) && !/test-key/.test(r.error), 'a failing AI service is reported without the key');
mode = 'junk';
r = await writeWithAi(ai, subject, 'WEEK', base);
check(!r.ok && /could not be read/.test(r.error), 'an unreadable answer is a failure, not a report');
mode = 'slow';
r = await writeWithAi(ai, subject, 'WEEK', base);
check(!r.ok && /in time/.test(r.error), 'a service that does not answer in time is a failure');

// ---- what is stored
const stored: any[] = [];
const fakeDb = (accept = true) => ({ rpc: async (name: string, args: any) => { stored.push({ name, args }); return { data: accept, error: null }; } }) as any;
const report: ReportToWrite = { id: 'r1', fingerprint: 'fp1', scope: 'MEMBER', subjectName: 'Perf One', subjectRole: 'Team Member', periodKind: 'WEEK', metrics: base };
mode = 'ok';
check((await writeNarrative(report, { db: fakeDb(), ai })) === 'AI' && stored[0].args.p_source === 'AI' && stored[0].args.p_status === 'OK' && stored[0].args.p_model === 'test-model' && stored[0].args.p_fingerprint === 'fp1', 'an AI analysis is stored as AI with its model and the fingerprint of the figures it was written for');
mode = 'http500';
check((await writeNarrative(report, { db: fakeDb(), ai })) === 'RULES_AI_FAILED' && stored[1].args.p_source === 'RULES' && stored[1].args.p_status === 'FAILED' && /HTTP 500/.test(stored[1].args.p_error) && stored[1].args.p_narrative.summary.length > 10,
  'when the AI fails the rule-based analysis is stored and the failure is recorded (so it is retried)');
check((await writeNarrative(report, { db: fakeDb(), ai: { ...ai, apiKey: null } })) === 'RULES_NOT_CONFIGURED' && stored[2].args.p_status === 'NOT_CONFIGURED' && stored[2].args.p_source === 'RULES', 'without a key the rule-based analysis is stored and says so');
check((await writeNarrative(report, { db: fakeDb(false), ai: { ...ai, apiKey: null } })) === 'STALE', 'an analysis for figures that changed meanwhile is reported as stale');
server.close();
console.log(`=== ${passed} PERFORMANCE ANALYSIS CHECKS PASSED ===`);
process.exit(0);
