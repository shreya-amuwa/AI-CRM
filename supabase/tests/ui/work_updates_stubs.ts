// A stand-in Supabase client for the work updates browser test: rpc() answers the work_update_* functions from a small in-page state and records
// what was sent (so the test can check that no role, user id or task status is ever sent).
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString();

const base = (o: any) => ({
  taskDescription: 'Every open one', taskStatus: 'IN_PROGRESS', taskProgress: 40, taskDueDate: null, priority: 'HIGH', requestedBy: 'tl1', requestedByName: 'Tara Lead',
  employeeRole: 'TEAM_MEMBER', message: null, dueAt: null, status: 'PENDING', overdue: false, followupCount: 0, lastNotifiedAt: iso(-300), createdAt: iso(-300),
  respondedAt: null, canRespond: false, canFollowUp: true, followUpAvailableAt: iso(-240), response: null, ...o
});
const state: { requests: any[]; viewer: 'manager' | 'employee' } = {
  viewer: 'manager',
  requests: [
    base({ id: 'r1', taskId: 't1', taskTitle: 'Clear the e-mail escalations', requestedFrom: 'm1', requestedFromName: 'Mia Member', message: 'What is the current progress?',
           dueAt: iso(-60), overdue: true, followupCount: 1 }),
    base({ id: 'r2', taskId: 't2', taskTitle: 'Draft the WhatsApp section', requestedFrom: 'm2', requestedFromName: 'Ravi Member', message: 'Any blockers?', dueAt: iso(600),
           canFollowUp: false, lastNotifiedAt: iso(-10), followUpAvailableAt: iso(50) }),
    base({ id: 'r3', taskId: 't3', taskTitle: 'Prepare the Q1 plan', requestedFrom: 'tl2', requestedFromName: 'Tom Lead', employeeRole: 'TEAM_HEAD', status: 'RESPONDED',
           respondedAt: iso(-120), canFollowUp: false, followUpAvailableAt: null,
           response: { id: 'x3', progress: 'Plan is 60% drafted', workCompleted: 'Three of five regions', remainingWork: 'Two regions', blockers: 'Waiting for the Pune figures',
                       expectedCompletion: '2030-01-15', submittedAt: iso(-120) } })
  ]
};
(window as any).__state = state;

const counts = () => {
  const r = state.requests;
  return { all: r.length, pending: r.filter(x => x.status === 'PENDING').length, responded: r.filter(x => x.status === 'RESPONDED').length,
           overdue: r.filter(x => x.status === 'PENDING' && x.overdue).length };
};
const answers: Record<string, (a: any) => any> = {
  work_update_list: a => {
    const f = a.p_filter;
    const items = state.requests.filter(x => f === 'ALL' || (f === 'PENDING' && x.status === 'PENDING') || (f === 'RESPONDED' && x.status === 'RESPONDED') || (f === 'OVERDUE' && x.status === 'PENDING' && x.overdue));
    return { filter: f, counts: counts(), items };
  },
  work_update_my_requests: () => {
    const mine = state.requests.filter(x => x.requestedFrom === 'me');
    return { pending: mine.filter(x => x.status === 'PENDING').length, responded: mine.filter(x => x.status === 'RESPONDED').length, items: mine };
  },
  work_update_for_task: a => {
    const reqs = state.requests.filter(x => x.taskId === a.p_task);
    return {
      taskId: a.p_task, taskTitle: 'Clear the e-mail escalations', taskStatus: 'IN_PROGRESS',
      canRequest: !reqs.some(x => x.status === 'PENDING') && a.p_task === 't9', canManage: true, requests: reqs,
      timeline: [
        { kind: 'TASK_ASSIGNED', at: iso(-2000), actorName: 'Tom Lead', note: null, data: { assignee: 'Mia Member' } },
        { kind: 'TASK_UPDATE', at: iso(-1500), actorName: 'Mia Member', note: 'Collected the numbers', data: { status: 'IN_PROGRESS', progress: 30 } },
        ...reqs.map(r => ({ kind: 'WORK_UPDATE_REQUESTED', at: r.createdAt, actorName: r.requestedByName, note: r.message, data: {} })),
        ...reqs.filter(r => r.response).map(r => ({ kind: 'WORK_UPDATE_RESPONDED', at: r.respondedAt, actorName: r.requestedFromName, note: r.response.progress, data: {} }))
      ]
    };
  },
  work_update_request: a => {
    if (state.requests.some(x => x.taskId === a.p_task && x.status === 'PENDING')) throw new Error('CONFLICT: An update was already requested from Mia Member and is waiting. Send a reminder instead.');
    const r = base({ id: 'rn', taskId: a.p_task, taskTitle: 'New task', requestedFrom: 'm9', requestedFromName: 'Nina Member', message: a.p_message, dueAt: a.p_due, followUpAvailableAt: iso(60), canFollowUp: false });
    state.requests.push(r);
    return r;
  },
  work_update_follow_up: a => {
    const r = state.requests.find(x => x.id === a.p_request);
    r.followupCount++; r.canFollowUp = false; r.lastNotifiedAt = iso(0); r.followUpAvailableAt = iso(60);
    return r;
  },
  work_update_respond: a => {
    const r = state.requests.find(x => x.id === a.p_request);
    r.status = 'RESPONDED'; r.canRespond = false; r.respondedAt = iso(0);
    r.response = { id: 'xr', progress: a.p_progress, workCompleted: a.p_completed, remainingWork: a.p_remaining, blockers: a.p_blockers, expectedCompletion: a.p_expected, submittedAt: iso(0) };
    return r;
  }
};
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  rpc: async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (!(fn in answers)) return { data: null, error: { message: `unexpected ${fn}` } };
    try { return { data: JSON.parse(JSON.stringify(answers[fn](args))), error: null }; } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
  },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
