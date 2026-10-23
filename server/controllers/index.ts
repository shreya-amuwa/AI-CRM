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
  setTechnicalConsultant: (async ctx => ok(await svc(ctx).users.setTechnicalConsultant(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setSalesSubRole: (async ctx => ok(await svc(ctx).users.setSalesSubRole(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
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
  remove: (async ctx => ok(await svc(ctx).pipeline.deleteCustomer(ctx.actor, ctx.params.id))) as Handler,
  listActivities: (async ctx => ok(await svc(ctx).customers.listActivities(ctx.params.id))) as Handler,
  addActivity: (async ctx => ok(await svc(ctx).customers.addActivity(ctx.params.id, ctx.req.body), 201)) as Handler,
  /** Support: the Excel sheet of existing customers (preview or save) and the client's set-password e-mail. */
  importExisting: (async ctx => ok(await svc(ctx).customerImport.importExisting(ctx.actor, ctx.req.body, ctx.req.headers.origin))) as Handler,
  sendClientPasswordEmail: (async ctx => ok(await svc(ctx).customerImport.sendPasswordEmail(ctx.actor, ctx.params.id, ctx.req.headers.origin))) as Handler
};

export const chatController = {
  internalList: (async ctx => ok(await svc(ctx).chat.internalList(ctx.req.query))) as Handler,
  myClients: (async ctx => ok(await svc(ctx).chat.myClients(ctx.req.query))) as Handler,
  review: (async ctx => ok(await svc(ctx).chat.review(ctx.req.query))) as Handler,
  reviewOpen: (async ctx => ok(await svc(ctx).chat.reviewOpen(ctx.params.id))) as Handler,
  unread: (async ctx => ok(await svc(ctx).chat.unread())) as Handler,
  customerConversation: (async ctx => ok(await svc(ctx).chat.customerConversation(ctx.params.customerId))) as Handler,
  detail: (async ctx => ok(await svc(ctx).chat.detail(ctx.params.id))) as Handler,
  directory: (async ctx => ok(await svc(ctx).chat.directory(ctx.req.query))) as Handler,
  openDirect: (async ctx => ok(await svc(ctx).chat.openDirect(ctx.req.body))) as Handler,
  createGroup: (async ctx => ok(await svc(ctx).chat.createGroup(ctx.req.body), 201)) as Handler,
  renameGroup: (async ctx => ok(await svc(ctx).chat.renameGroup(ctx.params.id, ctx.req.body))) as Handler,
  addMembers: (async ctx => ok(await svc(ctx).chat.addMembers(ctx.params.id, ctx.req.body))) as Handler,
  removeMember: (async ctx => ok(await svc(ctx).chat.removeMember(ctx.params.id, ctx.params.profileId))) as Handler,
  setAdmin: (async ctx => ok(await svc(ctx).chat.setAdmin(ctx.params.id, ctx.req.body))) as Handler,
  leave: (async ctx => ok(await svc(ctx).chat.leave(ctx.params.id))) as Handler,
  messages: (async ctx => ok(await svc(ctx).chat.messages(ctx.params.id, ctx.req.query))) as Handler,
  send: (async ctx => ok(await svc(ctx).chat.send(ctx.params.id, ctx.req.body), 201)) as Handler,
  markRead: (async ctx => ok(await svc(ctx).chat.markRead(ctx.params.id, ctx.req.body))) as Handler,
  beginUpload: (async ctx => ok(await svc(ctx).chat.beginUpload(ctx.params.id, ctx.req.body), 201)) as Handler,
  completeUpload: (async ctx => ok(await svc(ctx).chat.completeUpload(ctx.params.id))) as Handler,
  abortUpload: (async ctx => ok(await svc(ctx).chat.abortUpload(ctx.params.id))) as Handler,
  attachmentUrl: (async ctx => ok(await svc(ctx).chat.attachmentUrl(ctx.params.id, ctx.req.query))) as Handler
};

export const ticketFilesController = {
  forTicket: (async ctx => ok(await svc(ctx).ticketFiles.forTicket(ctx.params.id))) as Handler,
  beginUpload: (async ctx => ok(await svc(ctx).ticketFiles.beginUpload(ctx.req.body), 201)) as Handler,
  completeUpload: (async ctx => ok(await svc(ctx).ticketFiles.completeUpload(ctx.params.id))) as Handler,
  abortUpload: (async ctx => ok(await svc(ctx).ticketFiles.abortUpload(ctx.params.id))) as Handler,
  attachmentUrl: (async ctx => ok(await svc(ctx).ticketFiles.attachmentUrl(ctx.params.id, ctx.req.query))) as Handler
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

import { runHrAutomation } from '../automations/hrDispatcher.js';

export const hrController = {
  recordRmLogin: (async ctx => (await svc(ctx).hr.recordRmLogin(), ok(null))) as Handler,
  attendance: (async ctx => ok(await svc(ctx).hr.attendance(ctx.req.query))) as Handler,
  manualPunch: (async ctx => (await svc(ctx).hr.manualPunch(ctx.req.body), ok(null, 201))) as Handler,
  personalDetails: (async ctx => ok(await svc(ctx).hr.personalDetails())) as Handler,
  submitLeave: (async ctx => ok(await svc(ctx).hr.submitLeave(ctx.req.body), 201)) as Handler,
  myLeave: (async ctx => ok(await svc(ctx).hr.myLeave())) as Handler,
  leaveToReview: (async ctx => ok(await svc(ctx).hr.leaveToReview())) as Handler,
  decideAsDepartmentHead: (async ctx => ok(await svc(ctx).hr.decideAsDepartmentHead(ctx.params.id, ctx.req.body))) as Handler,
  decideAsHr: (async ctx => ok(await svc(ctx).hr.decideAsHr(ctx.params.id, ctx.req.body))) as Handler,
  monthlySummary: (async ctx => ok(await svc(ctx).hr.monthlySummary(ctx.req.query))) as Handler,
  emailOverview: (async ctx => ok(await svc(ctx).hr.emailOverview())) as Handler,
  emailCards: (async ctx => ok(await svc(ctx).hr.emailCards())) as Handler,
  emailHistory: (async ctx => ok(await svc(ctx).hr.emailHistory(ctx.req.query))) as Handler,
  probationList: (async ctx => ok(await svc(ctx).hr.probationList())) as Handler,
  confirmProbation: (async ctx => ok(await svc(ctx).hr.confirmProbation(ctx.params.id, ctx.req.body))) as Handler,
  dismissProbation: (async ctx => ok(await svc(ctx).hr.dismissProbation(ctx.params.id, ctx.req.body))) as Handler,
  retryEmail: (async ctx => ok(await svc(ctx).hr.retryEmail(ctx.params.id))) as Handler,
  emailDataIssues: (async ctx => ok(await svc(ctx).hr.emailDataIssues())) as Handler,
  setEmployeeDates: (async ctx => ok(await svc(ctx).hr.setEmployeeDates(ctx.req.body))) as Handler,
  /** "Run the check now": decides what is due and sends it (HR staff only; the same work the scheduler does). */
  runEmailAutomation: (async ctx => {
    await svc(ctx).hr.emailOverview(); // the database refuses anyone who is not HR staff
    return ok(await runHrAutomation());
  }) as Handler
};

export const performanceController = {
  people: (async ctx => ok(await svc(ctx).performance.people(ctx.req.query))) as Handler,
  report: (async ctx => ok(await svc(ctx).performance.report(ctx.req.query))) as Handler,
  generate: (async ctx => ok(await svc(ctx).performance.generate(ctx.req.body))) as Handler,
  history: (async ctx => ok(await svc(ctx).performance.history(ctx.params.id))) as Handler
};

export const recruitmentController = {
  overview: (async ctx => ok(await svc(ctx).recruitment.overview())) as Handler,
  agenda: (async ctx => ok(await svc(ctx).recruitment.agenda())) as Handler,
  positions: (async ctx => ok(await svc(ctx).recruitment.positions())) as Handler,
  recruiters: (async ctx => ok(await svc(ctx).recruitment.recruiters())) as Handler,
  savePosition: (async ctx => ok(await svc(ctx).recruitment.savePosition(ctx.req.body))) as Handler,
  list: (async ctx => ok(await svc(ctx).recruitment.list(ctx.req.query))) as Handler,
  get: (async ctx => ok(await svc(ctx).recruitment.get(ctx.params.id))) as Handler,
  create: (async ctx => ok(await svc(ctx).recruitment.createCandidate(ctx.req.body), 201)) as Handler,
  update: (async ctx => ok(await svc(ctx).recruitment.updateCandidate(ctx.params.id, ctx.req.body))) as Handler,
  addAction: (async ctx => ok(await svc(ctx).recruitment.addAction(ctx.params.id, ctx.req.body), 201)) as Handler,
  closeAction: (async ctx => ok(await svc(ctx).recruitment.closeAction(ctx.params.id, ctx.req.body))) as Handler,
  scheduleCall: (async ctx => ok(await svc(ctx).recruitment.scheduleCall(ctx.params.id, ctx.req.body), 201)) as Handler,
  recordCall: (async ctx => ok(await svc(ctx).recruitment.recordCall(ctx.params.id, ctx.req.body), 201)) as Handler,
  setConfirmation: (async ctx => ok(await svc(ctx).recruitment.setConfirmation(ctx.params.id, ctx.req.body))) as Handler
};

export const trainingController = {
  overview: (async ctx => ok(await svc(ctx).training.overview())) as Handler,
  programs: (async ctx => ok(await svc(ctx).training.programs())) as Handler,
  employees: (async ctx => ok(await svc(ctx).training.employees())) as Handler,
  program: (async ctx => ok(await svc(ctx).training.program(ctx.params.id))) as Handler,
  saveProgram: (async ctx => ok(await svc(ctx).training.saveProgram(ctx.req.body))) as Handler,
  cancelProgram: (async ctx => ok(await svc(ctx).training.cancelProgram(ctx.params.id, ctx.req.body))) as Handler,
  saveDay: (async ctx => ok(await svc(ctx).training.saveDay(ctx.params.id, ctx.params.day, ctx.req.body))) as Handler,
  enroll: (async ctx => ok(await svc(ctx).training.enroll(ctx.params.id, ctx.req.body))) as Handler,
  enrollment: (async ctx => ok(await svc(ctx).training.enrollment(ctx.params.id))) as Handler,
  unenroll: (async ctx => {
    await svc(ctx).training.unenroll(ctx.params.id);
    return ok(null);
  }) as Handler,
  saveReport: (async ctx => ok(await svc(ctx).training.saveReport(ctx.params.id, ctx.params.day, ctx.req.body))) as Handler,
  review: (async ctx => ok(await svc(ctx).training.review(ctx.params.id, ctx.req.body))) as Handler,
  records: (async ctx => ok(await svc(ctx).training.records(ctx.req.query))) as Handler
};

export const auditController = {
  list: (async ctx => ok(await svc(ctx).audit.list(ctx.actor, ctx.req.query))) as Handler,
  /** The security and audit log viewer: search, filters, pages. */
  search: (async ctx => ok(await svc(ctx).dashboards.auditSearch(ctx.actor, ctx.req.query))) as Handler,
  actions: (async ctx => ok(await svc(ctx).dashboards.auditActions(ctx.actor))) as Handler,
  /** A browser-side export is recorded: what and how many rows. */
  recordExport: (async ctx => ok(await svc(ctx).dashboards.recordExport(ctx.req.body))) as Handler
};

export const dashboardController = {
  company: (async ctx => ok(await svc(ctx).dashboards.companyOverview(ctx.actor))) as Handler,
  workflow: (async ctx => ok(await svc(ctx).dashboards.companyWorkflow(ctx.actor))) as Handler,
  scope: (async ctx => ok(await svc(ctx).dashboards.scopeOverview(ctx.actor, ctx.req.query))) as Handler
};

export const pipelineController = {
  services: (async ctx => ok(await svc(ctx).pipeline.services())) as Handler,
  counts: (async ctx => ok(await svc(ctx).pipeline.counts())) as Handler,
  divisionSupportOverview: (async ctx => ok(await svc(ctx).pipeline.divisionSupportOverview(ctx.req.query))) as Handler,
  divisionOverview: (async ctx => ok(await svc(ctx).pipeline.divisionOverview(ctx.req.query))) as Handler,
  list: (async ctx => ok(await svc(ctx).pipeline.list(ctx.actor, ctx.req.query))) as Handler,
  get: (async ctx => ok(await svc(ctx).pipeline.get(ctx.params.id))) as Handler,
  createLead: (async ctx => ok(await svc(ctx).pipeline.createLead(ctx.actor, ctx.req.body), 201)) as Handler,
  updateLead: (async ctx => ok(await svc(ctx).pipeline.updateLead(ctx.params.id, ctx.req.body))) as Handler,
  moveToPotential: (async ctx => ok(await svc(ctx).pipeline.moveToPotential(ctx.params.id, ctx.req.body))) as Handler,
  recordPayment: (async ctx => ok(await svc(ctx).pipeline.recordPayment(ctx.params.id, ctx.req.body))) as Handler,
  accountsCreateClientLogin: (async ctx => ok(await svc(ctx).pipeline.accountsCreateClientLogin(ctx.actor, ctx.params.id, ctx.req.body), 201)) as Handler,
  customerJourney: (async ctx => ok(await svc(ctx).pipeline.customerJourney(ctx.params.id))) as Handler,
  sendToDelivery: (async ctx => ok(await svc(ctx).pipeline.sendToDelivery(ctx.params.id, ctx.req.body))) as Handler,
  deliveryQueue: (async ctx => ok(await svc(ctx).pipeline.deliveryQueue(ctx.req.query))) as Handler,
  serviceJourneys: (async ctx => ok(await svc(ctx).pipeline.serviceJourneys())) as Handler,
  setServiceJourney: (async ctx => ok(await svc(ctx).pipeline.setServiceJourney(ctx.params.code, ctx.req.body))) as Handler,
  createClientAccount: (async ctx => ok(await svc(ctx).pipeline.createClientAccount(ctx.actor, ctx.params.id, ctx.req.body), 201)) as Handler,
  consultantSetWebsite: (async ctx => ok(await svc(ctx).pipeline.consultantSetWebsite(ctx.params.id, ctx.req.body))) as Handler,
  resendClientMessages: (async ctx => ok(await svc(ctx).pipeline.resendClientMessages(ctx.params.id))) as Handler,
  clientMessages: (async ctx => ok(await svc(ctx).pipeline.clientMessages(ctx.params.id))) as Handler,
  sendToDepartmentHead: (async ctx => {
    await svc(ctx).pipeline.sendToDepartmentHead(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  passToTeamLead: (async ctx => {
    await svc(ctx).pipeline.passToTeamLead(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  assignToTeamMember: (async ctx => {
    await svc(ctx).pipeline.assignToTeamMember(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  backOut: (async ctx => ok(await svc(ctx).pipeline.backOut(ctx.params.id, ctx.req.body))) as Handler,
  startOnboarding: (async ctx => ok(await svc(ctx).pipeline.startOnboarding(ctx.params.id, ctx.req.body))) as Handler,
  updateOnboarding: (async ctx => ok(await svc(ctx).pipeline.updateOnboarding(ctx.params.id, ctx.req.body))) as Handler,
  accountsConfirmations: (async ctx => ok(await svc(ctx).pipeline.accountsConfirmations(ctx.req.query))) as Handler,
  conversations: (async ctx => ok(await svc(ctx).pipeline.conversations(ctx.params.id))) as Handler,
  addConversation: (async ctx => ok(await svc(ctx).pipeline.addConversation(ctx.params.id, ctx.req.body), 201)) as Handler,
  updateConversation: (async ctx => {
    await svc(ctx).pipeline.updateConversation(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  sendToAccounts: (async ctx => ok(await svc(ctx).pipeline.sendToAccounts(ctx.params.id, ctx.req.body))) as Handler,
  paymentOverview: (async ctx => ok(await svc(ctx).pipeline.paymentOverview(ctx.params.id))) as Handler,
  paymentRequests: (async ctx => ok(await svc(ctx).pipeline.paymentRequests(ctx.req.query))) as Handler,
  accountsCounts: (async ctx => ok(await svc(ctx).pipeline.accountsCounts())) as Handler,
  accountsTeam: (async ctx => ok(await svc(ctx).pipeline.accountsTeam())) as Handler,
  recordAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.recordAccountsPayment(ctx.params.id, ctx.req.body), 201)) as Handler,
  updateAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.updateAccountsPayment(ctx.params.paymentId, ctx.params.id, ctx.req.body))) as Handler,
  verifyAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.verifyAccountsPayment(ctx.params.paymentId, ctx.params.id, ctx.req.body))) as Handler,
  rejectAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.rejectAccountsPayment(ctx.params.paymentId, ctx.params.id, ctx.req.body))) as Handler,
  reverseAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.reverseAccountsPayment(ctx.params.paymentId, ctx.params.id, ctx.req.body))) as Handler,
  confirmAndReturn: (async ctx => {
    await svc(ctx).pipeline.confirmAndReturn(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  returnToLeads: (async ctx => {
    await svc(ctx).pipeline.returnToLeads(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  assignPaymentOwner: (async ctx => ok(await svc(ctx).pipeline.assignPaymentOwner(ctx.params.id, ctx.req.body))) as Handler,
  addPaymentFollowUp: (async ctx => ok(await svc(ctx).pipeline.addPaymentFollowUp(ctx.params.id, ctx.req.body), 201)) as Handler,
  partPayments: (async ctx => ok(await svc(ctx).pipeline.partPayments(ctx.req.query))) as Handler,
  confirmAccountsPayment: (async ctx => {
    await svc(ctx).pipeline.confirmAccountsPayment(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  consultantSetContract: (async ctx => ok(await svc(ctx).pipeline.consultantSetContract(ctx.params.id, ctx.req.body))) as Handler,
  consultantSetAddonsRequired: (async ctx => ok(await svc(ctx).pipeline.consultantSetAddonsRequired(ctx.params.id, ctx.req.body))) as Handler,
  addonChecklist: (async ctx => ok(await svc(ctx).pipeline.addonChecklist(ctx.params.id))) as Handler,
  notesList: (async ctx => ok(await svc(ctx).pipeline.notesList(ctx.params.id))) as Handler,
  noteAdd: (async ctx => ok(await svc(ctx).pipeline.noteAdd(ctx.params.id, ctx.req.body), 201)) as Handler,
  noteUpdate: (async ctx => ok(await svc(ctx).pipeline.noteUpdate(ctx.params.id, ctx.params.noteId, ctx.req.body))) as Handler,
  consultantUpdateCustomer: (async ctx => ok(await svc(ctx).pipeline.consultantUpdateCustomer(ctx.params.id, ctx.req.body))) as Handler,
  consultantStartOnboarding: (async ctx => ok(await svc(ctx).pipeline.consultantStartOnboarding(ctx.params.id))) as Handler,
  forwardToSupport: (async ctx => ok(await svc(ctx).pipeline.forwardToSupport(ctx.params.id))) as Handler,
  returnToSales: (async ctx => {
    await svc(ctx).pipeline.returnToSales(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  inbound: (async ctx => ok(await svc(ctx).pipeline.inbound(ctx.actor))) as Handler,
  claimInbound: (async ctx => ok(await svc(ctx).pipeline.claimInbound(ctx.params.leadId), 201)) as Handler,
  saveChecklistItem: (async ctx => {
    await svc(ctx).pipeline.saveChecklistItem(ctx.params.id, ctx.params.item, ctx.req.body);
    return ok(null);
  }) as Handler,
  reviewCounts: (async ctx => ok(await svc(ctx).pipeline.reviewCounts())) as Handler,
  verifyAll: (async ctx => ok(await svc(ctx).pipeline.verifyAll(ctx.params.id))) as Handler,
  automations: (async ctx => ok(await svc(ctx).automations.list(ctx.params.id))) as Handler,
  triggerAutomation: (async ctx => ok(await svc(ctx).automations.trigger(ctx.params.id, ctx.params.automation))) as Handler,
  saveConsultantItem: (async ctx => {
    await svc(ctx).pipeline.saveConsultantItem(ctx.params.id, ctx.params.item, ctx.req.body);
    return ok(null);
  }) as Handler,
  reviewChecklistItem: (async ctx => {
    await svc(ctx).pipeline.reviewChecklistItem(ctx.params.id, ctx.params.item, ctx.req.body);
    return ok(null);
  }) as Handler
};

export const accountsFinanceController = {
  summary: (async ctx => ok(await svc(ctx).finance.summary(ctx.req.query))) as Handler,
  departments: (async ctx => ok(await svc(ctx).finance.byDepartment())) as Handler,
  income: (async ctx => ok(await svc(ctx).finance.income(ctx.req.query))) as Handler,
  expenses: (async ctx => ok(await svc(ctx).finance.expenses(ctx.req.query))) as Handler,
  addExpense: (async ctx => ok(await svc(ctx).finance.addExpense(ctx.req.body), 201)) as Handler,
  updateExpense: (async ctx => {
    await svc(ctx).finance.updateExpense(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler,
  deleteExpense: (async ctx => {
    await svc(ctx).finance.deleteExpense(ctx.params.id);
    return ok(null);
  }) as Handler,
  importExpenses: (async ctx => ok(await svc(ctx).finance.importExpenses(ctx.req.body))) as Handler,
  trend: (async ctx => ok(await svc(ctx).finance.trend(ctx.req.query))) as Handler
};

export const addonInvoiceController = {
  customerRequest: (async ctx => ok(await svc(ctx).addons.customerRequest(ctx.params.id))) as Handler,
  saveRequest: (async ctx => ok(await svc(ctx).addons.saveRequest(ctx.params.id, ctx.req.body))) as Handler,
  startDocuments: (async ctx => ok(await svc(ctx).addons.startDocuments(ctx.params.id))) as Handler,
  complete: (async ctx => ok(await svc(ctx).addons.complete(ctx.params.id))) as Handler,
  customerInvoices: (async ctx => ok(await svc(ctx).addons.customerInvoices(ctx.params.id))) as Handler,
  visibleInvoices: (async ctx => ok(await svc(ctx).addons.visibleInvoices(ctx.req.query))) as Handler,
  requests: (async ctx => ok(await svc(ctx).addons.requests(ctx.req.query))) as Handler,
  request: (async ctx => ok(await svc(ctx).addons.request(ctx.params.id))) as Handler,
  decide: (async ctx => ok(await svc(ctx).addons.decide(ctx.params.id, ctx.req.body))) as Handler,
  recordPayment: (async ctx => ok(await svc(ctx).addons.recordPayment(ctx.params.id, ctx.req.body), 201)) as Handler,
  decidePayment: (async ctx => ok(await svc(ctx).addons.decidePayment(ctx.params.id, ctx.req.body))) as Handler,
  confirmPayment: (async ctx => ok(await svc(ctx).addons.confirmPayment(ctx.params.id, ctx.req.body))) as Handler,
  invoices: (async ctx => ok(await svc(ctx).addons.invoices(ctx.req.query))) as Handler,
  updateInvoiceDetails: (async ctx => ok(await svc(ctx).addons.updateInvoiceDetails(ctx.params.id, ctx.req.body))) as Handler,
  setInvoiceStatus: (async ctx => ok(await svc(ctx).addons.setInvoiceStatus(ctx.params.id, ctx.req.body))) as Handler,
  invoiceCustomers: (async ctx => ok(await svc(ctx).addons.invoiceCustomers(ctx.req.query))) as Handler
};

export const documentsController = {
  beginInvoiceUpload: (async ctx => ok(await svc(ctx).pipeline.beginInvoiceUpload(ctx.req.body), 201)) as Handler,
  beginAddonInvoiceUpload: (async ctx => ok(await svc(ctx).pipeline.beginAddonInvoiceUpload(ctx.params.id, ctx.req.body), 201)) as Handler,
  beginInvoiceReplacement: (async ctx => ok(await svc(ctx).pipeline.beginInvoiceReplacement(ctx.params.id, ctx.req.body), 201)) as Handler,
  completeInvoiceUpload: (async ctx => ok(await svc(ctx).pipeline.completeInvoiceUpload(ctx.params.id), 201)) as Handler,
  invoiceDetail: (async ctx => ok(await svc(ctx).pipeline.invoiceDetail(ctx.params.id))) as Handler,
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

/** Staff side of the client dashboard: service requests (Technical Consultant), plans (Accounts), replies (Support). */
export const clientWorkflowController = {
  openServiceRequests: (async ctx => ok(await svc(ctx).client.openServiceRequests())) as Handler,
  serviceRequests: (async ctx => ok(await svc(ctx).client.consultantServiceRequests(ctx.params.id))) as Handler,
  decideServiceRequest: (async ctx => (await svc(ctx).client.decideServiceRequest(ctx.params.id, ctx.req.body), ok(null))) as Handler,
  plans: (async ctx => ok(await svc(ctx).client.accountsPlans())) as Handler,
  createPlan: (async ctx => ok(await svc(ctx).client.savePlan(null, ctx.req.body), 201)) as Handler,
  updatePlan: (async ctx => ok(await svc(ctx).client.savePlan(ctx.params.id, ctx.req.body))) as Handler,
  decidePlanRequest: (async ctx => (await svc(ctx).client.decidePlanRequest(ctx.params.id, ctx.req.body), ok(null))) as Handler,
  replyToTicket: (async ctx => (await svc(ctx).client.replyToClientTicket(ctx.params.id, ctx.req.body), ok(null, 201))) as Handler,
  activityCustomers: (async ctx => ok(await svc(ctx).client.activityCustomers(ctx.req.query))) as Handler,
  activityList: (async ctx => ok(await svc(ctx).client.activityList(ctx.params.id))) as Handler,
  logActivity: (async ctx => ok(await svc(ctx).client.logActivity(ctx.params.id, ctx.req.body), 201)) as Handler,
  updateActivity: (async ctx => ok(await svc(ctx).client.updateActivity(ctx.params.id, ctx.req.body))) as Handler,
  deleteActivity: (async ctx => ok(await svc(ctx).client.deleteActivity(ctx.params.id))) as Handler,
  documentQueue: (async ctx => ok(await svc(ctx).client.documentQueue(ctx.req.query))) as Handler,
  reviewDocument: (async ctx => ok(await svc(ctx).client.reviewDocument(ctx.params.id, ctx.params.item, ctx.req.body))) as Handler,
  uploadUrl: (async ctx => ok(await svc(ctx).client.uploadUrl(ctx.params.id, ctx.req.query))) as Handler
};

/** Accounts: the invoice builder (prefill, issue, confirm payment, retry delivery) and opening the stored PDFs. */
export const generatedInvoiceController = {
  prefill: (async ctx => ok(await svc(ctx).generatedInvoices.prefill(ctx.params.id, ctx.req.query))) as Handler,
  issue: (async ctx => {
    const r = await svc(ctx).generatedInvoices.issue(ctx.req.body);
    return ok({ invoice: r.invoice, steps: r.steps }, r.created ? 201 : 200);
  }) as Handler,
  setAgreementBasis: (async ctx => ok(await svc(ctx).generatedInvoices.setAgreementBasis(ctx.params.id, ctx.req.body))) as Handler,
  agreementReview: (async ctx => ok(await svc(ctx).generatedInvoices.agreementReview())) as Handler,
  confirmPayment: (async ctx => ok(await svc(ctx).generatedInvoices.confirmPayment(ctx.params.id, ctx.req.body))) as Handler,
  deliver: (async ctx => ok(await svc(ctx).generatedInvoices.deliver(ctx.params.id, ctx.req.body))) as Handler,
  file: (async ctx => ok(await svc(ctx).generatedInvoices.fileUrl(ctx.params.id, ctx.req.query))) as Handler
};

export const departmentIncomeController = {
  report: (async ctx => ok(await svc(ctx).departmentIncome.report(ctx.req.query))) as Handler,
  reconciliation: (async ctx => ok(await svc(ctx).departmentIncome.reconciliation())) as Handler,
  setOrderAttribution: (async ctx => ok(await svc(ctx).departmentIncome.setOrderAttribution(ctx.req.body))) as Handler,
  setCustomerAcquisition: (async ctx => ok(await svc(ctx).departmentIncome.setCustomerAcquisition(ctx.params.id, ctx.req.body))) as Handler,
  settings: (async ctx => ok(await svc(ctx).departmentIncome.settings())) as Handler,
  setSettings: (async ctx => ok(await svc(ctx).departmentIncome.setSettings(ctx.req.body))) as Handler
};

export const businessReportController = {
  report: (async ctx => ok(await svc(ctx).businessReport.report(ctx.req.query))) as Handler,
  transactions: (async ctx => ok(await svc(ctx).businessReport.transactions(ctx.req.query))) as Handler,
  orders: (async ctx => ok(await svc(ctx).businessReport.orders(ctx.req.query))) as Handler,
  people: (async ctx => ok(await svc(ctx).businessReport.people())) as Handler,
  invoiceBusiness: (async ctx => ok(await svc(ctx).businessReport.invoiceBusiness(ctx.params.id))) as Handler,
  tagInvoice: (async ctx => {
    await svc(ctx).businessReport.tagInvoice(ctx.params.id, ctx.req.body);
    return ok(null);
  }) as Handler
};

export const telecallerController = {
  home: (async ctx => ok(await svc(ctx).telecaller.home())) as Handler,
  assignable: (async ctx => ok(await svc(ctx).telecaller.assignable(ctx.req.query))) as Handler,
  lists: (async ctx => ok(await svc(ctx).telecaller.lists(ctx.req.query))) as Handler,
  assignSheet: (async ctx => ok(await svc(ctx).telecaller.assignSheet(ctx.req.body))) as Handler,
  storeSource: (async ctx => ok(await svc(ctx).telecaller.storeSource(ctx.params.id, ctx.req.body), 201)) as Handler,
  contacts: (async ctx => ok(await svc(ctx).telecaller.contacts(ctx.req.query))) as Handler,
  updateContact: (async ctx => ok(await svc(ctx).telecaller.updateContact(ctx.params.id, ctx.req.body))) as Handler,
  leads: (async ctx => ok(await svc(ctx).telecaller.leads(ctx.req.query))) as Handler,
  lead: (async ctx => ok(await svc(ctx).telecaller.lead(ctx.params.id))) as Handler,
  createLead: (async ctx => ok(await svc(ctx).telecaller.createLead(ctx.req.body), 201)) as Handler,
  updateLead: (async ctx => ok(await svc(ctx).telecaller.updateLead(ctx.params.id, ctx.req.body))) as Handler
};

export const businessAssociateController = {
  home: (async ctx => ok(await svc(ctx).ba.home())) as Handler,
  assignees: (async ctx => ok(await svc(ctx).ba.assignees())) as Handler,
  convertLead: (async ctx => ok(await svc(ctx).ba.convertLead(ctx.params.id, ctx.req.body), 201)) as Handler,
  reassign: (async ctx => ok(await svc(ctx).ba.reassign(ctx.params.id, ctx.req.body))) as Handler,
  contacts: (async ctx => ok(await svc(ctx).ba.contacts(ctx.req.query))) as Handler,
  contact: (async ctx => ok(await svc(ctx).ba.contact(ctx.params.id))) as Handler,
  updateContact: (async ctx => ok(await svc(ctx).ba.updateContact(ctx.params.id, ctx.req.body))) as Handler,
  addNote: (async ctx => ok(await svc(ctx).ba.addNote(ctx.params.id, ctx.req.body), 201)) as Handler,
  prices: (async ctx => ok(await svc(ctx).ba.prices())) as Handler,
  savePrice: (async ctx => ok(await svc(ctx).ba.savePrice(ctx.params.code, ctx.req.body))) as Handler,
  quotations: (async ctx => ok(await svc(ctx).ba.quotations(ctx.req.query))) as Handler,
  quotation: (async ctx => ok(await svc(ctx).ba.quotation(ctx.params.id))) as Handler,
  createQuotation: (async ctx => ok(await svc(ctx).ba.createQuotation(ctx.req.body), 201)) as Handler,
  updateQuotation: (async ctx => ok(await svc(ctx).ba.updateQuotation(ctx.params.id, ctx.req.body))) as Handler,
  aiQuotation: (async ctx => ok(await svc(ctx).ba.aiQuotation(ctx.params.id, ctx.req.body))) as Handler,
  reviewQuotation: (async ctx => ok(await svc(ctx).ba.reviewQuotation(ctx.params.id))) as Handler,
  reviseQuotation: (async ctx => ok(await svc(ctx).ba.reviseQuotation(ctx.params.id), 201)) as Handler,
  finalizeQuotation: (async ctx => ok(await svc(ctx).ba.finalizeQuotation(ctx.params.id))) as Handler,
  quotationFile: (async ctx => ok(await svc(ctx).ba.quotationFileUrl(ctx.params.id, ctx.req.query))) as Handler,
  demos: (async ctx => ok(await svc(ctx).ba.demos(ctx.req.query))) as Handler,
  createDemo: (async ctx => ok(await svc(ctx).ba.createDemo(ctx.req.body), 201)) as Handler,
  updateDemo: (async ctx => ok(await svc(ctx).ba.updateDemo(ctx.params.id, ctx.req.body))) as Handler,
  demoStatus: (async ctx => ok(await svc(ctx).ba.demoStatus(ctx.params.id, ctx.req.body))) as Handler,
  scopes: (async ctx => ok(await svc(ctx).ba.scopes(ctx.params.id))) as Handler,
  scope: (async ctx => ok(await svc(ctx).ba.scope(ctx.params.id))) as Handler,
  createScope: (async ctx => ok(await svc(ctx).ba.createScope(ctx.req.body), 201)) as Handler,
  updateScope: (async ctx => ok(await svc(ctx).ba.updateScope(ctx.params.id, ctx.req.body))) as Handler,
  aiScope: (async ctx => ok(await svc(ctx).ba.aiScope(ctx.params.id, ctx.req.body))) as Handler,
  reviewScope: (async ctx => ok(await svc(ctx).ba.reviewScope(ctx.params.id))) as Handler,
  finalizeScope: (async ctx => ok(await svc(ctx).ba.finalizeScope(ctx.params.id))) as Handler,
  scopeFile: (async ctx => ok(await svc(ctx).ba.scopeFileUrl(ctx.params.id, ctx.req.query))) as Handler,
  leads: (async ctx => ok(await svc(ctx).ba.leads(ctx.req.query))) as Handler,
  lead: (async ctx => ok(await svc(ctx).ba.lead(ctx.params.id))) as Handler,
  createLead: (async ctx => ok(await svc(ctx).ba.createLead(ctx.req.body), 201)) as Handler,
  updateLead: (async ctx => ok(await svc(ctx).ba.updateLead(ctx.params.id, ctx.req.body))) as Handler
};
