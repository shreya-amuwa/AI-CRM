# Candidate careers portal implementation plan

## Review and scope
Read root AGENTS.md and the recruitment/training, backend, authentication, storage and existing candidate-demo implementation. Implement on new codex branches from current main; additive migrations only. Ship separately reviewable increments with dependencies made explicit.

1. Foundation: verified candidate identity separate from staff/client membership; public published jobs, owned profile and PDF resume versions, immutable application snapshots linked to existing HR candidates. No existing HR records are claimed by email alone.
2. Assessments and recruitment: HR authoring/invitation, timed server-graded MCQ attempts, candidate applications and interview/status screens, audited HR decisions. Passing an assessment never grants staff access.
3. Joining/training: explicit offers and candidate responses, private requested documents, candidate enrollment linked to existing training evidence. No automatic staff account creation or employment confirmation.

## Data and permissions
New career_* tables keep applicant identity, postings, files and applications without changing existing meanings. hr_candidates remains the internal recruitment record. Sensitive tables have RLS and no authenticated writes: checked SECURITY DEFINER RPCs use empty search_path. Candidate identity always comes from auth.uid(), with verified email and no inferred HR-record ownership. HR uses existing private.hr_require_staff. Public users see only published non-expired job fields. Candidate DTOs never include internal notes or answer keys. Trainers retain existing day-scoped permissions.

## API and validation
Candidate routes bypass staff-profile authentication but use caller JWT/PostgREST and checked candidate RPCs. Normal staff routes keep their authentication. UI -> controller -> service/shared Zod -> repository -> RPC. Public jobs return paginated records. Files use existing storage drivers, database-generated paths, signed uploads, completion size/signature inspection and short-lived authorized downloads.

## Failures and compatibility
Unique application keys and immutable submission snapshots prevent duplicate applications and resume replacement changing history. Row locks and expected-version checks protect state changes. Explicit loading/empty/error states; absent migrations return actionable service-unavailable errors. No seeded production jobs or questions. Existing staff, client, financial, recruitment and training flows retain their functions and authorization. Candidate signup requests can opt out of staff-profile provisioning but cannot acquire staff privileges. Email changes do not transfer application ownership.

## Validation and rollout
Add database ownership, denied staff/client/other-candidate access, duplicate/retry, submission snapshots, assessment timing/scoring, transition and audit tests. Add API tests traversing Hono/PostgREST and browser tests for registration/forms/uploads/test resume. Run npm ci, typecheck, build, unit, db and api before each push; merge latest main and recheck. List each new migration per PR; run twice locally. Deploy migration before feature enablement; default old staff screens remain usable without it. Supabase must require verified email. Existing storage signing requires service credentials; candidate files stay private. Content-signature verification does not equal malware scanning; production document rollout needs an explicit scanning policy.

## Assessment and screen increment
Candidate UI uses a distinct `amuwa-candidate-session` auth storage key, preserving staff/client sessions. `/careers` is public; `/candidate` hosts the authenticated shell. Profiles, resume versions, application snapshots, timed assessments and interviews have real loading/empty/error states. HR Recruitment gains a Candidate portal tab for job publishing, immutable test authoring, invitations, application stages and interviews. The assessment timer uses a server timestamp plus monotonic elapsed time; SQL deadlines remain authoritative. Each answer is acknowledged before another change, with explicit retry/reload after a failed save. Answer keys and internal feedback are omitted from candidate DTOs. Initial interview outcomes are recorded by authorized HR staff on behalf of the panel; a dedicated interviewer dashboard remains a future extension.

## Joining, training and notifications increment
Offers are saved as drafts; only an HR Team Head/Department Head or Super Admin may release/withdraw them. A candidate accepts the exact released version. Declining and expiry remain separate from application rejection. Candidates may withdraw active recruitment applications; post-acceptance departures are handled by HR. Job-cycle reapplications reuse only an HR link previously established by that same authenticated applicant, never an email-only claim.

Requested joining documents reuse the verified private PDF upload/sealing path and are excluded from resume selection. HR records approval or a replacement reason; all requested documents must be approved before training enrollment. Enrollment uses `CANDIDATE:<application UUID>` and a nullable application link in the existing HR training tables, without making an employee/profile. The existing Training workspace records attendance and practical reports. Assign one separate online assessment for each training day; it becomes startable on/after that day. Final placement needs all three passed online assessments, all verified training days and the final practical pass. HR leadership explicitly approves; staff account creation remains the existing authorized employee provisioning workflow.

Portal Updates and application timelines expose only candidate-visible events (no draft offer work, answer keys, internal panel feedback or trainer remarks). Candidate email jobs are transactionally deduplicated by event. `CAREER_EMAIL_MODE=off` is the default; `dry_run` consumes pending jobs as DRY_RUN and `live` uses the existing configured email provider, with CC/BCC cleared. A global test-recipient filter disables this dispatcher rather than allowing other recipients through. Failed/ambiguous sends require manual operator review; they are not automatically resent. No WhatsApp sending is added. Existing cron dispatch performs expiry and upload cleanup even with candidate email disabled. Its twice-daily cadence is a safety net; deadlines are also enforced immediately on candidate reads/saves/submits.

## Deployment order and settings
Apply these files, in order, after all existing main migrations:
1. `20261220010000_candidate_careers_foundation.sql`
2. `20261220020000_candidate_assessments_workflow.sql`
3. `20261220030000_candidate_joining_training.sql`

Each script is rerunnable and uses no cross-statement temporary state. Deploy migrations before the corresponding code. Existing staff/client features do not require portal membership; older databases show an actionable migration-required error only when opening the new feature. `/candidate` replaces the old unlocked seeded trainee demo, while `/careers` serves public vacancies. Supabase Auth must enable email confirmation and permit `<app origin>/candidate` as a redirect URL. The portal uses the existing VITE_SUPABASE_URL/ANON_KEY and server service binding; candidate/staff browser sessions use different storage keys and candidate sign-out is local to its session.

Supabase Storage gets a private `career-resumes` bucket limited to PDFs/10 MB. R2 installations use the existing driver/configuration and must permit direct browser PUT from the application origin through bucket CORS. Completion checks size/signature and copies to a new sealed object; original upload URLs can never modify the sealed object. The dispatcher removes temporary copies and expired reservations after successful storage deletion. A PDF signature check is not a malware scan; enable a document-scanning service before accepting sensitive documents in a production rollout that requires malware screening. No scanner or external AI service is silently installed or represented as available.

The initial release uses HR-managed panel scheduling/outcome capture; a dedicated interviewer self-service dashboard, calendar-provider sync, AI resume ranking, video proctoring and automatic staff activation are not included. HR interview outcomes explicitly record the HR actor and remain internal. Assessment results are immediately visible to their owner; selection remains a separate HR decision. These choices keep the candidate journey operational without changing existing employee or financial authorization.

## Job catalogue increment

Migration `20261226000100_career_job_catalogue.sql` (additive, safe to run twice). Run it after the three migrations above.

**What a candidate sees of a job.** `career_postings` gains a stable `code` (`JOB-0001`, assigned once, never changes), `team`, `work_mode` (`REMOTE` / `HYBRID` / `ONSITE`), `salary_text` (free text, e.g. "Competitive"), `responsibilities` and `benefits` (one item per line) and `published_at` (the first time the job went live; unpublishing and republishing keeps it). Existing jobs are given a code in creation order and a published date from when they were created. HR enters the new fields in Recruitment → Candidate portal → job form; all are optional, and an older form that does not send them leaves them unchanged (sending an empty value clears just that field).

**Public API** (no sign-in, rate limits as for the other public route):

| Route | What |
| --- | --- |
| `GET /careers/jobs?page&search&team&mode&location` | open jobs, 20 per page, newest first. `search` matches title, code, team and location and treats `%` / `_` literally. `team` and `location` are case-insensitive exact matches, `mode` is `REMOTE`/`HYBRID`/`ONSITE`. Returns `{ items, total, facets }`; `facets` lists the teams, locations and work modes of **all** open jobs with counts (so filter chips stay complete while a filter is active). |
| `GET /careers/jobs/:id` | one open job. An unpublished, closed or expired job is `404` — it does not reveal that it exists. |

Both return the same job shape (`CareerJob` in `shared/contracts.ts`): id, code, title, description, location, employment type, close date, published date, team, work mode, pay, responsibilities, benefits, **and the vacancy's skills, qualifications and experience**. Those last three were not public before; they are the candidate-facing requirements of the vacancy, so HR should not put internal notes in them (the form says so). Nothing else from the vacancy — responsible recruiter, number of openings, status note, approval, required steps — is ever public. The shape is built in one place (`private.career_job_public`).

**Compatibility.** `career_jobs(page, search)` keeps working (the new arguments have defaults), and the API only sends a filter when one is set, so the plain list works on a database that has not had this migration yet. The single-job route and the HR fields need the migration. The anonymous-callable function list in `supabase/tests/security_test.sql` now includes `career_job`: that is the one deliberate widening of what signed-out visitors can call.

**Tests.** `supabase/tests/careers_catalogue_test.sql` (codes, published date, filters, facets, literal search, public shape, single read, HR validation and permissions), unit checks in `careers_validation.test.ts`, and a block at the end of `api_integration.test.ts`.
