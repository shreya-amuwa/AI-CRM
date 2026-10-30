import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountsCustomerDetailsSchema } from '../../shared/validation';
const profile = { name: 'Contact', company: 'Business', phone: '+91 98476 50321', whatsapp: '', email: '', city: '', address: '' };
assert(accountsCustomerDetailsSchema.safeParse(profile).success);
for (const field of ['dealAmount','services','ownerId','departmentId','gstRate','amountReceived']) {
  assert(!accountsCustomerDetailsSchema.safeParse({ ...profile, [field]: 1 }).success, field);
}
for (const patch of [{ name: '' }, { company: '' }, { phone: 'bad' }, { email: 'invalid' }, { whatsapp: '123' }]) {
  assert(!accountsCustomerDetailsSchema.safeParse({ ...profile, ...patch }).success);
}
const payment = readFileSync('src/components/accounts/AccountsPaymentPanel.tsx', 'utf8');
assert(!/pay-split|installmentPlan|splitIntoInstallments|setSplit/.test(payment));
assert(payment.includes('const shownAmount = full ? String(open) : amount;'));
console.log('Accounts profile validation and payment modal regression checks passed');
