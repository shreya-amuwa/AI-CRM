import { UserSession, DepartmentId, AuthUser } from '../types/crm';

const STORAGE_KEY = 'unified_crm_active_sessions';
const BROADCAST_CHANNEL_NAME = 'unified_session_channel';

// Initialize session channel for real-time cross-tab updates
let sessionChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  sessionChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
}

export const sessionManager = {
  // Retrieve all active sessions from localStorage
  getAllSessions(): Record<string, UserSession[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return {};
      return JSON.parse(data);
    } catch {
      return {};
    }
  },

  // Get active sessions for a specific department
  getDepartmentSessions(departmentId: DepartmentId): UserSession[] {
    const all = this.getAllSessions();
    return all[departmentId] || [];
  },

  // Check if department is at max capacity (2 users)
  isDepartmentFull(departmentId: DepartmentId): boolean {
    const sessions = this.getDepartmentSessions(departmentId);
    return sessions.length >= 2;
  },

  // Register user session for department
  registerSession(
    user: AuthUser, 
    departmentId: DepartmentId
  ): { success: boolean; session?: UserSession; activeSessions?: UserSession[] } {
    const sessions = this.getDepartmentSessions(departmentId);

    // Create new active session
    const newSession: UserSession = {
      sessionId: `SESS-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      departmentId,
      loggedInAt: new Date().toISOString(),
      device: this.getDeviceSummary(),
      ipAddress: '192.168.1.' + Math.floor(Math.random() * 150 + 10),
      lastActive: new Date().toISOString()
    };

    const updated = [newSession];
    this.saveSessions(departmentId, updated);

    return { success: true, session: newSession, activeSessions: updated };
  },

  // Evict an existing session and claim the spot for new user
  evictAndClaimSession(
    evictSessionId: string,
    newUser: AuthUser,
    departmentId: DepartmentId
  ): UserSession {
    let sessions = this.getDepartmentSessions(departmentId);
    
    // Remove evicted session
    sessions = sessions.filter(s => s.sessionId !== evictSessionId);

    // Create replacement session
    const newSession: UserSession = {
      sessionId: `SESS-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
      userId: newUser.id,
      userName: newUser.name,
      userEmail: newUser.email,
      departmentId,
      loggedInAt: new Date().toISOString(),
      device: this.getDeviceSummary(),
      ipAddress: '192.168.1.' + Math.floor(Math.random() * 150 + 10),
      lastActive: new Date().toISOString()
    };

    sessions.push(newSession);
    this.saveSessions(departmentId, sessions);

    // Broadcast eviction event to all tabs
    if (sessionChannel) {
      sessionChannel.postMessage({
        type: 'EVICT_SESSION',
        evictedSessionId: evictSessionId,
        departmentId,
        newUserName: newUser.name
      });
    }

    return newSession;
  },

  // Leave active session when navigating away or logging out
  leaveSession(sessionId: string, departmentId: DepartmentId) {
    const sessions = this.getDepartmentSessions(departmentId);
    const updated = sessions.filter(s => s.sessionId !== sessionId);
    this.saveSessions(departmentId, updated);
  },

  // Save session array to localStorage and broadcast change
  saveSessions(departmentId: DepartmentId, sessions: UserSession[]) {
    const all = this.getAllSessions();
    all[departmentId] = sessions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

    if (sessionChannel) {
      sessionChannel.postMessage({
        type: 'SESSIONS_UPDATED',
        departmentId,
        sessions
      });
    }
  },

  // Utility to generate browser/device tag
  getDeviceSummary(): string {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) return 'Chrome / Windows 11';
    if (userAgent.includes('Firefox')) return 'Firefox / Windows';
    if (userAgent.includes('Safari')) return 'Safari / macOS';
    return 'Web Browser / Control Room';
  },

  // Subscribe to BroadcastChannel messages
  onSessionEvent(callback: (msg: any) => void): () => void {
    if (!sessionChannel) return () => {};

    const handler = (event: MessageEvent) => {
      callback(event.data);
    };

    sessionChannel.addEventListener('message', handler);
    return () => {
      sessionChannel?.removeEventListener('message', handler);
    };
  }
};
