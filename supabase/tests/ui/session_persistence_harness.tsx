import React from 'react';
import { createRoot } from 'react-dom/client';
import { useRememberedPage } from '../../../src/hooks/useRememberedPage';
import { useRememberedOverlay } from '../../../src/hooks/useRememberedOverlay';
import { forgetRememberedPages } from '../../../src/lib/rememberedPage';

// a dashboard with a menu, the way every dashboard uses the hook; Attendance / Meeting Request / Bugs are overlays on top of it, as in the
// real shell (choosing one of the dashboard's own pages hands the content area back)
const PAGES = ['overview', 'projects', 'tasks'] as const;
type Page = (typeof PAGES)[number];
const OVERLAYS = ['__attendance', '__meetings', '__bugs'] as const;
type Overlay = (typeof OVERLAYS)[number];
const Dashboard: React.FC = () => {
  const [page, setPage] = useRememberedPage<Page>('harness', 'overview', PAGES);
  // a notification or link can ask for a page (?open=meetings), which wins over the remembered one
  const requested: Overlay | null = new URLSearchParams(window.location.search).get('open') === 'meetings' ? '__meetings' : null;
  const [overlay, setOverlay] = useRememberedOverlay<Overlay>(OVERLAYS, requested);
  return (
    <div>
      <nav>
        <button type="button" onClick={() => setOverlay('__attendance')}>Attendance</button>
        <button type="button" onClick={() => setOverlay('__meetings')}>Meeting Request</button>
        <button type="button" onClick={() => setOverlay('__bugs')}>Bugs</button>
        {PAGES.map(p => <button key={p} type="button" onClick={() => { setOverlay(null); setPage(p); }}>{p}</button>)}
      </nav>
      <button type="button" onClick={forgetRememberedPages}>sign out</button>
      <main data-testid="page">{overlay ?? page}</main>
    </div>
  );
};
createRoot(document.getElementById('root')!).render(<Dashboard />);
