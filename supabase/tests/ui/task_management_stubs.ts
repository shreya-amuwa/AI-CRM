// A stand-in Supabase client for the task management browser test: rpc() answers the task functions from a small in-page state and records what was sent.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString();
const state: any = { viewer: 'manager', pending: new Set<string>(['t-late']), requested: new Set<string>(), failNext: null, failDetails: null, delay: 0 };
// the tables the task pages read directly (useWorkTasks): rows in the database's own column names
const tables: Record<string, any[]> = { work_tasks: [], work_task_updates: [], profiles: [], teams: [], customers: [] };
(window as any).__tables = tables;
(window as any).__state = state;

const fromRow = (r: any) => ({ id: r.id, title: r.title, description: r.description, priority: r.priority, status: r.status, progress: r.progress, dueDate: r.due_date });
const details = (taskId: string) => {
  if (state.failDetails) throw new Error(state.failDetails);
  const tasks: any[] = [...((window as any).__tasks ?? []), ...tables.work_tasks.map(fromRow)];
  const t = tasks.find(x => x.id === taskId) ?? tasks[0];
  const pending = state.pending.has(taskId) || state.requested.has(taskId);
  const requests = pending ? [{
    id: `req-${taskId}`, taskId, taskTitle: t.title, taskDescription: null, taskStatus: t.status, taskProgress: t.progress, taskDueDate: t.dueDate, priority: t.priority, requestedBy: 'boss',
    requestedByName: 'Tara Lead', requestedFrom: 'emp', requestedFromName: 'Mia Member', employeeRole: 'TEAM_MEMBER', message: 'Please share the current progress.', dueAt: null, status: 'PENDING',
    overdue: false, followupCount: 0, lastNotifiedAt: iso(-60), createdAt: iso(-60), respondedAt: null, canRespond: state.viewer === 'employee', canFollowUp: false, followUpAvailableAt: iso(30), response: null
  }] : [];
  return {
    task: {
      id: t.id, parentId: null, title: t.title, description: t.description ?? 'Call every customer with an open ticket.', priority: t.priority, status: t.status, progress: t.progress, dueDate: t.dueDate,
      createdAt: iso(-5000), completedAt: null, lastUpdateAt: iso(-180), lastUpdateNote: 'Started the calls', assignmentNote: null, handling: null,
      overdue: t.status !== 'COMPLETED' && !!t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10), blocked: t.status === 'BLOCKED',
      assignee: { id: 'emp', name: 'Mia Member', role: 'TEAM_MEMBER', designation: 'Support Executive', team: 'Support A', department: 'Wabastore' },
      assignedBy: { id: 'boss', name: 'Tara Lead', designation: 'Team Lead' }, customer: { id: 'c1', name: 'Acme Traders', code: 'CUS-0007' }
    },
    updates: [
      { id: 'u2', at: iso(-180), authorId: 'emp', authorName: 'Mia Member', status: 'BLOCKED', progress: 40, workCompleted: 'Called twelve customers', remainingWork: 'Eight more calls', blockers: 'Waiting for the new call list', nextSteps: 'Resume tomorrow', expectedCompletion: '2030-03-01', note: null, requestId: null },
      { id: 'u1', at: iso(-1500), authorId: 'emp', authorName: 'Mia Member', status: 'IN_PROGRESS', progress: 20, workCompleted: 'Started the calls', remainingWork: null, blockers: null, nextSteps: null, expectedCompletion: null, note: null, requestId: null }
    ],
    requests, canUpdate: state.viewer === 'employee' && t.status !== 'COMPLETED', canRequest: state.viewer === 'manager' && t.status !== 'COMPLETED' && !pending, canManage: state.viewer === 'manager',
    timeline: [
      { kind: 'TASK_CREATED', at: iso(-5000), actorName: 'Tara Lead', note: null, data: {} },
      { kind: 'TASK_ASSIGNED', at: iso(-4990), actorName: 'Tara Lead', note: null, data: { assignee: 'Mia Member' } },
      { kind: 'PROGRESS_UPDATE', at: iso(-1500), actorName: 'Mia Member', note: 'Started the calls', data: { status: 'IN_PROGRESS', progress: 20, statusChangedFrom: null } },
      ...requests.map(r => ({ kind: 'WORK_UPDATE_REQUESTED', at: r.createdAt, actorName: r.requestedByName, note: r.message, data: {} })),
      { kind: 'PROGRESS_UPDATE', at: iso(-180), actorName: 'Mia Member', note: 'Called twelve customers', data: { status: 'BLOCKED', progress: 40, statusChangedFrom: 'IN_PROGRESS' } }
    ]
  };
};

const answers: Record<string, (a: any) => any> = {
  work_update_list: () => ({ filter: 'PENDING', counts: { all: 1, pending: 1, responded: 0, overdue: 0 },
    items: [...state.pending].map(id => ({ id: `req-${id}`, taskId: id, taskTitle: 'Task', taskStatus: 'IN_PROGRESS', requestedFromName: 'Mia Member', requestedByName: 'Tara Lead', status: 'PENDING', overdue: false,
      createdAt: iso(-60), message: null, dueAt: null, respondedAt: null, response: null, canRespond: false, canFollowUp: false, followupCount: 0 })) }),
  work_task_details: a => details(a.p_task),
  work_update_my_requests: () => ({ pending: 0, responded: 0, items: [] }),
  my_team_members: () => [],
  take_task_myself: () => null,
  submit_task_update: () => null,
  work_update_request: a => { state.requested.add(a.p_task); return { id: `req-${a.p_task}` }; },
  submit_work_update: a => {
    if (state.failNext) { const m = state.failNext; state.failNext = null; throw new Error(m); }
    return { id: 'new', taskId: a.p_task, status: a.p_status, progress: a.p_progress, at: iso(0), requestId: a.p_request ?? null };
  }
};
const chain: any = { on: () => chain, subscribe: () => chain };
const chainFor = (t: string): any => { const c: any = { select: () => c, order: () => c, limit: () => c, eq: () => c, then: (res: any, rej: any) => Promise.resolve({ data: tables[t] ?? [], error: null }).then(res, rej) }; return c; };
const fake = {
  from: (t: string) => chainFor(t),
  rpc: async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (state.delay) await new Promise(r => setTimeout(r, state.delay));
    if (!(fn in answers)) return { data: null, error: { message: `unexpected ${fn}` } };
    try { return { data: JSON.parse(JSON.stringify(answers[fn](args))), error: null }; } catch (e) { return { data: null, error: { message: `VALIDATION_ERROR: ${(e as Error).message}` } }; }
  },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
