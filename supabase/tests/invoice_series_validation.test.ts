// The rules of "set the next invoice number" (20270313000100) as the API checks them before the database checks them again: GST or Non-GST,
// a financial year written like 26-27 (two consecutive years), a whole number from 1 to 99999. The actor is never part of the request.
import { invoiceSeriesSetSchema } from '../../shared/validation.js';

let passed = 0;
const check = (cond: boolean, name: string, extra?: unknown) => {
  if (!cond) { console.error('not ok -', name, extra ?? ''); process.exit(1); }
  passed++;
  console.log('ok -', name);
};
const set = (o: Record<string, unknown> = {}) => invoiceSeriesSetSchema.safeParse({ type: 'GST', fy: '26-27', next: 616, ...o });
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? '' : r.error!.issues.map(i => i.message).join(' | '));

check(set().success && set({ type: 'NON_GST', next: 251 }).success, 'GST 616 and Non-GST 251 are valid');
check(!set({ type: 'VAT' }).success && /GST or Non-GST/.test(msg(set({ type: 'VAT' }))) && !set({ type: undefined }).success, 'only GST or Non-GST');
check(set({ fy: '99-00' }).success && set({ fy: '27-28' }).success, 'consecutive years, including the century change (99-00)');
check(!set({ fy: '26-28' }).success && !set({ fy: '27-26' }).success && !set({ fy: '26-26' }).success, 'years that are not consecutive are refused');
check(!set({ fy: '2026-27' }).success && !set({ fy: '26/27' }).success && !set({ fy: '2627' }).success && !set({ fy: undefined }).success, 'the year is written like 26-27');
check(/like 26-27|consecutive/.test(msg(set({ fy: 'abc' }))), 'with a clear message');
check(set({ next: 1 }).success && set({ next: 99999 }).success && set({ next: '616' }).data?.next === 616, 'from 1 to 99999 (a number typed in a form arrives as text)');
check(!set({ next: 0 }).success && !set({ next: -3 }).success && !set({ next: 100000 }).success && !set({ next: 6.5 }).success && !set({ next: undefined }).success, 'zero, negative, above 99999, with decimals or missing is refused');
check(!set({ userId: 'x' }).success && !set({ invoiceNumber: 'GST/26-27/616' }).success, 'nothing else is accepted: the person is never in the request and a number is never typed');

console.log(`${passed} invoice series validation checks passed`);
