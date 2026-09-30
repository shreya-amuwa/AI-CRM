export interface AttendanceRecord {
  id: string;
  empId: string;
  name: string;
  email: string;
  role: string;
  department: string;
  avatar: string;
  loginTime: string;          // e.g. "09:14 AM" or "10:52:14 AM"
  crmLoginTime?: string;      // Explicit CRM System Login Time e.g. "09:14 AM"
  biometricTime?: string;     // Biometric Scanner Punch Time e.g. "09:08 AM"
  loginTimestamp: number;     // Date.now()
  loginDate: string;          // e.g. "Today, 29 Sep 2026"
  authMethod: string;
  device?: string;
  status: 'On Time' | 'Half-Day Approved' | 'Late' | 'Pending';
  isOnline: boolean;
  ipAddress?: string;
  time?: string;
}

const STORAGE_KEY = 'amuwa_crm_attendance_records_v6';
const LATEST_LOGIN_KEY = 'amuwa_crm_latest_member_login_v6';

const INITIAL_ATTENDANCE_SEEDS: AttendanceRecord[] = [
  {
    id: 'ATT-TM-1',
    empId: 'tm-priya',
    name: 'Priya Nair',
    email: 'priya@amuwa.com',
    role: 'Sales Executive',
    department: 'Wabastore Sales',
    avatar: 'PN',
    loginTime: '09:14 AM',
    crmLoginTime: '09:14 AM',
    biometricTime: '09:08 AM',
    loginTimestamp: Date.now() - 3600000 * 2,
    loginDate: `Today, ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`,
    authMethod: 'CRM Login (System Login)',
    device: 'CRM Web Client',
    status: 'On Time',
    isOnline: true,
    ipAddress: '192.168.1.47'
  },
  {
    id: 'ATT-TM-2',
    empId: 'tm-rahul',
    name: 'Rahul Kumar',
    email: 'rahul@amuwa.com',
    role: 'Sales Executive',
    department: 'Wabastore Sales',
    avatar: 'RK',
    loginTime: '09:22 AM',
    crmLoginTime: '09:22 AM',
    biometricTime: '09:15 AM',
    loginTimestamp: Date.now() - 3600000 * 1.8,
    loginDate: `Today, ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`,
    authMethod: 'CRM Login (System Login)',
    device: 'CRM Web Client',
    status: 'On Time',
    isOnline: true,
    ipAddress: '192.168.1.88'
  },
  {
    id: 'ATT-TM-3',
    empId: 'tm-amit',
    name: 'Amit Patel',
    email: 'amit@amuwa.com',
    role: 'Senior Sales Specialist',
    department: 'Wabastore Sales',
    avatar: 'AP',
    loginTime: '09:28 AM',
    crmLoginTime: '09:28 AM',
    biometricTime: '09:18 AM',
    loginTimestamp: Date.now() - 3600000 * 1.5,
    loginDate: `Today, ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`,
    authMethod: 'CRM Login (System Login)',
    device: 'CRM Web Client',
    status: 'On Time',
    isOnline: true,
    ipAddress: '192.168.1.102'
  },
  {
    id: 'ATT-TL-1',
    empId: 'tl-vikram',
    name: 'Vikram Deshmukh',
    email: 'lead@amuwa.com',
    role: 'Team Lead (Pod Alpha)',
    department: 'Wabastore Sales',
    avatar: 'VD',
    loginTime: '09:05 AM',
    crmLoginTime: '09:05 AM',
    biometricTime: '08:58 AM',
    loginTimestamp: Date.now() - 3600000 * 2.5,
    loginDate: `Today, ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`,
    authMethod: 'CRM Login (System Login)',
    device: 'CRM Web Client',
    status: 'On Time',
    isOnline: true,
    ipAddress: '192.168.1.15'
  },
  {
    id: 'ATT-1',
    empId: 'EMP-1001',
    name: 'Alexander Wright',
    email: 'alexander.w@amuwa.com',
    role: 'Operations Lead',
    department: 'Amuwa Corporation',
    avatar: 'AW',
    loginTime: '09:28 AM',
    crmLoginTime: '09:28 AM',
    biometricTime: '09:20 AM',
    loginTimestamp: Date.now() - 3600000 * 1.6,
    loginDate: `Today, ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`,
    authMethod: 'CRM Login (System Login)',
    device: 'CRM Web Client',
    status: 'On Time',
    isOnline: true,
    ipAddress: '192.168.1.1'
  },
  {
    id: 'ATT-4',
    empId: 'EMP-1004',
    name: 'Kavya Nair',
    email: 'kavya@amuwa.com',
    role: 'Design Specialist',
    department: 'Amuwa Design Studio',
    avatar: 'KN',
    loginTime: '09:25 AM',
    biometricTime: '09:25 AM',
    loginTimestamp: Date.now() - 3600000 * 1.7,
    loginDate: `Today, ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}`,
    authMethod: 'Biometric Scanner',
    device: 'Biometric Scanner',
    status: 'On Time',
    isOnline: true,
    ipAddress: '192.168.1.52'
  }
];

class AttendanceStore {
  private records: AttendanceRecord[] = [];
  private listeners: Set<(records: AttendanceRecord[]) => void> = new Set();

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
          this.loadFromStorage();
          this.notify();
        }
      });
      window.addEventListener('amuwa_attendance_updated', () => {
        this.loadFromStorage();
        this.notify();
      });
    }
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.records = JSON.parse(raw);
      } else {
        this.records = [...INITIAL_ATTENDANCE_SEEDS];
        this.saveToStorage();
      }
    } catch {
      this.records = [...INITIAL_ATTENDANCE_SEEDS];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch (e) {
      console.error('Failed to save attendance records:', e);
    }
  }

  private notify() {
    this.listeners.forEach((listener) => {
      try {
        listener([...this.records]);
      } catch (err) {
        console.error('Attendance listener error:', err);
      }
    });
  }

  public subscribe(listener: (records: AttendanceRecord[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.records]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getAttendanceRecords(): AttendanceRecord[] {
    return [...this.records];
  }

  public getLatestMemberLogin(): AttendanceRecord | null {
    try {
      const raw = localStorage.getItem(LATEST_LOGIN_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    const idPassLogins = this.records.filter(r => r.authMethod.includes('ID & Password'));
    return idPassLogins.length > 0 ? idPassLogins[0] : null;
  }

  /**
   * Captures the exact moment a team member or user logs into the CRM with ID & Password
   */
  public recordMemberLogin(user: {
    empId?: string;
    name: string;
    email: string;
    role?: string;
    department?: string;
    avatar?: string;
    authMethod?: string;
    device?: string;
    ipAddress?: string;
  }): AttendanceRecord {
    const now = new Date();
    const loginTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const loginDate = `Today, ${now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    const empId = user.empId || `EMP-${Date.now().toString().slice(-4)}`;

    const initials = user.name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'TM';

    const existingIndex = this.records.findIndex(
      r => (r.email.toLowerCase() === user.email.toLowerCase()) || (user.empId && r.empId === user.empId)
    );

    let updatedRecord: AttendanceRecord;

    if (existingIndex >= 0) {
      // Update existing employee record to show their fresh login time
      const existing = this.records[existingIndex];
      updatedRecord = {
        ...existing,
        name: user.name || existing.name,
        role: user.role || existing.role,
        department: user.department || existing.department,
        avatar: initials || existing.avatar,
        loginTime,
        crmLoginTime: loginTime,
        biometricTime: existing.biometricTime || '09:12 AM',
        loginTimestamp: now.getTime(),
        loginDate,
        authMethod: 'CRM Login (System Login)',
        device: user.device || 'CRM Web Client',
        status: 'On Time',
        isOnline: true,
        ipAddress: user.ipAddress || '192.168.1.47',
        time: loginTime
      };
      // Place newly logged in member at the top of the register
      this.records.splice(existingIndex, 1);
      this.records.unshift(updatedRecord);
    } else {
      // Create new attendance record for this team member
      updatedRecord = {
        id: `ATT-${Date.now()}`,
        empId,
        name: user.name,
        email: user.email,
        role: user.role || 'Sales Executive',
        department: user.department || 'Wabastore Sales',
        avatar: initials,
        loginTime,
        crmLoginTime: loginTime,
        biometricTime: '09:15 AM',
        loginTimestamp: now.getTime(),
        loginDate,
        authMethod: 'CRM Login (System Login)',
        device: user.device || 'CRM Web Client',
        status: 'On Time',
        isOnline: true,
        ipAddress: user.ipAddress || '192.168.1.47',
        time: loginTime
      };
      this.records.unshift(updatedRecord);
    }

    this.saveToStorage();

    try {
      localStorage.setItem(LATEST_LOGIN_KEY, JSON.stringify(updatedRecord));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('amuwa_attendance_updated', { detail: updatedRecord }));
      }
    } catch {}

    this.notify();
    return updatedRecord;
  }
}

export const attendanceStore = new AttendanceStore();
