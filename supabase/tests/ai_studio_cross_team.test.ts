/**
 * AI Studio cross-team tasks and multi-task daily reports (20270219000100) without a database: the day's report schema (shared by the form and the
 * server), the workload warning, the hours, and the service mapping each request to its database function. The database checks everything again
 * (ai_studio_cross_team_test.sql); these prove nothing malformed or privileged reaches it.
 */
import { aiStudioDailyReportSchema, aiStudioReportEntrySchema, aiStudioTasksQuerySchema } from '../../shared/validation.js';
import { AiStudioService } from '../../server/services/AiStudioService.js';
import type { AiStudioRepository } from '../../server/repositories/AiStudioRepository.js';
import { entryMinutes, workloadWarning } from '../../src/lib/aiStudioWorkload.js';

let passed = 0;
const check = (ok: unknown, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log('ok -', name);
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (n: number, over: Record<string, unknown> = {}) => ({ taskId: uuid(n), workCompleted: 'Fixed the follow-up logic', minutesSpent: 120, reportedProgress: 60, ...over });
const report = (over: Record<string, unknown> = {}) => ({ reportDate: '2027-02-18', summary: 'A full day', entries: [entry(1), entry(2), entry(3)], submit: true, ...over });

// ---- the day's report
check(aiStudioDailyReportSchema.safeParse(report()).success, 'a report with three tasks is valid');
check(!aiStudioDailyReportSchema.safeParse(report({ entries: [entry(1), entry(1)] })).success, 'the same task twice is refused');
check(aiStudioDailyReportSchema.safeParse(report({ entries: [entry(1), entry(1)] })).error?.issues[0]?.path.join('.') === 'entries.1.taskId', 'and the second entry is the one named');
check(!aiStudioDailyReportSchema.safeParse(report({ entries: [entry(1, { minutesSpent: 1000 }), entry(2, { minutesSpent: 600 })] })).success, 'more than 24 hours in all is refused');
check(!aiStudioDailyReportSchema.safeParse(report({ entries: [entry(1, { reportedProgress: 100 })] })).success, 'an open task is not completed from the report (0 to 99%)');
check(!aiStudioDailyReportSchema.safeParse(report({ entries: [entry(1, { minutesSpent: null })] })).success, 'submitting needs the time of every task');
check(!aiStudioDailyReportSchema.safeParse(report({ entries: [entry(1, { workCompleted: '' })] })).success, 'and what was done on it');
check(!aiStudioDailyReportSchema.safeParse(report({ summary: '' })).success && !aiStudioDailyReportSchema.safeParse(report({ entries: [] })).success, 'and the summary and at least one task');
check(aiStudioDailyReportSchema.safeParse(report({ submit: false, summary: '', entries: [entry(1, { workCompleted: '', minutesSpent: null, reportedProgress: null })] })).success,
  'a draft can be saved unfinished');
check(!aiStudioReportEntrySchema.safeParse({ ...entry(1), assignmentType: 'CROSS_TEAM' }).success && !aiStudioReportEntrySchema.safeParse({ ...entry(1), previousProgress: 10 }).success
  && !aiStudioDailyReportSchema.safeParse({ ...report(), authorId: uuid(9) }).success, 'nothing the server works out (assignment type, previous progress, author) can be sent');
check(!aiStudioDailyReportSchema.safeParse(report({ entries: Array.from({ length: 26 }, (_, i) => entry(i + 1, { minutesSpent: 10 })) })).success, 'at most 25 tasks');
check(aiStudioTasksQuerySchema.parse({ kind: 'CROSS_TEAM', status: 'OVERDUE' }).kind === 'CROSS_TEAM' && !aiStudioTasksQuerySchema.safeParse({ kind: 'ALL_TEAMS' }).success,
  'the task lists filter by my team / cross-team and overdue');

// ---- hours and workload
check(entryMinutes('3', '') === 180 && entryMinutes('2', '30') === 150 && entryMinutes('', '45') === 45 && entryMinutes('', '') === null, 'hours and minutes become minutes (3 h, 2 h 30, 45 min; nothing entered)');
check(entryMinutes('3', '')! + entryMinutes('2', '30')! + entryMinutes('1', '30')! === 420, 'three tasks of 3 h, 2 h 30 and 1 h 30 make 7 hours');
check(workloadWarning({ workload: { active: 4, highPriority: 2, dueToday: 0, overdue: 0, crossTeam: 0 } }) === 'This employee currently has 4 active tasks, including 2 high-priority. Please coordinate the workload before assigning additional work.',
  'four active tasks, two of them high priority: the agreed warning');
check(workloadWarning({ workload: { active: 1, highPriority: 0, dueToday: 0, overdue: 1, crossTeam: 0 } })?.includes('1 overdue') === true, 'overdue work warns too');
check(workloadWarning({ workload: { active: 2, highPriority: 1, dueToday: 1, overdue: 0, crossTeam: 1 } }) === null, 'a light workload does not');

// ---- the service: the right database call, never a malformed one
const calls: { fn: string; args: unknown[] }[] = [];
const fake = new Proxy({}, { get: (_t, fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); return Promise.resolve({}); } }) as unknown as AiStudioRepository;
const svc = new AiStudioService(fake);
await svc.assignees(uuid(1));
check(calls[0].fn === 'assignees' && calls[0].args[0] === uuid(1), 'the people for a project are read by its id');
await svc.dailyContext({ date: '2027-02-18' });
check(calls[1].fn === 'dailyContext' && calls[1].args[0] === '2027-02-18', 'the day\'s context is read by date');
await svc.saveDailyReport(report());
check(calls[2].fn === 'saveDailyReport' && (calls[2].args[0] as { entries: unknown[] }).entries.length === 3, 'the day\'s report reaches the repository with its three entries');
await svc.tasks({ scope: 'mine', kind: 'CROSS_TEAM' });
check(calls[3].fn === 'tasks' && (calls[3].args[0] as { kind: string }).kind === 'CROSS_TEAM', 'the cross-team filter reaches the repository');
let refused = 0;
for (const f of [() => svc.assignees('nope'), () => svc.dailyContext({ date: '18/02/2027' }), () => svc.saveDailyReport(report({ entries: [entry(1), entry(1)] })),
  () => svc.saveDailyReport({ ...report(), status: 'APPROVED' })]) { try { await f(); } catch { refused++; } }
check(refused === 4 && calls.length === 4, 'malformed ids, dates, duplicate tasks and extra fields are refused before the database');
console.log(`=== AI STUDIO CROSS-TEAM UNIT TESTS PASSED (${passed}) ===`);
