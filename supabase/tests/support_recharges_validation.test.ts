// The rules of a Support recharge (Panel / Message), as the screen and the API check them before the database checks them again:
// the money (GST + non-GST = total, never negative, 2 decimals), the date, the payment proof's type and size, the status, the list filters.
import { RECHARGE_MAX_FILE_BYTES, rechargeBodySchema, rechargeCreateSchema, rechargeListQuerySchema, rechargeStatusBodySchema, rechargeUploadSchema } from '../../shared/validation.js';

let passed = 0;
const check = (cond: boolean, name: string, extra?: unknown) => {
  if (!cond) { console.error('not ok -', name, extra ?? ''); process.exit(1); }
  passed++;
  console.log('ok -', name);
};
const ID = '11111111-1111-4111-8111-111111111111';
const base = { customerName: 'Alpha Traders', rechargeDate: '2026-11-20', gstAmount: 118, nonGstAmount: 500.5 };
const create = (o: Record<string, unknown> = {}) => rechargeCreateSchema.safeParse({ kind: 'PANEL', ...base, screenshotId: ID, ...o });
const body = (o: Record<string, unknown> = {}) => rechargeBodySchema.safeParse({ ...base, ...o });
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? '' : r.error!.issues.map(i => i.message).join(' | '));

check(create().success, 'a complete Panel recharge is valid');
check(create({ kind: 'MESSAGE' }).success, 'a Message recharge is valid');
check(/Panel Recharge or Message Recharge/.test(msg(create({ kind: 'BOTH' }))), 'only Panel or Message is a kind');
check(!create({ kind: undefined }).success, 'the kind is required');
check(/screenshot/i.test(msg(create({ screenshotId: null }))) && /screenshot/i.test(msg(create({ screenshotId: undefined }))), 'the payment screenshot is required to create');
check(body({ screenshotId: undefined }).success, '... but not to edit (the saved one stays)');
check(!create({ screenshotId: 'not-a-uuid' }).success, 'a screenshot id must be a UUID');
check(/customer name/i.test(msg(create({ customerName: 'A' }))) && !create({ customerName: '' }).success && !create({ customerName: 'x'.repeat(151) }).success, 'the customer name is 2 to 150 characters');
check(create({ customerName: '  Alpha  ' }).success && (create({ customerName: '  Alpha  ' }) as any).data.customerName === 'Alpha', 'the customer name is trimmed');
check(!create({ rechargeDate: '20-11-2026' }).success && !create({ rechargeDate: '' }).success, 'the date is YYYY-MM-DD');
check(/negative/i.test(msg(create({ gstAmount: -1 }))) && !create({ nonGstAmount: -0.01 }).success, 'amounts are never negative');
check(!create({ gstAmount: 'abc' }).success && !create({ nonGstAmount: Number.NaN }).success, 'amounts are numbers');
check(/2 decimal/.test(msg(create({ gstAmount: 10.123 }))) && create({ gstAmount: 10.12 }).success, 'at most 2 decimals');
check(!create({ gstAmount: 100000001 }).success, 'an amount has an upper limit');
check(/above zero/.test(msg(create({ gstAmount: 0, nonGstAmount: 0 }))) && !create({ gstAmount: undefined, nonGstAmount: undefined }).success, 'the total must be above zero');
check(create({ gstAmount: 0, nonGstAmount: 200 }).success && create({ gstAmount: 200, nonGstAmount: 0 }).success, 'GST only or non-GST only is valid');
check(create({ gstAmount: '118', nonGstAmount: '500.50' }).success, 'amounts typed as text are read as numbers');
check(create({ totalAmount: 618.5 }).success && create({ totalAmount: '618.50' }).success, 'a total equal to GST + non-GST is accepted');
check(/must equal/.test(msg(create({ totalAmount: 600 }))), 'a total that is not GST + non-GST is refused');
check(create({ gstAmount: 0.1, nonGstAmount: 0.2, totalAmount: 0.3 }).success, 'the sum is exact to the paisa (0.1 + 0.2 = 0.3)');
check(!create({ gstDetails: 'x'.repeat(501) }).success && !create({ nonGstDetails: 'x'.repeat(501) }).success && !create({ remarks: 'x'.repeat(1001) }).success, 'details are 500 and remarks 1000 characters at most');
check((create({ remarks: '   ' }) as any).data.remarks === null && (create({ gstDetails: '' }) as any).data.gstDetails === null, 'empty text is stored as nothing');
check(!create({ departmentId: ID }).success && !create({ createdBy: ID }).success && !create({ status: 'COMPLETED' }).success && !body({ kind: 'PANEL' }).success, 'a department, an owner, a status or a kind cannot be sent in the body');

check(rechargeStatusBodySchema.safeParse({ status: 'VERIFIED' }).success && rechargeStatusBodySchema.safeParse({ status: 'COMPLETED', note: 'ok' }).success, 'a status change is valid');
check(!rechargeStatusBodySchema.safeParse({ status: 'DONE' }).success, 'an unknown status is refused');
check(/why/i.test(msg(rechargeStatusBodySchema.safeParse({ status: 'REJECTED' }))) && /why/i.test(msg(rechargeStatusBodySchema.safeParse({ status: 'REJECTED', note: 'x' }))) && rechargeStatusBodySchema.safeParse({ status: 'REJECTED', note: 'bank mismatch' }).success, 'rejecting needs a reason');
check(!rechargeStatusBodySchema.safeParse({ status: 'PENDING', note: 'x'.repeat(501) }).success, 'the note is 500 characters at most');

const up = (o: Record<string, unknown> = {}) => rechargeUploadSchema.safeParse({ fileName: 'proof.png', mimeType: 'image/png', sizeBytes: 1000, ...o });
check(up().success && up({ mimeType: 'image/jpeg' }).success && up({ mimeType: 'image/webp' }).success && up({ mimeType: 'application/pdf', fileName: 'p.pdf' }).success, 'PNG, JPEG, WebP and PDF are accepted as proof');
check(!up({ mimeType: 'image/gif' }).success && !up({ mimeType: 'text/plain' }).success && !up({ mimeType: 'application/x-msdownload' }).success && !up({ mimeType: 'text/csv' }).success, 'GIF, text, executables and CSV are not');
check(/image \(PNG, JPEG or WebP\) or a PDF/.test(msg(up({ mimeType: 'image/gif' }))), 'and the message says what is accepted');
check(up({ sizeBytes: RECHARGE_MAX_FILE_BYTES }).success && /5 MB/.test(msg(up({ sizeBytes: RECHARGE_MAX_FILE_BYTES + 1 }))) && !up({ sizeBytes: 0 }).success && !up({ sizeBytes: -5 }).success, 'at most 5 MB, never empty');
check(!up({ fileName: '' }).success && !up({ fileName: 'x'.repeat(201) }).success && !up({ storagePath: '../x' }).success, 'a name is required and a storage path cannot be sent');

const list = (o: Record<string, unknown> = {}) => rechargeListQuerySchema.safeParse({ kind: 'PANEL', ...o });
check(list().success && (list() as any).data.limit === 20 && (list() as any).data.offset === 0, 'a list defaults to 20 records from the start');
check(!rechargeListQuerySchema.safeParse({}).success && !list({ kind: 'BOTH' }).success, 'a list needs a kind');
check(list({ search: 'alpha', status: 'PENDING', from: '2026-01-01', to: '2026-12-31', min: '100', max: '900', limit: '50', offset: '40' }).success, 'every filter together');
check(list({ status: '', from: '', to: '', min: '', max: '' }).success, 'empty filters are the same as none');
check(!list({ status: 'DONE' }).success && !list({ limit: 101 }).success && !list({ limit: 0 }).success && !list({ offset: -1 }).success, 'bad status and paging are refused');
check(/after the "to" date/.test(msg(list({ from: '2026-12-31', to: '2026-01-01' }))) && /minimum amount/.test(msg(list({ min: 900, max: 100 }))), 'a reversed date or amount range is refused');
check(!list({ search: 'x'.repeat(101) }).success && !list({ min: -1 }).success && !list({ extra: 1 }).success, 'search length, negative amounts and unknown filters are refused');
console.log(`=== ${passed} SUPPORT RECHARGE VALIDATION CHECKS PASSED ===`);
