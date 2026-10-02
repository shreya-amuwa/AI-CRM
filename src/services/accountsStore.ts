import { DepartmentId } from '../types/crm';

export interface DepartmentFinancialMetric {
  departmentId: string;
  departmentName: string;
  accentColor: string;
  logoUrl?: string;
  grossIncome: number;
  totalExpenses: number;
  netEarnings: number;
  profitMarginPct: number;
  monthlyTarget: number;
  targetAchievedPct: number;
  totalInvoicesCount: number;
  totalQuotationsCount: number;
  activeTeamMembersCount: number;
  topPerformerName: string;
}

export interface CorporateExpense {
  id: string;
  departmentId: string;
  departmentName: string;
  category: 
    | 'Cloud & Server Infrastructure'
    | 'API Subscriptions & Telecom'
    | 'Software & SaaS Licenses'
    | 'Corporate Office & Facilities'
    | 'Payroll & Executive Compensation'
    | 'Client Acquisition & Ad Spend'
    | 'Legal, Compliance & Retainers'
    | 'Hardware & Workstations';
  corporateReason: string;
  amount: number;
  date: string;
  paymentMode: string;
  approvedBy: string;
  invoiceRef: string;
  status: 'Settled' | 'Approved' | 'Pending Audit';
}

export interface DepartmentDailyExpense {
  departmentId: string;
  departmentName: string;
  accentColor: string;
  logoUrl?: string;
  todaySpent: number;
  dailyBudget: number;
  dailyBurnRate: number;
  budgetUtilizationPct: number;
  yesterdaySpent: number;
  changeVsYesterdayPct: number;
  dailyTransactionsCount: number;
  recentDailyReasons: {
    time: string;
    reason: string;
    category: string;
    amount: number;
    approvedBy: string;
  }[];
}

export interface DepartmentMonthlyExpense {
  departmentId: string;
  departmentName: string;
  accentColor: string;
  logoUrl?: string;
  currentMonth: string;
  monthlyBudget: number;
  monthlySpent: number;
  budgetUtilizationPct: number;
  previousMonthSpent: number;
  monthlyGrowthPct: number;
  topCategory: string;
  topCategoryAmount: number;
  monthlyBreakdownByCategory: {
    category: string;
    amount: number;
    pct: number;
  }[];
}

export interface InvoiceItem {
  description: string;
  sacCode?: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface DepartmentInvoice {
  id: string;
  invoiceNumber: string;
  departmentId: string;
  departmentName: string;
  clientName: string;
  clientCompany: string;
  clientGst?: string;
  clientAddress: string;
  clientEmail: string;
  clientPhone?: string;
  teamMemberId: string;
  teamMemberName: string;
  teamMemberRole: string;
  issuedDate: string;
  dueDate: string;
  status: 'Paid' | 'Pending' | 'Overdue';
  paymentDate?: string;
  items: InvoiceItem[];
  subtotal: number;
  taxRate: number; // e.g. 18 for 18% GST
  taxAmount: number;
  totalAmount: number;
  notes?: string;
}

export interface QuotationItem {
  description: string;
  scope: string;
  timeline: string;
  amount: number;
}

export interface DepartmentQuotation {
  id: string;
  quotationNumber: string;
  departmentId: string;
  departmentName: string;
  clientName: string;
  clientCompany: string;
  clientAddress: string;
  clientEmail: string;
  clientPhone?: string;
  teamMemberId: string;
  teamMemberName: string;
  teamMemberRole: string;
  issuedDate: string;
  validUntil: string;
  status: 'Accepted' | 'Sent' | 'Under Review';
  estimatedValue: number;
  items: QuotationItem[];
  terms: string;
}

export interface TeamMemberPerformance {
  teamMemberId: string;
  name: string;
  role: string;
  departmentId: string;
  avatar?: string;
  totalBusinessClosed: number; // Invoiced and collected
  totalInvoicesCount: number;
  totalQuotationsCount: number;
  conversionRatePct: number;
  activeDealsCount: number;
  status: 'Top Performer' | 'Target Achieved' | 'On Track';
}

// Initial Data Seed
const INITIAL_FINANCIAL_METRICS: DepartmentFinancialMetric[] = [
  {
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    accentColor: '#10B981',
    logoUrl: '/logos/wabastore.png',
    grossIncome: 1845000,
    totalExpenses: 560000,
    netEarnings: 1285000,
    profitMarginPct: 69.6,
    monthlyTarget: 2000000,
    targetAchievedPct: 92.3,
    totalInvoicesCount: 14,
    totalQuotationsCount: 19,
    activeTeamMembersCount: 6,
    topPerformerName: 'Vikram Singhania'
  },
  {
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    accentColor: '#16A34A',
    logoUrl: '/logos/wabastar.png',
    grossIncome: 1520000,
    totalExpenses: 470000,
    netEarnings: 1050000,
    profitMarginPct: 69.1,
    monthlyTarget: 1700000,
    targetAchievedPct: 89.4,
    totalInvoicesCount: 11,
    totalQuotationsCount: 16,
    activeTeamMembersCount: 5,
    topPerformerName: 'Karthik Raman'
  },
  {
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    accentColor: '#06B6D4',
    logoUrl: '/logos/whatsbox.png',
    grossIncome: 1390000,
    totalExpenses: 427000,
    netEarnings: 963000,
    profitMarginPct: 69.3,
    monthlyTarget: 1500000,
    targetAchievedPct: 92.7,
    totalInvoicesCount: 10,
    totalQuotationsCount: 14,
    activeTeamMembersCount: 4,
    topPerformerName: 'Meera Nambiar'
  },
  {
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    accentColor: '#8B5CF6',
    logoUrl: '/logos/dtalk.png',
    grossIncome: 1240000,
    totalExpenses: 400000,
    netEarnings: 840000,
    profitMarginPct: 67.7,
    monthlyTarget: 1400000,
    targetAchievedPct: 88.6,
    totalInvoicesCount: 9,
    totalQuotationsCount: 13,
    activeTeamMembersCount: 4,
    topPerformerName: 'Rohan Deshmukh'
  },
  {
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    accentColor: '#EC4899',
    logoUrl: '/logos/digitree.png',
    grossIncome: 1680000,
    totalExpenses: 520000,
    netEarnings: 1160000,
    profitMarginPct: 69.0,
    monthlyTarget: 1800000,
    targetAchievedPct: 93.3,
    totalInvoicesCount: 12,
    totalQuotationsCount: 15,
    activeTeamMembersCount: 5,
    topPerformerName: 'Arjun Kapoor'
  },
  {
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    accentColor: '#F59E0B',
    logoUrl: '/logos/mpillar.png',
    grossIncome: 1450000,
    totalExpenses: 460000,
    netEarnings: 990000,
    profitMarginPct: 68.3,
    monthlyTarget: 1600000,
    targetAchievedPct: 90.6,
    totalInvoicesCount: 8,
    totalQuotationsCount: 12,
    activeTeamMembersCount: 4,
    topPerformerName: 'Rajesh Verma'
  }
];

const INITIAL_EXPENSES: CorporateExpense[] = [
  // Wabastore Corporate Expenses
  {
    id: 'EXP-WABA-001',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    category: 'Cloud & Server Infrastructure',
    corporateReason: 'AWS High-Availability Cloud Server Cluster hosting & Amazon S3 multi-zone automated backups for e-commerce catalog storage',
    amount: 84500,
    date: '2026-09-02',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'AWS-INV-9928172',
    status: 'Settled'
  },
  {
    id: 'EXP-WABA-002',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    category: 'API Subscriptions & Telecom',
    corporateReason: 'Meta Cloud WhatsApp Business API conversation credits renewal (Tier-4 high volume commerce messaging)',
    amount: 125000,
    date: '2026-09-05',
    paymentMode: 'Corporate Credit Card',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'META-API-882194',
    status: 'Settled'
  },
  {
    id: 'EXP-WABA-003',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    category: 'Software & SaaS Licenses',
    corporateReason: 'Shopify Plus Enterprise & Headless E-Commerce storefront API connectors subscription',
    amount: 45000,
    date: '2026-09-10',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'SHOP-SUB-11204',
    status: 'Settled'
  },
  {
    id: 'EXP-WABA-004',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    category: 'Payroll & Executive Compensation',
    corporateReason: 'Monthly corporate staff payroll allocation for Wabastore core commercial sales executives and technical leads',
    amount: 210000,
    date: '2026-09-01',
    paymentMode: 'RazorpayX Corporate Payroll',
    approvedBy: 'Super Admin',
    invoiceRef: 'PAYROLL-AMW-202609',
    status: 'Settled'
  },
  {
    id: 'EXP-WABA-005',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    category: 'Client Acquisition & Ad Spend',
    corporateReason: 'Meta Click-to-WhatsApp performance marketing campaign for Q3 direct merchant lead acquisition',
    amount: 95500,
    date: '2026-09-18',
    paymentMode: 'Corporate Credit Card',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'FB-ADS-4491028',
    status: 'Settled'
  },

  // Wabastar Corporate Expenses
  {
    id: 'EXP-WBST-001',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    category: 'Cloud & Server Infrastructure',
    corporateReason: 'Enterprise WhatsApp Cloud multi-tenant orchestration node hosting & Redis queuing infrastructure',
    amount: 62000,
    date: '2026-09-03',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'DO-CLOUD-77182',
    status: 'Settled'
  },
  {
    id: 'EXP-WBST-002',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    category: 'API Subscriptions & Telecom',
    corporateReason: 'Meta WhatsApp BSP high-throughput dedicated messaging bandwidth and official API quotas',
    amount: 110000,
    date: '2026-09-07',
    paymentMode: 'Corporate Credit Card',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'META-BSP-99182',
    status: 'Settled'
  },
  {
    id: 'EXP-WBST-003',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    category: 'Payroll & Executive Compensation',
    corporateReason: 'Monthly corporate payroll allocation for Wabastar marketing automation engineering and account managers',
    amount: 185000,
    date: '2026-09-01',
    paymentMode: 'RazorpayX Corporate Payroll',
    approvedBy: 'Super Admin',
    invoiceRef: 'PAYROLL-AMW-202609',
    status: 'Settled'
  },
  {
    id: 'EXP-WBST-004',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    category: 'Software & SaaS Licenses',
    corporateReason: 'HubSpot Marketing Enterprise automation seats and Zapier high-frequency webhook tiers',
    amount: 38000,
    date: '2026-09-14',
    paymentMode: 'Corporate Credit Card',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'HUBSP-INV-44109',
    status: 'Settled'
  },
  {
    id: 'EXP-WBST-005',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    category: 'Client Acquisition & Ad Spend',
    corporateReason: 'Google Search Ads & B2B intent targeting campaign for high-value enterprise marketing automation accounts',
    amount: 75000,
    date: '2026-09-20',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'GGL-ADS-88129',
    status: 'Settled'
  },

  // Whatsbox Corporate Expenses
  {
    id: 'EXP-WBOX-001',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    category: 'Cloud & Server Infrastructure',
    corporateReason: 'Kubernetes ingress controller & Elasticsearch cluster hosting for high-speed multi-agent live chat search',
    amount: 54000,
    date: '2026-09-04',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'AWS-K8S-33918',
    status: 'Settled'
  },
  {
    id: 'EXP-WBOX-002',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    category: 'API Subscriptions & Telecom',
    corporateReason: 'WhatsApp BSP session credits & official Meta Verified Green Badge processing fees for corporate clients',
    amount: 98000,
    date: '2026-09-08',
    paymentMode: 'Corporate Credit Card',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'META-GREEN-2901',
    status: 'Settled'
  },
  {
    id: 'EXP-WBOX-003',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    category: 'Software & SaaS Licenses',
    corporateReason: 'Intercom & Zendesk enterprise live multi-agent ticketing license renewals',
    amount: 42000,
    date: '2026-09-12',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'ZEN-SUB-77109',
    status: 'Settled'
  },
  {
    id: 'EXP-WBOX-004',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    category: 'Payroll & Executive Compensation',
    corporateReason: 'Client success managers & outbound sales representatives monthly compensation disbursement',
    amount: 165000,
    date: '2026-09-01',
    paymentMode: 'RazorpayX Corporate Payroll',
    approvedBy: 'Super Admin',
    invoiceRef: 'PAYROLL-AMW-202609',
    status: 'Settled'
  },
  {
    id: 'EXP-WBOX-005',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    category: 'Client Acquisition & Ad Spend',
    corporateReason: 'LinkedIn Sponsored Content & B2B Decision Maker targeted outbound outreach campaign',
    amount: 68000,
    date: '2026-09-19',
    paymentMode: 'Corporate Credit Card',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'LNKD-ADS-99120',
    status: 'Settled'
  },

  // D Talk Corporate Expenses
  {
    id: 'EXP-DTLK-001',
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    category: 'API Subscriptions & Telecom',
    corporateReason: 'Tata Teleservices & Bharti Airtel enterprise SIP trunk lines and 100-channel PRI voice telecom gateway',
    amount: 115000,
    date: '2026-09-03',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'TATA-TEL-99182',
    status: 'Settled'
  },
  {
    id: 'EXP-DTLK-002',
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    category: 'Cloud & Server Infrastructure',
    corporateReason: 'Cloud telephony encrypted call recording storage & AWS S3 regulatory compliance vault for TRAI audits',
    amount: 48000,
    date: '2026-09-06',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'AWS-REC-11928',
    status: 'Settled'
  },
  {
    id: 'EXP-DTLK-003',
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    category: 'Payroll & Executive Compensation',
    corporateReason: 'Telephony operations supervisors, quality analysts and outbound lead telecallers team payroll',
    amount: 170000,
    date: '2026-09-01',
    paymentMode: 'RazorpayX Corporate Payroll',
    approvedBy: 'Super Admin',
    invoiceRef: 'PAYROLL-AMW-202609',
    status: 'Settled'
  },
  {
    id: 'EXP-DTLK-004',
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    category: 'Software & SaaS Licenses',
    corporateReason: 'Asterisk PBX enterprise switch maintenance retainer and automated predictive dialer licenses',
    amount: 35000,
    date: '2026-09-15',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'AST-LIC-4491',
    status: 'Settled'
  },
  {
    id: 'EXP-DTLK-005',
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    category: 'Hardware & Workstations',
    corporateReason: 'Enterprise noise-cancelling telephony headsets & IP desk phones procurement for expanding call floor',
    amount: 32000,
    date: '2026-09-22',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'JABRA-PO-8812',
    status: 'Settled'
  },

  // Digitree Corporate Expenses
  {
    id: 'EXP-DIGI-001',
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    category: 'Cloud & Server Infrastructure',
    corporateReason: 'Google Cloud Platform BigQuery, Vertex AI infrastructure pipeline & Cloud Run serverless microservices',
    amount: 78000,
    date: '2026-09-04',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'GCP-INV-77281',
    status: 'Settled'
  },
  {
    id: 'EXP-DIGI-002',
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    category: 'Software & SaaS Licenses',
    corporateReason: 'GitHub Enterprise multi-seat organization license & Datadog application performance monitoring (APM)',
    amount: 49000,
    date: '2026-09-09',
    paymentMode: 'Corporate Credit Card',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'GHUB-ENT-9912',
    status: 'Settled'
  },
  {
    id: 'EXP-DIGI-003',
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    category: 'Payroll & Executive Compensation',
    corporateReason: 'Full-stack software engineers, cloud architects, and QA engineers monthly salary compensation',
    amount: 240000,
    date: '2026-09-01',
    paymentMode: 'RazorpayX Corporate Payroll',
    approvedBy: 'Super Admin',
    invoiceRef: 'PAYROLL-AMW-202609',
    status: 'Settled'
  },
  {
    id: 'EXP-DIGI-004',
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    category: 'Corporate Office & Facilities',
    corporateReason: 'High-speed dedicated leased line fiber internet (1 Gbps synchronous) with static IP allocation',
    amount: 28000,
    date: '2026-09-11',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'ACT-CORP-3319',
    status: 'Settled'
  },
  {
    id: 'EXP-DIGI-005',
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    category: 'Legal, Compliance & Retainers',
    corporateReason: 'ISO/IEC 27001 Information Security certification surveillance audit & SOC-2 compliance advisory retainer',
    amount: 65000,
    date: '2026-09-24',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'AUDIT-SOC-8821',
    status: 'Approved'
  },

  // M Pillar Corporate Expenses
  {
    id: 'EXP-MPIL-001',
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    category: 'Software & SaaS Licenses',
    corporateReason: 'Autodesk BIM 360 & Enterprise Construction Project ERP cloud licensing suite',
    amount: 65000,
    date: '2026-09-05',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'AUTO-BIM-99182',
    status: 'Settled'
  },
  {
    id: 'EXP-MPIL-002',
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    category: 'Cloud & Server Infrastructure',
    corporateReason: 'CAD blueprint rendering servers & AWS GovCloud high-security architectural asset storage vault',
    amount: 42000,
    date: '2026-09-08',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'AWS-CAD-1129',
    status: 'Settled'
  },
  {
    id: 'EXP-MPIL-003',
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    category: 'Payroll & Executive Compensation',
    corporateReason: 'Project managers, civil infrastructure site engineers & procurement specialists monthly payroll',
    amount: 220000,
    date: '2026-09-01',
    paymentMode: 'RazorpayX Corporate Payroll',
    approvedBy: 'Super Admin',
    invoiceRef: 'PAYROLL-AMW-202609',
    status: 'Settled'
  },
  {
    id: 'EXP-MPIL-004',
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    category: 'Corporate Office & Facilities',
    corporateReason: 'Corporate logistics, regional site inspection fleet fuel retainers & safety compliance gear',
    amount: 58000,
    date: '2026-09-17',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Accounts Head (Rajiv Khanna)',
    invoiceRef: 'SITE-EXP-7729',
    status: 'Settled'
  },
  {
    id: 'EXP-MPIL-005',
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    category: 'Legal, Compliance & Retainers',
    corporateReason: 'Commercial construction contract review, RERA regulatory filings & corporate legal counsel retainer',
    amount: 75000,
    date: '2026-09-21',
    paymentMode: 'Corporate Wire (HDFC Current A/C)',
    approvedBy: 'Super Admin',
    invoiceRef: 'LEGAL-RERA-5512',
    status: 'Settled'
  }
];

const INITIAL_INVOICES: DepartmentInvoice[] = [
  // Wabastore Invoices
  {
    id: 'INV-WABA-2024-001',
    invoiceNumber: 'INV-WABA-2024-001',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    clientName: 'Rajesh Mehra',
    clientCompany: 'Titan Company Limited',
    clientGst: '29AAACT2727Q1ZB',
    clientAddress: 'Tower A, Electronics City Phase 1, Hosur Road, Bangalore, Karnataka - 560100',
    clientEmail: 'rajesh.mehra@titan.co.in',
    clientPhone: '+91 98450 99881',
    teamMemberId: 'EMP-1042',
    teamMemberName: 'Priya Nair',
    teamMemberRole: 'Senior Enterprise Account Executive',
    issuedDate: '2026-09-08',
    dueDate: '2026-09-22',
    status: 'Paid',
    paymentDate: '2026-09-16',
    items: [
      { description: 'Enterprise WhatsApp E-Commerce Catalog Setup & Integration', sacCode: '998314', quantity: 1, rate: 250000, amount: 250000 },
      { description: 'Automated Real-time Order Notification Webhook Gateway', sacCode: '998313', quantity: 12, rate: 15000, amount: 180000 }
    ],
    subtotal: 430000,
    taxRate: 18,
    taxAmount: 77400,
    totalAmount: 507400,
    notes: 'Payment received in full via HDFC Bank NEFT transaction UTR #HDFCN262591024'
  },
  {
    id: 'INV-WABA-2024-002',
    invoiceNumber: 'INV-WABA-2024-002',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    clientName: 'Sanjay Kapoor',
    clientCompany: 'FabIndia Overseas Pvt Ltd',
    clientGst: '07AABCF1234D1Z5',
    clientAddress: 'Plot No. 14, Okhla Industrial Area Phase 3, New Delhi - 110020',
    clientEmail: 'sanjay.kapoor@fabindia.com',
    clientPhone: '+91 98110 44221',
    teamMemberId: 'EMP-1001',
    teamMemberName: 'Vikram Singhania',
    teamMemberRole: 'Head of Sales & Commercials',
    issuedDate: '2026-09-12',
    dueDate: '2026-09-26',
    status: 'Paid',
    paymentDate: '2026-09-20',
    items: [
      { description: 'Omnichannel Direct-to-Consumer WhatsApp Storefront Engine', sacCode: '998314', quantity: 1, rate: 320000, amount: 320000 },
      { description: 'High-Volume Payment Gateway Integration (Razorpay & PayU)', sacCode: '998313', quantity: 1, rate: 85000, amount: 85000 }
    ],
    subtotal: 405000,
    taxRate: 18,
    taxAmount: 72900,
    totalAmount: 477900,
    notes: 'Full payment cleared via Corporate RTGS'
  },
  {
    id: 'INV-WABA-2024-003',
    invoiceNumber: 'INV-WABA-2024-003',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    clientName: 'Alok Sharma',
    clientCompany: 'Metro Brands Limited',
    clientGst: '27AABCM8821K1Z2',
    clientAddress: '401 Zillion, LBS Marg, Kurla West, Mumbai, Maharashtra - 400070',
    clientEmail: 'alok.s@metrobrands.com',
    clientPhone: '+91 98200 77112',
    teamMemberId: 'EMP-1058',
    teamMemberName: 'Rahul Kumar',
    teamMemberRole: 'Mid-Market Sales Specialist',
    issuedDate: '2026-09-18',
    dueDate: '2026-10-02',
    status: 'Pending',
    items: [
      { description: 'WhatsApp Cart Recovery & Automated Retargeting Flow System', sacCode: '998314', quantity: 1, rate: 180000, amount: 180000 },
      { description: 'Customer Loyalty & Points Redemption Chatbot Engine', sacCode: '998313', quantity: 1, rate: 120000, amount: 120000 }
    ],
    subtotal: 300000,
    taxRate: 18,
    taxAmount: 54000,
    totalAmount: 354000,
    notes: 'Invoice under accounts verification at client headquarters'
  },
  {
    id: 'INV-WABA-2024-004',
    invoiceNumber: 'INV-WABA-2024-004',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    clientName: 'Nisha Aggarwal',
    clientCompany: 'Licious (Delightful Gourmet Pvt Ltd)',
    clientGst: '29AAACD5591L1ZV',
    clientAddress: 'Maruthi Chambers, Main Hosur Road, Bangalore - 560068',
    clientEmail: 'nisha.a@licious.com',
    clientPhone: '+91 99002 33119',
    teamMemberId: 'EMP-1073',
    teamMemberName: 'Amit Patel',
    teamMemberRole: 'Business Development Specialist',
    issuedDate: '2026-09-22',
    dueDate: '2026-10-06',
    status: 'Paid',
    paymentDate: '2026-09-27',
    items: [
      { description: 'Quick-Commerce Hyperlocal WhatsApp Delivery Alerts Platform', sacCode: '998314', quantity: 1, rate: 220000, amount: 220000 },
      { description: 'Custom Delivery Agent Interactive Dispatch WhatsApp Bot', sacCode: '998313', quantity: 1, rate: 110000, amount: 110000 }
    ],
    subtotal: 330000,
    taxRate: 18,
    taxAmount: 59400,
    totalAmount: 389400,
    notes: 'Payment confirmed via Net Banking'
  },

  // Wabastar Invoices
  {
    id: 'INV-WBST-2024-001',
    invoiceNumber: 'INV-WBST-2024-001',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    clientName: 'Vikram Joshi',
    clientCompany: 'PolicyBazaar (Quick Online Services)',
    clientGst: '06AABCP9918Q1Z1',
    clientAddress: 'Plot 119, Sector 44, Gurugram, Haryana - 122001',
    clientEmail: 'vikram.joshi@policybazaar.com',
    clientPhone: '+91 98112 55990',
    teamMemberId: 'EMP-WBS-01',
    teamMemberName: 'Karthik Raman',
    teamMemberRole: 'Enterprise Sales Director',
    issuedDate: '2026-09-04',
    dueDate: '2026-09-18',
    status: 'Paid',
    paymentDate: '2026-09-14',
    items: [
      { description: 'Automated Insurance Renewal WhatsApp Broadcast Pipeline', sacCode: '998314', quantity: 1, rate: 350000, amount: 350000 },
      { description: 'Interactive KYC Document Collection WhatsApp Flow', sacCode: '998313', quantity: 1, rate: 140000, amount: 140000 }
    ],
    subtotal: 490000,
    taxRate: 18,
    taxAmount: 88200,
    totalAmount: 578200,
    notes: 'Paid via Corporate Wire'
  },
  {
    id: 'INV-WBST-2024-002',
    invoiceNumber: 'INV-WBST-2024-002',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    clientName: 'Deepak Sen',
    clientCompany: 'Nykaa E-Retail Limited',
    clientGst: '27AABCN7782P1Z0',
    clientAddress: '104 Vasan Udyog Bhavan, Sun Mill Compound, Lower Parel, Mumbai - 400013',
    clientEmail: 'deepak.sen@nykaa.com',
    clientPhone: '+91 98201 11445',
    teamMemberId: 'EMP-WBS-02',
    teamMemberName: 'Ananya Sen',
    teamMemberRole: 'Key Account Manager',
    issuedDate: '2026-09-15',
    dueDate: '2026-09-29',
    status: 'Paid',
    paymentDate: '2026-09-25',
    items: [
      { description: 'Personalized Beauty Recommendation WhatsApp Automation', sacCode: '998314', quantity: 1, rate: 290000, amount: 290000 },
      { description: 'Meta Official Green Tick Verification Services & Filing', sacCode: '998313', quantity: 1, rate: 60000, amount: 60000 }
    ],
    subtotal: 350000,
    taxRate: 18,
    taxAmount: 63000,
    totalAmount: 413000,
    notes: 'Cleared via NEFT'
  },

  // Whatsbox Invoices
  {
    id: 'INV-WBOX-2024-001',
    invoiceNumber: 'INV-WBOX-2024-001',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    clientName: 'Kunal Singhal',
    clientCompany: 'CaratLane Trading Pvt Ltd',
    clientGst: '33AABCC1129F1Z3',
    clientAddress: 'Rutland Gate 4th Street, Nungambakkam, Chennai, Tamil Nadu - 600006',
    clientEmail: 'kunal.s@caratlane.com',
    clientPhone: '+91 94440 22119',
    teamMemberId: 'EMP-WBX-01',
    teamMemberName: 'Meera Nambiar',
    teamMemberRole: 'Head of Business Development',
    issuedDate: '2026-09-07',
    dueDate: '2026-09-21',
    status: 'Paid',
    paymentDate: '2026-09-18',
    items: [
      { description: 'Whatsbox Unified Multi-Agent Shared Inbox (25 Agent Licenses)', sacCode: '998314', quantity: 25, rate: 12000, amount: 300000 },
      { description: 'Live Video Consultation Scheduling WhatsApp Bot', sacCode: '998313', quantity: 1, rate: 95000, amount: 95000 }
    ],
    subtotal: 395000,
    taxRate: 18,
    taxAmount: 71100,
    totalAmount: 466100,
    notes: 'Paid in full'
  },
  {
    id: 'INV-WBOX-2024-002',
    invoiceNumber: 'INV-WBOX-2024-002',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    clientName: 'Pooja Bhatt',
    clientCompany: 'FirstCry (Brainbees Solutions Ltd)',
    clientGst: '27AABCB9912M1Z8',
    clientAddress: 'Rajashree Sachchidanand Society, Baner Road, Pune - 411045',
    clientEmail: 'pooja.bhatt@firstcry.com',
    clientPhone: '+91 98230 44556',
    teamMemberId: 'EMP-WBX-02',
    teamMemberName: 'Varun Gupta',
    teamMemberRole: 'Enterprise Sales Manager',
    issuedDate: '2026-09-19',
    dueDate: '2026-10-03',
    status: 'Pending',
    items: [
      { description: 'Customer Support Escalation & WhatsApp SLA Ticketing Integration', sacCode: '998314', quantity: 1, rate: 260000, amount: 260000 },
      { description: 'Automated Post-Purchase Feedback & Review Gathering Bot', sacCode: '998313', quantity: 1, rate: 75000, amount: 75000 }
    ],
    subtotal: 335000,
    taxRate: 18,
    taxAmount: 60300,
    totalAmount: 395300,
    notes: 'Under client finance review'
  },

  // D Talk Invoices
  {
    id: 'INV-DTLK-2024-001',
    invoiceNumber: 'INV-DTLK-2024-001',
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    clientName: 'Harish Mehta',
    clientCompany: 'Indiabulls Housing Finance Limited',
    clientGst: '07AABCI4419E1Z7',
    clientAddress: 'One Indiabulls Centre, Tower 1, Elphinstone Road, Mumbai - 400013',
    clientEmail: 'harish.mehta@indiabulls.com',
    clientPhone: '+91 98204 88192',
    teamMemberId: 'EMP-DTK-01',
    teamMemberName: 'Rohan Deshmukh',
    teamMemberRole: 'Telecom Enterprise Lead',
    issuedDate: '2026-09-10',
    dueDate: '2026-09-24',
    status: 'Paid',
    paymentDate: '2026-09-22',
    items: [
      { description: 'Cloud Voice PRI Integration & 50-Agent Predictive Dialer Setup', sacCode: '998314', quantity: 1, rate: 280000, amount: 280000 },
      { description: 'Call Recording Compliance Vault & TRAI Regulatory Archival', sacCode: '998313', quantity: 1, rate: 95000, amount: 95000 }
    ],
    subtotal: 375000,
    taxRate: 18,
    taxAmount: 67500,
    totalAmount: 442500,
    notes: 'Paid via RTGS'
  },

  // Digitree Invoices
  {
    id: 'INV-DIGI-2024-001',
    invoiceNumber: 'INV-DIGI-2024-001',
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    clientName: 'Sunil Rao',
    clientCompany: 'Wipro Technologies Limited',
    clientGst: '29AAACW1192M1ZA',
    clientAddress: 'Doddakannelli, Sarjapur Road, Bangalore, Karnataka - 560035',
    clientEmail: 'sunil.rao@wipro.com',
    clientPhone: '+91 98451 77229',
    teamMemberId: 'EMP-DGT-01',
    teamMemberName: 'Arjun Kapoor',
    teamMemberRole: 'Solutions Architect & Sales Lead',
    issuedDate: '2026-09-06',
    dueDate: '2026-09-20',
    status: 'Paid',
    paymentDate: '2026-09-15',
    items: [
      { description: 'Enterprise AIQR Dynamic QR Generation Platform Deployment', sacCode: '998314', quantity: 1, rate: 340000, amount: 340000 },
      { description: 'High-Volume Scan Analytics & Geo-Targeting Dashboard API', sacCode: '998313', quantity: 1, rate: 140000, amount: 140000 }
    ],
    subtotal: 480000,
    taxRate: 18,
    taxAmount: 86400,
    totalAmount: 566400,
    notes: 'Cleared via Corporate Wire'
  },

  // M Pillar Invoices
  {
    id: 'INV-MPIL-2024-001',
    invoiceNumber: 'INV-MPIL-2024-001',
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    clientName: 'Ramesh Reddy',
    clientCompany: 'Prestige Estates Projects Ltd',
    clientGst: '29AABCP3391K1ZY',
    clientAddress: 'Prestige Falcon Towers, 19 Brunton Road, Bangalore - 560025',
    clientEmail: 'ramesh.reddy@prestigeconstructions.com',
    clientPhone: '+91 98455 33001',
    teamMemberId: 'EMP-MPL-01',
    teamMemberName: 'Rajesh Verma',
    teamMemberRole: 'Infrastructure Projects Director',
    issuedDate: '2026-09-11',
    dueDate: '2026-09-25',
    status: 'Paid',
    paymentDate: '2026-09-23',
    items: [
      { description: 'Cloud Construction Site Material Procurement & ERP Tracking Module', sacCode: '998314', quantity: 1, rate: 310000, amount: 310000 },
      { description: 'Subcontractor Milestone Verification & Digital Billing Portal', sacCode: '998313', quantity: 1, rate: 115000, amount: 115000 }
    ],
    subtotal: 425000,
    taxRate: 18,
    taxAmount: 76500,
    totalAmount: 501500,
    notes: 'Paid via HDFC NEFT'
  }
];

const INITIAL_QUOTATIONS: DepartmentQuotation[] = [
  // Wabastore Quotations
  {
    id: 'QT-WABA-2024-101',
    quotationNumber: 'QT-WABA-2024-101',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    clientName: 'Vikas Tandon',
    clientCompany: 'Tata Consumer Products Ltd',
    clientAddress: 'Kirloskar Business Park, Bellary Road, Hebbal, Bangalore - 560024',
    clientEmail: 'vikas.t@tataconsumer.com',
    clientPhone: '+91 98450 66778',
    teamMemberId: 'EMP-1001',
    teamMemberName: 'Vikram Singhania',
    teamMemberRole: 'Head of Sales & Commercials',
    issuedDate: '2026-09-21',
    validUntil: '2026-10-21',
    status: 'Accepted',
    estimatedValue: 680000,
    items: [
      { description: 'Omnichannel WhatsApp Direct-to-Consumer Storefront Engine', scope: 'Complete multi-brand product catalog with automated shopping cart and instant checkout', timeline: '3 Weeks', amount: 450000 },
      { description: 'Custom ERP Inventory Sync Middleware & Webhook Pipes', scope: 'Real-time stock reservation, low-stock triggers, and automated warehouse dispatch alerts', timeline: '2 Weeks', amount: 230000 }
    ],
    terms: 'Commercial milestone: 50% mobilization advance on work order, 50% upon UAT sign-off. Includes 6 months complimentary tier-1 maintenance and SLA.'
  },
  {
    id: 'QT-WABA-2024-102',
    quotationNumber: 'QT-WABA-2024-102',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    clientName: 'Shreya Sengupta',
    clientCompany: 'Mamaearth (Honasa Consumer Ltd)',
    clientAddress: 'Plot 4, Sector 18, Electronic City, Gurgaon - 122008',
    clientEmail: 'shreya.s@mamaearth.in',
    clientPhone: '+91 98102 33441',
    teamMemberId: 'EMP-1042',
    teamMemberName: 'Priya Nair',
    teamMemberRole: 'Senior Enterprise Account Executive',
    issuedDate: '2026-09-24',
    validUntil: '2026-10-24',
    status: 'Sent',
    estimatedValue: 420000,
    items: [
      { description: 'WhatsApp Conversational Commerce & Personalized Product Quiz Bot', scope: 'Custom interactive skin/hair assessment quiz driving dynamic cart bundle recommendations', timeline: '2 Weeks', amount: 260000 },
      { description: 'Omnichannel WhatsApp Click-to-Chat Ad Conversion Tracking Engine', scope: 'Meta offline conversion API integration for zero-loss ROAS measurement', timeline: '10 Days', amount: 160000 }
    ],
    terms: 'Proposal valid for 30 calendar days from issuance. Commercial pricing includes cloud staging deployment.'
  },
  {
    id: 'QT-WABA-2024-103',
    quotationNumber: 'QT-WABA-2024-103',
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    clientName: 'Nitin Gadgil',
    clientCompany: 'Blinkit Commerce Pvt Ltd',
    clientAddress: 'Golf Course Extension Road, Sector 62, Gurugram, Haryana - 122002',
    clientEmail: 'nitin.g@blinkit.com',
    clientPhone: '+91 97118 44002',
    teamMemberId: 'EMP-1058',
    teamMemberName: 'Rahul Kumar',
    teamMemberRole: 'Mid-Market Sales Specialist',
    issuedDate: '2026-09-27',
    validUntil: '2026-10-27',
    status: 'Under Review',
    estimatedValue: 310000,
    items: [
      { description: 'Hyperlocal 10-Minute Grocery Delivery WhatsApp Tracking Gateway', scope: 'Real-time rider GPS milestone updates and automated instant refund status bot', timeline: '14 Days', amount: 310000 }
    ],
    terms: 'Payment terms: 100% post milestone deployment and TRAI DLT registration.'
  },

  // Wabastar Quotations
  {
    id: 'QT-WBST-2024-101',
    quotationNumber: 'QT-WBST-2024-101',
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    clientName: 'Abhishek Roy',
    clientCompany: 'Zomato Limited',
    clientAddress: 'Ground Floor, 12A, 94 Meghdoot, Nehru Place, New Delhi - 110019',
    clientEmail: 'abhishek.roy@zomato.com',
    clientPhone: '+91 98100 88229',
    teamMemberId: 'EMP-WBS-01',
    teamMemberName: 'Karthik Raman',
    teamMemberRole: 'Enterprise Sales Director',
    issuedDate: '2026-09-19',
    validUntil: '2026-10-19',
    status: 'Accepted',
    estimatedValue: 540000,
    items: [
      { description: 'High-Scale Restaurant Partner WhatsApp Onboarding Bot', scope: 'Automated FSSAI and GST document extraction with OCR validation', timeline: '3 Weeks', amount: 360000 },
      { description: 'Automated Daily Sales Performance & Menu Update Broadcaster', scope: 'Targeted broadcast pipeline sending daily earning summaries to 50k merchants', timeline: '10 Days', amount: 180000 }
    ],
    terms: 'Includes dedicated technical account manager support and 99.9% uptime SLA.'
  },

  // Whatsbox Quotations
  {
    id: 'QT-WBOX-2024-101',
    quotationNumber: 'QT-WBOX-2024-101',
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    clientName: 'Suresh Menon',
    clientCompany: 'Swiggy (Bundl Technologies Pvt Ltd)',
    clientAddress: 'Devarabisanahalli, Outer Ring Road, Bangalore - 560103',
    clientEmail: 'suresh.m@swiggy.in',
    clientPhone: '+91 99009 11228',
    teamMemberId: 'EMP-WBX-01',
    teamMemberName: 'Meera Nambiar',
    teamMemberRole: 'Head of Business Development',
    issuedDate: '2026-09-23',
    validUntil: '2026-10-23',
    status: 'Under Review',
    estimatedValue: 490000,
    items: [
      { description: 'Unified Multi-Department Live Chat Support Hub (50 Agent Seats)', scope: 'Real-time agent routing, canned responses, round-robin lead allocation, and supervisor whisper mode', timeline: '2 Weeks', amount: 370000 },
      { description: 'Customer Sentiment Analysis & AI Resolution Bot', scope: 'Automatic escalation of dissatisfied customers to human supervisors within 15 seconds', timeline: '10 Days', amount: 120000 }
    ],
    terms: 'Annual enterprise commitment with monthly billing post pilot.'
  },

  // D Talk Quotations
  {
    id: 'QT-DTLK-2024-101',
    quotationNumber: 'QT-DTLK-2024-101',
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    clientName: 'Girish Kulkarni',
    clientCompany: 'Bajaj Finance Limited',
    clientAddress: '4th Floor, Bajaj Finserv Corporate Office, Pune - 411014',
    clientEmail: 'girish.k@bajajfinserv.in',
    clientPhone: '+91 98220 55112',
    teamMemberId: 'EMP-DTK-01',
    teamMemberName: 'Rohan Deshmukh',
    teamMemberRole: 'Telecom Enterprise Lead',
    issuedDate: '2026-09-20',
    validUntil: '2026-10-20',
    status: 'Accepted',
    estimatedValue: 580000,
    items: [
      { description: 'Enterprise 100-Channel PRI Telecom Trunking & Automated Dialer Gateway', scope: 'High-availability voice termination with automatic failover and dual telecom carrier routes', timeline: '3 Weeks', amount: 410000 },
      { description: 'Voice Call Speech-to-Text & Quality Scoring Compliance Bot', scope: 'Real-time keyword spotting for regulatory compliance and agent adherence scoring', timeline: '2 Weeks', amount: 170000 }
    ],
    terms: 'Subject to TRAI DLT commercial approval.'
  },

  // Digitree Quotations
  {
    id: 'QT-DIGI-2024-101',
    quotationNumber: 'QT-DIGI-2024-101',
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    clientName: 'Manish Chawla',
    clientCompany: 'Cognizant Technology Solutions',
    clientAddress: 'DLF Cyber City, Phase 3, Gurugram, Haryana - 122002',
    clientEmail: 'manish.c@cognizant.com',
    clientPhone: '+91 98110 33991',
    teamMemberId: 'EMP-DGT-01',
    teamMemberName: 'Arjun Kapoor',
    teamMemberRole: 'Solutions Architect & Sales Lead',
    issuedDate: '2026-09-25',
    validUntil: '2026-10-25',
    status: 'Sent',
    estimatedValue: 620000,
    items: [
      { description: 'Enterprise Multi-Brand Dynamic QR Code Management Infrastructure', scope: 'Custom white-label portal with custom vanity short domains and encrypted analytics', timeline: '3 Weeks', amount: 420000 },
      { description: 'Enterprise SSO & Role-Based Access Control Integration (Okta / Azure AD)', scope: 'SAML 2.0 and OAuth2 enterprise directory sync', timeline: '10 Days', amount: 200000 }
    ],
    terms: 'Valid for 30 days.'
  },

  // M Pillar Quotations
  {
    id: 'QT-MPIL-2024-101',
    quotationNumber: 'QT-MPIL-2024-101',
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    clientName: 'Anil Agrawal',
    clientCompany: 'Godrej Properties Limited',
    clientAddress: 'Godrej One, 5th Floor, Pirojshanagar, Vikhroli East, Mumbai - 400079',
    clientEmail: 'anil.a@godrejproperties.com',
    clientPhone: '+91 98205 66114',
    teamMemberId: 'EMP-MPL-01',
    teamMemberName: 'Rajesh Verma',
    teamMemberRole: 'Infrastructure Projects Director',
    issuedDate: '2026-09-22',
    validUntil: '2026-10-22',
    status: 'Accepted',
    estimatedValue: 750000,
    items: [
      { description: 'Smart Construction Site Safety & Daily Labor Attendance IoT Suite', scope: 'Face recognition biometric time-tracking with automated contractor billing calculation', timeline: '4 Weeks', amount: 500000 },
      { description: 'Material Inventory Weighbridge Integration & Delivery Ticket Digitization', scope: 'Automated weighbridge gross-tare-net calculation with instant vendor invoice matching', timeline: '2 Weeks', amount: 250000 }
    ],
    terms: 'Mobilization within 14 business days.'
  }
];

// Team Members for each department with business numbers
const INITIAL_TEAM_MEMBERS: TeamMemberPerformance[] = [
  // Wabastore
  {
    teamMemberId: 'EMP-1001',
    name: 'Vikram Singhania',
    role: 'Head of Sales & Commercials',
    departmentId: 'wabastore',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 680000,
    totalInvoicesCount: 4,
    totalQuotationsCount: 5,
    conversionRatePct: 80.0,
    activeDealsCount: 7,
    status: 'Top Performer'
  },
  {
    teamMemberId: 'EMP-1042',
    name: 'Priya Nair',
    role: 'Senior Enterprise Account Executive',
    departmentId: 'wabastore',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 520000,
    totalInvoicesCount: 4,
    totalQuotationsCount: 6,
    conversionRatePct: 66.7,
    activeDealsCount: 8,
    status: 'Target Achieved'
  },
  {
    teamMemberId: 'EMP-1058',
    name: 'Rahul Kumar',
    role: 'Mid-Market Sales Specialist',
    departmentId: 'wabastore',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 345000,
    totalInvoicesCount: 3,
    totalQuotationsCount: 4,
    conversionRatePct: 75.0,
    activeDealsCount: 5,
    status: 'On Track'
  },
  {
    teamMemberId: 'EMP-1073',
    name: 'Amit Patel',
    role: 'Business Development Specialist',
    departmentId: 'wabastore',
    avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 300000,
    totalInvoicesCount: 3,
    totalQuotationsCount: 4,
    conversionRatePct: 75.0,
    activeDealsCount: 4,
    status: 'On Track'
  },

  // Wabastar
  {
    teamMemberId: 'EMP-WBS-01',
    name: 'Karthik Raman',
    role: 'Enterprise Sales Director',
    departmentId: 'wabastar',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 890000,
    totalInvoicesCount: 6,
    totalQuotationsCount: 8,
    conversionRatePct: 75.0,
    activeDealsCount: 6,
    status: 'Top Performer'
  },
  {
    teamMemberId: 'EMP-WBS-02',
    name: 'Ananya Sen',
    role: 'Key Account Manager',
    departmentId: 'wabastar',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 630000,
    totalInvoicesCount: 5,
    totalQuotationsCount: 8,
    conversionRatePct: 62.5,
    activeDealsCount: 5,
    status: 'Target Achieved'
  },

  // Whatsbox
  {
    teamMemberId: 'EMP-WBX-01',
    name: 'Meera Nambiar',
    role: 'Head of Business Development',
    departmentId: 'whatsbox',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 780000,
    totalInvoicesCount: 5,
    totalQuotationsCount: 7,
    conversionRatePct: 71.4,
    activeDealsCount: 6,
    status: 'Top Performer'
  },
  {
    teamMemberId: 'EMP-WBX-02',
    name: 'Varun Gupta',
    role: 'Enterprise Sales Manager',
    departmentId: 'whatsbox',
    avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 610000,
    totalInvoicesCount: 5,
    totalQuotationsCount: 7,
    conversionRatePct: 71.4,
    activeDealsCount: 5,
    status: 'Target Achieved'
  },

  // D Talk
  {
    teamMemberId: 'EMP-DTK-01',
    name: 'Rohan Deshmukh',
    role: 'Telecom Enterprise Lead',
    departmentId: 'dtalk',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 710000,
    totalInvoicesCount: 5,
    totalQuotationsCount: 7,
    conversionRatePct: 71.4,
    activeDealsCount: 5,
    status: 'Top Performer'
  },
  {
    teamMemberId: 'EMP-DTK-02',
    name: 'Alok Verma',
    role: 'Senior Voice Account Executive',
    departmentId: 'dtalk',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 530000,
    totalInvoicesCount: 4,
    totalQuotationsCount: 6,
    conversionRatePct: 66.7,
    activeDealsCount: 4,
    status: 'Target Achieved'
  },

  // Digitree
  {
    teamMemberId: 'EMP-DGT-01',
    name: 'Arjun Kapoor',
    role: 'Solutions Architect & Sales Lead',
    departmentId: 'digitree',
    avatar: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 920000,
    totalInvoicesCount: 6,
    totalQuotationsCount: 8,
    conversionRatePct: 75.0,
    activeDealsCount: 7,
    status: 'Top Performer'
  },
  {
    teamMemberId: 'EMP-DGT-02',
    name: 'Deepa Shenoy',
    role: 'Cloud Solutions Specialist',
    departmentId: 'digitree',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 760000,
    totalInvoicesCount: 6,
    totalQuotationsCount: 7,
    conversionRatePct: 85.7,
    activeDealsCount: 5,
    status: 'Target Achieved'
  },

  // M Pillar
  {
    teamMemberId: 'EMP-MPL-01',
    name: 'Rajesh Verma',
    role: 'Infrastructure Projects Director',
    departmentId: 'mpillar',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 840000,
    totalInvoicesCount: 5,
    totalQuotationsCount: 6,
    conversionRatePct: 83.3,
    activeDealsCount: 6,
    status: 'Top Performer'
  },
  {
    teamMemberId: 'EMP-MPL-02',
    name: 'Kunal Shah',
    role: 'Site Commercials Lead',
    departmentId: 'mpillar',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    totalBusinessClosed: 610000,
    totalInvoicesCount: 3,
    totalQuotationsCount: 6,
    conversionRatePct: 50.0,
    activeDealsCount: 4,
    status: 'Target Achieved'
  }
];

class AccountsStore {
  private metricsKey = 'amuwa_accounts_metrics_v2';
  private expensesKey = 'amuwa_accounts_expenses_v2';
  private invoicesKey = 'amuwa_accounts_invoices_v2';
  private quotationsKey = 'amuwa_accounts_quotations_v2';
  private membersKey = 'amuwa_accounts_members_v2';

  private load<T>(key: string, initial: T): T {
    try {
      const data = localStorage.getItem(key);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn(`Failed to parse localStorage key: ${key}`);
    }
    return initial;
  }

  private save<T>(key: string, data: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn(`Failed to save to localStorage key: ${key}`);
    }
  }

  // --- Financial Metrics ---
  getDepartmentMetrics(): DepartmentFinancialMetric[] {
    return this.load(this.metricsKey, INITIAL_FINANCIAL_METRICS);
  }

  getMetricsForDepartment(deptId: string): DepartmentFinancialMetric | undefined {
    const list = this.getDepartmentMetrics();
    return list.find(m => m.departmentId === deptId);
  }

  // Calculate Company-Wide Financial Totals
  getCompanyFinancialTotals() {
    const list = this.getDepartmentMetrics();
    const totalGrossIncome = list.reduce((acc, m) => acc + m.grossIncome, 0);
    const totalExpenses = list.reduce((acc, m) => acc + m.totalExpenses, 0);
    const totalNetEarnings = totalGrossIncome - totalExpenses;
    const overallMarginPct = totalGrossIncome > 0 ? (totalNetEarnings / totalGrossIncome) * 100 : 0;
    const totalMonthlyTarget = list.reduce((acc, m) => acc + m.monthlyTarget, 0);
    const targetAchievedPct = totalMonthlyTarget > 0 ? (totalGrossIncome / totalMonthlyTarget) * 100 : 0;

    return {
      totalGrossIncome,
      totalExpenses,
      totalNetEarnings,
      overallMarginPct: Math.round(overallMarginPct * 10) / 10,
      totalMonthlyTarget,
      targetAchievedPct: Math.round(targetAchievedPct * 10) / 10,
      activeDepartmentsCount: list.length
    };
  }

  // --- Corporate Expenses ---
  getExpenses(): CorporateExpense[] {
    return this.load(this.expensesKey, INITIAL_EXPENSES);
  }

  getExpensesForDepartment(deptId: string): CorporateExpense[] {
    const expenses = this.getExpenses();
    if (deptId === 'all') return expenses;
    return expenses.filter(e => e.departmentId === deptId);
  }

  addCorporateExpense(expense: Omit<CorporateExpense, 'id'>): CorporateExpense {
    const expenses = this.getExpenses();
    const newExpense: CorporateExpense = {
      ...expense,
      id: `EXP-${Date.now().toString().slice(-6)}`
    };
    expenses.unshift(newExpense);
    this.save(this.expensesKey, expenses);

    // Update the corresponding department's totalExpenses and netEarnings
    const metrics = this.getDepartmentMetrics();
    const deptMetric = metrics.find(m => m.departmentId === expense.departmentId);
    if (deptMetric) {
      deptMetric.totalExpenses += expense.amount;
      deptMetric.netEarnings = deptMetric.grossIncome - deptMetric.totalExpenses;
      deptMetric.profitMarginPct = Math.round((deptMetric.netEarnings / deptMetric.grossIncome) * 1000) / 10;
      this.save(this.metricsKey, metrics);
    }

    return newExpense;
  }

  // --- Invoices ---
  getInvoices(): DepartmentInvoice[] {
    return this.load(this.invoicesKey, INITIAL_INVOICES);
  }

  getInvoicesForDepartment(deptId: string): DepartmentInvoice[] {
    const invoices = this.getInvoices();
    if (deptId === 'all') return invoices;
    return invoices.filter(inv => inv.departmentId === deptId);
  }

  getInvoiceById(id: string): DepartmentInvoice | undefined {
    return this.getInvoices().find(i => i.id === id || i.invoiceNumber === id);
  }

  addInvoice(invoice: Omit<DepartmentInvoice, 'id'>): DepartmentInvoice {
    const invoices = this.getInvoices();
    const newInvoice: DepartmentInvoice = {
      ...invoice,
      id: `INV-${Date.now().toString().slice(-6)}`
    };
    invoices.unshift(newInvoice);
    this.save(this.invoicesKey, invoices);
    return newInvoice;
  }

  // --- Quotations ---
  getQuotations(): DepartmentQuotation[] {
    return this.load(this.quotationsKey, INITIAL_QUOTATIONS);
  }

  getQuotationsForDepartment(deptId: string): DepartmentQuotation[] {
    const quotes = this.getQuotations();
    if (deptId === 'all') return quotes;
    return quotes.filter(q => q.departmentId === deptId);
  }

  getQuotationById(id: string): DepartmentQuotation | undefined {
    return this.getQuotations().find(q => q.id === id || q.quotationNumber === id);
  }

  // --- Team Member Performance ---
  getTeamMembersPerformance(deptId?: string): TeamMemberPerformance[] {
    const list = this.load(this.membersKey, INITIAL_TEAM_MEMBERS);
    if (!deptId || deptId === 'all') return list;
    return list.filter(m => m.departmentId === deptId);
  }

  // --- Daily Expenses ---
  getDailyExpenses(): DepartmentDailyExpense[] {
    return this.load('amuwa_accounts_daily_expenses_v2', INITIAL_DAILY_EXPENSES);
  }

  getDailyCompanyTotal() {
    const list = this.getDailyExpenses();
    const todayTotal = list.reduce((sum, d) => sum + d.todaySpent, 0);
    const dailyBudgetTotal = list.reduce((sum, d) => sum + d.dailyBudget, 0);
    const dailyBurnRateTotal = list.reduce((sum, d) => sum + d.dailyBurnRate, 0);
    const yesterdayTotal = list.reduce((sum, d) => sum + d.yesterdaySpent, 0);
    const utilizationPct = dailyBudgetTotal > 0 ? (todayTotal / dailyBudgetTotal) * 100 : 0;
    return {
      todayTotal,
      dailyBudgetTotal,
      dailyBurnRateTotal,
      yesterdayTotal,
      utilizationPct: Math.round(utilizationPct * 10) / 10
    };
  }

  // --- Monthly Expenses ---
  getMonthlyExpenses(): DepartmentMonthlyExpense[] {
    return this.load('amuwa_accounts_monthly_expenses_v2', INITIAL_MONTHLY_EXPENSES);
  }

  getMonthlyCompanyTotal() {
    const list = this.getMonthlyExpenses();
    const monthlyTotal = list.reduce((sum, m) => sum + m.monthlySpent, 0);
    const monthlyBudgetTotal = list.reduce((sum, m) => sum + m.monthlyBudget, 0);
    const previousMonthTotal = list.reduce((sum, m) => sum + m.previousMonthSpent, 0);
    const utilizationPct = monthlyBudgetTotal > 0 ? (monthlyTotal / monthlyBudgetTotal) * 100 : 0;
    return {
      monthlyTotal,
      monthlyBudgetTotal,
      previousMonthTotal,
      utilizationPct: Math.round(utilizationPct * 10) / 10
    };
  }
}

export const INITIAL_DAILY_EXPENSES: DepartmentDailyExpense[] = [
  {
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    accentColor: '#10B981',
    logoUrl: '/logos/wabastore.png',
    todaySpent: 22700,
    dailyBudget: 24000,
    dailyBurnRate: 18667,
    budgetUtilizationPct: 94.6,
    yesterdaySpent: 19800,
    changeVsYesterdayPct: 14.6,
    dailyTransactionsCount: 2,
    recentDailyReasons: [
      {
        time: '11:30 AM',
        reason: 'Meta WhatsApp Business Cloud API conversation daily batch credits (Tier-4 volume)',
        category: 'API Subscriptions & Telecom',
        amount: 18500,
        approvedBy: 'Accounts Head (Rajiv Khanna)'
      },
      {
        time: '02:15 PM',
        reason: 'Daily automated e-commerce catalog webhook CDN burst caching & express checkout traffic',
        category: 'Cloud & Server Infrastructure',
        amount: 4200,
        approvedBy: 'Super Admin'
      }
    ]
  },
  {
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    accentColor: '#16A34A',
    logoUrl: '/logos/wabastar.png',
    todaySpent: 18300,
    dailyBudget: 20000,
    dailyBurnRate: 15667,
    budgetUtilizationPct: 91.5,
    yesterdaySpent: 17200,
    changeVsYesterdayPct: 6.4,
    dailyTransactionsCount: 2,
    recentDailyReasons: [
      {
        time: '10:45 AM',
        reason: 'Dedicated high-throughput WhatsApp marketing broadcast delivery cluster node & Redis burst',
        category: 'Cloud & Server Infrastructure',
        amount: 14800,
        approvedBy: 'Accounts Head (Rajiv Khanna)'
      },
      {
        time: '03:30 PM',
        reason: 'Zapier enterprise high-frequency webhook trigger executions & Meta lead form sync pipeline',
        category: 'Software & SaaS Licenses',
        amount: 3500,
        approvedBy: 'Accounts Head (Rajiv Khanna)'
      }
    ]
  },
  {
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    accentColor: '#06B6D4',
    logoUrl: '/logos/whatsbox.png',
    todaySpent: 16400,
    dailyBudget: 18000,
    dailyBurnRate: 14233,
    budgetUtilizationPct: 91.1,
    yesterdaySpent: 15900,
    changeVsYesterdayPct: 3.1,
    dailyTransactionsCount: 2,
    recentDailyReasons: [
      {
        time: '09:50 AM',
        reason: 'Kubernetes pod autoscaling & multi-agent live chat server compute bandwidth for customer support floor',
        category: 'Cloud & Server Infrastructure',
        amount: 12600,
        approvedBy: 'Super Admin'
      },
      {
        time: '04:10 PM',
        reason: 'Intercom live chat customer conversation seat top-up & active socket connection bandwidth',
        category: 'Software & SaaS Licenses',
        amount: 3800,
        approvedBy: 'Accounts Head (Rajiv Khanna)'
      }
    ]
  },
  {
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    accentColor: '#8B5CF6',
    logoUrl: '/logos/dtalk.png',
    todaySpent: 18100,
    dailyBudget: 19000,
    dailyBurnRate: 13333,
    budgetUtilizationPct: 95.3,
    yesterdaySpent: 16800,
    changeVsYesterdayPct: 7.7,
    dailyTransactionsCount: 2,
    recentDailyReasons: [
      {
        time: '11:00 AM',
        reason: 'Tata Teleservices enterprise PRI line daily trunk usage & 5,000 outbound voice call minutes settlement',
        category: 'API Subscriptions & Telecom',
        amount: 15200,
        approvedBy: 'Super Admin'
      },
      {
        time: '01:40 PM',
        reason: 'Cloud telephony PBX encrypted call recording daily regulatory backup vault (TRAI compliance)',
        category: 'Cloud & Server Infrastructure',
        amount: 2900,
        approvedBy: 'Accounts Head (Rajiv Khanna)'
      }
    ]
  },
  {
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    accentColor: '#EC4899',
    logoUrl: '/logos/digitree.png',
    todaySpent: 19600,
    dailyBudget: 21000,
    dailyBurnRate: 17333,
    budgetUtilizationPct: 93.3,
    yesterdaySpent: 18900,
    changeVsYesterdayPct: 3.7,
    dailyTransactionsCount: 2,
    recentDailyReasons: [
      {
        time: '10:15 AM',
        reason: 'Google Cloud Vertex AI processing & BigQuery daily batch queries for dynamic AIQR campaign analytics',
        category: 'Cloud & Server Infrastructure',
        amount: 16400,
        approvedBy: 'Super Admin'
      },
      {
        time: '02:50 PM',
        reason: 'Datadog live application performance monitoring & APM tracing logs ingest bandwidth',
        category: 'Software & SaaS Licenses',
        amount: 3200,
        approvedBy: 'Accounts Head (Rajiv Khanna)'
      }
    ]
  },
  {
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    accentColor: '#F59E0B',
    logoUrl: '/logos/mpillar.png',
    todaySpent: 18400,
    dailyBudget: 20000,
    dailyBurnRate: 15333,
    budgetUtilizationPct: 92.0,
    yesterdaySpent: 17500,
    changeVsYesterdayPct: 5.1,
    dailyTransactionsCount: 2,
    recentDailyReasons: [
      {
        time: '11:10 AM',
        reason: 'CAD rendering server cluster compute & civil infrastructure project blueprint cloud processing vault',
        category: 'Cloud & Server Infrastructure',
        amount: 13900,
        approvedBy: 'Super Admin'
      },
      {
        time: '04:30 PM',
        reason: 'Construction site regional inspection fleet fuel disbursement & field safety gear dispatch',
        category: 'Corporate Office & Facilities',
        amount: 4500,
        approvedBy: 'Accounts Head (Rajiv Khanna)'
      }
    ]
  }
];

export const INITIAL_MONTHLY_EXPENSES: DepartmentMonthlyExpense[] = [
  {
    departmentId: 'wabastore',
    departmentName: 'Wabastore',
    accentColor: '#10B981',
    logoUrl: '/logos/wabastore.png',
    currentMonth: 'October 2026',
    monthlyBudget: 600000,
    monthlySpent: 560000,
    budgetUtilizationPct: 93.3,
    previousMonthSpent: 545000,
    monthlyGrowthPct: 2.8,
    topCategory: 'Payroll & Executive Compensation',
    topCategoryAmount: 210000,
    monthlyBreakdownByCategory: [
      { category: 'Payroll & Executive Compensation', amount: 210000, pct: 37.5 },
      { category: 'API Subscriptions & Telecom', amount: 125000, pct: 22.3 },
      { category: 'Client Acquisition & Ad Spend', amount: 95500, pct: 17.1 },
      { category: 'Cloud & Server Infrastructure', amount: 84500, pct: 15.1 },
      { category: 'Software & SaaS Licenses', amount: 45000, pct: 8.0 }
    ]
  },
  {
    departmentId: 'wabastar',
    departmentName: 'Wabastar',
    accentColor: '#16A34A',
    logoUrl: '/logos/wabastar.png',
    currentMonth: 'October 2026',
    monthlyBudget: 500000,
    monthlySpent: 470000,
    budgetUtilizationPct: 94.0,
    previousMonthSpent: 458000,
    monthlyGrowthPct: 2.6,
    topCategory: 'Payroll & Executive Compensation',
    topCategoryAmount: 185000,
    monthlyBreakdownByCategory: [
      { category: 'Payroll & Executive Compensation', amount: 185000, pct: 39.4 },
      { category: 'API Subscriptions & Telecom', amount: 110000, pct: 23.4 },
      { category: 'Client Acquisition & Ad Spend', amount: 75000, pct: 16.0 },
      { category: 'Cloud & Server Infrastructure', amount: 62000, pct: 13.2 },
      { category: 'Software & SaaS Licenses', amount: 38000, pct: 8.0 }
    ]
  },
  {
    departmentId: 'whatsbox',
    departmentName: 'Whatsbox',
    accentColor: '#06B6D4',
    logoUrl: '/logos/whatsbox.png',
    currentMonth: 'October 2026',
    monthlyBudget: 450000,
    monthlySpent: 427000,
    budgetUtilizationPct: 94.9,
    previousMonthSpent: 415000,
    monthlyGrowthPct: 2.9,
    topCategory: 'Payroll & Executive Compensation',
    topCategoryAmount: 165000,
    monthlyBreakdownByCategory: [
      { category: 'Payroll & Executive Compensation', amount: 165000, pct: 38.6 },
      { category: 'API Subscriptions & Telecom', amount: 98000, pct: 23.0 },
      { category: 'Client Acquisition & Ad Spend', amount: 68000, pct: 15.9 },
      { category: 'Cloud & Server Infrastructure', amount: 54000, pct: 12.6 },
      { category: 'Software & SaaS Licenses', amount: 42000, pct: 9.9 }
    ]
  },
  {
    departmentId: 'dtalk',
    departmentName: 'D Talk Corporation',
    accentColor: '#8B5CF6',
    logoUrl: '/logos/dtalk.png',
    currentMonth: 'October 2026',
    monthlyBudget: 420000,
    monthlySpent: 400000,
    budgetUtilizationPct: 95.2,
    previousMonthSpent: 390000,
    monthlyGrowthPct: 2.6,
    topCategory: 'Payroll & Executive Compensation',
    topCategoryAmount: 170000,
    monthlyBreakdownByCategory: [
      { category: 'Payroll & Executive Compensation', amount: 170000, pct: 42.5 },
      { category: 'API Subscriptions & Telecom', amount: 115000, pct: 28.8 },
      { category: 'Cloud & Server Infrastructure', amount: 48000, pct: 12.0 },
      { category: 'Software & SaaS Licenses', amount: 35000, pct: 8.8 },
      { category: 'Hardware & Workstations', amount: 32000, pct: 8.0 }
    ]
  },
  {
    departmentId: 'digitree',
    departmentName: 'Digitree Infotech',
    accentColor: '#EC4899',
    logoUrl: '/logos/digitree.png',
    currentMonth: 'October 2026',
    monthlyBudget: 550000,
    monthlySpent: 520000,
    budgetUtilizationPct: 94.5,
    previousMonthSpent: 505000,
    monthlyGrowthPct: 3.0,
    topCategory: 'Payroll & Executive Compensation',
    topCategoryAmount: 240000,
    monthlyBreakdownByCategory: [
      { category: 'Payroll & Executive Compensation', amount: 240000, pct: 46.2 },
      { category: 'Cloud & Server Infrastructure', amount: 78000, pct: 15.0 },
      { category: 'Legal, Compliance & Retainers', amount: 65000, pct: 12.5 },
      { category: 'Software & SaaS Licenses', amount: 49000, pct: 9.4 },
      { category: 'Corporate Office & Facilities', amount: 28000, pct: 5.4 }
    ]
  },
  {
    departmentId: 'mpillar',
    departmentName: 'M Pillar Corporation',
    accentColor: '#F59E0B',
    logoUrl: '/logos/mpillar.png',
    currentMonth: 'October 2026',
    monthlyBudget: 500000,
    monthlySpent: 460000,
    budgetUtilizationPct: 92.0,
    previousMonthSpent: 445000,
    monthlyGrowthPct: 3.4,
    topCategory: 'Payroll & Executive Compensation',
    topCategoryAmount: 220000,
    monthlyBreakdownByCategory: [
      { category: 'Payroll & Executive Compensation', amount: 220000, pct: 47.8 },
      { category: 'Legal, Compliance & Retainers', amount: 75000, pct: 16.3 },
      { category: 'Software & SaaS Licenses', amount: 65000, pct: 14.1 },
      { category: 'Corporate Office & Facilities', amount: 58000, pct: 12.6 },
      { category: 'Cloud & Server Infrastructure', amount: 42000, pct: 9.1 }
    ]
  }
];

export const accountsStore = new AccountsStore();
