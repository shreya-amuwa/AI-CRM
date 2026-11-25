import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaskAssignPanel } from '../../../src/components/tasks/TaskAssignPanel';
import { TaskTracker } from '../../../src/components/tasks/TaskTracker';
import { SubmitWorkUpdate } from '../../../src/components/tasks/WorkUpdateForm';
import { MemberTasksView } from '../../../src/components/tasks/MemberTasksView';
import { TeamLeadTasksView } from '../../../src/components/tasks/TeamLeadTasksView';
import './withAppFeedback';

const root = () => createRoot(document.getElementById('root')!);
const w = window as any;
w.__assigned = [];
/** The Team Lead's panel: people with designations and teams; a submit records what was sent, and `__failAssign` makes the next one fail like the database would. */
w.mountAssign = (people: any[]) => root().render(
  <div className="p-4 max-w-xl">
    <TaskAssignPanel multiple assigneeLabel="Assign to team members" people={people} customers={[{ id: 'c1', name: 'Acme Traders', code: 'CUS-0007' }]}
      onSubmit={async v => {
        await new Promise(r => setTimeout(r, 150));
        if (w.__failAssign) { const m = w.__failAssign; w.__failAssign = null; throw new Error(m); }
        w.__assigned.push(v);
        return `Task assigned to ${v.assigneeIds.length} team member${v.assigneeIds.length === 1 ? '' : 's'}.`;
      }} />
  </div>);
w.mountTracker = (tasks: any[], people: any[], meId: string, filters?: string[]) => { w.__tasks = tasks; root().render(<div className="p-4 max-w-5xl"><TaskTracker tasks={tasks} people={people} meId={meId} filters={filters as any} /></div>); };
w.mountUpdate = (status: string, progress: number) => root().render(<div className="p-4 max-w-xl"><SubmitWorkUpdate taskId="t-1" status={status as any} progress={progress} onSent={() => (w.__sent = (w.__sent ?? 0) + 1)} /></div>);

/** The real Assigned Tasks pages, as the signed-in person: tasks and people are put in window.__tables first. */
w.mountMember = () => root().render(<MemberTasksView />);
w.mountLead = () => root().render(<TeamLeadTasksView />);
