import { createContext, useContext } from 'react';

export type SectionSlug = 'overview' | 'services' | 'explore' | 'plans' | 'invoices' | 'tickets' | 'notifications';

export interface Shell { go: (to: string) => void; unread: number; refreshUnread: () => void; sub: string }
export const ShellCtx = createContext<Shell | null>(null);
export const useShell = (): Shell => { const v = useContext(ShellCtx); if (!v) throw new Error('outside shell'); return v; };
export const dashboardPath = (slug: SectionSlug, rest = '') => `/client/dashboard/${slug}${rest}`;

/** Where a notification leads. */
export function notificationTarget(n: { entityType: string | null; entityId: string | null }): string {
  switch (n.entityType) {
    case 'invoice': return dashboardPath('invoices');
    case 'service': return dashboardPath('services');
    case 'plan': case 'plan_request': return dashboardPath('plans');
    case 'ticket': return n.entityId ? dashboardPath('tickets', `/${n.entityId}`) : dashboardPath('tickets');
    case 'service_request': case 'addon': return dashboardPath('explore');
    default: return dashboardPath('overview');
  }
}

