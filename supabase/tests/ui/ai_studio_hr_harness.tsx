import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiStudioHrPerformance } from '../../../src/components/hr/AiStudioHrPerformance';
import { DailyReportForm } from '../../../src/components/ai-studio/DailyReportForm';
import './withAppFeedback';

// HR > AI Studio Performance, and the Team Member's daily report form (its word counter), against an in-page API stand-in
(window as any).mountHr = () => createRoot(document.getElementById('root')!).render(<div className="p-3"><AiStudioHrPerformance /></div>);
(window as any).mountForm = () => createRoot(document.getElementById('root')!).render(<div className="p-3"><DailyReportForm onDone={() => { (window as any).__done = true; }} /></div>);
