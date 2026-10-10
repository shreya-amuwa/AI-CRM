import type { Customer as CustomerDto, CustomerSegment, CustomerStatus } from '../../shared/contracts';
import type { Customer } from '../types/crm';

/** Database enum ⇄ legacy UI labels used by the existing customer screens. */
export const SEGMENT_LABELS: Record<CustomerSegment, Customer['segment']> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  CORPORATE: 'Corporate',
  OTHER: 'Others'
};
export const STATUS_LABELS: Record<CustomerStatus, Customer['status']> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PROSPECT: 'Prospect'
};

export const segmentFromLabel = (label: string): CustomerSegment | undefined =>
  (Object.keys(SEGMENT_LABELS) as CustomerSegment[]).find(k => SEGMENT_LABELS[k] === label);
export const statusFromLabel = (label: string): CustomerStatus | undefined =>
  (Object.keys(STATUS_LABELS) as CustomerStatus[]).find(k => STATUS_LABELS[k] === label);

/** Convert the API record into the view shape the existing components render. */
export function toViewCustomer(c: CustomerDto): Customer {
  return {
    id: c.id,
    name: c.name,
    company: c.company || '',
    phone: c.phone || '',
    email: c.email || '',
    segment: SEGMENT_LABELS[c.segment],
    status: STATUS_LABELS[c.status],
    lastOrderDate: c.lastOrderDate
      ? new Date(`${c.lastOrderDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '-',
    lastOrderAmount: c.lastOrderAmount ?? 0,
    totalSpent: c.totalSpent,
    orderCount: c.orderCount,
    assignedTo: c.ownerId,
    ownerName: c.owner?.fullName
  };
}
