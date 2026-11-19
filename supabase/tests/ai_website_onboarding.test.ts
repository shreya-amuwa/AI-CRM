/**
 * AI Website client onboarding (no database): the shared schema the form and the server use (the database checks the same rules in
 * public.ai_website_onboarding_save), and how the form starts from the lead. Run: npm run test:unit
 */
import { AI_WEBSITE_BUSINESS_TYPES, AI_WEBSITE_SERVICE, aiWebsiteOnboardingSchema, leadCreateSchema, leadUpdateSchema } from '../../shared/validation.js';
import { checkAiWebsite, emptyAiWebsiteDraft, prefillAiWebsite, tenDigits } from '../../src/components/team-member/pipeline/AiWebsiteOnboarding.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const good = { clientName: ' Kavya Nair ', mobile: '+91 98470-12345', email: 'Kavya@NairBakes.example', businessName: 'Nair Bakes', onGoogleMaps: true,
  googleMapsLink: 'https://maps.app.goo.gl/x', city: 'Kochi', businessType: 'Restaurant / Food' };
const ok = aiWebsiteOnboardingSchema.safeParse(good);
check(AI_WEBSITE_SERVICE === 'AI_WEBSITE', 'the service code is AI_WEBSITE');
check(ok.success && ok.data.clientName === 'Kavya Nair' && ok.data.mobile === '9847012345' && ok.data.email === 'kavya@nairbakes.example', 'a valid block is normalised (10-digit mobile, lower-case e-mail)', ok);
const bad = (patch: Record<string, unknown>, label: string) => check(!aiWebsiteOnboardingSchema.safeParse({ ...good, ...patch }).success, label);
bad({ clientName: '' }, 'client name is required');
bad({ mobile: '12345' }, 'mobile must be 10 digits');
bad({ mobile: '1234567890' }, 'mobile must start 6-9');
bad({ email: 'nope' }, 'e-mail must be valid');
bad({ businessName: ' ' }, 'business name is required');
bad({ onGoogleMaps: undefined }, 'the Google Maps answer is required');
bad({ googleMapsLink: 'maps.google.com' }, 'the Google Maps link is a web address');
bad({ city: '' }, 'city is required');
bad({ businessType: 'Spaceships' }, 'the type of business comes from the list');
bad({ businessType: 'Other' }, '"Other" needs the type typed in');
bad({ extra: 1 }, 'unknown fields are refused');
bad({ email: '' }, 'the e-mail is required');
bad({ email: undefined }, '... also when it is left out');
const noMaps = aiWebsiteOnboardingSchema.parse({ ...good, onGoogleMaps: false });
check(noMaps.googleMapsLink === null, '"No" drops a link');
check(aiWebsiteOnboardingSchema.parse({ ...good, businessTypeOther: 'x' }).businessTypeOther === null, 'a typed type is dropped unless "Other" is chosen');
check((AI_WEBSITE_BUSINESS_TYPES as readonly string[]).includes('Other'), 'the list has "Other"');

const lead = { name: 'K', company: 'C', phone: '9847012345', leadSource: 'Walk-in', services: ['AI_WEBSITE'] };
check(leadCreateSchema.safeParse({ ...lead, aiWebsiteOnboarding: good }).success && leadCreateSchema.safeParse(lead).success, 'a lead may carry the block (the server requires it for AI Website)');
check(leadUpdateSchema.safeParse({ aiWebsiteOnboarding: good }).success, 'an edit may carry only the block');

check(tenDigits('+91 98470 12345') === '9847012345' && tenDigits('09847012345') === '9847012345' && tenDigits('12345') === '', 'a lead mobile becomes the 10 digits (or nothing)');
const pre = prefillAiWebsite(emptyAiWebsiteDraft(), { name: 'Kavya', company: 'Nair Bakes', phone: '+91 98470 12345', email: null, city: 'Kochi', businessCategory: 'Fitness' });
check(pre.clientName === 'Kavya' && pre.businessName === 'Nair Bakes' && pre.mobile === '9847012345' && pre.email === '' && pre.city === 'Kochi' && pre.businessType === 'Fitness' && pre.onGoogleMaps === '',
  'the form starts from the lead; the Google Maps answer is never guessed', pre);
check(prefillAiWebsite({ ...pre, clientName: 'Typed' }, { name: 'Other' }).clientName === 'Typed', 'a field already filled is never replaced');
check(prefillAiWebsite(emptyAiWebsiteDraft(), { businessCategory: 'Something else' }).businessType === '', 'a category not in the list is not copied');
const c1 = checkAiWebsite({ ...pre, email: 'kavya@nairbakes.example', onGoogleMaps: 'no' });
check(c1.ok && c1.body.onGoogleMaps === false && c1.body.googleMapsLink === '', 'the form check passes a complete block', c1);
const c2 = checkAiWebsite(emptyAiWebsiteDraft());
check(!c2.ok && !!c2.errors.clientName && !!c2.errors.mobile && !!c2.errors.onGoogleMaps && !!c2.errors.city && !!c2.errors.businessType && !!c2.errors.email, 'an empty form names every required field, the e-mail included', c2);

console.log(`=== ${passed} AI WEBSITE ONBOARDING CHECKS PASSED ===`);
