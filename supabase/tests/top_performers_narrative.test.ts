/**
 * Top performer evaluations (no database, no real AI service): the rule-based fallback, what the AI is sent (and not sent), how its answer is
 * read, and what is stored. Run: npm run test:unit
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { evaluateWithAi, evaluationAiInput, parseEvaluation } from '../../server/topPerformers/ai.js';
import { ruleEvaluation, type EvaluationInput } from '../../server/topPerformers/narrative.js';
import { writeEvaluation } from '../../server/topPerformers/writer.js';
import { performerDecisionSchema, performersQuerySchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const metrics = {
  tasks: { assigned: 8, completed: 6, judged: 7, judgedDone: 6, weightedDone: 12, onTime: 5, late: 1, completionPct: 85.7, excluded: { duplicates: 1, instant: 0, delegated: 0, blocked: 1 } },
  reports: { approved: 3, pending: 1, rejected: 1, revision: 0, coveragePct: 40, quality: 66.7, workingDays: 20, coveredDays: 8 },
  team: null, weightedCompletionPct: 80, productivityPct: 82, weightPresent: 100
};
const item: EvaluationInput = {
  scoreId: 's1', fingerprint: 'fp1', roleKind: 'MEMBER', status: 'RANKED', month: '2026-09-01', designation: 'Sales Executive', score: 78.4, previousScore: 70.1,
  components: [
    { key: 'completion', label: 'Task completion (weighted by priority)', weight: 30, value: 90, detail: '6 of 7 judged tasks completed' },
    { key: 'on_time', label: 'Deadlines met', weight: 20, value: 83.3, detail: '5 on time, 1 late' },
    { key: 'report_consistency', label: 'Approved report coverage of working days', weight: 15, value: 40, detail: '8 of 20 working days covered by approved reports' },
    { key: 'steadiness', label: 'Consistency from week to week', weight: 10, value: null, detail: 'Needs two weeks with tasks' }
  ],
  metrics, reasons: [], department: { avgScore: 70, ranked: 5 }, feedback: ['Please add the call outcomes']
};

// ---- the rule-based evaluation
const rules = ruleEvaluation(item);
check(/78.4/.test(rules.summary) && /above the department average/.test(rules.summary) && /8.4/.test(rules.summary), 'the summary states the score and the distance from the department average', rules.summary);
check(rules.strengths.some(s => /Task completion/.test(s)) && !rules.strengths.some(s => /Consistency from week/.test(s)), 'strengths are the measures at 85 or above; a measure with no data is never praised', rules.strengths);
check(rules.improvementAreas.some(s => /report coverage/i.test(s)) && rules.improvementAreas.some(s => /waiting for approval/.test(s)) && rules.improvementAreas.some(s => /rejected or sent back/.test(s)) && rules.improvementAreas.some(s => /duplicate/.test(s)), 'weak measures, unapproved reports and duplicates are named', rules.improvementAreas);
check(/8.3 points higher/.test(rules.whyRanked) && /Please add the call outcomes/.test(rules.whyRanked), 'the explanation compares with last month and quotes the reviewer', rules.whyRanked);
check(!/\b(1st|2nd|3rd|first place|rank #?\d)/i.test(JSON.stringify(rules)), 'the evaluation never names a rank position (ranks move while the figures do not)');
const none = ruleEvaluation({ ...item, score: null, previousScore: null, department: null, feedback: [] });
check(/Not enough data/.test(none.summary) && /no earlier month/i.test(none.whyRanked), 'without a score it says so and does not invent a trend', none);
const lead = ruleEvaluation({ ...item, roleKind: 'TEAM_LEAD', metrics: { ...metrics, team: { members: 3, assigned: 10, judged: 9, judgedDone: 8, weightedDone: 16, completionPct: 88.9, reviewsTimely: 4, reviewsLate: 1 } } });
check(/team completed 8 of 9/i.test(lead.summary) && /4 team report/.test(lead.summary), 'a Team Lead\'s summary is about the team and the review speed', lead.summary);

// ---- what the AI is sent
const sent = JSON.stringify(evaluationAiInput(item));
check(!/Perf|@|phone|email/i.test(sent) && /Sales Executive/.test(sent) && /"departmentAverageScore":70/.test(sent) && /Please add the call outcomes/.test(sent), 'the AI gets the figures and the reviewer comments, no name, e-mail or contact data');

// ---- reading the AI answer
const good = { summary: 'Solid month.', strengths: ['On time'], improvementAreas: ['Reports'], whyRanked: 'Above the department average.' };
check(parseEvaluation('```json\n' + JSON.stringify(good) + '\n```').summary === 'Solid month.', 'an answer wrapped in a code fence is read');
let threw = false;
try { parseEvaluation('{"summary":"x"}'); } catch { threw = true; }
check(threw, 'an answer without the required keys is refused');
threw = false;
try { parseEvaluation('no json here'); } catch { threw = true; }
check(threw, 'an answer that is not JSON is refused');

// ---- a mock AI service
let mode: 'ok' | 'http500' | 'junk' = 'ok';
const seen: { headers: http.IncomingHttpHeaders; body: any }[] = [];
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    seen.push({ headers: req.headers, body: JSON.parse(b || '{}') });
    if (mode === 'http500') { res.writeHead(500); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: mode === 'junk' ? 'sorry, I cannot' : JSON.stringify(good) }] }));
  });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const ai = { apiKey: 'test-key-123', model: 'test-model', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 800 };
let r = await evaluateWithAi(ai, item);
check(r.ok && r.model === 'test-model' && seen[0].headers['x-api-key'] === 'test-key-123' && /never mention or guess a rank/i.test(seen[0].body.system), 'the AI is called with the key and told never to cite a rank', r);
mode = 'http500';
r = await evaluateWithAi(ai, item);
check(!r.ok && /HTTP 500/.test(r.error) && !/test-key/.test(r.error), 'a failing AI service is reported without the key');
mode = 'junk';
r = await evaluateWithAi(ai, item);
check(!r.ok && /could not be read/.test(r.error), 'an unreadable answer is a failure, not an evaluation');
check(!(await evaluateWithAi({ ...ai, apiKey: null }, item)).ok, 'without a key nothing is called');

// ---- what is stored
const stored: any[] = [];
const fakeDb = (accept = true) => ({ rpc: async (name: string, args: any) => { stored.push({ name, args }); return { data: accept, error: null }; } }) as any;
mode = 'ok';
check((await writeEvaluation(item, { db: fakeDb(), ai })) === 'AI' && stored[0].name === 'performer_evaluation_store' && stored[0].args.p_source === 'AI' && stored[0].args.p_status === 'OK' && stored[0].args.p_model === 'test-model' && stored[0].args.p_fingerprint === 'fp1', 'an AI evaluation is stored with its model and the figures it was written for');
mode = 'http500';
check((await writeEvaluation(item, { db: fakeDb(), ai })) === 'RULES_AI_FAILED' && stored[1].args.p_source === 'RULES' && stored[1].args.p_status === 'FAILED' && /HTTP 500/.test(stored[1].args.p_error) && stored[1].args.p_narrative.summary, 'when the AI fails the rule-based evaluation is stored and the failure is logged (so it is retried)');
check((await writeEvaluation(item, { db: fakeDb(), ai: { ...ai, apiKey: null } })) === 'RULES_NOT_CONFIGURED' && stored[2].args.p_status === 'NOT_CONFIGURED' && stored[2].args.p_source === 'RULES', 'without a key the rule-based evaluation is stored and marked as such');
check((await writeEvaluation(item, { db: fakeDb(false), ai: { ...ai, apiKey: null } })) === 'STALE', 'an evaluation for figures that changed meanwhile is reported as stale');
server.close();

// ---- request validation
check(performersQuerySchema.parse({ month: '2026-09' }).month === '2026-09-01' && performersQuerySchema.parse({ month: '2026-09-01' }).month === '2026-09-01', 'a month is accepted as YYYY-MM or the first day, and handed on as the first day');
check(!performersQuerySchema.safeParse({ month: '2026-09-15' }).success && !performersQuerySchema.safeParse({ month: '2026-13' }).success && !performersQuerySchema.safeParse({ role: 'SUPER_ADMIN' }).success, 'other days, other months and unknown fields are refused');
check(performerDecisionSchema.safeParse({ decision: 'APPROVE' }).success && !performerDecisionSchema.safeParse({ decision: 'REJECT' }).success && performerDecisionSchema.safeParse({ decision: 'REJECT', note: 'Not yet' }).success, 'approving needs no note; rejecting needs a reason');
check(!performerDecisionSchema.safeParse({ decision: 'APPROVE', status: 'APPROVED' }).success, 'a decision cannot carry a status or a winner');
console.log(`=== ${passed} TOP PERFORMER EVALUATION CHECKS PASSED ===`);
process.exit(0);
