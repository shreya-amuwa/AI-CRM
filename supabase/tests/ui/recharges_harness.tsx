import React from 'react';
import { createRoot } from 'react-dom/client';
import { RechargesPage } from '../../../src/components/recharges/RechargesPage';
import { RechargeVerification } from '../../../src/components/recharges/RechargeVerification';
import './withAppFeedback';

let root: ReturnType<typeof createRoot> | null = null;
const show = (el: React.ReactElement) => { root?.unmount(); root = createRoot(document.getElementById('root')!); root.render(<div className="p-3 sm:p-4 max-w-7xl">{el}</div>); };
(window as any).mountRecharges = () => show(<RechargesPage />);
(window as any).mountVerification = () => show(<RechargeVerification />);
