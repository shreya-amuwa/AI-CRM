import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SalesRole } from '../../../shared/contracts';
import { SalesRoleListPage, SalesRolePersonPage } from '../../../src/components/sales-head/roles/SalesRoleSection';

// the list, and a person's dashboard opened from it (the Sales head dashboard does the same with the address)
const Section: React.FC<{ role: SalesRole }> = ({ role }) => {
  const [id, setId] = useState<string | null>(null);
  return <div className="p-4 max-w-6xl">{id ? <SalesRolePersonPage role={role} id={id} onBack={() => setId(null)} /> : <SalesRoleListPage role={role} onOpen={setId} />}</div>;
};
(window as any).mount = (role: SalesRole) => createRoot(document.getElementById('root')!).render(<Section role={role} />);
