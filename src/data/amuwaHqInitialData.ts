import { Employee, OfferLetter, LeaveApplication, CompanyNotice } from '../types/amuwaHq';

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'EMP-1001',
    name: 'Alexander Wright',
    email: 'alexander.w@amuwa.com',
    phone: '+91 98765 11223',
    designation: 'Operations Lead & Corporate Executive',
    departmentId: 'amuwa',
    status: 'Full-Time',
    joiningDate: '2023-04-15',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹85,000',
    annualCTC: '₹10.2 LPA',
    documentsCollected: true,
    documentsList: ['Aadhaar Card', 'PAN Card', 'Degree Certificate', 'Relieving Letter'],
    uploadedDocs: [
      { id: 'DOC-01', name: 'Aadhaar_Card_Verified.pdf', fileUrl: '#', uploadedAt: '2023-04-15' },
      { id: 'DOC-02', name: 'PAN_Card_Verification.pdf', fileUrl: '#', uploadedAt: '2023-04-15' },
      { id: 'DOC-03', name: 'Degree_Certificate_Original.pdf', fileUrl: '#', uploadedAt: '2023-04-15' }
    ],
    leaveHistory: [
      {
        id: 'LR-101',
        employeeId: 'EMP-1001',
        leaveType: 'Half-Day',
        date: '2026-08-10',
        halfDayShift: 'Morning (09:30 AM - 01:30 PM)',
        reason: 'Medical checkup consultation',
        mailAttachmentName: 'medical_approval_mail.pdf',
        status: 'Active',
        submittedAt: '2026-08-10T09:00:00.000Z'
      }
    ],
    halfDaysCount: 1,
    totalLeavesCount: 0,
    notes: 'Key Operations Lead'
  },
  {
    id: 'EMP-1002',
    name: 'Priya Sharma',
    email: 'priya.sharma@amuwa.com',
    phone: '+91 98112 33445',
    designation: 'HR Lead & Talent Specialist',
    departmentId: 'amuwa',
    status: 'Full-Time',
    joiningDate: '2024-01-10',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹72,000',
    annualCTC: '₹8.64 LPA',
    documentsCollected: true,
    documentsList: ['Aadhaar Card', 'PAN Card', 'MBA Degree'],
    uploadedDocs: [
      { id: 'DOC-04', name: 'Priya_Aadhaar_Copy.pdf', fileUrl: '#', uploadedAt: '2024-01-10' },
      { id: 'DOC-05', name: 'MBA_Marksheets_Verified.pdf', fileUrl: '#', uploadedAt: '2024-01-10' }
    ],
    leaveHistory: [],
    halfDaysCount: 0,
    totalLeavesCount: 0,
    notes: 'Manages Offer Automation & Onboarding'
  },
  {
    id: 'EMP-1003',
    name: 'Rohan Mehta',
    email: 'rohan.m@amuwa.com',
    phone: '+91 97766 55443',
    designation: 'Operations Trainee Candidate',
    departmentId: 'amuwa',
    status: 'Training / Probation',
    joiningDate: '2026-07-01',
    trainingEndDate: '2026-09-01',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹25,000 (Stipend)',
    annualCTC: '₹3.0 LPA',
    documentsCollected: false,
    documentsList: ['Aadhaar Card'],
    uploadedDocs: [
      { id: 'DOC-06', name: 'Rohan_Aadhaar_Front.png', fileUrl: '#', uploadedAt: '2026-07-01' }
    ],
    leaveHistory: [
      {
        id: 'LR-102',
        employeeId: 'EMP-1003',
        leaveType: 'Half-Day',
        date: '2026-08-14',
        halfDayShift: 'Afternoon (02:00 PM - 06:30 PM)',
        reason: 'Urgent family work',
        mailAttachmentName: 'rohan_halfday_approval.pdf',
        status: 'Active',
        submittedAt: '2026-08-14T08:30:00.000Z'
      }
    ],
    halfDaysCount: 1,
    totalLeavesCount: 0,
    notes: 'Undergoing 60-day intensive corporate training'
  },
  {
    id: 'EMP-1004',
    name: 'Kavya Nair',
    email: 'kavya.nair@amuwa.com',
    phone: '+91 96554 43322',
    designation: 'Creative Design Intern',
    departmentId: 'amuwa',
    status: 'Intern',
    joiningDate: '2026-07-15',
    trainingEndDate: '2026-10-15',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹18,000 (Stipend)',
    annualCTC: '₹2.16 LPA',
    documentsCollected: true,
    documentsList: ['College ID', 'Aadhaar Card', 'PAN Card'],
    uploadedDocs: [
      { id: 'DOC-07', name: 'Kavya_College_ID.pdf', fileUrl: '#', uploadedAt: '2026-07-15' },
      { id: 'DOC-08', name: 'Kavya_Aadhaar_Verified.pdf', fileUrl: '#', uploadedAt: '2026-07-15' }
    ],
    leaveHistory: [],
    halfDaysCount: 0,
    totalLeavesCount: 0,
    notes: 'Design Intern evaluating for permanent conversion'
  }
];

export const INITIAL_OFFER_LETTERS: OfferLetter[] = [
  {
    id: 'OFF-2026-01',
    candidateName: 'Suresh Menon',
    candidateEmail: 'suresh.menon@gmail.com',
    candidatePhone: '+91 99112 23344',
    designation: 'Senior Operations Manager',
    departmentName: 'Amuwa Corporation',
    monthlySalary: '₹85,000',
    annualCTC: '₹10.2 LPA',
    joiningDate: '2026-09-01',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    status: 'Issued'
  }
];

export const INITIAL_LEAVE_APPLICATIONS: LeaveApplication[] = [
  {
    id: 'LEV-501',
    employeeId: 'EMP-1003',
    employeeName: 'Rohan Mehta',
    leaveType: 'Half-Day',
    startDate: '2026-08-14',
    endDate: '2026-08-14',
    reason: 'Urgent family work - Afternoon shift',
    attachmentName: 'rohan_halfday_approval.pdf',
    status: 'Noted',
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  }
];

export const INITIAL_COMPANY_NOTICES: CompanyNotice[] = [
  {
    id: 'NOT-101',
    title: 'Standard Working Hours & Attendance Policy',
    category: 'HR Policy',
    content: 'Default Working Hours: 09:30 AM - 06:30 PM (Mon-Sat). All half-days and leaves must include email approval attachments.',
    postedBy: 'Priya Sharma (HR Lead)',
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    targetDepartments: 'Amuwa Corporation Group'
  }
];
