import { openChat } from '../chat/chatEvents';
import { openFromNotification } from '../issues/issueEvents';

/**
 * Opens the screen a notification is about: a client chat, an @mention in a chat, or (through the same routing every dashboard already listens to) a meeting, a task,
 * a work update, a report, an attendance reminder, an issue... Returns true when something was opened, so the caller can close its panel.
 * Used by the bell and by the Notification Center, so both go to the same place.
 */
export interface OpenableNotification { type: string; entityType: string | null; entityId: string | null; messageId?: string | null }

export function openNotificationTarget(n: OpenableNotification): boolean {
  if (n.entityType === 'chat_mention' && n.entityId) {
    openChat({ tab: 'messages', conversationId: n.entityId, messageId: n.messageId ?? undefined });
    return true;
  }
  if (n.entityType === 'chat' && n.entityId) {
    openChat({ clientConversationId: n.entityId });
    return true;
  }
  return openFromNotification(n);
}
