import React from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { LeaveStatus } from '../../../shared/contracts';

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING_DEPARTMENT_HEAD: 'Pending Department Head Approval',
  PENDING_HR: 'Pending HR Approval',
  APPROVED: 'Approved',
  REJECTED_BY_DEPARTMENT_HEAD: 'Rejected by Department Head',
  REJECTED_BY_HR: 'Rejected by HR',
  PENDING_TEAM_LEAD: 'Pending Team Lead Approval',
  PENDING_OPERATIONS_HEAD: 'Pending Operations Head Approval',
  REJECTED_BY_TEAM_LEAD: 'Rejected by Team Lead',
  REJECTED_BY_OPERATIONS_HEAD: 'Rejected by Operations Head',
  REVISION_REQUIRED: 'Changes requested'
};

const STYLE: Record<LeaveStatus, string> = {
  PENDING_DEPARTMENT_HEAD: 'bg-amber-50 border-amber-200 text-amber-800',
  PENDING_HR: 'bg-sky-50 border-sky-200 text-sky-800',
  APPROVED: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  REJECTED_BY_DEPARTMENT_HEAD: 'bg-rose-50 border-rose-200 text-rose-800',
  REJECTED_BY_HR: 'bg-rose-50 border-rose-200 text-rose-800',
  PENDING_TEAM_LEAD: 'bg-amber-50 border-amber-200 text-amber-800',
  PENDING_OPERATIONS_HEAD: 'bg-violet-50 border-violet-200 text-violet-800',
  REJECTED_BY_TEAM_LEAD: 'bg-rose-50 border-rose-200 text-rose-800',
  REJECTED_BY_OPERATIONS_HEAD: 'bg-rose-50 border-rose-200 text-rose-800',
  REVISION_REQUIRED: 'bg-orange-50 border-orange-200 text-orange-800'
};

/** The approval status as a pill: an icon and words, so it never relies on colour alone. */
export const LeaveStatusBadge: React.FC<{ status: LeaveStatus }> = ({ status }) => {
  const Icon = status === 'APPROVED' ? CheckCircle2 : status.startsWith('REJECTED') ? XCircle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${STYLE[status]}`}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
      {LEAVE_STATUS_LABEL[status]}
    </span>
  );
};
