-- =============================================================================
-- Recruitment decisions and the candidate e-mail that follows them. BACKEND ONLY.
--
--  * recruiter_decisions: the final decision on ONE application (not on the candidate): SELECTED or REJECTED, who decided, when, the reason. A
--    correction never overwrites: the old decision stays (is_current = false) and a new one points at it. Only one decision per application is
--    current at any time (a unique index), so an application can never be Selected and Rejected at once. A candidate who applied to two vacancies has
--    two applications and two independent decisions.
--  * recruitment_decision_emails: the outbox. One row per decision (decision_id is unique), created by the database in the SAME transaction as the
--    decision. The server's dispatcher claims due rows (two senders never take the same row), sends through the CRM's mail setup and records the result;
--    a temporary failure is retried after 5, 15, 60 and 240 minutes and fails after 5 attempts. A failed e-mail never undoes the decision.
--  * Nothing here is readable or writable by the browser's roles: no grants, RLS on, no policies. The only callers are the decision function (which
--    queues), the server with the service key (which claims and records) and the Super Admin's technical functions (which list and re-queue).
--  * No credentials or provider secrets are ever stored: only the result (status, HTTP code, a short provider reference, a short error text).
--
-- Safe to run again. Run after 20261222000100_hr_recruiter_role.sql.
-- =============================================================================

create table if not exists public.recruiter_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.career_applications (id) on delete restrict,
  seq integer not null check (seq >= 1),
  decision text not null check (decision in ('SELECTED', 'REJECTED')),
  reason_category text check (reason_category is null or reason_category in ('SKILLS_MISMATCH', 'EXPERIENCE', 'ASSESSMENT', 'INTERVIEW', 'NOT_INTERESTED', 'POSITION_FILLED', 'OTHER')),
  reason text check (length(reason) <= 1000),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz not null default now(),
  -- what was decided about, as it was then
  posting_id uuid references public.career_postings (id) on delete set null,
  position_title text,
  department_name text,
  is_current boolean not null default true,
  correction_of uuid references public.recruiter_decisions (id) on delete restrict,
  correction_reason text check (length(correction_reason) <= 1000),
  unique (application_id, seq)
);
-- one current decision per application: Selected and Rejected can never both be current
create unique index if not exists recruiter_decisions_current_idx on public.recruiter_decisions (application_id) where is_current;
create index if not exists recruiter_decisions_decided_idx on public.recruiter_decisions (decided_by, decided_at desc);
create index if not exists recruiter_decisions_posting_idx on public.recruiter_decisions (posting_id) where is_current;

create table if not exists public.recruitment_decision_emails (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.recruiter_decisions (id) on delete cascade,
  application_id uuid not null references public.career_applications (id) on delete cascade,
  applicant_id uuid not null references public.career_applicants (id) on delete restrict,
  hr_candidate_id uuid references public.hr_candidates (id) on delete set null,
  recipient_email text not null,
  email_type text not null check (email_type in ('SELECTION', 'REJECTION')),
  trigger_event text not null default 'DECISION_RECORDED' check (trigger_event in ('DECISION_RECORDED', 'DECISION_CORRECTED')),
  recruiter_id uuid references public.profiles (id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'RETRYING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED', 'DRY_RUN')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  sent_at timestamptz,
  -- ACCEPTED: the mail provider took the message. DELIVERED needs the provider's own confirmation, which the CRM's mail setup does not report.
  provider_status text check (provider_status is null or provider_status in ('ACCEPTED', 'REJECTED')),
  delivery_status text check (delivery_status is null or delivery_status in ('DELIVERED', 'BOUNCED')),
  response_code integer,
  provider_ref text check (length(provider_ref) <= 200),
  last_error text check (length(last_error) <= 500),
  requeued_by uuid references public.profiles (id) on delete set null,
  requeued_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists recruitment_decision_emails_due_idx on public.recruitment_decision_emails (status, next_attempt_at) where status in ('PENDING', 'RETRYING', 'PROCESSING', 'DRY_RUN');
create index if not exists recruitment_decision_emails_application_idx on public.recruitment_decision_emails (application_id, created_at desc);

create table if not exists public.recruitment_decision_email_attempts (
  id bigint generated always as identity primary key,
  email_id uuid not null references public.recruitment_decision_emails (id) on delete cascade,
  attempt_no integer not null default 0,
  outcome text not null check (outcome in ('SENT', 'RETRY', 'FAILED', 'SKIPPED', 'DRY_RUN', 'REQUEUED')),
  detail text check (length(detail) <= 500),
  response_code integer,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_decision_email_attempts_email_idx on public.recruitment_decision_email_attempts (email_id, id);

alter table public.recruiter_decisions enable row level security;
alter table public.recruitment_decision_emails enable row level security;
alter table public.recruitment_decision_email_attempts enable row level security;
revoke all on public.recruiter_decisions, public.recruitment_decision_emails, public.recruitment_decision_email_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Queueing: called by the decision function, in the same transaction
-- ---------------------------------------------------------------------------
-- One outbox row per decision. A decision that was already queued is a no-op (the unique key), so a repeated request can never create a second
-- e-mail. A missing or invalid address is recorded as SKIPPED with the reason (the decision itself stands).
create or replace function private.recruitment_email_queue(p_decision uuid, p_event text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.recruiter_decisions;
  a public.career_applications;
  v_email text;
  v_ok boolean;
  v_id uuid;
begin
  select * into d from public.recruiter_decisions where id = p_decision;
  select * into a from public.career_applications where id = d.application_id;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = a.applicant_id;
  v_ok := coalesce(v_email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(v_email) <= 254;
  insert into public.recruitment_decision_emails (decision_id, application_id, applicant_id, hr_candidate_id, recipient_email, email_type, trigger_event, recruiter_id, status, last_error)
  values (d.id, a.id, a.applicant_id, a.hr_candidate_id, coalesce(v_email, ''), case d.decision when 'SELECTED' then 'SELECTION' else 'REJECTION' end,
          p_event, d.decided_by, case when v_ok then 'PENDING' else 'SKIPPED' end, case when v_ok then null else 'The candidate has no valid e-mail address.' end)
  on conflict (decision_id) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.recruitment_email_queue(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The server's side: claim what is due, record what happened (service key only)
-- ---------------------------------------------------------------------------
create or replace function public.recruitment_email_claim(p_limit integer default 5, p_mode text default 'live', p_lease_seconds integer default 600, p_only_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  -- a decision that was corrected before its e-mail went out is not announced any more
  update public.recruitment_decision_emails e
     set status = 'SKIPPED', last_error = 'The decision was corrected before this e-mail was sent.', locked_until = null, updated_at = now()
   where e.status in ('PENDING', 'RETRYING', 'DRY_RUN')
     and exists (select 1 from public.recruiter_decisions d where d.id = e.decision_id and not d.is_current);

  select coalesce(array_agg(id), '{}') into v_ids from (
    select e.id from public.recruitment_decision_emails e
     where (p_only_recipients is null or lower(e.recipient_email) = any (p_only_recipients))
       and ((e.status in ('PENDING', 'RETRYING') and e.next_attempt_at <= now())
         or (p_mode = 'live' and e.status = 'DRY_RUN')
         or (e.status = 'PROCESSING' and e.locked_until < now()))
     order by e.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked) x;

  update public.recruitment_decision_emails
     set status = 'PROCESSING', attempts = case when status = 'DRY_RUN' then 1 else attempts + 1 end, processed_at = now(), updated_at = now(),
         locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 1800)))
   where id = any (v_ids);

  -- the values are read from the live records now: nothing is typed in by anyone
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'attempts', e.attempts, 'type', e.email_type, 'to', e.recipient_email,
             'applicationId', a.id,
             'candidateName', coalesce(nullif(btrim(ap.name), ''), nullif(btrim(hc.name), ''), 'Candidate'),
             'positionName', coalesce(d.position_title, j.title),
             'departmentName', coalesce(d.department_name, (select dep.name from public.hr_positions pos join public.departments dep on dep.id = pos.department_id where pos.id = j.position_id)),
             'decisionDate', (d.decided_at at time zone 'Asia/Kolkata')::date
           ) order by e.created_at)
      from public.recruitment_decision_emails e
      join public.recruiter_decisions d on d.id = e.decision_id
      join public.career_applications a on a.id = e.application_id
      join public.career_applicants ap on ap.id = a.applicant_id
      join public.career_postings j on j.id = a.posting_id
      left join public.hr_candidates hc on hc.id = a.hr_candidate_id
     where e.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.recruitment_email_claim(integer, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.recruitment_email_claim(integer, text, integer, text[]) to service_role;

-- SENT only after the provider accepted the message. A temporary failure is retried after 5, 15, 60 and 240 minutes and is FAILED after 5 attempts; a
-- permanent one fails at once. Leadership is told when it ends FAILED. The candidate's decision is never touched.
create or replace function public.recruitment_email_finish(p_id uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.recruitment_decision_emails;
  v_status text;
  r record;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY', 'DRY_RUN') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into e from public.recruitment_decision_emails where id = p_id for update;
  if e.id is null or e.status <> 'PROCESSING' then
    raise exception 'CONFLICT: This e-mail is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case p_outcome when 'RETRY' then case when e.attempts >= 5 then 'FAILED' else 'RETRYING' end else p_outcome end;
  update public.recruitment_decision_emails
     set status = v_status,
         last_error = case when v_status in ('SENT', 'DRY_RUN') then null else left(p_detail, 500) end,
         response_code = p_response_code,
         provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         provider_status = case when v_status = 'SENT' then 'ACCEPTED' when v_status = 'FAILED' and p_response_code between 400 and 499 then 'REJECTED' else provider_status end,
         locked_until = null,
         sent_at = case when v_status = 'SENT' then now() else sent_at end,
         next_attempt_at = case when v_status = 'RETRYING' then now() + (array[5, 15, 60, 240])[least(e.attempts, 4)] * interval '1 minute' else next_attempt_at end,
         updated_at = now()
   where id = p_id returning * into e;
  insert into public.recruitment_decision_email_attempts (email_id, attempt_no, outcome, detail, response_code)
  values (e.id, e.attempts, p_outcome, left(p_detail, 500), p_response_code);
  if v_status in ('SENT', 'FAILED') then
    perform private.write_audit(case when v_status = 'SENT' then 'RECRUITMENT_EMAIL_SENT' else 'RECRUITMENT_EMAIL_FAILED' end, 'career_application', e.application_id, null, null,
      jsonb_build_object('type', e.email_type, 'attempts', e.attempts));
  end if;
  if v_status = 'FAILED' or (v_status = 'SKIPPED' and coalesce(p_detail, '') ilike '%e-mail address%') then
    for r in select p.id from public.profiles p where p.status = 'ACTIVE' and (p.role = 'SUPER_ADMIN'
              or (p.role = 'DEPARTMENT_HEAD' and exists (select 1 from public.departments d where d.id = p.department_id and d.slug = 'hr'))) loop
      perform private.notify(r.id, 'RECRUITMENT_EMAIL_FAILED', 'A candidate e-mail could not be delivered',
        'A selection or rejection e-mail needs technical review. The decision itself is unchanged.', 'career_application', e.application_id, '{}'::jsonb, 'urgent');
    end loop;
  end if;
  return jsonb_build_object('id', e.id, 'status', e.status, 'attempts', e.attempts, 'nextAttemptAt', e.next_attempt_at);
end $$;
revoke all on function public.recruitment_email_finish(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.recruitment_email_finish(uuid, text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Technical administration (Super Admin only; there is no screen for it in the recruiter dashboard)
-- ---------------------------------------------------------------------------
create or replace function public.recruitment_email_admin_list(p_status text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can review candidate e-mail delivery.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', e.id, 'decisionId', e.decision_id, 'applicationId', e.application_id, 'candidateId', e.hr_candidate_id, 'recipient', e.recipient_email,
             'type', e.email_type, 'triggerEvent', e.trigger_event, 'recruiterId', e.recruiter_id, 'status', e.status, 'attempts', e.attempts,
             'createdAt', e.created_at, 'processedAt', e.processed_at, 'sentAt', e.sent_at, 'providerStatus', e.provider_status, 'deliveryStatus', e.delivery_status,
             'lastError', e.last_error, 'nextAttemptAt', case when e.status = 'RETRYING' then e.next_attempt_at end) as x
      from public.recruitment_decision_emails e
     where p_status is null or e.status = p_status
     order by e.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) q), '[]'::jsonb);
end $$;
revoke all on function public.recruitment_email_admin_list(text, integer) from public, anon;
grant execute on function public.recruitment_email_admin_list(text, integer) to authenticated;

-- A FAILED e-mail goes back to the queue (the attempts so far stay in its history). Nothing else is re-sent: a SENT e-mail cannot be queued again.
create or replace function public.recruitment_email_admin_requeue(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.recruitment_decision_emails;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can re-queue a candidate e-mail.' using errcode = '42501';
  end if;
  select * into e from public.recruitment_decision_emails where id = p_id for update;
  if e.id is null then
    raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0001';
  end if;
  if e.status <> 'FAILED' then
    raise exception 'CONFLICT: Only a failed e-mail can be re-queued.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.recruiter_decisions d where d.id = e.decision_id and d.is_current) then
    raise exception 'CONFLICT: The decision was corrected; this e-mail is no longer valid.' using errcode = 'P0001';
  end if;
  update public.recruitment_decision_emails
     set status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = null, requeued_by = auth.uid(), requeued_at = now(), updated_at = now()
   where id = e.id returning * into e;
  insert into public.recruitment_decision_email_attempts (email_id, attempt_no, outcome, detail) values (e.id, 0, 'REQUEUED', 'Re-queued by the Super Admin.');
  perform private.write_audit('RECRUITMENT_EMAIL_REQUEUED', 'career_application', e.application_id, null, null, jsonb_build_object('type', e.email_type));
  return jsonb_build_object('id', e.id, 'status', e.status);
end $$;
revoke all on function public.recruitment_email_admin_requeue(uuid) from public, anon;
grant execute on function public.recruitment_email_admin_requeue(uuid) to authenticated;

notify pgrst, 'reload schema';
