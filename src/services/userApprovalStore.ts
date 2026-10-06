/**
 * ==============================================================================
 * AMUWA CRM - USER REGISTRATION & ACCESS AUTHORIZATION STORE
 * ==============================================================================
 * Manages team member registrations, multi-department approvals, and access
 * revocation to protect sensitive customer and organization data.
 */

import { SAMPLE_TEAM_MEMBERS, TeamMemberUser } from './teamMemberStore';

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  password: string;
  departmentId: string;
  departmentName: string;
  subDepartment: 'sales' | 'support';
  role: 'team-member' | 'technical-support';
  position: string;
  avatar?: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REVOKED' | 'REJECTED';
  registeredAt: string;
  approvedBy?: string;
  approvedAt?: string;
  revokedBy?: string;
  revokedAt?: string;
  revokeReason?: string;
}

const STORAGE_KEY = 'amuwa_user_registrations_v2';

// Seed active staff accounts (pre-authorized organizational employees)
const SEED_ACTIVE_USERS: RegisteredUser[] = [
  {
    id: 'tm-priya',
    name: 'Priya Nair',
    email: 'priya@amuwa.com',
    password: 'TM@Pass2',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    subDepartment: 'sales',
    role: 'team-member',
    position: 'Sales Executive',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    registeredAt: '2026-09-01T09:00:00.000Z',
    approvedBy: 'Alexander Wright (Super Admin)',
    approvedAt: '2026-09-01T09:30:00.000Z'
  },
  {
    id: 'tm-rahul',
    name: 'Rahul Kumar',
    email: 'rahul@amuwa.com',
    password: 'TM@Pass1',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    subDepartment: 'sales',
    role: 'team-member',
    position: 'Sales Executive',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    registeredAt: '2026-09-02T10:00:00.000Z',
    approvedBy: 'Vikram Deshmukh (Team Lead)',
    approvedAt: '2026-09-02T10:15:00.000Z'
  },
  {
    id: 'tm-amit',
    name: 'Amit Patel',
    email: 'amit@amuwa.com',
    password: 'TM@Pass3',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    subDepartment: 'sales',
    role: 'team-member',
    position: 'Senior Sales Specialist',
    avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    registeredAt: '2026-09-05T11:00:00.000Z',
    approvedBy: 'Alexander Wright (Super Admin)',
    approvedAt: '2026-09-05T11:20:00.000Z'
  },
  {
    id: 'EMP-TS-2034',
    name: 'Rohan Mehta',
    email: 'techsupport@wabastore.com',
    password: 'support123',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    subDepartment: 'support',
    role: 'technical-support',
    position: 'Technical Support Specialist',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    registeredAt: '2026-09-10T08:30:00.000Z',
    approvedBy: 'Admin (Department Head)',
    approvedAt: '2026-09-10T09:00:00.000Z'
  }
];

class UserApprovalStore {
  private users: RegisteredUser[];

  constructor() {
    this.users = this.load();
  }

  private load(): RegisteredUser[] {
    if (typeof window === 'undefined') return [...SEED_ACTIVE_USERS];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse UserApprovalStore data:', e);
    }
    return [...SEED_ACTIVE_USERS];
  }

  private save(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.users));
      window.dispatchEvent(new CustomEvent('amuwa_user_registrations_changed', { detail: this.users }));
    } catch (e) {
      console.error('Failed to save UserApprovalStore data:', e);
    }
  }

  /**
   * Register a new Team Member (Account starts in PENDING_APPROVAL)
   */
  public register(input: {
    name: string;
    email: string;
    password: string;
    departmentId: string;
    departmentName: string;
    subDepartment: 'sales' | 'support';
  }): { success: boolean; message: string; user?: RegisteredUser } {
    const cleanEmail = input.email.trim().toLowerCase();

    // Check if user already exists
    const existing = this.users.find(u => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      if (existing.status === 'PENDING_APPROVAL') {
        return {
          success: false,
          message: 'An account with this email is already awaiting authorization from your Department Head.'
        };
      }
      if (existing.status === 'ACTIVE') {
        return {
          success: false,
          message: 'An active account already exists with this email. Please Sign In.'
        };
      }
      if (existing.status === 'REVOKED') {
        return {
          success: false,
          message: 'This email account was previously revoked by organization management. Contact your Department Head.'
        };
      }
    }

    const isSupport = input.subDepartment === 'support';
    const role: 'team-member' | 'technical-support' = isSupport ? 'technical-support' : 'team-member';
    const position = isSupport ? 'Technical Support' : 'Sales Executive';
    const initials = input.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    const newUser: RegisteredUser = {
      id: `usr-reg-${Date.now().toString().slice(-6)}`,
      name: input.name.trim(),
      email: cleanEmail,
      password: input.password,
      departmentId: input.departmentId,
      departmentName: input.departmentName,
      subDepartment: input.subDepartment,
      role,
      position,
      avatar: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      status: 'PENDING_APPROVAL',
      registeredAt: new Date().toISOString()
    };

    this.users.unshift(newUser);
    this.save();

    return {
      success: true,
      message: `Registration request submitted! Your account is pending authorization from your Department Head or Super Admin.`,
      user: newUser
    };
  }

  /**
   * Get all pending approval requests
   */
  public getPendingUsers(departmentId?: string): RegisteredUser[] {
    let list = this.users.filter(u => u.status === 'PENDING_APPROVAL');
    if (departmentId && departmentId !== 'all') {
      list = list.filter(u => u.departmentId === departmentId);
    }
    return list;
  }

  /**
   * Get all active authorized team members
   */
  public getActiveUsers(departmentId?: string): RegisteredUser[] {
    let list = this.users.filter(u => u.status === 'ACTIVE');
    if (departmentId && departmentId !== 'all') {
      list = list.filter(u => u.departmentId === departmentId);
    }
    return list;
  }

  /**
   * Get all revoked accounts
   */
  public getRevokedUsers(departmentId?: string): RegisteredUser[] {
    let list = this.users.filter(u => u.status === 'REVOKED');
    if (departmentId && departmentId !== 'all') {
      list = list.filter(u => u.departmentId === departmentId);
    }
    return list;
  }

  /**
   * Get all users
   */
  public getAllUsers(departmentId?: string): RegisteredUser[] {
    if (departmentId && departmentId !== 'all') {
      return this.users.filter(u => u.departmentId === departmentId);
    }
    return [...this.users];
  }

  /**
   * Authorize / Activate a pending user
   */
  public approveUser(userId: string, approverName: string, approverRole: string): RegisteredUser | null {
    const user = this.users.find(u => u.id === userId);
    if (!user) return null;

    user.status = 'ACTIVE';
    user.approvedBy = `${approverName} (${approverRole})`;
    user.approvedAt = new Date().toISOString();
    user.revokedBy = undefined;
    user.revokedAt = undefined;
    user.revokeReason = undefined;

    // Dynamically register into SAMPLE_TEAM_MEMBERS so sales dashboards recognize them
    if (user.role === 'team-member') {
      const existsInSample = SAMPLE_TEAM_MEMBERS.some(m => m.email.toLowerCase() === user.email.toLowerCase());
      if (!existsInSample) {
        SAMPLE_TEAM_MEMBERS.push({
          id: user.id,
          name: user.name,
          email: user.email,
          password: user.password,
          role: 'team-member',
          title: user.position,
          department: user.departmentName,
          departmentId: user.departmentId,
          avatar: user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
          targetCalls: 12,
          targetDemos: 4,
          targetDeals: 10,
          currentDeals: 0
        });
      }
    }

    this.save();
    return user;
  }

  /**
   * Reject a registration request
   */
  public rejectUser(userId: string, approverName: string): RegisteredUser | null {
    const user = this.users.find(u => u.id === userId);
    if (!user) return null;

    user.status = 'REJECTED';
    user.revokedBy = approverName;
    user.revokedAt = new Date().toISOString();
    user.revokeReason = 'Registration request declined by management.';

    this.save();
    return user;
  }

  /**
   * Revoke employee access (e.g., employee left organization)
   * Prevents unauthorized access to sensitive customer data.
   */
  public revokeAccess(userId: string, revokerName: string, reason?: string): RegisteredUser | null {
    const user = this.users.find(u => u.id === userId);
    if (!user) return null;

    user.status = 'REVOKED';
    user.revokedBy = revokerName;
    user.revokedAt = new Date().toISOString();
    user.revokeReason = reason || 'Access revoked by department management (Employee separation / Security policy).';

    this.save();
    return user;
  }

  /**
   * Restore revoked access
   */
  public restoreAccess(userId: string, approverName: string): RegisteredUser | null {
    const user = this.users.find(u => u.id === userId);
    if (!user) return null;

    user.status = 'ACTIVE';
    user.approvedBy = approverName;
    user.approvedAt = new Date().toISOString();
    user.revokedBy = undefined;
    user.revokedAt = undefined;
    user.revokeReason = undefined;

    this.save();
    return user;
  }

  /**
   * Delete user permanently from registry
   */
  public deleteUser(userId: string): boolean {
    const lenBefore = this.users.length;
    this.users = this.users.filter(u => u.id !== userId);
    if (this.users.length !== lenBefore) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Check status of user by email
   */
  public findUserByEmail(email: string): RegisteredUser | undefined {
    return this.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  /**
   * Validate credentials & check security access status
   */
  public validateLogin(email: string, password?: string): {
    allowed: boolean;
    reason?: 'PENDING_APPROVAL' | 'REVOKED' | 'REJECTED' | 'INVALID_CREDENTIALS' | 'NOT_FOUND';
    message?: string;
    user?: RegisteredUser;
  } {
    const user = this.findUserByEmail(email);
    if (!user) {
      return { allowed: false, reason: 'NOT_FOUND' };
    }

    // Check security status first!
    if (user.status === 'PENDING_APPROVAL') {
      return {
        allowed: false,
        reason: 'PENDING_APPROVAL',
        message: `⏳ Authorization Pending: Your account for ${user.departmentName} (${user.position}) is awaiting authorization from your Department Head or Super Admin. Access is restricted until approved.`,
        user
      };
    }

    if (user.status === 'REVOKED') {
      return {
        allowed: false,
        reason: 'REVOKED',
        message: `🚫 Access Revoked: System access for this account was revoked by management (${user.revokeReason || 'Security Policy'}). Sensitive customer information is protected.`,
        user
      };
    }

    if (user.status === 'REJECTED') {
      return {
        allowed: false,
        reason: 'REJECTED',
        message: `❌ Registration Declined: Your account request was not authorized by your Department Head.`,
        user
      };
    }

    // Validate password if supplied
    if (password && user.password !== password) {
      return {
        allowed: false,
        reason: 'INVALID_CREDENTIALS',
        message: 'Invalid password. Please try again.',
        user
      };
    }

    return {
      allowed: true,
      user
    };
  }
}

export const userApprovalStore = new UserApprovalStore();
