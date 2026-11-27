import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { notifyWorkTasksChanged, workTasksApi, type WorkTask } from '../../lib/workTasks';
import { notifyWorkUpdatesChanged } from '../../lib/workUpdates';
import { confirmTaskDeletion, countLine } from '../../lib/taskDeletion';
import { toast } from '../../lib/feedback/feedbackStore';
import { fmtDate, STATUS_UI } from './TaskParts';

/**
 * "Delete" straight on a task card (20270225000100). Shown only for the tasks the list's one deletable check returned (useWorkTasks().deletable): the
 * Team Lead's own team members' tasks, the Department Head's department, the Super Admin's AI Studio. A click asks the server for the confirmation's
 * data (and whether the delete is still allowed), opens the same confirmation as the task workspace, and deletes through the same API, which checks
 * everything again. It never opens the card it sits on.
 */
export const TaskCardDelete: React.FC<{ task: WorkTask; assigneeName?: string; className?: string; onDeleted?: () => void }> = ({ task, assigneeName, className = '', onDeleted }) => {
  const [busy, setBusy] = useState(false);
  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const preview = await workTasksApi.deletePreview(task.id);
      if (!preview?.canDelete) {
        toast.error(preview?.reason || 'This task can no longer be deleted. It may already have been deleted.');
        notifyWorkTasksChanged();
        return;
      }
      const done = await confirmTaskDeletion({
        title: task.title, assigneeName: assigneeName ?? preview.assigneeName, status: STATUS_UI[task.status]?.label ?? task.status,
        dueDate: task.dueDate ? fmtDate(task.dueDate) : null,
        alsoRemoved: [countLine(preview.subtasks, 'sub-task'), countLine(preview.updates, 'progress update'), countLine(preview.dailyReports, 'daily report')],
        run: () => workTasksApi.deleteTask(task.id)
      });
      if (!done) return;
      toast.success(`Task deleted: ${task.title}`);
      // every task list and count on the page reloads at once
      notifyWorkTasksChanged();
      notifyWorkUpdatesChanged();
      onDeleted?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={e => void remove(e)} disabled={busy} data-no-open data-testid="task-card-delete" aria-label={`Delete task: ${task.title}`} title="Delete task"
      className={`inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 ${className}`}>
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
    </button>
  );
};
