import React from 'react';
import { createRoot } from 'react-dom/client';
import { DailyReportForm } from '../../../src/components/ai-studio/DailyReportForm';
import { ReportDialog } from '../../../src/components/ai-studio/AiStudioReports';
import './withAppFeedback';

// The consolidated daily report form (an employee), and a submitted report as the Department Head opens it
(window as any).mountForm = () => createRoot(document.getElementById('root')!).render(
  <div className="p-3 sm:p-6 max-w-5xl"><DailyReportForm onDone={r => { (window as any).done = r; }} /></div>
);
(window as any).mountReport = (id: string) => createRoot(document.getElementById('root')!).render(
  <ReportDialog id={id} onClose={() => { (window as any).closed = true; }} />
);
