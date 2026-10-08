import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CandidatePortal } from './components/portal/CandidatePortal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { installChunkReload } from './lib/chunkReload';
import './index.css';

installChunkReload();

// Separate, unlocked URL for training candidates: http://localhost:3003/candidate
// This bypasses staff login (AuthProvider) entirely and renders only the
// standalone Candidate Portal. Everything else (the existing staff CRM app,
// including Education & Training -> Candidate Training) is unchanged.
const isCandidateRoute = window.location.pathname.replace(/\/+$/, '') === '/candidate';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isCandidateRoute ? <CandidatePortal /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
