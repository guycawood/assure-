-- Assure+ internal SRM: Supplier 360 foundations.
--   * assure_activity: one append-only activity/audit trail for every Assure+ record (the supplier timeline).
--   * supplier_profiles: the internal-only commercial and classification side of a supplier (NTI, payment terms, risk).
--   * audited functions for the decision fields (supplier status, risk level).
-- Vendors never read anything in this file.

-- ---------------------------------------------------------------------------
-- Shared helpers for the Assure+ internal functions
-- ---------------------------------------------------------------------------
create or replace function public._assure_require_internal() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
end $$;

-- Vendor managers (SRT agents and leads), procurement (procurement and head) and admins.
create or replace function public.assure_is_vendor_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.my_srt_role(), '') in ('agent','lead');
$$;
create or replace function public.assure_is_procurement() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.my_srt_role(), '') in ('procurement','head');
$$;

-- Region and market are copied from the supplier onto every operational record when not given.
create or replace function public._assure_fill_region_market() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.supplier_id is not null and (new.region is null or new.market is null) then
    select coalesce(new.region, s.region), coalesce(new.market, s.market) into new.region, new.market
      from public.suppliers s where s.id = new.supplier_id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Activity trail (the supplier timeline). Written by the functions in every Assure+ migration,
-- in the same transaction as the change. Staff can add notes, calls, meetings and emails by hand.
-- ---------------------------------------------------------------------------
create table public.assure_activity (
  id bigint generated always as identity primary key,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  entity text not null,
  entity_id uuid,
  action text not null,
  from_status text,
  to_status text,
  title text,
  body text,
  kind text not null default 'event' check (kind in ('event','note','email','meeting','call')),
  actor uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index assure_activity_supplier_idx on public.assure_activity (supplier_id, created_at desc);
create index assure_activity_entity_idx on public.assure_activity (entity, entity_id);

alter table public.assure_activity enable row level security;
create policy aa_read on public.assure_activity for select to authenticated using (public.is_internal());
create policy aa_note on public.assure_activity for insert to authenticated
  with check (public.is_internal() and kind <> 'event' and entity = 'note' and actor = auth.uid()
              and nullif(trim(coalesce(title, '')), '') is not null);
revoke update, delete on public.assure_activity from authenticated, anon;

create or replace function public._assure_log(p_supplier uuid, p_entity text, p_entity_id uuid, p_action text,
  p_from text, p_to text, p_title text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into public.assure_activity (supplier_id, entity, entity_id, action, from_status, to_status, title, body, actor)
  values (p_supplier, p_entity, p_entity_id, p_action, p_from, p_to, p_title, p_body, auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Supplier profile: internal commercial + classification fields (1:1 with suppliers)
-- ---------------------------------------------------------------------------
create table public.supplier_profiles (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  legal_entity text,
  trading_name text,
  entity_type text check (entity_type in ('manufacturer','distributor','service_provider','raw_material','logistics')),
  sub_category text,
  vendor_code text,
  uen_number text,
  website text check (website is null or website ~* '^https?://'),
  address text,
  primary_contact_name text,
  contact_phone text,
  factory_count int check (factory_count is null or factory_count >= 0),
  payment_terms text not null default 'net_30'
    check (payment_terms in ('immediate','net_7','net_15','net_30','net_45','net_60','net_90','custom')),
  payment_terms_days int check (payment_terms_days is null or payment_terms_days between 0 and 365),
  nti_rate numeric(5,2) check (nti_rate is null or nti_rate between 0 and 100),
  annual_spend_forecast numeric(14,2) check (annual_spend_forecast is null or annual_spend_forecast >= 0),
  -- decision field: only via assure_set_risk_level()
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  risk_reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (payment_terms <> 'custom' or payment_terms_days is not null)
);

alter table public.supplier_profiles enable row level security;
create policy sp_read on public.supplier_profiles for select to authenticated using (public.is_internal());
create policy sp_insert on public.supplier_profiles for insert to authenticated with check (public.is_internal());
create policy sp_update on public.supplier_profiles for update to authenticated using (public.is_internal()) with check (public.is_internal());
revoke delete on public.supplier_profiles from authenticated, anon;

-- Guard + audit: risk can't be written directly; commercial term changes are logged.
create or replace function public._supplier_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('assure.system_write', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      new.risk_level := 'low'; new.risk_reason := null;
    else
      new.risk_level := old.risk_level; new.risk_reason := old.risk_reason;
    end if;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.payment_terms is distinct from old.payment_terms or new.payment_terms_days is distinct from old.payment_terms_days then
      perform public._assure_log(new.supplier_id, 'supplier', new.supplier_id, 'payment_terms_changed',
        old.payment_terms || coalesce(' (' || old.payment_terms_days || 'd)', ''),
        new.payment_terms || coalesce(' (' || new.payment_terms_days || 'd)', ''), 'Payment terms changed', null);
    end if;
    if new.nti_rate is distinct from old.nti_rate then
      perform public._assure_log(new.supplier_id, 'supplier', new.supplier_id, 'nti_changed',
        old.nti_rate::text, new.nti_rate::text, 'NTI rate changed', null);
    end if;
  end if;
  return new;
end $$;
create trigger supplier_profiles_guard before insert or update on public.supplier_profiles
  for each row execute function public._supplier_profile_guard();

-- Every supplier gets a profile row.
create or replace function public._supplier_profile_create() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.supplier_profiles (supplier_id) values (new.id) on conflict do nothing;
  return null;
end $$;
create trigger supplier_profile_create after insert on public.suppliers
  for each row execute function public._supplier_profile_create();
insert into public.supplier_profiles (supplier_id) select id from public.suppliers on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Decision functions
-- ---------------------------------------------------------------------------
create or replace function public.assure_set_risk_level(p_supplier uuid, p_level text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  perform public._assure_require_internal();
  if not (public.assure_is_vendor_manager() or public.assure_is_procurement()) then
    raise exception 'Only vendor managers, procurement or admins can set supplier risk' using errcode = '42501';
  end if;
  if p_level not in ('low','medium','high','critical') then raise exception 'Unknown risk level %', p_level; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Say why the risk level is changing'; end if;
  select risk_level into v_old from public.supplier_profiles where supplier_id = p_supplier for update;
  if not found then raise exception 'Supplier not found'; end if;
  perform set_config('assure.system_write', 'on', true);
  update public.supplier_profiles set risk_level = p_level, risk_reason = trim(p_reason) where supplier_id = p_supplier;
  perform set_config('assure.system_write', 'off', true);
  perform public._assure_log(p_supplier, 'supplier', p_supplier, 'risk_changed', v_old, p_level, 'Risk level changed', trim(p_reason));
end $$;

-- Status change for one or many suppliers, always with an audit row per supplier.
create or replace function public.assure_set_supplier_status(p_suppliers uuid[], p_status text, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  perform public._assure_require_internal();
  if not (public.is_admin() or coalesce(public.my_srt_role(), '') in ('lead','head')) then
    raise exception 'Only an SRT lead, the Procurement head or an admin can change supplier status' using errcode = '42501';
  end if;
  if p_status not in ('active','pending_approval','onboarding','under_review','suspended','offboarded','inactive') then
    raise exception 'Unknown status %', p_status;
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for the status change'; end if;
  for s in select id, status from public.suppliers where id = any(p_suppliers) for update loop
    if s.status is distinct from p_status then
      update public.suppliers set status = p_status where id = s.id;
      perform public._assure_log(s.id, 'supplier', s.id, 'status_changed', s.status, p_status, 'Supplier status changed', trim(p_reason));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke execute on function public._assure_require_internal(), public._assure_log(uuid, text, uuid, text, text, text, text, text),
  public._assure_fill_region_market() from public, anon, authenticated;
grant execute on function public.assure_is_vendor_manager(), public.assure_is_procurement(),
  public.assure_set_risk_level(uuid, text, text), public.assure_set_supplier_status(uuid[], text, text) to authenticated;
