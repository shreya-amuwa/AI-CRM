export type EmployeeStatus = 'Full-Time' | 'Training / Probation' | 'Intern' | 'Left';
export type LeaveType = 'Half-Day' | 'Full-Day Leave';

export interface UploadedDocument {
  id: string;
  name: string;
  fileUrl: string; // Base64 or Blob URL for download & preview
  fileType?: string;
  uploadedAt: string;
}

export interface DetailedLeaveRecord {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  date: string;
  customStartTime?: string; // Custom time e.g. "11:00 AM"
  customEndTime?: string;   // Custom time e.g. "03:30 PM"
  halfDayShift?: string;
  reason: string;
  mailAttachmentName: string;
  mailAttachmentUrl?: string; // Image or PDF file URL
  status: 'Active' | 'Cancelled';
  cancellationMailName?: string;
  cancellationMailUrl?: string;
  cancellationReason?: string;
  submittedAt: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  departmentId: string;
  status: EmployeeStatus;
  joiningDate: string;
  trainingEndDate?: string;
  leftDate?: string;
  workingHours: string; // Default: '09:30 AM - 06:30 PM (Mon-Sat)'
  monthlySalary: string;
  annualCTC?: string;
  avatarUrl?: string; // Profile picture URL
  documentsCollected: boolean;
  documentsList?: string[];
  uploadedDocs: UploadedDocument[];
  leaveHistory: DetailedLeaveRecord[];
  halfDaysCount: number;
  totalLeavesCount: number;
  notes?: string;
}

export interface OfferLetter {
  id: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  designation: string;
  departmentName: string;
  monthlySalary: string;
  annualCTC: string;
  joiningDate: string;
  workingHours: string;
  generatedAt: string;
  status: 'Draft' | 'Issued' | 'Accepted';
}

export interface LeaveApplication {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  attachmentName?: string;
  status: 'Pending' | 'Approved' | 'Noted' | 'Cancelled';
  submittedAt: string;
}

export interface CompanyNotice {
  id: string;
  title: string;
  category: 'General' | 'HR Policy' | 'Urgent' | 'Event';
  content: string;
  postedBy: string;
  postedAt: string;
  targetDepartments: string;
}
