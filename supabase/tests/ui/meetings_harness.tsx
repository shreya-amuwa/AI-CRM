import React from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingsPage } from '../../../src/components/meetings/MeetingsPage';
import PublicBooking from '../../../src/components/meetings/PublicBooking';
import './withAppFeedback';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-5xl"><MeetingsPage /></div>);
(window as any).mountPublic = () => createRoot(document.getElementById('root')!).render(<PublicBooking />);
