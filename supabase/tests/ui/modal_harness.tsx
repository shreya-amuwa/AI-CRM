import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog } from '../../../src/components/team-member/pipeline/shared';
import './withAppFeedback';

// The shared Dialog with content of every awkward kind: very tall, very wide, long unbreakable words, a table, and a second dialog on top.
const Tall: React.FC = () => (
  <div className="space-y-3" data-testid="tall">
    {Array.from({ length: 40 }, (_, i) => (
      <div key={i} className="rounded-xl border border-slate-200 p-3 text-sm" data-testid="block">
        <b>Project {i + 1}</b> · Task with a long description that wraps over several lines on a narrow phone screen so that the report is taller than the screen.
        <div className="mt-1 text-xs text-slate-500">https://example.com/a/very/long/linked/resource/path/that/has/no/spaces/and/keeps/going/{'x'.repeat(80)}</div>
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 mt-2">{Array.from({ length: 7 }, (_, j) => <div key={j} className="rounded border p-1 text-[11px]">Cell {j}</div>)}</div>
      </div>
    ))}
    <div className="overflow-x-auto"><table className="text-xs"><tbody><tr>{Array.from({ length: 12 }, (_, k) => <td key={k} className="border px-4 py-1 whitespace-nowrap">Wide column {k}</td>)}</tr></tbody></table></div>
    <div className="flex justify-end gap-2"><button type="button" data-testid="bottom-action" onClick={() => { (window as any).__clicked = ((window as any).__clicked ?? 0) + 1; }} className="px-3 py-2 rounded bg-indigo-600 text-white text-xs">Close</button></div>
  </div>
);

const App: React.FC = () => {
  const [open, setOpen] = useState<'none' | 'short' | 'tall'>('none');
  const [inner, setInner] = useState(false);
  (window as any).openDialog = (k: 'short' | 'tall') => setOpen(k);
  (window as any).openInner = () => setInner(true);
  return (
    <div>
      <div style={{ height: 3000 }} data-testid="page-filler">page behind the dialog</div>
      {open === 'short' && <Dialog title="A short dialog" onClose={() => setOpen('none')}><p>Short.</p><button type="button" onClick={() => setInner(true)}>Open another</button></Dialog>}
      {open === 'tall' && (
        <Dialog title="Daily report · 26 Nov 2026 with a long title that goes on and on for a phone" description="A Member · Team Member · AI Studio Team" onClose={() => setOpen('none')} wide>
          <Tall />
          <button type="button" data-testid="open-inner" onClick={() => setInner(true)}>Open a task</button>
        </Dialog>
      )}
      {inner && <Dialog title="Task" onClose={() => setInner(false)} size="xl"><p data-testid="inner-body">Task details</p><button type="button" onClick={() => setInner(false)}>Close task</button></Dialog>}
    </div>
  );
};
createRoot(document.getElementById('root')!).render(<App />);
