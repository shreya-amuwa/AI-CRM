/** The Crocodial lead fields kept for the CRM pipeline (20270304000100): read defensively, never failing a row; and the reconcile loop. */
import { TO_STORE, customFields, productsText, reconcileLeads, scalarText } from '../../server/crocodial/sync.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

const { schema, map } = TO_STORE.leads;
const base = { id: 7, name: 'Asha', phone_number: '+919800000001', status: 'Fresh', assigned_to: { id: 501, name: 'x' }, created_by: { id: 599 }, updated_at: '2027-03-01T10:00:00+05:30' };
let row = map(schema.parse({ ...base, email: 'Asha@Example.com', interest: 'WhatsApp API', budget: 25000, deal_value: '1,20,000', products: [{ name: 'WABA' }, 'QR menu'],
  import_batch_id: 42, call_due_date: '2027-03-05', expected_close_date: '2027-03-31', ai_call_status: 'completed', custom_fields: { segment: 'SME', 'bad key!': 'x', nested: { a: 1 } } }));
check(row.email === 'Asha@Example.com' && row.interest === 'WhatsApp API' && row.budget === '25000' && row.dealValue === '1,20,000', 'e-mail, interest, budget and deal value are kept as short text (the database cleans the numbers)', row);
check(row.products === 'WABA, QR menu' && row.importBatch === '42' && row.callDueAt === '2027-03-05' && row.expectedCloseAt === '2027-03-31' && row.aiCallStatus === 'completed', 'products, batch and dates are read', row);
check(JSON.stringify(row.customFields) === JSON.stringify({ segment: 'SME' }), "custom fields: flat scalar values with safe keys only (the connection's allowed keys are applied by the database)", row.customFields);
check(row.assignedTo === 501 && row.createdBy === 599, 'the assignee and the creator stay separate (the creator is never taken as the one who assigned it)');
row = map(schema.parse({ ...base, email: { weird: true }, products: { x: 1 }, budget: [1], custom_fields: 'text' }));
check(row.email === null && row.products === null && row.budget === null && row.customFields === null, 'fields of an unexpected shape are dropped, the row is still kept', row);
row = map(schema.parse(base));
check(row.email === null && row.importBatch === null, 'an older account without the fields reads as before');
check(scalarText('  ', 10) === null && scalarText(12.5, 10) === '12.5' && productsText([]) === null && customFields(null) === null, 'helpers: empty values are null');

// the reconcile loop: batches until fewer than the batch size, stops at the deadline, never throws
const calls: unknown[] = [];
const fake = (answers: unknown[]) => ({ rpc: async (fn: string, args: unknown) => { calls.push({ fn, args }); const a = answers.shift(); return a instanceof Error ? { data: null, error: { message: a.message } } : { data: a, error: null }; } }) as any;
let r = await reconcileLeads(fake([{ processed: 2, created: 1, updated: 1, held: 0, failed: 0, pending: 3, enabled: true }, { processed: 1, created: 0, updated: 1, held: 0, failed: 0, pending: 0, enabled: true }]), 'c1', Date.now() + 10_000, 2);
check(r.batches === 2 && r.processed === 3 && r.created === 1 && r.updated === 2 && r.pending === 0 && r.enabled, 'batches run until nothing is waiting', r);
r = await reconcileLeads(fake([{ processed: 0, pending: 0, enabled: false }]), 'c1', Date.now() + 10_000);
check(r.batches === 1 && !r.enabled, 'with import off it stops after one call', r);
r = await reconcileLeads(fake([new Error('boom')]), 'c1', Date.now() + 10_000);
check(r.error?.includes('boom') && r.batches === 0, 'a failure is reported, not thrown (the read itself already succeeded)', r);
r = await reconcileLeads(fake([]), 'c1', Date.now() - 1);
check(r.batches === 0, 'nothing starts after the deadline (the next run continues)', r);
console.log(`=== ${passed} CROCODIAL LEAD MAPPER CHECKS PASSED ===`);
