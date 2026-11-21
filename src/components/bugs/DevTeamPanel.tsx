import React, { useEffect, useState } from 'react';
import { Bug, Loader2, UserMinus, UserPlus } from 'lucide-react';
import type { DevTeamMember, MeetingDirectoryEntry } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { bugsApi } from '../../lib/api/bugs';
import { meetingsApi } from '../../lib/api/meetings';

/**
 * Super Admin > Settings: who is on the Developers team, i.e. who gets the Bugs section (migration 20270122000300). Seeded with Shreya Mande,
 * Ashish Sinha and Siddhesh Shinde; the Super Admin adds or removes a developer here (the database allows only the Super Admin) but does not
 * get the Bugs section themself.
 */
export const DevTeamPanel: React.FC = () => {
  const [team, setTeam] = useState<DevTeamMember[] | null>(null);
  const [people, setPeople] = useState<MeetingDirectoryEntry[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    bugsApi.team().then(setTeam, e => { setError(errorMessage(e)); setTeam([]); });
    meetingsApi.directory().then(setPeople).catch(() => setPeople([]));
  }, []);
  const change = async (id: string, member: boolean, lead?: boolean) => {
    setBusy(true);
    setError('');
    try { setTeam(await bugsApi.setTeam(id, member, lead)); setPick(''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const candidates = people.filter(p => !p.isCeo && !team?.some(t => t.id === p.id));
  return (
    <section className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4" aria-labelledby="dev-team-heading" data-testid="dev-team-panel">
      <div>
        <h3 id="dev-team-heading" className="text-base font-bold text-slate-900 flex items-center gap-2"><Bug className="w-5 h-5 text-rose-600" aria-hidden /> Developers team (Bugs access)</h3>
        <p className="text-xs text-slate-500 mt-1">Only these people see the Bugs section. Every new bug is seen by all of them; the Team Lead assigns it to one developer, and then only the Team Lead and that developer see it. Removing a developer puts their open bugs back to unassigned. Changes take effect when they next open their dashboard.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
      {!team && !error && <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {team && !team.length && <p className="text-sm text-amber-800">Nobody is on the Developers team yet: add the developers below.</p>}
      <ul className="divide-y divide-slate-100">
        {(team ?? []).map(m => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span><b>{m.name}</b>{m.isLead ? <span className="ml-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">Team Lead</span> : null}
              {m.department ? <span className="text-slate-500"> · {m.department}</span> : null}{!m.active ? <span className="text-amber-700"> · account not active</span> : null}</span>
            <span className="flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => void change(m.id, true, !m.isLead)} className="text-xs font-semibold text-indigo-700 hover:underline disabled:opacity-50">
                {m.isLead ? 'Make developer' : 'Make Team Lead'}
              </button>
              <button type="button" disabled={busy} onClick={() => void change(m.id, false)} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline disabled:opacity-50">
                <UserMinus className="w-3.5 h-3.5" aria-hidden /> Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="dev-team-add" className="sr-only">Add a developer</label>
        <select id="dev-team-add" className="flex-1 min-w-[12rem] rounded-lg border border-slate-300 px-3 py-2 text-sm" value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Choose an employee…</option>
          {candidates.map(p => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
        </select>
        <button type="button" disabled={busy || !pick} onClick={() => void change(pick, true)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          <UserPlus className="w-4 h-4" aria-hidden /> Add developer
        </button>
      </div>
    </section>
  );
};
