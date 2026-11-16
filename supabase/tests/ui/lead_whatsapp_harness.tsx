import React from 'react';
import { createRoot } from 'react-dom/client';
import { LeadWhatsAppSettingsPage, LeadWhatsAppStatus } from '../../../src/components/leads/LeadWhatsApp';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><LeadWhatsAppSettingsPage /></div>);
(window as any).mountStatus = (id: string) => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-xl"><LeadWhatsAppStatus customerId={id} /></div>);
