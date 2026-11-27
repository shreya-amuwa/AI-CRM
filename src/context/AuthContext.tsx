import { unsubscribeThisDevice } from '../lib/push/pushSupport';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { HeadDivision, MyDepartmentScopes, Profile } from '../../shared/contracts';
import { AuthUser, DepartmentId, UserSession, Department } from '../types/crm';
import { sessionManager } from '../services/sessionManager';
import { useDepartments } from './DepartmentContext';
import { getSupabase } from '../services/supabaseClient';
import { hrApi, meApi, signInReportApi } from '../lib/api/endpoints';
import { officeToday } from '../lib/officeTime';
import { errorMessage } from '../lib/api/client';
import { isTransient } from '../lib/auth/transientError';
import { forgetRememberedPages } from '../lib/rememberedPage';
import { forgetLastPath } from '../utils/router';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { toAuthUser } from '../lib/auth/roleMapping';
import { purgeInsecureLegacyKeys } from '../lib/legacyStorage';
import {
  applyScope, choosableDivisions, hasSeveralDepartments, normaliseScope, NO_SCOPE, readChosen, readStoredScope, requestScopeFor, setRequestScope, storeChosen, storeScope,
  type ActiveScope
} from '../lib/scope/activeScope';

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

export interface AuthContextType {
  user: AuthUser | null;
  /** The profile the dashboards see: for a Department Head with several scopes, the department and function they are working in. */
  profile: Profile | null;
  /** The departments and functions the Department Head is authorised for (null for everybody else, and until loaded). */
  scopes: MyDepartmentScopes | null;
  /** The department and function the head works in now (the database applies it only if authorised). */
  scope: ActiveScope;
  /** More than one department is authorised and the head has not chosen one yet in this browser session: show the department cards. */
  needsDepartmentChoice: boolean;
  /** Changes whenever the scope changes: dashboards use it as a React key so every list and count is read again. */
  scopeKey: string;
  chooseDepartment: (departmentId: string) => void;
  chooseDivision: (division: HeadDivision) => void;
  authLoading: boolean;
  /** The CRM could not be reached while the person IS signed in (the server is busy or the network is down): the session is kept, nobody is signed out. */
  connectionProblem: boolean;
  retryConnection: () => Promise<void>;
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

/**
 * A customer (not staff) who signs in on the staff page belongs on their own dashboard.
 * The check is the database's own `client_me()`, which only a client login passes.
 */
async function sendClientToDashboard(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  // Only a client login carries client_customer_id (set with the service key when the login is made). Staff are never asked, so a staff
  // page load makes no refused (403) client_me call.
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user?.app_metadata?.client_customer_id) return false;
  const { error } = await supabase.rpc('client_me');
  if (error) return false;
  window.location.assign('/client/dashboard/overview');
  return true;
}

const RETRY_DELAYS_MS = [1500, 4000, 9000];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getDepartment } = useDepartments();

  const [rawProfile, setRawProfile] = useState<Profile | null>(null);
  const [scopes, setScopes] = useState<MyDepartmentScopes | null>(null);
  const [scope, setScope] = useState<ActiveScope>(NO_SCOPE);
  const [scopeChosen, setScopeChosen] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [connectionProblem, setConnectionProblemState] = useState(false);
  const connectionProblemRef = useRef(false);
  const setConnectionProblem = useCallback((v: boolean) => { connectionProblemRef.current = v; setConnectionProblemState(v); }, []);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [activeDepartmentId, setActiveDepartmentId] = useState<DepartmentId | null>(null);
  const [currentSession, setCurrentSession] = useState<UserSession | null>(null);
  const loadedUserId = useRef<string | null>(null);
  const lastRenewal = useRef(0);

  const [isEvictionModalOpen, setIsEvictionModalOpen] = useState(false);
  const [pendingDepartment, setPendingDepartment] = useState<Department | null>(null);
  const [conflictingSessions, setConflictingSessions] = useState<UserSession[]>([]);
  const [evictedNotice, setEvictedNotice] = useState<string | null>(null);

  const activeDepartment = (activeDepartmentId && getDepartment(activeDepartmentId)) || null;

  // The profile and the dashboard the head sees follow the active scope. The request headers are set while rendering (before any child
  // asks for data), so the first request after a switch already carries the new department / function.
  const profile = useMemo(() => applyScope(rawProfile, scopes, scope), [rawProfile, scopes, scope]);
  const user = useMemo(() => (profile ? toAuthUser(profile) : null), [profile]);
  setRequestScope(requestScopeFor(scopes, scope));

  const clearState = useCallback(() => {
    loadedUserId.current = null;
    setConnectionProblem(false);
    setRawProfile(null);
    setScopes(null);
    setScope(NO_SCOPE);
    setScopeChosen(false);
    setRequestScope(NO_SCOPE);
    setActiveDepartmentId(null);
    setCurrentSession(null);
  }, [setConnectionProblem]);

  /** Load the trusted profile. Non-active accounts are signed out with a notice. */
  const attendanceRecordedFor = useRef<string | null>(null);
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
      // The first CRM sign-in / app opening of the office day is the employee's RM login time (recorded once a day).
      const dayKey = `${me.id}:${officeToday()}`;
      if (attendanceRecordedFor.current !== dayKey) {
        attendanceRecordedFor.current = dayKey;
        void hrApi.recordRmLogin().catch(() => { attendanceRecordedFor.current = null; });
      }
      // A Department Head may be authorised for more departments or for both functions: read what, and restore their last choice.
      let offered: MyDepartmentScopes | null = null;
      if (me.role === 'DEPARTMENT_HEAD') {
        try {
          const s = await meApi.departmentScopes();
          offered = s.departments.length > 0 ? s : null;
        } catch {
          offered = null; // the migration is not applied yet: the head works in their own department as before
        }
      }
      const initial = normaliseScope(offered, readStoredScope(me.id));
      setRequestScope(requestScopeFor(offered, initial));
      setScopes(offered);
      setScope(initial);
      setScopeChosen(readChosen(me.id));
      setRawProfile(me);
      setAccountNotice(null);
      setConnectionProblem(false);
      return { ok: true, profile: me };
    } catch (err) {
      // The server is busy or unreachable: that says nothing about the person's session. Keep it (never show the sign-in page for a slow server).
      if (isTransient(err)) {
        setConnectionProblem(true);
        return { ok: false, message: errorMessage(err) };
      }
      clearState();
      return { ok: false, message: errorMessage(err) };
    }
  }, [clearState, setConnectionProblem]);

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
      if (data.session && (await sendClientToDashboard())) return;
      if (data.session) {
        // keep this browser's stored sign-in from being cleared when the device is short of space (browsers may otherwise drop it)
        void navigator.storage?.persist?.().catch(() => undefined);
        let result = await loadProfile();
        // a busy server gets a few more tries before the person is told: the screen stays on "Loading" meanwhile
        for (const wait of RETRY_DELAYS_MS) {
          if (result.ok || !connectionProblemRef.current) break;
          await new Promise(r => setTimeout(r, wait));
          result = await loadProfile();
        }
      }
      setAuthLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Defer: calling Supabase from inside this callback can deadlock the auth client.
      setTimeout(() => {
        if (event === 'SIGNED_OUT' || !session) {
          clearState();
        } else if (session.user.id !== loadedUserId.current && event !== 'INITIAL_SESSION') {
          void (async () => {
            if (await sendClientToDashboard()) return; // a customer, not staff
            await loadProfile();
          })();
        }
      }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile, clearState]);

  // API signals: session expired / account deactivated while using the app
  useEffect(() => {
    const onUnauthenticated = () => void (async () => {
      if (await sendClientToDashboard()) return; // a customer's token is not valid for staff routes; do not sign them out
      const supabase = getSupabase();
      if (!supabase) return;
      // A refused token is usually just a stale one (the tab slept, or a second tab renewed it first). Ask for a fresh one before giving up, at most
      // once a minute so a server that keeps refusing cannot loop. Signed out only when the sign-in service itself says the session is over.
      if (Date.now() - lastRenewal.current > 60_000) {
        lastRenewal.current = Date.now();
        const { data, error } = await supabase.auth.refreshSession();
        if (data.session) { void loadProfile(); return; }
        if (error && isAuthRetryableFetchError(error)) return; // the sign-in service is busy: keep the session, try on the next request
      }
      await supabase.auth.signOut();
    })();
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
      if (error.status === 429 || /too many|rate limit/i.test(error.message)) return { ok: false, message: 'Too many sign-in attempts. Please wait a few minutes and try again.' };
      // a refused password (not a network or server problem): the server notes the attempt with its address and place
      if (error.status === 400 || error.status === 401 || error.code === 'invalid_credentials') signInReportApi.failed(email);
      return { ok: false, message: /confirm/i.test(error.message) ? 'Please confirm your e-mail address first.' : 'Invalid email or password.' };
    }
    if (await sendClientToDashboard()) return { ok: true };
    const { profile: _me, ...result } = await loadProfile();
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
    if (rawProfile) storeChosen(rawProfile.id, false); // the next sign-in shows the department cards again
    if (currentSession && activeDepartmentId) {
      sessionManager.leaveSession(currentSession.sessionId, activeDepartmentId);
    }
    // this browser stops getting the person's attendance reminders (at most 2 seconds; never blocks signing out)
    await unsubscribeThisDevice();
    // the CRM sign-out is recorded for HR's register (separate from attendance: it never punches out); never blocks signing out
    const db = getSupabase();
    if (db) {
      await Promise.race([
        Promise.resolve(db.rpc('record_crm_logout')).catch(() => undefined),
        new Promise(r => setTimeout(r, 2500))
      ]);
    }
    clearState();
    forgetRememberedPages(); // the next person (or the next sign-in) starts at the Overview
    forgetLastPath();
    await getSupabase()?.auth.signOut();
  };

  /** The "Try again" button of the connection-problem screen. */
  const retryConnection = async () => {
    setAuthLoading(true);
    await loadProfile();
    setAuthLoading(false);
  };

  const needsDepartmentChoice = !!rawProfile && hasSeveralDepartments(scopes) && !scopeChosen;
  const scopeKey = `${scope.departmentId ?? ''}:${scope.division ?? ''}`;

  const applyChoice = (next: ActiveScope) => {
    if (!rawProfile) return;
    const valid = normaliseScope(scopes, next);
    storeScope(rawProfile.id, valid);
    storeChosen(rawProfile.id, true);
    setScopeChosen(true);
    setScope(valid);
  };
  /** Another authorised department; the function stays the same where the new department offers it. */
  const chooseDepartment = (departmentId: string) => applyChoice({ departmentId, division: scope.division });
  /** The other function (Sales / Support) of the same department. */
  const chooseDivision = (division: HeadDivision) => {
    if (!choosableDivisions(scopes, scope.departmentId).includes(division)) return;
    applyChoice({ departmentId: scope.departmentId, division });
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
   * department, whatever its lock flag says; every other role only its own,
   * and only while the department is not locked. (The data inside is
   * independently scoped by RLS.)
   */
  const selectDepartment = (departmentId: DepartmentId): boolean => {
    if (!user) return false;
    const dept = getDepartment(departmentId);
    if (!dept) return false;
    if (user.role !== 'superadmin' && (dept.locked || user.departmentId !== departmentId)) return false;

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
        scopes,
        scope,
        needsDepartmentChoice,
        scopeKey,
        chooseDepartment,
        chooseDivision,
        authLoading,
        connectionProblem,
        retryConnection,
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
