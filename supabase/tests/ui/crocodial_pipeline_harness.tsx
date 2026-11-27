import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialLeadPipeline } from '../../../src/components/crocodial/CrocodialLeadPipeline';
import { CrocodialLeadActivityCard } from '../../../src/components/crocodial/CrocodialLeadActivityCard';
import './withAppFeedback';

// the Super Admin's "Leads in the CRM pipeline" (one connection) and a lead page's "Crocodial activity" (20270304000100)
(window as any).mountPipeline = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><CrocodialLeadPipeline connectionId="c1" /></div>);
(window as any).mountLead = (id: string) => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><CrocodialLeadActivityCard customerId={id} /></div>);
