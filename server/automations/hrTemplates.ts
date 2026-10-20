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
<p>Wishing you a very Happy Birthday! May your year ahead be filled with happiness, good health, success, and new achievements.</p>
<p>We are glad to have you as part of the Amuwa Corporation team.</p>
<p>Best wishes,<br>HR Team<br>Amuwa Corporation</p>`;
      break;
    case 'ANNIVERSARY':
      subject = `Happy Work Anniversary, ${name}!`;
      html = `<p>Dear ${esc(name)},</p>
<p>Congratulations on your work anniversary at Amuwa Corporation!${p.years ? ` Today marks ${esc(p.years)} completed year${p.years === 1 ? '' : 's'} of service.` : ''}</p>
<p>Thank you for your dedication, contribution, and commitment to the company. We appreciate being part of your professional journey and look forward to achieving more milestones together.</p>
${hrSignature}`;
      break;
    case 'PROBATION_REMINDER_EMPLOYEE':
      subject = `Upcoming Employment Confirmation Review – ${name}`;
      html = `<p>Dear ${esc(name)},</p>
<p>We would like to inform you that your six-month probation period at Amuwa Corporation is approaching completion on ${esc(longDate(p.probationEndDate))}.</p>
<p>Your employment confirmation review will be conducted soon. HR will communicate the confirmation decision and any further steps required.</p>
<p>Thank you for your contributions and commitment to the company.</p>
${hrSignature}`;
      break;
    case 'PROBATION_REMINDER_HR':
      subject = `Action Required: Probation Confirmation Due – ${name}`;
      html = `<p>Dear HR Team,</p>
<p>This is an automated reminder that the probation period for the following employee is approaching completion ${esc(days(p.daysLeft))}.</p>
${details([['Employee Name', name], ['Employee ID', p.employeeCode ?? ''], ['Department', p.department ?? ''], ['Date of Joining', longDate(p.joiningDate)], ['Probation Completion Date', longDate(p.probationEndDate)]])}
<p>Please review the employee's performance, coordinate with the relevant Department Head, and complete the confirmation process before the due date.</p>
<p>This is a reminder for HR action and does not automatically confirm permanent employment.</p>
${automationSignature}`;
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
