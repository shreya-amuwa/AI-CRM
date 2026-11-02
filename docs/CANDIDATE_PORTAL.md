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
