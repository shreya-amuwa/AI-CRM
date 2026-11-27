import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { AppFeedbackProvider } from '../components/feedback/AppFeedback';
import { watchOverlays } from '../lib/overlayScrollLock';
import type { PreviewLaunch } from '../../shared/dashboardExplorer';
import { insideExplorer, onLaunch, postToParent } from './runtime/bridge';
import { buildPreviewIdentity } from './runtime/previewIdentity';
import { setPreviewIdentity } from './runtime/PreviewAuthContext';
import { startDemo } from './runtime/demoStore';
import { loadFixtures } from './fixtures';

/**
 * The preview runtime (docs/DASHBOARD_EXPLORER.md). Waits for Dashboard Explorer's launch message (dashboard, department, scenario), builds
 * the synthetic identity and the demonstration data, then renders the production App: the production role mapping and routing choose the
 * dashboard. A new launch (another position, department, scenario, or Reset) throws everything away and starts again.
 */
const App = React.lazy(() => import('../App'));
const root = ReactDOM.createRoot(document.getElementById('root')!);
watchOverlays();

const Notice: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div role="alert" className="min-h-screen flex items-center justify-center p-6">
    <div className="max-w-md bg-white border border-slate-200 rounded-2xl p-6 text-center">
      <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  </div>
);

// the page the dashboard shows, for the toolbar and for "Suggest Improvement"
// throttled, not debounced: a page that keeps updating its address (replaceState while it renders) must still be reported within 350 ms
let pageTimer: ReturnType<typeof setTimeout> | undefined;
let lastPage = '';
const reportPage = () => {
  if (pageTimer) return;
  pageTimer = setTimeout(() => {
    pageTimer = undefined;
    const active = document.querySelector('[aria-current="page"]');
    const title = (active?.textContent || document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const path = location.pathname.slice(0, 300);
    if (`${path}|${title}` === lastPage) return;
    lastPage = `${path}|${title}`;
    postToParent({ type: 'crm-preview:page', path, title });
  }, 350);
};
for (const name of ['pushState', 'replaceState'] as const) {
  const original = history[name].bind(history);
  history[name] = (...args: Parameters<History['pushState']>) => { original(...args); reportPage(); };
}
window.addEventListener('popstate', reportPage);
document.addEventListener('click', reportPage, true);

async function launch(l: PreviewLaunch) {
  const identity = buildPreviewIdentity(l.dashboardId, l.department);
  if (!identity) {
    root.render(<Notice title="This preview is not available" body="Choose a position and a department from Dashboard Explorer." />);
    return;
  }
  root.render(<Notice title="Preparing the demonstration…" body={`${identity.entry.position} · ${identity.department.name}`} />);
  startDemo(identity, l.scenario, await loadFixtures(identity.entry.datasets));
  setPreviewIdentity({ profile: identity.profile, scopes: identity.scopes });
  // a fresh start: nothing remembered from the previous preview (pages, filters, drafts) and the dashboard's own first page
  localStorage.clear();
  sessionStorage.clear();
  lastPage = '';
  history.replaceState(null, '', '/');
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppFeedbackProvider>
          <React.Suspense fallback={<Notice title="Loading the dashboard…" body="Demonstration data only." />}>
            <App key={`${l.epoch}:${l.dashboardId}:${l.department}:${l.scenario}`} />
          </React.Suspense>
        </AppFeedbackProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
  reportPage();
}

if (!insideExplorer()) {
  root.render(<Notice title="Dashboard preview" body="This page opens only inside Dashboard Explorer, for the Managing Director. It shows demonstration data and never the live CRM." />);
} else {
  onLaunch(l => void launch(l));
  postToParent({ type: 'crm-preview:ready' });
}
