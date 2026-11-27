import type { SupabaseClient } from '@supabase/supabase-js';
import { postToParent } from './bridge';
import { demo, demoId, demoReady, findRpc, nowIso, simulated, unavailable, type Row } from './demoStore';
import { DEMO_ME_ID } from './previewIdentity';

/**
 * Replaces src/services/supabaseClient.ts in the preview bundle (vite.preview.config.ts). The dashboards that read tables directly (under RLS
 * in production) read the demonstration rows of this preview instead:
 *  - auth: a demonstration session for the synthetic identity; it has no token the live CRM would accept, and sign-out ends the preview;
 *  - tables: select with the usual filters, order and paging; insert / update / upsert / delete change the demonstration rows only;
 *  - rpc: the demonstration answer when a fixture has one, otherwise a clear "not in the demonstration" error;
 *  - Realtime channels never connect; Storage refuses uploads and downloads.
 * Nothing here can make a network request (and the page's CSP refuses them anyway).
 */
type Filter = (r: Row) => boolean;
type Result = { data: unknown; error: { message: string; code: string; details: string | null; hint: string | null } | null; count?: number | null; status: number };
const demoError = (message: string, code = 'DEMO_UNAVAILABLE') => ({ message, code, details: null, hint: null });

const cmp = (a: unknown, b: unknown) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : String(a) < String(b) ? -1 : 1);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const like = (pattern: string, ci: boolean) => new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', ci ? 'i' : '');
const parseList = (v: string) => v.replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, ''));

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private from_ = 0;
  private to_: number | null = null;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private single_: 'one' | 'maybe' | null = null;
  private countMode = false;
  private head = false;
  private returning = false;

  constructor(private table: string) {}

  private rows(): Row[] {
    const t = demo().state.tables;
    if (!t[this.table]) {
      unavailable(`table ${this.table}`);
      t[this.table] = [];
    }
    return t[this.table];
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode !== 'select') this.returning = true;
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(v: Row | Row[]) { this.mode = 'insert'; this.payload = v; return this; }
  upsert(v: Row | Row[]) { this.mode = 'upsert'; this.payload = v; return this; }
  update(v: Row) { this.mode = 'update'; this.payload = v; return this; }
  delete() { this.mode = 'delete'; return this; }

  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v || String(r[c]) === String(v)); return this; }
  neq(c: string, v: unknown) { this.filters.push(r => String(r[c]) !== String(v)); return this; }
  gt(c: string, v: unknown) { this.filters.push(r => cmp(r[c], v) > 0); return this; }
  gte(c: string, v: unknown) { this.filters.push(r => cmp(r[c], v) >= 0); return this; }
  lt(c: string, v: unknown) { this.filters.push(r => cmp(r[c], v) < 0); return this; }
  lte(c: string, v: unknown) { this.filters.push(r => cmp(r[c], v) <= 0); return this; }
  like(c: string, p: string) { const rx = like(p, false); this.filters.push(r => rx.test(String(r[c] ?? ''))); return this; }
  ilike(c: string, p: string) { const rx = like(p, true); this.filters.push(r => rx.test(String(r[c] ?? ''))); return this; }
  is(c: string, v: unknown) { this.filters.push(r => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
  in(c: string, vs: unknown[]) { const set = new Set(vs.map(String)); this.filters.push(r => set.has(String(r[c]))); return this; }
  contains(c: string, v: unknown) {
    this.filters.push(r => (Array.isArray(r[c]) && Array.isArray(v) ? (v as unknown[]).every(x => (r[c] as unknown[]).includes(x)) : true));
    return this;
  }
  match(o: Row) { for (const [k, v] of Object.entries(o)) this.eq(k, v); return this; }
  not(c: string, op: string, v: unknown) {
    if (op === 'is') this.filters.push(r => !(v === null ? r[c] === null || r[c] === undefined : r[c] === v));
    else if (op === 'in') { const set = new Set(parseList(String(v))); this.filters.push(r => !set.has(String(r[c]))); }
    else if (op === 'eq') this.filters.push(r => String(r[c]) !== String(v));
    return this;
  }
  filter(c: string, op: string, v: unknown) {
    if (op === 'in') return this.in(c, parseList(String(v)));
    const f = (this as unknown as Record<string, (c: string, v: unknown) => Query>)[op];
    return typeof f === 'function' ? f.call(this, c, v) : this;
  }
  /** "a.eq.x,b.ilike.%y%": each part is checked; a row matches when any part does */
  or(expr: string) {
    const parts = expr.split(',').map(p => p.trim().split('.')).filter(p => p.length >= 3);
    this.filters.push(r => parts.some(([c, op, ...rest]) => {
      const v = rest.join('.');
      if (op === 'eq') return String(r[c]) === v;
      if (op === 'is') return v === 'null' ? r[c] === null || r[c] === undefined : String(r[c]) === v;
      if (op === 'ilike' || op === 'like') return like(v.replace(/\*/g, '%'), op === 'ilike').test(String(r[c] ?? ''));
      if (op === 'in') return parseList(v).includes(String(r[c]));
      return true;
    }));
    return this;
  }
  textSearch(c: string, q: string) { return this.ilike(c, `%${q}%`); }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push({ col: c, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this; }
  single() { this.single_ = 'one'; return this; }
  maybeSingle() { this.single_ = 'maybe'; return this; }
  abortSignal() { return this; }
  returns() { return this; }
  throwOnError() { return this; }

  private run(): Result {
    if (!demoReady()) return { data: null, error: demoError('The preview is still starting.'), status: 503 };
    const all = this.rows();
    const hit = all.filter(r => this.filters.every(f => f(r)));
    if (this.mode !== 'select') {
      let changed: Row[] = [];
      if (this.mode === 'insert' || this.mode === 'upsert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]).map(r => ({ id: demoId(), created_at: nowIso(), ...r }));
        for (const r of list) {
          const i = this.mode === 'upsert' ? all.findIndex(x => x.id === r.id) : -1;
          if (i >= 0) all[i] = { ...all[i], ...r };
          else all.unshift(r);
        }
        changed = list;
      } else if (this.mode === 'update') {
        for (const r of hit) Object.assign(r, this.payload, { updated_at: nowIso() });
        changed = hit;
      } else {
        demo().state.tables[this.table] = all.filter(r => !hit.includes(r));
        changed = hit;
      }
      simulated();
      const data = this.returning ? (this.single_ ? changed[0] ?? null : changed) : null;
      return { data: JSON.parse(JSON.stringify(data)), error: null, status: 200 };
    }
    let out = [...hit];
    for (const o of [...this.orders].reverse()) out.sort((a, b) => cmp(a[o.col], b[o.col]) * (o.asc ? 1 : -1));
    const count = out.length;
    if (this.to_ !== null) out = out.slice(this.from_, this.to_ + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count, status: 200 };
    if (this.single_) {
      if (out.length === 0 && this.single_ === 'one') return { data: null, error: demoError('No demonstration row.', 'PGRST116'), status: 406 };
      return { data: JSON.parse(JSON.stringify(out[0] ?? null)), error: null, count: this.countMode ? count : null, status: 200 };
    }
    return { data: JSON.parse(JSON.stringify(out)), error: null, count: this.countMode ? count : null, status: 200 };
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return new Promise<Result>(r => setTimeout(() => r(this.run()), 60)).then(ok, fail);
  }
}

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
  await new Promise(r => setTimeout(r, 60));
  if (!demoReady()) return { data: null, error: demoError('The preview is still starting.'), status: 503 };
  const handler = findRpc(name);
  if (!handler) {
    unavailable(`rpc ${name}`);
    return { data: null, error: demoError('This is not available in the demonstration yet. Nothing was read from or written to the live CRM.'), status: 404 };
  }
  try {
    return { data: JSON.parse(JSON.stringify(handler(demo(), args) ?? null)), error: null, status: 200 };
  } catch (e) {
    return { data: null, error: demoError(e instanceof Error ? e.message : 'The demonstration could not answer.', 'P0001'), status: 400 };
  }
}

const channel = () => {
  const ch = {
    on: () => ch,
    subscribe: (cb?: (status: string) => void) => { setTimeout(() => cb?.('SUBSCRIBED'), 0); return ch; },
    unsubscribe: async () => 'ok',
    send: async () => 'ok',
    track: async () => 'ok',
    untrack: async () => 'ok',
    presenceState: () => ({})
  };
  return ch;
};

const session = () => ({
  access_token: 'demonstration-preview-not-a-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'demonstration-preview',
  user: { id: DEMO_ME_ID, aud: 'preview', role: 'preview', email: 'demo.preview@example.invalid', app_metadata: {}, user_metadata: {}, created_at: nowIso() }
});
const refusedAuth = async () => ({ data: { user: null, session: null }, error: demoError('Signing in is not available in the demonstration.') });

const fake = {
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => ({ data: { user: session().user }, error: null }),
    // like supabase-js: a listener is told about the current (demonstration) session once, right after it subscribes
    onAuthStateChange: (cb: (event: string, s: ReturnType<typeof session> | null) => void) => {
      let live = true;
      setTimeout(() => { if (live) cb('INITIAL_SESSION', session()); }, 0);
      return { data: { subscription: { unsubscribe() { live = false; } } } };
    },
    refreshSession: async () => ({ data: { session: session(), user: session().user }, error: null }),
    signOut: async () => { postToParent({ type: 'crm-preview:exit' }); return { error: null }; },
    signInWithPassword: refusedAuth,
    signInWithOAuth: refusedAuth,
    signUp: refusedAuth,
    updateUser: refusedAuth,
    resetPasswordForEmail: refusedAuth,
    setSession: refusedAuth,
    mfa: { listFactors: async () => ({ data: { all: [], totp: [] }, error: null }) }
  },
  from: (table: string) => new Query(table),
  rpc: (name: string, args?: Record<string, unknown>) => rpc(name, args),
  channel,
  removeChannel: async () => 'ok',
  removeAllChannels: async () => [],
  getChannels: () => [],
  storage: {
    from: () => {
      const refuse = async () => ({ data: null, error: demoError('Files are not available in the demonstration. Nothing was uploaded.') });
      return { upload: refuse, uploadToSignedUrl: refuse, download: refuse, createSignedUrl: refuse, createSignedUrls: refuse, createSignedUploadUrl: refuse, remove: refuse, list: refuse,
               getPublicUrl: () => ({ data: { publicUrl: '' } }) };
    }
  },
  functions: { invoke: async () => ({ data: null, error: demoError('Not available in the demonstration.') }) }
};

export interface SupabaseConfig { url: string; isConfigured: boolean }
export function getSupabaseConfig(): SupabaseConfig { return { url: '', isConfigured: true }; }
export function getSupabase(): SupabaseClient | null { return fake as unknown as SupabaseClient; }
export function requireSupabase(): SupabaseClient { return fake as unknown as SupabaseClient; }
