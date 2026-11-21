import React from 'react';
import { createRoot } from 'react-dom/client';
import { IncomePage } from '../../../src/components/income/IncomePage';
import { IncentiveSetup } from '../../../src/components/income/IncentiveSetup';
import { DemoSchedulePage } from '../../../src/components/business-associate/DemoSchedulePage';

const root = () => createRoot(document.getElementById('root')!);
(window as any).mountIncome = () => root().render(<div className="p-4 max-w-6xl"><IncomePage /></div>);
(window as any).mountSetup = (role: 'sa' | 'tl' | 'dh') => { (window as any).__state.role = role; root().render(<div className="p-4 max-w-6xl"><IncentiveSetup /></div>); };
(window as any).mountDemos = () => root().render(<div className="p-4 max-w-6xl"><DemoSchedulePage go={() => undefined} /></div>);
