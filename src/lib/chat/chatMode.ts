import type { ChatInternalMode } from '../../../shared/contracts';
import { api } from '../api/client';

export type InternalChatMode = ChatInternalMode['mode'];

let pending: Promise<InternalChatMode> | null = null;

/**
 * How new direct / group messages are sent (migration 20261224000200): STANDARD = readable by the company, no keys needed; E2EE = sealed in the
 * browser as before. Asked once per page load. A server that does not know the setting yet (the migration not run, an older API) keeps the
 * encrypted behaviour, so the app never sends a message the database would refuse.
 */
export function internalChatMode(): Promise<InternalChatMode> {
  if (!pending) {
    pending = api.get<ChatInternalMode>('/chat/settings').then(
      r => (r?.mode === 'STANDARD' ? 'STANDARD' : 'E2EE'),
      () => { pending = null; return 'E2EE' as const; }
    );
  }
  return pending;
}

/** For tests and after a Super Admin switch: ask the server again next time. */
export function forgetInternalChatMode() { pending = null; }
