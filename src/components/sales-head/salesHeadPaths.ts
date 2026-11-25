/** The pages of the Sales Department Head dashboard and their addresses (kept apart from the component so they can be tested without a browser). */
export type SalesHeadPage =
  | 'overview' | 'operations' | 'leads-list' | 'leads-assign' | 'sheet-upload' | 'my-leads' | 'my-potential' | 'my-onboarding' | 'my-part-payments' | 'tasks' | 'assign-task' | 'performance' | 'top-performers' | 'income' | 'reports' | 'work-reports' | 'telecaller-sheets' | 'service-prices' | 'notices' | 'team' | 'chat' | 'raise-issue' | 'notifications' | 'field-visit-leads' | 'field-tracking' | 'lead-whatsapp' | 'crocodial' | 'crocodial-me' | 'crocodial-leads' | 'work-updates'
  | 'telecallers' | 'business-associates' | 'my-income' | 'incentive-setup';

export interface SalesHeadNavigate {
  (page: SalesHeadPage, options?: { filter?: string }): void;
}

/** Page ↔ path segment after /sales-head/dashboard/:id */
export const PATHS: Record<SalesHeadPage, string> = {
  overview: '',
  operations: 'operations',
  'leads-list': 'leads',
  'leads-assign': 'leads/assign',
  'sheet-upload': 'sheet-upload',
  'my-leads': 'my-leads',
  'my-potential': 'my-potential',
  'my-onboarding': 'my-onboarding',
  'my-part-payments': 'my-part-payments',
  tasks: 'tasks',
  'assign-task': 'assign-task',
  performance: 'performance',
  'top-performers': 'top-performers',
  income: 'income',
  reports: 'reports',
  'work-reports': 'work-reports',
  'telecaller-sheets': 'telecaller-sheets',
  'service-prices': 'service-prices',
  notices: 'notices',
  team: 'team',
  chat: 'chat',
  'raise-issue': 'raise-issue',
  notifications: 'notifications',
  'field-visit-leads': 'field-visit-leads',
  'field-tracking': 'field-tracking',
  'lead-whatsapp': 'lead-whatsapp',
  crocodial: 'crocodial',
  'crocodial-me': 'crocodial/me',
  'crocodial-leads': 'crocodial/leads',
  'work-updates': 'work-updates',
  // role-wise sections (migration 20270117000300): the list, and one person's dashboard at <list>/<profile id>
  telecallers: 'telecallers',
  'business-associates': 'business-associates',
  // sales incentives (20270119000100): the head's own income (the Department Income page keeps its address "income") and the setup
  'my-income': 'my-income',
  'incentive-setup': 'incentive-setup'
};
/** The role-wise pages that open one person's full-page dashboard at <path>/<profile id>. */
export const ROLE_PAGES = ['telecallers', 'business-associates'] as const;
export type SalesHeadRolePage = (typeof ROLE_PAGES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const restOf = (path: string) => path.replace(/\/+$/, '').split('/').slice(4).join('/');
/** The person whose dashboard the address opens (".../telecallers/<id>"), or null for the list and every other page. */
export function parseSalesHeadPerson(path: string): string | null {
  const [seg, id, ...more] = restOf(path).split('/');
  return (ROLE_PAGES as readonly string[]).includes(seg) && id && !more.length && UUID.test(id) ? id.toLowerCase() : null;
}
export const SALES_HEAD_BASE = (userId: string) => `/sales-head/dashboard/${userId}`;
export function parseSalesHeadPage(path: string, home: SalesHeadPage = 'overview'): SalesHeadPage {
  const rest = restOf(path);
  // the bare dashboard address opens the person's home page: the Operations Dashboard for an Operations Head
  if (rest === '') return home;
  if (rest === 'overview') return 'overview';
  if (parseSalesHeadPerson(path)) return rest.split('/')[0] as SalesHeadRolePage;
  return (Object.keys(PATHS) as SalesHeadPage[]).find(k => PATHS[k] === rest) ?? home;
}

