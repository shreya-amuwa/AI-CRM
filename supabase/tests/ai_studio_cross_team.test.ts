/**
 * AI Studio cross-team task assignment (20270221000100) without a database: the task-list filters, the workload warning, and the service mapping each
 * request to its database function. The database checks everything again (ai_studio_cross_team_test.sql); these prove nothing malformed or privileged
 * reaches it.
 */
import { aiStudioTasksQuerySchema } from '../../shared/validation.js';
import { AiStudioService } from '../../server/services/AiStudioService.js';
import type { AiStudioRepository } from '../../server/repositories/AiStudioRepository.js';
import { workloadWarning } from '../../src/lib/aiStudioWorkload.js';

let passed = 0;
const check = (ok: unknown, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log('ok -', name);
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---- the task lists
check(aiStudioTasksQuerySchema.parse({ kind: 'CROSS_TEAM', status: 'OVERDUE' }).kind === 'CROSS_TEAM' && !aiStudioTasksQuerySchema.safeParse({ kind: 'ALL_TEAMS' }).success,
  'the task lists filter by my team / cross-team and overdue');

// ---- workload
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
await svc.tasks({ scope: 'mine', kind: 'CROSS_TEAM' });
check(calls[1].fn === 'tasks' && (calls[1].args[0] as { kind: string }).kind === 'CROSS_TEAM', 'the cross-team filter reaches the repository');
let refused = 0;
for (const f of [() => svc.assignees('nope'), () => svc.tasks({ scope: 'mine', kind: 'EVERYONE' })]) { try { await f(); } catch { refused++; } }
check(refused === 2 && calls.length === 2, 'a malformed project id and an unknown assignment type are refused before the database');
console.log(`=== AI STUDIO CROSS-TEAM UNIT TESTS PASSED (${passed}) ===`);
