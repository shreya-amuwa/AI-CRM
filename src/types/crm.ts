// Departments are now dynamic (Super Admin can create new ones), so this is a
// plain string id rather than a fixed union. Existing built-in departments
// keep their historical ids ('amuwa', 'wabastore', etc.) as string values.
export type DepartmentId = string;

export type LeadSourceId = 
  | 'whatsapp'
  | 'meta'
  | 'telecaller'
  | 'bizdev'
  | 'aicalling'
  | 'rcs'
  | 'website'
  | 'references'
  | 'coldcalling'
  | 'thirdparty';

export interface Department {
  /** Legacy string id (database `slug`), used in URLs and panels. */
  id: DepartmentId;
  /** Database primary key (uuid). */
  dbId?: string;
  name: string;
  description: string;
  category?: string;
  iconName: string;
  accentColor: string;
  logoUrl?: string; // ONLY exact user-provided logo image URL
  totalLeads: number;
  activeSessions: number;
  maxSessions: number;
  // Access state — replaces the old free-text "status" field entirely.
  // Controlled solely by the inline department lock/unlock control.
  locked: boolean;
  // Department Head assignment (Phase 2 will add full credential management)
  headUserId?: string;
  headName?: string;
  createdAt: string; // ISO 8601
}

export interface DepartmentCreateInput {
  name: string;
  description: string;
  category?: string;
}

export interface LeadSource {
  id: LeadSourceId;
  name: string;
  badgeLabel: string;
  color: string; // Hex color
  bgClass: string;
  textClass: string;
  borderClass: string;
  glowClass: string;
  description: string;
  defaultPayload: Record<string, any>;
}

export interface Lead {
  id: string;
  name: string;
  contact: string;
  email?: string;
  company?: string;
  sourceId: LeadSourceId;
  departmentId: DepartmentId;
  assignedTo?: string; // userId
  stage?: 'New' | 'New Lead' | 'Contacted' | 'Interested' | 'Demo' | 'Proposal' | 'Negotiation' | 'Won' | 'Lost';
  priority?: 'High' | 'Medium' | 'Low';
  lastActionDate?: string;
  receivedAt: string; // ISO 8601 string
  status: 'Ingested' | 'Processing' | 'Verified';
  rawPayload: Record<string, any>;
  notes?: string;
  campaign?: string;
  location?: string;
  dealValue?: number;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  departmentId: DepartmentId;
  loggedInAt: string;
  device: string;
  ipAddress: string;
  lastActive: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'superadmin' | 'admin' | 'hr' | 'client' | 'team-member' | 'support-member' | 'team-lead' | 'support-lead' | 'accounts-staff' | 'technical-support';
  clientCompany?: string;
  departmentId?: string;
  subDepartment?: string;
  position?: string;
  /** Database profile (role/status/team) this navigation identity was derived from. */
  profile?: import('../../shared/contracts').Profile;
}

export interface TeamMemberActivity {
  id: string;
  userId: string;
  leadId: string;
  leadName: string;
  action: string;
  time: string; // e.g. "10:30 AM"
  date: string; // e.g. "2026-09-18"
  notes?: string;
  type?: 'call' | 'message' | 'demo' | 'update' | 'stage';
}

export interface EndOfDayReport {
  id: string;
  userId: string;
  userName: string;
  date: string;
  timestamp: string;
  leadsAdvanced: number;
  salesClosed: number;
  callsMade: number;
  demosScheduled: number;
  notes?: string;
}

export interface FollowUpTask {
  id: string;
  userId: string;
  leadId: string;
  leadName: string;
  company: string;
  type: 'Call' | 'WhatsApp' | 'Email' | 'Meeting';
  dateTimeStr: string;
  notes: string;
  status: 'upcoming' | 'overdue' | 'completed';
  completedAt?: string;
}

export interface Deal {
  id: string;
  userId: string;
  leadId: string;
  leadName: string;
  company: string;
  value: number;
  stage: 'Proposal' | 'Negotiation' | 'Won' | 'Lost';
  expectedClose: string;
  createdAt: string;
}

export interface RecentUpdate {
  id: string;
  userId?: string;
  title: string;
  timeAgo: string;
  type: 'lead' | 'deal' | 'invoice' | 'call';
  timestamp: string;
}

export interface LeadSourceStat {
  name: string;
  count: number;
  percentage: number;
  color: string;
}

export interface MemberTarget {
  current: number;
  goal: number;
  percentage: number;
}

export interface Customer {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  segment: 'Retail' | 'Wholesale' | 'Corporate' | 'Others';
  status: 'Active' | 'Inactive' | 'Prospect';
  lastOrderDate: string;
  lastOrderAmount: number;
  totalSpent?: number;
  orderCount?: number;
  assignedTo: string;
  ownerName?: string;
}

export interface InvoiceItemDetail {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  company: string;
  amount: number;
  issueDate: string;
  dueDate: string;
  status: 'Paid' | 'Pending' | 'Overdue';
  departmentId?: string;
  departmentName?: string;
  division?: string;
  items?: InvoiceItemDetail[];
  terms?: string;
  billingAddress?: string;
  taxAmount?: number;
  contactEmail?: string;
  contactPhone?: string;
  userId?: string;
  teamMemberId?: string;
  teamMemberName?: string;
  teamMemberRole?: string;
}

export interface CalendarEvent {
  id: string;
  userId?: string;
  title: string;
  customer: string;
  company?: string;
  type: 'call' | 'demo' | 'meeting' | 'review';
  date: string;
  time: string;
  status: 'confirmed' | 'pending' | 'completed';
}

// ==========================================
// TEAM LEAD DASHBOARD INTERFACES
// ==========================================

export interface TeamLeadUser {
  id: string;
  name: string;
  email: string;
  role: 'team-lead';
  title: string;
  podName: string;
  departmentId: string;
  avatar: string;
  teamMemberIds: string[];
}

export interface TeamRepPerformance {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: 'Available' | 'On Call' | 'In Demo' | 'Offline';
  activeLeads: number;
  callsToday: number;
  demosToday: number;
  wonDealsMonth: number;
  revenueClosed: number;
  targetRevenue: number;
  quotaPercent: number;
  capacityMax: number;
  pendingTasks: number;
  overdueTasks: number;
  conversionRate: number;
}

export interface UnassignedLead {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  source: 'WhatsApp' | 'Meta Ads' | 'Website' | 'Referral';
  interest: string;
  estimatedValue: number;
  receivedAt: string;
  priority: 'High' | 'Medium' | 'Low';
  city: string;
}

export interface EodSubmissionItem {
  id: string;
  repId: string;
  repName: string;
  repAvatar: string;
  date: string;
  submittedAt: string;
  leadsContacted: number;
  demosConducted: number;
  dealsClosed: number;
  revenueBooked: number;
  challenges: string;
  tomorrowPlan: string;
  status: 'Submitted' | 'Reviewed' | 'Pending';
  leadFeedback?: string;
}

export interface TeamDealItem {
  id: string;
  dealName: string;
  company: string;
  clientContact: string;
  assignedRepId: string;
  assignedRepName: string;
  value: number;
  stage: 'New Lead' | 'Contacted' | 'Demo' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost';
  probability: number;
  expectedClose: string;
  requiresDiscountApproval?: boolean;
  discountRequested?: number;
  isDiscountApproved?: boolean;
  notes?: string;
  leadReviewNote?: string;
}



