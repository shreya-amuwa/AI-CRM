/**
 * Proposed installments for a part payment (Accounts' Record payment form).
 *
 * The CRM keeps money in WHOLE RUPEES (the order's total payable is rounded to whole rupees and a payment is a whole-rupee amount), so a
 * split is done in integers: no floating point, no paise. The parts always add up to the amount split, exactly; when it does not divide
 * evenly the extra rupees go to the earliest installments (Rs 81,601 in two: 40,801 + 40,800).
 *
 * A proposed installment is a PLAN shown to Accounts, not a payment: nothing here is stored, invoiced or counted as received. The order
 * stays unsettled until real, verified payments cover it, and GST, invoice totals and balances are never touched by a split.
 */
export function splitIntoInstallments(total: number, parts = 2): number[] {
  if (!Number.isInteger(total) || !Number.isInteger(parts) || parts < 2 || total < parts) return [];
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * The plan for the part payment being typed: `open` is what is still to receive (total payable minus the money already on record),
 * `amount` the payment being recorded now. The second installment is whatever remains after this one. Null when there is nothing sensible to
 * propose (a whole-rupee amount below the outstanding amount is required: that is what makes it a part payment).
 */
export function installmentPlan(open: number, amount: number): { now: number; later: number } | null {
  if (!Number.isInteger(open) || !Number.isInteger(amount) || amount < 1 || amount >= open) return null;
  return { now: amount, later: open - amount };
}
