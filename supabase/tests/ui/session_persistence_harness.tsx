import React from 'react';
import { createRoot } from 'react-dom/client';
import { useRememberedPage } from '../../../src/hooks/useRememberedPage';
import { forgetRememberedPages } from '../../../src/lib/rememberedPage';

// a dashboard with a menu, the way every dashboard uses the hook
const PAGES = ['overview', 'projects', 'tasks'] as const;
type Page = (typeof PAGES)[number];
const Dashboard: React.FC = () => {
  const [page, setPage] = useRememberedPage<Page>('harness', 'overview', PAGES);
  return (
    <div>
      <nav>{PAGES.map(p => <button key={p} type="button" onClick={() => setPage(p)}>{p}</button>)}</nav>
      <button type="button" onClick={forgetRememberedPages}>sign out</button>
      <main data-testid="page">{page}</main>
    </div>
  );
};
createRoot(document.getElementById('root')!).render(<Dashboard />);
