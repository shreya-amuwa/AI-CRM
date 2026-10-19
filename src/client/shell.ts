import { createContext, useContext } from 'react';

export type SectionSlug = 'overview' | 'services' | 'campaigns' | 'explore' | 'plans' | 'calendar' | 'documents' | 'invoices' | 'tickets' | 'notifications';

export interface Shell { go: (to: string) => void; unread: number; refreshUnread: () => void; sub: string }
export const ShellCtx = createContext<Shell | null>(null);
export const useShell = (): Shell => { const v = useContext(ShellCtx); if (!v) throw new Error('outside shell'); return v; };
export const dashboardPath = (slug: SectionSlug, rest = '') => `/client/dashboard/${slug}${rest}`;

/** Where a notification leads. */
export function notificationTarget(n: { type?: string; entityType: string | null; entityId: string | null }): string {
  switch (n.entityType) {
    case 'invoice': return dashboardPath('invoices');
    case 'calendar': return dashboardPath('calendar');
    case 'document': return dashboardPath('documents');
    case 'service': return dashboardPath('services');
    case 'announcement': return n.type === 'NEW_SERVICE' ? dashboardPath('explore') : dashboardPath('overview');
    case 'plan': case 'plan_request': return dashboardPath('plans');
    case 'ticket': return n.entityId ? dashboardPath('tickets', `/${n.entityId}`) : dashboardPath('tickets');
    case 'service_request': case 'addon': return dashboardPath('explore');
    default: return dashboardPath('overview');
  }
}

