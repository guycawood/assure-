-- Vendor-side roles (from the Vendor Sys G deck): company admin, profile manager, finance contact, performance lead, compliance / ESG.
-- They sit on top of the existing access level (admin / standard / viewer). A team member with no role chosen keeps full access at their level,
-- so nothing changes for existing teams. Once roles are chosen, the person can only act in those areas. A company admin does NOT get
-- financial access from that role: invoices need the finance contact role. The company's primary contact always keeps team management.

alter table public.supplier_team_members add column functional_roles text[] not null default '{}';
alter table public.supplier_team_members add constraint supplier_team_roles_valid
  check (functional_roles <@ array['company_admin','profile_manager','finance_contact','performance_lead','compliance_esg']);

create or replace function public.vendor_my_roles() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select t.functional_roles from public.supplier_team_members t
                    where t.supplier_id = p.supplier_id and t.status = 'active'
                      and (t.linked_user_id = p.id or lower(t.email) = lower(p.email))
                    order by cardinality(t.functional_roles) desc limit 1), '{}')
  from public.profiles p where p.id = auth.uid() and p.user_type = 'vendor' and p.supplier_id is not null;
$$;
revoke execute on function public.vendor_my_roles() from public, anon;
grant execute on function public.vendor_my_roles() to authenticated;

-- May the caller act in this area? Areas: team, profile, finance, performance, compliance.
create or replace function public.vendor_can(p_area text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_roles text[] := public.vendor_my_roles(); v_primary boolean;
begin
  if public.my_supplier_id() is null or public.is_internal() then return false; end if;
  select exists (select 1 from public.suppliers s join public.profiles p on lower(p.email) = lower(s.primary_contact_email)
                  where s.id = public.my_supplier_id() and p.id = auth.uid()) into v_primary;
  if p_area = 'team' and v_primary then return true; end if;
  if coalesce(cardinality(v_roles), 0) = 0 then return true; end if;               -- no role chosen: full access at their level
  return case p_area
    when 'team' then 'company_admin' = any (v_roles)
    when 'profile' then 'profile_manager' = any (v_roles) or 'company_admin' = any (v_roles)
    when 'finance' then 'finance_contact' = any (v_roles)
    when 'performance' then 'performance_lead' = any (v_roles)
    when 'compliance' then 'compliance_esg' = any (v_roles)
    else false end;
end $$;
revoke execute on function public.vendor_can(text) from public, anon;
grant execute on function public.vendor_can(text) to authenticated;

create or replace function public._vendor_require_area(p_area text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.vendor_can(p_area) then
    raise exception 'Your role in the company doesn''t cover this. Ask your company admin to add the % role to your account', case p_area
      when 'team' then 'company admin' when 'profile' then 'profile manager' when 'finance' then 'finance contact'
      when 'performance' then 'performance lead' else 'compliance / ESG' end using errcode = '42501';
  end if;
end $$;
revoke execute on function public._vendor_require_area(text) from public, anon, authenticated;

create or replace view public.vendor_team_members as
  select t.id, t.email, t.permission_level, t.status, t.created_at, p.full_name,
         (t.linked_user_id = auth.uid()) as is_me,
         (lower(t.email) = lower(coalesce(s.primary_contact_email, ''))) as is_primary_contact,
         t.functional_roles
    from public.supplier_team_members t
    join public.suppliers s on s.id = t.supplier_id
    left join public.profiles p on p.id = t.linked_user_id
   where t.supplier_id = public.my_supplier_id() and public.my_supplier_id() is not null and t.status <> 'removed';

create or replace view public.vendor_my_company as
  select s.id, s.supplier_code, s.name, s.market, s.region, s.category, s.status, s.onboarding_status, s.primary_contact_email,
         sp.legal_entity, sp.trading_name, sp.website, sp.address, sp.primary_contact_name, sp.contact_phone,
         sub.tier as subscription_tier, coalesce(sub.status, 'none') as subscription_status, sub.renewal_date as subscription_renewal,
         public.vendor_my_permission() as my_permission, public.vendor_my_roles() as my_roles
    from public.suppliers s
    left join public.supplier_profiles sp on sp.supplier_id = s.id
    left join public.supplier_subscriptions sub on sub.supplier_id = s.id
   where s.id = public.my_supplier_id() and public.my_supplier_id() is not null;

-- Who may set roles: team managers. Not on yourself, so nobody locks themselves out.
create or replace function public.vendor_team_set_roles(p_member uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('admin'); t public.supplier_team_members; v_roles text[] := coalesce(p_roles, '{}');
begin
  perform public._vendor_require_area('team');
  if not (v_roles <@ array['company_admin','profile_manager','finance_contact','performance_lead','compliance_esg']) then raise exception 'Choose from the five roles'; end if;
  select * into t from public.supplier_team_members where id = p_member for update;
  if t.id is null or t.supplier_id <> v_sup or t.status = 'removed' then raise exception 'Team member not found' using errcode = '42501'; end if;
  if t.linked_user_id = auth.uid() then raise exception 'You can''t change your own roles'; end if;
  update public.supplier_team_members set functional_roles = (select coalesce(array_agg(distinct r order by r), '{}') from unnest(v_roles) r) where id = p_member;
  perform public._assure_log(v_sup, 'team', p_member, 'roles_changed', array_to_string(t.functional_roles, ','), array_to_string(v_roles, ','), 'Vendor team roles changed', t.email);
end $$;
revoke execute on function public.vendor_team_set_roles(uuid, text[]) from public, anon;
grant execute on function public.vendor_team_set_roles(uuid, text[]) to authenticated;

-- Wrap the existing vendor functions so each checks the role area first.
alter function public.vendor_team_invite(text, text) rename to _vr_pre_vendor_team_invite;
alter function public.vendor_team_set_level(uuid, text) rename to _vr_pre_vendor_team_set_level;
alter function public.vendor_team_remove(uuid) rename to _vr_pre_vendor_team_remove;
alter function public.vendor_site_save(uuid, jsonb) rename to _vr_pre_vendor_site_save;
alter function public.vendor_site_set_default(uuid) rename to _vr_pre_vendor_site_set_default;
alter function public.vendor_site_archive(uuid) rename to _vr_pre_vendor_site_archive;
alter function public.finance_vendor_submit_invoice(uuid, text, date, numeric, numeric, text, uuid) rename to _vr_pre_finance_vendor_submit_invoice;
revoke execute on function public._vr_pre_vendor_team_invite(text, text), public._vr_pre_vendor_team_set_level(uuid, text), public._vr_pre_vendor_team_remove(uuid),
  public._vr_pre_vendor_site_save(uuid, jsonb), public._vr_pre_vendor_site_set_default(uuid), public._vr_pre_vendor_site_archive(uuid),
  public._vr_pre_finance_vendor_submit_invoice(uuid, text, date, numeric, numeric, text, uuid) from public, anon, authenticated;

create function public.vendor_team_invite(p_email text, p_level text) returns uuid
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require('admin'); perform public._vendor_require_area('team'); return public._vr_pre_vendor_team_invite(p_email, p_level); end $$;
create function public.vendor_team_set_level(p_member uuid, p_level text) returns void
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require('admin'); perform public._vendor_require_area('team'); perform public._vr_pre_vendor_team_set_level(p_member, p_level); end $$;
create function public.vendor_team_remove(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require('admin'); perform public._vendor_require_area('team'); perform public._vr_pre_vendor_team_remove(p_member); end $$;
create function public.vendor_site_save(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require('standard'); perform public._vendor_require_area('profile'); return public._vr_pre_vendor_site_save(p_id, p); end $$;
create function public.vendor_site_set_default(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require('standard'); perform public._vendor_require_area('profile'); perform public._vr_pre_vendor_site_set_default(p_id); end $$;
create function public.vendor_site_archive(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require('standard'); perform public._vendor_require_area('profile'); perform public._vr_pre_vendor_site_archive(p_id); end $$;
create function public.finance_vendor_submit_invoice(p_po uuid, p_number text, p_date date, p_net numeric, p_vat numeric, p_currency text, p_file_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require('standard'); perform public._vendor_require_area('finance'); return public._vr_pre_finance_vendor_submit_invoice(p_po, p_number, p_date, p_net, p_vat, p_currency, p_file_id); end $$;

revoke execute on function public.vendor_team_invite(text, text), public.vendor_team_set_level(uuid, text), public.vendor_team_remove(uuid),
  public.vendor_site_save(uuid, jsonb), public.vendor_site_set_default(uuid), public.vendor_site_archive(uuid),
  public.finance_vendor_submit_invoice(uuid, text, date, numeric, numeric, text, uuid) from public, anon;
grant execute on function public.vendor_team_invite(text, text), public.vendor_team_set_level(uuid, text), public.vendor_team_remove(uuid),
  public.vendor_site_save(uuid, jsonb), public.vendor_site_set_default(uuid), public.vendor_site_archive(uuid),
  public.finance_vendor_submit_invoice(uuid, text, date, numeric, numeric, text, uuid) to authenticated;
