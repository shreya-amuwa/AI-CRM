import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialAdminPage } from '../../../src/components/crocodial/CrocodialAdminPage';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-5xl"><CrocodialAdminPage /></div>);
