import { DEMO_ACTION_MESSAGE, type PreviewScenarioId } from '../../../shared/dashboardExplorer';
import { postToParent } from './bridge';
import type { PreviewIdentity } from './previewIdentity';

/**
 * The demonstration data of ONE preview: built from the fixtures for the chosen position, department and scenario, kept in memory only,
 * changed by simulated actions and thrown away on Reset, on another position or when the preview closes. Nothing is ever written anywhere else.
 */
export type Row = Record<string, unknown>;
export interface DemoState {
  /** rows the dashboards read straight from tables (the demo Supabase client) */
  tables: Record<string, Row[]>;
  /** anything else a fixture keeps (lists the API routes answer from) */
  bag: Record<string, unknown>;
}
export interface DemoContext {
  identity: PreviewIdentity;
  scenario: PreviewScenarioId;
  state: DemoState;
}
export interface RouteCtx extends DemoContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}
/** A demo answer for one API route; mutations call simulated() so the person is told nothing live changed. */
export interface DemoRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  handle: (ctx: RouteCtx) => unknown;
}
export type RpcHandler = (ctx: DemoContext, args: Record<string, unknown>) => unknown;
export interface FixtureModule {
  build?: (ctx: DemoContext) => void;
  routes?: DemoRoute[];
  rpcs?: Record<string, RpcHandler>;
}

/** Thrown by a demo route to answer like the API would (the page shows the message). */
export class DemoError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

const reported = new Set<string>();
let current: DemoContext | null = null;
let modules: FixtureModule[] = [];
const compiled: { method: string; rx: RegExp; keys: string[]; handle: DemoRoute['handle'] }[] = [];
let rpcs: Record<string, RpcHandler> = {};

export function startDemo(identity: PreviewIdentity, scenario: PreviewScenarioId, fixtureModules: FixtureModule[]): void {
  modules = fixtureModules;
  compiled.length = 0;
  rpcs = {};
  for (const m of modules) {
    for (const r of m.routes ?? []) {
      const keys: string[] = [];
      const rx = new RegExp('^' + r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?:([a-zA-Z]+)/g, (_s, k: string) => { keys.push(k); return '([^/]+)'; }) + '$');
      compiled.push({ method: r.method, rx, keys, handle: r.handle });
    }
    Object.assign(rpcs, m.rpcs ?? {});
  }
  reported.clear();
  current = { identity, scenario, state: { tables: {}, bag: {} } };
  for (const m of modules) m.build?.(current);
}

export function demo(): DemoContext {
  if (!current) throw new DemoError('DEMO_NOT_READY', 'The preview is still starting.', 503);
  return current;
}
export const demoReady = () => current !== null;

export function findRoute(method: string, path: string): { handle: DemoRoute['handle']; params: Record<string, string> } | null {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = r.rx.exec(path);
    if (m) return { handle: r.handle, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
export const findRpc = (name: string): RpcHandler | undefined => rpcs[name];

/** A simulated change: the demonstration data may change, the live CRM never does. Tells the person so (toolbar and toast). */
export function simulated(): void {
  postToParent({ type: 'crm-preview:demo-action', message: DEMO_ACTION_MESSAGE });
}

/** A page asked for something the demonstration data does not cover yet: listed in Dashboard Explorer, once per preview. */
export function unavailable(what: string): void {
  if (reported.has(what)) return;
  reported.add(what);
  postToParent({ type: 'crm-preview:unavailable', what: what.slice(0, 300) });
}

let seq = 0;
/** A new demonstration id (uuid-shaped, so pages that check the format accept it). */
export function demoId(): string {
  seq += 1;
  return `d9000000-0000-4000-8000-${seq.toString().padStart(12, '0')}`;
}
export const nowIso = () => new Date().toISOString();
