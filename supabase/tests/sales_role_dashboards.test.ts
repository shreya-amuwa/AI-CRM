// The Crocodial field map (shared/crocodialFields.ts) against the sync and the tables, and the Sales Department Head role-wise sections
// (migrations 20270117000200 / 0300): the addresses of the lists and of one person's dashboard, the shown
// figures, the CSV export and the weekly / monthly roll-up. Every number comes from the database; these are the display rules only.
import type { SalesRoleList } from '../../shared/contracts.js';
import { salesRoleListQuerySchema, salesRolePersonQuerySchema, salesRoleSchema } from '../../shared/validation.js';
import { PATHS, parseSalesHeadPage, parseSalesHeadPerson } from '../../src/components/sales-head/salesHeadPaths.js';
import { ROLE_CONFIG, exportFileName, exportRows, formatMetric, rollUp, weekStart } from '../../src/components/sales-head/roles/salesRoleView.js';
import { CROCODIAL_CALL_FIELDS, CROCODIAL_CALL_FIGURES, CROCODIAL_CALL_TYPES, CROCODIAL_FIELDS, callDuration, callTypeLabel, connectedLabel } from '../../shared/crocodialFields.js';
import { TO_STORE } from '../../server/crocodial/sync.js';
import { readFileSync } from 'node:fs';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const base = '/sales-head/dashboard/u1';
const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

// addresses
check(parseSalesHeadPage(`${base}/telecallers`) === 'telecallers' && parseSalesHeadPerson(`${base}/telecallers`) === null, 'the Telecaller List has its own address');
check(parseSalesHeadPage(`${base}/business-associates`) === 'business-associates', 'so does the Business Associate List');
check(parseSalesHeadPage(`${base}/telecallers/${id}`) === 'telecallers' && parseSalesHeadPerson(`${base}/telecallers/${id}`) === id, 'a Telecaller\'s dashboard opens at the list address plus their id');
check(parseSalesHeadPerson(`${base}/business-associates/${id.toUpperCase()}/`) === id, 'the id is read whatever its case, a trailing slash ignored');
check(parseSalesHeadPerson(`${base}/telecallers/not-an-id`) === null && parseSalesHeadPage(`${base}/telecallers/not-an-id`) === 'overview', 'an address that is not a person falls back to the home page');
check(parseSalesHeadPerson(`${base}/leads/${id}`) === null, 'only the role-wise lists open a person');
check(parseSalesHeadPerson(`${base}/telecallers/${id}/more`) === null, 'nothing deeper');
check(parseSalesHeadPage(`${base}/performance`) === 'performance' && parseSalesHeadPage(`${base}/crocodial/me`) === 'crocodial-me' && parseSalesHeadPage(base) === 'overview',
  'every existing page keeps its address');
// 36: + lead-tags (20270305000100) and crocodial-setup (20270307000100)
check(parseSalesHeadPage(`${base}/crocodial/setup`) === 'crocodial-setup', 'the CEO\'s Crocodial Integration has its own address');
// 38: + employee-reviews and telecaller-performance (HR dashboard upgrade, docs/hr-dashboard-upgrade.md)
check(Object.keys(PATHS).length === 38 && PATHS['telecaller-performance'] === 'telecaller-performance' && PATHS.telecallers === 'telecallers' && PATHS['my-income'] === 'my-income' && PATHS.income === 'income', 'the role-wise and income pages were added; Department Income keeps its address', Object.keys(PATHS).length);

// what the browser may send
check(salesRoleSchema.safeParse('TELECALLER').success && salesRoleSchema.safeParse('BUSINESS_ASSOCIATE').success && !salesRoleSchema.safeParse('INFLUENCER').success,
  'only the two roles of this phase');
check(salesRoleListQuerySchema.parse({}).pageSize === 25 && salesRoleListQuerySchema.parse({ pageSize: '500' }).pageSize === 500 && !salesRoleListQuerySchema.safeParse({ pageSize: '501' }).success,
  'pages of 25, up to 500 for the export');
check(!salesRoleListQuerySchema.safeParse({ from: '2026-11-20', to: '2026-11-01' }).success && !salesRolePersonQuerySchema.safeParse({ from: '2026-11-20', to: '2026-11-01' }).success,
  'a start after the end is refused before the database is asked');
check(!salesRoleListQuerySchema.safeParse({ sort: 'salary' }).success && !salesRoleListQuerySchema.safeParse({ role: 'X' }).success, 'unknown sorts and fields are refused');

// figures as shown
check(formatMetric(null, 'percent') === '–' && formatMetric(undefined, 'count') === '–', 'a missing figure is a dash, never 0');
check(formatMetric(50, 'percent') === '50%' && formatMetric(66.7, 'percent') === '66.7%', 'percentages');
check(formatMetric(12000, 'money').includes('12,000') && formatMetric(1234567, 'count') === '12,34,567', 'rupees and Indian digit grouping');
check(formatMetric(100, 'duration') === '2 min' && formatMetric(3700, 'duration') === '1 h 2 min', 'talk time');

// only Crocodial fields are labelled Crocodial; the call columns are the shared ones, in the shared order
const crocKeys = (r: 'TELECALLER' | 'BUSINESS_ASSOCIATE') => ROLE_CONFIG[r].cards.filter(c => c.source === 'CROCODIAL').map(c => c.key);
check(JSON.stringify(crocKeys('TELECALLER').slice(0, 5)) === JSON.stringify(['calls', 'connected', 'notConnected', 'uniqueNumbers', 'talkSeconds'])
  && JSON.stringify(crocKeys('BUSINESS_ASSOCIATE')) === JSON.stringify(['calls', 'connected', 'notConnected', 'uniqueNumbers', 'talkSeconds']),
  'both roles show the same five Crocodial call figures (shared/crocodialFields.ts), in the same order');
check(CROCODIAL_CALL_FIGURES.map(f => f.label).join('|') === 'Total calls|Connected|Not connected|Unique numbers|Talk time', 'their labels');
const allKeys = (['TELECALLER', 'BUSINESS_ASSOCIATE'] as const).flatMap(r => [...ROLE_CONFIG[r].columns, ...ROLE_CONFIG[r].cards].map(c => c.key as string));
check(!allKeys.some(k => ['totalCalls', 'contactsCalled', 'connectedCalls', 'notConnectedCalls', 'connectionRate', 'interestedLeads', 'pendingFollowUps', 'overdueFollowUps',
  'connectedClients', 'revenueReceived', 'pendingDeals', 'qualifiedLeads', 'openContacts', 'quotationValue'].includes(k)),
  'none of the removed figures (CRM-made call counters, invented or duplicate figures) is shown');
check(ROLE_CONFIG.TELECALLER.columns.filter(c => c.source === 'CRM').map(c => c.key).join('|') === 'leadsCreated|convertedLeads', 'the Telecaller keeps two CRM figures: leads created, converted');
check(ROLE_CONFIG.BUSINESS_ASSOCIATE.columns.some(c => c.key === 'dealValue' && c.format === 'money' && c.source === 'CRM'), 'the Business Associate list shows the deal value in rupees, from the CRM');
check(ROLE_CONFIG.BUSINESS_ASSOCIATE.series.every(s => s.source === 'CRM') && ROLE_CONFIG.TELECALLER.series.filter(s => s.source === 'CROCODIAL').length === 2,
  'the daily series say where they come from');

// export
const m = (o: Partial<SalesRoleList['items'][number]['metrics']>) => ({ crocodial: 'ON', calls: null, connected: null, notConnected: null, connectRate: null, uniqueNumbers: null, talkSeconds: null, ...o }) as SalesRoleList['items'][number]['metrics'];
const list: SalesRoleList = {
  role: 'TELECALLER', from: '2026-11-01', to: '2026-11-20', total: 2, page: 1, pageSize: 500, teamLeads: [],
  items: [
    { id: 'a', name: 'Asha', email: 'a@x.in', phone: '98', employeeCode: 'EMP-1', status: 'ACTIVE', teamId: 't', teamName: 'Sales A', teamLeadId: 'l', teamLeadName: 'Lead L',
      metrics: m({ calls: 7, connected: 2, notConnected: 4, uniqueNumbers: 5, talkSeconds: 100, leadsCreated: 2, convertedLeads: 1 }) },
    { id: 'b', name: 'Bina', email: null, phone: null, employeeCode: 'EMP-2', status: 'SUSPENDED', teamId: null, teamName: null, teamLeadId: null, teamLeadName: null,
      metrics: m({ crocodial: 'OFF', leadsCreated: 0, convertedLeads: 0 }) }
  ]
};
const rows = exportRows(list);
check(rows.length === 3 && rows[0].slice(0, 8).join('|') === 'Name|Employee ID|Team|Team Lead|Status|E-mail|Phone|Crocodial'
  && rows[0].includes('Total calls [Crocodial]') && rows[0].includes('Talk time (seconds) [Crocodial]') && rows[0].includes('Leads created'),
  'the export has a heading row (Crocodial columns marked) and one row per person', rows[0]);
check(rows[1][7] === 'Connected' && rows[1].includes('7') && rows[1].includes('100'), 'plain numbers for a connected person');
check(rows[2][4] === 'Suspended' && rows[2][7] === 'Not connected to Crocodial' && rows[2][8] === '' && rows[2][9] === '', 'a person without Crocodial: empty call cells, not zeros');
check(exportFileName(list) === 'Telecaller list 2026-11-01 to 2026-11-20.csv', 'the file says which role and period');

// the shared field map: the sync, the database and the screens agree
const sample = { id: 9, called_by: { id: 4138 }, lead: { id: 900 }, phone_number: '+919800000001', contact_name: 'Ravi', call_type: 'outgoing', call_at: '2026-11-19T10:00:00+05:30',
  duration_seconds: 42, connected: true, synced_at: '2026-11-19T10:01:00+05:30' };
const stored = TO_STORE['call-logs'].map(TO_STORE['call-logs'].schema.parse(sample));
check(JSON.stringify(Object.keys(stored).sort()) === JSON.stringify(CROCODIAL_CALL_FIELDS.map(f => f.store).sort()), 'the sync stores exactly the mapped call fields', Object.keys(stored));
check(CROCODIAL_CALL_FIELDS.every(f => {
  const v = f.source.split('.').reduce<any>((o, k) => o?.[k], sample);
  return stored[f.store] === v;
}), 'each Crocodial call field lands in its mapped key with its value');
for (const [resource, def] of Object.entries(CROCODIAL_FIELDS)) {
  const sync = TO_STORE[resource as keyof typeof TO_STORE];
  const keys = Object.keys(sync.map({ id: 1 }));
  check(JSON.stringify(keys.sort()) === JSON.stringify(def.fields.map(f => f.store).sort()), `${resource}: the sync and the field map list the same fields`, keys);
  const sql = readFileSync('supabase/migrations/20270115000200_crocodial_sync.sql', 'utf8');
  const table = sql.slice(sql.indexOf(`create table if not exists public.${def.table} (`), sql.indexOf(');', sql.indexOf(`public.${def.table} (`)));
  check(def.fields.every(f => new RegExp(`\\b${f.column}\\b`).test(table)), `${resource}: every mapped column exists in ${def.table}`);
}
const callCheck = readFileSync('supabase/migrations/20270115000200_crocodial_sync.sql', 'utf8').match(/call_type in \(([^)]*)\)/)?.[1] ?? '';
check(CROCODIAL_CALL_TYPES.every(t => callCheck.includes(`'${t}'`)) && callCheck.split(',').length === CROCODIAL_CALL_TYPES.length, 'the call types are the ones the table allows');
check(connectedLabel(true) === 'Connected' && connectedLabel(false) === 'Not connected' && connectedLabel(null) === 'Not reported', 'an empty "connected" is "not reported", never "not connected"');
check(callTypeLabel('answered_elsewhere') === 'Answered elsewhere' && callTypeLabel('weird') === 'Unknown' && callTypeLabel(null) === 'Unknown', 'call types');
check(callDuration(65, true) === '1 min 5 s' && callDuration(0, false) === '—' && callDuration(null, true) === '—', 'call duration; none for a call that did not connect');

// daily / weekly / monthly
check(weekStart('2026-11-20') === '2026-11-16' && weekStart('2026-11-16') === '2026-11-16' && weekStart('2026-11-22') === '2026-11-16', 'weeks start on Monday');
const daily = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map((day, i) => ({ day, calls: i + 1, leads: 1 }));
check(rollUp(daily, ['calls', 'leads'], 'DAY').length === 5, 'daily: one row per day');
const weeks = rollUp(daily, ['calls', 'leads'], 'WEEK');
check(weeks.length === 2 && weeks[0].values.calls === 1 + 2 + 3 && weeks[1].values.calls === 4 + 5 && weeks[1].label.startsWith('Week of'), 'weekly sums, Monday to Sunday', weeks);
const months = rollUp(daily, ['calls', 'leads'], 'MONTH');
check(months.length === 2 && months[0].values.leads === 2 && months[1].values.leads === 3 && months[1].label.includes('November'), 'monthly sums', months);
check(rollUp([{ day: '2026-11-01' }], ['calls'], 'DAY')[0].values.calls === null && rollUp([{ day: '2026-11-01', calls: null }, { day: '2026-11-02', calls: null }], ['calls'], 'WEEK')[0].values.calls === null,
  'a figure missing every day (not connected to Crocodial) stays empty, never 0');
check(rollUp([{ day: '2026-11-02', calls: 3 }, { day: '2026-11-03', calls: null }], ['calls'], 'WEEK')[0].values.calls === 3, 'a missing day does not hide the others');

console.log(`=== SALES ROLE DASHBOARD TESTS PASSED (${passed}) ===`);
