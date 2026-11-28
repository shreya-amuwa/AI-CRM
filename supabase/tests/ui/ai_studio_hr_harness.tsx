import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiStudioHrPerformance } from '../../../src/components/hr/AiStudioHrPerformance';
import { DailyReportForm } from '../../../src/components/ai-studio/DailyReportForm';
import { AdminWeeklyReports, LeadWeeklyReport } from '../../../src/components/ai-studio/AiStudioWeekly';
import './withAppFeedback';

// HR > AI Studio Performance, and the Team Member's daily report form (its word counter), against an in-page API stand-in
(window as any).mountHr = () => createRoot(document.getElementById('root')!).render(<div className="p-3"><AiStudioHrPerformance /></div>);
(window as any).mountForm = () => createRoot(document.getElementById('root')!).render(<div className="p-3"><DailyReportForm onDone={() => { (window as any).__done = true; }} /></div>);

// (20270308000100) the AI Studio weekly report: the Team Lead writes it, the Super Admin receives it
(window as any).mountWeeklyLead = () => createRoot(document.getElementById('root')!).render(<div className="p-3"><LeadWeeklyReport /></div>);
(window as any).mountWeeklyAdmin = () => createRoot(document.getElementById('root')!).render(<div className="p-3"><AdminWeeklyReports /></div>);
