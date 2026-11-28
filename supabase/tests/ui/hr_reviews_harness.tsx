import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmployeeReviews } from '../../../src/components/hr/reviews/EmployeeReviews';
import { MyReviews } from '../../../src/components/hr/reviews/MyReviews';
import { ReviewOverlay } from '../../../src/components/hr/reviews/ReviewOverlay';
import './withAppFeedback';

// HR > Employee Confirmations / Internship Reviews, and the Department Head's / CEO's "Employee Confirmation Reviews" (docs/hr-dashboard-upgrade.md)
const w = window as any;
w.mountHr = (type: 'PROBATION' | 'INTERNSHIP') => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><EmployeeReviews type={type} /><ReviewOverlay /></div>);
w.mountMine = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><MyReviews showSummary /><ReviewOverlay /></div>);
