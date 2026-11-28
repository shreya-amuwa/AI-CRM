import React from 'react';
import { createRoot } from 'react-dom/client';
import { TelecallerPerformance } from '../../../src/components/hr/performance/TelecallerPerformance';
import { MyCallPerformance } from '../../../src/components/hr/performance/TelecallerProfile';
import { HrUpgradeOverview } from '../../../src/components/hr/HrUpgradeOverview';
import { OPEN_HR_TAB_EVENT } from '../../../src/components/hr/hrTabEvents';
import './withAppFeedback';

// HR / managers > Telecaller Performance, the Telecaller's My Call Performance, and the HR overview cards (docs/hr-dashboard-upgrade.md, Phases 3 and 5)
const w = window as any;
w.openedTabs = [];
window.addEventListener(OPEN_HR_TAB_EVENT, e => w.openedTabs.push((e as CustomEvent<string>).detail));
w.mountPerf = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><TelecallerPerformance /></div>);
w.mountMine = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><MyCallPerformance profileId="t1" /></div>);
w.mountOverview = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><HrUpgradeOverview /></div>);
