-- =============================================================================
-- Automatic welcome e-mail for a new employee's login.
--
--  * The e-mail is queued by the DATABASE, once, at the moment an employee account is really active:
--      - HR / Team Lead request: when the Department Head (or the Operations Head / Super Admin) APPROVES it (the account becomes active in the
--        same transaction). Nothing is queued while the request is only submitted or pending, rejected, or in any other state.
--      - Direct creation by an authorised person (Super Admin, Department Head, Team Lead): when the active account is created.
--    One row per activation (unique event key), so the same activation never makes two e-mails.
--  * The e-mail carries a one-time "set your password" link made by the server at SEND time (Supabase Auth recovery token). The link, a
--    temporary password and any password are NEVER stored here: this table only tracks who, to which address, why, when, the status,
--    the number of attempts and a safe error text. Every send / resend attempt is also kept in employee_welcome_email_attempts.
--  * Statuses: PENDING, PROCESSING, RETRYING, SENT, FAILED (plus SKIPPED for no usable address / inactive account and DRY_RUN while the server
--    is in dry-run mode). SENT is recorded only after the mail provider accepted the message.
--  * A failed e-mail never undoes the activation; HR / the Super Admin / the employee's Department Head can list the failures and resend
--    (a fresh link each time; the earlier link stops working because Auth keeps only the newest). A resend is refused while one is in
--    flight, within two minutes of the last, and once the employee has chosen their own password.
--  * HR is notified when the account is created and again if the welcome e-mail fails.
--
-- Safe to run again; nothing is deleted. Run after 20261218000100_operations_head_creation.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.employee_welcome_emails (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  recipient_email text not null,
  email_type text not null default 'WELCOME_LOGIN' check (email_type in ('WELCOME_LOGIN')),
  trigger_event text not null check (trigger_event in ('EMPLOYEE_REQUEST_APPROVED', 'ACCOUNT_PROVISIONED', 'MANUAL_RESEND')),
  event_key text not null unique,
  approval_request_id uuid references public.approval_requests (id) on delete set null,
  activated_by uuid references public.profiles (id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'RETRYING', 'SENT', 'FAILED', 'SKIPPED', 'DRY_RUN')),
  attempts integer not null default 0 check (attempts >= 0),
  resend_count integer not null default 0 check (resend_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text check (length(last_error) <= 500),
  response_code integer,
  provider_ref text check (length(provider_ref) <= 200),
  last_resend_at timestamptz,
  last_resend_by uuid references public.profiles (id) on delete set null,
  -- the employee used the e-mailed link and chose their own password
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_welcome_emails_employee_idx on public.employee_welcome_emails (employee_id, created_at desc);
create index if not exists employee_welcome_emails_due_idx on public.employee_welcome_emails (status, next_attempt_at) where status in ('PENDING', 'RETRYING', 'PROCESSING', 'DRY_RUN');

create table if not exists public.employee_welcome_email_attempts (
  id bigint generated always as identity primary key,
  email_id uuid not null references public.employee_welcome_emails (id) on delete cascade,
  attempt_no integer not null default 0,
  kind text not null check (kind in ('SEND', 'RESEND')),
  actor_id uuid references public.profiles (id) on delete set null,
  outcome text not null check (outcome in ('RESEND_REQUESTED', 'SENT', 'RETRY', 'FAILED', 'SKIPPED', 'DRY_RUN')),
  detail text check (length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists employee_welcome_email_attempts_email_idx on public.employee_welcome_email_attempts (email_id, id);

alter table public.employee_welcome_emails enable row level security;
alter table public.employee_welcome_email_attempts enable row level security;
revoke all on public.employee_welcome_emails, public.employee_welcome_email_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Queueing (triggers)
-- ---------------------------------------------------------------------------
-- Queues the welcome e-mail of one active employee, once per activation event. A missing / invalid address is recorded as SKIPPED
-- (and HR is told) instead of being silently ignored. Returns the new row id (null when this activation was already queued).
create or replace function private.welcome_queue(p_profile uuid, p_event text, p_key text, p_request uuid, p_by uuid, p_hold interval default interval '0 seconds')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  pr public.profiles;
  v_id uuid;
  v_email text;
  v_ok boolean;
  v_dept text;
begin
  select * into pr from public.profiles where id = p_profile;
  if pr.id is null or pr.status <> 'ACTIVE' then
    return null;
  end if;
  v_email := lower(btrim(coalesce(pr.email, '')));
  v_ok := v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(v_email) <= 254;
  insert into public.employee_welcome_emails (employee_id, recipient_email, trigger_event, event_key, approval_request_id, activated_by, status, next_attempt_at, last_error)
  values (pr.id, v_email, p_event, p_key, p_request, p_by, case when v_ok then 'PENDING' else 'SKIPPED' end, now() + coalesce(p_hold, interval '0 seconds'),
          case when v_ok then null else 'The employee has no valid e-mail address.' end)
  on conflict (event_key) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  select d.name into v_dept from public.departments d where d.id = pr.department_id;
  -- a directly created account is already announced to HR by the member-created notification; an approved request is announced here
  if p_event = 'EMPLOYEE_REQUEST_APPROVED' then
    perform private.notify_hr('EMPLOYEE_ACCOUNT_CREATED', format('Account created: %s', pr.full_name),
      format('%s (%s) is now active. Welcome e-mail: %s.', pr.full_name, coalesce(v_dept, 'no department'), case when v_ok then 'queued' else 'not sent (no valid e-mail address)' end),
      'profile', pr.id);
  end if;
  if not v_ok then
    perform private.notify_hr('EMPLOYEE_WELCOME_EMAIL_FAILED', format('Welcome e-mail not sent: %s', pr.full_name),
      'The employee has no valid e-mail address. Correct it, then use Resend welcome e-mail.', 'profile', pr.id, '{}'::jsonb, 'urgent');
  end if;
  return v_id;
end $$;
revoke all on function private.welcome_queue(uuid, text, text, uuid, uuid, interval) from public, anon, authenticated;

-- A request approved (HR / Team Lead request): the account is active by now (the profile is updated before the request).
create or replace function private.tg_welcome_after_request_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'APPROVED' and old.status is distinct from 'APPROVED' and new.source <> 'REGISTRATION' then
    perform private.welcome_queue(new.subject_user_id, 'EMPLOYEE_REQUEST_APPROVED', 'REQUEST:' || new.id::text, new.id, new.decided_by);
  end if;
  return new;
end $$;
revoke all on function private.tg_welcome_after_request_approval() from public, anon, authenticated;

drop trigger if exists approval_requests_welcome_email on public.approval_requests;
create trigger approval_requests_welcome_email after update of status on public.approval_requests
  for each row execute function private.tg_welcome_after_request_approval();

-- An authorised person creates an active account directly (Super Admin, Department Head, Team Lead). The first Super Admin
-- (bootstrap: nobody approved it) and self-registrations (pending until approved) are not part of this. The account row exists a moment
-- before the API has finished the rest of the creation (details, roles; a failure removes the account again), so the e-mail is held for two
-- minutes and released by the API (welcome_email_release) as soon as the creation is complete.
create or replace function private.tg_welcome_after_provisioning()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ACTIVE' and new.approved_by is not null then
    perform private.welcome_queue(new.id, 'ACCOUNT_PROVISIONED', 'PROVISIONED:' || new.id::text, null, new.approved_by, interval '2 minutes');
  end if;
  return new;
end $$;
revoke all on function private.tg_welcome_after_provisioning() from public, anon, authenticated;

drop trigger if exists profiles_welcome_email on public.profiles;
create trigger profiles_welcome_email after insert on public.profiles
  for each row execute function private.tg_welcome_after_provisioning();

-- ---------------------------------------------------------------------------
-- 3. Sending (service role only: the server's dispatcher)
-- ---------------------------------------------------------------------------
-- Takes the e-mails that are due and returns what the server needs to write them. Rows whose account is no longer active, or whose employee
-- already chose a password, are closed (SKIPPED) instead of sent. Two senders never take the same row.
create or replace function public.welcome_email_claim(p_limit integer default 5, p_mode text default 'live', p_lease_seconds integer default 600, p_only_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  update public.employee_welcome_emails w
     set status = 'SKIPPED', last_error = case when w.setup_completed_at is not null then 'The employee has already set their password.' else 'The account is not active.' end,
         locked_until = null, updated_at = now()
   where w.status in ('PENDING', 'RETRYING', 'DRY_RUN')
     and (w.setup_completed_at is not null or not exists (select 1 from public.profiles p where p.id = w.employee_id and p.status = 'ACTIVE'));

  select coalesce(array_agg(id), '{}') into v_ids from (
    select w.id from public.employee_welcome_emails w
     where (p_only_recipients is null or lower(w.recipient_email) = any (p_only_recipients))
       and ((w.status in ('PENDING', 'RETRYING') and w.next_attempt_at <= now())
         or (p_mode = 'live' and w.status = 'DRY_RUN')
         or (w.status = 'PROCESSING' and w.locked_until < now()))
     order by w.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked) x;

  update public.employee_welcome_emails
     set status = 'PROCESSING', attempts = case when status = 'DRY_RUN' then 1 else attempts + 1 end, last_attempt_at = now(), updated_at = now(),
         locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 1800)))
   where id = any (v_ids);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', w.id, 'attempts', w.attempts, 'triggerEvent', w.trigger_event,
             'to', lower(btrim(p.email)), 'name', p.full_name, 'employeeId', p.id,
             'department', (select d.name from public.departments d where d.id = p.department_id),
             'designation', coalesce(nullif(p."position", ''), (select x.designation from public.employee_personal_details x where x.profile_id = p.id)),
             'role', p.role::text, 'operationsHead', p.is_operations_head,
             'employeeCode', coalesce((select r.employee_code from public.approval_requests r where r.id = w.approval_request_id),
                                      (select e.employee_code from private.hr_mail_employees() e where e.profile_id = p.id limit 1))
           ) order by w.created_at)
      from public.employee_welcome_emails w join public.profiles p on p.id = w.employee_id
     where w.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.welcome_email_claim(integer, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.welcome_email_claim(integer, text, integer, text[]) to service_role;

-- Records the result. SENT only after the provider accepted the message. A temporary failure is retried after 5, 15, 60 and 240 minutes and
-- is FAILED after 5 attempts; a permanent one fails at once. HR is told when it ends FAILED (or cannot be sent).
create or replace function public.welcome_email_finish(p_id uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.employee_welcome_emails;
  v_status text;
  v_name text;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY', 'DRY_RUN') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into w from public.employee_welcome_emails where id = p_id for update;
  if w.id is null or w.status <> 'PROCESSING' then
    raise exception 'CONFLICT: This e-mail is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case p_outcome when 'RETRY' then case when w.attempts >= 5 then 'FAILED' else 'RETRYING' end else p_outcome end;
  update public.employee_welcome_emails
     set status = v_status,
         last_error = case when v_status in ('SENT', 'DRY_RUN') then null else left(p_detail, 500) end,
         response_code = p_response_code,
         provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null,
         sent_at = case when v_status = 'SENT' then now() else sent_at end,
         next_attempt_at = case when v_status = 'RETRYING' then now() + (array[5, 15, 60, 240])[least(w.attempts, 4)] * interval '1 minute' else next_attempt_at end,
         updated_at = now()
   where id = p_id returning * into w;
  insert into public.employee_welcome_email_attempts (email_id, attempt_no, kind, actor_id, outcome, detail)
  values (w.id, w.attempts, case when w.resend_count > 0 and w.last_resend_at is not null and w.last_attempt_at >= w.last_resend_at then 'RESEND' else 'SEND' end,
          case when w.resend_count > 0 and w.last_resend_at is not null and w.last_attempt_at >= w.last_resend_at then w.last_resend_by end,
          p_outcome, left(p_detail, 500));
  if v_status in ('SENT', 'FAILED') then
    perform private.write_audit(case when v_status = 'SENT' then 'EMPLOYEE_WELCOME_EMAIL_SENT' else 'EMPLOYEE_WELCOME_EMAIL_FAILED' end, 'profile', w.employee_id, null, null,
      jsonb_build_object('attempts', w.attempts, 'event', w.trigger_event));
  end if;
  if v_status = 'FAILED' or (v_status = 'SKIPPED' and coalesce(p_detail, '') ilike '%e-mail address%') then
    select p.full_name into v_name from public.profiles p where p.id = w.employee_id;
    perform private.notify_hr('EMPLOYEE_WELCOME_EMAIL_FAILED', format('Welcome e-mail failed: %s', coalesce(v_name, 'employee')),
      'The welcome e-mail could not be delivered. Open Employee Requests and use Resend welcome e-mail.', 'profile', w.employee_id,
      jsonb_build_object('emailId', w.id), 'urgent');
  end if;
  return jsonb_build_object('id', w.id, 'status', w.status, 'attempts', w.attempts, 'nextAttemptAt', w.next_attempt_at);
end $$;
revoke all on function public.welcome_email_finish(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.welcome_email_finish(uuid, text, text, integer, text) to service_role;

-- The API finished creating the account: the held welcome e-mail may go now.
create or replace function public.welcome_email_release(p_employee uuid)
returns void language sql security definer set search_path = '' as $$
  update public.employee_welcome_emails set next_attempt_at = now(), updated_at = now() where employee_id = p_employee and status = 'PENDING' and next_attempt_at > now()
$$;
revoke all on function public.welcome_email_release(uuid) from public, anon, authenticated;
grant execute on function public.welcome_email_release(uuid) to service_role;

-- The employee used the link and chose their own password: any open welcome e-mail is closed (it must not be sent again).
create or replace function public.welcome_email_setup_done(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.employee_welcome_emails
     set setup_completed_at = now(), updated_at = now(),
         status = case when status in ('PENDING', 'RETRYING', 'DRY_RUN') then 'SKIPPED' else status end,
         last_error = case when status in ('PENDING', 'RETRYING', 'DRY_RUN') then 'The employee has already set their password.' else last_error end
   where employee_id = p_user and setup_completed_at is null;
  if found then
    perform private.write_audit('EMPLOYEE_PASSWORD_SET', 'profile', p_user, null, null, jsonb_build_object('via', 'welcome_link'));
  end if;
end $$;
revoke all on function public.welcome_email_setup_done(uuid) from public, anon, authenticated;
grant execute on function public.welcome_email_setup_done(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Who may see and resend (HR, the Super Admin, the Department Head of the employee's department)
-- ---------------------------------------------------------------------------
create or replace function private.can_manage_welcome(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles me
     where me.id = auth.uid() and me.status = 'ACTIVE' and (
       me.role = 'SUPER_ADMIN'
       or exists (select 1 from public.departments d where d.id = me.department_id and d.slug = 'hr')
       or (me.role = 'DEPARTMENT_HEAD' and not me.is_operations_head and exists (
             select 1 from public.profiles e where e.id = p_employee and private.base_department(e.department_id) = private.base_department(me.department_id)))))
$$;
revoke all on function private.can_manage_welcome(uuid) from public, anon, authenticated;

create or replace function private.welcome_json(w public.employee_welcome_emails)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', w.id, 'employeeId', w.employee_id, 'employee', p.full_name, 'email', w.recipient_email,
    'department', (select d.name from public.departments d where d.id = p.department_id),
    'designation', nullif(p."position", ''), 'accountStatus', p.status::text,
    'emailType', w.email_type, 'triggerEvent', w.trigger_event, 'requestId', w.approval_request_id,
    'status', w.status, 'attempts', w.attempts, 'retryCount', greatest(w.attempts - 1, 0), 'resendCount', w.resend_count,
    'sentAt', w.sent_at, 'lastError', w.last_error, 'nextAttemptAt', case when w.status = 'RETRYING' then w.next_attempt_at end,
    'createdAt', w.created_at, 'lastResendAt', w.last_resend_at, 'setupCompletedAt', w.setup_completed_at,
    'canResend', p.status = 'ACTIVE' and w.setup_completed_at is null and w.status not in ('PENDING', 'PROCESSING', 'RETRYING'))
  from public.profiles p where p.id = w.employee_id
$$;
revoke all on function private.welcome_json(public.employee_welcome_emails) from public, anon, authenticated;

-- The latest welcome e-mail of each employee the caller may see (optionally one status or one employee).
create or replace function public.welcome_emails_list(p_status text default null, p_employee uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_items jsonb;
  v_counts jsonb;
begin
  if not exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'ACTIVE'
                 and (me.role = 'SUPER_ADMIN' or me.role = 'DEPARTMENT_HEAD'
                      or exists (select 1 from public.departments d where d.id = me.department_id and d.slug = 'hr'))) then
    raise exception 'FORBIDDEN: Only HR, Department Heads and the Super Admin can see welcome e-mails.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('PENDING', 'PROCESSING', 'RETRYING', 'SENT', 'FAILED', 'SKIPPED', 'DRY_RUN') then
    raise exception 'VALIDATION_ERROR: Choose a valid status.' using errcode = 'P0001';
  end if;
  with latest as (
    select distinct on (w.employee_id) w.* from public.employee_welcome_emails w
     where private.can_manage_welcome(w.employee_id) and (p_employee is null or w.employee_id = p_employee)
     order by w.employee_id, w.created_at desc, w.id)
  select
    (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select l.status, count(*) n from latest l group by l.status) s),
    (select coalesce(jsonb_agg(private.welcome_json(x) order by (x.status in ('FAILED', 'SKIPPED')) desc, x.created_at desc), '[]'::jsonb)
       from (select l.* from latest l where p_status is null or l.status = p_status order by l.created_at desc limit 300) x)
    into v_counts, v_items;
  return jsonb_build_object('items', v_items, 'counts', v_counts);
end $$;
revoke all on function public.welcome_emails_list(text, uuid) from public, anon;
grant execute on function public.welcome_emails_list(text, uuid) to authenticated;

-- Resend the welcome e-mail. Refused while one is in flight, within two minutes of the last send / resend, when the employee has already chosen
-- their own password, when the account is not active and when there is no valid address. The new link is made when it is sent (it replaces
-- the earlier one). Every resend is recorded with who asked.
create or replace function public.welcome_email_resend(p_employee uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pr public.profiles;
  w public.employee_welcome_emails;
  v_email text;
begin
  select * into pr from public.profiles where id = p_employee;
  if pr.id is null or not private.can_manage_welcome(p_employee) then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  if pr.status <> 'ACTIVE' then
    raise exception 'CONFLICT: The account is not active, so no welcome e-mail can be sent.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(pr.email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The employee has no valid e-mail address. Correct it first.' using errcode = 'P0001';
  end if;
  -- one resend at a time per employee
  perform pg_advisory_xact_lock(hashtextextended('welcome:' || p_employee::text, 0));
  select * into w from public.employee_welcome_emails where employee_id = p_employee order by created_at desc, id limit 1 for update;
  if w.id is not null and w.setup_completed_at is not null then
    raise exception 'CONFLICT: The employee has already set their own password. Use "Forgot password" on the sign-in page if they need a new one.' using errcode = 'P0001';
  end if;
  if w.id is not null and (w.status in ('PENDING', 'RETRYING') or (w.status = 'PROCESSING' and w.locked_until > now())) then
    raise exception 'CONFLICT: A welcome e-mail is already being sent to this employee.' using errcode = 'P0001';
  end if;
  if w.id is not null and greatest(coalesce(w.sent_at, 'epoch'), coalesce(w.last_resend_at, 'epoch')) > now() - interval '2 minutes' then
    raise exception 'CONFLICT: A welcome e-mail was just sent. Wait two minutes before sending it again.' using errcode = 'P0001';
  end if;
  if w.id is null then
    insert into public.employee_welcome_emails (employee_id, recipient_email, trigger_event, event_key, activated_by, status, resend_count, last_resend_at, last_resend_by)
    values (pr.id, v_email, 'MANUAL_RESEND', 'RESEND:' || gen_random_uuid()::text, auth.uid(), 'PENDING', 1, now(), auth.uid())
    returning * into w;
  else
    update public.employee_welcome_emails
       set status = 'PENDING', attempts = 0, recipient_email = v_email, next_attempt_at = now(), locked_until = null, last_error = null, response_code = null,
           resend_count = resend_count + 1, last_resend_at = now(), last_resend_by = auth.uid(), updated_at = now()
     where id = w.id returning * into w;
  end if;
  insert into public.employee_welcome_email_attempts (email_id, attempt_no, kind, actor_id, outcome, detail)
  values (w.id, 0, 'RESEND', auth.uid(), 'RESEND_REQUESTED', 'Resend requested');
  perform private.write_audit('EMPLOYEE_WELCOME_EMAIL_RESEND', 'profile', pr.id, pr.department_id, pr.team_id, jsonb_build_object('resend', w.resend_count));
  return private.welcome_json(w);
end $$;
revoke all on function public.welcome_email_resend(uuid) from public, anon;
grant execute on function public.welcome_email_resend(uuid) to authenticated;

notify pgrst, 'reload schema';
