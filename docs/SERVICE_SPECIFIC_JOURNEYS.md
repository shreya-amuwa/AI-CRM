# Service-specific onboarding journeys

Every purchased service follows its own onboarding track, the client sees only the steps that apply to what they bought, and the
client-visible status is **derived from stored business facts**: nobody types a status a second time. Migration:
`20261222000100_service_specific_journeys.sql` (additive, safe to run twice). Run it after `20261120000100_whatsapp_api_and_blue_tick_services.sql`.

## 1. What was found before changing anything

| Question | Finding |
| --- | --- |
| Is WhatsApp API selectable on its own? | The catalogue rows `WHATSAPP_API` and `BLUE_TICK` are defined by `20261120000100` and are in `main`. The service picker in the screenshot shows **31** services, which is exactly the number seeded *without* that migration (33 with it). So the production database has not run it. **Run `20261120000100` there first; it is safe to run twice. Nothing is inserted a second time and the combined service is not renamed.** |
| Does the service picker come from the catalogue? | Yes (`crm_services`, read through the lead form), no service list or count is hard-coded. After the migration is run, WhatsApp API and Blue Tick appear in *Messaging & AI* beside the combined service, and "Select all", the counters and validation follow the catalogue. |
| Which flags decide a service's journey? | `crm_services.requires_technical_consultant` (false = delivered directly by `delivery_department_id`) and `crm_services.requires_meta_verification` (true = Meta verifies it). Seeded: every `DS_*` service is direct; `WHATSAPP_API`, `WHATSAPP_API_BLUE_TICK` and `BLUE_TICK` are verified by Meta; everything else is a Technical Consultant service. The Super Admin can change them from *Service catalogue*; the matrix below must be re-read from the live table (query at the end). |
| Was a customer-level route forced on every service? | Yes, in two places. `client_service_progress_one` chose META/TECHNICAL from the **customer's** pinned route, so a WhatsApp customer's other services were shown the Meta steps too. `client_journey` titled the verification stage "Meta verification" for every customer, even when our Technical Consultant, not Meta, verifies. Both now follow the service's own flags. |
| What was already automatic? | Documents reach the verifier -> *In progress*; a document sent back -> *Documents required*; corrected -> *In progress*; payment confirmed -> payment stage; login recorded -> login; Relationship Manager assigned -> that stage; service ready -> *Live*. |
| What cannot be automatic? | The **Meta decision** itself. There is no Meta API / webhook integration in the repository, and a document upload or an internal checklist approval is not a Meta approval. It stays a person's authoritative action (below). |

## 2. Tracks and steps

`private.service_track(code)` returns `META`, `TECHNICAL` or `DIRECT` from the service's own flags. Steps come from
`private.client_service_progress_one`, which evaluates each step from stored facts (rules below). A service with rows in
`service_milestones` uses them; a service without uses its track's default (the words the client already saw):

| Track | Default steps (rule that completes each) |
| --- | --- |
| META | Order confirmed (`PAID`) -> Documents received (`DOCS_RECEIVED`) -> Verification by our team (`DOCS_CHECKED`) -> Meta verification (`META_APPROVED`) -> Service live (`LIVE`) |
| TECHNICAL | Order confirmed -> Documents received -> Verified by our team -> Set-up with our team (`HANDED_OVER`) -> Service live |
| DIRECT | Order confirmed -> Documents verified (`ITEMS_VERIFIED`, this service's own items) -> With our delivery team (`DELIVERY_SENT`) -> Service live |

Rules a step can use (the database evaluates them; they are the only things `service_milestones.rule` accepts):
`PAID` (a verified payment), `DOCS_RECEIVED` (documents reached the verifier), `DOCS_CHECKED` (every required item authorized / handed over),
`ITEMS_VERIFIED` (this service's own required items authorized), `META_APPROVED` (`meta_completed_at` - the recorded Meta decision),
`BLUE_TICK_REVIEWED` (the existing Blue Tick was confirmed or could not be), `SETUP_STARTED`, `HANDED_OVER` (Relationship Manager assigned),
`DELIVERY_SENT`, `LIVE`.

Each step reaches the client with a state: `NOT_STARTED`, `IN_PROGRESS`, `WAITING_FOR_CUSTOMER` (items missing), `UNDER_REVIEW`,
`ACTION_REQUIRED` (a document or detail sent back, or Meta asked for something), `COMPLETED`, plus who it waits on
(`CUSTOMER`, `TEAM`, `META`). Old clients still read `state` (DONE / CURRENT / UPCOMING); the new fields are optional.

An optional step (`is_required = false`) neither holds the others back nor counts in the percentage. The percentage of a service
counts only its applicable required steps; the overall percentage sums those of the purchased services, is never 100 before the
onboarding is complete and is 100 for a customer who is already live.

### Milestones that are defined today

Only **WhatsApp API on its own** has its own milestones, because it is the only service whose real steps are documented in the repository:

1. Order confirmed. 2. Business & account details received. 3. *Existing Blue Tick checked* (optional, shown only when an existing Blue
Tick was recorded). 4. Number & account eligibility verified (`DOCS_CHECKED`: GST, Udyam, Facebook Business Manager, number, WABA ID...).
5. WhatsApp Business account approved by Meta (`META_APPROVED`). 6. API provisioning started (`SETUP_STARTED`). 7. API connected, tested and live (`LIVE`).

There is **no Blue Tick application step** for WhatsApp API alone, and an existing Blue Tick never replaces the eligibility, Meta or
provisioning steps. The combined service and Blue Tick keep the META track (documents, verification, Meta decision, live), so
nothing changes for existing customers. No steps were invented for RCS, AI Calling, AI QR, AI CRM, Meta Ads, Social Media, websites
etc.: those keep their track's default until the owning team documents its steps, which then become `service_milestones` rows (no code change).

## 3. Service catalogue matrix (from the seeds; confirm against the live table)

| Code | Name | Track | Verified by | Delivered by | Completion proof |
| --- | --- | --- | --- | --- | --- |
| `WHATSAPP_API_BLUE_TICK` | WhatsApp API + Blue Tick | META | Meta Verifier, then Meta | Support (Relationship Manager) | documents authorized + recorded Meta decision + setup ready |
| `WHATSAPP_API` | WhatsApp API | META (own milestones) | Meta Verifier, then Meta | Support | as above, plus provisioning |
| `BLUE_TICK` | Blue Tick | META | Meta Verifier, then Meta | Support | documents authorized + recorded Meta decision |
| `RCS_REGISTRATION`, `AI_CALLING`, `VOICE_MESSAGE_BULK`, `AI_QR`, `CROCODILE_CHANNEL_WEBHOOK`, `AI_CRM`, `APPOINTO`, `AI_WEBSITE` | Messaging & AI | TECHNICAL | Technical Consultant | Support | documents authorized + handed over + setup ready |
| `GBP_SETUP`, `GBP_MANAGEMENT`, `META_ADS_MANAGEMENT`, `SOCIAL_MEDIA_MANAGEMENT`, `STARTER_PACKAGE`, `GROWTH_PACKAGE`, `GMB_RANKING` | Google & Social | TECHNICAL | Technical Consultant | Support | as above |
| `AI_CHARACTER_VIDEO`, `BASIC_VIDEO_EDITING_REEL`, `CONTENT_SHOOT`, `VIDEO_PROMOTION` | Video & Content | TECHNICAL | Technical Consultant | Support | as above |
| `SINGLE_CREATIVE_DESIGN`, `YEARLY_FESTIVAL_CREATIVE_PACKAGE`, `YEARLY_GOLD_RATE_PACKAGE`, `YEARLY_PROMOTIONAL_CREATIVE_PACKAGE`, `BRANDING_PERSONAL_BRANDING` | Creative & Branding | TECHNICAL | Technical Consultant | Support | as above |
| `DS_SOCIAL_MEDIA_MARKETING`, `DS_GMB_RANKING`, `DS_META_ADS`, `DS_AI_VIDEO_PRODUCTION`, `DS_YEARLY_CREATIVE_PACKAGE`, `DS_GRAPHIC_DESIGN` | Amuwa Design Studio | DIRECT | the service's own authorized items | Design Studio (`delivery_department_id`) | items authorized + sent to delivery + setup ready |

Read the live values (the Super Admin can change them) with:
```sql
select code, name, category, is_active, requires_technical_consultant, requires_meta_verification, delivery_department_id,
       private.service_track(code) as track
  from public.crm_services order by category, sort_order;
```
Contradictions to look for in that output: a `requires_meta_verification` service that has no `requires_technical_consultant`; an active service with no checklist items
(`select s.code from crm_services s where s.is_active and not exists (select 1 from onboarding_item_services m where m.service_code = s.code)`).

## 4. Automatic status, and what still needs a person

| Event (stored fact) | Client-visible result | By |
| --- | --- | --- |
| Accounts confirms payment | Payment stage and *Order confirmed* | automatic |
| Login recorded | Login state | automatic |
| Documents reach the verifier | *Documents received*; Meta status *In progress* | automatic |
| Document / detail sent back | Step *Action required*; Meta status *Documents required* with the reason | automatic |
| Client replaces it | Step *Under review* (never *approved*) | automatic |
| Every item authorized | *Verification / eligibility* step complete | automatic (the reviewer's per-item decisions) |
| **Meta's decision** | Meta step, journey, Relationship Manager stage | **a person records it** (`record_meta_outcome`), once, with the Meta reference |
| Relationship Manager assigned (payment + verification done) | Service setup *In progress* | automatic (new) |
| Service activated | *Live* | a person's authorised action (`set_service_setup` / the subscription activation, unchanged checks) |
| All required service journeys complete | Onboarding completed | automatic (unchanged) |

### The Meta decision

`public.record_meta_outcome(customer, outcome, event_key, reference, note)` (route `POST /pipeline/customers/:id/meta-outcome`):

* **Who:** the customer's verifier, Department Head or Super Admin only (the same check as `set_meta_verification`, which it reuses, so every existing rule
  applies: payment confirmed, login, every document authorized, valid moves). Sales, Accounts, other departments and clients get *not found*.
* **Evidence:** *Approved* needs the Meta reference (case or business account ID); *Rejected* / *Needs information* need the words the client will see.
* **Idempotent:** a repeated `event_key` returns the stored answer and changes nothing; a *different* approval arriving after completion is recorded as
  `ALREADY_COMPLETED` and changes nothing; a rejection after completion is refused (`CONFLICT`) and must be raised with the Super Admin, so it is never hidden or silently applied.
* **Never inferred:** uploading or authorizing documents never completes it; a re-upload never overrides a Meta rejection.
* **Webhook:** no Meta integration exists in this repository. When one is added it must verify the signature and the account identity, use the
  provider's event id as `event_key`, and call this same function through the service role (`source = 'WEBHOOK'`). Until then the verifier records the answer by hand.

## 5. Existing Blue Tick

A customer who already holds a Blue Tick and buys **only WhatsApp API** keeps exactly that sale: no bundled service, no Blue Tick charge, no application,
the badge is not touched. The responsible employee records it in `customer_existing_blue_tick` (`NOT_PROVIDED`, `CUSTOMER_REPORTED`, `CONFIRMED`, `COULD_NOT_CONFIRM`):

* Sales (anyone who may access the customer) can record *Customer reports existing verification*; only the verifier can set *Confirmed* (needs the reference
  that was checked) or *Could not be confirmed*, and the reviewer and time are stored. Sales cannot overwrite a reviewed record. A checkbox is never "verified".
* It applies only to a customer holding `WHATSAPP_API`; otherwise it is refused. It is not asked of anyone else, so no new mandatory form exists.
* Routes: `GET|POST /pipeline/customers/:id/existing-blue-tick`. It also appears in the team's journey panel.

## 6. Existing customers

Nothing is backfilled and nothing is reset: steps are **calculated from stored facts every time they are read**. A customer who is already live (imported,
or onboarding completed) keeps every step done and 100 percent; a service with no new milestones shows the same steps and words as before. The only new
write is the automatic *In progress* of a service that was still `PENDING` when payment, verification and the Relationship Manager are all done
(`customer_services.setup_auto = true`, audited, notified once with a stable key). Rows are never deleted or duplicated, invoices, subscriptions and
chat history are not touched, and the original combined service keeps its code and commercial meaning.

## 7. Rollout and rollback

1. Run `20261120000100_whatsapp_api_and_blue_tick_services.sql` if the catalogue has 31 services (skip when `WHATSAPP_API` and `BLUE_TICK` exist).
2. Run `20261222000100_service_specific_journeys.sql`. Until it is run the new routes answer with an error and the screens fall back to the old behaviour (every new field is optional).
3. Deploy the application.
4. Rollback keeps the data: re-run the previous definitions (`20261205000400` for `client_service_progress_one`, `20261209000100` for `client_journey` and `set_service_setup` /
   `customer_journey_status`, then `20261210000200` for `set_service_setup`) and `drop trigger customer_onboarding_auto_setup on public.customer_onboarding;`. The tables
   (`service_milestones`, `customer_existing_blue_tick`, `meta_verification_events`) and the column `customer_services.setup_auto` can stay, they are unused by the old code.

## 8. Tests

`supabase/tests/service_journeys_test.sql` (section 111-117): tracks from catalogue flags, the three WhatsApp services and no duplicates, standalone WhatsApp API steps,
Blue Tick-only and direct journeys, mixed customers, rejected / corrected documents, Meta not inferred from documents, the idempotent decision, the automatic setup start,
the team's live status, client isolation, direct-write denials and legacy customers. Also `client_journey_test.sql` and `client_progress_test.sql` (which re-apply the older
migrations, so they now re-apply this one after them) and the "service-specific journeys" block of `api_integration.test.ts`.
