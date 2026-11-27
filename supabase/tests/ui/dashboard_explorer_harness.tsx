// Dashboard Explorer harness: the real Explorer page (list, preview workspace, toolbar, Suggest Improvement) with the API client replaced by
// dashboard_explorer_api_stub.ts (it records what the page sends). The preview frame is the REAL built preview bundle (/dashboard-preview/).
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../../src/index.css';
import { AppFeedbackProvider } from '../../../src/components/feedback/AppFeedback';
import { DashboardExplorer } from '../../../src/components/dashboard-explorer/DashboardExplorer';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppFeedbackProvider><div className="p-4"><DashboardExplorer /></div></AppFeedbackProvider>
);
