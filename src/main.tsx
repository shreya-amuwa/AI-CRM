import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CandidatePortal } from './components/portal/CandidatePortal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { DocumentationRedirect } from './components/common/DocumentationRedirect';
import { installChunkReload } from './lib/chunkReload';
import './index.css';

const ClientApp = React.lazy(() => import('./client/ClientApp'));

installChunkReload();

// Separate, unlocked URL for training candidates: http://localhost:3003/candidate
// This bypasses staff login (AuthProvider) entirely and renders only the
// standalone Candidate Portal. Everything else (the existing staff CRM app,
// including Education & Training -> Candidate Training) is unchanged.
const isCandidateRoute = window.location.pathname.replace(/\/+$/, '') === '/candidate';

// The customers' own dashboard: /client/login and /client/dashboard/*. Separate sign-in, separate bundle.
// The user documentation: /documentation forwards to the GitBook. Public, so it needs no sign-in.
const isDocumentationRoute = /^\/documentation(\/|$)/.test(window.location.pathname);

const isClientRoute = /^\/client(\/|$)/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isDocumentationRoute ? <DocumentationRedirect /> : isCandidateRoute ? <CandidatePortal /> : isClientRoute ? (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}><ClientApp /></React.Suspense>
      ) : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
