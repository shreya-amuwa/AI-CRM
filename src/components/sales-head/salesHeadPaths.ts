/** The pages of the Sales Department Head dashboard and their addresses (kept apart from the component so they can be tested without a browser). */
export type SalesHeadPage =
  | 'overview' | 'operations' | 'leads-list' | 'leads-assign' | 'my-leads' | 'my-potential' | 'my-onboarding' | 'my-part-payments' | 'tasks' | 'performance' | 'top-performers' | 'income' | 'reports' | 'work-reports' | 'telecaller-sheets' | 'service-prices' | 'notices' | 'team' | 'chat' | 'raise-issue' | 'notifications' | 'field-visit-leads' | 'field-tracking';

export interface SalesHeadNavigate {
  (page: SalesHeadPage, options?: { filter?: string }): void;
}

/** Page ↔ path segment after /sales-head/dashboard/:id */
export const PATHS: Record<SalesHeadPage, string> = {
  overview: '',
  operations: 'operations',
  'leads-list': 'leads',
  'leads-assign': 'leads/assign',
  'my-leads': 'my-leads',
  'my-potential': 'my-potential',
  'my-onboarding': 'my-onboarding',
  'my-part-payments': 'my-part-payments',
  tasks: 'tasks',
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
  'field-tracking': 'field-tracking'
};
export const SALES_HEAD_BASE = (userId: string) => `/sales-head/dashboard/${userId}`;
export function parseSalesHeadPage(path: string, home: SalesHeadPage = 'overview'): SalesHeadPage {
  const rest = path.replace(/\/+$/, '').split('/').slice(4).join('/');
  // the bare dashboard address opens the person's home page: the Operations Dashboard for an Operations Head
  if (rest === '') return home;
  if (rest === 'overview') return 'overview';
  return (Object.keys(PATHS) as SalesHeadPage[]).find(k => PATHS[k] === rest) ?? home;
}

