/**
 * AI Studio project deadlines, the parts that need no database: the countdown arithmetic, when the clock turns amber and red, Indian time in and out
 * of the date field, the server's clock against this computer's, and the form rule for the deadline.
 * Run: npm run test:unit
 */
import { countdown, countdownText, deadlineLabel, isoToIstInput, istInputToIso, serverOffsetMs, urgencyOf } from '../../src/lib/aiStudioDeadline.js';
import { aiStudioProjectSchema } from '../../shared/validation.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const NOW = Date.parse('2026-11-20T06:30:00Z');           // 12:00 pm Indian time
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const H = 3600 * 1000, D = 24 * H;

// 1. the numbers on the clock
const c = countdown(at(3 * D + 4 * H + 12 * 60000 + 9000), NOW)!;
check(!c.overdue && c.days === 3 && c.hours === 4 && c.minutes === 12 && c.seconds === 9, '3 days 4 h 12 min 9 s are shown as such', c);
check(countdownText(c) === '3d 04h 12m 09s left', 'the short text', countdownText(c));
const last = countdown(at(5 * 3600000 + 59 * 60000 + 1000), NOW)!;
check(last.days === 0 && countdownText(last) === '05h 59m 01s left', 'inside the last day the days are left out', countdownText(last));
const ticking = countdown(at(1000), NOW)!;
check(ticking.seconds === 1 && !ticking.overdue, 'one second before the deadline is still "left"');
const zero = countdown(at(0), NOW)!;
check(zero.overdue && zero.days === 0 && zero.seconds === 0, 'at the deadline the clock reads zero and is overdue');
const over = countdown(at(-(2 * D + 3 * H + 5 * 60000 + 7000)), NOW)!;
check(over.overdue && over.days === 2 && over.hours === 3 && over.minutes === 5 && over.seconds === 7 && countdownText(over) === '2d 03h 05m 07s overdue', 'after it, the clock counts how long ago', countdownText(over));
check(countdown(null, NOW) === null && countdown('', NOW) === null && countdown('not a date', NOW) === null, 'no deadline, or a damaged one, shows no clock');

// 2. when it turns amber and red
check(urgencyOf(10 * D) === 'ok' && urgencyOf(3 * D) === 'ok', 'three days or more: on track');
check(urgencyOf(3 * D - 1) === 'soon' && urgencyOf(D) === 'soon', 'under three days: due soon');
check(urgencyOf(D - 1) === 'critical' && urgencyOf(1) === 'critical', 'under a day: critical');
check(urgencyOf(0) === 'overdue' && urgencyOf(-1) === 'overdue', 'at zero and after: overdue');

// 3. Indian time in and out of the date field
check(istInputToIso('2026-11-25T18:00') === '2026-11-25T18:00:00+05:30', 'the date field is read as Indian time');
check(Date.parse(istInputToIso('2026-11-25T18:00')!) === Date.parse('2026-11-25T12:30:00Z'), 'which is 12:30 UTC');
check(isoToIstInput('2026-11-25T12:30:00Z') === '2026-11-25T18:00' && isoToIstInput('2026-11-25T18:00:00+05:30') === '2026-11-25T18:00', 'and an instant fills the field in Indian time, whatever offset it came with');
check(isoToIstInput('2026-11-25T20:00:00Z') === '2026-11-26T01:30', 'across midnight the date moves with it');
check(istInputToIso('') === null && istInputToIso('25/11/2026') === null && istInputToIso('2026-13-45T99:99') === null, 'an empty or malformed field is no deadline');
check(isoToIstInput(null) === '' && isoToIstInput('junk') === '', 'no deadline fills nothing');
check(/25 Nov 2026/.test(deadlineLabel('2026-11-25T12:30:00Z')) && /06:00 pm IST/i.test(deadlineLabel('2026-11-25T12:30:00Z')), 'the label is in Indian time', deadlineLabel('2026-11-25T12:30:00Z'));
check(deadlineLabel(null) === '-' && deadlineLabel('junk') === '-', 'and "-" for none');

// 4. a wrong computer clock does not move the deadline
const wrongLocal = NOW - 2 * H;                              // this computer is two hours slow
const off = serverOffsetMs(new Date(NOW).toISOString(), wrongLocal);
check(off === 2 * H, 'the difference to the server is kept', off);
check(countdown(at(H), wrongLocal + off)!.hours === 1 && countdown(at(H), wrongLocal)!.hours === 3, 'a slow computer still counts to the right moment (without the offset it would show 3 h instead of 1 h)');
check(serverOffsetMs('junk', NOW) === 0, 'an unreadable server time changes nothing');

// 5. the project form: left out = unchanged, empty / null = no deadline, a time with its offset = due then
const base = { name: 'AI CRM' };
const s1 = aiStudioProjectSchema.safeParse(base);
check(s1.success && s1.data.deadlineAt === undefined, 'a form that does not touch the deadline leaves it out');
const s2 = aiStudioProjectSchema.safeParse({ ...base, deadlineAt: '' });
check(s2.success && s2.data.deadlineAt === null, 'an emptied field means "no deadline"');
const s3 = aiStudioProjectSchema.safeParse({ ...base, deadlineAt: null });
check(s3.success && s3.data.deadlineAt === null, 'null too');
const s4 = aiStudioProjectSchema.safeParse({ ...base, deadlineAt: '2026-11-25T18:00:00+05:30' });
check(s4.success && s4.data.deadlineAt === '2026-11-25T18:00:00+05:30', 'a time with its offset is accepted');
const s5 = aiStudioProjectSchema.safeParse({ ...base, deadlineAt: '2026-11-25T18:00:00' });
check(!s5.success, 'a time without an offset is refused (it would mean different moments in different places)');
const s6 = aiStudioProjectSchema.safeParse({ ...base, deadlineAt: 'tomorrow' });
check(!s6.success && /date and time/.test(s6.error.issues[0].message), 'text is refused with a clear message');
const s7 = aiStudioProjectSchema.safeParse({ ...base, deadlineAt: 12345 });
check(!s7.success, 'a number is refused');

console.log(`AI STUDIO DEADLINE CHECKS PASSED (${passed})`);
