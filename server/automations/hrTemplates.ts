import type { HrEmailKind } from '../../shared/contracts.js';
import { toText, type RenderedEmail } from './templates.js';

/**
 * The HR e-mails (birthday, work anniversary, probation reminders, employment confirmation). Wording follows the approved
 * templates; the values come from the queued event's payload (written by the database), never from the browser.
 */
export interface HrMailPayload {
  employeeName?: string;
  employeeCode?: string;
  department?: string;
  joiningDate?: string;
  probationEndDate?: string;
  confirmationEffectiveDate?: string;
  approvalStatus?: string;
  years?: number;
  daysLeft?: number;
  daysOverdue?: number;
  designation?: string;
  reportingManager?: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrap = (inner: string) => '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">' + inner + '</div>';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 2027-01-05 -> 5 January 2027 (what an employee reads); anything else is shown as given. */
export function longDate(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : String(iso ?? '');
}

const hrSignature = `<p>Best regards,<br>HR Team<br>Amuwa Corporation</p>`;
const hrSignatureRegards = `<p>Regards,<br>HR Team<br>Amuwa Corporation</p>`;
const automationSignature = `<p>Regards,<br>AI CRM – HR Automation</p>`;
const details = (rows: [string, string][]) => `<ul>${rows.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>`;

function days(n: number | undefined): string {
  const v = Math.max(0, Number(n ?? 7));
  return v === 0 ? 'today' : `in ${v} day${v === 1 ? '' : 's'}`;
}

export function renderHrEmail(kind: HrEmailKind, p: HrMailPayload): RenderedEmail {
  const name = p.employeeName?.trim() || 'Employee';
  let subject: string;
  let html: string;
  switch (kind) {
    case 'BIRTHDAY':
      subject = `Happy Birthday, ${name}! 🎂`;
      html = `<p>Dear ${esc(name)},</p>
<p>Wishing you a very Happy Birthday!</p>
<p>May your special day bring you happiness, success, good health, and wonderful opportunities in the year ahead.</p>
<p>Thank you for being a valued member of our team. We wish you continued growth and success in both your personal and professional journey.</p>
<p>Have a wonderful birthday!</p>
${hrSignature}`;
      break;
    case 'ANNIVERSARY': {
      const y = Math.max(1, Number(p.years) || 1);
      subject = `Happy Work Anniversary, ${name}! 🎉`;
      html = `<p>Dear ${esc(name)},</p>
<p>Congratulations on your work anniversary with Amuwa Corporation!</p>
<p>Today marks ${y} year${y === 1 ? '' : 's'} of your professional journey with us. We sincerely appreciate your dedication, commitment, and valuable contributions to the organization.</p>
<p>Thank you for being an important part of our team. We look forward to many more years of collaboration, growth, and success together.</p>
<p>Wishing you continued achievements and a successful journey ahead!</p>
${hrSignature}`;
      break;
    }
    case 'PROBATION_REMINDER_EMPLOYEE':
      subject = `Employee Confirmation Reminder — ${name} — Due ${longDate(p.probationEndDate)}`;
      html = `<p>Dear ${esc(name)},</p>
<p>This is a reminder that your six-month probation period at Amuwa Corporation is scheduled to be completed on ${esc(longDate(p.probationEndDate))}.</p>
<p>Your employment confirmation is approaching ${esc(p.daysLeft === undefined || p.daysLeft === 7 ? 'in seven days' : days(p.daysLeft))}. Please connect with your reporting manager and the HR team to complete any required performance review, feedback, documentation, or confirmation formalities.</p>
<p>We appreciate your contributions and look forward to your continued growth with the organization.</p>
${hrSignature}`;
      break;
    case 'PROBATION_REMINDER_HR':
      {
        const left = p.daysLeft === undefined ? 7 : Math.max(0, Number(p.daysLeft));
        subject = `Action Required: Confirmation Due ${left === 0 ? 'Today' : `in ${left} Day${left === 1 ? '' : 's'}`} — ${name}`;
      }
      html = `<p>Dear HR Team,</p>
<p>This is an automated reminder that ${esc(name)}, who joined on ${esc(longDate(p.joiningDate))}, is approaching the completion of their six-month probation period.</p>
<p>Employee details:</p>
${details([['Employee Name', name], ['Employee ID', p.employeeCode ?? ''], ['Department', p.department ?? ''], ['Designation', p.designation ?? 'Not recorded'], ['Joining Date', longDate(p.joiningDate)], ['Confirmation Due Date', longDate(p.probationEndDate)], ['Reporting Manager', p.reportingManager ?? 'Not assigned']])}
<p>The confirmation date is ${esc(p.daysLeft === undefined || p.daysLeft === 7 ? 'seven days away' : p.daysLeft <= 0 ? 'today' : `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} away`)}. Please coordinate with the reporting manager, review the employee's performance, and complete the required confirmation formalities before the due date.</p>
<p>This email is an advance reminder only. It does not automatically confirm employment or change the employee's employment status.</p>
<p>Best regards,<br>Automated HR System<br>Amuwa Corporation</p>`;
      break;
    case 'PROBATION_OVERDUE_HR':
      subject = `Overdue: Probation Confirmation Pending – ${name}`;
      html = `<p>Dear HR Team,</p>
<p>The probation period of the following employee ended ${esc(p.daysOverdue ?? '')} day${p.daysOverdue === 1 ? '' : 's'} ago and the confirmation has <b>not</b> been approved yet.</p>
${details([['Employee Name', name], ['Employee ID', p.employeeCode ?? ''], ['Department', p.department ?? ''], ['Date of Joining', longDate(p.joiningDate)], ['Probation Completion Date', longDate(p.probationEndDate)]])}
<p>Please complete the confirmation review. The employee has <b>not</b> been confirmed: permanent employment is confirmed only after HR / management approval in the CRM, and the confirmation e-mails are sent after that approval.</p>
${automationSignature}`;
      break;
    case 'CONFIRMATION_EMPLOYEE':
      subject = 'Employment Confirmation – Amuwa Corporation';
      html = `<p>Dear ${esc(name)},</p>
<p>We are pleased to inform you that, following the successful completion of your probation period, your employment with Amuwa Corporation has been confirmed as permanent, effective ${esc(longDate(p.confirmationEffectiveDate))}.</p>
<p>Thank you for your dedication and contributions. We look forward to your continued growth and success with the company.</p>
<p>Please contact the HR team if you have any questions regarding your confirmation.</p>
<p>Congratulations, and best wishes for your continued journey with Amuwa Corporation!</p>
${hrSignatureRegards}`;
      break;
    case 'CONFIRMATION_HR':
      subject = `Employee Confirmation Completed – ${name}`;
      html = `<p>Dear HR Team,</p>
<p>The employment confirmation for ${esc(name)} (${esc(p.employeeCode ?? '')}), Department: ${esc(p.department ?? '')}, has been approved and processed.</p>
${details([['Date of Joining', longDate(p.joiningDate)], ['Probation Completion Date', longDate(p.probationEndDate)], ['Confirmation Effective Date', longDate(p.confirmationEffectiveDate)], ['Approval Status', p.approvalStatus || 'Approved']])}
<p>Please ensure the employee's HR records are updated accordingly.</p>
${automationSignature}`;
      break;
    default:
      throw new Error(`Unknown HR e-mail kind ${String(kind)}`);
  }
  const wrapped = wrap(html);
  return { subject, html: wrapped, text: toText(wrapped.replace(/<li>/g, '- ').replace(/<\/li>/g, '<br>')) };
}
