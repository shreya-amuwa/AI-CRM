import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientLogins } from '../../../src/components/accounts/ClientLogins';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-3 max-w-6xl"><ClientLogins /></div>);
