import { z } from 'zod';
import type { HeadDivision, Role, SalesSubRole, TeamDivision } from './contracts';

/**
 * Dashboard Explorer (docs/DASHBOARD_EXPLORER.md): the Managing Director (SUPER_ADMIN) previews what every position sees, with demonstration
 * data, in an isolated runtime. This file is the ONE registry both sides use:
 *  - the Explorer lists and filters these entries;
 *  - the preview runtime builds the synthetic profile from `profile` and lets the production role mapping (src/lib/auth/roleMapping.ts,
 *    toAuthUser) and the production App routing choose the dashboard - nothing here picks a component, so preview and production cannot drift;
 *  - the server accepts a preview session or an improvement request only for an id in DASHBOARD_IDS (the allowlist).
 * supabase/tests/dashboard_explorer.test.ts checks that every entry's profile really opens `expectedRole` through toAuthUser.
 *
 * A preview identity is SYNTHETIC: it is never a real employee, never a real account, and the production API never accepts it.
 */

/** The navigation role toAuthUser gives (src/types/crm.ts AuthUser['role']); repeated here so the server can import this file. */
export type PreviewNavRole =
  | 'admin' | 'hr' | 'team-member' | 'support-member' | 'team-lead' | 'support-lead' | 'accounts-staff' | 'technical-support' | 'meta-verifier'
  | 'telecaller' | 'business-associate' | 'sales-role' | 'sales-head' | 'hr-recruiter' | 'ai-studio' | 'design-studio' | 'unified';

export type DashboardCategory = 'EXECUTIVE' | 'SALES' | 'SUPPORT' | 'HR' | 'ACCOUNTS' | 'AI_STUDIO' | 'AI_DESIGN_STUDIO' | 'UNIFIED' | 'GENERAL';
export const DASHBOARD_CATEGORY_LABELS: Record<DashboardCategory, string> = {
  EXECUTIVE: 'Executive management', SALES: 'Sales', SUPPORT: 'Support', HR: 'HR', ACCOUNTS: 'Accounts', AI_STUDIO: 'AI Studio',
  AI_DESIGN_STUDIO: 'AI Design Studio', UNIFIED: 'Sales and Support together', GENERAL: 'Other departments'
};
export type BusinessFunction = 'SALES' | 'SUPPORT' | 'OTHER';
export const BUSINESS_FUNCTION_LABELS: Record<BusinessFunction, string> = { SALES: 'Sales', SUPPORT: 'Support', OTHER: 'Other' };

/** A department the preview can be shown in (demonstration copies of the configured departments; ids are synthetic). */
export interface PreviewDepartment { slug: string; name: string; unified?: boolean }
export const PREVIEW_DEPARTMENTS: readonly PreviewDepartment[] = [
  { slug: 'mpillar', name: 'M Pillar Corporation' },
  { slug: 'wabastore', name: 'Wabastore' },
  { slug: 'whatsbox', name: 'Whatsbox' },
  { slug: 'dtalk', name: 'D Talk Corporation' },
  { slug: 'digitree', name: 'Digitree Infotech' },
  { slug: 'designstudio', name: 'Amuwa Design Studio' },
  { slug: 'edutraining', name: 'Education & Training' },
  { slug: 'international', name: 'International', unified: true },
  { slug: 'reseller', name: 'Reseller', unified: true },
  { slug: 'hr', name: 'HR Department' },
  { slug: 'accounts', name: 'Accounts Department' },
  { slug: 'ai-studio', name: 'AI Studio' },
  { slug: 'ai-design-studio', name: 'AI Design Studio' }
];
/** The departments that have Sales and Support sides (the ones a Sales / Support position can be previewed in). */
const SALES_SUPPORT_DEPARTMENTS = ['mpillar', 'wabastore', 'whatsbox', 'dtalk', 'digitree', 'designstudio', 'edutraining'];
const UNIFIED_DEPARTMENTS = ['international', 'reseller'];

/** What the preview runtime turns into a synthetic Profile (src/dashboard-preview/runtime/previewIdentity.ts). */
export interface PreviewProfileSpec {
  role: Exclude<Role, 'SUPER_ADMIN'>;
  teamDivision?: TeamDivision;
  headDivision?: HeadDivision;
  salesSubRole?: SalesSubRole;
  hrSubRole?: 'HR_ASSISTANT' | 'HR_RECRUITER';
  isTechnicalConsultant?: boolean;
  isMetaVerifier?: boolean;
  /** CEO (internally a Department Head with is_operations_head). */
  isOperationsHead?: boolean;
  /** The CEO / head works in several departments (shows the department choice first, as in production). */
  multiDepartment?: boolean;
}

export type PreviewAvailability = 'AVAILABLE' | 'NO_DASHBOARD_YET';

export interface DashboardEntry {
  id: string;
  /** The position as people say it (the new designations: Managing Director, CEO, Department Head, Team Lead, Team Member). */
  position: string;
  category: DashboardCategory;
  businessFunction: BusinessFunction;
  /** The departments it can be previewed in; the first is the default. */
  departments: readonly string[];
  description: string;
  /** The main modules of the dashboard's navigation (shown on the Explorer card). */
  modules: readonly string[];
  profile: PreviewProfileSpec;
  /** What toAuthUser must return for this profile (checked by the unit test). */
  expectedRole: PreviewNavRole;
  /** Demonstration datasets the preview loads for it (src/dashboard-preview/fixtures). */
  datasets: readonly DatasetId[];
  /**
   * NO_DASHBOARD_YET: the role exists but production shows a "no dashboard yet" page for it - the preview shows the same page, nothing is invented.
   */
  availability: PreviewAvailability;
}

export type DatasetId = 'general' | 'sales' | 'support' | 'hr' | 'accounts' | 'ai-studio' | 'design-studio';

const SALES_HEAD_MODULES = ['Overview', 'Leads', 'Assign leads', 'Team performance', 'Tasks', 'Reports', 'Incentives', 'Meetings'];
const HEAD_MODULES = ['Overview', 'Assign', 'Work updates', 'Task reports', 'Customers', 'Invoices', 'Support desk', 'Team attendance', 'Team members'];

export const DASHBOARD_REGISTRY: readonly DashboardEntry[] = [
  // ---- Executive management ---------------------------------------------------------------------------------------------------------------
  { id: 'ceo-sales', position: 'CEO – Sales', category: 'EXECUTIVE', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'The CEO who manages the Sales side of the departments assigned to them: department monitoring, leads, teams and incentives.',
    modules: SALES_HEAD_MODULES, profile: { role: 'DEPARTMENT_HEAD', headDivision: 'SALES', isOperationsHead: true },
    expectedRole: 'sales-head', datasets: ['general', 'sales'], availability: 'AVAILABLE' },
  { id: 'ceo-support', position: 'CEO – Support', category: 'EXECUTIVE', businessFunction: 'SUPPORT', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'The CEO who manages the Support side: the Operations dashboard across their departments, customers, tickets and teams.',
    modules: ['Operations dashboard', ...HEAD_MODULES], profile: { role: 'DEPARTMENT_HEAD', headDivision: 'SUPPORT', isOperationsHead: true },
    expectedRole: 'admin', datasets: ['general', 'support'], availability: 'AVAILABLE' },
  { id: 'ceo-multi', position: 'CEO – several departments', category: 'EXECUTIVE', businessFunction: 'SUPPORT', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'A CEO assigned several departments and functions: first chooses the department and function to work in, as in production.',
    modules: ['Department choice', 'Operations dashboard', ...HEAD_MODULES],
    profile: { role: 'DEPARTMENT_HEAD', headDivision: 'SUPPORT', isOperationsHead: true, multiDepartment: true },
    expectedRole: 'admin', datasets: ['general', 'support', 'sales'], availability: 'AVAILABLE' },

  // ---- Sales ----------------------------------------------------------------------------------------------------------------------------------
  { id: 'sales-department-head', position: 'Sales Department Head', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Leads the Sales side of one department: lead assignment to Team Leads, team performance, follow-ups and reports.',
    modules: SALES_HEAD_MODULES, profile: { role: 'DEPARTMENT_HEAD', headDivision: 'SALES' }, expectedRole: 'sales-head', datasets: ['general', 'sales'], availability: 'AVAILABLE' },
  { id: 'sales-team-lead', position: 'Sales Team Lead', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Runs a Sales team: distributes leads, assigns tasks, reviews daily reports and follows the pipeline.',
    modules: ['Overview', 'Leads', 'Team', 'Tasks', 'Daily reports', 'Pipeline'], profile: { role: 'TEAM_HEAD', teamDivision: 'SALES' },
    expectedRole: 'team-lead', datasets: ['general', 'sales', 'support'], availability: 'AVAILABLE' },
  { id: 'sales-team-member', position: 'Sales Team Member', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'A Sales Team Member with no special Sales role: works in the shared Sales dashboard (leads, follow-ups, quotations, tasks).',
    modules: ['Overview', 'Leads', 'Follow-ups', 'Quotation', 'Tasks'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SALES' },
    expectedRole: 'business-associate', datasets: ['general', 'sales', 'support'], availability: 'AVAILABLE' },
  { id: 'telecaller', position: 'Telecaller', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Calls contacts and leads from the assigned sheets, records call outcomes and follow-ups.',
    modules: ['Overview', 'Contact sheets', 'Leads', 'Follow-ups', 'Tasks'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SALES', salesSubRole: 'TELECALLER' },
    expectedRole: 'telecaller', datasets: ['general', 'sales', 'support'], availability: 'AVAILABLE' },
  { id: 'business-associate', position: 'Business Associate', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Meets prospects, prepares quotations and follows the leads they own.',
    modules: ['Overview', 'Leads', 'Quotation', 'Field visits', 'Tasks'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SALES', salesSubRole: 'BUSINESS_ASSOCIATE' },
    expectedRole: 'business-associate', datasets: ['general', 'sales', 'support'], availability: 'AVAILABLE' },
  { id: 'visit-sales', position: 'Visit Sales', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'The Visit Sales role exists, but production has no dedicated dashboard for it yet: the preview shows the same notice page.',
    modules: ['Notice page'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SALES', salesSubRole: 'VISIT_SALES' },
    expectedRole: 'sales-role', datasets: ['general'], availability: 'NO_DASHBOARD_YET' },
  { id: 'influencer', position: 'Influencer', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'The Influencer role exists, but production has no dedicated dashboard for it yet: the preview shows the same notice page.',
    modules: ['Notice page'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SALES', salesSubRole: 'INFLUENCER' },
    expectedRole: 'sales-role', datasets: ['general'], availability: 'NO_DASHBOARD_YET' },
  { id: 'business-partner', position: 'Business Partner', category: 'SALES', businessFunction: 'SALES', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'The Business Partner role exists, but production has no dedicated dashboard for it yet: the preview shows the same notice page.',
    modules: ['Notice page'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SALES', salesSubRole: 'BUSINESS_PARTNER' },
    expectedRole: 'sales-role', datasets: ['general'], availability: 'NO_DASHBOARD_YET' },

  // ---- Support --------------------------------------------------------------------------------------------------------------------------------
  { id: 'support-department-head', position: 'Support Department Head', category: 'SUPPORT', businessFunction: 'SUPPORT', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Leads the Support side of one department: customers, hand-overs, tickets, invoices, team attendance and task assignment.',
    modules: HEAD_MODULES, profile: { role: 'DEPARTMENT_HEAD', headDivision: 'SUPPORT' }, expectedRole: 'admin', datasets: ['general', 'support'], availability: 'AVAILABLE' },
  { id: 'support-team-lead', position: 'Support Team Lead', category: 'SUPPORT', businessFunction: 'SUPPORT', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Runs a Support team: the team\'s customers and tickets, assignment, escalations and tasks.',
    modules: ['Overview', 'Customers', 'Tickets', 'Tasks', 'Team activity'], profile: { role: 'TEAM_HEAD', teamDivision: 'SUPPORT' },
    expectedRole: 'support-lead', datasets: ['general', 'support'], availability: 'AVAILABLE' },
  { id: 'support-team-member', position: 'Support Team Member', category: 'SUPPORT', businessFunction: 'SUPPORT', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Looks after their customers: services, tickets, renewals, invoices requests and tasks.',
    modules: ['Overview', 'Customers', 'Add customer', 'Tickets', 'Tasks', 'Invoices'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SUPPORT' },
    expectedRole: 'support-member', datasets: ['general', 'support'], availability: 'AVAILABLE' },
  { id: 'meta-verifier', position: 'Meta Verifier', category: 'SUPPORT', businessFunction: 'SUPPORT', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Does the first verification of WhatsApp customers before onboarding.',
    modules: ['Verification queue', 'Customers', 'Tasks'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SUPPORT', isMetaVerifier: true },
    expectedRole: 'meta-verifier', datasets: ['general', 'support'], availability: 'AVAILABLE' },
  { id: 'technical-consultant', position: 'Technical Consultant', category: 'SUPPORT', businessFunction: 'SUPPORT', departments: SALES_SUPPORT_DEPARTMENTS,
    description: 'Onboards customers technically: the client onboarding queue, Meta set-up and hand-over.',
    modules: ['Onboarding queue', 'Customers', 'Tasks'], profile: { role: 'TEAM_MEMBER', teamDivision: 'SUPPORT', isTechnicalConsultant: true },
    expectedRole: 'technical-support', datasets: ['general', 'support'], availability: 'AVAILABLE' },

  // ---- HR -------------------------------------------------------------------------------------------------------------------------------------
  { id: 'hr-department-head', position: 'HR Department Head', category: 'HR', businessFunction: 'OTHER', departments: ['hr'],
    description: 'Runs HR: employees, attendance, leave, recruitment, probation, letters and employee issues.',
    modules: ['Overview', 'Employees', 'Attendance', 'Leave', 'Recruitment', 'Probation', 'Letters', 'Employee issues'], profile: { role: 'DEPARTMENT_HEAD' },
    expectedRole: 'hr', datasets: ['general', 'hr'], availability: 'AVAILABLE' },
  { id: 'hr-team-lead', position: 'HR Team Lead', category: 'HR', businessFunction: 'OTHER', departments: ['hr'],
    description: 'An HR Team Lead: works in the HR dashboard with their team\'s scope.',
    modules: ['Overview', 'Employees', 'Attendance', 'Leave', 'Recruitment'], profile: { role: 'TEAM_HEAD', teamDivision: 'GENERAL', hrSubRole: 'HR_ASSISTANT' },
    expectedRole: 'hr', datasets: ['general', 'hr'], availability: 'AVAILABLE' },
  { id: 'hr-assistant', position: 'HR Assistant', category: 'HR', businessFunction: 'OTHER', departments: ['hr'],
    description: 'The HR Assistant: the HR dashboard, with the Recruitment Portal one click away.',
    modules: ['Overview', 'Employees', 'Attendance', 'Leave', 'Recruitment Portal'], profile: { role: 'TEAM_MEMBER', teamDivision: 'GENERAL', hrSubRole: 'HR_ASSISTANT' },
    expectedRole: 'hr', datasets: ['general', 'hr'], availability: 'AVAILABLE' },
  { id: 'hr-recruiter', position: 'HR Recruiter', category: 'HR', businessFunction: 'OTHER', departments: ['hr'],
    description: 'Vacancies, applications, interviews and selection.',
    modules: ['Vacancies', 'Applications', 'Interviews', 'Selection'], profile: { role: 'TEAM_MEMBER', teamDivision: 'GENERAL', hrSubRole: 'HR_RECRUITER' },
    expectedRole: 'hr-recruiter', datasets: ['general', 'hr'], availability: 'AVAILABLE' },

  // ---- Accounts -------------------------------------------------------------------------------------------------------------------------------
  { id: 'accounts-department-head', position: 'Accounts Department Head', category: 'ACCOUNTS', businessFunction: 'OTHER', departments: ['accounts'],
    description: 'Confirms the amounts Sales sends, configures monthly plans and follows the department\'s work.',
    modules: ['Payment confirmations', 'Monthly plans', 'Assign', 'Task reports', 'Customers', 'Team members'], profile: { role: 'DEPARTMENT_HEAD' },
    expectedRole: 'admin', datasets: ['general', 'accounts'], availability: 'AVAILABLE' },
  { id: 'accounts-team-lead', position: 'Accounts Team Lead', category: 'ACCOUNTS', businessFunction: 'OTHER', departments: ['accounts'],
    description: 'Accounts staff dashboard: payment confirmations, invoices and receipts.',
    modules: ['Payment confirmations', 'Invoices', 'Receipts'], profile: { role: 'TEAM_HEAD', teamDivision: 'GENERAL' },
    expectedRole: 'accounts-staff', datasets: ['general', 'accounts'], availability: 'AVAILABLE' },
  { id: 'accounts-team-member', position: 'Accounts Team Member', category: 'ACCOUNTS', businessFunction: 'OTHER', departments: ['accounts'],
    description: 'Accounts staff dashboard: payment confirmations, invoices and receipts.',
    modules: ['Payment confirmations', 'Invoices', 'Receipts'], profile: { role: 'TEAM_MEMBER', teamDivision: 'GENERAL' },
    expectedRole: 'accounts-staff', datasets: ['general', 'accounts'], availability: 'AVAILABLE' },

  // ---- AI Studio ------------------------------------------------------------------------------------------------------------------------------
  { id: 'ai-studio-head', position: 'AI Studio Department Head', category: 'AI_STUDIO', businessFunction: 'OTHER', departments: ['ai-studio'],
    description: 'Projects, tasks across the teams, daily reports and approvals, deadlines and team performance.',
    modules: ['Overview', 'Projects', 'Tasks', 'Daily reports', 'Deadlines', 'Performance'], profile: { role: 'DEPARTMENT_HEAD' },
    expectedRole: 'ai-studio', datasets: ['general', 'ai-studio'], availability: 'AVAILABLE' },
  { id: 'ai-studio-lead', position: 'AI Studio Team Lead', category: 'AI_STUDIO', businessFunction: 'OTHER', departments: ['ai-studio'],
    description: 'Assigns project tasks, reviews daily reports and follows the team\'s workload.',
    modules: ['Overview', 'Projects', 'Tasks', 'Daily reports', 'Team'], profile: { role: 'TEAM_HEAD', teamDivision: 'GENERAL' },
    expectedRole: 'ai-studio', datasets: ['general', 'ai-studio'], availability: 'AVAILABLE' },
  { id: 'ai-studio-member', position: 'AI Studio Team Member', category: 'AI_STUDIO', businessFunction: 'OTHER', departments: ['ai-studio'],
    description: 'Their tasks, progress updates and the daily report.',
    modules: ['Overview', 'My tasks', 'Daily report'], profile: { role: 'TEAM_MEMBER', teamDivision: 'GENERAL' },
    expectedRole: 'ai-studio', datasets: ['general', 'ai-studio'], availability: 'AVAILABLE' },

  // ---- AI Design Studio -----------------------------------------------------------------------------------------------------------------------
  { id: 'design-studio-head', position: 'AI Design Studio Department Head', category: 'AI_DESIGN_STUDIO', businessFunction: 'OTHER', departments: ['ai-design-studio'],
    description: 'Clients, creative assignments, daily reports, issues and client notices.',
    modules: ['Overview', 'Clients', 'Assignments', 'Daily reports', 'Issues'], profile: { role: 'DEPARTMENT_HEAD' },
    expectedRole: 'design-studio', datasets: ['general', 'design-studio'], availability: 'AVAILABLE' },
  { id: 'design-studio-lead', position: 'AI Design Studio Team Lead', category: 'AI_DESIGN_STUDIO', businessFunction: 'OTHER', departments: ['ai-design-studio'],
    description: 'Gives creative work to the team and reviews it.',
    modules: ['Overview', 'Assignments', 'Daily reports', 'Issues'], profile: { role: 'TEAM_HEAD', teamDivision: 'GENERAL' },
    expectedRole: 'design-studio', datasets: ['general', 'design-studio'], availability: 'AVAILABLE' },
  { id: 'design-studio-member', position: 'AI Design Studio Team Member', category: 'AI_DESIGN_STUDIO', businessFunction: 'OTHER', departments: ['ai-design-studio'],
    description: 'Their creative assignments, status updates and daily report.',
    modules: ['Overview', 'My assignments', 'Daily report'], profile: { role: 'TEAM_MEMBER', teamDivision: 'GENERAL' },
    expectedRole: 'design-studio', datasets: ['general', 'design-studio'], availability: 'AVAILABLE' },

  // ---- International / Reseller (Sales and Support in one dashboard) ---------------------------------------------------------------------------
  { id: 'unified-head', position: 'Department Head (Sales and Support)', category: 'UNIFIED', businessFunction: 'OTHER', departments: UNIFIED_DEPARTMENTS,
    description: 'International / Reseller: Sales and Support in one dashboard for the Department Head.',
    modules: ['Overview', 'Sales leads', 'Support customers', 'Tickets', 'Tasks', 'Performance'], profile: { role: 'DEPARTMENT_HEAD' },
    expectedRole: 'unified', datasets: ['general', 'sales', 'support'], availability: 'AVAILABLE' },
  { id: 'unified-lead', position: 'Team Lead (Sales and Support)', category: 'UNIFIED', businessFunction: 'OTHER', departments: UNIFIED_DEPARTMENTS,
    description: 'International / Reseller: the Team Lead\'s Sales and Support pages in one dashboard.',
    modules: ['Overview', 'Sales leads', 'Support customers', 'Tickets', 'Tasks'], profile: { role: 'TEAM_HEAD', teamDivision: 'GENERAL' },
    expectedRole: 'unified', datasets: ['general', 'sales', 'support'], availability: 'AVAILABLE' },
  { id: 'unified-member', position: 'Team Member (Sales and Support)', category: 'UNIFIED', businessFunction: 'OTHER', departments: UNIFIED_DEPARTMENTS,
    description: 'International / Reseller: the Team Member\'s leads, customers and tickets in one dashboard.',
    modules: ['Overview', 'Leads', 'Customers', 'Tickets', 'Tasks'], profile: { role: 'TEAM_MEMBER', teamDivision: 'GENERAL' },
    expectedRole: 'unified', datasets: ['general', 'sales', 'support'], availability: 'AVAILABLE' },

  // ---- Other departments (a General team) --------------------------------------------------------------------------------------------------
  { id: 'general-team-lead', position: 'Team Lead (General team)', category: 'GENERAL', businessFunction: 'OTHER', departments: ['designstudio', 'edutraining', 'mpillar'],
    description: 'A Team Lead of a team that is neither Sales nor Support: the shared Team Lead dashboard.',
    modules: ['Overview', 'Team', 'Tasks', 'Daily reports'], profile: { role: 'TEAM_HEAD', teamDivision: 'GENERAL' },
    expectedRole: 'team-lead', datasets: ['general', 'support'], availability: 'AVAILABLE' },
  { id: 'general-team-member', position: 'Team Member (General team)', category: 'GENERAL', businessFunction: 'OTHER', departments: ['designstudio', 'edutraining', 'mpillar'],
    description: 'A Team Member of a team that is neither Sales nor Support: the shared Team Member dashboard.',
    modules: ['Overview', 'Tasks', 'Daily report'], profile: { role: 'TEAM_MEMBER', teamDivision: 'GENERAL' },
    expectedRole: 'team-member', datasets: ['general', 'support'], availability: 'AVAILABLE' }
];

export const DASHBOARD_IDS: readonly string[] = DASHBOARD_REGISTRY.map(d => d.id);
export const dashboardById = (id: string): DashboardEntry | undefined => DASHBOARD_REGISTRY.find(d => d.id === id);
export const departmentBySlug = (slug: string): PreviewDepartment | undefined => PREVIEW_DEPARTMENTS.find(d => d.slug === slug);

/** Demonstration scenarios: the same dashboard in a normal, empty or exceptional state (src/dashboard-preview/fixtures/scenarios.ts). */
export const PREVIEW_SCENARIOS = [
  { id: 'normal', label: 'Normal working day' },
  { id: 'new-account', label: 'Newly created employee account' },
  { id: 'empty', label: 'Empty dashboard' },
  { id: 'pending-approvals', label: 'Pending approvals' },
  { id: 'overdue', label: 'Overdue tasks' },
  { id: 'high-volume', label: 'High-volume Sales pipeline' },
  { id: 'escalations', label: 'Multiple Support escalations' },
  { id: 'on-leave', label: 'Employee on leave' },
  { id: 'target-achieved', label: 'Monthly target achieved' },
  { id: 'no-team', label: 'No assigned team' }
] as const;
export type PreviewScenarioId = (typeof PREVIEW_SCENARIOS)[number]['id'];
export const PREVIEW_SCENARIO_IDS = PREVIEW_SCENARIOS.map(s => s.id) as unknown as readonly [PreviewScenarioId, ...PreviewScenarioId[]];

export const PREVIEW_VIEWPORTS = { desktop: { label: 'Desktop', width: null }, tablet: { label: 'Tablet', width: 820 }, mobile: { label: 'Mobile', width: 390 } } as const;
export type PreviewViewport = keyof typeof PREVIEW_VIEWPORTS;

// ---- The preview frame's messages (parent <-> sandboxed frame). Anything else is ignored on both sides. ----------------------------------
export const previewLaunchSchema = z.object({
  dashboardId: z.string().refine(id => DASHBOARD_IDS.includes(id), 'Unknown dashboard'),
  department: z.string().refine(s => PREVIEW_DEPARTMENTS.some(d => d.slug === s), 'Unknown department'),
  scenario: z.enum(PREVIEW_SCENARIO_IDS),
  /** a new number resets the demonstration state */
  epoch: z.number().int().nonnegative()
});
export type PreviewLaunch = z.infer<typeof previewLaunchSchema>;
export const parentToFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('crm-preview:launch'), launch: previewLaunchSchema })
]);
export const frameToParentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('crm-preview:ready') }),
  z.object({ type: z.literal('crm-preview:page'), path: z.string().max(300), title: z.string().max(200) }),
  z.object({ type: z.literal('crm-preview:demo-action'), message: z.string().max(300) }),
  z.object({ type: z.literal('crm-preview:unavailable'), what: z.string().max(300) }),
  z.object({ type: z.literal('crm-preview:exit') })
]);
export type FrameToParent = z.infer<typeof frameToParentSchema>;
export const DEMO_ACTION_MESSAGE = 'Demo action completed. No live CRM data has been changed.';

// ---- Server payloads (validated again by the database) -----------------------------------------------------------------------------------
export const previewSessionSchema = z.object({
  dashboardId: z.string().refine(id => DASHBOARD_IDS.includes(id), 'Choose a dashboard from the list.'),
  department: z.string().refine(s => PREVIEW_DEPARTMENTS.some(d => d.slug === s), 'Choose a department from the list.'),
  scenario: z.enum(PREVIEW_SCENARIO_IDS).default('normal')
});
export const previewSessionEndSchema = z.object({ sessionId: z.string().uuid() });
export const IMPROVEMENT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const improvementRequestSchema = z.object({
  dashboardId: z.string().refine(id => DASHBOARD_IDS.includes(id), 'Choose a dashboard from the list.'),
  department: z.string().refine(s => PREVIEW_DEPARTMENTS.some(d => d.slug === s), 'Choose a department from the list.'),
  page: z.string().trim().max(300).default(''),
  pageTitle: z.string().trim().max(200).default(''),
  viewport: z.enum(['desktop', 'tablet', 'mobile']),
  build: z.string().trim().max(80).default(''),
  title: z.string().trim().min(3, 'Give the improvement a title (3-200 characters).').max(200, 'Give the improvement a title (3-200 characters).'),
  description: z.string().trim().min(10, 'Describe the improvement (10-5000 characters).').max(5000, 'Describe the improvement (10-5000 characters).'),
  expected: z.string().trim().max(3000, 'The expected behaviour can have at most 3000 characters.').default(''),
  priority: z.enum(IMPROVEMENT_PRIORITIES),
  attachmentIds: z.array(z.string().uuid()).max(5).default([]),
  clientRequestId: z.string().min(8).max(80)
});
export type ImprovementRequestInput = z.input<typeof improvementRequestSchema>;
