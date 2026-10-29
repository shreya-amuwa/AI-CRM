import { installmentPlan, splitIntoInstallments } from '../../shared/installments';

let n = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (!ok) {
    console.error('FAILED:', label, detail === undefined ? '' : JSON.stringify(detail));
    process.exit(1);
  }
  n++;
  console.log('ok -', label);
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

console.log('--- installment split (whole rupees, exact)');
check(JSON.stringify(splitIntoInstallments(81600)) === '[40800,40800]', 'an even amount splits in two equal installments', splitIntoInstallments(81600));
check(JSON.stringify(splitIntoInstallments(118000)) === '[59000,59000]', 'Rs 1,18,000 -> 59,000 + 59,000');
check(JSON.stringify(splitIntoInstallments(81601)) === '[40801,40800]', 'an odd amount: the extra rupee goes to the first installment', splitIntoInstallments(81601));
check(JSON.stringify(splitIntoInstallments(3)) === '[2,1]', 'three rupees: 2 + 1');
check(JSON.stringify(splitIntoInstallments(2)) === '[1,1]', 'two rupees: 1 + 1');
check(splitIntoInstallments(1).length === 0, 'one rupee cannot be split');
check(splitIntoInstallments(0).length === 0 && splitIntoInstallments(-100).length === 0, 'zero or a negative amount is not split');
check(splitIntoInstallments(1000.5).length === 0 && splitIntoInstallments(NaN).length === 0, 'paise or a non-number are refused (money is whole rupees)');
check(JSON.stringify(splitIntoInstallments(100, 3)) === '[34,33,33]', 'three parts work the same way');
for (const total of [2, 3, 7, 99, 100, 101, 999, 12345, 236000, 236001, 1_000_000_007, 9_007_199_254_740_990]) {
  const parts = splitIntoInstallments(total);
  check(parts.length === 2 && sum(parts) === total && parts[0] >= parts[1] && parts[0] - parts[1] <= 1 && parts.every(Number.isInteger), `${total}: the parts add up exactly and differ by at most one rupee`, parts);
}

console.log('--- the plan for the part payment being typed');
check(JSON.stringify(installmentPlan(163200, 81600)) === '{"now":81600,"later":81600}', 'the second installment is what remains after this one');
check(JSON.stringify(installmentPlan(118000, 50000)) === '{"now":50000,"later":68000}', 'an unequal first payment: the rest is the second installment');
check(installmentPlan(118000, 118000) === null, 'paying everything is not a part payment: no plan');
check(installmentPlan(118000, 200000) === null && installmentPlan(118000, 0) === null && installmentPlan(118000, 12.5) === null, 'more than outstanding, nothing, or paise: no plan');
check(installmentPlan(118000, 1)?.later === 117999, 'a rupee now leaves the exact remainder');

console.log(`=== ${n} INSTALLMENT SPLIT CHECKS PASSED ===`);
