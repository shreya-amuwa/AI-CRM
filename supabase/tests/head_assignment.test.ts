/** Add Team Member for a Department Head: which departments / functions the form sends (no database). */
import { buildHeadAssignment, offers, whyNot, type AssignableDepartment, type AssignableTeam } from '../../src/lib/scope/headAssignment.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const d = (id: string, facetOf: string | null = null, facetDivision: 'SALES' | 'SUPPORT' | null = null): AssignableDepartment => ({ id, slug: id, name: id.toUpperCase(), facetOf, facetDivision });
const both = (id: string): AssignableTeam[] => [{ departmentId: id, division: 'SALES' }, { departmentId: id, division: 'SUPPORT' }];
// wabastore, whatsbox, wabastar(General only), dtalk (+ its Support side Wabatalk), mpillar
const deps = [d('wabastore'), d('whatsbox'), d('wabastar'), d('dtalk'), d('wabatalk', 'dtalk', 'SUPPORT'), d('mpillar')];
const teams = [...both('wabastore'), ...both('whatsbox'), { departmentId: 'wabastar', division: 'GENERAL' }, ...both('dtalk'), ...both('mpillar')];
const o = offers(deps, teams);
check(o.get('wabastore')!.sales && o.get('wabastore')!.support, 'a department with both teams offers both');
check(!o.get('wabastar')!.sales && !o.get('wabastar')!.support, 'a department with only a General team offers nothing');
check(o.get('dtalk')!.sales && !o.get('dtalk')!.support, 'D Talk offers Sales only (its Support is Wabatalk)');
check(!o.get('wabatalk')!.sales && o.get('wabatalk')!.support, 'Wabatalk offers Support only');
check(whyNot(deps[4], o.get('wabatalk'), 'SALES') !== null, 'Wabatalk cannot be chosen for a Sales head');

let r = buildHeadAssignment({ fn: 'SALES', selectedIds: ['wabastore', 'whatsbox', 'mpillar'], departments: deps, teams });
check(r.ok && r.departmentId === 'wabastore' && r.headDivision === 'SALES' && r.additionalAccess.length === 2
      && r.additionalAccess.every(a => a.division === 'SALES' && a.departmentId !== 'wabastore'), 'shared Sales head: home + the others, Sales only', r);
r = buildHeadAssignment({ fn: 'SUPPORT', selectedIds: ['wabastore', 'whatsbox', 'wabatalk'], departments: deps, teams });
check(r.ok && r.departmentId === 'wabastore' && r.headDivision === 'SUPPORT' && r.additionalAccess.map(a => a.departmentId).join() === 'whatsbox,wabatalk', 'shared Support head includes Wabatalk', r);
r = buildHeadAssignment({ fn: 'SUPPORT', selectedIds: ['wabatalk', 'whatsbox'], departments: deps, teams });
check(r.ok && r.departmentId === 'dtalk' && r.headDivision === 'SUPPORT' && r.additionalAccess.map(a => a.departmentId).join() === 'whatsbox', 'Wabatalk as the first choice is placed in D Talk (Support), its pair implicit', r);
r = buildHeadAssignment({ fn: 'BOTH', selectedIds: ['mpillar'], departments: deps, teams });
check(r.ok && r.departmentId === 'mpillar' && !r.headDivision && r.additionalAccess.map(a => a.division).sort().join() === 'SALES,SUPPORT', 'one person for both functions: no side, both pairs', r);
r = buildHeadAssignment({ fn: 'SALES', selectedIds: [], departments: deps, teams });
check(!r.ok && /at least one/i.test((r as any).error), 'at least one department is required');
r = buildHeadAssignment({ fn: 'SALES', selectedIds: ['wabastar'], departments: deps, teams });
check(!r.ok, 'a department without a Sales team is refused before sending');
r = buildHeadAssignment({ fn: 'SUPPORT', selectedIds: ['dtalk'], departments: deps, teams });
check(!r.ok, "D Talk's Support cannot be chosen under D Talk");
r = buildHeadAssignment({ fn: '', selectedIds: ['wabastore'], departments: deps, teams });
check(!r.ok, 'a function must be chosen');
r = buildHeadAssignment({ fn: 'SALES', selectedIds: ['wabastore'], departments: deps, teams });
check(r.ok && r.additionalAccess.length === 0, 'a single department needs no extra access');

// ---- the Access Control matrix
import { cellKey, cellReason, isDirty, lockedCell, pairsToSave, savedSet, summary } from '../../src/lib/scope/accessMatrix.js';
const info = (over: Record<string, unknown> = {}) => ({
  profileId: 'h', name: 'Head', role: 'DEPARTMENT_HEAD', homeDepartmentId: 'whatsbox', headDivision: 'SALES', grants: [{ departmentId: 'wabastar', division: 'SALES' }],
  departments: [
    { id: 'whatsbox', slug: 'whatsbox', name: 'Whatsbox', hasSales: true, hasSupport: true },
    { id: 'wabastar', slug: 'wabastar', name: 'Wabastar', hasSales: true, hasSupport: true },
    { id: 'dtalk', slug: 'dtalk', name: 'D Talk', hasSales: true, hasSupport: false, supportDepartment: 'Wabatalk' },
    { id: 'wabatalk', slug: 'wabatalk', name: 'Wabatalk', hasSales: false, hasSupport: true },
    { id: 'accounts', slug: 'accounts', name: 'Accounts', hasSales: false, hasSupport: false }
  ], ...over }) as any;
let i = info();
check(lockedCell(i) === cellKey('whatsbox', 'SALES'), "the head's own placement is the locked cell");
check(lockedCell(info({ headDivision: null })) === null, 'a head with no side has no locked cell');
let saved = savedSet(i);
check(saved.has(cellKey('whatsbox', 'SALES')) && saved.has(cellKey('wabastar', 'SALES')) && saved.size === 2, 'ticked = saved grants + the locked cell');
let draft = new Set(saved);
check(!isDirty(draft, saved), 'nothing changed: not dirty');
draft.add(cellKey('wabatalk', 'SUPPORT'));
check(isDirty(draft, saved), 'a new tick is an unsaved change');
check(JSON.stringify(pairsToSave(draft, i).map(p => `${p.departmentId}:${p.division}`).sort()) === JSON.stringify(['wabastar:SALES', 'wabatalk:SUPPORT']), 'Save sends every tick except the locked home cell');
draft.delete(cellKey('wabatalk', 'SUPPORT'));
check(!isDirty(draft, saved), 'unticking it again is not a change');
check(cellReason(i.departments[2], 'SUPPORT')!.includes('Wabatalk') && cellReason(i.departments[4], 'SALES') !== null && cellReason(i.departments[0], 'SALES') === null, 'the reasons name the department that carries the function');
check(summary(draft, i).join('; ') === 'Whatsbox (Sales, home); Wabastar (Sales)', 'the summary lists the ticks, home marked', summary(draft, i));
console.log(`\n${passed} checks passed`);
