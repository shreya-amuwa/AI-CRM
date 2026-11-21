/**
 * Controllers: translate HTTP ⇄ service calls. No business rules here.
 */
import type { PaymentInvoiceOutcome, PaymentOverview } from '../../shared/contracts.js';
import { AppError } from '../http/errors.js';
import type { Handler } from '../http/types.js';
import { createServices } from '../services/index.js';
import { welcomeEmailQuietly } from '../automations/welcomeDispatcher.js';

const svc = (ctx: Parameters<Handler>[0]) => createServices(ctx.db);

/**
 * After a payment is verified: its paid invoice is made and sent. The payment stands whatever happens to the invoice; when the invoice
 * cannot be made (no address on record, GST not chosen ...) the answer says why, so Accounts can fix it and use "Generate invoice".
 */
async function withPaymentInvoice(ctx: Parameters<Handler>[0], customerId: string, paymentId: string): Promise<PaymentOverview> {
  const s = svc(ctx);
  let outcome: PaymentInvoiceOutcome;
  try {
    outcome = await s.generatedInvoices.invoiceForPayment(paymentId);
  } catch (e) {
    if (!(e instanceof AppError)) console.error('[invoice] the paid invoice of a payment could not be made', { payment: paymentId, message: (e as Error)?.message });
    outcome = { status: 'FAILED', paymentId, message: e instanceof AppError ? e.message : 'The paid invoice could not be made. Use "Generate invoice" on the payment to try again.' };
  }
  return { ...(await s.pipeline.paymentOverviewOf(customerId)), paymentInvoice: outcome };
}
const ok = <T>(data: T, status = 200) => ({ status, data });

export const meController = {
  get: (async ctx => ok(await svc(ctx).users.me(ctx.actor))) as Handler,
  update: (async ctx => ok(await svc(ctx).users.updateMe(ctx.actor, ctx.req.body))) as Handler,
  departmentScopes: (async ctx => ok(await svc(ctx).users.myDepartmentScopes())) as Handler
};

export const usersController = {
  list: (async ctx => ok(await svc(ctx).users.list(ctx.actor, ctx.req.query))) as Handler,
  get: (async ctx => ok(await svc(ctx).users.get(ctx.params.id))) as Handler,
  create: (async ctx => ok(await svc(ctx).users.create(ctx.actor, ctx.req.body), 201)) as Handler,
  setOwnPassword: (async ctx => ok(await svc(ctx).users.setOwnPassword(ctx.actor, ctx.req.body))) as Handler,
  assign: (async ctx => ok(await svc(ctx).users.assign(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setStatus: (async ctx => ok(await svc(ctx).users.setStatus(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setTechnicalConsultant: (async ctx => ok(await svc(ctx).users.setTechnicalConsultant(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setMetaVerifier: (async ctx => ok(await svc(ctx).users.setMetaVerifier(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setOperationsHead: (async ctx => ok(await svc(ctx).users.setOperationsHead(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  operationsHeadReview: (async ctx => ok(await svc(ctx).users.operationsHeadReview(ctx.actor))) as Handler,
  operationsOverview: (async ctx => ok(await svc(ctx).users.operationsOverview())) as Handler,
  setHeadDivision: (async ctx => ok(await svc(ctx).users.setHeadDivision(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setSalesSubRole: (async ctx => ok(await svc(ctx).users.setSalesSubRole(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  departmentHeads: (async ctx => ok(await svc(ctx).users.departmentHeads(ctx.actor, (ctx.req.query as Record<string, unknown>).departmentId))) as Handler,
  departmentAccess: (async ctx => ok(await svc(ctx).users.departmentAccess(ctx.actor, ctx.params.id))) as Handler,
  verifierDepartments: (async ctx => ok(await svc(ctx).users.verifierDepartments(ctx.params.id))) as Handler,
  offboardingImpact: (async ctx => ok(await svc(ctx).users.offboardingImpact(ctx.params.id))) as Handler,
  offboard: (async ctx => ok(await svc(ctx).users.offboard(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  reassignmentQueue: (async ctx => ok(await svc(ctx).users.reassignmentQueue())) as Handler,
  reassignmentResolve: (async ctx => ok(await svc(ctx).users.reassignmentResolve(ctx.params.id, ctx.req.body))) as Handler,
  setVerifierDepartments: (async ctx => ok(await svc(ctx).users.setVerifierDepartments(ctx.params.id, ctx.req.body))) as Handler,
  applyDepartmentAccess: (async ctx => ok(await svc(ctx).users.applyDepartmentAccess(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  setDepartmentAccess: (async ctx => ok(await svc(ctx).users.setDepartmentAccess(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  remove: (async ctx => {
    await svc(ctx).users.delete(ctx.actor, ctx.params.id);
    return ok(null);
  }) as Handler
};

export const welcomeEmailsController = {
  list: (async ctx => ok(await svc(ctx).welcomeEmails.list(ctx.req.query))) as Handler,
  // the new link is made when the e-mail is sent: send it right away (the scheduler retries it if this request is cut short)
  resend: (async ctx => { const r = await svc(ctx).welcomeEmails.resend(ctx.params.id); await welcomeEmailQuietly(); return ok(r); }) as Handler
};

// BolifyAI panel recharge reminder calls: read only (the database checks the Super Admin / HR staff)
export const reminderCallsController = {
  list: (async ctx => ok(await svc(ctx).reminderCalls.list(ctx.req.query))) as Handler
};

export const employeesController = {
  submit: (async ctx => ok(await svc(ctx).employees.submit(ctx.actor, ctx.req.body), 201)) as Handler,
  list: (async ctx => ok(await svc(ctx).employees.list(ctx.actor, ctx.req.query))) as Handler,
  get: (async ctx => ok(await svc(ctx).employees.get(ctx.params.id))) as Handler,
  decide: (async ctx => ok(await svc(ctx).employees.decide(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  resubmit: (async ctx => ok(await svc(ctx).employees.resubmit(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  operationsHeads: (async ctx => ok(await svc(ctx).employees.operationsHeads(ctx.actor))) as Handler,
  setScope: (async ctx => ok(await svc(ctx).employees.setScope(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  applyScope: (async ctx => ok(await svc(ctx).employees.applyScope(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  functionScopeReview: (async ctx => ok(await svc(ctx).employees.functionScopeReview(ctx.actor))) as Handler,
  headActivity: (async ctx => ok(await svc(ctx).employees.headActivity(ctx.actor, ctx.params.id))) as Handler,
  dashboard: (async ctx => ok(await svc(ctx).employees.dashboard())) as Handler,
  departmentActivity: (async ctx => ok(await svc(ctx).employees.departmentActivity(ctx.params.id))) as Handler,
  departmentDetail: (async ctx => ok(await svc(ctx).employees.departmentDetail(ctx.params.id))) as Handler,
  directory: (async ctx => ok(await svc(ctx).employees.directory(ctx.req.query))) as Handler,
  assignToLead: (async ctx => ok(await svc(ctx).employees.assignToLead(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  assignments: (async ctx => ok(await svc(ctx).employees.assignments(ctx.params.id))) as Handler
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
  clientTab: (async ctx => ok(await svc(ctx).chat.clientTab())) as Handler,
  clientTeam: (async ctx => ok(await svc(ctx).chat.clientTeam(ctx.params.id))) as Handler,
  escalateClientMessage: (async ctx => ok(await svc(ctx).chat.escalate(ctx.params.id, ctx.req.body))) as Handler,
  review: (async ctx => ok(await svc(ctx).chat.review(ctx.req.query))) as Handler,
  reviewOpen: (async ctx => ok(await svc(ctx).chat.reviewOpen(ctx.params.id))) as Handler,
  unread: (async ctx => ok(await svc(ctx).chat.unread())) as Handler,
  customerConversation: (async ctx => ok(await svc(ctx).chat.customerConversation(ctx.params.customerId, ctx.req.query))) as Handler,
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
  ackDelivered: (async ctx => ok(await svc(ctx).chat.ackDelivered(ctx.params.id, ctx.req.body))) as Handler,
  receipts: (async ctx => ok(await svc(ctx).chat.receipts(ctx.params.id, ctx.req.query))) as Handler,
  supportGroup: (async ctx => ok(await svc(ctx).chat.supportGroup(ctx.params.id))) as Handler,
  supportGroupSave: (async ctx => ok(await svc(ctx).chat.supportGroupSave(ctx.params.id, ctx.req.body))) as Handler,
  sendEncrypted: (async ctx => ok(await svc(ctx).chat.sendEncrypted(ctx.params.id, ctx.req.body), 201)) as Handler,
  deleteForMe: (async ctx => ok(await svc(ctx).chat.deleteForMe(ctx.params.id))) as Handler,
  deleteForEveryone: (async ctx => ok(await svc(ctx).chat.deleteForEveryone(ctx.params.id))) as Handler,
  react: (async ctx => ok(await svc(ctx).chat.react(ctx.params.id, ctx.req.body))) as Handler,
  reactions: (async ctx => ok(await svc(ctx).chat.reactions(ctx.params.id, ctx.req.query))) as Handler,
  inboxClear: (async ctx => ok(await svc(ctx).chat.inboxClear())) as Handler,
  inboxPurge: (async ctx => ok(await svc(ctx).chat.inboxPurge(ctx.req.body))) as Handler,
  keyStatus: (async ctx => ok(await svc(ctx).chat.keyStatus())) as Handler,
  internalMode: (async ctx => ok(await svc(ctx).chat.internalMode())) as Handler,
  setInternalMode: (async ctx => ok(await svc(ctx).chat.setInternalMode(ctx.req.body))) as Handler,
  keySetup: (async ctx => ok(await svc(ctx).chat.keySetup(ctx.req.body), 201)) as Handler,
  keyReset: (async ctx => ok(await svc(ctx).chat.keyReset(ctx.req.body))) as Handler,
  keyRegister: (async ctx => ok(await svc(ctx).chat.keyRegister(ctx.req.body), 201)) as Handler,
  keyRotate: (async ctx => ok(await svc(ctx).chat.keyRotate(ctx.req.body))) as Handler,
  keyBackupGet: (async ctx => ok(await svc(ctx).chat.keyBackupGet())) as Handler,
  keyBackupSet: (async ctx => ok(await svc(ctx).chat.keyBackupSet(ctx.req.body))) as Handler,
  memberKeys: (async ctx => ok(await svc(ctx).chat.memberKeys(ctx.params.id))) as Handler,
  keyLookup: (async ctx => ok(await svc(ctx).chat.keyLookup(ctx.req.query))) as Handler,
  beginUpload: (async ctx => ok(await svc(ctx).chat.beginUpload(ctx.params.id, ctx.req.body), 201)) as Handler,
  completeUpload: (async ctx => ok(await svc(ctx).chat.completeUpload(ctx.params.id))) as Handler,
  abortUpload: (async ctx => ok(await svc(ctx).chat.abortUpload(ctx.params.id))) as Handler,
  attachmentUrl: (async ctx => ok(await svc(ctx).chat.attachmentUrl(ctx.params.id, ctx.req.query))) as Handler
};

// Crocodial integration: configuration (Super Admin; the database checks the caller) and an employee's own switch
export const crocodialController = {
  overview: (async ctx => ok(await svc(ctx).crocodial.overview())) as Handler,
  rolloutSet: (async ctx => ok(await svc(ctx).crocodial.rolloutSet(ctx.req.body))) as Handler,
  connectionSave: (async ctx => ok(await svc(ctx).crocodial.connectionSave(ctx.req.body))) as Handler,
  testConnection: (async ctx => ok(await svc(ctx).crocodial.testConnection(ctx.params.id))) as Handler,
  departmentLinkSave: (async ctx => ok(await svc(ctx).crocodial.departmentLinkSave(ctx.req.body))) as Handler,
  mappingCheck: (async ctx => ok(await svc(ctx).crocodial.mappingCheck(ctx.req.body))) as Handler,
  mappingCreate: (async ctx => ok(await svc(ctx).crocodial.mappingCreate(ctx.req.body))) as Handler,
  mappingApprove: (async ctx => ok(await svc(ctx).crocodial.mappingApprove(ctx.params.id))) as Handler,
  mappingCountFrom: (async ctx => ok(await svc(ctx).crocodial.mappingCountFrom(ctx.params.id, ctx.req.body))) as Handler,
  mappingRevoke: (async ctx => ok(await svc(ctx).crocodial.mappingRevoke(ctx.params.id, ctx.req.body))) as Handler,
  myStatus: (async ctx => ok(await svc(ctx).crocodial.myStatus())) as Handler,
  syncStatus: (async ctx => ok(await svc(ctx).crocodial.syncStatus())) as Handler,
  syncNow: (async ctx => ok(await svc(ctx).crocodial.syncNow(ctx.params.id))) as Handler,
  activity: (async ctx => ok(await svc(ctx).crocodial.activity(ctx.req.query))) as Handler,
  teamActivity: (async ctx => ok(await svc(ctx).crocodial.teamActivity(ctx.req.query))) as Handler,
  leads: (async ctx => ok(await svc(ctx).crocodial.leads(ctx.req.query))) as Handler
};

export const leadWhatsAppController = {
  settings: (async ctx => ok(await svc(ctx).leadWhatsApp.settings())) as Handler,
  setSettings: (async ctx => ok(await svc(ctx).leadWhatsApp.setSettings(ctx.req.body))) as Handler,
  history: (async ctx => ok(await svc(ctx).leadWhatsApp.history(ctx.params.id))) as Handler,
  resend: (async ctx => ok(await svc(ctx).leadWhatsApp.resend(ctx.params.id))) as Handler
};

export const meetingsController = {
  list: (async ctx => ok(await svc(ctx).meetings.list(ctx.req.query))) as Handler,
  detail: (async ctx => ok(await svc(ctx).meetings.detail(ctx.params.id))) as Handler,
  create: (async ctx => ok(await svc(ctx).meetings.create(ctx.req.body), 201)) as Handler,
  reschedule: (async ctx => ok(await svc(ctx).meetings.reschedule(ctx.params.id, ctx.req.body))) as Handler,
  cancel: (async ctx => ok(await svc(ctx).meetings.cancel(ctx.params.id, ctx.req.body))) as Handler,
  complete: (async ctx => ok(await svc(ctx).meetings.complete(ctx.params.id, ctx.req.body))) as Handler,
  decide: (async ctx => ok(await svc(ctx).meetings.decide(ctx.params.id, ctx.req.body))) as Handler,
  answerProposal: (async ctx => ok(await svc(ctx).meetings.answerProposal(ctx.params.id, ctx.req.body))) as Handler,
  respond: (async ctx => ok(await svc(ctx).meetings.respond(ctx.params.id, ctx.req.body))) as Handler,
  approvals: (async ctx => ok(await svc(ctx).meetings.approvals())) as Handler,
  presence: (async ctx => ok(await svc(ctx).meetings.presence(ctx.req.query))) as Handler,
  clientList: (async ctx => ok(await svc(ctx).meetings.clientList(ctx.req.query))) as Handler,
  createClient: (async ctx => ok(await svc(ctx).meetings.createClient(ctx.req.body), 201)) as Handler,
  mailLog: (async ctx => ok(await svc(ctx).meetings.mailLog(ctx.params.id))) as Handler,
  mailRetry: (async ctx => ok(await svc(ctx).meetings.mailRetry(ctx.params.id))) as Handler,
  presenceEnter: (async ctx => ok(await svc(ctx).meetings.presenceEnter(ctx.req.body))) as Handler,
  presenceExit: (async ctx => ok(await svc(ctx).meetings.presenceExit())) as Handler,
  ceoRequests: (async ctx => ok(await svc(ctx).meetings.ceoRequests(ctx.req.query))) as Handler,
  directory: (async ctx => ok(await svc(ctx).meetings.directory(ctx.req.query))) as Handler,
  busy: (async ctx => ok(await svc(ctx).meetings.busy(ctx.req.body))) as Handler,
  settings: (async ctx => ok(await svc(ctx).meetings.settings())) as Handler,
  setAvailability: (async ctx => ok(await svc(ctx).meetings.setAvailability(ctx.req.body))) as Handler,
  saveBookingLink: (async ctx => ok(await svc(ctx).meetings.saveBookingLink(ctx.req.body))) as Handler,
  setDelegates: (async ctx => ok(await svc(ctx).meetings.setDelegates(ctx.req.body))) as Handler,
  googleStatus: (async ctx => ok(await svc(ctx).meetings.googleStatus())) as Handler,
  googleConnect: (async ctx => ok(svc(ctx).meetings.googleConnect(ctx.actor))) as Handler,
  googleDisconnect: (async ctx => ok(await svc(ctx).meetings.googleDisconnect(ctx.actor))) as Handler,
  // post-meeting summaries and the CEO's Meeting Decisions (20270124000200)
  summary: (async ctx => ok(await svc(ctx).meetings.summary(ctx.params.id))) as Handler,
  summaryAttendance: (async ctx => ok(await svc(ctx).meetings.confirmAttendance(ctx.params.id, ctx.req.body))) as Handler,
  summaryOwner: (async ctx => ok(await svc(ctx).meetings.assignSummaryOwner(ctx.params.id, ctx.req.body))) as Handler,
  summaryDraft: (async ctx => ok(await svc(ctx).meetings.saveSummaryDraft(ctx.params.id, ctx.req.body))) as Handler,
  summarySubmit: (async ctx => ok(await svc(ctx).meetings.submitSummary(ctx.params.id, ctx.req.body))) as Handler,
  summaryClarify: (async ctx => ok(await svc(ctx).meetings.clarifySummary(ctx.actor, ctx.params.id, ctx.req.body), 201)) as Handler,
  summaryReply: (async ctx => ok(await svc(ctx).meetings.replySummary(ctx.params.id, ctx.req.body), 201)) as Handler,
  summaryFlag: (async ctx => ok(await svc(ctx).meetings.flagSummaryItem(ctx.actor, ctx.params.id, ctx.req.body))) as Handler,
  summaryActionUpdate: (async ctx => ok(await svc(ctx).meetings.updateSummaryAction(ctx.params.id, ctx.req.body))) as Handler,
  summaries: (async ctx => ok(await svc(ctx).meetings.summaries(ctx.req.query))) as Handler,
  myActions: (async ctx => ok(await svc(ctx).meetings.myActions())) as Handler,
  reportsOverview: (async ctx => ok(await svc(ctx).meetings.reportsOverview(ctx.actor, ctx.req.query))) as Handler,
  reports: (async ctx => ok(await svc(ctx).meetings.reports(ctx.actor, ctx.req.query))) as Handler,
  report: (async ctx => ok(await svc(ctx).meetings.report(ctx.actor, ctx.params.id))) as Handler,
  reportActions: (async ctx => ok(await svc(ctx).meetings.reportActions(ctx.actor, ctx.req.query))) as Handler
};

/** Bugs for the Developers team (20270122000300). */
export const bugsController = {
  access: (async ctx => ok(await svc(ctx).bugs.access())) as Handler,
  submit: (async ctx => ok(await svc(ctx).bugs.submit(ctx.req.body), 201)) as Handler,
  mine: (async ctx => ok(await svc(ctx).bugs.mine())) as Handler,
  myDetail: (async ctx => ok(await svc(ctx).bugs.myDetail(ctx.params.id))) as Handler,
  list: (async ctx => ok(await svc(ctx).bugs.list(ctx.req.query))) as Handler,
  detail: (async ctx => ok(await svc(ctx).bugs.detail(ctx.params.id))) as Handler,
  assign: (async ctx => ok(await svc(ctx).bugs.assign(ctx.params.id, ctx.req.body))) as Handler,
  setStatus: (async ctx => ok(await svc(ctx).bugs.setStatus(ctx.params.id, ctx.req.body))) as Handler,
  comment: (async ctx => ok(await svc(ctx).bugs.comment(ctx.params.id, ctx.req.body), 201)) as Handler,
  team: (async ctx => ok(await svc(ctx).bugs.team())) as Handler,
  setTeam: (async ctx => ok(await svc(ctx).bugs.setTeam(ctx.req.body))) as Handler
};

export const employeeCasesController = {
  // the employee
  submitIssue: (async ctx => ok(await svc(ctx).employeeCases.submitIssue(ctx.req.body), 201)) as Handler,
  myDetails: (async ctx => ok(await svc(ctx).employeeCases.myDetails())) as Handler,
  myIssues: (async ctx => ok(await svc(ctx).employeeCases.myIssues(ctx.req.query))) as Handler,
  myIssue: (async ctx => ok(await svc(ctx).employeeCases.myIssue(ctx.params.id))) as Handler,
  replyToIssue: (async ctx => ok(await svc(ctx).employeeCases.replyToIssue(ctx.params.id, ctx.req.body))) as Handler,
  submitMeeting: (async ctx => ok(await svc(ctx).employeeCases.submitMeeting(ctx.req.body), 201)) as Handler,
  myMeetings: (async ctx => ok(await svc(ctx).employeeCases.myMeetings(ctx.req.query))) as Handler,
  myMeeting: (async ctx => ok(await svc(ctx).employeeCases.myMeeting(ctx.params.id))) as Handler,
  cancelMyMeeting: (async ctx => ok(await svc(ctx).employeeCases.cancelMyMeeting(ctx.params.id, ctx.req.body))) as Handler,
  answerAlternative: (async ctx => ok(await svc(ctx).employeeCases.answerAlternative(ctx.params.id, ctx.req.body))) as Handler,
  beginUpload: (async ctx => ok(await svc(ctx).employeeCases.beginUpload(ctx.req.body), 201)) as Handler,
  completeUpload: (async ctx => ok(await svc(ctx).employeeCases.completeUpload(ctx.params.id))) as Handler,
  abortUpload: (async ctx => ok(await svc(ctx).employeeCases.abortUpload(ctx.params.id))) as Handler,
  attachmentUrl: (async ctx => ok(await svc(ctx).employeeCases.attachmentUrl(ctx.params.id, ctx.req.query))) as Handler,
  // HR
  assignees: (async ctx => ok(await svc(ctx).employeeCases.assignees())) as Handler,
  departments: (async ctx => ok(await svc(ctx).employeeCases.departments())) as Handler,
  issueOverview: (async ctx => ok(await svc(ctx).employeeCases.issueOverview())) as Handler,
  hrIssues: (async ctx => ok(await svc(ctx).employeeCases.hrIssues(ctx.req.query))) as Handler,
  hrIssue: (async ctx => ok(await svc(ctx).employeeCases.hrIssue(ctx.params.id))) as Handler,
  assignIssue: (async ctx => ok(await svc(ctx).employeeCases.assignIssue(ctx.params.id, ctx.req.body))) as Handler,
  setIssueStatus: (async ctx => ok(await svc(ctx).employeeCases.setIssueStatus(ctx.params.id, ctx.req.body))) as Handler,
  respondToIssue: (async ctx => ok(await svc(ctx).employeeCases.respondToIssue(ctx.params.id, ctx.req.body))) as Handler,
  noteOnIssue: (async ctx => ok(await svc(ctx).employeeCases.noteOnIssue(ctx.params.id, ctx.req.body))) as Handler,
  meetingOverview: (async ctx => ok(await svc(ctx).employeeCases.meetingOverview())) as Handler,
  hrMeetings: (async ctx => ok(await svc(ctx).employeeCases.hrMeetings(ctx.req.query))) as Handler,
  hrMeeting: (async ctx => ok(await svc(ctx).employeeCases.hrMeeting(ctx.params.id))) as Handler,
  assignMeeting: (async ctx => ok(await svc(ctx).employeeCases.assignMeeting(ctx.params.id, ctx.req.body))) as Handler,
  noteOnMeeting: (async ctx => ok(await svc(ctx).employeeCases.noteOnMeeting(ctx.params.id, ctx.req.body))) as Handler,
  decideMeeting: (async ctx => ok(await svc(ctx).employeeCases.decideMeeting(ctx.params.id, ctx.req.body))) as Handler
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
  broadcast: (async ctx => ok(await svc(ctx).notifications.broadcast(ctx.actor, ctx.req.body), 201)) as Handler,
  // Notification Health (20270125000200): Super Admin and HR staff; the database checks the caller and audits each read
  health: (async ctx => ok(await svc(ctx).notificationHealth.report(ctx.req.query))) as Handler,
  healthEmployee: (async ctx => ok(await svc(ctx).notificationHealth.employee(ctx.params.profileId))) as Handler,
  healthTest: (async ctx => ok(await svc(ctx).notificationHealth.sendTest(ctx.params.profileId))) as Handler
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
  submitPaidLeave: (async ctx => ok(await svc(ctx).hr.submitPaidLeave(ctx.req.body), 201)) as Handler,
  myPaidLeave: (async ctx => ok(await svc(ctx).hr.myPaidLeave())) as Handler,
  paidLeaveList: (async ctx => ok(await svc(ctx).hr.paidLeaveList(ctx.req.query))) as Handler,
  paidLeaveDetail: (async ctx => ok(await svc(ctx).hr.paidLeaveDetail(ctx.params.profileId))) as Handler,
  paidLeaveAdjust: (async ctx => ok(await svc(ctx).hr.paidLeaveAdjust(ctx.params.profileId, ctx.req.body), 201)) as Handler,
  paidLeavePolicy: (async ctx => ok(await svc(ctx).hr.paidLeavePolicy(ctx.req.body))) as Handler,
  confirmationDate: (async ctx => ok(await svc(ctx).hr.confirmationDate(ctx.params.id, ctx.req.body))) as Handler,
  leaveToReview: (async ctx => ok(await svc(ctx).hr.leaveToReview())) as Handler,
  decideAsDepartmentHead: (async ctx => ok(await svc(ctx).hr.decideAsDepartmentHead(ctx.params.id, ctx.req.body))) as Handler,
  decideAsHr: (async ctx => ok(await svc(ctx).hr.decideAsHr(ctx.params.id, ctx.req.body))) as Handler,
  decideLeave: (async ctx => ok(await svc(ctx).hr.decideLeave(ctx.params.id, ctx.req.body))) as Handler,
  resubmitLeave: (async ctx => ok(await svc(ctx).hr.resubmitLeave(ctx.params.id, ctx.req.body))) as Handler,
  setLeaveWorkflow: (async ctx => ok(await svc(ctx).hr.setLeaveWorkflow(ctx.req.body))) as Handler,
  setSupportDesk: (async ctx => ok(await svc(ctx).hr.setSupportDesk(ctx.req.body))) as Handler,
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

/** Documents on an employee's HR profile (HR staff upload / delete; the employee may read their own). */
export const hrEmployeeFilesController = {
  list: (async ctx => ok(await svc(ctx).hrEmployeeFiles.list(ctx.req.query))) as Handler,
  beginUpload: (async ctx => ok(await svc(ctx).hrEmployeeFiles.beginUpload(ctx.req.body), 201)) as Handler,
  completeUpload: (async ctx => ok(await svc(ctx).hrEmployeeFiles.completeUpload(ctx.params.id))) as Handler,
  abortUpload: (async ctx => ok(await svc(ctx).hrEmployeeFiles.abortUpload(ctx.params.id))) as Handler,
  fileUrl: (async ctx => ok(await svc(ctx).hrEmployeeFiles.fileUrl(ctx.params.id, ctx.req.query))) as Handler,
  remove: (async ctx => ok(await svc(ctx).hrEmployeeFiles.remove(ctx.params.id))) as Handler
};

export const hrDocumentController = {
  prefill: (async ctx => ok(await svc(ctx).hrDocuments.prefill(ctx.req.query))) as Handler,
  preview: (async ctx => ok(await svc(ctx).hrDocuments.preview(ctx.req.body))) as Handler,
  generate: (async ctx => ok(await svc(ctx).hrDocuments.generate(ctx.req.body), 201)) as Handler,
  list: (async ctx => ok(await svc(ctx).hrDocuments.list(ctx.req.query))) as Handler,
  download: (async ctx => ok(await svc(ctx).hrDocuments.download(ctx.params.id))) as Handler,
  templateState: (async ctx => ok(await svc(ctx).hrDocuments.templateState(ctx.params.type))) as Handler,
  templateVersion: (async ctx => ok(await svc(ctx).hrDocuments.templateVersion(ctx.params.type, ctx.params.version))) as Handler,
  saveTemplate: (async ctx => ok(await svc(ctx).hrDocuments.saveTemplate(ctx.params.type, ctx.req.body), 201)) as Handler
};

export const payoutController = {
  slip: (async ctx => ok(await svc(ctx).payouts.slip(ctx.params.id))) as Handler
};

export const performanceController = {
  people: (async ctx => ok(await svc(ctx).performance.people(ctx.req.query))) as Handler,
  report: (async ctx => ok(await svc(ctx).performance.report(ctx.req.query))) as Handler,
  generate: (async ctx => ok(await svc(ctx).performance.generate(ctx.req.body))) as Handler,
  history: (async ctx => ok(await svc(ctx).performance.history(ctx.params.id))) as Handler
};

export const performersController = {
  department: (async ctx => ok(await svc(ctx).performers.department(ctx.req.query))) as Handler,
  company: (async ctx => ok(await svc(ctx).performers.company(ctx.req.query))) as Handler,
  evaluate: (async ctx => ok(await svc(ctx).performers.evaluate(ctx.req.body))) as Handler,
  decide: (async ctx => ok(await svc(ctx).performers.decide(ctx.params.id, ctx.req.body))) as Handler
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
  departments: (async ctx => ok(await svc(ctx).dashboards.overviewDepartments(ctx.actor, ctx.req.query))) as Handler,
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
  saveAiWebsiteOnboarding: (async ctx => ok(await svc(ctx).pipeline.saveAiWebsiteOnboarding(ctx.params.id, ctx.req.body))) as Handler,
  moveToPotential: (async ctx => ok(await svc(ctx).pipeline.moveToPotential(ctx.params.id, ctx.req.body))) as Handler,
  recordPayment: (async ctx => ok(await svc(ctx).pipeline.recordPayment(ctx.params.id, ctx.req.body))) as Handler,
  accountsCreateClientLogin: (async ctx => ok(await svc(ctx).pipeline.accountsCreateClientLogin(ctx.actor, ctx.params.id, ctx.req.body), 201)) as Handler,
  provisioningQueue: (async ctx => ok(await svc(ctx).pipeline.provisioningQueue(ctx.req.query))) as Handler,
  accountsCustomerDetails: (async ctx => ok(await svc(ctx).pipeline.accountsCustomerDetails(ctx.params.id))) as Handler,
  updateAccountsCustomerDetails: (async ctx => ok(await svc(ctx).pipeline.accountsCustomerDetails(ctx.params.id, ctx.req.body))) as Handler,
  correctCustomerEmail: (async ctx => ok(await svc(ctx).pipeline.correctCustomerEmail(ctx.params.id, ctx.req.body))) as Handler,
  resendAccountEmail: (async ctx => ok(await svc(ctx).pipeline.resendAccountEmail(ctx.params.id))) as Handler,
  markMetaVerificationCompleted: (async ctx => ok(await svc(ctx).pipeline.markMetaVerificationCompleted(ctx.params.id))) as Handler,
  customerJourney: (async ctx => ok(await svc(ctx).pipeline.customerJourney(ctx.params.id))) as Handler,
  journeyStatus: (async ctx => ok(await svc(ctx).pipeline.journeyStatus(ctx.params.id))) as Handler,
  setMetaVerification: (async ctx => ok(await svc(ctx).pipeline.setMetaVerification(ctx.params.id, ctx.req.body))) as Handler,
  assignMetaVerifier: (async ctx => ok(await svc(ctx).pipeline.assignMetaVerifier(ctx.params.id, ctx.req.body))) as Handler,
  existingBlueTick: (async ctx => ok(await svc(ctx).pipeline.existingBlueTick(ctx.params.id))) as Handler,
  setExistingBlueTick: (async ctx => ok(await svc(ctx).pipeline.setExistingBlueTick(ctx.params.id, ctx.req.body))) as Handler,
  recordMetaOutcome: (async ctx => ok(await svc(ctx).pipeline.recordMetaOutcome(ctx.params.id, ctx.req.body))) as Handler,
  metaVerifierCandidates: (async ctx => ok(await svc(ctx).pipeline.metaVerifierCandidates(ctx.params.id))) as Handler,
  setServiceSetup: (async ctx => ok(await svc(ctx).pipeline.setServiceSetup(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  subscriptionsList: (async ctx => ok(await svc(ctx).pipeline.subscriptionsList(ctx.req.query))) as Handler,
  subscriptionOverview: (async ctx => ok(await svc(ctx).pipeline.subscriptionOverview(ctx.params.id))) as Handler,
  setSubscriptionTerms: (async ctx => ok(await svc(ctx).pipeline.setSubscriptionTerms(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  confirmSubscriptionActivation: (async ctx => ok(await svc(ctx).pipeline.confirmSubscriptionActivation(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  correctSubscriptionDates: (async ctx => ok(await svc(ctx).pipeline.correctSubscriptionDates(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  confirmSubscriptionRenewal: (async ctx => ok(await svc(ctx).pipeline.confirmSubscriptionRenewal(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  resendActivationEmail: (async ctx => ok(await svc(ctx).pipeline.resendActivationEmail(ctx.params.id, ctx.params.code))) as Handler,
  sendToDelivery: (async ctx => ok(await svc(ctx).pipeline.sendToDelivery(ctx.params.id, ctx.req.body))) as Handler,
  deliveryQueue: (async ctx => ok(await svc(ctx).pipeline.deliveryQueue(ctx.req.query))) as Handler,
  serviceJourneys: (async ctx => ok(await svc(ctx).pipeline.serviceJourneys())) as Handler,
  setServiceJourney: (async ctx => ok(await svc(ctx).pipeline.setServiceJourney(ctx.params.code, ctx.req.body))) as Handler,
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
  recordAccountsPayment: (async ctx => {
    const r = await svc(ctx).pipeline.recordAccountsPaymentTracked(ctx.params.id, ctx.req.body);
    return ok(r.makeInvoice ? await withPaymentInvoice(ctx, ctx.params.id, r.paymentId) : r.overview, 201);
  }) as Handler,
  setOrderGst: (async ctx => ok(await svc(ctx).pipeline.setOrderGst(ctx.params.id, ctx.req.body))) as Handler,
  gstReconciliation: (async ctx => ok(await svc(ctx).pipeline.gstReconciliation())) as Handler,
  updateAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.updateAccountsPayment(ctx.params.paymentId, ctx.params.id, ctx.req.body))) as Handler,
  verifyAccountsPayment: (async ctx => {
    const r = await svc(ctx).pipeline.verifyAccountsPaymentTracked(ctx.params.paymentId, ctx.params.id, ctx.req.body);
    return ok(r.makeInvoice ? await withPaymentInvoice(ctx, ctx.params.id, ctx.params.paymentId) : r.overview);
  }) as Handler,
  rejectAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.rejectAccountsPayment(ctx.params.paymentId, ctx.params.id, ctx.req.body))) as Handler,
  reverseAccountsPayment: (async ctx => ok(await svc(ctx).pipeline.reverseAccountsPayment(ctx.params.paymentId, ctx.params.id, ctx.req.body))) as Handler,
  /** Confirms the payment and returns the customer to Sales; the answer says what happened to the client's dashboard login. */
  confirmAndReturn: (async ctx => ok({ clientLogin: await svc(ctx).pipeline.confirmAndReturn(ctx.actor, ctx.params.id, ctx.req.body) })) as Handler,
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
  handoffInfo: (async ctx => ok(await svc(ctx).pipeline.handoffInfo(ctx.params.id))) as Handler,
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
  financeMail: (async ctx => ok(await svc(ctx).finance.financeMail(ctx.req.query))) as Handler,
  retryFinanceMail: (async ctx => ok(await svc(ctx).finance.retryFinanceMail(ctx.params.id))) as Handler,
  customerRevenue: (async ctx => ok(await svc(ctx).finance.customerRevenue(ctx.req.query))) as Handler,
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
  /** "Generate invoice" on a verified payment (also the retry when the automatic one could not be made). Failures are answered as errors. */
  invoiceForPayment: (async ctx => ok(await svc(ctx).generatedInvoices.invoiceForPayment(ctx.params.paymentId, ctx.req.body))) as Handler,
  paymentInvoiceBilling: (async ctx => ok(await svc(ctx).generatedInvoices.paymentInvoiceBilling(ctx.params.paymentId))) as Handler,
  cancel: (async ctx => ok(await svc(ctx).generatedInvoices.cancelInvoice(ctx.params.id, ctx.req.body))) as Handler,
  file: (async ctx => ok(await svc(ctx).generatedInvoices.fileUrl(ctx.params.id, ctx.req.query))) as Handler,
  sendWhatsApp: (async ctx => ok(await svc(ctx).generatedInvoices.sendWhatsApp(ctx.params.id, ctx.req.body))) as Handler,
  whatsAppHistory: (async ctx => ok(await svc(ctx).generatedInvoices.whatsAppHistory(ctx.params.id))) as Handler,
  whatsAppSettings: (async ctx => ok(await svc(ctx).generatedInvoices.whatsAppSettings())) as Handler,
  setWhatsAppSettings: (async ctx => ok(await svc(ctx).generatedInvoices.setWhatsAppSettings(ctx.req.body))) as Handler
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
  leadScope: (async ctx => ok(await svc(ctx).telecaller.leadScope(ctx.req.query))) as Handler,
  leadScopeCounts: (async ctx => ok(await svc(ctx).telecaller.leadScopeCounts())) as Handler,
  lead: (async ctx => ok(await svc(ctx).telecaller.lead(ctx.params.id))) as Handler,
  createLead: (async ctx => ok(await svc(ctx).telecaller.createLead(ctx.req.body), 201)) as Handler,
  updateLead: (async ctx => ok(await svc(ctx).telecaller.updateLead(ctx.params.id, ctx.req.body))) as Handler
};

// Upload Leads (every Sales employee; the database refuses everybody else)
export const leadUploadsController = {
  check: (async ctx => ok(await svc(ctx).leadUploads.check(ctx.req.body))) as Handler,
  history: (async ctx => ok(await svc(ctx).leadUploads.history())) as Handler,
  start: (async ctx => ok(await svc(ctx).leadUploads.start(ctx.req.body), 201)) as Handler,
  rows: (async ctx => ok(await svc(ctx).leadUploads.rows(ctx.params.id, ctx.req.body))) as Handler,
  finish: (async ctx => ok(await svc(ctx).leadUploads.finish(ctx.params.id))) as Handler,
  issues: (async ctx => ok(await svc(ctx).leadUploads.issues(ctx.params.id))) as Handler
};

export const fieldVisitController = {
  overview: (async ctx => ok(await svc(ctx).fieldVisit.overview())) as Handler,
  leads: (async ctx => ok(await svc(ctx).fieldVisit.leads(ctx.req.query))) as Handler,
  assigned: (async ctx => ok(await svc(ctx).fieldVisit.assigned(ctx.req.query))) as Handler,
  list: (async ctx => ok(await svc(ctx).fieldVisit.list(ctx.req.query))) as Handler,
  schedule: (async ctx => ok(await svc(ctx).fieldVisit.schedule(ctx.req.body), 201)) as Handler,
  update: (async ctx => ok(await svc(ctx).fieldVisit.update(ctx.params.id, ctx.req.body))) as Handler,
  start: (async ctx => ok(await svc(ctx).fieldVisit.start(ctx.params.id, ctx.req.body))) as Handler,
  complete: (async ctx => ok(await svc(ctx).fieldVisit.complete(ctx.params.id, ctx.req.body))) as Handler,
  cancel: (async ctx => ok(await svc(ctx).fieldVisit.cancel(ctx.params.id, ctx.req.body))) as Handler,
  assignees: (async ctx => ok(await svc(ctx).fieldVisit.assignees())) as Handler,
  assign: (async ctx => ok(await svc(ctx).fieldVisit.assign(ctx.req.body), 201)) as Handler,
  cancelAssignment: (async ctx => ok(await svc(ctx).fieldVisit.cancelAssignment(ctx.params.leadId))) as Handler,
  trackingStart: (async ctx => ok(await svc(ctx).fieldVisit.trackingStart(ctx.params.id, ctx.req.body))) as Handler,
  trackingPoints: (async ctx => ok(await svc(ctx).fieldVisit.trackingPoints(ctx.params.id, ctx.req.body))) as Handler,
  trackingIssue: (async ctx => ok(await svc(ctx).fieldVisit.trackingIssue(ctx.params.id, ctx.req.body))) as Handler,
  trackingStop: (async ctx => ok(await svc(ctx).fieldVisit.trackingStop(ctx.params.id))) as Handler,
  trackingBoard: (async ctx => ok(await svc(ctx).fieldVisit.trackingBoard(ctx.req.query))) as Handler,
  trackingTrail: (async ctx => ok(await svc(ctx).fieldVisit.trackingTrail(ctx.params.id))) as Handler,
  leadQueue: (async ctx => ok(await svc(ctx).fieldVisit.leadQueue(ctx.req.query))) as Handler,
  leadTelecallers: (async ctx => ok(await svc(ctx).fieldVisit.leadTelecallers(ctx.params.leadId))) as Handler,
  leadAssign: (async ctx => ok(await svc(ctx).fieldVisit.leadAssign(ctx.params.leadId, ctx.req.body))) as Handler
};

export const salesHeadController = {
  overview: (async ctx => ok(await svc(ctx).salesHead.overview())) as Handler,
  assignees: (async ctx => ok(await svc(ctx).salesHead.assignees())) as Handler,
  teamPeople: (async ctx => ok(await svc(ctx).salesHead.teamPeople())) as Handler,
  sheets: (async ctx => ok(await svc(ctx).salesHead.sheets())) as Handler,
  assignSheet: (async ctx => ok(await svc(ctx).salesHead.assignSheet(ctx.req.body))) as Handler,
  storeSource: (async ctx => ok(await svc(ctx).salesHead.storeSource(ctx.params.id, ctx.req.body), 201)) as Handler,
  sheetIssues: (async ctx => ok(await svc(ctx).salesHead.sheetIssues(ctx.params.id))) as Handler,
  leads: (async ctx => ok(await svc(ctx).salesHead.leads(ctx.req.query))) as Handler,
  lead: (async ctx => ok(await svc(ctx).salesHead.lead(ctx.params.id))) as Handler,
  assignInbound: (async ctx => ok(await svc(ctx).salesHead.assignInbound(ctx.params.id, ctx.req.body))) as Handler,
  tasks: (async ctx => ok(await svc(ctx).salesHead.tasks(ctx.req.query))) as Handler,
  taskAssignees: (async ctx => ok(await svc(ctx).salesHead.taskAssignees())) as Handler,
  createTask: (async ctx => ok(await svc(ctx).salesHead.createTask(ctx.req.body), 201)) as Handler,
  reports: (async ctx => ok(await svc(ctx).salesHead.reports(ctx.req.query))) as Handler,
  income: (async ctx => ok(await svc(ctx).salesHead.income(ctx.req.query))) as Handler,
  roleList: (async ctx => ok(await svc(ctx).salesHead.roleList(roleParam(ctx.params.role), ctx.req.query))) as Handler,
  rolePerson: (async ctx => ok(await svc(ctx).salesHead.rolePerson(roleParam(ctx.params.role), ctx.params.id, ctx.req.query))) as Handler
};
/** /sales-head/roles/telecaller -> TELECALLER, /business-associate -> BUSINESS_ASSOCIATE (anything else fails validation in the service). */
function roleParam(v: string | undefined): string { return (v ?? '').toUpperCase().replace(/-/g, '_'); }

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

export const workflowController = {
  customerWorkflow: (async ctx => ok(await svc(ctx).workflow.customerWorkflow(ctx.params.id))) as Handler,
  reviewScope: (async ctx => ok(await svc(ctx).workflow.reviewScope(ctx.params.id))) as Handler,
  customerWorkflowStatuses: (async ctx => ok(await svc(ctx).workflow.customerWorkflowStatuses(ctx.req.query))) as Handler,
  setTcStatus: (async ctx => ok(await svc(ctx).workflow.setTcStatus(ctx.params.id, ctx.req.body))) as Handler,
  setMetaStatus: (async ctx => ok(await svc(ctx).workflow.setMetaStatus(ctx.params.id, ctx.req.body))) as Handler,
  verificationNotes: (async ctx => ok(await svc(ctx).workflow.verificationNotes(ctx.params.id))) as Handler,
  addVerificationNote: (async ctx => ok(await svc(ctx).workflow.addVerificationNote(ctx.params.id, ctx.req.body), 201)) as Handler,
  panelDetails: (async ctx => ok(await svc(ctx).workflow.panelDetails(ctx.params.id))) as Handler,
  setPanelDetails: (async ctx => ok(await svc(ctx).workflow.setPanelDetails(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  handoverReconciliation: (async ctx => ok(await svc(ctx).workflow.handoverReconciliation())) as Handler,
  reconcileFollowUps: (async ctx => ok(await svc(ctx).workflow.reconcileFollowUps())) as Handler,
  setPanelUrl: (async ctx => ok(await svc(ctx).workflow.setPanelUrl(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  sendPanelLink: (async ctx => ok(await svc(ctx).workflow.sendPanelLink(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  sendPanelCredentials: (async ctx => ok(await svc(ctx).workflow.sendPanelCredentials(ctx.params.id, ctx.params.code, ctx.req.body))) as Handler,
  reroute: (async ctx => (await svc(ctx).workflow.reroute(ctx.params.id, ctx.req.body), ok(null))) as Handler,
  routeReview: (async ctx => ok(await svc(ctx).workflow.routeReview())) as Handler,
  setServiceMetaVerification: (async ctx => (await svc(ctx).workflow.setServiceMetaVerification(ctx.params.code, ctx.req.body), ok(await svc(ctx).pipeline.serviceJourneys()))) as Handler,
  followUps: (async ctx => ok(await svc(ctx).workflow.followUps(ctx.req.query))) as Handler,
  recordContact: (async ctx => ok(await svc(ctx).workflow.recordContact(ctx.params.id, ctx.req.body), 201)) as Handler,
  assignFollowUp: (async ctx => (await svc(ctx).workflow.assign(ctx.params.id, ctx.req.body), ok(null))) as Handler,
  settings: (async ctx => ok(await svc(ctx).workflow.settings())) as Handler,
  setFollowUpDelay: (async ctx => ok(await svc(ctx).workflow.setFollowUpDelay(ctx.req.body))) as Handler,
  usageAlerts: (async ctx => ok(await svc(ctx).workflow.usageAlertSettings())) as Handler,
  setUsageAlerts: (async ctx => ok(await svc(ctx).workflow.setUsageAlertSettings(ctx.req.body))) as Handler
};

// Work reports: Team Member -> Team Lead -> Department Head -> Operations Head (the database decides who may call each)
export const workReportsController = {
  context: (async ctx => ok(await svc(ctx).workReports.context())) as Handler,
  mine: (async ctx => ok(await svc(ctx).workReports.mine(ctx.req.query))) as Handler,
  create: (async ctx => ok(await svc(ctx).workReports.create(ctx.req.body), 201)) as Handler,
  update: (async ctx => ok(await svc(ctx).workReports.update(ctx.params.id, ctx.req.body))) as Handler,
  submit: (async ctx => ok(await svc(ctx).workReports.submit(ctx.params.id))) as Handler,
  deleteDraft: (async ctx => (await svc(ctx).workReports.deleteDraft(ctx.params.id), ok(null))) as Handler,
  get: (async ctx => ok(await svc(ctx).workReports.get(ctx.params.id))) as Handler,
  inbox: (async ctx => ok(await svc(ctx).workReports.inbox(ctx.req.query))) as Handler,
  review: (async ctx => ok(await svc(ctx).workReports.review(ctx.params.id, ctx.req.body))) as Handler,
  memberApprovals: (async ctx => ok(await svc(ctx).workReports.memberApprovals(ctx.req.query))) as Handler,
  myTasks: (async ctx => ok(await svc(ctx).workReports.myTasks())) as Handler,
  teamBox: (async ctx => ok(await svc(ctx).workReports.teamBox(ctx.req.query))) as Handler,
  department: (async ctx => ok(await svc(ctx).workReports.department(ctx.req.query))) as Handler,
  submitPackage: (async ctx => ok(await svc(ctx).workReports.submitPackage(ctx.req.body))) as Handler,
  operations: (async ctx => ok(await svc(ctx).workReports.operations(ctx.req.query))) as Handler,
  operationsDepartment: (async ctx => ok(await svc(ctx).workReports.operationsDepartment(ctx.params.id, ctx.req.query))) as Handler,
  operationsPeople: (async ctx => ok(await svc(ctx).workReports.operationsPeople(ctx.req.query))) as Handler,
  dailySummary: (async ctx => ok(await svc(ctx).workReports.dailySummary(ctx.req.query))) as Handler,
  weekly: (async ctx => ok(await svc(ctx).workReports.weekly(ctx.req.query))) as Handler,
  weeklySave: (async ctx => ok(await svc(ctx).workReports.weeklySave(ctx.req.body))) as Handler,
  weeklyBoard: (async ctx => ok(await svc(ctx).workReports.weeklyBoard(ctx.req.query))) as Handler,
  weeklyPending: (async ctx => ok(await svc(ctx).workReports.weeklyPending())) as Handler,
  weeklyRouting: (async ctx => ok(await svc(ctx).workReports.weeklyRouting())) as Handler,
  weeklyReview: (async ctx => ok(await svc(ctx).workReports.weeklyReview(ctx.params.id, ctx.req.body))) as Handler
}

// HR performance reviews and the consolidated report (HR), the Super Admin's performance views
export const hrReviewsController = {
  overview: (async ctx => ok(await svc(ctx).hrReviews.overview(ctx.req.query))) as Handler,
  department: (async ctx => ok(await svc(ctx).hrReviews.department(ctx.params.id))) as Handler,
  personReports: (async ctx => ok(await svc(ctx).hrReviews.personReports(ctx.params.id, ctx.params.personId))) as Handler,
  save: (async ctx => ok(await svc(ctx).hrReviews.save(ctx.req.body))) as Handler,
  history: (async ctx => ok(await svc(ctx).hrReviews.history(ctx.params.id))) as Handler,
  log: (async ctx => ok(await svc(ctx).hrReviews.log(ctx.req.query))) as Handler,
  consolidated: (async ctx => ok(await svc(ctx).hrReviews.consolidated(ctx.req.query))) as Handler,
  consolidatedSave: (async ctx => ok(await svc(ctx).hrReviews.consolidatedSave(ctx.req.body))) as Handler
}
export const reportAnalyticsController = {
  consolidatedList: (async ctx => ok(await svc(ctx).reportAnalytics.consolidatedList())) as Handler,
  consolidated: (async ctx => ok(await svc(ctx).reportAnalytics.consolidated(ctx.params.id))) as Handler,
  leaderboard: (async ctx => ok(await svc(ctx).reportAnalytics.leaderboard(ctx.req.query))) as Handler,
  options: (async ctx => ok(await svc(ctx).reportAnalytics.options())) as Handler,
  employee: (async ctx => ok(await svc(ctx).reportAnalytics.employee(ctx.params.id, ctx.req.query))) as Handler,
  settings: (async ctx => ok(await svc(ctx).reportAnalytics.settings())) as Handler,
  updateSettings: (async ctx => ok(await svc(ctx).reportAnalytics.updateSettings(ctx.req.body))) as Handler,
  analysis: (async ctx => ok(await svc(ctx).reportAnalytics.analysis(ctx.req.query))) as Handler,
  generate: (async ctx => ok(await svc(ctx).reportAnalytics.generate(ctx.req.body))) as Handler
};

// AI Design Studio: clients, client notices, assignments, daily reports, issues (the database decides who may do what)
export const aiDesignStudioController = {
  context: (async ctx => ok(await svc(ctx).aiDesignStudio.context())) as Handler,
  people: (async ctx => ok(await svc(ctx).aiDesignStudio.people())) as Handler,
  overview: (async ctx => ok(await svc(ctx).aiDesignStudio.overview())) as Handler,
  clientCreate: (async ctx => ok(await svc(ctx).aiDesignStudio.clientCreate(ctx.req.body), 201)) as Handler,
  clientUpdate: (async ctx => ok(await svc(ctx).aiDesignStudio.clientUpdate(ctx.params.id, ctx.req.body))) as Handler,
  clients: (async ctx => ok(await svc(ctx).aiDesignStudio.clients(ctx.req.query))) as Handler,
  client: (async ctx => ok(await svc(ctx).aiDesignStudio.client(ctx.params.id))) as Handler,
  noticeCreate: (async ctx => ok(await svc(ctx).aiDesignStudio.noticeCreate(ctx.req.body), 201)) as Handler,
  notices: (async ctx => ok(await svc(ctx).aiDesignStudio.notices(ctx.req.query))) as Handler,
  noticeStatus: (async ctx => ok(await svc(ctx).aiDesignStudio.noticeStatus(ctx.params.id, ctx.req.body))) as Handler,
  assignmentCreate: (async ctx => ok(await svc(ctx).aiDesignStudio.assignmentCreate(ctx.req.body), 201)) as Handler,
  assignments: (async ctx => ok(await svc(ctx).aiDesignStudio.assignments(ctx.req.query))) as Handler,
  assignment: (async ctx => ok(await svc(ctx).aiDesignStudio.assignment(ctx.params.id))) as Handler,
  assignmentStatus: (async ctx => ok(await svc(ctx).aiDesignStudio.assignmentStatus(ctx.params.id, ctx.req.body))) as Handler,
  assignmentUpdate: (async ctx => ok(await svc(ctx).aiDesignStudio.assignmentUpdate(ctx.params.id, ctx.req.body))) as Handler,
  assignmentReassign: (async ctx => ok(await svc(ctx).aiDesignStudio.assignmentReassign(ctx.params.id, ctx.req.body))) as Handler,
  reportSubmit: (async ctx => ok(await svc(ctx).aiDesignStudio.reportSubmit(ctx.req.body), 201)) as Handler,
  reports: (async ctx => ok(await svc(ctx).aiDesignStudio.reports(ctx.req.query))) as Handler,
  report: (async ctx => ok(await svc(ctx).aiDesignStudio.report(ctx.params.id))) as Handler,
  reportReview: (async ctx => ok(await svc(ctx).aiDesignStudio.reportReview(ctx.params.id, ctx.req.body))) as Handler,
  issueCreate: (async ctx => ok(await svc(ctx).aiDesignStudio.issueCreate(ctx.req.body), 201)) as Handler,
  issues: (async ctx => ok(await svc(ctx).aiDesignStudio.issues(ctx.req.query))) as Handler,
  issue: (async ctx => ok(await svc(ctx).aiDesignStudio.issue(ctx.params.id))) as Handler,
  issueUpdate: (async ctx => ok(await svc(ctx).aiDesignStudio.issueUpdate(ctx.params.id, ctx.req.body))) as Handler,
  issueEscalate: (async ctx => ok(await svc(ctx).aiDesignStudio.issueEscalate(ctx.params.id, ctx.req.body))) as Handler
};

// ---- AI Studio ----
export const aiStudioController = {
  overview: (async ctx => ok(await svc(ctx).aiStudio.overview())) as Handler,
  people: (async ctx => ok(await svc(ctx).aiStudio.people())) as Handler,
  assignLead: (async ctx => ok(await svc(ctx).aiStudio.assignLead(ctx.req.body))) as Handler,
  setLead: (async ctx => ok(await svc(ctx).aiStudio.setLead(ctx.params.id, ctx.req.body))) as Handler,
  projects: (async ctx => ok(await svc(ctx).aiStudio.projects())) as Handler,
  deadlines: (async ctx => ok(await svc(ctx).aiStudio.deadlines())) as Handler,
  createProject: (async ctx => ok(await svc(ctx).aiStudio.createProject(ctx.req.body), 201)) as Handler,
  updateProject: (async ctx => ok(await svc(ctx).aiStudio.updateProject(ctx.params.id, ctx.req.body))) as Handler,
  assignProject: (async ctx => ok(await svc(ctx).aiStudio.assignProject(ctx.params.id, ctx.req.body))) as Handler,
  tasks: (async ctx => ok(await svc(ctx).aiStudio.tasks(ctx.req.query))) as Handler,
  task: (async ctx => ok(await svc(ctx).aiStudio.task(ctx.params.id))) as Handler,
  assignTask: (async ctx => ok(await svc(ctx).aiStudio.assignTask(ctx.req.body), 201)) as Handler,
  editTask: (async ctx => ok(await svc(ctx).aiStudio.editTask(ctx.params.id, ctx.req.body))) as Handler,
  updateTask: (async ctx => ok(await svc(ctx).aiStudio.updateTask(ctx.params.id, ctx.req.body))) as Handler,
  reportContext: (async ctx => ok(await svc(ctx).aiStudio.reportContext())) as Handler,
  reports: (async ctx => ok(await svc(ctx).aiStudio.reports(ctx.req.query))) as Handler,
  report: (async ctx => ok(await svc(ctx).aiStudio.report(ctx.params.id))) as Handler,
  createReport: (async ctx => ok(await svc(ctx).aiStudio.createReport(ctx.req.body), 201)) as Handler,
  updateReport: (async ctx => ok(await svc(ctx).aiStudio.updateReport(ctx.params.id, ctx.req.body))) as Handler,
  deleteDraft: (async ctx => { await svc(ctx).aiStudio.deleteDraft(ctx.params.id); return ok(null); }) as Handler,
  reviewReport: (async ctx => ok(await svc(ctx).aiStudio.reviewReport(ctx.params.id, ctx.req.body))) as Handler
};
