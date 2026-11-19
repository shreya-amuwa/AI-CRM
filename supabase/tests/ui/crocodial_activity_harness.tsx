import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialActivityPanel } from '../../../src/components/crocodial/CrocodialActivity';

(window as any).mount = (props: Record<string, unknown> = {}) =>
  createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-5xl"><p>Home</p><CrocodialActivityPanel {...props} /></div>);
