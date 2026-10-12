-- Platform approvals (1 of 3): approval policies as a governed Watchtower library, the approval-role vocabulary, and the
-- policy lookup every module uses.
--   * approval_policies (Watchtower, maker-checker) documents every approval point on the platform: what is approved,
--     who may approve (approver_role), optional value threshold, client and market scope, maker-checker, whether the
--     client must also approve, and the SLA used to flag overdue items in the approvals inbox.
--   * approval_policy_for(type, client, market, value) returns the most specific active policy (client > market > value),
--     effective-dated through library_effective().
--   * approval_has_role(role) maps the policy vocabulary onto the roles that exist today (is_admin, srt_role,
--     sourcing_user_access, module_owners). Client approvals use client_users (my_client_role), never this helper.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('approval_policies', 'watchtower', 'Approval policies',
   'Who approves what across every module: approver role, value threshold, client and market scope, maker-checker, client approval and the SLA used to flag overdue approvals.',
   true, 7)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Approval roles. One vocabulary, mapped onto the roles that exist in the platform.
-- ---------------------------------------------------------------------------
create or replace function public.approval_user_has_role(p_user uuid, p_role text, p_module text default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; a public.sourcing_user_access;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or not (p.is_admin or p.user_type = 'internal') then return false; end if;
  select * into a from public.sourcing_user_access where user_id = p_user;
  return case coalesce(p_role, 'internal')
    when 'internal' then true
    when 'named_person' then true                       -- the function checks the named person itself
    when 'admin' then p.is_admin
    when 'srt_agent' then p.is_admin or coalesce(p.srt_role, '') in ('agent','lead')
    when 'srt_lead' then p.is_admin or p.srt_role = 'lead'
    when 'finance' then p.is_admin or p.srt_role = 'finance' or coalesce(a.is_finance, false)
    when 'procurement' then p.is_admin or coalesce(p.srt_role, '') in ('procurement','head')
    when 'procurement_head' then p.is_admin or p.srt_role = 'head'
    when 'sourcing_lead' then p.is_admin or coalesce(a.is_lead, false)
    when 'doa' then a.doa_level is not null              -- delegated authority is never implied by admin
    when 'module_owner' then p.is_admin or exists (select 1 from public.module_owners mo where mo.user_id = p_user and (p_module is null or mo.module = p_module))
    when 'briefing_lead' then p.is_admin or coalesce(a.is_lead, false) or coalesce(p.srt_role, '') in ('lead','head')
                              or exists (select 1 from public.module_owners mo where mo.user_id = p_user and mo.module = 'briefing')
    else false                                           -- client_approver / vendor are external roles
  end;
end $$;

create or replace function public.approval_has_role(p_role text, p_module text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select public.approval_user_has_role(auth.uid(), p_role, p_module);
$$;

create or replace function public.approval_role_label(p_role text) returns text
language sql immutable as $$
  select case p_role
    when 'admin' then 'Admin' when 'internal' then 'Anyone at adm Indicia' when 'named_person' then 'The named person'
    when 'srt_agent' then 'SRT agent or lead' when 'srt_lead' then 'SRT lead' when 'finance' then 'Finance'
    when 'procurement' then 'Procurement or Procurement head' when 'procurement_head' then 'Procurement head'
    when 'sourcing_lead' then 'Sourcing lead' when 'doa' then 'Delegated authority (DOA level)' when 'module_owner' then 'Admin or module owner'
    when 'briefing_lead' then 'Briefing lead (sourcing lead, SRT lead, Procurement head or Briefing+ owner)'
    when 'client_approver' then 'Client approver (Client Portal)' when 'vendor' then 'The vendor (vendor portal)'
    else coalesce(p_role, 'Not set') end;
$$;

-- ---------------------------------------------------------------------------
-- Policy lookup
-- ---------------------------------------------------------------------------
create or replace function public._approval_policy(p_type text, p_client uuid, p_market text, p_value numeric)
returns table (record_id uuid, code text, version int, module text, approval_type text, name text, description text,
  approver_role text, min_value numeric, currency text, client_code text, market text, maker_checker boolean,
  client_approval_required boolean, sla_days int)
language sql stable security definer set search_path = public as $$
  with codes as (
    select distinct lr.code from public.library_records lr
     where lr.library_key = 'approval_policies' and lr.code is not null and upper(lr.data->>'approval_type') = upper(p_type)
  ), eff as (
    select e.* from codes c cross join lateral public.library_effective('approval_policies', c.code, current_date) e
     where e.id is not null and upper(e.data->>'approval_type') = upper(p_type)
  )
  select e.id, e.code, e.version, e.data->>'module', upper(e.data->>'approval_type'), e.name, e.data->>'description',
         nullif(e.data->>'approver_role', ''), nullif(e.data->>'min_value', '')::numeric, nullif(e.data->>'currency', ''),
         nullif(trim(e.data->>'client_code'), ''), nullif(upper(trim(e.data->>'market')), ''),
         coalesce((e.data->>'maker_checker')::boolean, true), coalesce((e.data->>'client_approval_required')::boolean, false),
         nullif(e.data->>'sla_days', '')::int
    from eff e
   where (nullif(trim(e.data->>'client_code'), '') is null
          or exists (select 1 from public.sourcing_clients sc where sc.id = p_client and lower(sc.code) = lower(trim(e.data->>'client_code'))))
     and (nullif(trim(e.data->>'market'), '') is null or upper(trim(e.data->>'market')) = upper(trim(coalesce(p_market, ''))))
     and (nullif(e.data->>'min_value', '') is null or (p_value is not null and p_value >= (e.data->>'min_value')::numeric))
   order by (nullif(trim(e.data->>'client_code'), '') is not null) desc, (nullif(trim(e.data->>'market'), '') is not null) desc,
            nullif(e.data->>'min_value', '')::numeric desc nulls last, e.code
   limit 1;
$$;

-- Public lookup (internal staff only; policies are internal).
create or replace function public.approval_policy_for(p_type text, p_client uuid default null, p_market text default null, p_value numeric default null)
returns table (record_id uuid, code text, version int, module text, approval_type text, name text, description text,
  approver_role text, min_value numeric, currency text, client_code text, market text, maker_checker boolean,
  client_approval_required boolean, sla_days int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Approval policies are for adm Indicia staff' using errcode = '42501'; end if;
  return query select * from public._approval_policy(p_type, p_client, p_market, p_value);
end $$;

-- 'overdue' when the item is older than the policy's SLA, else 'pending'.
create or replace function public.approval_status(p_type text, p_requested_at timestamptz, p_market text default null, p_value numeric default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  select p.sla_days into v from public._approval_policy(p_type, null, p_market, p_value) p;
  return case when v is not null and p_requested_at is not null and p_requested_at < now() - make_interval(days => v) then 'overdue' else 'pending' end;
end $$;

-- "Who approves" text for the inbox: the policy when there is one, else the module's built-in rule.
create or replace function public.approval_rule(p_type text, p_client uuid, p_market text, p_value numeric, p_default text)
returns text language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  select * into p from public._approval_policy(p_type, p_client, p_market, p_value);
  if p.record_id is null or p.approver_role is null then return p_default; end if;
  return public.approval_role_label(p.approver_role) || case when p.maker_checker then ' · not the requester' else '' end || ' (' || p.code || ')';
end $$;

-- Tell the people who hold an approval role (admins only when nobody else holds it).
create or replace function public._approval_notify(p_role text, p_scope_module text, p_module text, p_title text, p_body text, p_href text, p_exclude uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.notifications (user_id, module, title, body, href)
  select p.id, p_module, p_title, p_body, p_href from public.profiles p
   where not p.is_admin and p.id is distinct from p_exclude and public.approval_user_has_role(p.id, p_role, p_scope_module);
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.notifications (user_id, module, title, body, href)
    select p.id, p_module, p_title, p_body, p_href from public.profiles p where p.is_admin and p.id is distinct from p_exclude;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

revoke execute on function public.approval_user_has_role(uuid, text, text), public._approval_policy(text, uuid, text, numeric),
  public._approval_notify(text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.approval_policy_for(text, uuid, text, numeric), public.approval_status(text, timestamptz, text, numeric),
  public.approval_rule(text, uuid, text, numeric, text), public.approval_has_role(text, text) from public, anon;
grant execute on function public.approval_policy_for(text, uuid, text, numeric), public.approval_status(text, timestamptz, text, numeric),
  public.approval_rule(text, uuid, text, numeric, text), public.approval_has_role(text, text), public.approval_role_label(text) to authenticated;
