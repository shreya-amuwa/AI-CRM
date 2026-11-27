/**
 * Deleting an assigned task (20270220000100) without a database: each service validates the id and calls exactly one delete function, the routes need a
 * login and the stricter rate limit, and every screen shows "Delete" only when the server said so and asks for confirmation first (no native dialog).
 * Who may delete is decided by the database (task_deletion_test.sql); these prove nothing malformed reaches it and the UI never decides on its own.
 */
import { readFileSync } from 'node:fs';
import { WorkTaskService } from '../../server/services/WorkTaskService.js';
import type { WorkTaskRepository } from '../../server/repositories/WorkTaskRepository.js';
import { AiStudioService } from '../../server/services/AiStudioService.js';
import type { AiStudioRepository } from '../../server/repositories/AiStudioRepository.js';
import { AiDesignStudioService } from '../../server/services/AiDesignStudioService.js';
import type { AiDesignStudioRepository } from '../../server/repositories/AiDesignStudioRepository.js';

let passed = 0;
const check = (ok: unknown, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log('ok -', name);
};
const ID = '00000000-0000-4000-8000-000000000001';
const fails = async (p: () => Promise<unknown>) => { try { await p(); return false; } catch { return true; } };

// ---- the services: one database function each, never reached with a malformed id
{
  const calls: string[] = [];
  const work = new WorkTaskService({
    deletePreview: async (id: string) => { calls.push(`preview:${id}`); return { canDelete: true } as never; },
    remove: async (id: string) => { calls.push(`delete:${id}`); return { deleted: true } as never; }
  } as unknown as WorkTaskRepository);
  await work.remove(ID);
  await work.deletePreview(ID);
  check(calls.join(',') === `delete:${ID},preview:${ID}`, 'the Task module service calls the delete and the preview with the task id');
  check(await fails(() => work.remove('1 or 1=1')) && await fails(() => work.remove('')) && calls.length === 2, 'a malformed id is refused before the database');

  const ai: string[] = [];
  const aiSvc = new AiStudioService({ deleteTask: async (id: string) => { ai.push(id); return { deleted: true } as never; } } as unknown as AiStudioRepository);
  await aiSvc.deleteTask(ID);
  check(ai.join() === ID && await fails(() => aiSvc.deleteTask('abc')) && ai.length === 1, 'AI Studio: the delete reaches ai_studio_task_delete only with a valid id');

  const ads: string[] = [];
  const adsSvc = new AiDesignStudioService({ assignmentDelete: async (id: string) => { ads.push(id); return { deleted: true } as never; } } as unknown as AiDesignStudioRepository);
  await adsSvc.assignmentDelete(ID);
  check(ads.join() === ID && await fails(() => adsSvc.assignmentDelete('abc')) && ads.length === 1, 'AI Design Studio: the delete reaches ads_assignment_delete only with a valid id');
}

// ---- the repositories name the database functions that check the caller
{
  const repo = (f: string) => readFileSync(f, 'utf8');
  check(/'work_task_delete'/.test(repo('server/repositories/WorkTaskRepository.ts')) && /'work_task_delete_preview'/.test(repo('server/repositories/WorkTaskRepository.ts')),
    'the Task module repository calls work_task_delete / work_task_delete_preview');
  check(/'ai_studio_task_delete'/.test(repo('server/repositories/AiStudioRepository.ts')), 'the AI Studio repository calls ai_studio_task_delete');
  check(/'ads_assignment_delete'/.test(repo('server/repositories/AiDesignStudioRepository.ts')), 'the AI Design Studio repository calls ads_assignment_delete');
}

// ---- the routes: logged in (none public), DELETE with the stricter rate limit
{
  const routes = readFileSync('server/routes.ts', 'utf8').split('\n');
  for (const p of ['/work-tasks/:id', '/ai-studio/tasks/:id', '/ai-design-studio/assignments/:id']) {
    const line = routes.find(l => l.includes("method: 'DELETE'") && l.includes(`path: '${p}'`));
    check(!!line && /options: S\b/.test(line) && !/public\s*:\s*true/.test(line), `DELETE ${p} exists, needs a login and is rate limited`, line);
  }
  const preview = routes.find(l => l.includes("path: '/work-tasks/:id/delete-preview'"));
  check(!!preview && !/public\s*:\s*true/.test(preview), 'the delete preview needs a login');
}

// ---- the screens: the button follows the server's flag and always confirms first
{
  const ui = {
    work: readFileSync('src/components/tasks/TaskDetails.tsx', 'utf8'),
    ai: readFileSync('src/components/ai-studio/AiStudioTasks.tsx', 'utf8'),
    ads: readFileSync('src/components/ai-design-studio/AdsAssign.tsx', 'utf8')
  };
  check(/canDelete = !!deletion\?\.canDelete/.test(ui.work) && /\{canDelete && \(/.test(ui.work), 'Task workspace: Delete is shown only when the server says canDelete');
  check(/\{task\.canDelete && \(/.test(ui.ai), 'AI Studio: Delete is shown only when the server says canDelete');
  check(/\{data\.canDelete && \(/.test(ui.ads), 'AI Design Studio: Delete is shown only when the server says canDelete');
  for (const [k, src] of Object.entries(ui)) {
    check(/confirmTaskDeletion\(/.test(src) && !/window\.confirm|\bconfirm\(/.test(src.replace(/confirmTaskDeletion\(|confirmAction\(/g, '')), `${k}: deleting asks the in-app confirmation first`);
    check(!/role\s*===?\s*'(TEAM_HEAD|DEPARTMENT_HEAD)'[^\n]*[Dd]elete/.test(src), `${k}: the screen never decides from the role itself`);
  }
  const prompt = readFileSync('src/lib/taskDeletion.ts', 'utf8');
  check(/variant: 'destructive'/.test(prompt) && /onConfirm: p\.run/.test(prompt) && /cannot be undone/.test(prompt),
    'the confirmation is destructive, names the task and runs the delete inside the dialog (errors stay visible)');
}

// ---- Delete on the task cards (20270225000100): decided by the server, for the whole list at once, never by role in the screen
{
  const lib = readFileSync('src/lib/workTasks.ts', 'utf8');
  check((lib.match(/rpc\('work_tasks_deletable'/g) ?? []).length === 1 && /deletable: Set<string>/.test(lib),
    'Task module cards: one work_tasks_deletable call for the whole list (not one request per card)');
  const card = readFileSync('src/components/tasks/TaskCardDelete.tsx', 'utf8');
  check(/workTasksApi\.deletePreview\(/.test(card) && /confirmTaskDeletion\(/.test(card) && /workTasksApi\.deleteTask\(/.test(card) && /stopPropagation\(\)/.test(card),
    'the card Delete re-checks with the server, asks the same confirmation, deletes through the same API and never opens the card');
  check(/notifyWorkTasksChanged\(\)/.test(card), 'after a delete every task list and count on the page reloads');
  const cards = ['src/components/tasks/TaskTracker.tsx', 'src/components/tasks/head/HeadAssign.tsx', 'src/components/tasks/TeamLeadTasksView.tsx'].map(f => readFileSync(f, 'utf8'));
  check(/deletable\?\.has\(t\.id\) && <TaskCardDelete/.test(cards[0]) && /data\.deletable\.has\(task\.id\) && <TaskCardDelete/.test(cards[1]) && /data\.deletable\.has\(t\.id\) && <TaskCardDelete/.test(cards[2]),
    'the tracker, the Department Head\'s Assigned tasks and the Team Lead\'s lists show Delete only for the tasks the server returned');
  check(/\{t\.canDelete && \(/.test(readFileSync('src/components/ai-studio/AiStudioTasks.tsx', 'utf8')) && /\{r\.canDelete && \(/.test(readFileSync('src/components/ai-design-studio/AdsAssign.tsx', 'utf8')),
    'AI Studio and AI Design Studio rows show Delete only when the list says canDelete');
  for (const src of [card, ...cards]) check(!/role\s*===?\s*'(TEAM_HEAD|DEPARTMENT_HEAD|SUPER_ADMIN)'[^\n]*[Dd]elet/.test(src), 'a card never decides Delete from the role itself');
  const mig = readFileSync('supabase/migrations/20270225000100_task_delete_hierarchy.sql', 'utf8');
  check(/private\.ai_studio_department\(\)/.test(mig) && !/'ai-studio'|ai studio'/i.test(mig.replace(/--.*$/gm, '')),
    'the Super Admin\'s permission is found from the AI Studio department itself (no department name or person hard-coded)');
}

console.log(`\n${passed} checks passed`);
