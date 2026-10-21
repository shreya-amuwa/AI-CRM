import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Search, User, Users } from 'lucide-react';
import { nameOf } from '../TaskParts';
import type { WorkTaskData } from '../../../lib/workTasks';
import type { HeadPage } from './HeadOverview';

export interface PageEntry {
  id: HeadPage;
  label: string;
}

/** Top-bar search: finds pages, tasks and people from the loaded data, and hands anything else to the customer search. */
export const HeadSearch: React.FC<{
  data: WorkTaskData;
  pages: PageEntry[];
  onPage: (p: HeadPage) => void;
  onTask: (query: string) => void;
  onCustomers: (query: string) => void;
}> = ({ data, pages, onPage, onTask, onCustomers }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const term = q.trim().toLowerCase();
  const found = useMemo(() => {
    if (!term) return { pages: [] as PageEntry[], tasks: [] as { id: string; title: string; who: string }[], people: [] as { id: string; name: string; role: string }[] };
    return {
      pages: pages.filter(p => p.label.toLowerCase().includes(term)).slice(0, 4),
      tasks: data.tasks
        .filter(t => t.parentId === null && t.title.toLowerCase().includes(term))
        .slice(0, 4)
        .map(t => ({ id: t.id, title: t.title, who: nameOf(data.people, t.assigneeId) })),
      people: data.people
        .filter(p => p.role !== 'SUPER_ADMIN' && p.fullName.toLowerCase().includes(term))
        .slice(0, 4)
        .map(p => ({ id: p.id, name: p.fullName, role: p.role === 'TEAM_HEAD' ? 'Team lead' : p.role === 'TEAM_MEMBER' ? 'Team member' : 'Department head' }))
    };
  }, [term, pages, data.tasks, data.people]);

  const done = () => {
    setOpen(false);
    setQ('');
  };
  const row = 'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50';

  return (
    <div ref={box} className="relative w-full max-w-md">
      <label className="relative block">
        <span className="sr-only">Search tasks, people, customers and pages</span>
        <Search className="w-[18px] h-[18px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={e => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && term) {
              onCustomers(q.trim());
              done();
            }
          }}
          placeholder="Search tasks, people, customers"
          className="w-full h-11 pl-10 pr-3 text-ellipsis rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
        />
      </label>
      {open && term && (
        <div className="absolute left-0 right-0 top-12 max-sm:fixed max-sm:left-3 max-sm:right-3 max-sm:top-[4.25rem] bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-40 max-h-96 overflow-y-auto" role="listbox" aria-label="Search results">
          {found.pages.map(p => (
            <button key={p.id} type="button" className={row} onClick={() => { onPage(p.id); done(); }}>
              <Search className="w-4 h-4 text-slate-400" aria-hidden="true" /> <span>Go to <b>{p.label}</b></span>
            </button>
          ))}
          {found.tasks.map(t => (
            <button key={t.id} type="button" className={row} onClick={() => { onTask(t.title); done(); }}>
              <ClipboardList className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 truncate"><b>{t.title}</b> <span className="text-slate-500">· {t.who}</span></span>
            </button>
          ))}
          {found.people.map(p => (
            <button key={p.id} type="button" className={row} onClick={() => { onTask(p.name); done(); }}>
              <User className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span><b>{p.name}</b> <span className="text-slate-500">· {p.role}</span></span>
            </button>
          ))}
          <button type="button" className={`${row} border-t border-slate-100`} onClick={() => { onCustomers(q.trim()); done(); }}>
            <Users className="w-4 h-4 text-slate-400" aria-hidden="true" /> <span>Search customers for “<b>{q.trim()}</b>”</span>
          </button>
        </div>
      )}
    </div>
  );
};
