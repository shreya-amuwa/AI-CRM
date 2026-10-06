import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthUser, DepartmentId, UserSession, Department } from '../types/crm';
import { sessionManager } from '../services/sessionManager';
import { useDepartments } from './DepartmentContext';
import { SAMPLE_TEAM_MEMBERS } from '../services/teamMemberStore';
import { SAMPLE_TEAM_LEAD } from '../services/teamLeadStore';
import { attendanceStore } from '../services/attendanceStore';

interface TempAuthUser {
  email: string;
  role: 'admin' | 'hr';
  name: string;
}

interface AuthContextType {
  user: AuthUser | null;
  tempAuthUser: TempAuthUser | null;
  activeDepartmentId: DepartmentId | null;
  currentSession: UserSession | null;
  activeDepartment: Department | null;

  // Eviction modal states
  isEvictionModalOpen: boolean;
  pendingDepartment: Department | null;
  conflictingSessions: UserSession[];
  evictedNotice: string | null;

  // Actions
  loginWithGoogle: (customEmail?: string) => void;
  loginWithEmail: (email: string, password?: string, role?: 'superadmin' | 'admin' | 'hr' | 'team-member' | 'team-lead' | 'technical-support', departmentId?: string) => void;
  setTempAuthUser: (user: TempAuthUser | null) => void;
  logout: () => void;
  selectDepartment: (departmentId: DepartmentId) => boolean;
  resetDepartmentSelection: () => void;
  confirmEviction: (evictSessionId: string) => void;
  closeEvictionModal: () => void;
  clearEvictedNotice: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { departments, getDepartment } = useDepartments();

  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem('unified_crm_user');
    if (saved) return JSON.parse(saved);
    // Default user (logged out state)
    return null;
  });

  const [tempAuthUser, setTempAuthUser] = useState<TempAuthUser | null>(null);
  const [activeDepartmentId, setActiveDepartmentId] = useState<DepartmentId | null>(null);
  const [currentSession, setCurrentSession] = useState<UserSession | null>(null);

  // Eviction Modal State
  const [isEvictionModalOpen, setIsEvictionModalOpen] = useState(false);
  const [pendingDepartment, setPendingDepartment] = useState<Department | null>(null);
  const [conflictingSessions, setConflictingSessions] = useState<UserSession[]>([]);
  const [evictedNotice, setEvictedNotice] = useState<string | null>(null);

  const activeDepartment = (activeDepartmentId && getDepartment(activeDepartmentId)) || null;

  // Auto-Sanitize localStorage on app mount to eliminate stale or corrupted data
  useEffect(() => {
    try {
      // Remove any stale keys that could cause re-render crashes
      localStorage.removeItem('aiqr_clients_data');
      localStorage.removeItem('aiqr_real_scans');
      
      const userStr = localStorage.getItem('unified_crm_user');
      if (userStr === 'undefined' || userStr === 'null') {
        localStorage.removeItem('unified_crm_user');
      }
    } catch (e) {}
  }, []);

  // Listen for BroadcastChannel eviction events across tabs!
  useEffect(() => {
    const unsubscribe = sessionManager.onSessionEvent((msg) => {
      if (msg.type === 'EVICT_SESSION' && currentSession) {
        if (msg.evictedSessionId === currentSession.sessionId) {
          // THIS session was evicted by a 3rd user on another tab!
          setCurrentSession(null);
          setActiveDepartmentId(null);
          setEvictedNotice(`Your active session in ${msg.departmentId.toUpperCase()} was forcibly terminated by ${msg.newUserName} (Security Limit: Max 2 Users).`);
        }
      }
    });

    return () => unsubscribe();
  }, [currentSession]);

  const loginWithGoogle = (customEmail?: string) => {
    const newUser: AuthUser = {
      id: `USR-${Math.floor(Math.random() * 899 + 100)}`,
      name: customEmail ? customEmail.split('@')[0].replace('.', ' ') : 'Alexander Wright',
      email: customEmail || 'alexander.w@amuwa.com',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      role: 'admin'
    };
    setUser(newUser);
    localStorage.setItem('unified_crm_user', JSON.stringify(newUser));
  };

  const loginWithEmail = (email: string, password?: string, role?: 'superadmin' | 'admin' | 'hr' | 'team-member' | 'team-lead' | 'technical-support', departmentId?: string) => {
    // Check if Technical Support login (Wabastore Support sub-department)
    if (email.toLowerCase() === 'techsupport@wabastore.com' || role === 'technical-support') {
      const newUser: AuthUser = {
        id: 'EMP-TS-2034',
        name: 'Rohan Mehta (Technical Support)',
        email: 'techsupport@wabastore.com',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        role: 'technical-support',
        departmentId: 'wabastore',
        subDepartment: 'support',
        position: 'Technical Support'
      };
      setUser(newUser);
      localStorage.setItem('unified_crm_user', JSON.stringify(newUser));

      // Record exact login time into HR Attendance Register
      attendanceStore.recordMemberLogin({
        empId: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: 'Technical Support',
        department: 'Wabastore Support',
        avatar: 'RM',
        authMethod: 'ID & Password Auth (System Login)',
        device: 'CRM Web Client (ID & Password)'
      });
      return;
    }

    // Check if matching Team Lead
    if (email.toLowerCase() === SAMPLE_TEAM_LEAD.email.toLowerCase() || role === 'team-lead') {
      const newUser: AuthUser = {
        id: SAMPLE_TEAM_LEAD.id,
        name: SAMPLE_TEAM_LEAD.name,
        email: SAMPLE_TEAM_LEAD.email,
        avatar: SAMPLE_TEAM_LEAD.avatar,
        role: 'team-lead',
        departmentId: SAMPLE_TEAM_LEAD.departmentId
      };
      setUser(newUser);
      localStorage.setItem('unified_crm_user', JSON.stringify(newUser));

      // Record exact ID & Password login time into HR Attendance Register
      attendanceStore.recordMemberLogin({
        empId: SAMPLE_TEAM_LEAD.id,
        name: SAMPLE_TEAM_LEAD.name,
        email: SAMPLE_TEAM_LEAD.email,
        role: 'Team Lead (Pod Alpha)',
        department: 'Wabastore Sales',
        avatar: 'VD',
        authMethod: 'ID & Password Auth (System Login)',
        device: 'CRM Web Client (ID & Password)'
      });
      return;
    }

    // Check if matching a registered team member
    const teamMember = SAMPLE_TEAM_MEMBERS.find(tm => tm.email.toLowerCase() === email.toLowerCase());

    if (teamMember || role === 'team-member') {
      const tmUser = teamMember || {
        id: `tm-${email.split('@')[0].toLowerCase()}`,
        name: email.split('@')[0].replace(/([._-])/g, ' ').toUpperCase(),
        email,
        role: 'team-member' as const,
        department: 'Wabastore',
        departmentId: 'wabastore',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80'
      };

      const newUser: AuthUser = {
        id: tmUser.id,
        name: tmUser.name,
        email: tmUser.email,
        avatar: tmUser.avatar,
        role: 'team-member',
        departmentId: tmUser.departmentId
      };
      setUser(newUser);
      localStorage.setItem('unified_crm_user', JSON.stringify(newUser));

      // Record exact ID & Password login time into HR Attendance Register
      attendanceStore.recordMemberLogin({
        empId: tmUser.id,
        name: tmUser.name,
        email: tmUser.email,
        role: (tmUser as any).title || 'Sales Executive',
        department: tmUser.department ? `${tmUser.department} Sales` : 'Wabastore Sales',
        avatar: tmUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        authMethod: 'ID & Password Auth (System Login)',
        device: 'CRM Web Client (ID & Password)'
      });
      return;
    }

    // Determine role and name based on credentials
    let userRole: 'superadmin' | 'admin' | 'hr' = (role as any) || 'admin';
    let userName = email.split('@')[0].replace(/([._-])/g, ' ').toUpperCase();
    let avatar = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80';

    // Set user name and avatar based on role
    if (userRole === 'superadmin') {
      userName = 'Super Admin';
      avatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';
    } else if (departmentId === 'accounts' || email.toLowerCase().includes('accounts')) {
      userName = 'Rajiv Khanna (Accounts Head)';
      avatar = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80';
      userRole = 'admin';
    } else if (userRole === 'admin') {
      userName = 'Admin (Department Head)';
      avatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80';
    } else if (userRole === 'hr') {
      userName = 'HR Manager';
      avatar = 'https://images.unsplash.com/photo-1507842217343-583f20270319?w=150&auto=format&fit=crop&q=80';
    }

    const newUser: AuthUser = {
      id: `USR-${Math.floor(Math.random() * 899 + 100)}`,
      name: userName,
      email,
      avatar,
      role: userRole,
      departmentId: departmentId || (userRole === 'admin' ? (email.toLowerCase().includes('accounts') ? 'accounts' : 'wabastore') : undefined)
    };
    setUser(newUser);
    localStorage.setItem('unified_crm_user', JSON.stringify(newUser));

    // Record login into HR Attendance Register
    attendanceStore.recordMemberLogin({
      empId: newUser.id,
      name: userName,
      email,
      role: departmentId === 'accounts' || email.toLowerCase().includes('accounts')
        ? 'Accounts Head (Finance Director)'
        : (userRole === 'hr' ? 'HR Manager' : (userRole === 'admin' ? 'Operations / Admin Lead' : 'Super Admin')),
      department: departmentId === 'accounts' || email.toLowerCase().includes('accounts')
        ? 'Accounts Department'
        : (userRole === 'hr' ? 'HR Department' : 'Amuwa Corporation'),
      avatar: userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
      authMethod: 'ID & Password Auth (System Login)',
      device: 'CRM Web Client (ID & Password)'
    });
  };

  const logout = () => {
    if (currentSession && activeDepartmentId) {
      sessionManager.leaveSession(currentSession.sessionId, activeDepartmentId);
    }
    setUser(null);
    setActiveDepartmentId(null);
    setCurrentSession(null);
    localStorage.removeItem('unified_crm_user');
  };

  // Reset department selection back to Department Selector Hub
  const resetDepartmentSelection = () => {
    if (currentSession && activeDepartmentId) {
      sessionManager.leaveSession(currentSession.sessionId, activeDepartmentId);
    }
    setActiveDepartmentId(null);
    setCurrentSession(null);
  };

  // Attempt to select and enter a department (Guaranteed instant entry)
  const selectDepartment = (departmentId: DepartmentId): boolean => {
    if (!user) return false;

    const dept = getDepartment(departmentId);
    if (!dept) return false;
    // Locked departments cannot be entered — data/users remain intact, but
    // access is blocked until a Super Admin unlocks the department again.
    if (dept.locked) return false;

    setActiveDepartmentId(departmentId);

    try {
      const res = sessionManager.registerSession(user, departmentId);
      if (res.session) setCurrentSession(res.session);
    } catch (e) {}

    return true;
  };

  const confirmEviction = (evictSessionId: string) => {
    if (!user || !pendingDepartment) return;

    const newSession = sessionManager.evictAndClaimSession(
      evictSessionId,
      user,
      pendingDepartment.id
    );

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

  const clearEvictedNotice = () => setEvictedNotice(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        tempAuthUser,
        activeDepartmentId,
        currentSession,
        activeDepartment,
        isEvictionModalOpen,
        pendingDepartment,
        conflictingSessions,
        evictedNotice,
        loginWithGoogle,
        loginWithEmail,
        setTempAuthUser,
        logout,
        selectDepartment,
        resetDepartmentSelection,
        confirmEviction,
        closeEvictionModal,
        clearEvictedNotice
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
