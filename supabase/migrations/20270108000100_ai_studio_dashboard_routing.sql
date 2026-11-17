-- =============================================================================
-- AI Studio: the dashboard an employee opens follows their DEPARTMENT, for every role (head, Team Lead, Team Member).
--
-- Run after 20270107000100_ai_studio_members_without_team_lead.sql. Safe to run twice; no record is deleted and no other department's dashboard changes.
--
--   * private.ai_studio_department() found the department only by slug 'ai-studio'. It now finds it by slug first, else by the name "AI Studio" (a department that was
--     created by hand in the hub keeps working), so every AI Studio rule, the dashboard value below and the people lists agree on which department it is.
--   * private.tg_profiles_default_dashboard() decides ai-studio-head / -lead / -member from that department (previously a literal slug), before the Sales / Support
--     rules: a Team Lead of AI Studio never becomes 'sales-lead' or 'support-lead' whatever the division of the team is.
--   * Everybody already placed in AI Studio gets the value recomputed (a no-op for everybody else), so an account made before this migration is corrected.
-- =============================================================================

create or replace function private.ai_studio_department()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.departments where slug = 'ai-studio'),
    (select id from public.departments where lower(btrim(name)) = 'ai studio' order by created_at limit 1))
$$;
revoke all on function private.ai_studio_department() from public, anon;
grant execute on function private.ai_studio_department() to authenticated, service_role;

create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
  -- AI Studio is recognised by the department itself (private.ai_studio_department), never by a role name or a team division
  v_ai boolean := new.department_id is not null and new.department_id is not distinct from private.ai_studio_department();
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  if new.sales_sub_role is not null and (new.role is distinct from 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    new.sales_sub_role := null;
  end if;
  -- an HR designation belongs to a Team Member / Team Lead of the HR department and nobody else
  if new.hr_sub_role is not null and not (v_slug = 'hr' and new.role in ('TEAM_MEMBER', 'TEAM_HEAD')) then
    new.hr_sub_role := null;
  end if;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case
      when v_slug = 'hr' then 'hr-head'
      when v_ai then 'ai-studio-head'
      when new.head_division = 'SALES' and v_slug is distinct from 'accounts' then 'sales-department-head'
      else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_ai then 'ai-studio-lead'
      when v_slug = 'hr' and new.hr_sub_role = 'HR_RECRUITER' then 'hr-recruiter'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_ai then 'ai-studio-member'
      when v_slug = 'hr' and new.hr_sub_role = 'HR_RECRUITER' then 'hr-recruiter'
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' and coalesce(new.is_meta_verifier, false) then 'meta-verifier'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' and new.sales_sub_role = 'TELECALLER' then 'telecaller'
      when v_division = 'SALES' and new.sales_sub_role = 'BUSINESS_ASSOCIATE' then 'business-associate'
      when v_division = 'SALES' and new.sales_sub_role is not null then 'sales-' || lower(replace(new.sales_sub_role, '_', '-'))
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;

update public.profiles set updated_at = updated_at where department_id = private.ai_studio_department();

notify pgrst, 'reload schema';
