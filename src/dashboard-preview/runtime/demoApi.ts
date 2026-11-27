import { relabelRoles } from '../../../shared/roleNames';
import type { ErrorCode } from '../../../shared/contracts';
import { demo, demoReady, DemoError, findRoute, unavailable } from './demoStore';

/**
 * Replaces src/lib/api/client.ts in the preview bundle (vite.preview.config.ts). Same exports, same behaviour for the pages - but every answer
 * comes from the demonstration data of this preview. There is no fetch() here: the live API cannot be reached from the preview at all.
 *  - A route the demonstration data covers answers like the API (a simulated change says "No live CRM data has been changed").
 *  - Any other route answers with a clear "not in the demonstration yet" error, which the page shows as it shows any error; Dashboard Explorer
 *    lists it, so unsupported modules are visible instead of silently empty.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function clearApiCache(): void {
  /* nothing is cached: every answer is read from the in-memory demonstration data */
}

const NOT_IN_DEMO_READ = 'This page has no demonstration data yet. Nothing was read from the live CRM.';
const NOT_IN_DEMO_WRITE = 'This action is not simulated in the demonstration yet. No live CRM data has been changed.';
// a short pause, so loading states show as they do in the live CRM
const pause = () => new Promise(r => setTimeout(r, 90));

export async function apiRequest<T>(method: string, path: string, options: { query?: Query; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  await pause();
  if (!demoReady()) throw new ApiError('INTERNAL', 'The preview is still starting.', 503);
  const route = findRoute(method, path);
  if (!route) {
    unavailable(`${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`);
    throw new ApiError(method === 'GET' ? 'NOT_FOUND' : 'FORBIDDEN', method === 'GET' ? NOT_IN_DEMO_READ : NOT_IN_DEMO_WRITE, method === 'GET' ? 404 : 403);
  }
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined && v !== null && v !== '') query[k] = String(v);
  try {
    // a copy: a page can never change the demonstration data by editing what it was given
    const out = await route.handle({ ...demo(), params: route.params, query, body: options.body ?? null });
    return (out === undefined ? null : JSON.parse(JSON.stringify(out))) as T;
  } catch (e) {
    if (e instanceof DemoError) throw new ApiError(e.code as ErrorCode, e.message, e.status);
    throw new ApiError('INTERNAL', 'The demonstration data could not answer this request.', 500);
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => apiRequest<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>('PATCH', path, { body }),
  delete: <T>(path: string) => apiRequest<T>('DELETE', path)
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err && typeof err === 'object' && 'code' in err && 'details' in err && 'hint' in err && 'message' in err) return relabelRoles(String((err as { message: unknown }).message));
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
