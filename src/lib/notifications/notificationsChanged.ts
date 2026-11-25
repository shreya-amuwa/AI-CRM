/**
 * "This person's notifications changed": sent by the bell (NotificationContext), which already listens to the person's own notifications
 * on a filtered Realtime channel. Badges that need to follow notifications (the Notice Board count) listen to this instead of opening
 * another, unfiltered Realtime subscription to the notifications table (each of which the database checks for every notification).
 */
export const NOTIFICATIONS_CHANGED_EVENT = 'crm:notifications-changed';
export const notifyNotificationsChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT));
};
