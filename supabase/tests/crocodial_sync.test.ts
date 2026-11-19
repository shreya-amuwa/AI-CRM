/**
 * The Crocodial sync worker (server/crocodial/sync.ts) with a fake fetch and a stub database: every page is stored as it arrives with
 * the page to resume from, a full pull sends no updated_since and an incremental one sends the checkpoint, a pull stops at the time budget
 * and resumes from its page, one failing resource does not stop the others, a refused token stops the connection, nothing is called
 * without a token, and only the needed fields are kept.
 */
import { runCrocodialSync, sinceParam, TO_STORE } from '../../server/crocodial/sync.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const B = 'https://app.crocodial.app/api/datalake/outbound';
const TOKEN = 'test-token-not-real-5678';
const env = { CROCODIAL_TOKEN_MP: TOKEN } as any;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = (rows: unknown[], next: string | null) => json(200, { success: true, data: rows, meta: { page: 1, per_page: 500, total: rows.length, timezone: 'Asia/Kolkata', next_page_url: next } });
const sleep = async () => undefined;

/** A fake Crocodial: answers by resource and page; records every request. */
function crocodial(answers: Record<string, (u: URL) => Response>) {
  const urls: URL[] = [];
  const f = async (url: string) => {
    const u = new URL(url);
    urls.push(u);
    const res = u.pathname.split('/').pop()!;
    const a = answers[res];
    return a ? a(u) : page([], null);
  };
  return { f, urls };
}

/** A stub database: one connection due; begin answers from `begins`; records stores and finishes. */
function stubDb(begins: Record<string, any> = {}) {
  const stores: any[] = [];
  const finishes: any[] = [];
  const statuses: any[] = [];
  const db: any = {
    rpc: async (fn: string, a: any) => {
      if (fn === 'croc_sync_due') return { data: [{ id: 'c1', credentialRef: 'CROCODIAL_TOKEN_MP' }], error: null };
      if (fn === 'croc_store_directory') return { data: {}, error: null };
      if (fn === 'croc_connection_status') { statuses.push(a); return { data: null, error: null }; }
      if (fn === 'croc_sync_begin') return { data: begins[a.p_resource] ?? { ok: true, full: true, since: null, page: 1 }, error: null };
      if (fn === 'croc_sync_store') { stores.push(a); return { data: a.p_rows.length, error: null }; }
      if (fn === 'croc_sync_finish') { finishes.push(a); return { data: {}, error: null }; }
      return { data: null, error: { message: 'unexpected ' + fn } };
    }
  };
  return { db, stores, finishes, statuses };
}

// ---------------------------------------------------------------------------- a full pull over two pages
{
  const { f, urls } = crocodial({
    'call-logs': u => u.searchParams.get('page') === '1'
      ? page([{ id: 1, called_by: { id: 4138, name: 'sachin' }, lead: { id: 9 }, call_type: 'outgoing', call_at: '2026-11-18T10:00:00+05:30', duration_seconds: 60, connected: true,
                phone_number: '+919800000001', raw_number: '098000 00001', contact_name: 'Ravi', location: 'Gujarat', sim_slot: '0', spam: false }], `${B}/call-logs?per_page=500&page=2`)
      : page([{ id: 2, called_by: { id: 4138 }, lead: null, call_type: 'incoming', call_at: '2026-11-18T11:00:00+05:30', duration_seconds: 0, connected: false }], null)
  });
  const s = stubDb();
  const r = await runCrocodialSync({ db: s.db, env, fetch: f, sleep, minGapMs: 0 });
  const calls = s.stores.filter(x => x.p_resource === 'call-logs');
  check(calls.length === 2 && calls[0].p_next_page === 2 && calls[1].p_next_page === null, 'every page is stored as it arrives, with the page to resume from', calls.map(c => c.p_next_page));
  check(s.finishes.filter(x => x.p_outcome === 'DONE').length === 4 && r.connections[0].health === 'OK', 'all four resources are read to the end', s.finishes);
  check(urls.filter(u => u.pathname.endsWith('call-logs')).every(u => !u.searchParams.has('updated_since')), 'a full pull asks for everything (no updated_since)');
  check(['leads', 'call-logs', 'followups', 'remarks'].every(res => urls.some(u => u.pathname.endsWith(res))) && !urls.some(u => /recordings/.test(u.pathname)),
    'leads, call logs, follow-ups and remarks are read; recordings never');
  check(urls[0].pathname.endsWith('employees'), 'the account\'s users are refreshed first');
  const stored = calls[0].p_rows[0];
  check(stored.calledBy === 4138 && stored.lead === 9 && stored.callType === 'outgoing' && stored.durationSeconds === 60 && stored.connected === true,
    'a call keeps who made it (the Crocodial user id), the lead, type, time, duration and whether it connected', stored);
  check(!('raw_number' in stored) && !('rawNumber' in stored) && !('location' in stored) && !('sim_slot' in stored) && !('spam' in stored), 'the raw number, location, SIM and spam flag are not kept');
  check(calls[1].p_rows[0].lead === null, 'a call without a lead stays without one (no guessing)');
}

// ---------------------------------------------------------------------------- incremental and resumed pulls
{
  const { f, urls } = crocodial({});
  const s = stubDb({
    leads: { ok: true, full: false, since: '2026-11-19T04:20:00.000Z', page: 1 },
    'call-logs': { ok: true, full: false, since: '2026-11-19T04:20:00.000Z', page: 3 },
    followups: { ok: false, reason: 'RUNNING' }
  });
  const r = await runCrocodialSync({ db: s.db, env, fetch: f, sleep, minGapMs: 0 });
  const leads = urls.find(u => u.pathname.endsWith('leads'))!;
  check(leads.searchParams.get('updated_since') === '2026-11-19T04:20:00+00:00' && sinceParam('2026-11-19T04:20:00.000Z') === '2026-11-19T04:20:00+00:00',
    'an incremental pull asks for rows updated since the checkpoint (date-time with an offset)');
  check(urls.find(u => u.pathname.endsWith('call-logs'))!.searchParams.get('page') === '3', 'a pull in progress resumes from its page');
  check(!urls.some(u => u.pathname.endsWith('followups')) && r.connections[0].resources.find(x => x.resource === 'followups')!.outcome === 'SKIPPED',
    'a resource another run holds is skipped, not fetched twice');
  check(urls.every(u => u.searchParams.get('per_page') === '500' || u.pathname.endsWith('employees') || u.pathname.endsWith('branches')), 'pages of 500 rows');
}

// ---------------------------------------------------------------------------- the time budget
{
  let n = 0;
  const { f } = crocodial({ leads: u => page([{ id: ++n }], `${B}/leads?per_page=500&page=${Number(u.searchParams.get('page')) + 1}`) });
  const s = stubDb();
  const slow = async (url: string, init: RequestInit) => { await new Promise(r => setTimeout(r, 30)); return f(url); };
  const r = await runCrocodialSync({ db: s.db, env, fetch: slow as any, sleep, minGapMs: 0, budgetMs: 200 });
  const leads = r.connections[0].resources.find(x => x.resource === 'leads')!;
  check(leads.outcome === 'PARTIAL' && s.finishes.some(x => x.p_resource === 'leads' && x.p_outcome === 'PARTIAL'), 'a pull that runs out of time stops and is recorded as partial (it resumes next run)', leads);
  check(s.stores.at(-1).p_next_page === leads.pages + 1, 'the page to resume from is the next one');
}

// ---------------------------------------------------------------------------- failures
{
  const { f } = crocodial({ 'call-logs': () => json(500, {}) });
  const s = stubDb();
  const r = await runCrocodialSync({ db: s.db, env, fetch: f, sleep, minGapMs: 0 });
  const res = Object.fromEntries(r.connections[0].resources.map(x => [x.resource, x.outcome]));
  check(res['call-logs'] === 'FAILED' && res.leads === 'DONE' && res.followups === 'DONE' && res.remarks === 'DONE', 'a failing resource does not stop the others', res);
  check(s.finishes.find(x => x.p_resource === 'call-logs').p_outcome === 'FAILED' && s.statuses.at(-1).p_health === 'ERROR', 'it is recorded, and the connection shows the error');
}
{
  const { f, urls } = crocodial({ leads: () => json(401, { success: false, message: 'Unauthenticated' }) });
  const s = stubDb();
  const r = await runCrocodialSync({ db: s.db, env, fetch: f, sleep, minGapMs: 0 });
  check(r.connections[0].health === 'AUTH_FAILED' && !urls.some(u => u.pathname.endsWith('call-logs')), 'a refused token stops the connection (nothing more is called)');
}
{
  const { f, urls } = crocodial({});
  const s = stubDb();
  const r = await runCrocodialSync({ db: s.db, env: {} as any, fetch: f, sleep, minGapMs: 0 });
  check(r.connections[0].health === 'NO_CREDENTIAL' && urls.length === 0 && s.statuses[0].p_health === 'NO_CREDENTIAL', 'without the token setting nothing is called');
}
{
  const db: any = { rpc: async (fn: string) => (fn === 'croc_sync_due' ? { data: [], error: null } : { data: null, error: { message: 'unexpected' } }) };
  const { f, urls } = crocodial({});
  const r = await runCrocodialSync({ db, env, fetch: f, sleep, minGapMs: 0 });
  check(r.connections.length === 0 && urls.length === 0, 'nothing due (switched off, or synced recently): Crocodial is not called');
}

// ---------------------------------------------------------------------------- what is kept of each resource
{
  const lead = TO_STORE.leads.map(TO_STORE.leads.schema.parse({ id: 1, name: 'Ravi', phone_number: '+91', email: 'r@x.com', budget: '25000', deal_value: 25000,
    custom_fields: { a: 1 }, assigned_to: { id: 4138, name: 'sachin' }, created_by: { id: 340 } }));
  check(lead.assignedTo === 4138 && !('email' in lead) && !('budget' in lead) && !('dealValue' in lead) && !('customFields' in lead), 'a lead keeps its assignee, not e-mail, budget, value or custom fields', lead);
  const fu = TO_STORE.followups.map(TO_STORE.followups.schema.parse({ id: 5, created_by: { id: 4138 }, lead: { id: 9, name: 'Ravi' }, done: false, scheduled_at: '2026-11-20T10:00:00+05:30' }));
  check(fu.createdBy === 4138 && fu.lead === 9 && fu.done === false, 'a follow-up keeps who created it and its lead');
  const rm = TO_STORE.remarks.map(TO_STORE.remarks.schema.parse({ id: 7, written_by: { id: 371 }, remark: 'Interested' }));
  check(rm.writtenBy === 371, 'a remark keeps who wrote it');
  check(!TO_STORE['call-logs'].schema.safeParse({ id: 'x' }).success, 'a row without a valid id is refused');
}

console.log(`=== ${passed} CROCODIAL SYNC CHECKS PASSED ===`);
