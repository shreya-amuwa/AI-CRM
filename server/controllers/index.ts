/**
 * Controllers: translate HTTP ⇄ service calls. No business rules here.
 */
import type { Handler } from '../http/types.js';
import { createServices } from '../services/index.js';

const svc = (ctx: Parameters<Handler>[0]) => createServices(ctx.db);
const ok = <T>(data: T, status = 200) => ({ status, data });

export const meController = {
  get: (async ctx => ok(await svc(ctx).users.me(ctx.actor))) as Handler,
  update: (async ctx => ok(await svc(ctx).users.updateMe(ctx.actor, ctx.req.body))) as Handler
};

export const usersController = {
  list: (async ctx => ok(await svc(ctx).users.list(ctx.actor, ctx.req.query))) as Handler,
  get: (async ctx => ok(await svc(ctx).users.get(ctx.params.id))) as Handler,
  create: (async ctx => ok(await svc(ctx).users.create(ctx.actor, ctx.req.body), 201)) as Handler,
  assign: (async ctx => ok(await svc(ctx).users.assign(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setStatus: (async ctx => ok(await svc(ctx).users.setStatus(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  remove: (async ctx => {
    await svc(ctx).users.delete(ctx.actor, ctx.params.id);
    return ok(null);
  }) as Handler
};

export const approvalsController = {
  list: (async ctx => ok(await svc(ctx).approvals.list(ctx.actor, ctx.req.query))) as Handler,
  approve: (async ctx => ok(await svc(ctx).approvals.approve(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  reject: (async ctx => ok(await svc(ctx).approvals.reject(ctx.actor, ctx.params.id, ctx.req.body))) as Handler
};

export const customersController = {
  list: (async ctx => ok(await svc(ctx).customers.list(ctx.req.query))) as Handler,
  summary: (async ctx => ok(await svc(ctx).customers.summary())) as Handler,
  get: (async ctx => ok(await svc(ctx).customers.get(ctx.params.id))) as Handler,
  create: (async ctx => ok(await svc(ctx).customers.create(ctx.actor, ctx.req.body), 201)) as Handler,
  import: (async ctx => ok(await svc(ctx).customers.import(ctx.actor, ctx.req.body))) as Handler,
  update: (async ctx => ok(await svc(ctx).customers.update(ctx.params.id, ctx.req.body))) as Handler,
  remove: (async ctx => {
    await svc(ctx).customers.delete(ctx.actor, ctx.params.id);
    return ok(null);
  }) as Handler,
  listActivities: (async ctx => ok(await svc(ctx).customers.listActivities(ctx.params.id))) as Handler,
  addActivity: (async ctx => ok(await svc(ctx).customers.addActivity(ctx.params.id, ctx.req.body), 201)) as Handler
};

export const notificationsController = {
  list: (async ctx => ok(await svc(ctx).notifications.list(ctx.req.query))) as Handler,
  unreadCount: (async ctx => ok(await svc(ctx).notifications.unreadCount())) as Handler,
  markRead: (async ctx => ok(await svc(ctx).notifications.markRead(ctx.params.id))) as Handler,
  markAllRead: (async ctx => ok(await svc(ctx).notifications.markAllRead())) as Handler,
  remove: (async ctx => {
    await svc(ctx).notifications.delete(ctx.params.id);
    return ok(null);
  }) as Handler,
  broadcast: (async ctx => ok(await svc(ctx).notifications.broadcast(ctx.actor, ctx.req.body), 201)) as Handler
};

export const organizationController = {
  listDepartments: (async ctx => ok(await svc(ctx).organization.listDepartments())) as Handler,
  createDepartment: (async ctx => ok(await svc(ctx).organization.createDepartment(ctx.actor, ctx.req.body), 201)) as Handler,
  updateDepartment: (async ctx => ok(await svc(ctx).organization.updateDepartment(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  deleteDepartment: (async ctx => {
    await svc(ctx).organization.deleteDepartment(ctx.actor, ctx.params.id);
    return ok(null);
  }) as Handler,
  listTeams: (async ctx => ok(await svc(ctx).organization.listTeams(ctx.req.query))) as Handler,
  createTeam: (async ctx => ok(await svc(ctx).organization.createTeam(ctx.actor, ctx.req.body), 201)) as Handler,
  updateTeam: (async ctx => ok(await svc(ctx).organization.updateTeam(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  deleteTeam: (async ctx => {
    await svc(ctx).organization.deleteTeam(ctx.actor, ctx.params.id);
    return ok(null);
  }) as Handler
};

export const auditController = {
  list: (async ctx => ok(await svc(ctx).audit.list(ctx.actor, ctx.req.query))) as Handler
};

export const pipelineController = {
  services: (async ctx => ok(await svc(ctx).pipeline.services())) as Handler,
  counts: (async ctx => ok(await svc(ctx).pipeline.counts())) as Handler,
  list: (async ctx => ok(await svc(ctx).pipeline.list(ctx.actor, ctx.req.query))) as Handler,
  get: (async ctx => ok(await svc(ctx).pipeline.get(ctx.params.id))) as Handler,
  createLead: (async ctx => ok(await svc(ctx).pipeline.createLead(ctx.actor, ctx.req.body), 201)) as Handler,
  updateLead: (async ctx => ok(await svc(ctx).pipeline.updateLead(ctx.params.id, ctx.req.body))) as Handler,
  moveToPotential: (async ctx => ok(await svc(ctx).pipeline.moveToPotential(ctx.params.id, ctx.req.body))) as Handler,
  recordPayment: (async ctx => ok(await svc(ctx).pipeline.recordPayment(ctx.params.id, ctx.req.body))) as Handler,
  startOnboarding: (async ctx => ok(await svc(ctx).pipeline.startOnboarding(ctx.params.id, ctx.req.body))) as Handler,
  updateOnboarding: (async ctx => ok(await svc(ctx).pipeline.updateOnboarding(ctx.params.id, ctx.req.body))) as Handler,
  forwardToSupport: (async ctx => ok(await svc(ctx).pipeline.forwardToSupport(ctx.params.id))) as Handler,
  inbound: (async ctx => ok(await svc(ctx).pipeline.inbound(ctx.actor))) as Handler,
  claimInbound: (async ctx => ok(await svc(ctx).pipeline.claimInbound(ctx.params.leadId), 201)) as Handler,
  saveChecklistItem: (async ctx => {
    await svc(ctx).pipeline.saveChecklistItem(ctx.params.id, ctx.params.item, ctx.req.body);
    return ok(null);
  }) as Handler,
  reviewChecklistItem: (async ctx => {
    await svc(ctx).pipeline.reviewChecklistItem(ctx.params.id, ctx.params.item, ctx.req.body);
    return ok(null);
  }) as Handler
};

export const documentsController = {
  beginUpload: (async ctx => ok(await svc(ctx).pipeline.beginUpload(ctx.params.id, ctx.req.body), 201)) as Handler,
  complete: (async ctx => ok(await svc(ctx).pipeline.completeUpload(ctx.params.id))) as Handler,
  abort: (async ctx => {
    await svc(ctx).pipeline.abortUpload(ctx.params.id);
    return ok(null);
  }) as Handler,
  url: (async ctx => ok(await svc(ctx).pipeline.documentUrl(ctx.params.id, ctx.req.query))) as Handler,
  remove: (async ctx => {
    await svc(ctx).pipeline.deleteDocument(ctx.params.id);
    return ok(null);
  }) as Handler
};
