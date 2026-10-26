/** Reading shop boards: turning OCR lines into field-visit fields (no browser, no OCR engine). */
import { formatPhone, parseShopText, type OcrLine } from '../../src/lib/ocr/shopText.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const L = (text: string, height: number, top: number, confidence = 90): OcrLine => ({ text, confidence, height, top });

// ---- phone numbers
check(formatPhone('98112 00000') === '+91 98112 00000', 'a mobile number is formatted');
check(formatPhone('+91-9811200000') === '+91 98112 00000', 'with +91 and a dash');
check(formatPhone('09811200000') === '+91 98112 00000', 'with a leading 0');
check(formatPhone('98l12 OOOOO') === '+91 98112 00000', 'letters read for digits are repaired (l, O)');
check(formatPhone('0141-2345678') === '01412345678', 'a landline keeps its STD code');
check(formatPhone('12345') === null && formatPhone('5811200000') === null, 'not a number: nothing');

// ---- a typical shop board
let s = parseShopText([
  L('SHARMA MOBILE & ELECTRONICS', 80, 40),
  L('Authorised Dealer', 30, 130),
  L('Shop No. 12, Main Market, Sector 14', 28, 600),
  L('Gurgaon, Haryana 122001', 28, 640),
  L('Mob: 98112 00000, 99100 11111', 30, 700),
  L('GSTIN 06ABCDE1234F1Z5', 24, 750),
  L('sharma.mobile@gmail.com', 24, 790)
]);
check(s.shopName?.value === 'Sharma Mobile & Electronics' && !s.shopName.check, 'the biggest text is the shop name (tidied from capitals)', s.shopName);
check(s.phones.map(p => p.value).join() === '+91 98112 00000,+91 99100 11111', 'both phone numbers', s.phones);
check(s.gstin?.value === '06ABCDE1234F1Z5', 'GSTIN', s.gstin);
check(s.email?.value === 'sharma.mobile@gmail.com', 'e-mail', s.email);
check(s.pincode?.value === '122001', 'pincode (not the phone digits)', s.pincode);
check(s.address?.value === 'Shop No. 12, Main Market, Sector 14, Gurgaon, Haryana 122001' && !s.address.check, 'the address lines are joined', s.address);
check(s.category === 'Mobile & electronics', 'shop type guessed from the words');
check(s.nameAlternatives.includes('Authorised Dealer'), 'next most prominent lines are offered as alternatives');

// a GSTIN the engine misread (the Z dropped) is shown as uncertain, not lost
s = parseShopText([L('Metro Traders', 80, 40), L('GSTIN 06ABCDE1234F175', 30, 300)]);
check(s.gstin?.value === '06ABCDE1234F175' && s.gstin.check, 'a damaged GSTIN is kept and flagged for checking', s.gstin);
check(parseShopText([L('Order no 12345678901234', 30, 10)]).gstin === null, 'a long number is not a GSTIN');

// ---- two-line names are joined; low confidence is flagged
s = parseShopText([L('GUPTA', 90, 40, 60), L('GENERAL STORE', 85, 140, 60), L('Ph 9811200000', 30, 400, 90)]);
check(s.shopName?.value === 'Gupta General Store' && s.shopName.check, 'a two-line name is joined, and a low-confidence read is flagged', s.shopName);
check(s.category === 'Grocery / Kirana', 'General Store -> Grocery / Kirana', s.category);

// ---- nothing useful
s = parseShopText([L('...', 20, 10, 20), L('~~ 12', 20, 50, 30)]);
check(s.shopName === null && s.phones.length === 0 && s.address === null, 'noise gives no fields');
check(parseShopText([]).rawText === '', 'an empty read is handled');

// ---- website, 10-digit phone is not a pincode, landline
s = parseShopText([L('Royal Opticals', 70, 30), L('www.royalopticals.in', 26, 300), L('Tel 0141-2345678', 26, 340), L('Opp. City Mall, Jaipur 302001', 26, 380)]);
check(s.website?.value === 'www.royalopticals.in', 'website', s.website);
check(s.phones[0]?.value === '01412345678', 'landline', s.phones);
check(s.pincode?.value === '302001' && s.category === 'Optical', 'pincode and shop type', s);
s = parseShopText([L('Fresh Bakery', 70, 30), L('9811200000', 26, 300)]);
check(s.pincode === null && s.phones.length === 1, 'a mobile number is never read as a pincode', s);

// ---- digits misread as letters in a phone line
s = parseShopText([L('City Medicos', 70, 30), L('Call: 98ll2 OOOO5', 26, 300)]);
check(s.phones[0]?.value === '+91 98112 00005' && s.category === 'Pharmacy / Medical store', 'lookalike letters in a phone line are repaired', s.phones);

// ---- what a scan may fill in
import { planFill } from '../../src/lib/ocr/scanFill.js';
const scan = parseShopText([L('Sharma Traders', 80, 40), L('Shop 4, Main Market, Delhi 110001', 28, 300), L('9811200000', 28, 340)]);
let plan = planFill(scan, { name: '', address: '', phone: '' }, {});
check(plan.values.name === 'Sharma Traders' && plan.values.phone === '+91 98112 00000' && /110001/.test(plan.values.address || ''), 'empty fields are all filled');
check(plan.fromPhoto.name && plan.fromPhoto.address && plan.fromPhoto.phone, 'and marked as read from the photo');
plan = planFill(scan, { name: 'My Typed Name', address: '', phone: '' }, {});
check(plan.values.name === undefined && plan.values.phone !== undefined, 'what the person typed is never overwritten');
plan = planFill(parseShopText([L('Gupta Stores', 80, 40)]), { name: 'Sharma Traders', address: 'x', phone: '+91 98112 00000' }, { name: true, address: false, phone: true });
check(plan.values.name === 'Gupta Stores' && plan.values.phone === undefined, 'a value from an earlier photo is replaced by the new photo, others are left');
console.log(`\n${passed} checks passed`);
