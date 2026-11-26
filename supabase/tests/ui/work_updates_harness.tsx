import React from 'react';
import { createRoot } from 'react-dom/client';
import { MyUpdateRequests, TaskWorkUpdates, WorkUpdatesPanel } from '../../../src/components/tasks/WorkUpdates';
import './withAppFeedback';

const root = () => createRoot(document.getElementById('root')!);
(window as any).mountManager = () => root().render(<div className="p-4 max-w-4xl"><WorkUpdatesPanel /></div>);
(window as any).mountEmployee = () => root().render(<div className="p-4 max-w-4xl"><MyUpdateRequests /></div>);
(window as any).mountTask = (taskId: string) => root().render(<div className="p-4 max-w-4xl"><TaskWorkUpdates taskId={taskId} assigneeName="Nina Member" startOpen /></div>);
