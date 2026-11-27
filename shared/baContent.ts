/**
 * The text of a Business Associate's documents, as the AI writes it, as the Business Associate edits it and as the PDF prints it.
 * One definition for the API (authoritative), the editor and the PDF. Numbers (prices, tax, totals) are NEVER part of this text: they are
 * worked out by the database from the quotation lines.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const list = (max: number, item = 600) => z.array(text(item).min(1)).max(max);

// ---------------------------------------------------------------------------
// Quotation text
// ---------------------------------------------------------------------------
export const quotationContentSchema = z
  .object({
    introduction: text(2500).default(''),
    understanding: text(3000).default(''),
    recommendedServices: text(3000).default(''),
    scopeSummary: text(3000).default(''),
    commercialTerms: text(3000).default(''),
    implementationTimeline: text(2000).default(''),
    exclusions: list(15).default([]),
    notes: list(15).default([]),
    /** service code -> a short description of that service for this client */
    serviceDescriptions: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/), text(1500)).default({}),
    /** what the AI could not know: shown to the Business Associate, never printed as fact */
    missingInformation: list(15).default([])
  })
  .strict();
export type QuotationContent = z.infer<typeof quotationContentSchema>;
export const EMPTY_QUOTATION_CONTENT: QuotationContent = quotationContentSchema.parse({});

// ---------------------------------------------------------------------------
// Scope of Project
// ---------------------------------------------------------------------------
export const BASIS = ['VERIFIED', 'ASSUMPTION'] as const;
export type Basis = (typeof BASIS)[number];
/** A point of the analysis: what the client told us (VERIFIED) is told apart from what the AI judges (ASSUMPTION). */
export const analysisItemSchema = z.object({ text: text(700).min(1), basis: z.enum(BASIS).default('ASSUMPTION') }).strict();
const items = z.array(analysisItemSchema).max(10);

export const businessAnalysisSchema = z
  .object({
    swot: z.object({ strengths: items.default([]), weaknesses: items.default([]), opportunities: items.default([]), threats: items.default([]) }).strict().default({}),
    keyChallenges: items.default([]),
    growthAreas: items.default([]),
    improvementAreas: items.default([])
  })
  .strict();

export const recommendedSolutionSchema = z
  .object({
    serviceCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/),
    reason: text(1200).default(''),
    benefits: text(1200).default(''),
    integrations: text(1000).default(''),
    dependencies: text(1000).default(''),
    considerations: text(1000).default('')
  })
  .strict();

export const projectScopeSchema = z
  .object({
    overview: text(3000).default(''),
    objectives: list(12).default([]),
    challenges: list(12).default([]),
    proposedSolution: text(3000).default(''),
    servicesIncluded: list(30, 200).default([]),
    deliverables: list(20).default([]),
    functionalRequirements: list(20).default([]),
    phases: z.array(z.object({ name: text(200).min(1), duration: text(100).default(''), activities: list(12).default([]) }).strict()).max(10).default([]),
    milestones: z.array(z.object({ name: text(200).min(1), timing: text(100).default('') }).strict()).max(12).default([]),
    clientResponsibilities: list(12).default([]),
    amuwaResponsibilities: list(12).default([]),
    assumptions: list(15).default([]),
    dependencies: list(12).default([]),
    outOfScope: list(15).default([]),
    risks: z.array(z.object({ risk: text(500).min(1), mitigation: text(600).default('') }).strict()).max(10).default([]),
    kpis: list(12).default([]),
    nextSteps: list(12).default([])
  })
  .strict();

export const scopeContentSchema = z
  .object({
    businessAnalysis: businessAnalysisSchema.default({}),
    recommendedSolutions: z.array(recommendedSolutionSchema).max(15).default([]),
    projectScope: projectScopeSchema.default({}),
    /** questions for the Business Associate: facts the AI needed and did not have */
    missingInformation: list(20).default([])
  })
  .strict();
export type ScopeContent = z.infer<typeof scopeContentSchema>;
export const EMPTY_SCOPE_CONTENT: ScopeContent = scopeContentSchema.parse({});

/** The sections the AI can write again on their own. */
export const SCOPE_SECTIONS = ['businessAnalysis', 'recommendedSolutions', 'projectScope'] as const;
export type ScopeSection = (typeof SCOPE_SECTIONS)[number];
export const SCOPE_SECTION_LABELS: Record<ScopeSection, string> = {
  businessAnalysis: 'Business analysis and SWOT',
  recommendedSolutions: 'Recommended solutions',
  projectScope: 'Project scope'
};

/** What the Business Associate types about the client (kept with the contact so a quotation and a scope read the same facts). */
export const PROFILE_FIELDS = [
  { key: 'industry', label: 'Industry', group: 'A' },
  { key: 'location', label: 'Business location', group: 'A' },
  { key: 'website', label: 'Website', group: 'A' },
  { key: 'businessModel', label: 'Business model', group: 'A' },
  { key: 'productsServices', label: 'Products or services', group: 'A' },
  { key: 'targetAudience', label: 'Target audience', group: 'A' },
  { key: 'businessGoals', label: 'Business goals', group: 'A' },
  { key: 'existingProcesses', label: 'Existing business processes', group: 'B' },
  { key: 'marketingChannels', label: 'Current marketing and sales channels', group: 'B' },
  { key: 'digitalPresence', label: 'Existing digital presence', group: 'B' },
  { key: 'currentTools', label: 'Current tools and systems', group: 'B' },
  { key: 'operationalChallenges', label: 'Identified operational challenges', group: 'B' },
  { key: 'acquisitionApproach', label: 'Customer acquisition approach', group: 'B' },
  { key: 'technologyGaps', label: 'Existing technology or service gaps', group: 'B' }
] as const;
export type ProfileKey = (typeof PROFILE_FIELDS)[number]['key'];
export const businessProfileSchema = z
  .object(Object.fromEntries(PROFILE_FIELDS.map(f => [f.key, text(2000).optional()])) as Record<ProfileKey, z.ZodOptional<z.ZodString>>)
  .strict();
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

// ---------------------------------------------------------------------------
// Client research (web): suggestions for the profile fields, each with where it came from. The Business Associate reviews them; nothing is
// saved into the profile until they apply and save.
// ---------------------------------------------------------------------------
export const RESEARCH_BASIS = ['VERIFIED', 'ASSUMPTION'] as const;
export const researchSuggestionSchema = z.object({
  value: text(2000).min(1),
  basis: z.enum(RESEARCH_BASIS),
  // 1-based numbers of the entries in "sources"
  sources: z.array(z.number().int().min(1).max(30)).max(6).default([])
});
export const researchSuggestionsSchema = z.object({
  summary: text(1500).default(''),
  fields: z
    .object(Object.fromEntries(PROFILE_FIELDS.map(f => [f.key, researchSuggestionSchema.nullable().optional()])) as Record<ProfileKey, z.ZodOptional<z.ZodNullable<typeof researchSuggestionSchema>>>)
    .partial()
    .default({}),
  // true when the sources may be about another business with a similar name
  uncertainMatch: z.boolean().default(false),
  missingInformation: list(12, 300).default([])
});
export type ResearchSuggestions = z.infer<typeof researchSuggestionsSchema>;
export const researchSourceSchema = z.object({ url: z.string().url().max(1000), title: text(300).default('') });
export type ResearchSource = z.infer<typeof researchSourceSchema>;
