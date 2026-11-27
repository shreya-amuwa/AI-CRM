import React, { createContext, useContext, useMemo, useState } from 'react';
import type { AuthContextType, AuthResult, SignUpInput } from '../../context/AuthContext';
import type { HeadDivision, MyDepartmentScopes, Profile } from '../../../shared/contracts';
import type { DepartmentId } from '../../types/crm';
import { useDepartments } from '../../context/DepartmentContext';
import { toAuthUser } from '../../lib/auth/roleMapping';
import { applyScope, choosableDivisions, hasSeveralDepartments, normaliseScope, NO_SCOPE, requestScopeFor, setRequestScope, type ActiveScope } from '../../lib/scope/activeScope';
import { postToParent } from './bridge';

/**
 * Replaces src/context/AuthContext.tsx in the preview bundle (vite.preview.config.ts). The dashboards see the SYNTHETIC preview identity
 * through the same useAuth() they use in production, so the production role mapping (toAuthUser) and App routing pick the dashboard.
 * What the production provider does and this one never does: read a Supabase session, call /me, record the sign-in time (RM login),
 * record a sign-out, register a tab in the session limiter, unsubscribe push. Signing out asks Dashboard Explorer to end the preview.
 * The value type is the production one (AuthContextType), so a new field there fails the type check here until the preview provides it.
 */
export type { AuthResult, SignUpInput };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Set by main.tsx before the first render of each preview. */
let identity: { profile: Profile; scopes: MyDepartmentScopes | null } | null = null;
export function setPreviewIdentity(next: { profile: Profile; scopes: MyDepartmentScopes | null }): void {
  identity = next;
}

const notInPreview = async (): Promise<AuthResult> => ({ ok: false, message: 'Signing in is not available in the demonstration.' });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getDepartment, departments } = useDepartments();
  // as in production, there is no profile until the departments are loaded (the HR head then opens their department straight away)
  const ready = departments.length > 0;
  const rawProfile = ready ? identity?.profile ?? null : null;
  const scopes = ready ? identity?.scopes ?? null : null;
  const [scope, setScope] = useState<ActiveScope>(NO_SCOPE);
  const [scopeChosen, setScopeChosen] = useState(false);
  const [activeDepartmentId, setActiveDepartmentId] = useState<DepartmentId | null>(null);

  const profile = useMemo(() => applyScope(rawProfile, scopes, scope), [rawProfile, scopes, scope]);
  const user = useMemo(() => (profile ? toAuthUser(profile) : null), [profile]);
  setRequestScope(requestScopeFor(scopes, scope));

  const applyChoice = (next: ActiveScope) => {
    setScope(normaliseScope(scopes, next));
    setScopeChosen(true);
  };
  const selectDepartment = (departmentId: DepartmentId): boolean => {
    if (!user || !getDepartment(departmentId)) return false;
    if (user.departmentId !== departmentId) return false;
    setActiveDepartmentId(departmentId);
    return true;
  };
  const endPreview = async () => { postToParent({ type: 'crm-preview:exit' }); };

  const value: AuthContextType = {
    user,
    profile,
    scopes,
    scope,
    needsDepartmentChoice: !!rawProfile && hasSeveralDepartments(scopes) && !scopeChosen,
    scopeKey: `${scope.departmentId ?? ''}:${scope.division ?? ''}`,
    chooseDepartment: (departmentId: string) => applyChoice({ departmentId, division: scope.division }),
    chooseDivision: (division: HeadDivision) => {
      if (choosableDivisions(scopes, scope.departmentId).includes(division)) applyChoice({ departmentId: scope.departmentId, division });
    },
    authLoading: !ready,
    connectionProblem: false,
    retryConnection: async () => undefined,
    accountNotice: null,
    activeDepartmentId,
    currentSession: null,
    activeDepartment: (activeDepartmentId && getDepartment(activeDepartmentId)) || null,
    isEvictionModalOpen: false,
    pendingDepartment: null,
    conflictingSessions: [],
    evictedNotice: null,
    signIn: notInPreview,
    signUp: notInPreview,
    loginWithGoogle: notInPreview,
    refreshProfile: async () => undefined,
    logout: endPreview,
    clearAccountNotice: () => undefined,
    selectDepartment,
    resetDepartmentSelection: () => setActiveDepartmentId(null),
    confirmEviction: () => undefined,
    closeEvictionModal: () => undefined,
    clearEvictedNotice: () => undefined
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
