import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { RecruiterFilterOptions } from '../../../shared/contracts';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { inputCls, selectCls } from '../team-member/pipeline/shared';
import { STAGE_LABEL, STAGE_ORDER, useLoad } from './ui';

type Field = 'posting' | 'department' | 'designation' | 'dates' | 'search' | 'stage' | 'assessment' | 'interview' | 'recruiter' | 'result';

/** The filters every recruiter list shares. The database applies them inside the caller's own scope. */
export const FilterBar: React.FC<{ value: RecruiterQuery; onChange: (q: RecruiterQuery) => void; fields: Field[]; leadership?: boolean }> = ({ value, onChange, fields, leadership }) => {
  const opts = useLoad<RecruiterFilterOptions>(() => recruiterApi.filterOptions(), []).data;
  const [search, setSearch] = useState(value.search ?? '');
  useEffect(() => { setSearch(value.search ?? ''); }, [value.search]);
  // typing waits a moment before it asks the server
  useEffect(() => {
    if (search === (value.search ?? '')) return;
    const t = setTimeout(() => onChange({ ...value, search: search || undefined, page: 1 }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: RecruiterQuery) => onChange({ ...value, ...patch, page: 1 });
  const has = (f: Field) => fields.includes(f);
  const lbl = 'block text-[11px] font-semibold text-slate-500 mb-1';
  const active = Object.entries(value).some(([k, v]) => !['page', 'pageSize'].includes(k) && v);
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3" aria-label="Filters" onSubmit={e => e.preventDefault()}>
      {has('search') && (
        <div className="min-w-48 flex-1">
          <label className={lbl} htmlFor="rf-search">Search candidate</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <input id="rf-search" className={`${inputCls} !pl-8`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or e-mail" maxLength={120} />
          </div>
        </div>
      )}
      {has('posting') && (
        <div><label className={lbl} htmlFor="rf-posting">Vacancy</label>
          <select id="rf-posting" className={selectCls} value={value.posting ?? ''} onChange={e => set({ posting: e.target.value || undefined })}>
            <option value="">All vacancies</option>{opts?.vacancies.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select></div>
      )}
      {has('department') && (
        <div><label className={lbl} htmlFor="rf-dept">Department</label>
          <select id="rf-dept" className={selectCls} value={value.department ?? ''} onChange={e => set({ department: e.target.value || undefined })}>
            <option value="">All departments</option>{opts?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
      )}
      {has('designation') && (
        <div><label className={lbl} htmlFor="rf-desig">Designation</label>
          <select id="rf-desig" className={selectCls} value={value.designation ?? ''} onChange={e => set({ designation: e.target.value || undefined })}>
            <option value="">All designations</option>{opts?.designations.map(d => <option key={d} value={d}>{d}</option>)}
          </select></div>
      )}
      {has('stage') && (
        <div><label className={lbl} htmlFor="rf-stage">Pipeline stage</label>
          <select id="rf-stage" className={selectCls} value={value.stage ?? ''} onChange={e => set({ stage: (e.target.value || undefined) as RecruiterQuery['stage'] })}>
            <option value="">All stages</option>{STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select></div>
      )}
      {has('assessment') && (
        <div><label className={lbl} htmlFor="rf-assess">Assessment</label>
          <select id="rf-assess" className={selectCls} value={value.assessment ?? ''} onChange={e => set({ assessment: (e.target.value || undefined) as RecruiterQuery['assessment'] })}>
            <option value="">Any</option><option value="NONE">Not invited</option><option value="PENDING">Pending</option><option value="PASSED">Passed</option><option value="FAILED">Failed</option>
          </select></div>
      )}
      {has('interview') && (
        <div><label className={lbl} htmlFor="rf-int">Interview</label>
          <select id="rf-int" className={selectCls} value={value.interview ?? ''} onChange={e => set({ interview: (e.target.value || undefined) as RecruiterQuery['interview'] })}>
            <option value="">Any</option><option value="NONE">None</option><option value="SCHEDULED">Scheduled</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
          </select></div>
      )}
      {has('result') && (
        <div><label className={lbl} htmlFor="rf-result">Selection result</label>
          <select id="rf-result" className={selectCls} value={value.result ?? ''} onChange={e => set({ result: (e.target.value || undefined) as RecruiterQuery['result'] })}>
            <option value="">Any</option><option value="PENDING">Undecided</option><option value="SELECTED">Selected</option><option value="REJECTED">Rejected</option><option value="ON_HOLD">On hold</option>
          </select></div>
      )}
      {has('recruiter') && leadership && (
        <div><label className={lbl} htmlFor="rf-rec">Recruiter</label>
          <select id="rf-rec" className={selectCls} value={value.recruiter ?? ''} onChange={e => set({ recruiter: e.target.value || undefined })}>
            <option value="">All recruiters</option>{opts?.recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></div>
      )}
      {has('dates') && (
        <>
          <div><label className={lbl} htmlFor="rf-from">Applied from</label><input id="rf-from" type="date" className={inputCls} value={value.from ?? ''} max={value.to} onChange={e => set({ from: e.target.value || undefined })} /></div>
          <div><label className={lbl} htmlFor="rf-to">Applied to</label><input id="rf-to" type="date" className={inputCls} value={value.to ?? ''} min={value.from} onChange={e => set({ to: e.target.value || undefined })} /></div>
        </>
      )}
      {active && <button type="button" className="pb-2 text-xs font-semibold text-indigo-700 hover:underline" onClick={() => { setSearch(''); onChange({ page: 1 }); }}>Clear filters</button>}
    </form>
  );
};
