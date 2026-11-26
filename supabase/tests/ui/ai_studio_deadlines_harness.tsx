import React from 'react';
import { createRoot } from 'react-dom/client';
import { DeadlineChip, ProjectDeadlines } from '../../../src/components/ai-studio/DeadlineClock';
import { TaskList } from '../../../src/components/ai-studio/AiStudioTasks';
import './withAppFeedback';

// The dashboard panel, and the chip a project card shows (the page renders them the same way)
(window as any).mount = (canSet: boolean) => createRoot(document.getElementById('root')!).render(
  <div className="p-4 max-w-3xl space-y-4">
    <ProjectDeadlines canSet={canSet} onManage={() => { (window as any).managed = true; }} />
    <div data-testid="chips">
      <DeadlineChip deadlineAt={(window as any).chipAt} status="ACTIVE" />
      <DeadlineChip deadlineAt={(window as any).chipAt} status="COMPLETED" />
    </div>
  </div>
);

// The task list (Department Head's team view): a row shows the title and the description; clicking the row opens the task with its updates
(window as any).mountTasks = () => createRoot(document.getElementById('root')!).render(
  <div className="p-4"><TaskList scope="team" projects={[]} emptyText="No tasks." /></div>
);
