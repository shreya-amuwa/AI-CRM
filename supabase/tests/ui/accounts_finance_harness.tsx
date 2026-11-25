import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccountsExpenses } from '../../../src/components/accounts/finance/AccountsExpenses';
import { ClientLoginDetails } from '../../../src/components/support/consultant/ClientLoginDetails';
import './withAppFeedback';

(window as any).mountExpenses = () => createRoot(document.getElementById('root')!).render(<div className="p-3 max-w-6xl"><AccountsExpenses /></div>);
(window as any).mountPanel = () => createRoot(document.getElementById('root')!).render(<div className="p-3 max-w-3xl"><ClientLoginDetails customerId="c1" /></div>);
