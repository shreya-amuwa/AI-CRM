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
import { ChatRepository } from '../repositories/ChatRepository.js';
import { DashboardRepository } from '../repositories/DashboardRepository.js';
import { DashboardService } from './DashboardService.js';

/** Request-scoped service container (repositories share the caller's RLS client). */
export function createServices(db: SupabaseClient) {
  return {
    users: new UserService(new ProfileRepository(db), undefined, new HrRepository(db)),
    hr: new HrService(new HrRepository(db)),
    customers: new CustomerService(new CustomerRepository(db)),
    approvals: new ApprovalService(new ApprovalRepository(db)),
    notifications: new NotificationService(new NotificationRepository(db)),
    organization: new OrganizationService(new OrganizationRepository(db)),
    audit: new AuditService(new AuditRepository(db)),
    dashboards: new DashboardService(new DashboardRepository(db)),
    pipeline: new PipelineService(new PipelineRepository(db), new StorageRepository()),
    automations: new AutomationService(new PipelineRepository(db)),
    finance: new AccountsFinanceService(new AccountsFinanceRepository(db)),
    businessReport: new BusinessReportService(new BusinessReportRepository(db)),
    addons: new AddonInvoiceService(new AddonInvoiceRepository(db)),
    generatedInvoices: new GeneratedInvoiceService(new GeneratedInvoiceRepository(db), new StorageRepository()),
    customerImport: new CustomerImportService(db),
    chat: new ChatService(new ChatRepository(db), new StorageRepository()),
    client: new ClientService(new ClientRepository(db), new StorageRepository())
  };
}
export type Services = ReturnType<typeof createServices>;
