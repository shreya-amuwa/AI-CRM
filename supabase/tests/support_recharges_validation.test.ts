// The rules of a Support recharge (Panel / Message) as the screen and the API check them before the database checks them again: the customer, GST / Non-GST and the
// money (amount + GST = total, never negative, 2 decimals), the date, Accounts' decisions, the payment proof's type and size, the list filters. The
// Relationship Manager is never part of a request.
import {
  RECHARGE_MAX_FILE_BYTES, rechargeBodySchema, rechargeCorrectSchema, rechargeCreateSchema, rechargeListQuerySchema, rechargePerformanceQuerySchema, rechargeUploadSchema, rechargeVerifySchema
} from '../../shared/validation.js';

let passed = 0;
const check = (cond: boolean, name: string, extra?: unknown) => {
  if (!cond) { console.error('not ok -', name, extra ?? ''); process.exit(1); }
  passed++;
  console.log('ok -', name);
};
const ID = '11111111-1111-4111-8111-111111111111';
const GSTIN = '27AAPFU0939F1ZV';
const base = { customerId: ID, rechargeDate: '2026-11-20', billingType: 'NON_GST', rechargeAmount: 500.5, gstAmount: 0 };
const create = (o: Record<string, unknown> = {}) => rechargeCreateSchema.safeParse({ kind: 'PANEL', ...base, screenshotId: ID, ...o });
const gst = (o: Record<string, unknown> = {}) => create({ billingType: 'GST', rechargeAmount: 500, gstAmount: 90, gstNumber: GSTIN, ...o });
const body = (o: Record<string, unknown> = {}) => rechargeBodySchema.safeParse({ ...{ rechargeDate: base.rechargeDate, billingType: 'NON_GST', rechargeAmount: 100, gstAmount: 0 }, ...o });
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? '' : r.error!.issues.map(i => i.message).join(' | '));

check(create().success && create({ kind: 'MESSAGE' }).success, 'a complete Non-GST Panel and Message recharge are valid');
check(gst().success, 'a complete GST recharge is valid');
check(/Panel Recharge or Message Recharge/.test(msg(create({ kind: 'BOTH' }))) && !create({ kind: undefined }).success, 'only Panel or Message is a kind');
check(!create({ customerId: undefined }).success && !create({ customerId: 'not-a-uuid' }).success, 'the customer is required (a UUID)');
check(/screenshot/i.test(msg(create({ screenshotId: null }))) && /screenshot/i.test(msg(create({ screenshotId: undefined }))), 'the payment screenshot is required to create');
check(body({ screenshotId: undefined }).success, '... but not to edit (the saved one stays)');
check(/GST or Non-GST/.test(msg(create({ billingType: 'OTHER' }))) && !create({ billingType: undefined }).success, 'the billing is GST or Non-GST');
check(!create({ rechargeDate: '20-11-2026' }).success && !create({ rechargeDate: '' }).success, 'the date is YYYY-MM-DD');
check(/above zero/.test(msg(create({ rechargeAmount: 0 }))) && !create({ rechargeAmount: -5 }).success && !create({ rechargeAmount: undefined }).success, 'the recharge amount is above zero');
check(!create({ rechargeAmount: 'abc' }).success && !create({ gstAmount: Number.NaN }).success, 'amounts are numbers');
check(/2 decimal/.test(msg(create({ rechargeAmount: 10.123 }))) && create({ rechargeAmount: 10.12 }).success, 'at most 2 decimals');
check(!create({ rechargeAmount: 100000001 }).success && !create({ gstAmount: -1 }).success, 'an amount has an upper limit and is never negative');
check(create({ rechargeAmount: '500', gstAmount: '0' }).success, 'amounts typed as text are read as numbers');
check(/no GST amount/.test(msg(create({ gstAmount: 90 }))), 'a Non-GST recharge has no GST amount');
check(/more than the recharge amount/.test(msg(gst({ gstAmount: 600 }))), 'GST cannot be more than the amount');
check(gst({ gstAmount: 0 }).success, 'GST of zero is allowed (Accounts decide the tax treatment)');
check(gst({ totalAmount: 590 }).success && gst({ totalAmount: '590.00' }).success && /must equal/.test(msg(gst({ totalAmount: 600 }))), 'a total equal to amount + GST is accepted, another is refused');
check(create({ rechargeAmount: 0.1, gstAmount: 0, totalAmount: 0.1 }).success && gst({ rechargeAmount: 0.1, gstAmount: 0.02, totalAmount: 0.12 }).success, 'the sum is exact to the paisa');
check((gst({ gstNumber: '27aapfu0939f1zv' }) as any).data.gstNumber === GSTIN && (gst({ gstNumber: ' 27 AAPFU0939F1ZV ' }) as any).data.gstNumber === GSTIN, 'a GST number is cleaned (case and spaces)');
check(/valid 15-character/.test(msg(gst({ gstNumber: '27AAPFU0939F1Z' }))) && !gst({ gstNumber: 'abc' }).success, 'a GST number must look like one');
check((create({ paymentReference: '  UPI-7001 ' }) as any).data.paymentReference === 'UPI-7001' && (create({ paymentReference: '' }) as any).data.paymentReference === null, 'the payment reference is trimmed; empty is nothing');
check(!create({ paymentReference: 'x'.repeat(101) }).success && !create({ remarks: 'x'.repeat(1001) }).success, 'reference 100 and remarks 1000 characters at most');
check(!create({ rmId: ID }).success && !create({ rm: ID }).success && !create({ createdBy: ID }).success && !create({ departmentId: ID }).success && !create({ paymentStatus: 'PAYMENT_RECEIVED' }).success && !create({ status: 'COMPLETED' }).success,
  'a Relationship Manager, an owner, a department or a status cannot be sent');
check(!body({ customerId: ID }).success && !body({ kind: 'PANEL' }).success && !body({ rmId: ID }).success, 'editing cannot change the customer, the kind or the Relationship Manager');

check(rechargeVerifySchema.safeParse({ decision: 'RECEIVED' }).success && rechargeVerifySchema.safeParse({ decision: 'RECEIVED', receivedAmount: 590, note: 'seen in the statement' }).success, 'Accounts can confirm a payment');
check(!rechargeVerifySchema.safeParse({ decision: 'PAID' }).success && !rechargeVerifySchema.safeParse({ decision: 'RECEIVED', paymentStatus: 'X' }).success, 'a decision is one of the three, nothing else is accepted');
check(/note is required/.test(msg(rechargeVerifySchema.safeParse({ decision: 'NOT_RECEIVED' }))) && /note is required/.test(msg(rechargeVerifySchema.safeParse({ decision: 'REJECTED', note: 'x' }))) && rechargeVerifySchema.safeParse({ decision: 'REJECTED', note: 'wrong customer' }).success, '"not received" and a rejection need a note');
check(!rechargeVerifySchema.safeParse({ decision: 'RECEIVED', receivedAmount: -1 }).success && !rechargeVerifySchema.safeParse({ decision: 'RECEIVED', note: 'x'.repeat(501) }).success, 'the amount is not negative; the note is 500 characters at most');
check(rechargeCorrectSchema.safeParse({ note: 'GST is 100 on the invoice', gstAmount: 100 }).success && rechargeCorrectSchema.safeParse({ note: 'new e-mail', customerEmail: 'Billing@Example.com' }).success, 'a correction with its reason');
check(/what was corrected/.test(msg(rechargeCorrectSchema.safeParse({ gstAmount: 100 }))) && !rechargeCorrectSchema.safeParse({ note: 'x', gstAmount: 100 }).success, 'a correction needs a reason');
check(!rechargeCorrectSchema.safeParse({ note: 'fix', customerEmail: 'nope' }).success && !rechargeCorrectSchema.safeParse({ note: 'fix', customerId: ID }).success && !rechargeCorrectSchema.safeParse({ note: 'fix', rmId: ID }).success,
  'a bad e-mail is refused; the customer and the RM cannot be corrected');

const up = (o: Record<string, unknown> = {}) => rechargeUploadSchema.safeParse({ fileName: 'proof.png', mimeType: 'image/png', sizeBytes: 1000, ...o });
check(up().success && up({ mimeType: 'image/jpeg' }).success && up({ mimeType: 'image/webp' }).success && up({ mimeType: 'application/pdf', fileName: 'p.pdf' }).success, 'PNG, JPEG, WebP and PDF are accepted as proof');
check(!up({ mimeType: 'image/gif' }).success && !up({ mimeType: 'text/plain' }).success && !up({ mimeType: 'application/x-msdownload' }).success && !up({ mimeType: 'text/csv' }).success, 'GIF, text, executables and CSV are not');
check(/image \(PNG, JPEG or WebP\) or a PDF/.test(msg(up({ mimeType: 'image/gif' }))), 'and the message says what is accepted');
check(up({ sizeBytes: RECHARGE_MAX_FILE_BYTES }).success && /5 MB/.test(msg(up({ sizeBytes: RECHARGE_MAX_FILE_BYTES + 1 }))) && !up({ sizeBytes: 0 }).success && !up({ sizeBytes: -5 }).success, 'at most 5 MB, never empty');
check(!up({ fileName: '' }).success && !up({ fileName: 'x'.repeat(201) }).success && !up({ storagePath: '../x' }).success, 'a name is required and a storage path cannot be sent');

const list = (o: Record<string, unknown> = {}) => rechargeListQuerySchema.safeParse({ ...o });
check(list().success && (list() as any).data.limit === 20 && (list() as any).data.offset === 0, 'a list defaults to 20 records from the start (Accounts may leave the kind out)');
check(list({ kind: 'PANEL' }).success && !list({ kind: 'BOTH' }).success && list({ kind: '' }).success, 'the kind is Panel or Message, or absent');
check(list({ kind: 'MESSAGE', search: 'alpha', paymentStatus: 'PENDING_VERIFICATION', invoiceStatus: 'GENERATED_ANY', from: '2026-01-01', to: '2026-12-31', min: '100', max: '900', rm: ID, limit: '50', offset: '40' }).success, 'every filter together');
check(list({ paymentStatus: '', invoiceStatus: '', from: '', to: '', min: '', max: '', rm: '' }).success, 'empty filters are the same as none');
check(!list({ paymentStatus: 'DONE' }).success && !list({ invoiceStatus: 'SHIPPED' }).success && !list({ limit: 101 }).success && !list({ limit: 0 }).success && !list({ offset: -1 }).success && !list({ rm: 'x' }).success, 'bad status, paging and RM are refused');
check(/after the "to" date/.test(msg(list({ from: '2026-12-31', to: '2026-01-01' }))) && /minimum amount/.test(msg(list({ min: 900, max: 100 }))), 'a reversed date or amount range is refused');
check(!list({ search: 'x'.repeat(101) }).success && !list({ min: -1 }).success && !list({ extra: 1 }).success, 'search length, negative amounts and unknown filters are refused');
check(rechargePerformanceQuerySchema.safeParse({}).success && rechargePerformanceQuerySchema.safeParse({ from: '2026-01-01', to: '2026-02-01', rm: ID }).success && !rechargePerformanceQuerySchema.safeParse({ from: '2026-03-01', to: '2026-02-01' }).success
  && !rechargePerformanceQuerySchema.safeParse({ rm: 'x' }).success, 'the performance query: optional dates and RM, a reversed range is refused');
console.log(`=== ${passed} SUPPORT RECHARGE VALIDATION CHECKS PASSED ===`);
