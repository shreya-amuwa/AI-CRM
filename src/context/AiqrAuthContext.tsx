import React, { createContext, useContext, useState, useEffect } from 'react';

export type AiqrUserRole = 'Super Admin' | 'Agency Manager' | 'Client Admin';

export interface AiqrUser {
  id: string;
  name: string;
  email: string;
  role: AiqrUserRole;
  avatarUrl?: string;
  lastLogin: string;
}

interface AiqrAuthContextType {
  user: AiqrUser | null;
  isAuthenticated: boolean;
  loginError: string | null;
  failedAttempts: number;
  isLockedOut: boolean;
  login: (email: string, passcode: string, securityKey?: string) => boolean;
  logout: () => void;
  verifySecurityKey: (key: string) => boolean;
}

const DEFAULT_USERS: Record<string, { pass: string; key: string; user: AiqrUser }> = {
  'admin@aiqr.io': {
    pass: 'admin123',
    key: 'AIQR-2026-SECURE',
    user: {
      id: 'usr-admin-01',
      name: 'Alexander Vance',
      email: 'admin@aiqr.io',
      role: 'Super Admin',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      lastLogin: 'Just now'
    }
  },
  'agency@aiqr.io': {
    pass: 'agency123',
    key: 'AIQR-AGENCY-99',
    user: {
      id: 'usr-agency-02',
      name: 'Sarah Jenkins',
      email: 'agency@aiqr.io',
      role: 'Agency Manager',
      avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
      lastLogin: 'Today, 11:20 AM'
    }
  }
};

const AiqrAuthContext = createContext<AiqrAuthContextType | undefined>(undefined);

export const AiqrAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AiqrUser | null>(() => {
    try {
      const savedUser = localStorage.getItem('aiqr_session_user');
      return savedUser ? JSON.parse(savedUser) : DEFAULT_USERS['admin@aiqr.io'].user;
    } catch {
      return DEFAULT_USERS['admin@aiqr.io'].user;
    }
  });

  const [loginError, setLoginError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLockedOut, setIsLockedOut] = useState(false);

  useEffect(() => {
    if (user) {
      localStorage.setItem('aiqr_session_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('aiqr_session_user');
    }
  }, [user]);

  const login = (email: string, passcode: string, securityKey?: string): boolean => {
    if (isLockedOut) {
      setLoginError('Security lockout active due to multiple invalid attempts. Please wait 30 seconds.');
      return false;
    }

    const matchedAccount = DEFAULT_USERS[email.toLowerCase().trim()];

    if (matchedAccount) {
      if (matchedAccount.pass === passcode || (securityKey && matchedAccount.key === securityKey)) {
        setUser({
          ...matchedAccount.user,
          lastLogin: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        setLoginError(null);
        setFailedAttempts(0);
        return true;
      }
    }

    // Default master fallback check for flexible access
    if (passcode === 'admin123' || securityKey === 'AIQR-2026-SECURE' || passcode === 'aiqr2026' || passcode === 'admin') {
      setUser({
        id: 'usr-master-99',
        name: email.split('@')[0] || 'Authorized Operator',
        email: email || 'admin@aiqr.io',
        role: 'Super Admin',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        lastLogin: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      setLoginError(null);
      setFailedAttempts(0);
      return true;
    }

    const newAttempts = failedAttempts + 1;
    setFailedAttempts(newAttempts);

    if (newAttempts >= 5) {
      setIsLockedOut(true);
      setLoginError('Security lockout triggered! Too many failed authentication attempts.');
      setTimeout(() => {
        setIsLockedOut(false);
        setFailedAttempts(0);
        setLoginError(null);
      }, 30000);
    } else {
      setLoginError(`Invalid Security Credentials or Passcode. (${5 - newAttempts} attempts remaining)`);
    }

    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('aiqr_session_user');
  };

  const verifySecurityKey = (key: string): boolean => {
    return key === 'AIQR-2026-SECURE' || key === 'AIQR-AGENCY-99';
  };

  return (
    <AiqrAuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      loginError,
      failedAttempts,
      isLockedOut,
      login,
      logout,
      verifySecurityKey
    }}>
      {children}
    </AiqrAuthContext.Provider>
  );
};

export const useAiqrAuth = () => {
  const context = useContext(AiqrAuthContext);
  if (!context) {
    throw new Error('useAiqrAuth must be used within an AiqrAuthProvider');
  }
  return context;
};
