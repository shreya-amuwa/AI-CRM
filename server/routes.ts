import {
  approvalsController as approvals,
  auditController as audit,
  customersController as customers,
  documentsController as documents,
  meController as me,
  notificationsController as notifications,
  organizationController as org,
  pipelineController as pipeline,
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
  { method: 'POST', path: '/users/:id/technical-consultant', handler: users.setTechnicalConsultant, options: S },
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

  { method: 'GET', path: '/pipeline/services', handler: pipeline.services },
  { method: 'GET', path: '/pipeline/counts', handler: pipeline.counts },
  { method: 'GET', path: '/pipeline/customers', handler: pipeline.list },
  { method: 'GET', path: '/pipeline/customers/:id', handler: pipeline.get },
  { method: 'POST', path: '/pipeline/leads', handler: pipeline.createLead },
  { method: 'PATCH', path: '/pipeline/leads/:id', handler: pipeline.updateLead },
  { method: 'POST', path: '/pipeline/customers/:id/move-to-potential', handler: pipeline.moveToPotential },
  { method: 'POST', path: '/pipeline/customers/:id/payments', handler: pipeline.recordPayment, options: S },
  { method: 'POST', path: '/pipeline/customers/:id/back-out', handler: pipeline.backOut },
  { method: 'POST', path: '/pipeline/customers/:id/client-account', handler: pipeline.createClientAccount, options: S },
  { method: 'POST', path: '/pipeline/customers/:id/handover/department-head', handler: pipeline.sendToDepartmentHead },
  { method: 'POST', path: '/pipeline/customers/:id/handover/team-lead', handler: pipeline.passToTeamLead },
  { method: 'POST', path: '/pipeline/customers/:id/handover/team-member', handler: pipeline.assignToTeamMember },
  { method: 'POST', path: '/pipeline/customers/:id/start-onboarding', handler: pipeline.startOnboarding },
  { method: 'PATCH', path: '/pipeline/customers/:id/onboarding', handler: pipeline.updateOnboarding },
  { method: 'POST', path: '/pipeline/customers/:id/forward-to-support', handler: pipeline.forwardToSupport },
  { method: 'POST', path: '/pipeline/customers/:id/return-to-sales', handler: pipeline.returnToSales },
  { method: 'PATCH', path: '/pipeline/customers/:id/checklist/:item', handler: pipeline.saveChecklistItem },
  { method: 'POST', path: '/pipeline/customers/:id/checklist/verify-all', handler: pipeline.verifyAll },
  { method: 'POST', path: '/pipeline/customers/:id/checklist/:item/review', handler: pipeline.reviewChecklistItem },
  { method: 'PATCH', path: '/pipeline/customers/:id/consultant-items/:item', handler: pipeline.saveConsultantItem },
  { method: 'GET', path: '/pipeline/review-counts', handler: pipeline.reviewCounts },
  { method: 'GET', path: '/pipeline/customers/:id/automations', handler: pipeline.automations },
  { method: 'POST', path: '/pipeline/customers/:id/automations/:automation', handler: pipeline.triggerAutomation, options: S },
  { method: 'GET', path: '/pipeline/inbound', handler: pipeline.inbound },
  { method: 'POST', path: '/pipeline/inbound/:leadId/claim', handler: pipeline.claimInbound },

  { method: 'POST', path: '/pipeline/customers/:id/documents', handler: documents.beginUpload },
  { method: 'POST', path: '/documents/:id/complete', handler: documents.complete },
  { method: 'POST', path: '/documents/:id/abort', handler: documents.abort },
  { method: 'GET', path: '/documents/:id/url', handler: documents.url },
  { method: 'DELETE', path: '/documents/:id', handler: documents.remove, options: S },

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
