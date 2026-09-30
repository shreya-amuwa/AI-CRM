export interface DepartmentMember {
  id: string; // Emp ID, e.g. "EMP-1042" or "INT-2089"
  name: string;
  role: string;
  type: 'Employee' | 'Intern';
  department: 'sales' | 'support';
  status: 'pending' | 'approved' | 'rejected';
  email?: string;
  phone?: string;
  salary?: string;
  addedAt: string;
  submittedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
}

const STORAGE_KEY = 'wabastore_department_members_v1';
const SYNC_EVENT = 'wabastore_dept_members_sync';

// Initial seed data for WabaStore Sales and Support
const INITIAL_MEMBERS: DepartmentMember[] = [
  // --- WABASTORE SALES (Approved Members) ---
  {
    id: 'EMP-1001',
    name: 'Vikram Singhania',
    role: 'Head of Sales & Commercials',
    type: 'Employee',
    department: 'sales',
    status: 'approved',
    email: 'vikram.s@wabastore.com',
    phone: '+91 98210 44321',
    addedAt: '2026-01-15'
  },
  {
    id: 'EMP-1042',
    name: 'Priya Nair',
    role: 'Senior Enterprise Account Executive',
    type: 'Employee',
    department: 'sales',
    status: 'approved',
    email: 'priya.nair@wabastore.com',
    phone: '+91 98450 11223',
    addedAt: '2026-02-01'
  },
  {
    id: 'EMP-1058',
    name: 'Rahul Kumar',
    role: 'Mid-Market Sales Specialist',
    type: 'Employee',
    department: 'sales',
    status: 'approved',
    email: 'rahul.k@wabastore.com',
    phone: '+91 97112 33445',
    addedAt: '2026-02-15'
  },
  {
    id: 'EMP-1073',
    name: 'Amit Patel',
    role: 'Business Development Specialist',
    type: 'Employee',
    department: 'sales',
    status: 'approved',
    email: 'amit.patel@wabastore.com',
    phone: '+91 99001 55667',
    addedAt: '2026-03-01'
  },
  {
    id: 'INT-2015',
    name: 'Sneha Verma',
    role: 'Outbound Sales Intern',
    type: 'Intern',
    department: 'sales',
    status: 'approved',
    email: 'sneha.v@wabastore.com',
    phone: '+91 98765 99881',
    addedAt: '2026-08-01'
  },
  {
    id: 'INT-2022',
    name: 'Aryan Sharma',
    role: 'Inside Sales & Prospecting Intern',
    type: 'Intern',
    department: 'sales',
    status: 'approved',
    email: 'aryan.s@wabastore.com',
    phone: '+91 96543 21876',
    addedAt: '2026-08-15'
  },
  // --- Pending HR Approval in Sales (Demonstrates top pop-up) ---
  {
    id: 'INT-2089',
    name: 'Kabir Das',
    role: 'Growth & Outreach Intern',
    type: 'Intern',
    department: 'sales',
    status: 'pending',
    email: 'kabir.das@wabastore.com',
    phone: '+91 95432 10987',
    addedAt: 'Today, 09:40 AM',
    submittedBy: 'HR Operations (Priya Sharma)'
  },

  // --- WABASTORE SUPPORT (Approved Members) ---
  {
    id: 'EMP-2001',
    name: 'Kavya Nair',
    role: 'Head of Customer Experience & Support',
    type: 'Employee',
    department: 'support',
    status: 'approved',
    email: 'kavya.n@wabastore.com',
    phone: '+91 98330 12345',
    addedAt: '2026-01-20'
  },
  {
    id: 'EMP-2034',
    name: 'Rohan Mehta',
    role: 'Senior Technical Support Engineer',
    type: 'Employee',
    department: 'support',
    status: 'approved',
    email: 'rohan.m@wabastore.com',
    phone: '+91 98200 54321',
    addedAt: '2026-02-10'
  },
  {
    id: 'EMP-2045',
    name: 'Neha Gupta',
    role: 'Escalations & Critical Issue Lead',
    type: 'Employee',
    department: 'support',
    status: 'approved',
    email: 'neha.g@wabastore.com',
    phone: '+91 97654 32109',
    addedAt: '2026-03-05'
  },
  {
    id: 'EMP-2088',
    name: 'Farhan Akhtar',
    role: 'L1 Support Specialist',
    type: 'Employee',
    department: 'support',
    status: 'approved',
    email: 'farhan.a@wabastore.com',
    phone: '+91 96543 11223',
    addedAt: '2026-04-12'
  },
  {
    id: 'INT-3012',
    name: 'Ananya Roy',
    role: 'Customer Success Intern',
    type: 'Intern',
    department: 'support',
    status: 'approved',
    email: 'ananya.roy@wabastore.com',
    phone: '+91 98111 22334',
    addedAt: '2026-08-10'
  },
  {
    id: 'INT-3019',
    name: 'Tanmay Joshi',
    role: 'Helpdesk & WhatsApp Triage Intern',
    type: 'Intern',
    department: 'support',
    status: 'approved',
    email: 'tanmay.j@wabastore.com',
    phone: '+91 98777 66554',
    addedAt: '2026-08-20'
  },
  // --- Pending HR Approval in Support (Demonstrates top pop-up) ---
  {
    id: 'INT-3055',
    name: 'Ritu Sen',
    role: 'Support Operations Trainee',
    type: 'Intern',
    department: 'support',
    status: 'pending',
    email: 'ritu.sen@wabastore.com',
    phone: '+91 95432 98765',
    addedAt: 'Today, 10:15 AM',
    submittedBy: 'HR Operations (Priya Sharma)'
  }
];

class DepartmentMemberStore {
  private members: DepartmentMember[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.members = JSON.parse(saved);
      } else {
        this.members = INITIAL_MEMBERS;
        this.saveToStorage();
      }
    } catch (err) {
      console.warn('Failed to load department members from storage:', err);
      this.members = INITIAL_MEMBERS;
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.members));
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
    } catch (err) {
      console.warn('Failed to save department members:', err);
    }
  }

  private notify() {
    this.listeners.forEach(cb => cb());
  }

  // Subscribe to changes
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    const handleSync = () => {
      this.loadFromStorage();
      listener();
    };

    window.addEventListener(SYNC_EVENT, handleSync);
    window.addEventListener('storage', handleSync);

    return () => {
      this.listeners.delete(listener);
      window.removeEventListener(SYNC_EVENT, handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }

  // Get all members for a department
  public getMembers(department: 'sales' | 'support'): DepartmentMember[] {
    return this.members.filter(m => m.department === department);
  }

  // Get only approved members
  public getApprovedMembers(department: 'sales' | 'support'): DepartmentMember[] {
    return this.members.filter(m => m.department === department && m.status === 'approved');
  }

  // Get pending members awaiting approval
  public getPendingMembers(department: 'sales' | 'support'): DepartmentMember[] {
    return this.members.filter(m => m.department === department && m.status === 'pending');
  }

  // Add a new pending member (from HR Department)
  public addPendingMember(member: Omit<DepartmentMember, 'status' | 'approvedBy' | 'approvedAt'>): DepartmentMember {
    const newMember: DepartmentMember = {
      ...member,
      status: 'pending'
    };
    this.members = [newMember, ...this.members];
    this.saveToStorage();
    this.notify();
    return newMember;
  }

  // SuperAdmin or Admin approves the member
  public approveMember(memberId: string, approvedBy: string = 'SuperAdmin'): boolean {
    let found = false;
    this.members = this.members.map(m => {
      if (m.id === memberId) {
        found = true;
        return {
          ...m,
          status: 'approved',
          approvedBy,
          approvedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      }
      return m;
    });

    if (found) {
      this.saveToStorage();
      this.notify();
    }
    return found;
  }

  // SuperAdmin or Admin rejects / returns candidate to HR
  public rejectMember(memberId: string): boolean {
    let found = false;
    this.members = this.members.map(m => {
      if (m.id === memberId) {
        found = true;
        return {
          ...m,
          status: 'rejected'
        };
      }
      return m;
    });

    if (found) {
      this.saveToStorage();
      this.notify();
    }
    return found;
  }

  // Reset to initial seed data
  public resetToDefault() {
    this.members = INITIAL_MEMBERS;
    this.saveToStorage();
    this.notify();
  }
}

export const departmentMemberStore = new DepartmentMemberStore();
