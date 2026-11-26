import React from 'react';
import { createRoot } from 'react-dom/client';
import { StaffForgotPassword } from '../../../src/components/auth/StaffForgotPassword';
import { StaffSetPassword } from '../../../src/components/auth/StaffSetPassword';
import './withAppFeedback';

(window as any).mountForgot = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-sm"><StaffForgotPassword initialEmail="Asha@Amuwa.com" onBack={() => { (window as any).__back = true; }} /></div>);
(window as any).mountSet = () => createRoot(document.getElementById('root')!).render(<StaffSetPassword />);
