import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CandidatePortal } from './components/portal/CandidatePortal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { installChunkReload } from './lib/chunkReload';
import './index.css';

const ClientApp = React.lazy(() => import('./client/ClientApp'));
const StaffSetPassword = React.lazy(() => import('./components/auth/StaffSetPassword').then(m => ({ default: m.StaffSetPassword })));

installChunkReload();

// Separate, unlocked URL for training candidates: http://localhost:3003/candidate
// This bypasses staff login (AuthProvider) entirely and renders only the
// standalone Candidate Portal. Everything else (the existing staff CRM app,
// including Education & Training -> Candidate Training) is unchanged.
const isCandidateRoute = window.location.pathname.replace(/\/+$/, '') === '/candidate';

// The customers' own dashboard: /client/login and /client/dashboard/*. Separate sign-in, separate bundle.
// The user documentation is a static site served at /documentation/ (built with the app). Only the address without the closing slash
// reaches the app, so send it on.
if (window.location.pathname === '/documentation') window.location.replace('/documentation/' + window.location.search + window.location.hash);

// A set-password link that Supabase could not send to our page (expired or already used) lands on the site's main address with
// #error=...otp_expired. Show the client the friendly "this link has expired" page instead of the staff sign-in.
if (!/^\/client(\/|$)/.test(window.location.pathname) && /error_code=otp_expired/.test(window.location.hash)) {
  window.location.replace('/client/set-password' + window.location.hash);
}

const isClientRoute = /^\/client(\/|$)/.test(window.location.pathname);
// The new employee's welcome e-mail opens /set-password: one standalone page where they choose their own password (no staff sign-in needed first).
const isStaffSetPassword = window.location.pathname.replace(/\/+$/, '') === '/set-password';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isCandidateRoute ? <CandidatePortal /> : isStaffSetPassword ? (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}><StaffSetPassword /></React.Suspense>
      ) : isClientRoute ? (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}><ClientApp /></React.Suspense>
      ) : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
