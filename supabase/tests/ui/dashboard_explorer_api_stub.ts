// The API client for the Dashboard Explorer harness: answers the Explorer's own routes and records every call (window.__api).
const w = window as any;
w.__api = [] as { method: string; path: string; body: unknown }[];
w.__refuse = false;
export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}
const requests: any[] = [];
async function apiRequest<T>(method: string, path: string, opts: { body?: unknown } = {}): Promise<T> {
  w.__api.push({ method, path, body: opts.body ?? null });
  await new Promise(r => setTimeout(r, 20));
  if (w.__refuse) throw new ApiError('FORBIDDEN', 'Dashboard Explorer is only for the Managing Director.', 403);
  if (path === '/dashboard-explorer/recent') return [] as T;
  if (path === '/dashboard-explorer/improvements' && method === 'GET') return requests as T;
  if (path === '/dashboard-explorer/sessions') return { sessionId: `00000000-0000-4000-8000-${String(w.__api.length).padStart(12, '0')}`, startedAt: new Date().toISOString() } as T;
  if (path === '/dashboard-explorer/sessions/end') return { ended: true } as T;
  if (path === '/dashboard-explorer/improvements' && method === 'POST') {
    const b = opts.body as any;
    requests.unshift({ id: 'r1', reference: 'BUG-2026-00042', title: b.title, priority: b.priority, status: 'PENDING', dashboardId: b.dashboardId, department: b.department, page: b.pageTitle, viewport: b.viewport, resolutionNote: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return { id: 'r1', reference: 'BUG-2026-00042', status: 'PENDING', duplicate: false } as T;
  }
  throw new ApiError('NOT_FOUND', `Not in the harness: ${method} ${path}`, 404);
}
export const api = {
  get: <T,>(p: string) => apiRequest<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => apiRequest<T>('POST', p, { body: b ?? {} }),
  patch: <T,>(p: string, b: unknown) => apiRequest<T>('PATCH', p, { body: b }),
  delete: <T,>(p: string) => apiRequest<T>('DELETE', p)
};
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
export const clearApiCache = () => undefined;
export { apiRequest };
