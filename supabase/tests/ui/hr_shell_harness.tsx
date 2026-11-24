// Mounts the real HR dashboard chrome the way App.tsx does (Header, Sidebar, main) around the real HR pages, for the HR shell browser test.
import React, { Suspense, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Header } from '../../../src/components/layout/Header';
import { Sidebar, type ActiveTab } from '../../../src/components/layout/Sidebar';
import { HRDepartmentPanel } from '../../../src/components/departments/hr/HRDepartmentPanel';
import { mainClassFor } from '../../../src/components/layout/mainLayout';

const Shell: React.FC = () => {
  const [tab, setTab] = useState<ActiveTab>('dashboard');
  (window as any).__tab = tab;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <Header showMenu />
      <div className="flex flex-1">
        <Sidebar activeTab={tab} onSelectTab={t => setTab(t)} departmentId="hr" />
        <main className={mainClassFor(tab, 'hr')}>
          <Suspense fallback={<p>Loading…</p>}>
            {tab === 'dashboard' || tab === 'hr_ops' ? <HRDepartmentPanel activeTab={tab} /> : <p data-page={tab}>Page: {tab}</p>}
          </Suspense>
        </main>
      </div>
    </div>
  );
};

let root: Root | null = null;
(window as any).mount = () => {
  root?.unmount();
  root = createRoot(document.getElementById('root')!);
  root.render(<Shell />);
};
