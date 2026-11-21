import React from 'react';
import { createRoot } from 'react-dom/client';
import { IncomePage } from '../../../src/components/income/IncomePage';
import { PayoutRequests } from '../../../src/components/accounts/finance/PayoutRequests';

const root = () => createRoot(document.getElementById('root')!);
(window as any).mountIncome = () => root().render(<div className="p-4 max-w-6xl"><IncomePage /></div>);
(window as any).mountAccounts = () => root().render(<div className="p-4 max-w-6xl"><PayoutRequests /></div>);
