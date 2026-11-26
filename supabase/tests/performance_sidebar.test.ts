/**
 * Performance Management in the side panels (20270213000100): a dedicated entry for Team Leads and Department Heads in every dashboard that has them,
 * and no performance entry of any kind for Team Members. The dashboards import browser-only modules, so this reads their sidebar definitions as text;
 * the database refuses a member anyway (performance_lead_primary_test.sql, api_integration.test.ts).
 */
import { readFileSync } from 'node:fs';
import { unifiedMenu } from '../../src/components/unified/unifiedNav.js';

let passed = 0;
function check(ok: unknown, label: string) {
  if (!ok) { console.error(`FAILED: ${label}`); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
// run from the repository root (as run-unit.sh does: the bundle is copied there)
const src = (p: string) => readFileSync(p, 'utf8');

// Team Members: no My Performance / Performance Management entry, page or component
const MEMBER_DASHBOARDS = ['src/components/team-member/TeamMemberLayout.tsx', 'src/components/support-member/SupportMemberDashboard.tsx'];
for (const f of MEMBER_DASHBOARDS) {
  const s = src(f);
  check(!/label: 'My Performance'/.test(s) && !/label: 'Performance Management'/.test(s) && !/<MyPerformance|<PerformanceHub|<PerformanceApprovals/.test(s), `${f}: no performance entry or page for a Team Member`);
}
check(!src('src/components/team-member/TeamMemberLayout.tsx').includes("'my-performance'"), 'the Team Member dashboard has no my-performance page (a remembered one opens Home)');
check(!/export const MyPerformance/.test(src('src/components/performance/PerformanceHub.tsx')), 'the My Performance page no longer exists');
check(!unifiedMenu('MEMBER').some(g => g.items.some(i => /performance/i.test(i.label) || (i.children ?? []).some(c => /performance/i.test(c.label)))), 'International / Reseller: no performance entry for a Team Member');

// Team Leads and Department Heads: a dedicated Performance Management entry that opens the shared page
const LEAD_HEAD_DASHBOARDS: [string, string][] = [
  ['src/components/team-lead/TeamLeadDashboard.tsx', 'TEAM_LEAD'], ['src/components/support-lead/SupportLeadDashboard.tsx', 'TEAM_LEAD'],
  ['src/components/tasks/DepartmentHeadDashboard.tsx', 'DEPARTMENT_HEAD'], ['src/components/sales-head/SalesHeadDashboard.tsx', 'DEPARTMENT_HEAD']
];
for (const [f, mode] of LEAD_HEAD_DASHBOARDS) check(src(f).includes(`<PerformanceHub mode="${mode}"`), `${f}: Performance Management opens the shared page as ${mode}`);
check(/label: 'Performance Management'/.test(src('src/components/team-lead/TeamLeadDashboard.tsx')) && /label: 'Performance Management'/.test(src('src/components/support-lead/SupportLeadDashboard.tsx'))
  && /label: 'Performance Management'/.test(src('src/components/tasks/DepartmentHeadDashboard.tsx')) && /label: 'Performance Management'/.test(src('src/components/sales-head/salesHeadNav.ts')),
  'the Team Lead, Support Team Lead, Department Head and Sales Department Head side panels have Performance Management');
for (const who of ['HEAD', 'LEAD'] as const) check(unifiedMenu(who)[0].items.some(i => i.label === 'Performance Management'), `International / Reseller: Performance Management for the ${who === 'HEAD' ? 'Department Head' : 'Team Lead'}`);

// AI Studio (20270214000100): its own dashboard, its own side panel. The entry is there for the Department Head and the Team Lead, opens the shared page,
// and a Team Member neither sees it nor opens it by its address.
const aiDash = src('src/components/ai-studio/AiStudioDashboard.tsx');
check((aiDash.match(/\{ id: 'performance', label: 'Performance Management'/g) ?? []).length === 2, 'AI Studio: Performance Management in the Department Head\'s and the Team Lead\'s side panel');
check(/who === 'LEAD' \? \[\{ id: 'performance', label: 'Performance Management'/.test(aiDash), 'AI Studio: for the Team Lead only, not the Team Member');
check(/rawPage === 'performance' && who === 'MEMBER' \? 'overview'/.test(aiDash) && /page === 'performance' && who !== 'MEMBER' && \(\s*<PerformanceApprovals/.test(aiDash),
  'AI Studio: the page opens the shared Performance Management; a Team Member\'s address falls back to the Overview');
console.log(`=== PERFORMANCE SIDEBAR TESTS PASSED (${passed}) ===`);
