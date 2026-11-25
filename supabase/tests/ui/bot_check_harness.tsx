import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBotCheck } from '../../../src/components/auth/useBotCheck';
import { NewLinkRequest } from '../../../src/components/auth/NewLinkRequest';
import './withAppFeedback';

/** Like the client sign-in page: the hook lives in the page, the robot check only appears once "Forgot password?" is opened. */
const LaterForm: React.FC = () => {
  const [open, setOpen] = useState(false);
  const bot = useBotCheck('reset');
  return (
    <div>
      <button type="button" data-testid="open-forgot" onClick={() => setOpen(o => !o)}>{open ? 'Back' : 'Forgot password?'}</button>
      {open && <div data-testid="forgot-area">{bot.element}<span data-testid="ready">{String(bot.ready)}</span><span data-testid="token">{bot.headers['x-turnstile-token'] ?? ''}</span></div>}
    </div>
  );
};
(window as any).mountLater = () => createRoot(document.getElementById('root')!).render(<LaterForm />);
(window as any).mountNewLink = () => createRoot(document.getElementById('root')!).render(<NewLinkRequest endpoint="/client-auth/forgot-password" />);
