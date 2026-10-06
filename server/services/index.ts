import type { SupabaseClient } from '@supabase/supabase-js';
import { ApprovalRepository } from '../repositories/ApprovalRepository.js';
import { AuditRepository } from '../repositories/AuditRepository.js';
import { CustomerRepository } from '../repositories/CustomerRepository.js';
import { NotificationRepository } from '../repositories/NotificationRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { ProfileRepository } from '../repositories/ProfileRepository.js';
import { ApprovalService } from './ApprovalService.js';
import { AuditService } from './AuditService.js';
import { CustomerService } from './CustomerService.js';
import { NotificationService } from './NotificationService.js';
import { OrganizationService } from './OrganizationService.js';
import { UserService } from './UserService.js';

/** Request-scoped service container (repositories share the caller's RLS client). */
export function createServices(db: SupabaseClient) {
  return {
    users: new UserService(new ProfileRepository(db)),
    customers: new CustomerService(new CustomerRepository(db)),
    approvals: new ApprovalService(new ApprovalRepository(db)),
    notifications: new NotificationService(new NotificationRepository(db)),
    organization: new OrganizationService(new OrganizationRepository(db)),
    audit: new AuditService(new AuditRepository(db))
  };
}
export type Services = ReturnType<typeof createServices>;
