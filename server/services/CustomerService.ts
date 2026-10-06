import type { Customer, CustomerActivity, CustomerSummary, ImportResult, Paginated } from '../../shared/contracts.js';
import {
  customerActivityCreateSchema,
  customerCreateSchema,
  customerImportSchema,
  customerListQuerySchema,
  customerUpdateSchema,
  uuidSchema
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertCanDeleteCustomers } from '../authz/policies.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { CustomerRepository } from '../repositories/CustomerRepository.js';

/**
 * Customer business logic. Visibility and ownership are enforced by RLS and
 * the customers trigger (owner → team → department); this service validates
 * input and shapes results.
 */
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  list(query: unknown): Promise<Paginated<Customer>> {
    return this.customers.list(parse(customerListQuerySchema, query));
  }

  summary(): Promise<CustomerSummary> {
    return this.customers.summary();
  }

  get(id: string): Promise<Customer> {
    return this.customers.findById(parse(uuidSchema, id));
  }

  create(actor: Actor, body: unknown): Promise<Customer> {
    const input = parse(customerCreateSchema, body);
    // Team members always own what they create; managers may assign an owner.
    if (actor.role === 'TEAM_MEMBER' && input.ownerId && input.ownerId !== actor.id) {
      throw new AppError('FORBIDDEN', 'You can only add customers to your own book.');
    }
    if (!input.ownerId && !actor.teamId) {
      throw new AppError('VALIDATION_ERROR', 'Choose a customer owner who belongs to a team.', [{ path: 'ownerId', message: 'Required' }]);
    }
    return this.customers.insert(input);
  }

  update(id: string, body: unknown): Promise<Customer> {
    return this.customers.update(parse(uuidSchema, id), parse(customerUpdateSchema, body));
  }

  async delete(actor: Actor, id: string): Promise<void> {
    assertCanDeleteCustomers(actor);
    await this.customers.delete(parse(uuidSchema, id));
  }

  /** Bulk import (legacy browser data migration). Each row is validated and inserted under RLS. */
  async import(actor: Actor, body: unknown): Promise<ImportResult> {
    const { customers } = parse(customerImportSchema, body);
    const result: ImportResult = { imported: 0, skipped: [] };
    for (let index = 0; index < customers.length; index++) {
      try {
        await this.create(actor, customers[index]);
        result.imported++;
      } catch (err) {
        result.skipped.push({ index, reason: err instanceof AppError ? err.message : 'Unexpected error' });
      }
    }
    return result;
  }

  listActivities(id: string): Promise<CustomerActivity[]> {
    return this.customers.listActivities(parse(uuidSchema, id));
  }

  addActivity(id: string, body: unknown): Promise<CustomerActivity> {
    return this.customers.addActivity(parse(uuidSchema, id), parse(customerActivityCreateSchema, body));
  }
}
