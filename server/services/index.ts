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
import { AccountsFinanceService } from './AccountsFinanceService.js';
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
import { OrganizationService } from './OrganizationService.js';
import { PipelineService } from './PipelineService.js';
import { AutomationService } from './AutomationService.js';
import { UserService } from './UserService.js';
import { CustomerImportService } from './CustomerImportService.js';
import { ChatService } from './ChatService.js';
import { TicketAttachmentService } from './TicketAttachmentService.js';
import { TicketAttachmentRepository } from '../repositories/TicketAttachmentRepository.js';
import { ChatRepository } from '../repositories/ChatRepository.js';
import { DashboardRepository } from '../repositories/DashboardRepository.js';
import { DashboardService } from './DashboardService.js';
import { PerformanceService } from './PerformanceService.js';
import { RecruitmentService } from './RecruitmentService.js';
import { TrainingService } from './TrainingService.js';
import { TelecallerService } from './TelecallerService.js';
import { SalesHeadService } from './SalesHeadService.js';
import { BusinessAssociateService } from './BusinessAssociateService.js';
import { BusinessAssociateRepository } from '../repositories/BusinessAssociateRepository.js';
import { TelecallerRepository } from '../repositories/TelecallerRepository.js';
import { SalesHeadRepository } from '../repositories/SalesHeadRepository.js';
import { TrainingRepository } from '../repositories/TrainingRepository.js';
import { RecruitmentRepository } from '../repositories/RecruitmentRepository.js';
import { PerformanceRepository } from '../repositories/PerformanceRepository.js';

/** Request-scoped service container (repositories share the caller's RLS client). */
export function createServices(db: SupabaseClient) {
  return {
    users: new UserService(new ProfileRepository(db), undefined, new HrRepository(db)),
    hr: new HrService(new HrRepository(db)),
    performance: new PerformanceService(new PerformanceRepository(db)),
    recruitment: new RecruitmentService(new RecruitmentRepository(db)),
    training: new TrainingService(new TrainingRepository(db)),
    telecaller: new TelecallerService(new TelecallerRepository(db), new StorageRepository()),
    salesHead: new SalesHeadService(new SalesHeadRepository(db), new StorageRepository()),
    ba: new BusinessAssociateService(new BusinessAssociateRepository(db), new StorageRepository()),
    customers: new CustomerService(new CustomerRepository(db)),
    approvals: new ApprovalService(new ApprovalRepository(db)),
    notifications: new NotificationService(new NotificationRepository(db)),
    organization: new OrganizationService(new OrganizationRepository(db)),
    audit: new AuditService(new AuditRepository(db)),
    dashboards: new DashboardService(new DashboardRepository(db)),
    pipeline: new PipelineService(new PipelineRepository(db), new StorageRepository()),
    automations: new AutomationService(new PipelineRepository(db)),
    finance: new AccountsFinanceService(new AccountsFinanceRepository(db)),
    departmentIncome: new DepartmentIncomeService(new DepartmentIncomeRepository(db)),
    businessReport: new BusinessReportService(new BusinessReportRepository(db)),
    addons: new AddonInvoiceService(new AddonInvoiceRepository(db)),
    generatedInvoices: new GeneratedInvoiceService(new GeneratedInvoiceRepository(db), new StorageRepository()),
    customerImport: new CustomerImportService(db),
    chat: new ChatService(new ChatRepository(db), new StorageRepository()),
    ticketFiles: new TicketAttachmentService(new TicketAttachmentRepository(db), new StorageRepository()),
    client: new ClientService(new ClientRepository(db), new StorageRepository())
  };
}
export type Services = ReturnType<typeof createServices>;
