import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialTeamPanel } from '../../../src/components/crocodial/CrocodialTeamPanel';
import { CrocodialActivityPanel } from '../../../src/components/crocodial/CrocodialActivity';

// "My Crocodial Activity" (Team Member / Telecaller / Business Associate) and the managers' view, each with its refresh buttons
(window as any).mountSelf = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><CrocodialActivityPanel showDemos={false} /></div>);
(window as any).mountTeam = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><CrocodialTeamPanel title="Team Crocodial Activity" /></div>);
