import type { SupabaseClient } from '@supabase/supabase-js';
import { AccountsFinanceRepository } from '../repositories/AccountsFinanceRepository.js';
import { BusinessReportRepository } from '../repositories/BusinessReportRepository.js';
import { AddonInvoiceRepository } from '../repositories/AddonInvoiceRepository.js';
import { ApprovalRepository } from '../repositories/ApprovalRepository.js';
import { AuditRepository } from '../repositories/AuditRepository.js';
import { ClientRepository } from '../repositories/ClientRepository.js';
import { HrRepository } from '../repositories/HrRepository.js';
import { GeneratedInvoiceRepository } from '../repositories/GeneratedInvoiceRepository.js';
import { CustomerRepository } from '../repositories/CustomerRepository.js';
import { NotificationRepository } from '../repositories/NotificationRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { PipelineRepository } from '../repositories/PipelineRepository.js';
import { ProfileRepository } from '../repositories/ProfileRepository.js';
import { StorageRepository } from '../repositories/StorageRepository.js';
import { PayoutRepository } from '../repositories/PayoutRepository.js';
import { PayoutService } from './PayoutService.js';
import { AccountsFinanceService } from './AccountsFinanceService.js';
import { MeetingService } from './MeetingService.js';
import { LeadWhatsAppService } from './LeadWhatsAppService.js';
import { CrocodialService } from './CrocodialService.js';
import { CrocodialRepository } from '../repositories/CrocodialRepository.js';
import { LeadWhatsAppRepository } from '../repositories/LeadWhatsAppRepository.js';
import { MeetingRepository } from '../repositories/MeetingRepository.js';
import { BusinessReportService } from './BusinessReportService.js';
import { DepartmentIncomeService } from './DepartmentIncomeService.js';
import { DepartmentIncomeRepository } from '../repositories/DepartmentIncomeRepository.js';
import { AddonInvoiceService } from './AddonInvoiceService.js';
import { ApprovalService } from './ApprovalService.js';
import { AuditService } from './AuditService.js';
import { ClientService } from './ClientService.js';
import { CustomerService } from './CustomerService.js';
import { HrService } from './HrService.js';
import { GeneratedInvoiceService } from './GeneratedInvoiceService.js';
import { NotificationService } from './NotificationService.js';
import { EmailAdminService } from './EmailAdminService.js';
import { EmailAdminRepository } from '../repositories/EmailAdminRepository.js';
import { NotificationHealthService } from './NotificationHealthService.js';
import { NotificationHealthRepository } from '../repositories/NotificationHealthRepository.js';
import { OrganizationService } from './OrganizationService.js';
import { PipelineService } from './PipelineService.js';
import { WorkflowService } from './WorkflowService.js';
import { WelcomeEmailRepository } from '../repositories/WelcomeEmailRepository.js';
import { WelcomeEmailService } from './WelcomeEmailService.js';
import { ReminderCallRepository } from '../repositories/ReminderCallRepository.js';
import { ReminderCallService } from './ReminderCallService.js';
import { WorkflowRepository } from '../repositories/WorkflowRepository.js';
import { AutomationService } from './AutomationService.js';
import { UserService } from './UserService.js';
import { EmployeeApprovalService } from './EmployeeApprovalService.js';
import { EmployeeApprovalRepository } from '../repositories/EmployeeApprovalRepository.js';
import { CustomerImportService } from './CustomerImportService.js';
import { ChatService } from './ChatService.js';
import { TicketAttachmentService } from './TicketAttachmentService.js';
import { EmployeeCaseService } from './EmployeeCaseService.js';
import { BugService } from './BugService.js';
import { BugRepository } from '../repositories/BugRepository.js';
import { EmployeeCaseRepository } from '../repositories/EmployeeCaseRepository.js';
import { WorkReportRepository } from '../repositories/WorkReportRepository.js';
import { WorkReportService } from './WorkReportService.js';
import { AiDesignStudioRepository } from '../repositories/AiDesignStudioRepository.js';
import { AiDesignStudioService } from './AiDesignStudioService.js';
import { HrReviewRepository } from '../repositories/HrReviewRepository.js';
import { HrReviewService } from './HrReviewService.js';
import { ReportAnalyticsRepository } from '../repositories/ReportAnalyticsRepository.js';
import { ReportAnalyticsService } from './ReportAnalyticsService.js';
import { TicketAttachmentRepository } from '../repositories/TicketAttachmentRepository.js';
import { ChatRepository } from '../repositories/ChatRepository.js';
import { DashboardRepository } from '../repositories/DashboardRepository.js';
import { DashboardService } from './DashboardService.js';
import { PerformanceService } from './PerformanceService.js';
import { PerformersService } from './PerformersService.js';
import { RecruitmentService } from './RecruitmentService.js';
import { HrDocumentService } from './HrDocumentService.js';
import { HrDocumentRepository } from '../repositories/HrDocumentRepository.js';
import { HrEmployeeFileService } from './HrEmployeeFileService.js';
import { HrEmployeeFileRepository } from '../repositories/HrEmployeeFileRepository.js';
import { TrainingService } from './TrainingService.js';
import { TelecallerService } from './TelecallerService.js';
import { AiStudioService } from './AiStudioService.js';
import { AiStudioRepository } from '../repositories/AiStudioRepository.js';
import { LeadUploadService } from './LeadUploadService.js';
import { LeadUploadRepository } from '../repositories/LeadUploadRepository.js';
import { FieldVisitService } from './FieldVisitService.js';
import { FieldVisitRepository } from '../repositories/FieldVisitRepository.js';
import { SalesHeadService } from './SalesHeadService.js';
import { BusinessAssociateService } from './BusinessAssociateService.js';
import { BusinessAssociateRepository } from '../repositories/BusinessAssociateRepository.js';
import { TelecallerRepository } from '../repositories/TelecallerRepository.js';
import { SalesHeadRepository } from '../repositories/SalesHeadRepository.js';
import { TrainingRepository } from '../repositories/TrainingRepository.js';
import { RecruitmentRepository } from '../repositories/RecruitmentRepository.js';
import { PerformanceRepository } from '../repositories/PerformanceRepository.js';
import { PerformersRepository } from '../repositories/PerformersRepository.js';

/** Request-scoped service container (repositories share the caller's RLS client). */
export function createServices(db: SupabaseClient) {
  return {
    users: new UserService(new ProfileRepository(db), undefined, new HrRepository(db), new AiStudioRepository(db)),
    employees: new EmployeeApprovalService(new EmployeeApprovalRepository(db)),
    hr: new HrService(new HrRepository(db)),
    hrDocuments: new HrDocumentService(new HrDocumentRepository(db), new StorageRepository()),
    payouts: new PayoutService(new PayoutRepository(db)),
    performance: new PerformanceService(new PerformanceRepository(db)),
    performers: new PerformersService(new PerformersRepository(db)),
    recruitment: new RecruitmentService(new RecruitmentRepository(db)),
    training: new TrainingService(new TrainingRepository(db)),
    fieldVisit: new FieldVisitService(new FieldVisitRepository(db)),
    aiStudio: new AiStudioService(new AiStudioRepository(db)),
    telecaller: new TelecallerService(new TelecallerRepository(db), new StorageRepository()),
    leadUploads: new LeadUploadService(new LeadUploadRepository(db)),
    salesHead: new SalesHeadService(new SalesHeadRepository(db), new StorageRepository()),
    ba: new BusinessAssociateService(new BusinessAssociateRepository(db), new StorageRepository()),
    customers: new CustomerService(new CustomerRepository(db)),
    approvals: new ApprovalService(new ApprovalRepository(db)),
    notifications: new NotificationService(new NotificationRepository(db)),
    emailAdmin: new EmailAdminService(new EmailAdminRepository(db)),
    notificationHealth: new NotificationHealthService(new NotificationHealthRepository(db)),
    organization: new OrganizationService(new OrganizationRepository(db)),
    audit: new AuditService(new AuditRepository(db)),
    dashboards: new DashboardService(new DashboardRepository(db)),
    pipeline: new PipelineService(new PipelineRepository(db), new StorageRepository()),
    automations: new AutomationService(new PipelineRepository(db)),
    workflow: new WorkflowService(new WorkflowRepository(db)),
    finance: new AccountsFinanceService(new AccountsFinanceRepository(db)),
    departmentIncome: new DepartmentIncomeService(new DepartmentIncomeRepository(db)),
    businessReport: new BusinessReportService(new BusinessReportRepository(db)),
    addons: new AddonInvoiceService(new AddonInvoiceRepository(db)),
    generatedInvoices: new GeneratedInvoiceService(new GeneratedInvoiceRepository(db), new StorageRepository()),
    customerImport: new CustomerImportService(db),
    chat: new ChatService(new ChatRepository(db), new StorageRepository()),
    employeeCases: new EmployeeCaseService(new EmployeeCaseRepository(db), new StorageRepository()),
    meetings: new MeetingService(new MeetingRepository(db)),
    bugs: new BugService(new BugRepository(db)),
    leadWhatsApp: new LeadWhatsAppService(new LeadWhatsAppRepository(db)),
    crocodial: new CrocodialService(new CrocodialRepository(db)),
    workReports: new WorkReportService(new WorkReportRepository(db)),
    aiDesignStudio: new AiDesignStudioService(new AiDesignStudioRepository(db)),
    hrReviews: new HrReviewService(new HrReviewRepository(db)),
    reportAnalytics: new ReportAnalyticsService(new ReportAnalyticsRepository(db)),
    welcomeEmails: new WelcomeEmailService(new WelcomeEmailRepository(db)),
    reminderCalls: new ReminderCallService(new ReminderCallRepository(db)),
    ticketFiles: new TicketAttachmentService(new TicketAttachmentRepository(db), new StorageRepository()),
    hrEmployeeFiles: new HrEmployeeFileService(new HrEmployeeFileRepository(db), new StorageRepository()),
    client: new ClientService(new ClientRepository(db), new StorageRepository())
  };
}
export type Services = ReturnType<typeof createServices>;
