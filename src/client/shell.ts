import { createContext, useContext } from 'react';
import type { ClientJourney } from '../../shared/contracts';
import type { Loaded } from './hooks';

export type SectionSlug = 'overview' | 'journey' | 'services' | 'campaigns' | 'explore' | 'plans' | 'calendar' | 'documents' | 'invoices' | 'tickets' | 'chat' | 'notifications' | 'docs';

export interface Shell {
  go: (to: string) => void; unread: number; refreshUnread: () => void; chatUnread: number; refreshChatUnread: () => void; sub: string;
  /** The onboarding journey as the server works it out (stage, people, services and which sections are open). Reloads by itself. */
  journey: Loaded<ClientJourney>;
}

/**
 * Is this section open? The server decides (it refuses a closed section's data whatever the screen does); the screen only shows it.
 * Until the journey has loaded a gated section counts as closed, so nothing is requested early.
 */
export function sectionState(journey: ClientJourney | null, slug: SectionSlug, loading = false): { enabled: boolean; reason: string | null; pending: boolean } {
  const gated: SectionSlug[] = ['services', 'campaigns', 'explore', 'plans', 'calendar', 'tickets'];
  if (!gated.includes(slug)) return { enabled: true, reason: null, pending: false };
  if (!journey) return { enabled: false, reason: loading ? null : 'This section is not available right now.', pending: loading };
  const a = journey.access[slug];
  return { enabled: a?.enabled ?? false, reason: a?.reason ?? null, pending: false };
}
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
    case 'chat': return dashboardPath('chat');
    case 'journey': return dashboardPath('journey');
    case 'ticket': return n.entityId ? dashboardPath('tickets', `/${n.entityId}`) : dashboardPath('tickets');
    case 'service_request': case 'addon': return dashboardPath('explore');
    default: return dashboardPath('overview');
  }
}

