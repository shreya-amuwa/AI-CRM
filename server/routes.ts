import {
  approvalsController as approvals,
  auditController as audit,
  customersController as customers,
  meController as me,
  notificationsController as notifications,
  organizationController as org,
  usersController as users
} from './controllers/index.js';
import type { RouteDef } from './http/types.js';

const S = { rate: 'sensitive' } as const;

/**
 * API v1 route table (mounted at /api/v1). Every route requires a valid
 * session; GET /health is registered separately in app.ts.
 * `rate: 'sensitive'` adds a tighter per-user quota on top of the default.
 */
export const routes: RouteDef[] = [
  { method: 'GET', path: '/me', handler: me.get, options: { allowInactive: true } },
  { method: 'PATCH', path: '/me', handler: me.update },

  { method: 'GET', path: '/users', handler: users.list },
  { method: 'POST', path: '/users', handler: users.create, options: S },
  { method: 'GET', path: '/users/:id', handler: users.get },
  { method: 'PATCH', path: '/users/:id', handler: users.assign, options: S },
  { method: 'POST', path: '/users/:id/status', handler: users.setStatus, options: S },
  { method: 'DELETE', path: '/users/:id', handler: users.remove, options: S },

  { method: 'GET', path: '/approval-requests', handler: approvals.list },
  { method: 'POST', path: '/approval-requests/:id/approve', handler: approvals.approve, options: S },
  { method: 'POST', path: '/approval-requests/:id/reject', handler: approvals.reject, options: S },

  { method: 'GET', path: '/customers', handler: customers.list },
  { method: 'POST', path: '/customers', handler: customers.create },
  { method: 'POST', path: '/customers/import', handler: customers.import, options: { rate: 'import' } },
  { method: 'GET', path: '/customers/summary', handler: customers.summary },
  { method: 'GET', path: '/customers/:id', handler: customers.get },
  { method: 'PATCH', path: '/customers/:id', handler: customers.update },
  { method: 'DELETE', path: '/customers/:id', handler: customers.remove, options: S },
  { method: 'GET', path: '/customers/:id/activities', handler: customers.listActivities },
  { method: 'POST', path: '/customers/:id/activities', handler: customers.addActivity },

  { method: 'GET', path: '/notifications', handler: notifications.list },
  { method: 'GET', path: '/notifications/unread-count', handler: notifications.unreadCount },
  { method: 'POST', path: '/notifications/read-all', handler: notifications.markAllRead },
  { method: 'PATCH', path: '/notifications/:id/read', handler: notifications.markRead },
  { method: 'DELETE', path: '/notifications/:id', handler: notifications.remove },
  { method: 'POST', path: '/announcements', handler: notifications.broadcast, options: S },

  { method: 'GET', path: '/departments', handler: org.listDepartments },
  { method: 'POST', path: '/departments', handler: org.createDepartment, options: S },
  { method: 'PATCH', path: '/departments/:id', handler: org.updateDepartment, options: S },
  { method: 'DELETE', path: '/departments/:id', handler: org.deleteDepartment, options: S },
  { method: 'GET', path: '/teams', handler: org.listTeams },
  { method: 'POST', path: '/teams', handler: org.createTeam, options: S },
  { method: 'PATCH', path: '/teams/:id', handler: org.updateTeam, options: S },
  { method: 'DELETE', path: '/teams/:id', handler: org.deleteTeam, options: S },

  { method: 'GET', path: '/audit-logs', handler: audit.list }
];
