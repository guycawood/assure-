-- Division role hierarchy. Each division (starting with SRM) has its own levels, and each level has a set of capabilities that decide
-- what it can see and do. Every level sees all clients; the levels differ by type of data and by rights, not by client.
-- SRM / procurement and supply chain: CPO, Regional Procurement Director, Procurement Manager, Supply Chain Manager, SRT.
--
-- A person's level is an assignment made in that division's Watchtower. People with no assignment keep working under the older
-- profile roles (agent, lead, finance, procurement, head, director), so nothing changes for them until they are assigned.
-- An assignment always wins over the older role, in both directions.

create table public.division_capabilities (
  key text primary key,
  label text not null,
  description text not null,
  sort int not null default 0
);
insert into public.division_capabilities (key, label, description, sort) values
  ('vendor_performance',    'See vendor performance',           'Scores, issues, reviews and quality results for every vendor.', 10),
  ('vendor_payment_status', 'See vendor payment status',        'Where each vendor is on the way to being paid, and when. No amounts.', 20),
  ('see_money',             'See order values and amounts',     'Order values, invoice amounts, spend and commercial terms.', 30),
  ('approve_exceptions',    'Approve exceptions',               'Approve routes and exceptions within their limit.', 40),
  ('approve_regional',      'Approve above manager limits',     'Approvals above manager limits for the region.', 50),
  ('strategic_tools',       'Strategic tools and scenarios',    'Scenario modelling, strategic sourcing and strategic vendor management.', 60),
  ('manage_users',          'Manage users and roles',           'Assign roles in this division, below their own level.', 70),
  ('manage_libraries',      'Manage libraries and methodologies', 'Change the division''s libraries, methodologies and taxonomies.', 80);

create table public.division_roles (
  module text not null,
  key text not null,
  label text not null,
  rank int not null check (rank between 1 and 20),      -- 1 is the most senior
  description text,
  capabilities text[] not null default '{}',
  primary key (module, key)
);
insert into public.division_roles (module, key, label, rank, description, capabilities) values
  ('assure', 'cpo', 'CPO (Chief Procurement Officer)', 1, 'Owns procurement and supply chain. Sees everything, sets policy, libraries and methodologies, top-level approvals.',
    '{vendor_performance,vendor_payment_status,see_money,approve_exceptions,approve_regional,strategic_tools,manage_users,manage_libraries}'),
  ('assure', 'regional_procurement_director', 'Regional Procurement Director', 2, 'Runs a region. Sees everything with the region in focus, approves above manager limits, runs regional strategy.',
    '{vendor_performance,vendor_payment_status,see_money,approve_exceptions,approve_regional,strategic_tools,manage_users}'),
  ('assure', 'procurement_manager', 'Procurement Manager', 3, 'Manages a team of buyers. Jobs, prices, RFQs, awards and rate cards. Approves exceptions within their limit.',
    '{vendor_performance,vendor_payment_status,see_money,approve_exceptions}'),
  ('assure', 'supply_chain_manager', 'Supply Chain Manager', 4, 'Orders, production, delivery, QA/QC and the vendors involved. Manages delays and quality issues.',
    '{vendor_performance,vendor_payment_status,see_money}'),
  ('assure', 'srt', 'SRT (Supplier Relationship Team)', 5, 'Onboards and manages vendors. Sees vendor performance and payment status only, never job prices or amounts.',
    '{vendor_performance,vendor_payment_status}');

create table public.division_role_users (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module text not null,
  role_key text not null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, module),
  foreign key (module, role_key) references public.division_roles(module, key)
);
create table public.division_role_events (
  id bigint generated always as identity primary key,
  module text not null,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('assigned', 'changed', 'removed')),
  from_role text,
  to_role text,
  note text,
  actor uuid references public.profiles(id) on delete set null default auth.uid(),
  at timestamptz not null default now()
);
create index division_role_events_idx on public.division_role_events (module, at desc);

alter table public.division_capabilities enable row level security;
alter table public.division_roles enable row level security;
alter table public.division_role_users enable row level security;
alter table public.division_role_events enable row level security;
create policy dc_read on public.division_capabilities for select to authenticated using (public.is_internal());
create policy dr_read on public.division_roles for select to authenticated using (public.is_internal());
create policy dru_read on public.division_role_users for select to authenticated using (public.is_internal());
create policy dre_read on public.division_role_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.division_capabilities, public.division_roles, public.division_role_users, public.division_role_events from authenticated, anon;

-- The assigned role key of a person in a division, or null.
create or replace function public._division_role_key(p_user uuid, p_module text) returns text
language sql stable security definer set search_path = public as $$
  select role_key from public.division_role_users where user_id = p_user and module = p_module;
$$;

-- Can the signed-in person do or see this in this division? Admins always can. An assignment decides when there is one;
-- otherwise the older profile roles decide, exactly as before.
create or replace function public.division_can(p_module text, p_capability text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_key text; v_caps text[]; v_legacy text;
begin
  if public.is_admin() then return true; end if;
  if not public.is_internal() then return false; end if;
  v_key := public._division_role_key(auth.uid(), p_module);
  if v_key is not null then
    select capabilities into v_caps from public.division_roles where module = p_module and key = v_key;
    return coalesce(p_capability = any (v_caps), false);
  end if;
  v_legacy := coalesce(public.my_srt_role(), '');
  return case p_capability
    when 'vendor_performance' then true
    when 'vendor_payment_status' then true
    when 'see_money' then v_legacy in ('lead', 'finance', 'procurement', 'head', 'director')
                          or coalesce((select is_lead or is_finance from public.sourcing_user_access where user_id = auth.uid()), false)
    when 'approve_exceptions' then v_legacy in ('lead', 'procurement', 'head', 'director')
    when 'approve_regional' then v_legacy in ('head', 'director')
    when 'strategic_tools' then v_legacy in ('head', 'director')
    when 'manage_users' then public.can_govern(p_module)
    when 'manage_libraries' then public.can_govern(p_module)
    else false end;
end $$;
revoke execute on function public._division_role_key(uuid, text) from public, anon, authenticated;
revoke execute on function public.division_can(text, text) from public, anon;
grant execute on function public.division_can(text, text) to authenticated;

-- Assign (or change) a person's level. The person doing it needs admin, module owner or the manage-users capability, and cannot give a
-- level more senior than their own. Everything is recorded.
create or replace function public.division_role_assign(p_user uuid, p_module text, p_role text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_target public.division_roles; v_mine text; v_my_rank int; v_old text;
begin
  if not public.is_internal() then raise exception 'Only staff can manage roles' using errcode = '42501'; end if;
  if not (public.can_govern(p_module) or public.division_can(p_module, 'manage_users')) then
    raise exception 'You can''t manage users in this division' using errcode = '42501';
  end if;
  select * into v_target from public.division_roles where module = p_module and key = p_role;
  if v_target.key is null then raise exception 'Unknown role'; end if;
  if not exists (select 1 from public.profiles where id = p_user and (user_type = 'internal' or is_admin)) then raise exception 'Choose a member of staff'; end if;
  if not public.is_admin() and not public.can_govern(p_module) then
    v_mine := public._division_role_key(auth.uid(), p_module);
    select rank into v_my_rank from public.division_roles where module = p_module and key = v_mine;
    if v_my_rank is null or v_target.rank < v_my_rank then raise exception 'You can''t give a level more senior than your own' using errcode = '42501'; end if;
    if p_user = auth.uid() then raise exception 'You can''t change your own level' using errcode = '42501'; end if;
  end if;
  v_old := public._division_role_key(p_user, p_module);
  if v_old is not distinct from p_role then raise exception 'That person already has this level'; end if;
  insert into public.division_role_users (user_id, module, role_key, assigned_by) values (p_user, p_module, p_role, auth.uid())
  on conflict (user_id, module) do update set role_key = excluded.role_key, assigned_by = auth.uid(), assigned_at = now();
  insert into public.division_role_events (module, user_id, action, from_role, to_role, note)
  values (p_module, p_user, case when v_old is null then 'assigned' else 'changed' end, v_old, p_role, nullif(trim(p_note), ''));
  perform public.notify(p_user, p_module, 'Your role changed: ' || v_target.label, nullif(trim(p_note), ''), '/' || case p_module when 'assure' then 'assure' else p_module end);
end $$;

create or replace function public.division_role_remove(p_user uuid, p_module text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text; v_mine text; v_my_rank int; v_old_rank int;
begin
  if not public.is_internal() then raise exception 'Only staff can manage roles' using errcode = '42501'; end if;
  if not (public.can_govern(p_module) or public.division_can(p_module, 'manage_users')) then
    raise exception 'You can''t manage users in this division' using errcode = '42501';
  end if;
  v_old := public._division_role_key(p_user, p_module);
  if v_old is null then raise exception 'That person has no level to remove'; end if;
  if not public.is_admin() and not public.can_govern(p_module) then
    v_mine := public._division_role_key(auth.uid(), p_module);
    select rank into v_my_rank from public.division_roles where module = p_module and key = v_mine;
    select rank into v_old_rank from public.division_roles where module = p_module and key = v_old;
    if v_my_rank is null or v_old_rank < v_my_rank then raise exception 'You can''t change someone more senior than you' using errcode = '42501'; end if;
  end if;
  delete from public.division_role_users where user_id = p_user and module = p_module;
  insert into public.division_role_events (module, user_id, action, from_role, note) values (p_module, p_user, 'removed', v_old, nullif(trim(p_note), ''));
end $$;
revoke execute on function public.division_role_assign(uuid, text, text, text), public.division_role_remove(uuid, text, text) from public, anon;
grant execute on function public.division_role_assign(uuid, text, text, text), public.division_role_remove(uuid, text, text) to authenticated;

-- SRM's money rule now comes from the role levels.
create or replace function public._srm_can_see_money() returns boolean
language sql stable security definer set search_path = public as $$
  select public.division_can('assure', 'see_money');
$$;
