// A stand-in Supabase client for the task hierarchy browser test: rpc() answers the task functions and records what was sent.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const node = (id: string, name: string, role: string, children: any[] = [], extra: any = {}) => ({
  id, parentId: null, title: 'Review all pending customer escalations', description: 'Every open one', assignmentNote: null, priority: 'HIGH', status: 'IN_PROGRESS',
  progress: 40, function: 'SUPPORT', handling: null, assignee: { id, name, role }, assignedBy: { id: 'oh', name: 'Olivia Ops' },
  department: 'Wabastore', team: null, assignedAt: '2026-11-02T09:00:00Z', dueDate: '2026-11-12', completedAt: null, latestUpdate: null, children, ...extra
});
const tree = node('t-dh', 'Dev Head', 'DEPARTMENT_HEAD', [
  node('t-tl1', 'Tara Lead', 'TEAM_HEAD', [], { handling: 'SELF', team: 'Support A', assignmentNote: 'Take the WhatsApp escalations', assignedBy: { id: 'dh', name: 'Dev Head' } }),
  node('t-tl2', 'Tom Lead', 'TEAM_HEAD', [node('t-m', 'Mia Member', 'TEAM_MEMBER', [], { status: 'COMPLETED', progress: 100, assignmentNote: 'Reply to 20 e-mails', assignedBy: { id: 'tl2', name: 'Tom Lead' } })],
       { handling: 'DELEGATED', team: 'Support B', assignedBy: { id: 'dh', name: 'Dev Head' } })
]);
const answers: Record<string, any> = {
  operations_task_assignees: [
    { id: 'dh', name: 'Dev Head', departmentId: 'd-wab', department: 'Wabastore', function: 'SUPPORT' },
    { id: 'dh2', name: 'Ria Head', departmentId: 'd-wbx', department: 'Whatsbox', function: 'ALL' }
  ],
  operations_tasks: [tree],
  assign_task_to_department_head: 'new-task-id'
};
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  rpc: async (fn: string, args: any) => { calls.push({ fn, args }); return fn in answers ? { data: answers[fn], error: null } : { data: null, error: { message: `unexpected ${fn}` } }; },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
