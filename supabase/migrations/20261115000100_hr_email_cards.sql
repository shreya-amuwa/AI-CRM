-- =============================================================================
-- HR e-mail automation, part 2 (safe to run again; nothing is deleted, no e-mail history is touched)
--   * the probation reminder e-mails now carry the employee's designation and reporting manager and how many days are left
--   * public.hr_email_cards(): live figures for the three automation cards on the HR dashboard (birthday, work anniversary,
--     employee confirmation reminders): sent, failed, waiting, the last e-mail and its outcome, the next occasion
-- There is no month-specific rule anywhere: every date is computed per employee from the records, in the company time zone.
-- =============================================================================

-- Designation of an employee: the HR record, else the CRM position, else the role.
create or replace function private.hr_designation(p_profile uuid, p_hr_record text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(h.designation), '') from public.hr_employees h where h.id = p_hr_record),
    (select nullif(btrim(p.position), '') from public.profiles p where p.id = p_profile),
    (select case p.role when 'DEPARTMENT_HEAD' then 'Department Head' when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end
       from public.profiles p where p.id = p_profile),
    'Not recorded')
$$;
revoke all on function private.hr_designation(uuid, text) from public, anon, authenticated;

-- Reporting manager: a member reports to the Team Lead of their team, a Team Lead (or a member without a lead) to the
-- Department Head of their department. Nobody is guessed: without either, "Not assigned".
create or replace function private.hr_reporting_manager(p_profile uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.full_name from public.profiles me
       join public.profiles m on m.team_id = me.team_id and m.role = 'TEAM_HEAD' and m.status = 'ACTIVE' and m.id <> me.id
      where me.id = p_profile and me.role = 'TEAM_MEMBER' and me.team_id is not null
      order by m.created_at limit 1),
    (select m.full_name from public.profiles me
       join public.profiles m on m.department_id = me.department_id and m.role = 'DEPARTMENT_HEAD' and m.status = 'ACTIVE' and m.id <> me.id
      where me.id = p_profile and me.department_id is not null
      order by m.created_at limit 1),
    'Not assigned')
$$;
revoke all on function private.hr_reporting_manager(uuid) from public, anon, authenticated;

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
                jsonb_build_object('employeeName', c.employee_name, 'probationEndDate', c.probation_end, 'daysLeft', c.probation_end - v_today),
                c.probation_end - 7, private.hr_nine_am(c.probation_end - 7));
      if v_new then v_reminders := v_reminders + 1; end if;
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_REMINDER_HR:' || c.id || ':' || r.email, 'PROBATION_REMINDER_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysLeft', c.probation_end - v_today,
                                     'designation', private.hr_designation(c.profile_id, c.hr_record_id),
                                     'reportingManager', private.hr_reporting_manager(c.profile_id)),
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
-- Live figures for the three automation cards (HR staff only)
-- ---------------------------------------------------------------------------
create or replace function public.hr_email_cards()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
  v_next_birthday jsonb;
  v_next_anniversary jsonb;
begin
  perform private.hr_require_staff();

  -- the next birthday / anniversary date within a year, and who has it
  select jsonb_build_object('date', x.g, 'names', (
           select jsonb_agg(y.full_name order by y.full_name) from (
             select m2.full_name from private.hr_mail_employees() m2
              where m2.is_active and m2.date_of_birth is not null
                and private.hr_occasion_date(m2.date_of_birth, extract(year from x.g)::int) = x.g limit 5) y))
    into v_next_birthday
    from (select dd.g from private.hr_mail_employees() m, generate_series(0, 366) n, lateral (select v_today + n as g) dd
           where m.is_active and m.date_of_birth is not null
             and private.hr_occasion_date(m.date_of_birth, extract(year from dd.g)::int) = dd.g
           order by dd.g limit 1) x;
  select jsonb_build_object('date', x.g, 'names', (
           select jsonb_agg(y.full_name order by y.full_name) from (
             select m2.full_name from private.hr_mail_employees() m2
              where m2.is_active and m2.joining_date is not null and extract(year from x.g) > extract(year from m2.joining_date)
                and private.hr_occasion_date(m2.joining_date, extract(year from x.g)::int) = x.g limit 5) y))
    into v_next_anniversary
    from (select dd.g from private.hr_mail_employees() m, generate_series(0, 366) n, lateral (select v_today + n as g) dd
           where m.is_active and m.joining_date is not null and extract(year from dd.g) > extract(year from m.joining_date)
             and private.hr_occasion_date(m.joining_date, extract(year from dd.g)::int) = dd.g
           order by dd.g limit 1) x;

  return jsonb_build_object(
    'today', v_today,
    'birthday', jsonb_build_object(
      'sent', (select count(*) from public.hr_email_events where kind = 'BIRTHDAY' and status = 'SENT'),
      'failed', (select count(*) from public.hr_email_events where kind = 'BIRTHDAY' and status = 'FAILED'),
      'waiting', (select count(*) from public.hr_email_events where kind = 'BIRTHDAY' and status in ('PENDING', 'SENDING', 'RETRY', 'DRY_RUN')),
      'last', (select jsonb_build_object('status', e.status, 'at', coalesce(e.sent_at, e.last_attempt_at, e.created_at), 'error', e.last_error, 'employee', e.payload ->> 'employeeName')
                 from public.hr_email_events e where e.kind = 'BIRTHDAY' order by coalesce(e.sent_at, e.last_attempt_at, e.created_at) desc limit 1),
      'next', v_next_birthday),
    'anniversary', jsonb_build_object(
      'sent', (select count(*) from public.hr_email_events where kind = 'ANNIVERSARY' and status = 'SENT'),
      'failed', (select count(*) from public.hr_email_events where kind = 'ANNIVERSARY' and status = 'FAILED'),
      'waiting', (select count(*) from public.hr_email_events where kind = 'ANNIVERSARY' and status in ('PENDING', 'SENDING', 'RETRY', 'DRY_RUN')),
      'last', (select jsonb_build_object('status', e.status, 'at', coalesce(e.sent_at, e.last_attempt_at, e.created_at), 'error', e.last_error, 'employee', e.payload ->> 'employeeName')
                 from public.hr_email_events e where e.kind = 'ANNIVERSARY' order by coalesce(e.sent_at, e.last_attempt_at, e.created_at) desc limit 1),
      'next', v_next_anniversary),
    'confirmation', jsonb_build_object(
      'sent', (select count(*) from public.hr_email_events where kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR') and status = 'SENT'),
      'failed', (select count(*) from public.hr_email_events where kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR') and status = 'FAILED'),
      'waiting', (select count(*) from public.hr_email_events where kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR') and status in ('PENDING', 'SENDING', 'RETRY', 'DRY_RUN')),
      'last', (select jsonb_build_object('status', e.status, 'at', coalesce(e.sent_at, e.last_attempt_at, e.created_at), 'error', e.last_error, 'employee', e.payload ->> 'employeeName')
                 from public.hr_email_events e where e.kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR')
                order by coalesce(e.sent_at, e.last_attempt_at, e.created_at) desc limit 1),
      -- each pending confirmation with the day its reminder goes out (seven days before the six-month date), soonest first
      'upcoming', coalesce((select jsonb_agg(jsonb_build_object('name', u.employee_name, 'department', u.department_name, 'joiningDate', u.joining_date,
                                                              'confirmationDate', u.probation_end, 'reminderDate', u.probation_end - 7,
                                                              'reminderSent', exists (select 1 from public.hr_email_events e where e.cycle_id = u.id and e.kind = 'PROBATION_REMINDER_EMPLOYEE' and e.status = 'SENT'))
                                         order by u.probation_end)
                              from (select * from public.hr_probation_cycles pc where pc.status = 'PENDING' and pc.probation_end >= v_today
                                     order by pc.probation_end limit 10) u), '[]'::jsonb)));
end $$;
revoke all on function public.hr_email_cards() from public, anon;
grant execute on function public.hr_email_cards() to authenticated;

notify pgrst, 'reload schema';
