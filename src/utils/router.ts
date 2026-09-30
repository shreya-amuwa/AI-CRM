import { AuthUser } from '../types/crm';

export interface ParsedRoute {
  path: string;
  type: 'team-member' | 'team-lead' | 'admin' | 'department-hub' | 'login' | 'unknown';
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

  // 1b. /team-lead/dashboard/:leadId or /team-lead/dashboard
  const tlMatch = path.match(/^\/team-lead\/dashboard(?:\/([^/]+))?$/);
  if (tlMatch) {
    return {
      path,
      type: 'team-lead',
      paramId: tlMatch[1] || 'tl-vikram'
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
    case 'team-member':
      return `/team-member/dashboard/${user.id}`;
    case 'team-lead':
      return `/team-lead/dashboard/${user.id}`;
    case 'admin':
      return `/admin/dashboard/${user.departmentId || 'wabastore'}`;
    case 'superadmin':
    default:
      return '/department-hub';
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

  // If user is admin:
  if (user.role === 'admin') {
    if (route.type === 'team-member' || route.type === 'team-lead') {
      return { allowed: false, redirectTo: `/admin/dashboard/${user.departmentId || 'wabastore'}` };
    }
    return { allowed: true };
  }

  // If user is superadmin:
  if (user.role === 'superadmin') {
    return { allowed: true };
  }

  return { allowed: true };
};
