# Sales Automation: research and plan

## Context
The CEO wants the whole sales process automated. That means:
- getting leads in from many sources, including photos of local vendor posters turned into records,
- assigning leads automatically,
- moving each lead from awareness to contact to customer,
- generating quotations with AI,
- running awareness campaigns on WhatsApp and RCS,
- five role dashboards for sales staff.

The brief in the notebook photos is loose. This plan turns it into concrete pieces that fit the code we already have.

### What the notes say, decoded (to be confirmed)
| Note | Reading |
|---|---|
| Telecaller – calls | Outbound and inbound calling from a lead queue |
| Bus associates – call/lead/email/voice calling | Inside-sales role with every channel. Closest to today's TEAM_MEMBER workspace |
| Visit – field work, photo (backend fetch), lead source collected by visit | Field agent who photographs shops and posters; the backend extracts the lead |
| Influ – Dig creat | Digital creator or affiliate who brings leads through content and is paid commission |
| Bus partners | Resellers or franchisees who sell our products under their own business |
| assigning these leads to them (TL) | The team lead assigns, or a rule engine assigns automatically |
| PH can add lead source | Someone (the Department Head?) can add new lead sources from the UI |
| DB, PB, Eg Insta DM | DB = existing database or data purchase; PB = personal brand(?); Instagram DMs |
| lead → awareness (unknown) → hot/cold/warm → contact → customer | Lifecycle stages plus a temperature score |
| contact: quot / invoice / communication; potential: pricing, scope, estimate | What happens at each stage |
| Int / Not Int / quot sent; demo schedule; appointment (ap/rej) | Sub-statuses and booking |
| awareness camp should trigger (wp, rcs); fear / real issues / edu / pro-factors | Automatic drip campaigns on WhatsApp and RCS, built on the four message angles |
| workflow n8n for vd, quotation (Backend AI) | n8n workflow; "vd" might mean video. Quotation drafted by AI |

## What we already have (reuse, don't rebuild)
- **Lead storage:** inbound leads land in `crm_leads`. `claim_inbound_lead` converts one into a `customers` row with `lifecycle_stage` and `lead_status` (`supabase/migrations/20261007000300_lead_lifecycle_onboarding.sql`).
- **Inbound webhooks:** Meta, website and n8n webhook ingest in `server/webhooks/leadIngest.ts`.
- **Lead sources:** a hardcoded list in `src/data/leadSources.ts` (whatsapp, meta, telecaller, bizdev, aicalling, rcs, website, references).
- **Field visits:** the `field_visits` table plus `FieldVisitTrackerView.tsx`, which is the base for the Visit dashboard.
- **Automation outbox:** the `automation_jobs` outbox, dispatcher and providers for email and WhatsApp (`server/automations/*`), which is the base for drip campaigns. AI-call scaffolding is in `subscriptionReminders.ts`, waiting on Bolify.
- **Claude:** the Anthropic call in `server/performance/ai.ts`, reused for OCR and quotation drafting.
- **File storage:** R2 or Supabase storage via `server/storage/*` for poster photos.
- **Roles and dashboards:** role mapping in `src/lib/auth/roleMapping.ts` and `App.tsx`. The TEAM_MEMBER dashboard is effectively the Business Associate view.
- **Quotations:** none yet. There is only mock data in `accountsStore.ts` and an n8n design in `n8n/`.

## Research findings

### 1. Lead acquisition (each source becomes `crm_leads`)
| Source | How |
|---|---|
| Meta ads (FB/IG lead forms) | Meta Lead Ads webhook (`leadgen` field) → Graph API fetch → `leadIngest`. Partly there already; needs a page access token |
| WhatsApp campaign / Click-to-WhatsApp | WhatsApp Business Cloud API (or our own WabaStore/Whatsbox) inbound message → lead |
| Instagram DMs | Instagram Messaging API webhook → lead (same Meta app) |
| Website | Existing form webhook |
| Direct / inbound call | Telephony provider (Exotel, Knowlarity, MyOperator, or our own D Talk) missed-call or incoming-call webhook → lead |
| AI calling | Bolify (planned) or Vapi, Bland or Retell with an Indian SIP number; transcript plus intent go back into the lead |
| Referral / existing contact / PB | Referral link or code per user (also used for influencers and partners) |
| DB / bulk | CSV import with dedupe |
| Visit / poster photo | OCR pipeline (below) |
| Organic | UTM-tagged website traffic |

Make lead sources a **database table** (`lead_sources`: key, label, channel, active, created_by) so that heads can add sources from the UI. This replaces the hardcoded constant.

### 2. Poster or shop photo to lead (the "photo, backend fetch" idea)
This is doable and not vague. The pipeline:
1. The field agent snaps a photo in a mobile web or PWA camera view. We capture GPS and a timestamp, and upload to R2.
2. The backend sends the image to Claude vision with a strict JSON schema: business_name, phones[], whatsapp, email, address, city, category, services/products, website, social handles, and a confidence value per field. Claude handles mixed Hindi/English and messy layouts better than classic OCR such as Tesseract or Google Vision, and it also classifies the business category.
3. Phone numbers are normalised to E.164 (`libphonenumber-js`) and deduped against `customers` and `crm_leads`.
4. Optionally, Google Places API enriches the record using name plus GPS (verified address, rating, opening hours).
5. The lead lands as `source=visit` or `source=poster_scan` in a **review queue**. The agent confirms or edits before the lead goes live. Never auto-call straight from OCR.

Cost: roughly ₹0.5–2 per image with a Sonnet-class model, which is fine at field-team volume.

### 3. Compliance (needed before automating outreach in India)
- **TRAI TCCCPR / DND:** promotional calls and SMS must be scrubbed against DND and come from registered 140-series or 1600 headers. Treat this as a hard gate on telecaller and AI calling of cold leads.
- **DPDP Act 2023:** keep a lawful basis and consent record for each lead, plus opt-out. Phone numbers taken from public posters are a grey area, so record the source and consent status.
- **WhatsApp:** business-initiated messages need approved templates and an opt-in. RCS needs a verified sender (Google RBM via an aggregator).

The existing `do_not_call` consent fields in `subscription_reminders` can be generalised for this.

### 4. Lead lifecycle and automation
Stages already exist: LEAD → POTENTIAL → ONBOARDING → CUSTOMER / LOST. The notes add:
- **Awareness** (unknown or new) as an early stage or sub-status.
- **Temperature**: Hot, Warm or Cold. Set by rules (engagement, budget, recency), with AI scoring from call transcripts later.
- **Outcome**: Interested, Not interested or Quote sent.
- **Demo or appointment**: scheduled, then approved or rejected. Reuse `member_calendar_events`.

Automations, all through the `automation_jobs` outbox:
- On a new lead, start an **awareness drip**: 3–5 WhatsApp or RCS templates rotating the angles fear → real issue → education → pro-factors. It stops when the lead replies.
- A reply or click sets the lead to Warm and creates a telecaller task.
- When "Interested" is set, offer a demo booking link.
- When quotation inputs are present (pricing, scope, estimate), **AI drafts the quotation** (Claude plus a product price list → `quotations` table → PDF with pdf-lib) for a human to approve. The existing n8n design is the approval flow.

### 5. Auto-assignment
Add rules: by source, department or city → weighted round-robin among eligible users, with a capacity cap. Visit-sourced leads stay with the agent who found them; influencer and partner leads are attributed to the referrer. Team leads can still reassign manually using the existing reassign function.

### 6. The five dashboards
| Role | Key widgets |
|---|---|
| **Telecaller** | Call queue (prioritised by temperature and follow-up due), click-to-call, disposition form, call log, daily targets (calls, connects, conversions) |
| **Business Associate** | Existing TeamMember workspace plus email, WhatsApp, voice and quotation actions and a pipeline board |
| **Visit / Field** | Today's route or visits, camera "scan poster/shop", review queue for OCR leads, check-in with GPS, leads generated per visit |
| **Influencer** | Personal referral link or QR code, leads and conversions from it, commission earned and paid, content kit. They do **not** see lead contact details |
| **Business Partner** | Own sub-pipeline of leads and customers, commission or margin, resale price list, onboarding status of their clients |

Why influencers: they are an affiliate acquisition channel. They bring leads through content, are paid per conversion, and the dashboard is how they track earnings. Influencers and partners are **external users**, so give them restricted RLS: they only see what is attributed to them.

Data additions:
- `app_role` gets new values, or (better) `profiles.sales_role` is added: TELECALLER, ASSOCIATE, FIELD, INFLUENCER, PARTNER.
- New tables: `referral_codes`, `commissions`, `call_logs`, `quotations`, `lead_sources`, `assignment_rules`, `ocr_scans`.

## Proposed phasing
1. **Foundation**:
   - `lead_sources` table and admin UI
   - `sales_role` and the five dashboard shells
   - lifecycle additions (awareness, temperature, outcome)
   - auto-assignment rules
2. **Field and OCR**: poster scan to lead with Claude vision, review queue, Visit dashboard.
3. **Telecaller**: integrate a telephony provider (decide: D Talk in-house, Exotel or similar), call logs, dispositions, DND scrub.
4. **Awareness campaigns**: WhatsApp/RCS drip templates through `automation_jobs`, reply-driven temperature changes.
5. **Quotation AI**: `quotations` table, Claude draft, PDF, n8n approval, sending.
6. **Influencer and Partner portals**: referral codes, attribution, commissions, external-user RLS.
7. **AI calling**: Bolify or Vapi qualifying calls, with transcripts feeding temperature.

## Open questions for the CEO
- Who is "PH"? Who can add lead sources?
- What does "vd" mean in "workflow n8n for vd"? Video?
- Do partners resell our products (WabaStore, Whatsbox, D Talk) or run their own franchise?
- Commission models for influencers and partners.
- Telephony: our own D Talk or a third-party provider?
- Is RCS needed now, and do we have a sender?

