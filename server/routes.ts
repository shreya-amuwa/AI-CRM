import {
  approvalsController as approvals,
  auditController as audit,
  customersController as customers,
  meController as me,
  notificationsController as notifications,
  organizationController as org,
  usersController as users
} from './controllers/index.js';
import { Router } from './http/router.js';

/** API v1 route table (mounted at /api/v1). Every route requires a valid session. */
export const router = new Router()
  .get('/me', me.get, { allowInactive: true })
  .patch('/me', me.update)

  .get('/users', users.list)
  .post('/users', users.create)
  .get('/users/:id', users.get)
  .patch('/users/:id', users.assign)
  .post('/users/:id/status', users.setStatus)
  .delete('/users/:id', users.remove)

  .get('/approval-requests', approvals.list)
  .post('/approval-requests/:id/approve', approvals.approve)
  .post('/approval-requests/:id/reject', approvals.reject)

  .get('/customers', customers.list)
  .post('/customers', customers.create)
  .post('/customers/import', customers.import)
  .get('/customers/summary', customers.summary)
  .get('/customers/:id', customers.get)
  .patch('/customers/:id', customers.update)
  .delete('/customers/:id', customers.remove)
  .get('/customers/:id/activities', customers.listActivities)
  .post('/customers/:id/activities', customers.addActivity)

  .get('/notifications', notifications.list)
  .get('/notifications/unread-count', notifications.unreadCount)
  .post('/notifications/read-all', notifications.markAllRead)
  .patch('/notifications/:id/read', notifications.markRead)
  .delete('/notifications/:id', notifications.remove)
  .post('/announcements', notifications.broadcast)

  .get('/departments', org.listDepartments)
  .post('/departments', org.createDepartment)
  .patch('/departments/:id', org.updateDepartment)
  .delete('/departments/:id', org.deleteDepartment)
  .get('/teams', org.listTeams)
  .post('/teams', org.createTeam)
  .patch('/teams/:id', org.updateTeam)
  .delete('/teams/:id', org.deleteTeam)

  .get('/audit-logs', audit.list);
