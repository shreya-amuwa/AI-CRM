import React, { createContext, useContext, useState } from 'react';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  senderName: string;
  senderDept: string;
  senderDeptKey: string; // e.g., 'amuwa', 'whatsbox_sales', 'wabastore_support'
  targetKey: 
    | 'all' 
    | 'sales' 
    | 'support' 
    | 'amuwa' 
    | 'whatsbox_sales' 
    | 'whatsbox_support' 
    | 'wabastore_sales' 
    | 'wabastore_support' 
    | 'dtalk_sales' 
    | 'dtalk_support' 
    | 'digitree_sales' 
    | 'digitree_support' 
    | 'mpillar_sales' 
    | 'mpillar_support';
  targetLabel: string;
  priority: 'normal' | 'urgent' | 'announcement';
  timestamp: string;
  isRead: boolean;
}

interface NotificationContextType {
  notifications: AppNotification[];
  getNotificationsForUser: (currentDeptKey: string, currentSubDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => AppNotification[];
  getUnreadCountForUser: (currentDeptKey: string, currentSubDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => number;
  sendNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: (currentDeptKey: string, currentSubDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => void;
  deleteNotification: (id: string) => void;
}

const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'NOTIF-101',
    title: '🚀 Q3 Sales Target Kickoff',
    message: 'All Sales team members across Whatsbox, Wabastore, D Talk, Digitree, and M Pillar: Please review the updated Q3 enterprise target sheets.',
    senderName: 'Alexander Wright',
    senderDept: 'Amuwa Corporate HQ',
    senderDeptKey: 'amuwa',
    targetKey: 'sales',
    targetLabel: 'All Sales Sub-Departments',
    priority: 'urgent',
    timestamp: '10:15 AM Today',
    isRead: false
  },
  {
    id: 'NOTIF-102',
    title: '⚡ Support Ingestion Webhook SLA Alert',
    message: 'Support teams: Incoming Meta Ads and WhatsApp API webhook SLAs are running smoothly. Please log all outbound telecaller responses within 15 minutes.',
    senderName: 'Priya Sharma',
    senderDept: 'Support Operations',
    senderDeptKey: 'amuwa',
    targetKey: 'support',
    targetLabel: 'All Support Sub-Departments',
    priority: 'announcement',
    timestamp: '09:30 AM Today',
    isRead: false
  },
  {
    id: 'NOTIF-103',
    title: '🔒 Confidential: Whatsbox Sales Campaign Sync',
    message: 'Direct private dispatch for Whatsbox Sales team regarding exclusive enterprise lead distribution.',
    senderName: 'Karan Patel',
    senderDept: 'Whatsbox Sales',
    senderDeptKey: 'whatsbox_sales',
    targetKey: 'whatsbox_sales',
    targetLabel: 'Whatsbox - Sales Sub-Department',
    priority: 'urgent',
    timestamp: '11:05 AM Today',
    isRead: false
  },
  {
    id: 'NOTIF-104',
    title: '📢 System Maintenance Notice',
    message: 'Routine API gateway maintenance scheduled for Sunday at 02:00 AM IST. All webhook endpoints will remain active with 0 downtime.',
    senderName: 'IT Operations',
    senderDept: 'Amuwa Group Tech',
    senderDeptKey: 'amuwa',
    targetKey: 'all',
    targetLabel: 'All Departments & Sub-Departments',
    priority: 'normal',
    timestamp: 'Yesterday at 05:45 PM',
    isRead: true
  }
];

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>(INITIAL_NOTIFICATIONS);

  // Strict Privacy Helper: Check if a notification is intended for current user's department/sub-department
  const getNotificationsForUser = (currentDeptKey: string, currentSubDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => {
    return notifications.filter(n => {
      // 1. If user is the sender of this message, they can always see it
      if (n.senderDeptKey === currentDeptKey) return true;

      // 2. If message target is 'all', everyone can see it
      if (n.targetKey === 'all') return true;

      // 3. If target is 'sales', only sales sub-departments can see it
      if (n.targetKey === 'sales' && currentSubDept === 'sales') return true;

      // 4. If target is 'support', only support sub-departments can see it
      if (n.targetKey === 'support' && currentSubDept === 'support') return true;

      // 5. Exact sub-department match (e.g. 'whatsbox_sales' or 'wabastore_support')
      if (n.targetKey === currentDeptKey) return true;

      // Otherwise, hidden from other non-targeted parties for strict privacy!
      return false;
    });
  };

  const getUnreadCountForUser = (currentDeptKey: string, currentSubDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => {
    const userNotifs = getNotificationsForUser(currentDeptKey, currentSubDept);
    return userNotifs.filter(n => !n.isRead).length;
  };

  const sendNotification = (data: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => {
    const newNotif: AppNotification = {
      ...data,
      id: `NOTIF-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today',
      isRead: false
    };

    setNotifications(prev => [newNotif, ...prev]);
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAllAsRead = (currentDeptKey: string, currentSubDept: 'sales' | 'support' | 'education_training' | 'product_training' | null) => {
    const userNotifIds = new Set(getNotificationsForUser(currentDeptKey, currentSubDept).map(n => n.id));
    setNotifications(prev => prev.map(n => userNotifIds.has(n.id) ? { ...n, isRead: true } : n));
  };

  const deleteNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <NotificationContext.Provider value={{
      notifications,
      getNotificationsForUser,
      getUnreadCountForUser,
      sendNotification,
      markAsRead,
      markAllAsRead,
      deleteNotification
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
