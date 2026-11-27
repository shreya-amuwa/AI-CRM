// The Wallet PIN rules (shared/validation.ts), the same ones the database enforces in wallet_pin_check (supabase/tests/wallet_pin_test.sql):
// exactly 4 digits for a new or changed PIN; a 6-digit PIN is accepted only as the CURRENT PIN of a person who has not changed it yet.
import { WALLET_LEGACY_PIN_LENGTH, WALLET_PIN_LENGTH, walletLegacyPinSchema, walletNewPinSchema, walletPinSchema } from '../../shared/validation.js';

let passed = 0;
const check = (cond: boolean, name: string, extra?: unknown) => {
  if (!cond) { console.error('not ok -', name, extra ?? ''); process.exit(1); }
  passed++;
  console.log('ok -', name);
};
check(WALLET_PIN_LENGTH === 4 && WALLET_LEGACY_PIN_LENGTH === 6, 'a PIN is 4 digits; 6 is only the old length');
for (const ok of ['4829', '7391', '0001', '9998', '0007', '1357', '2468']) check(walletPinSchema.safeParse(ok).success, `${ok} is a valid PIN`);
for (const [bad, why] of [['', 'empty'], ['1', '1 digit'], ['482', '3 digits'], ['48291', '5 digits'], ['482913', '6 digits'], ['4829137', '7 digits'], ['48a9', 'a letter'], ['48 9', 'a space'], ['48-9', 'a symbol'],
  ['４８２９', 'full-width digits'], ['48.9', 'a dot'], ['+482', 'a plus'], ['١٢٣٤', 'Arabic-Indic digits'], [' 482', 'a leading space'], ['4829\n', 'a trailing newline']] as [string, string][]) {
  check(!walletPinSchema.safeParse(bad).success, `${why} is refused`, bad);
}
for (const weak of ['1111', '0000', '9999', '1234', '4321', '0123', '3210', '6789', '9876']) check(!walletPinSchema.safeParse(weak).success, `${weak} is too easy to guess`);
check(!walletPinSchema.safeParse(1234 as unknown as string).success && !walletPinSchema.safeParse(null as unknown as string).success && !walletPinSchema.safeParse(undefined as unknown as string).success, 'a number, null or nothing is refused');
check(walletNewPinSchema.safeParse({ pin: '4829', confirm: '4829' }).success, 'a new PIN with its confirmation is valid');
check(!walletNewPinSchema.safeParse({ pin: '4829', confirm: '4820' }).success, 'the confirmation must match');
check(!walletNewPinSchema.safeParse({ pin: '482913', confirm: '482913' }).success, 'a new 6-digit PIN is refused even when confirmed');
check(!walletNewPinSchema.safeParse({ pin: '4829', confirm: '4829', extra: 1 }).success, 'nothing else can be sent with it');
check(walletLegacyPinSchema.safeParse('482913').success && !walletLegacyPinSchema.safeParse('4829').success && !walletLegacyPinSchema.safeParse('4829135').success && !walletLegacyPinSchema.safeParse('48291a').success,
  'the old 6-digit PIN is accepted only as the current PIN, and only with exactly 6 digits');
console.log(`=== ${passed} WALLET PIN VALIDATION CHECKS PASSED ===`);
