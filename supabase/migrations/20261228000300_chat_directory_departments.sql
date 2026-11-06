-- =============================================================================
-- Company chat: the contact directory shows each person's designation and can be narrowed to one department (HR chat integration).
--
-- The HR Recruiter dashboard gains the existing company Chat page (no separate HR chat: the same chat_conversations, chat_members and
-- chat_messages, the same one DIRECT conversation per pair of people, the same rules in private.chat_may_message). HR Assistants and the HR Admin
-- Head already reach it from the HR department sidebar. This migration only improves the shared contact directory for everyone:
--   * 'designation': the designation recorded for the employee (employee_personal_details), else their position, else null;
--   * 'departmentId': so the screen can show and filter by department;
--   * p_department: return only the people of that department (a department and its Sales / Support side count as one), filtered here,
--     not in the browser.
-- What a person may see is unchanged: only ACTIVE people the caller may message (private.chat_may_message), never the caller, never an e-mail
-- or a phone number. Conversations stay readable only by their members.
--
-- Run after 20261228000200_leave_chain_by_requester.sql. Safe to run again (the old two-argument version is replaced by this one; callers that
-- pass only p_search / p_limit keep working).
-- =============================================================================

drop function if exists public.chat_directory(text, integer);
create or replace function public.chat_directory(p_search text default null, p_limit integer default 30, p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'label', private.chat_role_label(p.role), 'position', p.position,
                                         'designation', coalesce(nullif(btrim(e.designation), ''), nullif(btrim(p.position), '')),
                                         'department', d.name, 'departmentId', d.id, 'team', t.name) order by p.full_name)
      from (select * from public.profiles x where x.status = 'ACTIVE' and x.id <> me order by x.full_name limit 2000) p
      left join public.departments d on d.id = p.department_id
      left join public.teams t on t.id = p.team_id
      left join public.employee_personal_details e on e.profile_id = p.id
     where private.chat_may_message(me, p.id)
       and (p_department is null or private.base_department(p.department_id) = private.base_department(p_department))
       and (v_term is null or lower(p.full_name) like '%' || v_term || '%' or lower(coalesce(p."position", '')) like '%' || v_term || '%'
            or lower(coalesce(e.designation, '')) like '%' || v_term || '%'
            or lower(coalesce(d.name, '')) like '%' || v_term || '%' or lower(coalesce(t.name, '')) like '%' || v_term || '%')
     limit least(greatest(coalesce(p_limit, 30), 1), 100)), '[]'::jsonb);
end $$;
revoke all on function public.chat_directory(text, integer, uuid) from public, anon;
grant execute on function public.chat_directory(text, integer, uuid) to authenticated;

notify pgrst, 'reload schema';
