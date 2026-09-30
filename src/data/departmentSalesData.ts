export interface SalesTeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  avatar: string;
  leadsAssigned: number;
  callsCompleted: number;
  followupsCompleted: number;
  demos: number;
  proposals: number;
  wonDeals: number;
  revenue: number;
  pendingTasks: number;
  target: number;
  achieved: number;
  status: 'on-track' | 'needs-attention' | 'overdue';
  joinDate: string;
}

export interface SalesLead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: 'hot' | 'warm' | 'cold' | 'converted';
  source: string;
  value: number;
  nextFollowup: string;
  assignedTo: string;
  lastContact: string;
}

export interface DepartmentSalesConfig {
  departmentId: string;
  departmentName: string;
  tagline: string;
  themeColor: {
    name: string;
    gradient: string;
    primaryText: string;
    primaryBg: string;
    lightBg: string;
    badgeBg: string;
    badgeText: string;
    borderColor: string;
    buttonBg: string;
    buttonHover: string;
    accentHex: string;
  };
  teamMembers: SalesTeamMember[];
  leads: SalesLead[];
}

export const DEPARTMENT_SALES_CONFIGS: Record<string, DepartmentSalesConfig> = {
  whatsbox: {
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    tagline: 'Meta Official WhatsApp API & Automation Platform',
    themeColor: {
      name: 'emerald',
      gradient: 'from-emerald-600 to-teal-600',
      primaryText: 'text-emerald-600',
      primaryBg: 'bg-emerald-600',
      lightBg: 'bg-emerald-50',
      badgeBg: 'bg-emerald-100',
      badgeText: 'text-emerald-700',
      borderColor: 'border-emerald-200',
      buttonBg: 'bg-emerald-600',
      buttonHover: 'hover:bg-emerald-700',
      accentHex: '#10B981'
    },
    teamMembers: [
      {
        id: 'EMP-9041',
        name: 'Priya Mehta',
        role: 'Lead WhatsApp API Consultant',
        email: 'priya.mehta@whatsbox.in',
        phone: '+91 98201-12345',
        avatar: 'PM',
        leadsAssigned: 15,
        callsCompleted: 24,
        followupsCompleted: 12,
        demos: 3,
        proposals: 4,
        wonDeals: 2,
        revenue: 52000,
        pendingTasks: 3,
        target: 65000,
        achieved: 52000,
        status: 'on-track',
        joinDate: '2023-03-10'
      },
      {
        id: 'EMP-9042',
        name: 'Rohan Singhania',
        role: 'Enterprise Chatbot Specialist',
        email: 'rohan.s@whatsbox.in',
        phone: '+91 97110-54321',
        avatar: 'RS',
        leadsAssigned: 14,
        callsCompleted: 20,
        followupsCompleted: 9,
        demos: 2,
        proposals: 3,
        wonDeals: 1,
        revenue: 38000,
        pendingTasks: 4,
        target: 50000,
        achieved: 38000,
        status: 'on-track',
        joinDate: '2023-06-15'
      },
      {
        id: 'EMP-9043',
        name: 'Tanvi Deshmukh',
        role: 'SME WhatsApp Sales Exec',
        email: 'tanvi.d@whatsbox.in',
        phone: '+91 98112-99887',
        avatar: 'TD',
        leadsAssigned: 9,
        callsCompleted: 13,
        followupsCompleted: 5,
        demos: 1,
        proposals: 2,
        wonDeals: 0,
        revenue: 14000,
        pendingTasks: 7,
        target: 45000,
        achieved: 14000,
        status: 'needs-attention',
        joinDate: '2024-01-20'
      },
      {
        id: 'EMP-9044',
        name: 'Vikram Joshi',
        role: 'WhatsApp Broadcast Rep',
        email: 'vikram.j@whatsbox.in',
        phone: '+91 99220-44556',
        avatar: 'VJ',
        leadsAssigned: 10,
        callsCompleted: 15,
        followupsCompleted: 4,
        demos: 0,
        proposals: 1,
        wonDeals: 0,
        revenue: 8000,
        pendingTasks: 11,
        target: 40000,
        achieved: 8000,
        status: 'overdue',
        joinDate: '2024-04-05'
      }
    ],
    leads: []
  },

  dtalk: {
    departmentId: 'dtalk',
    departmentName: 'D Talk',
    tagline: 'Cloud Telecom, Conversational AI & Enterprise Voice Infrastructure',
    themeColor: {
      name: 'cyan',
      gradient: 'from-cyan-600 to-blue-600',
      primaryText: 'text-cyan-600',
      primaryBg: 'bg-cyan-600',
      lightBg: 'bg-cyan-50',
      badgeBg: 'bg-cyan-100',
      badgeText: 'text-cyan-700',
      borderColor: 'border-cyan-200',
      buttonBg: 'bg-cyan-600',
      buttonHover: 'hover:bg-cyan-700',
      accentHex: '#0891B2'
    },
    teamMembers: [
      {
        id: 'EMP-7701',
        name: 'Karan Patel',
        role: 'Cloud Telecom Solutions Specialist',
        email: 'karan@dtalk.com',
        phone: '+91 98201-44556',
        avatar: 'KP',
        leadsAssigned: 16,
        callsCompleted: 26,
        followupsCompleted: 14,
        demos: 4,
        proposals: 4,
        wonDeals: 2,
        revenue: 68000,
        pendingTasks: 2,
        target: 80000,
        achieved: 68000,
        status: 'on-track',
        joinDate: '2023-02-15'
      },
      {
        id: 'EMP-7702',
        name: 'Deepak Merchant',
        role: 'Voice AI & IVR Specialist',
        email: 'deepak@dtalk.com',
        phone: '+91 98330-11223',
        avatar: 'DM',
        leadsAssigned: 13,
        callsCompleted: 20,
        followupsCompleted: 10,
        demos: 3,
        proposals: 3,
        wonDeals: 1,
        revenue: 44000,
        pendingTasks: 3,
        target: 60000,
        achieved: 44000,
        status: 'on-track',
        joinDate: '2023-07-10'
      },
      {
        id: 'EMP-7703',
        name: 'Aakash Malhotra',
        role: 'SIP Trunking Account Exec',
        email: 'aakash@dtalk.com',
        phone: '+91 97440-66778',
        avatar: 'AM',
        leadsAssigned: 10,
        callsCompleted: 14,
        followupsCompleted: 4,
        demos: 1,
        proposals: 2,
        wonDeals: 0,
        revenue: 16000,
        pendingTasks: 6,
        target: 50000,
        achieved: 16000,
        status: 'needs-attention',
        joinDate: '2024-02-18'
      },
      {
        id: 'EMP-7704',
        name: 'Meera Nair',
        role: 'Cloud Calling Telecaller',
        email: 'meera@dtalk.com',
        phone: '+91 96550-88990',
        avatar: 'MN',
        leadsAssigned: 9,
        callsCompleted: 16,
        followupsCompleted: 4,
        demos: 0,
        proposals: 1,
        wonDeals: 0,
        revenue: 9000,
        pendingTasks: 10,
        target: 45000,
        achieved: 9000,
        status: 'overdue',
        joinDate: '2024-05-12'
      }
    ],
    leads: []
  },

  digitree: {
    departmentId: 'digitree',
    departmentName: 'Digitree',
    tagline: 'Digital Transformation, Cloud Solutions & Performance Marketing',
    themeColor: {
      name: 'purple',
      gradient: 'from-purple-600 to-indigo-600',
      primaryText: 'text-purple-600',
      primaryBg: 'bg-purple-600',
      lightBg: 'bg-purple-50',
      badgeBg: 'bg-purple-100',
      badgeText: 'text-purple-700',
      borderColor: 'border-purple-200',
      buttonBg: 'bg-purple-600',
      buttonHover: 'hover:bg-purple-700',
      accentHex: '#9333EA'
    },
    teamMembers: [
      {
        id: 'EMP-6601',
        name: 'Vikram Sethi',
        role: 'Digital Growth Director',
        email: 'vikram@digitree.in',
        phone: '+91 98201-77889',
        avatar: 'VS',
        leadsAssigned: 17,
        callsCompleted: 25,
        followupsCompleted: 13,
        demos: 3,
        proposals: 5,
        wonDeals: 2,
        revenue: 72000,
        pendingTasks: 3,
        target: 85000,
        achieved: 72000,
        status: 'on-track',
        joinDate: '2023-01-10'
      },
      {
        id: 'EMP-6602',
        name: 'Nikhil Mehta',
        role: 'Custom Software & Cloud Rep',
        email: 'nikhil@digitree.in',
        phone: '+91 98102-33445',
        avatar: 'NM',
        leadsAssigned: 14,
        callsCompleted: 19,
        followupsCompleted: 9,
        demos: 2,
        proposals: 3,
        wonDeals: 1,
        revenue: 46000,
        pendingTasks: 4,
        target: 65000,
        achieved: 46000,
        status: 'on-track',
        joinDate: '2023-08-15'
      },
      {
        id: 'EMP-6603',
        name: 'Sneha Roy',
        role: 'SEO & Performance Marketing Exec',
        email: 'sneha@digitree.in',
        phone: '+91 97220-44551',
        avatar: 'SR',
        leadsAssigned: 9,
        callsCompleted: 12,
        followupsCompleted: 4,
        demos: 1,
        proposals: 2,
        wonDeals: 0,
        revenue: 17000,
        pendingTasks: 6,
        target: 50000,
        achieved: 17000,
        status: 'needs-attention',
        joinDate: '2024-03-01'
      },
      {
        id: 'EMP-6604',
        name: 'Arjun Kapoor',
        role: 'Tech Outsourcing Telecaller',
        email: 'arjun@digitree.in',
        phone: '+91 99110-77665',
        avatar: 'AK',
        leadsAssigned: 9,
        callsCompleted: 14,
        followupsCompleted: 4,
        demos: 0,
        proposals: 1,
        wonDeals: 0,
        revenue: 8000,
        pendingTasks: 9,
        target: 40000,
        achieved: 8000,
        status: 'overdue',
        joinDate: '2024-05-20'
      }
    ],
    leads: []
  },

  mpillar: {
    departmentId: 'mpillar',
    departmentName: 'M Pillar',
    tagline: 'Enterprise Infrastructure, Commercial Realty & Industrial Projects',
    themeColor: {
      name: 'amber',
      gradient: 'from-amber-600 to-orange-600',
      primaryText: 'text-amber-600',
      primaryBg: 'bg-amber-600',
      lightBg: 'bg-amber-50',
      badgeBg: 'bg-amber-100',
      badgeText: 'text-amber-800',
      borderColor: 'border-amber-200',
      buttonBg: 'bg-amber-600',
      buttonHover: 'hover:bg-amber-700',
      accentHex: '#D97706'
    },
    teamMembers: [
      {
        id: 'EMP-5501',
        name: 'Kavita Reddy',
        role: 'Enterprise Infra Solutions Lead',
        email: 'kavita@mpillar.com',
        phone: '+91 98201-33221',
        avatar: 'KR',
        leadsAssigned: 15,
        callsCompleted: 22,
        followupsCompleted: 13,
        demos: 3,
        proposals: 4,
        wonDeals: 2,
        revenue: 88000,
        pendingTasks: 2,
        target: 100000,
        achieved: 88000,
        status: 'on-track',
        joinDate: '2023-01-25'
      },
      {
        id: 'EMP-5502',
        name: 'Suresh Nambiar',
        role: 'Commercial Property & ERP Rep',
        email: 'suresh@mpillar.com',
        phone: '+91 98110-44552',
        avatar: 'SN',
        leadsAssigned: 12,
        callsCompleted: 17,
        followupsCompleted: 9,
        demos: 2,
        proposals: 3,
        wonDeals: 1,
        revenue: 55000,
        pendingTasks: 4,
        target: 75000,
        achieved: 55000,
        status: 'on-track',
        joinDate: '2023-09-01'
      },
      {
        id: 'EMP-5503',
        name: 'Sanjay Dutt',
        role: 'Industrial Projects Consultant',
        email: 'sanjay@mpillar.com',
        phone: '+91 97330-11228',
        avatar: 'SD',
        leadsAssigned: 9,
        callsCompleted: 11,
        followupsCompleted: 4,
        demos: 1,
        proposals: 2,
        wonDeals: 0,
        revenue: 22000,
        pendingTasks: 6,
        target: 60000,
        achieved: 22000,
        status: 'needs-attention',
        joinDate: '2024-02-10'
      },
      {
        id: 'EMP-5504',
        name: 'Ritu Bansal',
        role: 'Tender & Corporate Telecaller',
        email: 'ritu@mpillar.com',
        phone: '+91 96440-99887',
        avatar: 'RB',
        leadsAssigned: 9,
        callsCompleted: 13,
        followupsCompleted: 4,
        demos: 0,
        proposals: 1,
        wonDeals: 0,
        revenue: 10000,
        pendingTasks: 9,
        target: 45000,
        achieved: 10000,
        status: 'overdue',
        joinDate: '2024-06-01'
      }
    ],
    leads: []
  }
};
