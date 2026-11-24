// A stateful stand-in for the HR Awards API (/api/v1/hr/awards...) for the browser tests (ui_hr_awards, ui_hr_shell): it keeps the rules the
// database enforces (no duplicate nominee per award and month, a winner must be revoked before removal, months kept apart). State lives in
// the Node process, so it survives a page reload like the database does. Other HR endpoints get empty answers.
// ---------------------------------------------------------------------------
// The fake award API (state survives a page reload, like the database)
// ---------------------------------------------------------------------------
export const AWARDS = [
  ['PROFESSIONALISM_EXCELLENCE', 'Professionalism Excellence of the Month', 'INDIVIDUAL'], ['RISING_STAR', 'Rising Star of the Month', 'INDIVIDUAL'],
  ['PLAYER', 'Player of the Month', 'INDIVIDUAL'], ['EMERGING_LEADER', 'Emerging Leader of the Month', 'INDIVIDUAL'],
  ['DEPARTMENT', 'Department of the Month', 'DEPARTMENT'], ['TEAM', 'Team of the Month', 'TEAM'], ['BUSINESS_ICON', 'Business Icon of the Month', 'INDIVIDUAL']
];
const EMPLOYEES = ['Employee A', 'Employee B', 'Employee C', 'Employee D'].map((name, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`, name, departmentId: 'd1', departmentName: 'Wabastore', teamId: 't1', teamName: 'Sales', designation: 'Executive'
}));
const OPTIONS = { employees: EMPLOYEES, teams: [{ id: '00000000-0000-4000-8000-0000000000a1', name: 'Sales', departmentId: 'd1', departmentName: 'Wabastore', members: 4 }],
  departments: [{ id: '00000000-0000-4000-8000-0000000000d1', name: 'Wabastore', members: 4 }] };
export const label = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
let seq = 100;
const uid = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`;
export const state = { nominees: [], winners: [] };
export const control = { forbidden: false };
const detail = (code, month) => {
  const a = AWARDS.find(x => x[0] === code);
  const noms = state.nominees.filter(n => n.code === code && n.month === month && !n.removed);
  const wins = state.winners.filter(w => w.code === code && w.month === month && !w.revokedAt);
  const isWinner = id => wins.some(w => w.nomineeId === id);
  const wj = w => { const n = state.nominees.find(x => x.id === w.nomineeId); return { ...w, name: n.name, nomineeType: n.nomineeType, departmentName: n.departmentName, teamName: n.teamName, designation: n.designation }; };
  return {
    award: { code, name: a[1], description: null, nomineeType: a[2] }, month, monthLabel: label(month), periodId: noms.length ? 'p' : null,
    totalNominees: noms.length, totalWinners: wins.length, status: wins.length ? 'WINNERS_DECLARED' : noms.length ? 'NOMINATIONS_OPEN' : 'NO_NOMINEES',
    nominees: noms.map(n => ({ ...n, status: isWinner(n.id) ? 'WINNER' : 'NOMINATED' })), winners: wins.map(wj),
    revokedWinners: state.winners.filter(w => w.code === code && w.month === month && w.revokedAt).map(wj),
    removedNominees: state.nominees.filter(n => n.code === code && n.month === month && n.removed).length
  };
};
const overview = month => ({
  month, monthLabel: label(month),
  awards: AWARDS.map(([code]) => { const d = detail(code, month); return { code, name: d.award.name, description: null, nomineeType: d.award.nomineeType, periodId: d.periodId,
    nominees: d.totalNominees, winners: d.totalWinners, status: d.status, winnerNames: d.winners.map(w => w.name) }; }),
  history: [...new Set(state.nominees.map(n => n.month))].sort().reverse().map(m => ({ month: m, monthLabel: label(m),
    nominees: state.nominees.filter(n => n.month === m && !n.removed).length, winners: state.winners.filter(w => w.month === m && !w.revokedAt).length }))
});
const fail = (status, code, message) => ({ status, body: { success: false, error: { code, message } } });
export function handle(method, url, body) {
  if (control.forbidden) return fail(403, 'FORBIDDEN', 'Only HR staff manage awards.');
  const p = url.pathname.replace(/^\/api\/v1/, '');
  const month = url.searchParams.get('month');
  let m;
  if (method === 'GET' && p === '/hr/awards') return { status: 200, body: { success: true, data: overview(month) } };
  if (method === 'GET' && p === '/hr/awards/options') return { status: 200, body: { success: true, data: OPTIONS } };
  if (method === 'GET' && (m = p.match(/^\/hr\/awards\/([A-Z_]+)$/))) return { status: 200, body: { success: true, data: detail(m[1], month) } };
  if (method === 'POST' && (m = p.match(/^\/hr\/awards\/([A-Z_]+)\/nominees$/))) {
    const type = AWARDS.find(x => x[0] === m[1])[2];
    if (body.nomineeType !== type) return fail(422, 'VALIDATION_ERROR', `That award takes ${type.toLowerCase()} nominees.`);
    const e = type === 'INDIVIDUAL' ? EMPLOYEES.find(x => x.id === body.entityId)
      : type === 'TEAM' ? (t => t && { ...t, teamName: t.name, designation: null })(OPTIONS.teams.find(x => x.id === body.entityId))
      : (d => d && { ...d, departmentName: d.name, teamName: null, designation: null })(OPTIONS.departments.find(x => x.id === body.entityId));
    if (!e) return fail(404, 'NOT_FOUND', 'That nominee does not exist.');
    if (state.nominees.some(n => n.code === m[1] && n.month === body.month && n.entityId === e.id && !n.removed)) return fail(409, 'CONFLICT', `${e.name} is already nominated.`);
    state.nominees.push({ id: uid(), code: m[1], month: body.month, nomineeType: type, entityId: e.id, profileId: type === 'INDIVIDUAL' ? e.id : null,
      teamId: type === 'TEAM' ? e.id : null, departmentId: type === 'DEPARTMENT' ? e.id : null,
      name: e.name, departmentName: e.departmentName, teamName: e.teamName, designation: e.designation, reason: body.reason, remarks: body.remarks ?? null,
      nominatedAt: new Date().toISOString(), nominatedBy: 'HR Head', updatedAt: new Date().toISOString(), updatedBy: 'HR Head', periodId: 'p' });
    return { status: 201, body: { success: true, data: detail(m[1], body.month) } };
  }
  if (method === 'POST' && (m = p.match(/^\/hr\/awards\/nominees\/([^/]+)\/(update|remove)$/))) {
    const n = state.nominees.find(x => x.id === m[1]);
    if (m[2] === 'update') Object.assign(n, { reason: body.reason, remarks: body.remarks });
    else if (state.winners.some(w => w.nomineeId === n.id && !w.revokedAt)) return fail(409, 'CONFLICT', 'Revoke the winner declaration first.');
    else n.removed = true;
    return { status: 200, body: { success: true, data: detail(n.code, n.month) } };
  }
  if (method === 'POST' && p === '/hr/awards/winners') {
    const noms = body.nomineeIds.map(id => state.nominees.find(x => x.id === id));
    for (const n of noms) if (!state.winners.some(w => w.nomineeId === n.id && !w.revokedAt))
      state.winners.push({ id: uid(), code: n.code, month: n.month, nomineeId: n.id, periodId: 'p', remarks: body.remarks ?? null, declaredAt: new Date().toISOString(),
        declaredBy: 'HR Head', updatedAt: new Date().toISOString(), revokedAt: null, revokedBy: null, revokeReason: null });
    return { status: 200, body: { success: true, data: detail(noms[0].code, noms[0].month) } };
  }
  if (method === 'POST' && (m = p.match(/^\/hr\/awards\/winners\/([^/]+)\/(revoke|update)$/))) {
    const w = state.winners.find(x => x.id === m[1]);
    if (m[2] === 'revoke') Object.assign(w, { revokedAt: new Date().toISOString(), revokedBy: 'HR Head', revokeReason: body.reason });
    else w.remarks = body.remarks;
    return { status: 200, body: { success: true, data: detail(w.code, w.month) } };
  }
  // the rest of the HR dashboard: empty answers
  if (p === '/hr/recruitment/overview') return { status: 200, body: { success: true, data: { candidates: 3, confirmed: 1 } } };
  if (p === '/leave/review') return { status: 200, body: { success: true, data: { awaiting: [], decided: [], canReviewAsDepartmentHead: false, canReviewAsHr: true, canReview: true } } };
  if (p === '/chat/unread') return { status: 200, body: { success: true, data: { internal: 0, clients: 0 } } };
  if (p.startsWith('/hr/attendance')) return { status: 200, body: { success: true, data: { date: '2026-11-24', rows: [] } } };
  return { status: 200, body: { success: true, data: [] } };
}

