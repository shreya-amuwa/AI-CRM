import React from 'react';
import { createRoot } from 'react-dom/client';
import ClientApp from '../../../src/client/ClientApp';
import './withAppFeedback';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<ClientApp />);
