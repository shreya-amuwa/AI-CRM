/**
 * The input rules of the order GST workflow, as the browser form and the API apply them (no database needed):
 * a payment is whole rupees and carries no GST of its own; the GST rate belongs to the order.
 * Run: npm run test:unit
 */
import { accountsRecordPaymentSchema, accountsUpdatePaymentSchema, orderGstSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error('not ok -', label, extra ?? '');
    process.exitCode = 1;
    throw new Error(`failed: ${label}`);
  }
  passed += 1;
  console.log('ok -', label);
}

const pay = { type: 'FULL', amount: 17, method: 'CASH', verify: true };
check(accountsRecordPaymentSchema.safeParse(pay).success, 'a whole-rupee full payment (17) is accepted');
const paise = accountsRecordPaymentSchema.safeParse({ ...pay, amount: 16.52 });
check(!paise.success && /whole rupees/.test(paise.error.issues[0].message), '16.52 is refused: whole rupees only');
check(!accountsRecordPaymentSchema.safeParse({ ...pay, amount: 0 }).success && !accountsRecordPaymentSchema.safeParse({ ...pay, amount: -5 }).success, 'zero and negative amounts are refused');
check(accountsRecordPaymentSchema.safeParse({ ...pay, amount: '60000' }).success, 'an amount typed in a form field (a string) is read as a number');
const withGst = accountsRecordPaymentSchema.safeParse({ ...pay, gstRate: 18 });
check(!withGst.success, 'a payment cannot carry a GST rate of its own (the field is rejected)');
check(!accountsUpdatePaymentSchema.safeParse({ type: 'PART', amount: 10, method: 'CASH', gstRate: 18 }).success, 'nor can an edit of a payment');
check(!accountsRecordPaymentSchema.safeParse({ ...pay, method: 'UPI' }).success, 'UPI still needs a reference');

check(orderGstSchema.parse({ rate: 18 }).rate === 18 && orderGstSchema.parse({ rate: '12' }).rate === 12 && orderGstSchema.parse({ rate: 0 }).rate === 0, 'the order GST rate is a number (0 is a real choice)');
check(!orderGstSchema.safeParse({ rate: 'abc' }).success && !orderGstSchema.safeParse({ rate: -1 }).success && !orderGstSchema.safeParse({ rate: 29 }).success && !orderGstSchema.safeParse({}).success, 'a missing, non-numeric or out-of-range rate is refused (the database also checks the configured list)');
check(!orderGstSchema.safeParse({ rate: 18, amount: 5 }).success, 'nothing else can ride along with the rate');

console.log(`=== ${passed} ORDER GST INPUT CHECKS PASSED ===`);
