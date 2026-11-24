// Mounts the real Offer Letter workspace (HR > Offer Letter Generation) for the browser test; the CRM API is answered by the test (page.route).
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OfferLetterWorkspace } from '../../../src/components/hr/offers/OfferLetterWorkspace';

const EMPLOYEES = [
  { id: 'HR-1', profileId: null, name: 'Ritika Offer', designation: 'Executive', status: 'Full-Time' },
  { id: 'HR-2', profileId: null, name: 'Arun Second', designation: 'Executive', status: 'Full-Time' }
] as never[];
let root: Root | null = null;
(window as any).mount = () => {
  root?.unmount();
  root = createRoot(document.getElementById('root')!);
  root.render(<OfferLetterWorkspace employees={EMPLOYEES} onToast={m => { (window as any).__toast = m; }} />);
};
