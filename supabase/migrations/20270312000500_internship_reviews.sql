-- =============================================================================
-- HR dashboard upgrade, Phase 4: internship reviews (docs/hr-dashboard-upgrade.md).
--
-- Reuses the confirmation review engine of 20270312000100 (the same cycle table, evaluations, reviewer assignment, T-10 / T-4 reminders,
-- extensions, on hold and the final decision). This migration only adds what is specific to an internship:
--  * Opening: every active employee whose HR status is "Intern" gets ONE internship cycle (cycle_type INTERNSHIP) from the joining date. The length is
--    the employee's own `hr_employees.data.internshipMonths` (1 to 12) when HR recorded one, else the crm_settings key `hr.internship_months`
--    (default 3 months). The existing unique key (employee, start date) means no second cycle for the same period.
--  * Outcomes (private.rv_internship_outcome, called by hr_review_decide):
--      COMPLETE -> status COMPLETED. Nothing on the account changes; any exit follows the offboarding process.
--      CONVERT  -> status CONVERTED. The SAME employee record (same id, history and reports) becomes "Training / Probation", and a full-time
--                  probation cycle starts on the full-time effective date (default: the day after the internship ends) for the chosen length
--                  (default 6 months, the company policy). Nobody is confirmed by this, and paid leave is untouched: it starts only after an APPROVED
--                  probation, which an internship never reaches.
--    Extend, Not continued and On hold are already handled by hr_review_decide.
-- Additive and safe to run twice. Run after 20270312000300_telecaller_performance.sql.
-- =============================================================================

insert into public.crm_settings (key, value, description)
values ('hr.internship_months', '3'::jsonb, 'Default internship length in months for the internship review (an employee''s own internshipMonths wins).')
on conflict (key) do nothing;

-- the internship length of one employee: their own HR record first, then the setting, then 3 months
create or replace function private.rv_internship_months(p_hr_record text)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when h.data ->> 'internshipMonths' ~ '^([1-9]|1[0-2])$' then (h.data ->> 'internshipMonths')::int end from public.hr_employees h where h.id = p_hr_record),
    (select case when s.value #>> '{}' ~ '^([1-9]|1[0-2])$' then (s.value #>> '{}')::int end from public.crm_settings s where s.key = 'hr.internship_months'),
    3)
$$;
revoke all on function private.rv_internship_months(text) from public, anon, authenticated;

-- Probation cycles exactly as before (20270312000100), plus the internship cycles of the active interns.
create or replace function private.rv_open_cycles(p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_end date;
  v_months integer;
  v_rows integer;
  v_n integer := 0;
begin
  for e in select * from private.hr_mail_employees() m
            where m.is_active and m.joining_date is not null and m.joining_date <= p_today and coalesce(m.hr_status, '') <> 'Intern' loop
    v_end := (e.joining_date + interval '6 months')::date;
    if coalesce(e.hr_status, '') = 'Training / Probation' or v_end >= p_today - 30 then
      insert into public.hr_probation_cycles (employee_key, profile_id, hr_record_id, employee_name, employee_email, employee_code,
                                              department_id, department_name, joining_date, probation_end, original_end, period_months, cycle_type,
                                              employment_type)
      values (e.employee_key, e.profile_id, e.hr_record_id, e.full_name, e.email, e.employee_code, e.department_id, e.department_name,
              e.joining_date, v_end, v_end, 6, 'PROBATION', coalesce(e.hr_status, 'Full-Time'))
      on conflict (employee_key, joining_date) do update
         set employee_name = excluded.employee_name, employee_email = excluded.employee_email, employee_code = excluded.employee_code,
             department_id = excluded.department_id, department_name = excluded.department_name, hr_record_id = excluded.hr_record_id, updated_at = now()
       where public.hr_probation_cycles.status = 'PENDING'
         and (public.hr_probation_cycles.employee_name, public.hr_probation_cycles.employee_email, public.hr_probation_cycles.employee_code,
              public.hr_probation_cycles.department_name) is distinct from (excluded.employee_name, excluded.employee_email, excluded.employee_code, excluded.department_name);
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
    end if;
  end loop;

  -- the interns: one internship cycle from the joining date (an intern's internship is always current, so no recency limit)
  for e in select * from private.hr_mail_employees() m
            where m.is_active and m.joining_date is not null and m.joining_date <= p_today and m.hr_status = 'Intern' loop
    v_months := private.rv_internship_months(e.hr_record_id);
    v_end := (e.joining_date + make_interval(months => v_months))::date;
    insert into public.hr_probation_cycles (employee_key, profile_id, hr_record_id, employee_name, employee_email, employee_code,
                                            department_id, department_name, joining_date, probation_end, original_end, period_months, cycle_type,
                                            employment_type)
    values (e.employee_key, e.profile_id, e.hr_record_id, e.full_name, e.email, e.employee_code, e.department_id, e.department_name,
            e.joining_date, v_end, v_end, v_months, 'INTERNSHIP', 'Intern')
    on conflict (employee_key, joining_date) do update
       set employee_name = excluded.employee_name, employee_email = excluded.employee_email, employee_code = excluded.employee_code,
           department_id = excluded.department_id, department_name = excluded.department_name, hr_record_id = excluded.hr_record_id, updated_at = now()
     where public.hr_probation_cycles.status = 'PENDING'
       and (public.hr_probation_cycles.employee_name, public.hr_probation_cycles.employee_email, public.hr_probation_cycles.employee_code,
            public.hr_probation_cycles.department_name) is distinct from (excluded.employee_name, excluded.employee_email, excluded.employee_code, excluded.department_name);
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end loop;
  return v_n;
end $$;
revoke all on function private.rv_open_cycles(date) from public, anon, authenticated;

-- COMPLETE / CONVERT of an internship (hr_review_decide has checked the caller, the status, the reports and the reason; the cycle is locked there).
-- p (CONVERT): { fullTimeEffectiveDate, probationMonths }
create or replace function private.rv_internship_outcome(p_cycle uuid, p_decision text, p jsonb, p_reason text, p_exceptional boolean)
returns public.hr_probation_cycles language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  v_eff date;
  v_months integer;
  v_end date;
  v_new uuid;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.cycle_type <> 'INTERNSHIP' or p_decision not in ('COMPLETE', 'CONVERT') then
    raise exception 'VALIDATION_ERROR: Choose a decision.' using errcode = 'P0001';
  end if;

  if p_decision = 'COMPLETE' then
    update public.hr_probation_cycles
       set status = 'COMPLETED', completed_on = least(c.probation_end, private.hr_today()), decision = 'COMPLETE', decision_reason = left(p_reason, 4000),
           decided_by = auth.uid(), decided_at = now(), decision_exceptional = p_exceptional, updated_at = now()
     where id = c.id returning * into c;
    perform private.rv_tell(c, 'Internship completed: ' || c.employee_name,
      'Recorded by HR. The account is not changed; any exit follows the employee offboarding process.');
    return c;
  end if;

  -- CONVERT
  v_eff := case when p ->> 'fullTimeEffectiveDate' ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'fullTimeEffectiveDate')::date else c.probation_end + 1 end;
  if v_eff <= c.joining_date or v_eff > private.hr_today() + 366 then
    raise exception 'VALIDATION_ERROR: The full-time effective date must be after the joining date and within a year from today.' using errcode = 'P0001';
  end if;
  v_months := case when coalesce(p ->> 'probationMonths', '') ~ '^([1-9]|1[0-2])$' then (p ->> 'probationMonths')::int else 6 end;
  v_end := (v_eff + make_interval(months => v_months))::date;
  if exists (select 1 from public.hr_probation_cycles x where x.employee_key = c.employee_key and x.joining_date = v_eff and x.id <> c.id) then
    raise exception 'CONFLICT: A review already starts on that date for this employee. Choose another full-time effective date.' using errcode = 'P0001';
  end if;

  update public.hr_probation_cycles
     set status = 'CONVERTED', completed_on = least(c.probation_end, v_eff - 1), decision = 'CONVERT', decision_reason = left(p_reason, 4000),
         decided_by = auth.uid(), decided_at = now(), decision_exceptional = p_exceptional, updated_at = now()
   where id = c.id returning * into c;

  -- the same HR record becomes a probationer (same id and history); nothing else on it changes
  update public.hr_employees h
     set status = 'Training / Probation',
         data = coalesce(h.data, '{}'::jsonb) || jsonb_build_object('convertedFromInternship', c.id, 'fullTimeEffectiveDate', v_eff),
         updated_at = now()
   where h.id = c.hr_record_id and coalesce(h.status, '') = 'Intern';

  -- the full-time probation review: its own cycle, linked to the internship (the planner never closes it as a "changed joining date")
  insert into public.hr_probation_cycles (employee_key, profile_id, hr_record_id, employee_name, employee_email, employee_code, department_id,
                                          department_name, joining_date, probation_end, original_end, period_months, cycle_type, employment_type,
                                          designation, converted_from)
  values (c.employee_key, c.profile_id, c.hr_record_id, c.employee_name, c.employee_email, c.employee_code, c.department_id, c.department_name,
          v_eff, v_end, v_end, v_months, 'PROBATION', 'Training / Probation', c.designation, c.id)
  returning id into v_new;

  perform private.write_audit('INTERNSHIP_CONVERTED', 'hr_review', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'fullTimeEffectiveDate', v_eff, 'probationMonths', v_months, 'probationCycle', v_new));
  perform private.rv_tell(c, 'Intern converted to full-time: ' || c.employee_name,
    'Full-time from ' || to_char(v_eff, 'DD Mon YYYY') || '. A probation review (' || v_months || ' months, until ' || to_char(v_end, 'DD Mon YYYY') || ') has been opened.');
  return c;
end $$;
revoke all on function private.rv_internship_outcome(uuid, text, jsonb, text, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
