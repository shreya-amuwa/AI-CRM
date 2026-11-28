import React from 'react';
import { createRoot } from 'react-dom/client';
import { Paged } from '../../../src/components/common/Paged';
import { ClientPaged } from '../../../src/client/ui';

// newest first, as the feeds arrive from the server
const entries = (n: number, label: string) => Array.from({ length: n }, (_, i) => ({ id: `${label}${i + 1}`, text: `${label} entry ${n - i}` }));

const Feed: React.FC<{ id: string; items: { id: string; text: string }[]; pageSize?: number }> = ({ id, items, pageSize }) => (
  <section data-testid={id} className="border rounded-xl my-4">
    <Paged items={items} pageSize={pageSize} noun="entries">{rows => <ul>{rows.map(r => <li key={r.id}>{r.text}</li>)}</ul>}</Paged>
  </section>
);

const Shrinking: React.FC = () => {
  const [items, setItems] = React.useState(entries(25, 'Shrink'));
  return (
    <section data-testid="shrink">
      <button type="button" onClick={() => setItems(entries(4, 'Shrink'))}>Shrink the list</button>
      <Paged items={items} noun="entries">{rows => <ul>{rows.map(r => <li key={r.id}>{r.text}</li>)}</ul>}</Paged>
    </section>
  );
};

(window as any).mount = () => createRoot(document.getElementById('root')!).render(
  <div className="p-4 max-w-3xl">
    <Feed id="history" items={entries(23, 'History')} />
    <Feed id="recent" items={entries(12, 'Recent')} pageSize={5} />
    <Feed id="short" items={entries(4, 'Short')} />
    <Shrinking />
    <section data-testid="client" className="cd">
      <ClientPaged items={entries(12, 'Client')}>{rows => <ul>{rows.map(r => <li key={r.id}>{r.text}</li>)}</ul>}</ClientPaged>
    </section>
  </div>
);
