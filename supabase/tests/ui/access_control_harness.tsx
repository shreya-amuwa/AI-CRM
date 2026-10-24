import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccessControlTab } from '../../../src/components/scope/AccessControlTab';

const Harness: React.FC = () => {
  const [saves, setSaves] = React.useState(0);
  return (
    <div className="p-3 max-w-4xl">
      <AccessControlTab onSaved={() => setSaves(n => n + 1)} />
      <output id="saves" style={{ display: 'none' }}>{saves}</output>
    </div>
  );
};
(window as any).mount = () => createRoot(document.getElementById('root')!).render(<Harness />);
