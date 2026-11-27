import React from 'react';
import { createRoot } from 'react-dom/client';
import { RechargesPage } from '../../../src/components/recharges/RechargesPage';
import './withAppFeedback';

let root: ReturnType<typeof createRoot> | null = null;
(window as any).mountRecharges = () => { root?.unmount(); root = createRoot(document.getElementById('root')!); root.render(<div className="p-3 sm:p-4 max-w-7xl"><RechargesPage /></div>); };
