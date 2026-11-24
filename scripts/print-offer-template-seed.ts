// Prints the seed of migration 20270206000100_hr_offer_templates.sql: the five supplied Offer Letter samples (shared/offerTemplates.ts) as JSON.
//   npx esbuild scripts/print-offer-template-seed.ts --bundle --platform=node --format=esm --outfile=.seed.tmp.mjs && node .seed.tmp.mjs
// The API test checks that the seeded version 1 of every template equals INITIAL_OFFER_TEMPLATES.
import { INITIAL_OFFER_TEMPLATES } from '../shared/offerTemplates';

process.stdout.write(JSON.stringify(INITIAL_OFFER_TEMPLATES.map(t => ({
  key: t.key, designation: t.designation, description: t.description, sortOrder: t.sortOrder, letterhead: t.letterhead, content: t.content
}))));
