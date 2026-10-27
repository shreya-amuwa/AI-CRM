-- =============================================================================
-- Telecaller Sheets and Service Prices belong to the SALES side.
--
-- Until now any Department Head (Support included) and any Team Head could open the contact sheets of their department and the price list, and the
-- price list could be read straight from the table by every signed-in user. From now on:
--   * Super Admin: as before.
--   * Department Head: only while working on the Sales side, or a head of a whole department that has no side set. A Support Department Head (or a
--     shared / combined head while the Support function is active) is refused. HR and Accounts heads have no Sales section.
--   * Team Head: only of a Sales team. A Support Team Lead is refused.
--   * Telecallers read and work their own sheets, and Business Associates (and Sales members who work as one) read the price list to quote from it, as before.
--   * The price list can no longer be read from the table by everyone: the table policy follows the same rule as the function.
-- Nothing is deleted or changed: sheets, assignments and prices stay exactly as they are. Re-runnable.
-- =============================================================================

create or replace function private.in_sales_section()
returns boolean language sql stable security definer set search_path = '' as $$
  select case private.my_role()
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then not private.is_support_head()
                                and coalesce((select d.slug from public.departments d where d.id = private.my_department_id()), '') not in ('hr', 'accounts')
    when 'TEAM_HEAD' then exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id where p.id = private.my_id() and t.division = 'SALES')
    else false
  end
$$;
revoke all on function private.in_sales_section() from public, anon;
grant execute on function private.in_sales_section() to authenticated, service_role;

-- Who may read the price list: Business Associates (to quote), and the Sales side's managers.
create or replace function private.can_read_service_prices()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_business_associate() or (private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') and private.in_sales_section())
$$;
revoke all on function private.can_read_service_prices() from public, anon;
grant execute on function private.can_read_service_prices() to authenticated, service_role;

-- Assigning contact sheets (and the original-file step, and the list of Telecallers to choose from): Sales side only.
create or replace function private.require_sheet_assigner()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') and private.in_sales_section()) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Sales Department Head can assign contact sheets.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_sheet_assigner() from public, anon;
grant execute on function private.require_sheet_assigner() to authenticated, service_role;

-- Reading sheets and their contacts (also through the table policies): the Telecaller their own, and the Sales side's managers.
create or replace function private.telecaller_can_read(p_assignee uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_assignee = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and p_department = private.my_department_id() and private.in_sales_section())
      or (private.my_role() = 'TEAM_HEAD' and p_team is not null and p_team = private.my_team_id() and private.in_sales_section())
$$;
revoke all on function private.telecaller_can_read(uuid, uuid, uuid) from public, anon;
grant execute on function private.telecaller_can_read(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.telecaller_lists(p_assignee uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_telecaller() or (private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') and private.in_sales_section())) then
    raise exception 'FORBIDDEN: You cannot open contact sheets.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'fileName', l.file_name, 'note', l.note, 'assignedAt', l.created_at, 'hasSourceFile', l.source_stored_at is not null,
      'assignedBy', (select b.full_name from public.profiles b where b.id = l.assigned_by), 'assignedTo', (select t.full_name from public.profiles t where t.id = l.assigned_to), 'assigneeId', l.assigned_to,
      'total', l.total_contacts,
      'pending', (select count(*) from public.telecaller_contacts c where c.list_id = l.id and c.call_status = 'PENDING'),
      'called', (select count(*) from public.telecaller_contacts c where c.list_id = l.id and c.call_status <> 'PENDING'),
      'followUps', (select count(*) from public.telecaller_contacts c where c.list_id = l.id and c.call_status = 'FOLLOW_UP_REQUIRED')) order by l.created_at desc)
    from public.telecaller_contact_lists l
   where private.telecaller_can_read(l.assigned_to, l.department_id, l.team_id) and (p_assignee is null or l.assigned_to = p_assignee)), '[]'::jsonb);
end $$;

create or replace function public.service_prices_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_read_service_prices() then
    raise exception 'FORBIDDEN: You cannot open the price list.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('serviceCode', s.code, 'name', s.name, 'category', s.category,
            'unitLabel', p.unit_label, 'unitPrice', p.unit_price, 'gstRate', p.gst_rate, 'maxDiscountPct', p.max_discount_pct, 'isActive', coalesce(p.is_active, false),
            'priced', p.service_code is not null) order by s.sort_order, s.name)
          from public.crm_services s left join public.service_prices p on p.service_code = s.code where s.is_active), '[]'::jsonb);
end $$;

create or replace function public.service_price_save(p_code text, p_unit_label text, p_unit_price numeric, p_gst_rate numeric, p_max_discount numeric, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') and private.in_sales_section()) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Sales Department Head can change the price list.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_services where code = p_code and is_active) then raise exception 'VALIDATION_ERROR: Unknown service.' using errcode = 'P0001'; end if;
  if p_unit_price is null or p_unit_price < 0 or p_unit_price > 1000000000 then raise exception 'VALIDATION_ERROR: Enter the unit price.' using errcode = 'P0001'; end if;
  if p_gst_rate is null or p_gst_rate < 0 or p_gst_rate > 100 then raise exception 'VALIDATION_ERROR: Enter the GST rate (0 to 100).' using errcode = 'P0001'; end if;
  if p_max_discount is null or p_max_discount < 0 or p_max_discount > 100 then raise exception 'VALIDATION_ERROR: Enter the largest discount allowed (0 to 100 %%).' using errcode = 'P0001'; end if;
  insert into public.service_prices (service_code, unit_label, unit_price, gst_rate, max_discount_pct, is_active, updated_by, updated_at)
  values (p_code, coalesce(nullif(btrim(p_unit_label), ''), 'one time'), round(p_unit_price, 2), round(p_gst_rate, 2), round(p_max_discount, 2), coalesce(p_active, true), private.my_id(), now())
  on conflict (service_code) do update set unit_label = excluded.unit_label, unit_price = excluded.unit_price, gst_rate = excluded.gst_rate,
    max_discount_pct = excluded.max_discount_pct, is_active = excluded.is_active, updated_by = excluded.updated_by, updated_at = now();
  perform private.write_audit('SERVICE_PRICE_SAVED', 'service_price', null, private.my_department_id(), null, jsonb_build_object('service', p_code, 'unitPrice', round(p_unit_price, 2), 'gstRate', p_gst_rate, 'maxDiscountPct', p_max_discount));
  return jsonb_build_object('serviceCode', p_code, 'unitPrice', round(p_unit_price, 2));
end $$;

-- The table itself: the same rule (before, every signed-in user could read every price).
drop policy if exists service_prices_select on public.service_prices;
create policy service_prices_select on public.service_prices for select to authenticated using (private.can_read_service_prices());

notify pgrst, 'reload schema';
