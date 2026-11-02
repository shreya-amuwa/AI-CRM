import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
const CandidateApp = React.lazy(() => import('./candidate/CandidateApp'));
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { installChunkReload } from './lib/chunkReload';
import './index.css';

const ClientApp = React.lazy(() => import('./client/ClientApp'));

installChunkReload();

// Candidate and public careers screens have independent authentication and a lazy bundle.
const isCandidateRoute = /^\/(candidate|careers)(\/|$)/.test(window.location.pathname);

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isCandidateRoute ? <React.Suspense fallback={<div style={{ padding: 24 }}>Loading candidate portal…</div>}><CandidateApp /></React.Suspense> : isClientRoute ? (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}><ClientApp /></React.Suspense>
      ) : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
