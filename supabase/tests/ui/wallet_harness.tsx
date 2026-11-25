import React from 'react';
import { createRoot } from 'react-dom/client';
import { WalletPage } from '../../../src/components/wallet/WalletPage';
import { WalletAdmin } from '../../../src/components/wallet/WalletAdmin';
import './withAppFeedback';

let root: ReturnType<typeof createRoot> | null = null;
const show = (el: React.ReactElement) => { root?.unmount(); root = createRoot(document.getElementById('root')!); root.render(<div className="p-4 max-w-6xl">{el}</div>); };
(window as any).mountWallet = () => show(<WalletPage />);
(window as any).mountAdmin = () => show(<WalletAdmin />);
