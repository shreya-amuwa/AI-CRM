import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialTeamPanel } from '../../../src/components/crocodial/CrocodialTeamPanel';
import { CrocodialLeadsPanel } from '../../../src/components/crocodial/CrocodialLeads';
import './withAppFeedback';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><CrocodialTeamPanel /></div>);
// "My Crocodial Leads" in a Team Lead's / head's side panel (shows a note when the person is not connected)
(window as any).mountLeads = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><CrocodialLeadsPanel title="My Crocodial Leads" hideWhenOff={false} /></div>);
