import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeadDepartmentsField } from '../../../src/components/scope/HeadDepartmentsField';
import { buildHeadAssignment, type HeadFunction } from '../../../src/lib/scope/headAssignment';

const dep = (id: string, name: string, facetOf: string | null = null, facetDivision: 'SALES' | 'SUPPORT' | null = null) => ({ id, slug: id, name, facetOf, facetDivision });
const departments = [dep('wabastore', 'Wabastore'), dep('whatsbox', 'Whatsbox'), dep('wabastar', 'Wabastar'), dep('dtalk', 'D Talk Corporation'), dep('wabatalk', 'Wabatalk', 'dtalk', 'SUPPORT'), dep('mpillar', 'M Pillar Corporation')];
const both = (id: string) => [{ departmentId: id, division: 'SALES' }, { departmentId: id, division: 'SUPPORT' }];
const teams = [...both('wabastore'), ...both('whatsbox'), { departmentId: 'wabastar', division: 'GENERAL' }, ...both('dtalk'), ...both('mpillar')];

/** The same wiring as the Add Team Member form for a Department Head. */
const Harness: React.FC<{ multi: boolean }> = ({ multi }) => {
  const [fn, setFn] = useState<HeadFunction | ''>('');
  const [selected, setSelected] = useState<string[]>(['wabastore']);
  const plan = buildHeadAssignment({ fn, selectedIds: selected, departments, teams });
  return (
    <form onSubmit={e => e.preventDefault()} className="p-3 max-w-xl">
      <HeadDepartmentsField fn={fn} onFn={setFn} selected={selected} onSelected={setSelected} departments={departments} teams={teams} inputClass="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" multi={multi} />
      <output id="plan" style={{ display: "none" }}>{JSON.stringify(plan)}</output>
    </form>
  );
};
(window as any).mount = (multi = true) => createRoot(document.getElementById('root')!).render(<Harness multi={multi} />);
