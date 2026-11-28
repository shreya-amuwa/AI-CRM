/**
 * HR e-mail templates (no database): approved subjects and wording, personalisation, HTML escaping.
 * Run: npm run test:unit
 */
import { longDate, renderHrEmail } from '../../server/automations/hrTemplates.js';
import { fromDatabaseError } from '../../server/http/errors.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

check(longDate('2027-03-14') === '14 March 2027' && longDate('2026-01-05') === '5 January 2026' && longDate(undefined) === '', 'dates read as "14 March 2027"');

let m = renderHrEmail('BIRTHDAY', { employeeName: 'Asha Verma' });
check(m.subject === 'Happy Birthday, Asha Verma! 🎂', 'birthday subject');
check(m.text.startsWith('Dear Asha Verma,') && m.text.includes('Wishing you a very Happy Birthday!')
  && m.text.includes('May your special day bring you happiness, success, good health, and wonderful opportunities in the year ahead.')
  && m.text.includes('Thank you for being a valued member of our team.') && m.text.includes('Have a wonderful birthday!')
  && m.text.endsWith('Best regards,\nHR Team\nAmuwa Corporation'), 'birthday text', m.text);

m = renderHrEmail('ANNIVERSARY', { employeeName: 'Asha Verma', years: 3 });
check(m.subject === 'Happy Work Anniversary, Asha Verma! 🎉' && m.text.includes('Congratulations on your work anniversary with Amuwa Corporation!')
  && m.text.includes('Today marks 3 years of your professional journey with us.')
  && m.text.includes('Wishing you continued achievements and a successful journey ahead!') && m.text.endsWith('Best regards,\nHR Team\nAmuwa Corporation'), 'anniversary mail with the completed years', m.text);
check(renderHrEmail('ANNIVERSARY', { employeeName: 'A', years: 1 }).text.includes('Today marks 1 year of your professional journey'), 'one year is singular');
check(renderHrEmail('ANNIVERSARY', { employeeName: 'A', years: 12 }).text.includes('Today marks 12 years of'), 'later anniversaries use the completed years');

m = renderHrEmail('PROBATION_REMINDER_EMPLOYEE', { employeeName: 'Asha Verma', probationEndDate: '2027-03-14', daysLeft: 7 });
check(m.subject === 'Employee Confirmation Reminder — Asha Verma — Due 14 March 2027'
  && m.text.includes('your six-month probation period at Amuwa Corporation is scheduled to be completed on 14 March 2027.')
  && m.text.includes('Your employment confirmation is approaching in seven days. Please connect with your reporting manager and the HR team')
  && m.text.endsWith('Best regards,\nHR Team\nAmuwa Corporation') && !/permanent/i.test(m.text), 'employee confirmation reminder (never says permanent)', m.text);
check(renderHrEmail('PROBATION_REMINDER_EMPLOYEE', { employeeName: 'A', probationEndDate: '2027-03-14', daysLeft: 3 }).text.includes('approaching in 3 days'), 'a reminder found late says how many days are left');

const hrPayload = { employeeName: 'Asha Verma', employeeCode: 'EMP-1A2B3C4D', department: 'Wabastore', designation: 'Sales Executive', reportingManager: 'Rohan Mehta',
  joiningDate: '2026-09-14', probationEndDate: '2027-03-14', daysLeft: 7 };
m = renderHrEmail('PROBATION_REMINDER_HR', hrPayload);
check(m.subject === 'Action Required: Confirmation Due in 7 Days — Asha Verma' && m.text.startsWith('Dear HR Team,')
  && m.text.includes('Asha Verma, who joined on 14 September 2026, is approaching the completion of their six-month probation period.'), 'HR reminder subject and opening', m.text);
for (const line of ['Employee Name: Asha Verma', 'Employee ID: EMP-1A2B3C4D', 'Department: Wabastore', 'Designation: Sales Executive', 'Joining Date: 14 September 2026',
  'Confirmation Due Date: 14 March 2027', 'Reporting Manager: Rohan Mehta']) {
  check(m.text.includes(line), `HR reminder lists "${line}"`);
}
check(m.text.includes('The confirmation date is seven days away.') && m.text.includes("This email is an advance reminder only. It does not automatically confirm employment or change the employee's employment status.")
  && m.text.endsWith('Best regards,\nAutomated HR System\nAmuwa Corporation'), 'HR reminder says it does not confirm anyone');
check(renderHrEmail('PROBATION_REMINDER_HR', { ...hrPayload, daysLeft: 3 }).subject === 'Action Required: Confirmation Due in 3 Days — Asha Verma'
  && renderHrEmail('PROBATION_REMINDER_HR', { ...hrPayload, daysLeft: 0 }).subject === 'Action Required: Confirmation Due Today — Asha Verma',
  'a reminder found late says how many days are left');
check(renderHrEmail('PROBATION_REMINDER_HR', { employeeName: 'A' }).text.includes('Reporting Manager: Not assigned'), 'a missing manager reads "Not assigned"');

m = renderHrEmail('PROBATION_OVERDUE_HR', { ...hrPayload, daysOverdue: 9 });
check(m.subject === 'Overdue: Probation Confirmation Pending – Asha Verma' && m.text.includes('ended 9 days ago') && m.text.includes('has not been approved yet')
  && m.text.includes('The employee has not been confirmed'), 'the overdue reminder goes to HR and says the employee is not confirmed', m.text);

m = renderHrEmail('CONFIRMATION_EMPLOYEE', { employeeName: 'Asha Verma', confirmationEffectiveDate: '2027-03-14' });
check(m.subject === 'Employment Confirmation – Amuwa Corporation'
  && m.text.includes('your employment with Amuwa Corporation has been confirmed as permanent, effective 14 March 2027.')
  && m.text.includes('Please contact the HR team if you have any questions regarding your confirmation.')
  && m.text.includes('Congratulations, and best wishes for your continued journey with Amuwa Corporation!') && m.text.endsWith('Regards,\nHR Team\nAmuwa Corporation'), 'confirmation e-mail to the employee', m.text);

m = renderHrEmail('CONFIRMATION_HR', { ...hrPayload, confirmationEffectiveDate: '2027-03-14', approvalStatus: 'Approved' });
check(m.subject === 'Employee Confirmation Completed – Asha Verma'
  && m.text.includes('The employment confirmation for Asha Verma (EMP-1A2B3C4D), Department: Wabastore, has been approved and processed.')
  && m.text.includes('Confirmation Effective Date: 14 March 2027') && m.text.includes('Approval Status: Approved')
  && m.text.includes("Please ensure the employee's HR records are updated accordingly."), 'confirmation notice to HR', m.text);

m = renderHrEmail('BIRTHDAY', { employeeName: '<script>alert(1)</script> "Eve"' });
check(!m.html.includes('<script>') && m.html.includes('&lt;script&gt;'), 'names are HTML-escaped (no markup injection through a name)');
check(renderHrEmail('BIRTHDAY', {}).subject === 'Happy Birthday, Employee! 🎂', 'a missing name does not break the mail');

// A database that has not been given the latest migration says so (a clear set-up message), instead of "Something went wrong".
const missing = fromDatabaseError({ code: 'PGRST202', message: 'Could not find the function public.hr_email_cards without parameters in the schema cache', details: '', hint: '', name: 'PostgrestError' } as any);
check(missing.code === 'SERVICE_UNAVAILABLE' && /latest migrations/.test(missing.message) && !/hr_email_cards|schema cache/.test(missing.message), 'a missing database function is reported as a set-up step, without internals');
check(fromDatabaseError({ code: 'XX000', message: 'boom', details: '', hint: '', name: 'PostgrestError' } as any).code === 'INTERNAL', 'other database errors stay generic');


// ---- confirmation / internship review reminders (20270312000100): role-specific wording, the review link, statuses
const rv = { employeeName: 'Asha Verma', employeeCode: 'EMP-1A2B3C4D', department: 'Wabastore', designation: 'Telecaller', employmentType: 'Full-Time',
  joiningDate: '2026-09-14', periodMonths: 6, probationEndDate: '2027-03-14', daysLeft: 10, dhStatus: 'NOT_STARTED', ceoStatus: 'NOT_STARTED', hrStatus: 'NOT_STARTED',
  reviewPath: '/?review=11111111-1111-1111-1111-111111111111', cycleType: 'PROBATION' as const };
m = renderHrEmail('REVIEW_FIRST', { ...rv, recipientRole: 'DH', recipientName: 'Ravi Head', ownStatus: 'NOT_STARTED' }, { appUrl: 'https://crm.example.com/' });
check(m.subject === 'Employee Confirmation Review Required — Asha Verma | 10 Days Remaining', 'first reminder subject', m.subject);
check(m.text.includes('Dear Ravi Head,') && m.text.includes('Asha Verma, working as Telecaller in the Wabastore department, is approaching the completion of their probation period.')
  && m.text.includes('Employee ID: EMP-1A2B3C4D') && m.text.includes('Expected Confirmation Date: 14 March 2027') && m.text.includes('Days Remaining: 10')
  && m.text.includes('please submit your evaluation'), 'the Department Head is asked to submit their evaluation', m.text);
check(m.html.includes('href="https://crm.example.com/?review=11111111-1111-1111-1111-111111111111"') && m.html.includes('Review Employee'), 'the button opens the review in the CRM');
m = renderHrEmail('REVIEW_FIRST', { ...rv, recipientRole: 'HR' }, { appUrl: 'https://crm.example.com' });
check(m.text.includes('Dear HR Team,') && m.text.includes('review has started') && !m.text.includes('please submit your evaluation'), 'HR gets the monitoring wording, not a submission request', m.text);
m = renderHrEmail('REVIEW_SECOND', { ...rv, daysLeft: 4, dhStatus: 'SUBMITTED', recipientRole: 'DH', recipientName: 'Ravi Head', ownStatus: 'SUBMITTED' }, {});
check(m.subject === 'Employee Confirmation Reminder — Asha Verma | 4 Days Remaining' && m.text.includes('Department Head: Submitted') && m.text.includes('CEO: Pending')
  && m.text.includes('your evaluation report has been submitted') && !m.text.includes('please submit'), 'the second reminder acknowledges a submitted report', m.text);
m = renderHrEmail('REVIEW_SECOND', { ...rv, daysLeft: 4, dhStatus: 'SUBMITTED', ceoStatus: 'SUBMITTED', recipientRole: 'HR' }, {});
check(m.text.includes('both management reports are in') && m.text.includes('record the final decision'), 'when both reports are in, HR is reminded to decide', m.text);
m = renderHrEmail('REVIEW_FIRST', { ...rv, daysLeft: 7, recipientRole: 'HR', configIssue: 'NO_DEPARTMENT_HEAD' }, {});
check(m.subject.endsWith('| 7 Days Remaining') && m.text.includes('a reviewer is missing (no Department Head)'), 'a late cycle states its real days and a missing reviewer is flagged', m.subject);
m = renderHrEmail('REVIEW_FIRST', { ...rv, cycleType: 'INTERNSHIP', employmentType: 'Intern', periodMonths: 3, probationEndDate: '2026-12-15', recipientRole: 'CEO', recipientName: 'Kiran CEO' }, {});
check(m.subject === 'Internship Completion Review Required — Asha Verma | 10 Days Remaining' && m.text.includes('Internship Completion Date: 15 December 2026')
  && m.text.includes('Internship Duration: 3 months') && m.text.includes('completion of their internship'), 'internship wording', m.text);
check(renderHrEmail('REVIEW_SECOND', { ...rv, cycleType: 'INTERNSHIP', daysLeft: 4, recipientRole: 'HR' }, {}).subject === 'Internship Evaluation Reminder — Asha Verma | 4 Days Remaining', 'internship second reminder subject');
check(!renderHrEmail('REVIEW_FIRST', { ...rv, employeeName: '<b>x</b>', recipientRole: 'DH' }, {}).html.includes('<b>x</b>'), 'review reminders escape names too');

console.log(`=== ${passed} HR E-MAIL TEMPLATE CHECKS PASSED ===`);
process.exit(0);
