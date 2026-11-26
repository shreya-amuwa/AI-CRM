// Browser-test pages: the CRM's in-app feedback (toasts, confirmation and input dialogs) is drawn by <AppFeedbackProvider>, which the app
// mounts once in src/main.tsx. Test pages mount single components, so importing this file mounts the provider on its own root next to them.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppFeedbackProvider } from '../../../src/components/feedback/AppFeedback';

if (typeof document !== 'undefined' && !document.getElementById('app-feedback-root')) {
  const el = document.createElement('div');
  el.id = 'app-feedback-root';
  document.body.appendChild(el);
  createRoot(el).render(<AppFeedbackProvider>{null}</AppFeedbackProvider>);
}
