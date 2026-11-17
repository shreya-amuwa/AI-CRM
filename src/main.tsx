import './instrument'; // error reporting: first, so that start-up errors are caught (does nothing without VITE_SENTRY_DSN)
import React from 'react';
import ReactDOM from 'react-dom/client';
const StaffApp = React.lazy(() => import('./App'));
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { installChunkReload } from './lib/chunkReload';
import './index.css';

const ClientApp = React.lazy(() => import('./client/ClientApp'));
const PublicBooking = React.lazy(() => import('./components/meetings/PublicBooking'));
const StaffSetPassword = React.lazy(() => import('./components/auth/StaffSetPassword').then(m => ({ default: m.StaffSetPassword })));

installChunkReload();

// The candidate portal (/candidate) and the public careers pages (/careers) are no longer served on the CRM domain; old links and bookmarks
// land on the CRM's own home page. The candidate API and the HR recruitment screens are unchanged.
if (/^\/(candidate|careers)(\/|$)/.test(window.location.pathname)) window.location.replace('/');

// The customers' own dashboard: /client/login and /client/dashboard/*. Separate sign-in, separate bundle.
// The user documentation is a static site served at /documentation/ (built with the app). Only the address without the closing slash
// reaches the app, so send it on.
if (window.location.pathname === '/documentation') window.location.replace('/documentation/' + window.location.search + window.location.hash);
// The Privacy Policy and Terms of Service are static pages too (public/privacy/, public/terms/): no sign-in, no script.
if (window.location.pathname === '/privacy' || window.location.pathname === '/terms') window.location.replace(window.location.pathname + '/' + window.location.search + window.location.hash);

// A set-password link that Supabase could not send to our page (expired or already used) lands on the site's main address with
// #error=...otp_expired. Show the client the friendly "this link has expired" page instead of the staff sign-in.
if (!/^\/client(\/|$)/.test(window.location.pathname) && /error_code=otp_expired/.test(window.location.hash)) {
  window.location.replace('/client/set-password' + window.location.hash);
}

const isClientRoute = /^\/client(\/|$)/.test(window.location.pathname);
// The new employee's welcome e-mail opens /set-password: one standalone page where they choose their own password (no staff sign-in needed first).
const isStaffSetPassword = window.location.pathname.replace(/\/+$/, '') === '/set-password';
// Booking links (/book/<link>) and the guest's private link (/book/manage/<token>): public pages, no sign-in, their own small bundle.
const isPublicBooking = /^\/book\/[^/]+/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isPublicBooking ? (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}><PublicBooking /></React.Suspense>
      ) : isStaffSetPassword ? (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}><StaffSetPassword /></React.Suspense>
      ) : isClientRoute ? (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}><ClientApp /></React.Suspense>
      ) : <React.Suspense fallback={<div style={{ padding: 24 }}>Loading workspace…</div>}><StaffApp /></React.Suspense>}
    </ErrorBoundary>
  </React.StrictMode>
);
