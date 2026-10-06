import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Profile } from '../../shared/contracts';
import { AuthUser, DepartmentId, UserSession, Department } from '../types/crm';
import { sessionManager } from '../services/sessionManager';
import { useDepartments } from './DepartmentContext';
import { attendanceStore } from '../services/attendanceStore';
import { getSupabase } from '../services/supabaseClient';
import { meApi } from '../lib/api/endpoints';
import { errorMessage } from '../lib/api/client';
import { toAuthUser } from '../lib/auth/roleMapping';
import { purgeInsecureLegacyKeys } from '../lib/legacyStorage';

/**
 * Authentication is Supabase Auth; identity, role and account status come
 * from the `profiles` table via GET /api/v1/me. Nothing about the user is
 * stored in or trusted from localStorage (Supabase persists only its own
 * session token).
 */

export interface AuthResult {
  ok: boolean;
  message?: string;
}

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
  departmentId: string;
  teamId?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  authLoading: boolean;
  /** Shown on the login screen, e.g. "Your account is awaiting approval." */
  accountNotice: string | null;
  activeDepartmentId: DepartmentId | null;
  currentSession: UserSession | null;
  activeDepartment: Department | null;

  // Eviction modal states (multi-tab session limiter, UI only)
  isEvictionModalOpen: boolean;
  pendingDepartment: Department | null;
  conflictingSessions: UserSession[];
  evictedNotice: string | null;

  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult & { needsEmailConfirmation?: boolean }>;
  loginWithGoogle: () => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  clearAccountNotice: () => void;
  selectDepartment: (departmentId: DepartmentId) => boolean;
  resetDepartmentSelection: () => void;
  confirmEviction: (evictSessionId: string) => void;
  closeEvictionModal: () => void;
  clearEvictedNotice: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STATUS_NOTICES: Record<string, string> = {
  PENDING: '⏳ Your account is awaiting approval from your Team Head or Department Head. You will be able to sign in once it is approved.',
  SUSPENDED: '⏸️ Your account has been suspended. Contact your manager.',
  REVOKED: '🚫 Your access has been revoked by management.',
  REJECTED: '❌ Your registration request was declined.'
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getDepartment } = useDepartments();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [activeDepartmentId, setActiveDepartmentId] = useState<DepartmentId | null>(null);
  const [currentSession, setCurrentSession] = useState<UserSession | null>(null);
  const loadedUserId = useRef<string | null>(null);

  const [isEvictionModalOpen, setIsEvictionModalOpen] = useState(false);
  const [pendingDepartment, setPendingDepartment] = useState<Department | null>(null);
  const [conflictingSessions, setConflictingSessions] = useState<UserSession[]>([]);
  const [evictedNotice, setEvictedNotice] = useState<string | null>(null);

  const activeDepartment = (activeDepartmentId && getDepartment(activeDepartmentId)) || null;

  const clearState = useCallback(() => {
    loadedUserId.current = null;
    setProfile(null);
    setUser(null);
    setActiveDepartmentId(null);
    setCurrentSession(null);
  }, []);

  /** Load the trusted profile. Non-active accounts are signed out with a notice. */
  const loadProfile = useCallback(async (): Promise<AuthResult & { profile?: Profile }> => {
    try {
      const me = await meApi.get();
      if (me.status !== 'ACTIVE') {
        await getSupabase()?.auth.signOut();
        clearState();
        const message = STATUS_NOTICES[me.status] || 'Your account is not active.';
        setAccountNotice(message);
        return { ok: false, message };
      }
      loadedUserId.current = me.id;
      setProfile(me);
      setUser(toAuthUser(me));
      setAccountNotice(null);
      return { ok: true, profile: me };
    } catch (err) {
      clearState();
      return { ok: false, message: errorMessage(err) };
    }
  }, [clearState]);

  // Session bootstrap + auth state changes (sign-in in another tab, token refresh, sign-out)
  useEffect(() => {
    purgeInsecureLegacyKeys();
    const supabase = getSupabase();
    if (!supabase) {
      setAuthLoading(false);
      setAccountNotice('The CRM is not connected to its database. Ask an administrator to configure Supabase.');
      return;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) await loadProfile();
      setAuthLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Defer: calling Supabase from inside this callback can deadlock the auth client.
      setTimeout(() => {
        if (event === 'SIGNED_OUT' || !session) {
          clearState();
        } else if (session.user.id !== loadedUserId.current && event !== 'INITIAL_SESSION') {
          void loadProfile();
        }
      }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile, clearState]);

  // API signals: session expired / account deactivated while using the app
  useEffect(() => {
    const onUnauthenticated = () => void getSupabase()?.auth.signOut();
    const onInactive = () => void loadProfile();
    window.addEventListener('crm:unauthenticated', onUnauthenticated);
    window.addEventListener('crm:account-inactive', onInactive);
    return () => {
      window.removeEventListener('crm:unauthenticated', onUnauthenticated);
      window.removeEventListener('crm:account-inactive', onInactive);
    };
  }, [loadProfile]);

  // Cross-tab session eviction (UI session limiter)
  useEffect(() => {
    const unsubscribe = sessionManager.onSessionEvent(msg => {
      if (msg.type === 'EVICT_SESSION' && currentSession && msg.evictedSessionId === currentSession.sessionId) {
        setCurrentSession(null);
        setActiveDepartmentId(null);
        setEvictedNotice(`Your active session in ${msg.departmentId.toUpperCase()} was terminated by ${msg.newUserName} (Security Limit: Max 2 Users).`);
      }
    });
    return () => unsubscribe();
  }, [currentSession]);

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: 'The CRM is not connected to its database.' };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      return { ok: false, message: /confirm/i.test(error.message) ? 'Please confirm your e-mail address first.' : 'Invalid email or password.' };
    }
    const { profile: me, ...result } = await loadProfile();
    if (me) {
      // TODO(db-migration): HR attendance is still a browser-local register.
      attendanceStore.recordMemberLogin({
        empId: me.id,
        name: me.fullName,
        email: me.email,
        role: me.position || me.role.replace('_', ' '),
        department: me.department?.name || 'Amuwa Corporation',
        avatar: me.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        authMethod: 'Supabase Auth (Email & Password)',
        device: 'CRM Web Client'
      });
    }
    return result;
  };

  const signUp = async (input: SignUpInput) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: 'The CRM is not connected to its database.' };
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      options: {
        emailRedirectTo: window.location.origin,
        // Only descriptive data: the database ignores any role and always
        // creates a PENDING team member awaiting approval.
        data: { full_name: input.fullName.trim(), department_id: input.departmentId, team_id: input.teamId }
      }
    });
    if (error) {
      return { ok: false, message: /registered|exists/i.test(error.message) ? 'An account with this e-mail already exists.' : 'Registration failed. Please try again.' };
    }
    // A pending account must not stay signed in.
    if (data.session) await supabase.auth.signOut();
    return { ok: true, needsEmailConfirmation: !data.session };
  };

  const loginWithGoogle = async (): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, message: 'The CRM is not connected to its database.' };
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    return error ? { ok: false, message: 'Google sign-in is not available.' } : { ok: true };
  };

  const logout = async () => {
    if (currentSession && activeDepartmentId) {
      sessionManager.leaveSession(currentSession.sessionId, activeDepartmentId);
    }
    clearState();
    await getSupabase()?.auth.signOut();
  };

  const resetDepartmentSelection = () => {
    if (currentSession && activeDepartmentId) {
      sessionManager.leaveSession(currentSession.sessionId, activeDepartmentId);
    }
    setActiveDepartmentId(null);
    setCurrentSession(null);
  };

  /**
   * Navigation into a department workspace. Super Admins may open any
   * unlocked department; department heads only their own. (The data inside
   * is independently scoped by RLS.)
   */
  const selectDepartment = (departmentId: DepartmentId): boolean => {
    if (!user) return false;
    const dept = getDepartment(departmentId);
    if (!dept || dept.locked) return false;
    if (user.role !== 'superadmin' && user.departmentId !== departmentId) return false;

    setActiveDepartmentId(departmentId);
    try {
      const res = sessionManager.registerSession(user, departmentId);
      if (res.session) setCurrentSession(res.session);
    } catch {
      /* session limiter is best-effort UI state */
    }
    return true;
  };

  const confirmEviction = (evictSessionId: string) => {
    if (!user || !pendingDepartment) return;
    const newSession = sessionManager.evictAndClaimSession(evictSessionId, user, pendingDepartment.id);
    setActiveDepartmentId(pendingDepartment.id);
    setCurrentSession(newSession);
    setIsEvictionModalOpen(false);
    setPendingDepartment(null);
    setConflictingSessions([]);
  };

  const closeEvictionModal = () => {
    setIsEvictionModalOpen(false);
    setPendingDepartment(null);
    setConflictingSessions([]);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authLoading,
        accountNotice,
        activeDepartmentId,
        currentSession,
        activeDepartment,
        isEvictionModalOpen,
        pendingDepartment,
        conflictingSessions,
        evictedNotice,
        signIn,
        signUp,
        loginWithGoogle,
        refreshProfile: async () => {
          await loadProfile();
        },
        logout,
        clearAccountNotice: () => setAccountNotice(null),
        selectDepartment,
        resetDepartmentSelection,
        confirmEviction,
        closeEvictionModal,
        clearEvictedNotice: () => setEvictedNotice(null)
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
