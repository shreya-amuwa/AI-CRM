/**
 * HR e-mail templates (no database): approved subjects and wording, personalisation, HTML escaping.
 * Run: npm run test:unit
 */
import { longDate, renderHrEmail } from '../../server/automations/hrTemplates.js';

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
check(m.text.startsWith('Dear Asha Verma,') && m.text.includes('Wishing you a very Happy Birthday! May your year ahead be filled with happiness, good health, success, and new achievements.')
  && m.text.includes('We are glad to have you as part of the Amuwa Corporation team.') && m.text.endsWith('Best wishes,\nHR Team\nAmuwa Corporation'), 'birthday text', m.text);

m = renderHrEmail('ANNIVERSARY', { employeeName: 'Asha Verma', years: 3 });
check(m.subject === 'Happy Work Anniversary, Asha Verma!' && m.text.includes('Congratulations on your work anniversary at Amuwa Corporation!') && m.text.includes('3 completed years')
  && m.text.includes('Thank you for your dedication, contribution, and commitment to the company.') && m.text.endsWith('Best regards,\nHR Team\nAmuwa Corporation'), 'anniversary mail with the completed years', m.text);
check(renderHrEmail('ANNIVERSARY', { employeeName: 'A', years: 1 }).text.includes('1 completed year of service'), 'one year is singular');

m = renderHrEmail('PROBATION_REMINDER_EMPLOYEE', { employeeName: 'Asha Verma', probationEndDate: '2027-03-14' });
check(m.subject === 'Upcoming Employment Confirmation Review – Asha Verma'
  && m.text.includes('your six-month probation period at Amuwa Corporation is approaching completion on 14 March 2027.')
  && m.text.includes('HR will communicate the confirmation decision and any further steps required.') && !/permanent/i.test(m.text), 'employee probation reminder (never says permanent)', m.text);

const hrPayload = { employeeName: 'Asha Verma', employeeCode: 'EMP-1A2B3C4D', department: 'Wabastore', joiningDate: '2026-09-14', probationEndDate: '2027-03-14', daysLeft: 7 };
m = renderHrEmail('PROBATION_REMINDER_HR', hrPayload);
check(m.subject === 'Action Required: Probation Confirmation Due – Asha Verma' && m.text.startsWith('Dear HR Team,') && m.text.includes('approaching completion in 7 days.'), 'HR reminder subject and opening', m.text);
for (const line of ['Employee Name: Asha Verma', 'Employee ID: EMP-1A2B3C4D', 'Department: Wabastore', 'Date of Joining: 14 September 2026', 'Probation Completion Date: 14 March 2027']) {
  check(m.text.includes(line), `HR reminder lists "${line}"`);
}
check(m.text.includes('This is a reminder for HR action and does not automatically confirm permanent employment.') && m.text.endsWith('Regards,\nAI CRM – HR Automation'), 'HR reminder says it does not confirm anyone');
check(renderHrEmail('PROBATION_REMINDER_HR', { ...hrPayload, daysLeft: 3 }).text.includes('completion in 3 days') && renderHrEmail('PROBATION_REMINDER_HR', { ...hrPayload, daysLeft: 0 }).text.includes('completion today'),
  'a reminder found late says how many days are left');

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

console.log(`=== ${passed} HR E-MAIL TEMPLATE CHECKS PASSED ===`);
process.exit(0);
