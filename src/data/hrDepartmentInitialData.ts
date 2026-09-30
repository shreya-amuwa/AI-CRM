import { Employee, OfferLetter, LeaveApplication } from '../types/amuwaHq';

export const INITIAL_HR_EMPLOYEES: Employee[] = [
  {
    id: 'HR-EMP-1001',
    name: 'Deepak Kumar',
    email: 'deepak.k@hrdept.com',
    phone: '+91 99887 66554',
    designation: 'HR Manager & Talent Lead',
    departmentId: 'hr',
    status: 'Full-Time',
    joiningDate: '2023-06-01',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹78,000',
    annualCTC: '₹9.36 LPA',
    documentsCollected: true,
    documentsList: ['Aadhaar Card', 'PAN Card', 'Degree Certificate'],
    uploadedDocs: [
      { id: 'DOC-001', name: 'Deepak_Aadhaar_Verified.pdf', fileUrl: '#', uploadedAt: '2023-06-01' },
      { id: 'DOC-002', name: 'Deepak_PAN_Card.pdf', fileUrl: '#', uploadedAt: '2023-06-01' },
      { id: 'DOC-003', name: 'Deepak_MBA_Certificate.pdf', fileUrl: '#', uploadedAt: '2023-06-01' }
    ],
    leaveHistory: [],
    halfDaysCount: 0,
    totalLeavesCount: 0,
    notes: 'Head of HR Department - Manages Recruitment & Onboarding'
  },
  {
    id: 'HR-EMP-1002',
    name: 'Anjali Desai',
    email: 'anjali.d@hrdept.com',
    phone: '+91 98765 11223',
    designation: 'Recruitment Specialist',
    departmentId: 'hr',
    status: 'Full-Time',
    joiningDate: '2024-03-15',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹65,000',
    annualCTC: '₹7.8 LPA',
    documentsCollected: true,
    documentsList: ['Aadhaar Card', 'PAN Card', 'B.Tech Certificate'],
    uploadedDocs: [
      { id: 'DOC-004', name: 'Anjali_Aadhaar_Verified.pdf', fileUrl: '#', uploadedAt: '2024-03-15' },
      { id: 'DOC-005', name: 'Anjali_BEng_Certificate.pdf', fileUrl: '#', uploadedAt: '2024-03-15' }
    ],
    leaveHistory: [
      {
        id: 'LR-001',
        employeeId: 'HR-EMP-1002',
        leaveType: 'Half-Day',
        date: '2026-08-20',
        halfDayShift: 'Afternoon (02:00 PM - 06:30 PM)',
        reason: 'Client interview scheduling',
        mailAttachmentName: 'interview_coordination_mail.pdf',
        status: 'Active',
        submittedAt: '2026-08-20T09:00:00.000Z'
      }
    ],
    halfDaysCount: 1,
    totalLeavesCount: 0,
    notes: 'Manages Job Postings & Candidate Screening'
  },
  {
    id: 'HR-EMP-1003',
    name: 'Rahul Verma',
    email: 'rahul.v@hrdept.com',
    phone: '+91 97733 22115',
    designation: 'HR Executive Trainee',
    departmentId: 'hr',
    status: 'Training / Probation',
    joiningDate: '2026-07-20',
    trainingEndDate: '2026-09-20',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹28,000 (Stipend)',
    annualCTC: '₹3.36 LPA',
    documentsCollected: false,
    documentsList: ['Aadhaar Card', 'Bachelor Degree'],
    uploadedDocs: [
      { id: 'DOC-006', name: 'Rahul_Aadhaar_Front.pdf', fileUrl: '#', uploadedAt: '2026-07-20' }
    ],
    leaveHistory: [],
    halfDaysCount: 0,
    totalLeavesCount: 0,
    notes: 'Undergoing 2-month HR operations training'
  },
  {
    id: 'HR-EMP-1004',
    name: 'Meera Patel',
    email: 'meera.p@hrtemp.com',
    phone: '+91 96621 99887',
    designation: 'HR Support Intern',
    departmentId: 'hr',
    status: 'Intern',
    joiningDate: '2026-08-01',
    trainingEndDate: '2026-11-01',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    monthlySalary: '₹20,000 (Stipend)',
    annualCTC: '₹2.4 LPA',
    documentsCollected: true,
    documentsList: ['College ID', 'Aadhaar Card'],
    uploadedDocs: [
      { id: 'DOC-007', name: 'Meera_College_ID.pdf', fileUrl: '#', uploadedAt: '2026-08-01' },
      { id: 'DOC-008', name: 'Meera_Aadhaar_Verified.pdf', fileUrl: '#', uploadedAt: '2026-08-01' }
    ],
    leaveHistory: [],
    halfDaysCount: 0,
    totalLeavesCount: 0,
    notes: '3-month HR department internship - Document Management focus'
  }
];

export const INITIAL_HR_OFFER_LETTERS: OfferLetter[] = [
  {
    id: 'HR-OFF-2026-01',
    candidateName: 'Vikram Singh',
    candidateEmail: 'vikram.singh@gmail.com',
    candidatePhone: '+91 99665 44332',
    designation: 'Compensation & Benefits Analyst',
    departmentName: 'HR Department',
    monthlySalary: '₹72,000',
    annualCTC: '₹8.64 LPA',
    joiningDate: '2026-09-15',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    status: 'Issued'
  },
  {
    id: 'HR-OFF-2026-02',
    candidateName: 'Priya Gupta',
    candidateEmail: 'priya.gupta@gmail.com',
    candidatePhone: '+91 98774 55443',
    designation: 'Employee Relations Officer',
    departmentName: 'HR Department',
    monthlySalary: '₹62,000',
    annualCTC: '₹7.44 LPA',
    joiningDate: '2026-10-01',
    workingHours: '09:30 AM - 06:30 PM (Mon-Sat)',
    generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
    status: 'Issued'
  }
];

export const INITIAL_HR_LEAVE_APPLICATIONS: LeaveApplication[] = [
  {
    id: 'HR-LEV-001',
    employeeId: 'HR-EMP-1002',
    employeeName: 'Anjali Desai',
    leaveType: 'Half-Day',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
    reason: 'Client interview coordination - Afternoon shift',
    attachmentName: 'interview_approval_mail.pdf',
    status: 'Noted',
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString()
  },
  {
    id: 'HR-LEV-002',
    employeeId: 'HR-EMP-1001',
    employeeName: 'Deepak Kumar',
    leaveType: 'Full-Day Leave',
    startDate: '2026-09-05',
    endDate: '2026-09-05',
    reason: 'Company Town Hall Meeting - Day Off',
    attachmentName: 'townhall_notification.pdf',
    status: 'Approved',
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString()
  }
];
