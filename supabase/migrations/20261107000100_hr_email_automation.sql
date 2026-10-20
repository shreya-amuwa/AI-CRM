-- =============================================================================
-- HR e-mail automation: birthdays, work anniversaries, probation reminders and employment confirmation.
--
-- Uses the employee data the HR dashboard already shows (CRM accounts in profiles + their HR record in hr_employees +
-- the personal details from Add Member) - no second employee table.
--
--  * hr_email_events      one row per e-mail to send / sent, with a UNIQUE event_key, so the same occasion can never
--                         be queued (or sent) twice. Status PENDING / SENDING / RETRY / SENT / FAILED / SKIPPED / DRY_RUN,
--                         attempts, timestamps and the last error.
--  * hr_probation_cycles  one confirmation cycle per employee and joining date: probation end = joining date + 6 months,
--                         status PENDING / APPROVED / DISMISSED, who approved and when. Nothing marks anyone permanent
--                         by itself: only hr_confirm_probation() (HR lead, Department Head of the employee, Super Admin).
--  * hr_schedule_emails() the daily check (service role, called by the API's scheduler endpoint; idempotent, so running
--                         it every few minutes is harmless): birthdays and anniversaries of today (and the 2 days before,
--                         for a missed run), probation reminders from 7 days before the end, weekly overdue reminders
--                         to HR (max 8) while a confirmation is still pending.
--  * hr_email_claim / hr_email_finish  the queue the mail sender works through (SKIP LOCKED, lease, back-off 5/15/60/240
--                         minutes, FAILED after 5 attempts).
--  * HR dashboard RPCs    overview, history, probation list, retry, approve / dismiss, data issues, fix dates.
-- Dates use Indian time (Asia/Kolkata); mails go out from 09:00 that day. Idempotent. No data is dropped or changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.hr_probation_cycles (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null,                 -- profile id, or 'HR:<hr record id>' for an HR-only record
  profile_id uuid references public.profiles (id) on delete set null,
  hr_record_id text,
  employee_name text not null,
  employee_email text,
  employee_code text not null,
  department_id uuid references public.departments (id) on delete set null,
  department_name text,
  joining_date date not null,
  probation_end date not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DISMISSED')),
  effective_date date,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  decision_note text check (length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_key, joining_date)
);
create index if not exists hr_probation_cycles_status_idx on public.hr_probation_cycles (status, probation_end);
alter table public.hr_probation_cycles enable row level security;
revoke all on public.hr_probation_cycles from public, anon, authenticated;

create table if not exists public.hr_email_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (length(event_key) <= 300),
  kind text not null check (kind in ('BIRTHDAY', 'ANNIVERSARY', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR',
                                     'PROBATION_OVERDUE_HR', 'CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR')),
  employee_key text,
  profile_id uuid references public.profiles (id) on delete set null,
  cycle_id uuid references public.hr_probation_cycles (id) on delete set null,
  recipient_email text,
  recipient_name text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  event_date date not null,                   -- the occasion (birthday, anniversary, reminder day)
  send_after timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED', 'DRY_RUN')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text check (length(last_error) <= 500),
  response_code integer,
  provider_ref text check (length(provider_ref) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_email_events_queue_idx on public.hr_email_events (status, send_after);
create index if not exists hr_email_events_created_idx on public.hr_email_events (created_at desc);
create index if not exists hr_email_events_cycle_idx on public.hr_email_events (cycle_id);
alter table public.hr_email_events enable row level security;
revoke all on public.hr_email_events from public, anon, authenticated;

create table if not exists public.hr_automation_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.hr_automation_state enable row level security;
revoke all on public.hr_automation_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.hr_today()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- 09:00 Indian time on that date
create or replace function private.hr_nine_am(p_date date)
returns timestamptz language sql immutable set search_path = '' as $$ select (p_date::timestamp + interval '9 hours') at time zone 'Asia/Kolkata' $$;

-- A real date from the text HR keeps (YYYY-MM-DD or DD-MM-YYYY); null when it is not one.
create or replace function private.hr_safe_date(p text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p is null then return null; end if;
  if p ~ '^\d{4}-\d{2}-\d{2}' then return left(p, 10)::date; end if;
  if p ~ '^\d{2}-\d{2}-\d{4}$' then return to_date(p, 'DD-MM-YYYY'); end if;
  return null;
exception when others then
  return null;
end $$;

-- The day of the year an annual date falls on (29 February is celebrated on 28 February in a common year).
create or replace function private.hr_occasion_date(p_date date, p_year integer)
returns date language sql immutable set search_path = '' as $$
  select case
    when extract(month from p_date) = 2 and extract(day from p_date) = 29 and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0))
      then make_date(p_year, 2, 28)
    else make_date(p_year, extract(month from p_date)::int, extract(day from p_date)::int)
  end
$$;

-- Everybody the HR dashboard lists (CRM accounts merged with their HR record, plus HR-only records), with the dates the
-- automation uses: date of birth (Add Member details) and the actual joining date (details, else the HR record's date).
-- Never falls back to the account creation date.
create or replace function private.hr_mail_employees()
returns table (employee_key text, profile_id uuid, hr_record_id text, full_name text, email text, department_id uuid, department_name text,
               employee_code text, date_of_birth date, joining_date date, hr_status text, is_active boolean)
language sql stable security definer set search_path = '' as $$
  select p.id::text, p.id, h.id, p.full_name, lower(btrim(coalesce(p.email, ''))), p.department_id, d.name,
         coalesce(h.id, 'EMP-' || upper(left(p.id::text, 8))),
         coalesce(x.date_of_birth, private.hr_safe_date(h.data ->> 'dateOfBirth')),
         coalesce(x.joining_date, private.hr_safe_date(h.joining_date)),
         h.status,
         (p.status = 'ACTIVE' and coalesce(h.status, '') <> 'Left')
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    left join public.employee_personal_details x on x.profile_id = p.id
    left join lateral (
      select y.* from public.hr_employees y
       where y.profile_id = p.id or (y.profile_id is null and lower(trim(coalesce(y.email, ''))) = p.email)
       order by (y.profile_id is not null) desc, y.created_at limit 1) h on true
   where p.role <> 'SUPER_ADMIN' and p.status <> 'REJECTED'
  union all
  select 'HR:' || h.id, null::uuid, h.id, h.name, lower(btrim(coalesce(h.email, ''))), d.id, coalesce(d.name, h.department_id), h.id,
         private.hr_safe_date(h.data ->> 'dateOfBirth'), private.hr_safe_date(h.joining_date), h.status, (coalesce(h.status, '') <> 'Left')
    from public.hr_employees h
    left join public.departments d on d.slug = h.department_id
   where h.profile_id is null
     and not exists (select 1 from public.profiles p where p.email = lower(trim(coalesce(h.email, ''))) and p.status <> 'REJECTED')
$$;
revoke all on function private.hr_mail_employees() from public, anon, authenticated;

-- Who gets the HR copies: the active HR department members, plus any addresses in crm_settings "hr.notify_emails" (JSON array).
create or replace function private.hr_notify_recipients()
returns table (email text, name text) language sql stable security definer set search_path = '' as $$
  select distinct on (r.email) r.email, r.name from (
    select lower(btrim(p.email)) as email, p.full_name as name
      from public.profiles p join public.departments d on d.id = p.department_id
     where d.slug = 'hr' and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
    union all
    select lower(btrim(x)), 'HR Team'
      from public.crm_settings s, jsonb_array_elements_text(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) x
     where s.key = 'hr.notify_emails'
  ) r
  where r.email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  order by r.email, r.name
$$;
revoke all on function private.hr_notify_recipients() from public, anon, authenticated;

-- Queue one e-mail. Returns true when it was new. The unique key makes a second call for the same occasion a no-op.
-- A recipient without a valid address is recorded as SKIPPED so HR can see why nothing was sent.
create or replace function private.hr_enqueue(
  p_key text, p_kind text, p_employee_key text, p_profile uuid, p_cycle uuid, p_email text, p_name text,
  p_payload jsonb, p_event_date date, p_send_after timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean := coalesce(p_email, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  v_rows integer;
begin
  insert into public.hr_email_events (event_key, kind, employee_key, profile_id, cycle_id, recipient_email, recipient_name, payload,
                                      event_date, send_after, status, last_error)
  values (p_key, p_kind, p_employee_key, p_profile, p_cycle, nullif(lower(btrim(coalesce(p_email, ''))), ''), p_name, p_payload,
          p_event_date, p_send_after, case when v_ok then 'PENDING' else 'SKIPPED' end,
          case when v_ok then null else 'No valid e-mail address for the recipient.' end)
  on conflict (event_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
revoke all on function private.hr_enqueue(text, text, text, uuid, uuid, text, text, jsonb, date, timestamptz) from public, anon, authenticated;

-- May the signed-in user decide this confirmation? Super Admin, an HR Department Head / Team Lead, or the Department Head of
-- the employee's department - never one's own.
create or replace function private.can_confirm_probation(p_cycle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_probation_cycles c
     where c.id = p_cycle
       and (private.is_super_admin() or (
         c.profile_id is distinct from auth.uid() and exists (
           select 1 from public.profiles me join public.departments d on d.id = me.department_id
            where me.id = auth.uid() and me.status = 'ACTIVE'
              and ((d.slug = 'hr' and me.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD'))
                or (me.role = 'DEPARTMENT_HEAD' and me.department_id = c.department_id)))))
  )
$$;
revoke all on function private.can_confirm_probation(uuid) from public, anon;
grant execute on function private.can_confirm_probation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The daily check (service role). Idempotent: run it as often as you like.
-- ---------------------------------------------------------------------------
create or replace function public.hr_schedule_emails(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  e record;
  c record;
  r record;
  d integer;
  v_occ date;
  v_end date;
  v_n integer;
  v_birthdays integer := 0;
  v_anniversaries integer := 0;
  v_cycles integer := 0;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_new boolean;
  v_rows integer;
begin
  -- 3a. Birthdays and work anniversaries: today, and the two days before (a run that was missed still sends, late but once).
  for e in select * from private.hr_mail_employees() m where m.is_active loop
    for d in 0..2 loop
      v_occ := v_today - d;
      if e.date_of_birth is not null and e.date_of_birth <= v_occ
         and private.hr_occasion_date(e.date_of_birth, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('BIRTHDAY:' || e.employee_key || ':' || extract(year from v_occ)::int, 'BIRTHDAY', e.employee_key, e.profile_id, null,
                  e.email, e.full_name, jsonb_build_object('employeeName', e.full_name), v_occ, private.hr_nine_am(v_occ));
        if v_new then v_birthdays := v_birthdays + 1; end if;
      end if;
      if e.joining_date is not null and extract(year from v_occ) > extract(year from e.joining_date)
         and private.hr_occasion_date(e.joining_date, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('ANNIVERSARY:' || e.employee_key || ':' || (extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  'ANNIVERSARY', e.employee_key, e.profile_id, null, e.email, e.full_name,
                  jsonb_build_object('employeeName', e.full_name, 'years', extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  v_occ, private.hr_nine_am(v_occ));
        if v_new then v_anniversaries := v_anniversaries + 1; end if;
      end if;
    end loop;
  end loop;

  -- 3b. Probation cycles. Close the ones nobody needs any more ...
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the employee is no longer active.', updated_at = now()
   where pc.status = 'PENDING'
     and not exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.is_active);
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the joining date was changed.', updated_at = now()
   where pc.status = 'PENDING'
     and exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.joining_date is distinct from pc.joining_date);

  -- ... open one for recent joiners (joined less than 6 months + 30 days ago) and for everyone marked "Training / Probation".
  -- Interns have none. Employees who joined long ago are treated as confirmed: nothing is sent for them.
  for e in select * from private.hr_mail_employees() m
            where m.is_active and m.joining_date is not null and m.joining_date <= v_today and coalesce(m.hr_status, '') <> 'Intern' loop
    v_end := (e.joining_date + interval '6 months')::date;
    if coalesce(e.hr_status, '') = 'Training / Probation' or v_end >= v_today - 30 then
      insert into public.hr_probation_cycles (employee_key, profile_id, hr_record_id, employee_name, employee_email, employee_code,
                                              department_id, department_name, joining_date, probation_end)
      values (e.employee_key, e.profile_id, e.hr_record_id, e.full_name, e.email, e.employee_code, e.department_id, e.department_name, e.joining_date, v_end)
      on conflict (employee_key, joining_date) do update
         set employee_name = excluded.employee_name, employee_email = excluded.employee_email, employee_code = excluded.employee_code,
             department_id = excluded.department_id, department_name = excluded.department_name, hr_record_id = excluded.hr_record_id, updated_at = now()
       where public.hr_probation_cycles.status = 'PENDING'
         and (public.hr_probation_cycles.employee_name, public.hr_probation_cycles.employee_email, public.hr_probation_cycles.employee_code,
              public.hr_probation_cycles.department_name) is distinct from (excluded.employee_name, excluded.employee_email, excluded.employee_code, excluded.department_name);
      get diagnostics v_rows = row_count;
      v_cycles := v_cycles + v_rows;
    end if;
  end loop;

  -- 3c. Reminders for pending confirmations.
  for c in select * from public.hr_probation_cycles pc where pc.status = 'PENDING' loop
    if v_today >= c.probation_end - 7 and v_today <= c.probation_end then
      -- one week before (or, if the cycle is found later, as soon as it is found): the employee and HR, once per cycle
      v_new := private.hr_enqueue('PROBATION_REMINDER_EMPLOYEE:' || c.id, 'PROBATION_REMINDER_EMPLOYEE', c.employee_key, c.profile_id, c.id,
                c.employee_email, c.employee_name,
                jsonb_build_object('employeeName', c.employee_name, 'probationEndDate', c.probation_end),
                c.probation_end - 7, private.hr_nine_am(c.probation_end - 7));
      if v_new then v_reminders := v_reminders + 1; end if;
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_REMINDER_HR:' || c.id || ':' || r.email, 'PROBATION_REMINDER_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysLeft', c.probation_end - v_today),
                  c.probation_end - 7, private.hr_nine_am(c.probation_end - 7));
        if v_new then v_reminders := v_reminders + 1; end if;
      end loop;
    elsif v_today > c.probation_end then
      -- still not decided after the end date: HR is reminded weekly (at most 8 times); the employee is NOT confirmed
      v_n := least(7, (v_today - c.probation_end - 1) / 7);
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_OVERDUE_HR:' || c.id || ':' || v_n || ':' || r.email, 'PROBATION_OVERDUE_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysOverdue', v_today - c.probation_end),
                  v_today, private.hr_nine_am(v_today));
        if v_new then v_overdue := v_overdue + 1; end if;
      end loop;
    end if;
  end loop;

  insert into public.hr_automation_state (key, value, updated_at)
  values ('last_schedule', jsonb_build_object('ranAt', now(), 'day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries,
                                              'cyclesOpened', v_cycles, 'reminders', v_reminders, 'overdueReminders', v_overdue), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries, 'cyclesOpened', v_cycles,
                            'reminders', v_reminders, 'overdueReminders', v_overdue);
end $$;
revoke all on function public.hr_schedule_emails(date) from public, anon, authenticated;
grant execute on function public.hr_schedule_emails(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The sending queue (service role)
-- ---------------------------------------------------------------------------
-- p_mode 'live': PENDING / RETRY that are due, DRY_RUN rows that are still relevant, and SENDING rows whose lease expired.
-- p_mode 'dry_run': only PENDING / RETRY (they become DRY_RUN and are not sent).
-- p_only_recipients (test mode): only e-mails to these addresses are claimed; the rest wait untouched.
create or replace function public.hr_email_claim(p_limit integer default 10, p_mode text default 'live', p_lease_seconds integer default 600, p_only_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_today date := private.hr_today();
begin
  -- a greeting that is days late is not sent
  update public.hr_email_events
     set status = 'SKIPPED', last_error = 'Too late to send: the day has passed.', locked_until = null, updated_at = now()
   where kind in ('BIRTHDAY', 'ANNIVERSARY') and status in ('PENDING', 'RETRY', 'DRY_RUN', 'SENDING')
     and (status <> 'SENDING' or locked_until < now()) and event_date < v_today - 2;
  -- reminders about a confirmation that has been decided are pointless
  update public.hr_email_events ev
     set status = 'SKIPPED', last_error = 'The confirmation has already been decided.', locked_until = null, updated_at = now()
   where ev.kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR', 'PROBATION_OVERDUE_HR') and ev.status in ('PENDING', 'RETRY', 'DRY_RUN')
     and exists (select 1 from public.hr_probation_cycles pc where pc.id = ev.cycle_id and pc.status <> 'PENDING');

  select coalesce(array_agg(id), '{}') into v_ids from (
    select ev.id from public.hr_email_events ev
     where ev.send_after <= now()
       and (p_only_recipients is null or lower(ev.recipient_email) = any (p_only_recipients))
       and ((ev.status in ('PENDING', 'RETRY') and ev.next_attempt_at <= now())
         or (p_mode = 'live' and ev.status = 'DRY_RUN')
         or (ev.status = 'SENDING' and ev.locked_until < now()))
     order by ev.send_after
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  update public.hr_email_events
     set status = 'SENDING', attempts = case when status = 'DRY_RUN' then 1 else attempts + 1 end, last_attempt_at = now(), updated_at = now(),
         locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 1800)))
   where id = any (v_ids);

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ev.id, 'kind', ev.kind, 'attempts', ev.attempts, 'to', ev.recipient_email,
                                        'toName', ev.recipient_name, 'payload', ev.payload, 'eventDate', ev.event_date) order by ev.send_after)
      from public.hr_email_events ev where ev.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.hr_email_claim(integer, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.hr_email_claim(integer, text, integer, text[]) to service_role;

create or replace function public.hr_email_finish(p_event uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ev public.hr_email_events;
  v_status text;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY', 'DRY_RUN') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into ev from public.hr_email_events where id = p_event for update;
  if ev.id is null or ev.status <> 'SENDING' then
    raise exception 'CONFLICT: This e-mail is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and ev.attempts >= 5 then 'FAILED' else p_outcome end;
  update public.hr_email_events
     set status = v_status,
         last_error = case when v_status = 'SENT' then null else left(p_detail, 500) end,
         response_code = p_response_code,
         provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null,
         sent_at = case when v_status = 'SENT' then now() else sent_at end,
         next_attempt_at = case when v_status = 'RETRY' then now() + (array[5, 15, 60, 240])[least(ev.attempts, 4)] * interval '1 minute' else next_attempt_at end,
         updated_at = now()
   where id = p_event
  returning * into ev;
  if v_status in ('SENT', 'FAILED') then
    perform private.write_audit(case when v_status = 'SENT' then 'HR_EMAIL_SENT' else 'HR_EMAIL_FAILED' end, 'hr_email', ev.id, null, null,
      jsonb_build_object('kind', ev.kind, 'attempts', ev.attempts));
  end if;
  return jsonb_build_object('id', ev.id, 'status', ev.status, 'attempts', ev.attempts, 'nextAttemptAt', ev.next_attempt_at);
end $$;
revoke all on function public.hr_email_finish(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.hr_email_finish(uuid, text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Approval of the confirmation (HR lead, the employee's Department Head, Super Admin)
-- ---------------------------------------------------------------------------
create or replace function private.hr_cycle_json(c public.hr_probation_cycles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'employeeName', c.employee_name, 'employeeEmail', c.employee_email, 'employeeCode', c.employee_code,
    'department', c.department_name, 'joiningDate', c.joining_date, 'probationEnd', c.probation_end,
    'daysLeft', c.probation_end - private.hr_today(), 'status', c.status, 'effectiveDate', c.effective_date,
    'approvedAt', c.approved_at, 'approvedBy', (select a.full_name from public.profiles a where a.id = c.approved_by),
    'note', c.decision_note, 'canDecide', private.can_confirm_probation(c.id))
$$;
revoke all on function private.hr_cycle_json(public.hr_probation_cycles) from public, anon, authenticated;

create or replace function public.hr_confirm_probation(p_cycle uuid, p_effective date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  me public.profiles;
  v_eff date;
  v_send timestamptz;
  r record;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the employee''s Department Head or the Super Admin can confirm an employee, and nobody can confirm themselves.' using errcode = '42501';
  end if;
  if c.status <> 'PENDING' then raise exception 'CONFLICT: This confirmation was already decided.' using errcode = 'P0001'; end if;
  v_eff := coalesce(p_effective, c.probation_end);
  if v_eff < c.joining_date or v_eff > private.hr_today() + 366 then
    raise exception 'VALIDATION_ERROR: Enter a valid confirmation effective date.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();

  update public.hr_probation_cycles
     set status = 'APPROVED', effective_date = v_eff, approved_by = auth.uid(), approved_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), updated_at = now()
   where id = c.id returning * into c;

  -- the confirmation e-mails go out once the probation period is over (not before) and only because of this approval
  v_send := greatest(now(), private.hr_nine_am(c.probation_end));
  perform private.hr_enqueue('CONFIRMATION_EMPLOYEE:' || c.id, 'CONFIRMATION_EMPLOYEE', c.employee_key, c.profile_id, c.id, c.employee_email, c.employee_name,
    jsonb_build_object('employeeName', c.employee_name, 'confirmationEffectiveDate', v_eff), private.hr_today(), v_send);
  for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
    perform private.hr_enqueue('CONFIRMATION_HR:' || c.id || ':' || r.email, 'CONFIRMATION_HR', c.employee_key, c.profile_id, c.id, r.email, r.name,
      jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                         'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'confirmationEffectiveDate', v_eff,
                         'approvalStatus', 'Approved', 'approvedBy', me.full_name),
      private.hr_today(), v_send);
  end loop;

  -- the HR record follows the decision (only a record that says "Training / Probation")
  update public.hr_employees set status = 'Full-Time', updated_at = now()
   where id = c.hr_record_id and status = 'Training / Probation';

  perform private.write_audit('EMPLOYEE_CONFIRMED', 'hr_probation', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'effectiveDate', v_eff));
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_confirm_probation(uuid, date, text) from public, anon;
grant execute on function public.hr_confirm_probation(uuid, date, text) to authenticated;

create or replace function public.hr_dismiss_probation(p_cycle uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the employee''s Department Head or the Super Admin can close a confirmation.' using errcode = '42501';
  end if;
  if c.status <> 'PENDING' then raise exception 'CONFLICT: This confirmation was already decided.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: Say why the confirmation is closed without e-mails (for example "confirmed earlier").' using errcode = 'P0001';
  end if;
  update public.hr_probation_cycles
     set status = 'DISMISSED', approved_by = auth.uid(), approved_at = now(), decision_note = left(btrim(p_note), 500), updated_at = now()
   where id = c.id returning * into c;
  perform private.write_audit('PROBATION_CLOSED', 'hr_probation', c.id, c.department_id, null, jsonb_build_object('employee', c.employee_name));
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_dismiss_probation(uuid, text) from public, anon;
grant execute on function public.hr_dismiss_probation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. HR dashboard (HR staff and the Super Admin)
-- ---------------------------------------------------------------------------
create or replace function private.hr_require_staff()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can use the e-mail automation.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.hr_require_staff() from public, anon;
grant execute on function private.hr_require_staff() to authenticated, service_role;

create or replace function public.hr_email_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'today', v_today,
    'lastRun', (select value from public.hr_automation_state where key = 'last_schedule'),
    'last30Days', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) as n from public.hr_email_events where created_at > now() - interval '30 days' group by status) s), '{}'::jsonb),
    'byKind', coalesce((select jsonb_object_agg(kind, n) from (
        select kind, count(*) as n from public.hr_email_events where status = 'SENT' and sent_at > now() - interval '365 days' group by kind) s), '{}'::jsonb),
    'queue', jsonb_build_object(
      'pending', (select count(*) from public.hr_email_events where status in ('PENDING', 'SENDING')),
      'retrying', (select count(*) from public.hr_email_events where status = 'RETRY'),
      'failed', (select count(*) from public.hr_email_events where status = 'FAILED')),
    'confirmations', jsonb_build_object(
      'pending', (select count(*) from public.hr_probation_cycles where status = 'PENDING'),
      'dueWithin7Days', (select count(*) from public.hr_probation_cycles where status = 'PENDING' and probation_end between v_today and v_today + 7),
      'overdue', (select count(*) from public.hr_probation_cycles where status = 'PENDING' and probation_end < v_today)),
    'upcoming', coalesce((select jsonb_agg(u order by (u ->> 'date'), (u ->> 'name')) from (
        select jsonb_build_object('kind', 'BIRTHDAY', 'name', m.full_name, 'date', dd.g) as u
          from private.hr_mail_employees() m, generate_series(0, 13) n,
               lateral (select v_today + n as g) dd
         where m.is_active and m.date_of_birth is not null and private.hr_occasion_date(m.date_of_birth, extract(year from dd.g)::int) = dd.g
        union all
        select jsonb_build_object('kind', 'ANNIVERSARY', 'name', m.full_name, 'date', dd.g,
                                  'years', extract(year from dd.g)::int - extract(year from m.joining_date)::int)
          from private.hr_mail_employees() m, generate_series(0, 13) n,
               lateral (select v_today + n as g) dd
         where m.is_active and m.joining_date is not null and extract(year from dd.g) > extract(year from m.joining_date)
           and private.hr_occasion_date(m.joining_date, extract(year from dd.g)::int) = dd.g) x), '[]'::jsonb));
end $$;
revoke all on function public.hr_email_overview() from public, anon;
grant execute on function public.hr_email_overview() to authenticated;

create or replace function public.hr_email_history(p_status text default null, p_kind text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_total bigint;
begin
  perform private.hr_require_staff();
  select count(*) into v_total from public.hr_email_events ev
   where (p_status is null or ev.status = p_status) and (p_kind is null or ev.kind = p_kind);
  return jsonb_build_object('total', v_total, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', ev.id, 'kind', ev.kind, 'employeeName', ev.payload ->> 'employeeName', 'recipientEmail', ev.recipient_email,
        'recipientName', ev.recipient_name, 'status', ev.status, 'attempts', ev.attempts, 'eventDate', ev.event_date,
        'sendAfter', ev.send_after, 'sentAt', ev.sent_at, 'lastAttemptAt', ev.last_attempt_at, 'nextAttemptAt', ev.next_attempt_at,
        'error', ev.last_error, 'createdAt', ev.created_at) order by ev.created_at desc, ev.id)
      from (select * from public.hr_email_events e2
             where (p_status is null or e2.status = p_status) and (p_kind is null or e2.kind = p_kind)
             order by e2.created_at desc, e2.id
             limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) ev), '[]'::jsonb));
end $$;
revoke all on function public.hr_email_history(text, text, integer, integer) from public, anon;
grant execute on function public.hr_email_history(text, text, integer, integer) to authenticated;

create or replace function public.hr_probation_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((
    select jsonb_agg(private.hr_cycle_json(c) order by (c.status = 'PENDING') desc, c.probation_end)
      from public.hr_probation_cycles c
     where c.status = 'PENDING' or c.updated_at > now() - interval '90 days'), '[]'::jsonb);
end $$;
revoke all on function public.hr_probation_list() from public, anon;
grant execute on function public.hr_probation_list() to authenticated;

-- Try a failed e-mail again (its retries start from zero).
create or replace function public.hr_email_retry(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ev public.hr_email_events;
begin
  perform private.hr_require_staff();
  select * into ev from public.hr_email_events where id = p_event for update;
  if ev.id is null then raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0001'; end if;
  if ev.status <> 'FAILED' then raise exception 'CONFLICT: Only a failed e-mail can be tried again.' using errcode = 'P0001'; end if;
  update public.hr_email_events set status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
   where id = ev.id returning * into ev;
  return jsonb_build_object('id', ev.id, 'status', ev.status);
end $$;
revoke all on function public.hr_email_retry(uuid) from public, anon;
grant execute on function public.hr_email_retry(uuid) to authenticated;

-- Employees the automation cannot serve yet, and why.
create or replace function public.hr_email_data_issues()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object('employeeKey', m.employee_key, 'name', m.full_name, 'department', m.department_name, 'email', nullif(m.email, ''),
                                        'dateOfBirth', m.date_of_birth, 'joiningDate', m.joining_date,
                                        'issues', to_jsonb(array_remove(array[
                                          case when m.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then 'NO_VALID_EMAIL' end,
                                          case when m.date_of_birth is null then 'NO_DATE_OF_BIRTH' end,
                                          case when m.joining_date is null then 'NO_JOINING_DATE' end,
                                          case when m.joining_date > v_today then 'JOINING_DATE_IN_THE_FUTURE' end], null)))
                    order by m.full_name)
      from private.hr_mail_employees() m
     where m.is_active and (m.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or m.date_of_birth is null or m.joining_date is null or m.joining_date > v_today)), '[]'::jsonb);
end $$;
revoke all on function public.hr_email_data_issues() from public, anon;
grant execute on function public.hr_email_data_issues() to authenticated;

-- HR fills in a missing date of birth / joining date (a CRM account: its personal details; an HR-only record: the record).
create or replace function public.hr_set_employee_dates(p_employee_key text, p_date_of_birth date default null, p_joining_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  if p_date_of_birth is null and p_joining_date is null then
    raise exception 'VALIDATION_ERROR: Enter a date of birth or a joining date.' using errcode = 'P0001';
  end if;
  if p_date_of_birth is not null and (p_date_of_birth < date '1940-01-01' or p_date_of_birth > v_today - 365 * 14) then
    raise exception 'VALIDATION_ERROR: Enter a valid date of birth (age 14 to 100).' using errcode = 'P0001';
  end if;
  if p_joining_date is not null and (p_joining_date < date '1990-01-01' or p_joining_date > v_today + 366) then
    raise exception 'VALIDATION_ERROR: Enter a valid joining date.' using errcode = 'P0001';
  end if;

  if p_employee_key like 'HR:%' then
    update public.hr_employees
       set joining_date = coalesce(to_char(p_joining_date, 'YYYY-MM-DD'), joining_date),
           data = case when p_date_of_birth is null then data
                       else jsonb_set(coalesce(data, '{}'::jsonb), '{dateOfBirth}', to_jsonb(to_char(p_date_of_birth, 'YYYY-MM-DD'))) end,
           updated_at = now()
     where id = substr(p_employee_key, 4) and profile_id is null;
    if not found then raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001'; end if;
  else
    begin
      v_profile := p_employee_key::uuid;
    exception when others then
      raise exception 'VALIDATION_ERROR: Unknown employee.' using errcode = 'P0001';
    end;
    if not exists (select 1 from public.profiles where id = v_profile and role <> 'SUPER_ADMIN') then
      raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
    end if;
    insert into public.employee_personal_details (profile_id, date_of_birth, joining_date)
    values (v_profile, p_date_of_birth, p_joining_date)
    on conflict (profile_id) do update
       set date_of_birth = coalesce(excluded.date_of_birth, public.employee_personal_details.date_of_birth),
           joining_date = coalesce(excluded.joining_date, public.employee_personal_details.joining_date),
           updated_at = now();
    if p_joining_date is not null then
      update public.hr_employees set joining_date = to_char(p_joining_date, 'YYYY-MM-DD'), updated_at = now() where profile_id = v_profile;
    end if;
  end if;
  perform private.write_audit('EMPLOYEE_DATES_SET', 'hr_employee', null, null, null, jsonb_build_object('employeeKey', p_employee_key));
  return jsonb_build_object('employeeKey', p_employee_key, 'dateOfBirth', p_date_of_birth, 'joiningDate', p_joining_date);
end $$;
revoke all on function public.hr_set_employee_dates(text, date, date) from public, anon;
grant execute on function public.hr_set_employee_dates(text, date, date) to authenticated;

notify pgrst, 'reload schema';
