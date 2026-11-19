import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialTeamPanel } from '../../../src/components/crocodial/CrocodialTeamPanel';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><CrocodialTeamPanel /></div>);
