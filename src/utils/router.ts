import { AuthUser } from '../types/crm';

export interface ParsedRoute {
  path: string;
  type: 'team-member' | 'support-member' | 'team-lead' | 'support-lead' | 'accounts-staff' | 'technical-support' | 'meta-verifier' | 'telecaller' | 'hr-recruiter' | 'hr-department' | 'business-associate' | 'sales-role' | 'sales-head' | 'ai-studio' | 'design-studio' | 'unified' | 'admin' | 'department-hub' | 'login' | 'unknown';
  paramId?: string; // memberId or deptId
}

export const parseCurrentRoute = (): ParsedRoute => {
  if (typeof window === 'undefined') {
    return { path: '/', type: 'login' };
  }

  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  // 1. /team-member/dashboard/:memberId
  const tmMatch = path.match(/^\/team-member\/dashboard\/([^/]+)$/);
  if (tmMatch) {
    return {
      path,
      type: 'team-member',
      paramId: tmMatch[1]
    };
  }

  // 1a. /support-member/dashboard/:memberId[/:page]
  const smMatch = path.match(/^\/support-member\/dashboard\/([^/]+)(?:\/[^/]+)?$/);
  if (smMatch) {
    return {
      path,
      type: 'support-member',
      paramId: smMatch[1]
    };
  }

  // 1a2. /support-lead/dashboard/:leadId[/:page] - Support Team Lead only
  const slMatch = path.match(/^\/support-lead\/dashboard\/([^/]+)(?:\/[^/]+)?$/);
  if (slMatch) {
    return {
      path,
      type: 'support-lead',
      paramId: slMatch[1]
    };
  }

  // 1a2-ads. /ai-design-studio/dashboard/:id[/:page] - AI Design Studio staff only (its Department Head, Team Leads and Team Members)
  const adsMatch = path.match(/^\/ai-design-studio\/dashboard\/([^/]+)(?:\/[^/]+(?:\/[^/]+)?)?$/);
  if (adsMatch) {
    return { path, type: 'design-studio', paramId: adsMatch[1] };
  }

  // 1a2a. /hr-recruiter/dashboard/:id[/:page[/:recordId]] - HR Recruiters only
  const hrrMatch = path.match(/^\/hr-recruiter\/dashboard\/([^/]+)(?:\/[^/]+){0,2}$/);
  if (hrrMatch) {
    return { path, type: 'hr-recruiter', paramId: hrrMatch[1] };
  }

  // 1a2a2. /hr-department/dashboard/:id[/:page] - a department's own HR (e.g. HR (Digitree)) only
  const hrdMatch = path.match(/^\/hr-department\/dashboard\/([^/]+)(?:\/[^/]+)?$/);
  if (hrdMatch) {
    return { path, type: 'hr-department', paramId: hrdMatch[1] };
  }

  // 1a2b. /telecaller/dashboard/:id[/:page] - Sales Telecallers only
  const tcMatch = path.match(/^\/telecaller\/dashboard\/([^/]+)(?:\/[^/]+)?$/);
  if (tcMatch) {
    return {
      path,
      type: 'telecaller',
      paramId: tcMatch[1]
    };
  }

  // 1a2b2. /business-associate/dashboard/:id[/:page] - Sales Business Associates only
  const baMatch = path.match(/^\/business-associate\/dashboard\/([^/]+)(?:\/[^/]+)?$/);
  if (baMatch) {
    return {
      path,
      type: 'business-associate',
      paramId: baMatch[1]
    };
  }

  // 1a2b3. /sales-head/dashboard/:id[/:page] - the Sales Department Head only
  const shMatch = path.match(/^\/sales-head\/dashboard\/([^/]+)(?:\/[^/]+(?:\/[^/]+)?)?$/);
  if (shMatch) {
    return {
      path,
      type: 'sales-head',
      paramId: shMatch[1]
    };
  }

  // 1a2b4. /ai-studio/dashboard/:id[/:page] - AI Studio employees only
  const aiMatch = path.match(/^\/ai-studio\/dashboard\/([^/]+)(?:\/[^/]+)?$/);
  if (aiMatch) {
    return { path, type: 'ai-studio', paramId: aiMatch[1] };
  }

  // 1a2b5. /unified/dashboard/:id[/:page[/:sub]] - International / Reseller employees only (Sales and Support in one dashboard)
  const unifiedMatch = path.match(/^\/unified\/dashboard\/([^/]+)(?:\/[^/]+){0,2}$/);
  if (unifiedMatch) {
    return { path, type: 'unified', paramId: unifiedMatch[1] };
  }

  // 1a2c. /sales-role/:id - a Sales role whose dashboard is not set up yet
  const srMatch = path.match(/^\/sales-role\/([^/]+)$/);
  if (srMatch) {
    return {
      path,
      type: 'sales-role',
      paramId: srMatch[1]
    };
  }

  // 1a3. /accounts/dashboard/:id - Accounts department staff only
  const acMatch = path.match(/^\/accounts\/dashboard\/([^/]+)$/);
  if (acMatch) {
    return {
      path,
      type: 'accounts-staff',
      paramId: acMatch[1]
    };
  }

  // 1b. /team-lead/dashboard/:leadId or /team-lead/dashboard (Sales Team Lead)
  const tlMatch = path.match(/^\/team-lead\/dashboard(?:\/([^/]+))?$/);
  if (tlMatch) {
    return {
      path,
      type: 'team-lead',
      paramId: tlMatch[1] || 'tl-vikram'
    };
  }

  // 1c-bis. /meta-verifier/dashboard
  if (path === '/meta-verifier/dashboard' || path.startsWith('/meta-verifier')) {
    return {
      path,
      type: 'meta-verifier'
    };
  }

  // 1c. /technical-support/dashboard or /technical-support
  if (path === '/technical-support/dashboard' || path.startsWith('/technical-support')) {
    return {
      path,
      type: 'technical-support'
    };
  }

  // 2. /admin/dashboard/:deptId
  const adminMatch = path.match(/^\/admin\/dashboard\/([^/]+)$/);
  if (adminMatch) {
    return {
      path,
      type: 'admin',
      paramId: adminMatch[1]
    };
  }

  // 3. /department-hub
  if (path === '/department-hub') {
    return {
      path,
      type: 'department-hub'
    };
  }

  // 4. Root or login
  if (path === '/' || path === '/login') {
    return {
      path,
      type: 'login'
    };
  }

  return {
    path,
    type: 'unknown'
  };
};

export const getRedirectForRole = (user: AuthUser | null): string => {
  if (!user) return '/login';

  switch (user.role) {
    case 'technical-support':
      return '/technical-support/dashboard';
    case 'meta-verifier':
      return '/meta-verifier/dashboard';
    case 'team-member':
      return `/team-member/dashboard/${user.id}`;
    case 'support-member':
      return `/support-member/dashboard/${user.id}`;
    case 'team-lead':
      return `/team-lead/dashboard/${user.id}`;
    case 'support-lead':
      return `/support-lead/dashboard/${user.id}`;
    case 'hr-recruiter':
      return `/hr-recruiter/dashboard/${user.id}`;
    case 'hr-department':
      return `/hr-department/dashboard/${user.id}`;
    case 'design-studio':
      return `/ai-design-studio/dashboard/${user.id}`;
    case 'telecaller':
      return `/telecaller/dashboard/${user.id}`;
    case 'business-associate':
      return `/business-associate/dashboard/${user.id}`;
    case 'sales-role':
      return `/sales-role/${user.id}`;
    case 'sales-head':
      return `/sales-head/dashboard/${user.id}`;
    case 'ai-studio':
      return `/ai-studio/dashboard/${user.id}`;
    case 'unified':
      return `/unified/dashboard/${user.id}`;
    case 'accounts-staff':
      return `/accounts/dashboard/${user.id}`;
    case 'admin':
      return `/admin/dashboard/${user.departmentId || 'wabastore'}`;
    case 'superadmin':
    default:
      return '/department-hub';
  }
};

// The last dashboard address of this browser. The installed app always opens at "/", and a person's dashboard address holds their own id
// (/ai-studio/dashboard/<id>/projects), so one entry is enough: another person's address never matches their dashboard.
const LAST_PATH_KEY = 'amuwa.lastPath';

export const rememberPath = (userId: string) => {
  try {
    const path = window.location.pathname;
    if (path.includes(userId)) window.localStorage.setItem(LAST_PATH_KEY, path);
  } catch {
    /* private window: the page is just not remembered */
  }
};

export const forgetLastPath = () => {
  try {
    window.localStorage.removeItem(LAST_PATH_KEY);
  } catch {
    /* nothing to forget */
  }
};

/** The page the person was last on inside their dashboard (`base`), or null when there is none to return to. */
export const lastPathUnder = (base: string): string | null => {
  try {
    const last = window.localStorage.getItem(LAST_PATH_KEY);
    return last && (last === base || last.startsWith(`${base}/`)) ? last : null;
  } catch {
    return null;
  }
};

export const navigateTo = (url: string) => {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== url) {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
};

// Route Security Guard
export const validateRouteAccess = (
  user: AuthUser | null,
  route: ParsedRoute
): { allowed: boolean; redirectTo?: string } => {
  // If user is not logged in:
  if (!user) {
    return { allowed: false, redirectTo: '/login' };
  }

  // If user is a meta-verifier:
  if (user.role === 'meta-verifier') {
    if (route.type === 'meta-verifier') {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: '/meta-verifier/dashboard' };
  }

  // If user is technical-support:
  if (user.role === 'technical-support') {
    if (route.type === 'technical-support') {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: '/technical-support/dashboard' };
  }

  // If user is team-member:
  if (user.role === 'team-member') {
    if (route.type === 'team-member') {
      if (route.paramId && route.paramId !== user.id) {
        return { allowed: false, redirectTo: `/team-member/dashboard/${user.id}` };
      }
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/team-member/dashboard/${user.id}` };
  }

  // If user is a Support team member:
  if (user.role === 'support-member') {
    if (route.type === 'support-member') {
      if (route.paramId && route.paramId !== user.id) {
        return { allowed: false, redirectTo: `/support-member/dashboard/${user.id}` };
      }
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/support-member/dashboard/${user.id}` };
  }

  // If user is team-lead:
  if (user.role === 'team-lead') {
    if (route.type === 'team-lead') {
      if (route.paramId && route.paramId !== user.id) {
        return { allowed: false, redirectTo: `/team-lead/dashboard/${user.id}` };
      }
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/team-lead/dashboard/${user.id}` };
  }

  // If user is a Support Team Lead: only their own Support dashboard (never the
  // Sales Team Lead route, and no other lead's id).
  if (user.role === 'support-lead') {
    if (route.type === 'support-lead' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/support-lead/dashboard/${user.id}` };
  }

  // AI Design Studio staff open only their own AI Design Studio dashboard (never another department's, or another person's).
  if (user.role === 'design-studio') {
    if (route.type === 'design-studio' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/ai-design-studio/dashboard/${user.id}` };
  }

  // An HR Recruiter opens only their own Recruiter dashboard (never the HR dashboard, another recruiter's, or any other role's).
  if (user.role === 'hr-recruiter') {
    if (route.type === 'hr-recruiter' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/hr-recruiter/dashboard/${user.id}` };
  }

  // A department's HR (e.g. HR (Digitree)) opens only their own department HR dashboard: no other HR dashboard, department or person.
  if (user.role === 'hr-department') {
    if (route.type === 'hr-department' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/hr-department/dashboard/${user.id}` };
  }

  // A Telecaller opens only their own Telecaller dashboard (never a Sales member's or anyone else's).
  if (user.role === 'telecaller') {
    if (route.type === 'telecaller' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/telecaller/dashboard/${user.id}` };
  }

  // A Business Associate opens only their own dashboard.
  if (user.role === 'business-associate') {
    if (route.type === 'business-associate' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/business-associate/dashboard/${user.id}` };
  }

  // The Sales Department Head opens only the Sales Department Head dashboard.
  if (user.role === 'sales-head') {
    if (route.type === 'sales-head' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/sales-head/dashboard/${user.id}` };
  }

  // AI Studio employees open only their own AI Studio dashboard.
  if (user.role === 'ai-studio') {
    if (route.type === 'ai-studio' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/ai-studio/dashboard/${user.id}` };
  }

  // International / Reseller employees open only their own unified dashboard.
  if (user.role === 'unified') {
    if (route.type === 'unified' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/unified/dashboard/${user.id}` };
  }

  // A Sales role without a dashboard yet sees the notice page, and nothing else.
  if (user.role === 'sales-role') {
    if (route.type === 'sales-role' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/sales-role/${user.id}` };
  }

  // If user is Accounts staff: only their own Accounts dashboard.
  if (user.role === 'accounts-staff') {
    if (route.type === 'accounts-staff' && route.paramId === user.id) {
      return { allowed: true };
    }
    return { allowed: false, redirectTo: `/accounts/dashboard/${user.id}` };
  }

  // HR staff: the Recruitment Portal (the HR Recruiter workspace) only for an HR Assistant, at their own address. The database decides every record.
  if (user.role === 'hr' && route.type === 'hr-recruiter') {
    if (route.paramId === user.id && user.profile?.hrSubRole === 'HR_ASSISTANT') return { allowed: true };
    return { allowed: false, redirectTo: `/admin/dashboard/${user.departmentId || 'hr'}` };
  }

  // If user is admin:
  if (user.role === 'admin') {
    if (route.type === 'team-member' || route.type === 'support-member' || route.type === 'team-lead' || route.type === 'support-lead' || route.type === 'accounts-staff' || route.type === 'telecaller' || route.type === 'hr-recruiter' || route.type === 'business-associate' || route.type === 'sales-role' || route.type === 'sales-head' || route.type === 'ai-studio' || route.type === 'design-studio' || route.type === 'unified') {
      return { allowed: false, redirectTo: `/admin/dashboard/${user.departmentId || 'wabastore'}` };
    }
    return { allowed: true };
  }

  // If user is superadmin:
  if (user.role === 'superadmin') {
    // AI Design Studio has no Super Admin workspace (its people create and manage their own work); only AI Studio and the other departments open
    if (route.type === 'admin' && route.paramId === 'ai-design-studio') return { allowed: false, redirectTo: '/department-hub' };
    return { allowed: true };
  }

  return { allowed: true };
};
