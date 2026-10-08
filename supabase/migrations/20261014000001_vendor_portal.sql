-- Supplier Engagement layer: the Assure+ vendor portal (/vendor) and the public vendor application (/apply).
-- Vendors engage at set points in the journey. Everything here follows the same rules as the rest of Assure+:
--   * a vendor's company always comes from my_supplier_id() (never from the client);
--   * vendors read only their own rows, through views that leave out internal fields;
--   * every vendor write goes through a security-definer function that checks the vendor's team permission
--     (admin / standard / viewer) and the current state, and writes an audit row in the same transaction;
--   * decision fields (subscription tier, supplier status, scores) are never writable by the vendor.
--
-- Team permission: the supplier's primary contact is always a portal admin. Other people get the level on
-- their active supplier_team_members row. A vendor account linked by staff without a team row is 'standard'.

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.vendor_my_permission() returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.user_type <> 'vendor' or p.supplier_id is null then null
    when exists (select 1 from public.suppliers s where s.id = p.supplier_id and lower(s.primary_contact_email) = lower(p.email)) then 'admin'
    else coalesce((select t.permission_level from public.supplier_team_members t
                    where t.supplier_id = p.supplier_id and t.status = 'active'
                      and (t.linked_user_id = p.id or lower(t.email) = lower(p.email))
                    order by case t.permission_level when 'admin' then 1 when 'standard' then 2 else 3 end limit 1), 'standard')
  end
  from public.profiles p where p.id = auth.uid();
$$;

-- Returns the caller's supplier when they may act at the given level ('viewer' | 'standard' | 'admin').
create or replace function public._vendor_require(p_min text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); v_perm text := public.vendor_my_permission();
begin
  if v_sup is null or v_perm is null or public.is_internal() then
    raise exception 'Only a vendor user can do this' using errcode = '42501';
  end if;
  if p_min = 'admin' and v_perm <> 'admin' then
    raise exception 'Only your company''s portal admins can do this' using errcode = '42501';
  end if;
  if p_min = 'standard' and v_perm = 'viewer' then
    raise exception 'Your account is view-only. Ask your portal admin for edit access' using errcode = '42501';
  end if;
  return v_sup;
end $$;

-- ---------------------------------------------------------------------------
-- Subscriptions (Silver / Gold / Platinum / Diamond). Internal-only decision; vendors request changes.
-- ---------------------------------------------------------------------------
create table public.supplier_subscriptions (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  tier text check (tier in ('silver','gold','platinum','diamond')),
  status text not null default 'none' check (status in ('none','pending','active','paused','cancelled','expired')),
  renewal_date date,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (status in ('none','cancelled') or tier is not null)
);
alter table public.supplier_subscriptions enable row level security;
create policy subs_read on public.supplier_subscriptions for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.supplier_subscriptions from authenticated, anon;

create table public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  current_tier text,
  requested_tier text not null check (requested_tier in ('silver','gold','platinum','diamond','cancel')),
  note text check (note is null or length(note) <= 1000),
  status text not null default 'open' check (status in ('open','actioned','declined','withdrawn')),
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index subscription_requests_one_open on public.subscription_requests (supplier_id) where status = 'open';
alter table public.subscription_requests enable row level security;
create policy subreq_read on public.subscription_requests for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
revoke insert, update, delete on public.subscription_requests from authenticated, anon;

-- Vendor (portal admin) asks for a different plan: creates an open request and tells procurement.
create or replace function public.vendor_request_subscription(p_tier text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('admin'); v_cur text; v_id uuid; v_name text;
begin
  if p_tier not in ('silver','gold','platinum','diamond','cancel') then raise exception 'Choose a plan'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'Keep the note under 1,000 characters'; end if;
  select tier into v_cur from public.supplier_subscriptions where supplier_id = v_sup;
  if v_cur is not distinct from p_tier then raise exception 'You are already on this plan'; end if;
  if exists (select 1 from public.subscription_requests where supplier_id = v_sup and status = 'open') then
    raise exception 'You already have a plan change request open. adm Indicia will be in touch.';
  end if;
  insert into public.subscription_requests (supplier_id, current_tier, requested_tier, note, requested_by)
  values (v_sup, v_cur, p_tier, nullif(trim(p_note), ''), auth.uid()) returning id into v_id;
  select name into v_name from public.suppliers where id = v_sup;
  perform public._assure_log(v_sup, 'subscription', v_id, 'change_requested', v_cur, p_tier, 'Vendor asked for a plan change', nullif(trim(p_note), ''));
  perform public.notify_role('procurement', 'assure', 'Plan change request: ' || v_name,
    format('%s asked to move from %s to %s.', v_name, coalesce(v_cur, 'no plan'), p_tier), '/assure/suppliers/' || v_sup);
  perform public.notify_role('head', 'assure', 'Plan change request: ' || v_name,
    format('%s asked to move from %s to %s.', v_name, coalesce(v_cur, 'no plan'), p_tier), '/assure/suppliers/' || v_sup);
  return v_id;
end $$;

-- Staff (procurement, Procurement head or admin) set the plan. The only write path to supplier_subscriptions.
create or replace function public.assure_set_subscription(p_supplier uuid, p_tier text, p_status text, p_renewal date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old public.supplier_subscriptions;
begin
  perform public._assure_require_internal();
  if not public.assure_is_procurement() then
    raise exception 'Only procurement, the Procurement head or an admin can change a vendor''s plan' using errcode = '42501';
  end if;
  if p_tier is not null and p_tier not in ('silver','gold','platinum','diamond') then raise exception 'Unknown plan %', p_tier; end if;
  if p_status not in ('none','pending','active','paused','cancelled','expired') then raise exception 'Unknown plan status %', p_status; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for the plan change'; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier) then raise exception 'Supplier not found'; end if;
  select * into v_old from public.supplier_subscriptions where supplier_id = p_supplier for update;
  insert into public.supplier_subscriptions (supplier_id, tier, status, renewal_date, updated_by, updated_at)
  values (p_supplier, p_tier, p_status, p_renewal, auth.uid(), now())
  on conflict (supplier_id) do update set tier = excluded.tier, status = excluded.status, renewal_date = excluded.renewal_date,
    updated_by = excluded.updated_by, updated_at = now();
  update public.subscription_requests set status = 'actioned', decided_by = auth.uid(), decided_at = now()
   where supplier_id = p_supplier and status = 'open';
  perform public._assure_log(p_supplier, 'subscription', p_supplier, 'plan_changed',
    coalesce(v_old.tier, 'none') || ' / ' || coalesce(v_old.status, 'none'), coalesce(p_tier, 'none') || ' / ' || p_status, 'Vendor plan changed', trim(p_reason));
  perform public.notify_supplier(p_supplier, 'assure', 'Your plan has been updated',
    format('Plan: %s (%s).', coalesce(initcap(p_tier), 'none'), p_status), '/vendor/subscription');
end $$;

create or replace function public.assure_decline_subscription_request(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.subscription_requests;
begin
  perform public._assure_require_internal();
  if not public.assure_is_procurement() then raise exception 'Only procurement can decline a plan request' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give the vendor a reason'; end if;
  select * into r from public.subscription_requests where id = p_id for update;
  if not found or r.status <> 'open' then raise exception 'This request is not open'; end if;
  update public.subscription_requests set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform public._assure_log(r.supplier_id, 'subscription', p_id, 'request_declined', 'open', 'declined', 'Plan change request declined', trim(p_reason));
  perform public.notify_supplier(r.supplier_id, 'assure', 'Plan change request', trim(p_reason), '/vendor/subscription');
end $$;

-- ---------------------------------------------------------------------------
-- The vendor's own company record (safe columns only)
-- ---------------------------------------------------------------------------
create view public.vendor_my_company as
  select s.id, s.supplier_code, s.name, s.market, s.region, s.category, s.status, s.onboarding_status, s.primary_contact_email,
         sp.legal_entity, sp.trading_name, sp.website, sp.address, sp.primary_contact_name, sp.contact_phone,
         sub.tier as subscription_tier, coalesce(sub.status, 'none') as subscription_status, sub.renewal_date as subscription_renewal,
         public.vendor_my_permission() as my_permission
    from public.suppliers s
    left join public.supplier_profiles sp on sp.supplier_id = s.id
    left join public.supplier_subscriptions sub on sub.supplier_id = s.id
   where s.id = public.my_supplier_id() and public.my_supplier_id() is not null;
revoke all on public.vendor_my_company from anon;
grant select on public.vendor_my_company to authenticated;

-- ---------------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------------
create view public.vendor_team_members as
  select t.id, t.email, t.permission_level, t.status, t.created_at, p.full_name,
         (t.linked_user_id = auth.uid()) as is_me,
         (lower(t.email) = lower(coalesce(s.primary_contact_email, ''))) as is_primary_contact
    from public.supplier_team_members t
    join public.suppliers s on s.id = t.supplier_id
    left join public.profiles p on p.id = t.linked_user_id
   where t.supplier_id = public.my_supplier_id() and public.my_supplier_id() is not null and t.status <> 'removed';
revoke all on public.vendor_team_members from anon;
grant select on public.vendor_team_members to authenticated;

-- Vendors no longer read the raw invitations table (it carries invited_by / linked user ids); they use the view.
drop policy team_read on public.supplier_team_members;
create policy team_read on public.supplier_team_members for select to authenticated using (public.is_internal());

create or replace function public.vendor_team_invite(p_email text, p_level text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sup uuid := public._vendor_require('admin');
  v_email text := lower(trim(coalesce(p_email, '')));
  v_internal boolean; v_prof public.profiles; v_id uuid; v_name text; v_row public.supplier_team_members;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'Enter a valid email address'; end if;
  if p_level not in ('admin','standard','viewer') then raise exception 'Choose admin, standard or viewer'; end if;
  select split_part(v_email, '@', 2) = any (select lower(d) from unnest(internal_email_domains) d) into v_internal from public.srt_settings where id;
  if coalesce(v_internal, false) then raise exception 'adm Indicia staff can''t be added to a vendor team'; end if;
  if exists (select 1 from public.supplier_team_members where lower(email) = v_email and supplier_id <> v_sup and status in ('pending','active')) then
    raise exception 'This person is already on another company''s portal team';
  end if;
  select * into v_prof from public.profiles where lower(email) = v_email limit 1;
  if v_prof.id is not null and (v_prof.user_type <> 'vendor' or (v_prof.supplier_id is not null and v_prof.supplier_id <> v_sup)) then
    raise exception 'This person is already on another company''s portal team';
  end if;
  select * into v_row from public.supplier_team_members where supplier_id = v_sup and lower(email) = v_email for update;
  if v_row.id is not null and v_row.status in ('pending','active') then raise exception 'This person is already on your team'; end if;

  if v_row.id is null then
    insert into public.supplier_team_members (supplier_id, email, permission_level, status, invited_by)
    values (v_sup, v_email, p_level, 'pending', auth.uid()) returning id into v_id;
  else
    update public.supplier_team_members set permission_level = p_level, status = 'pending', linked_user_id = null, invited_by = auth.uid()
     where id = v_row.id;
    v_id := v_row.id;
  end if;
  -- Someone who already has an unlinked vendor account is linked straight away; otherwise handle_new_user links them on first sign-in.
  if v_prof.id is not null then
    update public.profiles set supplier_id = v_sup where id = v_prof.id and supplier_id is null;
    update public.supplier_team_members set status = 'active', linked_user_id = v_prof.id where id = v_id;
  end if;
  select name into v_name from public.suppliers where id = v_sup;
  insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
  values (v_email, 'You have been added to the ' || v_name || ' vendor portal',
          format(E'Hello,\n\nYou have been added to the adm Indicia vendor portal for %s. Sign in with this email address to get started.\n\nadm Indicia Supplier Team', v_name),
          v_sup, auth.uid());
  perform public._assure_log(v_sup, 'team', v_id, 'invited', null, p_level, 'Vendor team member invited', v_email);
  return v_id;
end $$;

create or replace function public.vendor_team_set_level(p_member uuid, p_level text)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('admin'); t public.supplier_team_members; v_primary text;
begin
  if p_level not in ('admin','standard','viewer') then raise exception 'Choose admin, standard or viewer'; end if;
  select * into t from public.supplier_team_members where id = p_member for update;
  if t.id is null or t.supplier_id <> v_sup or t.status = 'removed' then raise exception 'Team member not found' using errcode = '42501'; end if;
  if t.linked_user_id = auth.uid() then raise exception 'You can''t change your own access'; end if;
  select lower(primary_contact_email) into v_primary from public.suppliers where id = v_sup;
  if lower(t.email) = v_primary then raise exception 'Your company''s primary contact is always a portal admin'; end if;
  update public.supplier_team_members set permission_level = p_level where id = p_member;
  perform public._assure_log(v_sup, 'team', p_member, 'access_changed', t.permission_level, p_level, 'Vendor team access changed', t.email);
end $$;

create or replace function public.vendor_team_remove(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('admin'); t public.supplier_team_members; v_primary text;
begin
  select * into t from public.supplier_team_members where id = p_member for update;
  if t.id is null or t.supplier_id <> v_sup or t.status = 'removed' then raise exception 'Team member not found' using errcode = '42501'; end if;
  if t.linked_user_id = auth.uid() then raise exception 'You can''t remove yourself'; end if;
  select lower(primary_contact_email) into v_primary from public.suppliers where id = v_sup;
  if lower(t.email) = v_primary then raise exception 'Your company''s primary contact can''t be removed here. Ask adm Indicia to change it.'; end if;
  update public.supplier_team_members set status = 'removed' where id = p_member;
  -- Access ends now: unlink the person's account from this company.
  update public.profiles set supplier_id = null
   where supplier_id = v_sup and user_type = 'vendor' and (id = t.linked_user_id or lower(email) = lower(t.email));
  perform public._assure_log(v_sup, 'team', p_member, 'removed', t.status, 'removed', 'Vendor team member removed', t.email);
end $$;

-- ---------------------------------------------------------------------------
-- Sites (dispatch and manufacturing locations). One default dispatch site per supplier, enforced here.
-- ---------------------------------------------------------------------------
create table public.supplier_sites (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  name text not null check (length(trim(name)) between 1 and 200),
  site_type text not null check (site_type in ('manufacturing','warehouse','distribution','office','subcontractor')),
  address_line1 text check (address_line1 is null or length(address_line1) <= 300),
  address_line2 text check (address_line2 is null or length(address_line2) <= 300),
  city text check (city is null or length(city) <= 120),
  postcode text check (postcode is null or length(postcode) <= 30),
  country_alpha2 text not null check (country_alpha2 ~ '^[A-Z]{2}$'),
  locode text check (locode is null or (locode ~ '^[A-Z]{2}[A-Z2-9]{3}$' and left(locode, 2) = country_alpha2)),
  latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  contact_name text check (contact_name is null or length(contact_name) <= 200),
  contact_phone text check (contact_phone is null or length(contact_phone) <= 50),
  is_default_dispatch boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_default_dispatch or active),
  check ((latitude is null) = (longitude is null))
);
create unique index supplier_sites_one_default on public.supplier_sites (supplier_id) where is_default_dispatch;
create index supplier_sites_supplier_idx on public.supplier_sites (supplier_id);
create trigger supplier_sites_region before insert on public.supplier_sites
  for each row execute function public._assure_fill_region_market();

alter table public.supplier_sites enable row level security;
create policy sites_read on public.supplier_sites for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
revoke insert, update, delete on public.supplier_sites from authenticated, anon;

-- p: {name, site_type, address_line1, address_line2, city, postcode, country_alpha2, locode, latitude, longitude,
--     contact_name, contact_phone, is_default_dispatch}
create or replace function public.vendor_site_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); v_id uuid; v_default boolean := coalesce((p->>'is_default_dispatch')::boolean, false);
        s public.supplier_sites;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Missing site details'; end if;
  if nullif(trim(coalesce(p->>'name', '')), '') is null then raise exception 'Give the site a name'; end if;
  if p_id is not null then
    select * into s from public.supplier_sites where id = p_id for update;
    if s.id is null or s.supplier_id <> v_sup then raise exception 'Site not found' using errcode = '42501'; end if;
    if not s.active then raise exception 'This site is archived'; end if;
  end if;
  if v_default then
    update public.supplier_sites set is_default_dispatch = false, updated_at = now()
     where supplier_id = v_sup and is_default_dispatch and id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.supplier_sites (supplier_id, name, site_type, address_line1, address_line2, city, postcode, country_alpha2, locode,
      latitude, longitude, contact_name, contact_phone, is_default_dispatch, created_by)
    values (v_sup, trim(p->>'name'), p->>'site_type', nullif(trim(p->>'address_line1'), ''), nullif(trim(p->>'address_line2'), ''),
      nullif(trim(p->>'city'), ''), nullif(trim(p->>'postcode'), ''), upper(trim(coalesce(p->>'country_alpha2', ''))),
      nullif(upper(replace(trim(coalesce(p->>'locode', '')), ' ', '')), ''),
      nullif(p->>'latitude', '')::numeric, nullif(p->>'longitude', '')::numeric,
      nullif(trim(p->>'contact_name'), ''), nullif(trim(p->>'contact_phone'), ''), v_default, auth.uid())
    returning id into v_id;
    perform public._assure_log(v_sup, 'site', v_id, 'added', null, p->>'site_type', 'Site added: ' || trim(p->>'name'), null);
  else
    update public.supplier_sites set name = trim(p->>'name'), site_type = p->>'site_type',
      address_line1 = nullif(trim(p->>'address_line1'), ''), address_line2 = nullif(trim(p->>'address_line2'), ''),
      city = nullif(trim(p->>'city'), ''), postcode = nullif(trim(p->>'postcode'), ''),
      country_alpha2 = upper(trim(coalesce(p->>'country_alpha2', ''))),
      locode = nullif(upper(replace(trim(coalesce(p->>'locode', '')), ' ', '')), ''),
      latitude = nullif(p->>'latitude', '')::numeric, longitude = nullif(p->>'longitude', '')::numeric,
      contact_name = nullif(trim(p->>'contact_name'), ''), contact_phone = nullif(trim(p->>'contact_phone'), ''),
      is_default_dispatch = v_default, updated_at = now()
     where id = p_id;
    v_id := p_id;
    perform public._assure_log(v_sup, 'site', v_id, 'updated', null, null, 'Site updated: ' || trim(p->>'name'), null);
  end if;
  return v_id;
end $$;

create or replace function public.vendor_site_set_default(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); s public.supplier_sites;
begin
  select * into s from public.supplier_sites where id = p_id for update;
  if s.id is null or s.supplier_id <> v_sup then raise exception 'Site not found' using errcode = '42501'; end if;
  if not s.active then raise exception 'An archived site can''t be the default dispatch site'; end if;
  update public.supplier_sites set is_default_dispatch = false, updated_at = now() where supplier_id = v_sup and is_default_dispatch and id <> p_id;
  update public.supplier_sites set is_default_dispatch = true, updated_at = now() where id = p_id;
  perform public._assure_log(v_sup, 'site', p_id, 'default_dispatch', null, null, 'Default dispatch site: ' || s.name, null);
end $$;

create or replace function public.vendor_site_archive(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); s public.supplier_sites;
begin
  select * into s from public.supplier_sites where id = p_id for update;
  if s.id is null or s.supplier_id <> v_sup then raise exception 'Site not found' using errcode = '42501'; end if;
  update public.supplier_sites set active = false, is_default_dispatch = false, updated_at = now() where id = p_id;
  perform public._assure_log(v_sup, 'site', p_id, 'archived', 'active', 'archived', 'Site archived: ' || s.name, null);
end $$;

-- ---------------------------------------------------------------------------
-- Orders: the control-document checklist and a safe purchase-order detail for the vendor
-- ---------------------------------------------------------------------------
create view public.vendor_order_document_types as
  select id, code, name, coalesce(data->'required_for_categories', '[]'::jsonb) as required_for_categories, data->>'uploaded_by' as uploaded_by
    from public.library_records
   where library_key = 'order_document_types' and status = 'active' and public.my_supplier_id() is not null;
revoke all on public.vendor_order_document_types from anon;
grant select on public.vendor_order_document_types to authenticated;

create or replace function public.vendor_po_detail(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.purchase_orders; j public.jobs; v_sup uuid := public.my_supplier_id();
begin
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null or v_sup is null or p.supplier_id <> v_sup or p.status not in ('issued','accepted','declined') or public.is_internal() then
    raise exception 'Purchase order not found' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = p.job_id;
  return jsonb_build_object(
    'id', p.id, 'po_number', p.po_number, 'job_number', j.job_number, 'title', j.title, 'category', j.category,
    'market', p.market, 'region', p.region, 'currency', p.currency, 'total_value', p.total_value,
    'po_date', p.po_date, 'delivery_date', p.delivery_date, 'status', p.status, 'issued_at', p.approved_at,
    'responded_at', p.vendor_responded_at, 'decline_reason', p.vendor_decline_reason, 'job_status', j.status,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('spec', s.title, 'spec_type', s.spec_type, 'quantity', l.quantity,
                'unit_cost', l.unit_cost, 'line_cost', l.line_cost) order by s.title), '[]'::jsonb)
              from public.estimate_lines l join public.job_specs s on s.id = l.spec_id where l.estimate_id = p.estimate_id));
end $$;

-- ---------------------------------------------------------------------------
-- Contracts: the vendor opens, signs (in signing order), declines and comments.
-- ---------------------------------------------------------------------------
-- Same view as before plus is_internal, so the portal knows which signers are adm Indicia's.
create or replace view public.vendor_contract_parties as
  select p.id, p.contract_id, p.name, p.email, p.role, p.signing_order, p.status, p.signed_at, p.is_internal
    from public.contract_parties p join public.contracts c on c.id = p.contract_id
   where c.supplier_id = public.my_supplier_id() and c.status <> 'draft';
revoke all on public.vendor_contract_parties from anon;
grant select on public.vendor_contract_parties to authenticated;

create view public.vendor_contract_activity as
  select a.id, a.contract_id, a.event_type, a.description, a.created_at, (a.actor = auth.uid()) as mine,
         coalesce(pr.user_type = 'vendor', false) as from_vendor
    from public.contract_activity a
    join public.contracts c on c.id = a.contract_id
    left join public.profiles pr on pr.id = a.actor
   where c.supplier_id = public.my_supplier_id() and public.my_supplier_id() is not null and c.status <> 'draft'
     and (a.event_type in ('sent','viewed','signed','declined','amended','expired','cancelled')
          or (a.event_type = 'commented' and pr.user_type = 'vendor'));
revoke all on public.vendor_contract_activity from anon;
grant select on public.vendor_contract_activity to authenticated;

create or replace function public.vendor_contract_open(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('viewer'); c public.contracts;
begin
  select * into c from public.contracts where id = p_id for update;
  if c.id is null or c.supplier_id is distinct from v_sup or c.status = 'draft' then raise exception 'Contract not found' using errcode = '42501'; end if;
  if c.status <> 'sent' then return; end if;
  perform set_config('assure.system_write', 'on', true);
  update public.contracts set status = 'viewed' where id = p_id;
  update public.contract_parties set status = 'viewed' where contract_id = p_id and not is_internal and status = 'sent';
  perform set_config('assure.system_write', 'off', true);
  insert into public.contract_activity (contract_id, event_type, description, actor) values (p_id, 'viewed', 'Opened in the vendor portal', auth.uid());
  perform public._assure_log(v_sup, 'contract', p_id, 'vendor_viewed', 'sent', 'viewed', 'Contract opened by the vendor: ' || c.title, null);
end $$;

create or replace function public.vendor_contract_sign(p_party uuid, p_decision text, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); p public.contract_parties; c public.contracts; v_left int; v_email text;
begin
  if p_decision not in ('sign','decline') then raise exception 'Choose sign or decline'; end if;
  select * into p from public.contract_parties where id = p_party for update;
  if p.id is null then raise exception 'Signer not found' using errcode = '42501'; end if;
  select * into c from public.contracts where id = p.contract_id for update;
  if c.supplier_id is distinct from v_sup or c.status = 'draft' then raise exception 'Signer not found' using errcode = '42501'; end if;
  if c.status not in ('sent','viewed','in_review','signed') then raise exception 'This contract is not out for signature'; end if;
  if p.is_internal or p.role <> 'signer' then raise exception 'adm Indicia signs this part' using errcode = '42501'; end if;
  if p.status in ('signed','declined') then raise exception 'This signer has already %', p.status; end if;
  select email into v_email from public.profiles where id = auth.uid();
  if lower(p.email) <> lower(v_email) and public.vendor_my_permission() <> 'admin' then
    raise exception 'Only % (or a portal admin) can sign for this signer', p.email using errcode = '42501';
  end if;
  if exists (select 1 from public.contract_parties where contract_id = p.contract_id and role = 'signer'
               and signing_order < p.signing_order and status <> 'signed') then
    raise exception 'Earlier signers must sign first';
  end if;
  perform set_config('assure.system_write', 'on', true);
  if p_decision = 'decline' then
    if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why you are declining'; end if;
    if length(p_note) > 2000 then raise exception 'Keep the reason under 2,000 characters'; end if;
    update public.contract_parties set status = 'declined', recorded_by = auth.uid() where id = p_party;
    update public.contracts set status = 'declined' where id = c.id;
    insert into public.contract_activity (contract_id, event_type, description, actor) values (c.id, 'declined', p.name || ' declined: ' || trim(p_note), auth.uid());
    perform set_config('assure.system_write', 'off', true);
    perform public._assure_log(v_sup, 'contract', c.id, 'vendor_declined', c.status, 'declined', 'Contract declined by the vendor: ' || c.title, trim(p_note));
    perform public.notify(c.created_by, 'assure', 'Contract declined: ' || c.title, p.name || ' declined. ' || trim(p_note), '/assure/contracts/' || c.id);
    return 'declined';
  end if;
  update public.contract_parties set status = 'signed', signed_at = now(),
    signature_evidence = 'Signed in the vendor portal by ' || v_email || ' at ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
    recorded_by = auth.uid() where id = p_party;
  insert into public.contract_activity (contract_id, event_type, description, actor) values (c.id, 'signed', p.name || ' signed in the vendor portal', auth.uid());
  select count(*) into v_left from public.contract_parties where contract_id = c.id and role = 'signer' and status <> 'signed';
  if v_left = 0 then
    update public.contracts set status = 'counter_signed', finalized_at = now() where id = c.id;
    insert into public.contract_activity (contract_id, event_type, description, actor) values (c.id, 'signed', 'All signers complete: contract finalised', auth.uid());
  end if;
  perform set_config('assure.system_write', 'off', true);
  perform public._assure_log(v_sup, 'contract', c.id, 'vendor_signed', c.status, case when v_left = 0 then 'counter_signed' else c.status end,
    'Contract signed by the vendor: ' || c.title, null);
  perform public.notify(c.created_by, 'assure', 'Contract signed: ' || c.title, p.name || ' signed in the vendor portal.', '/assure/contracts/' || c.id);
  return case when v_left = 0 then 'counter_signed' else 'signed' end;
end $$;

create or replace function public.vendor_contract_comment(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); c public.contracts;
begin
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'Write your comment first'; end if;
  if length(p_body) > 2000 then raise exception 'Keep comments under 2,000 characters'; end if;
  select * into c from public.contracts where id = p_id;
  if c.id is null or c.supplier_id is distinct from v_sup or c.status = 'draft' then raise exception 'Contract not found' using errcode = '42501'; end if;
  insert into public.contract_activity (contract_id, event_type, description, actor) values (p_id, 'commented', trim(p_body), auth.uid());
  perform public.notify(c.created_by, 'assure', 'Vendor comment on ' || c.title, left(trim(p_body), 200), '/assure/contracts/' || c.id);
end $$;

-- ---------------------------------------------------------------------------
-- Action plans: the vendor adds its own improvement actions (staff still verify).
-- ---------------------------------------------------------------------------
create or replace function public.vendor_task_add(p_title text, p_description text, p_category text, p_priority text, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public._vendor_require('standard'); v_id uuid;
begin
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'Give the action a title'; end if;
  if length(p_title) > 200 or length(coalesce(p_description, '')) > 2000 then raise exception 'That text is too long'; end if;
  if coalesce(p_category, 'other') not in ('quality','delivery','compliance','cost','sustainability','other') then raise exception 'Unknown category'; end if;
  if coalesce(p_priority, 'medium') not in ('critical','high','medium','low') then raise exception 'Unknown priority'; end if;
  if p_due is not null and p_due < current_date then raise exception 'The due date can''t be in the past'; end if;
  insert into public.action_plan_tasks (supplier_id, title, description, category, priority, due_date, source)
  values (v_sup, trim(p_title), nullif(trim(p_description), ''), coalesce(p_category, 'other'), coalesce(p_priority, 'medium'), p_due, 'manual')
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Public vendor application (/apply). No sign-in: callable by anon, so it validates everything itself.
-- ---------------------------------------------------------------------------
create sequence public.vendor_application_no;

create table public.vendor_applications (
  id uuid primary key default gen_random_uuid(),
  application_ref text not null unique,
  company_name text not null check (length(company_name) between 2 and 200),
  contact_name text not null check (length(contact_name) between 2 and 200),
  contact_email text not null check (length(contact_email) <= 254),
  country text check (country is null or length(country) <= 100),
  major_category text,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new','reviewing','invited','rejected','duplicate')),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  supplier_id uuid references public.suppliers(id) on delete set null,
  created_at timestamptz not null default now()
);
create index vendor_applications_status_idx on public.vendor_applications (status, created_at desc);
create unique index vendor_applications_open_dupe on public.vendor_applications (lower(company_name), lower(contact_email))
  where status in ('new','reviewing');
alter table public.vendor_applications enable row level security;
create policy vapp_read on public.vendor_applications for select to authenticated using (public.is_internal());
revoke all on public.vendor_applications from anon;
revoke insert, update, delete on public.vendor_applications from authenticated;
revoke all on sequence public.vendor_application_no from anon, authenticated;

-- Returns the application reference. A filled honeypot gets a normal-looking answer and nothing is stored.
create or replace function public.vendor_apply(p_company text, p_contact_name text, p_email text, p_country text, p_category text,
  p_data jsonb, p_honeypot text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_company text := regexp_replace(trim(coalesce(p_company, '')), '\s+', ' ', 'g');
  v_contact text := trim(coalesce(p_contact_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ref text; v_data jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if nullif(trim(coalesce(p_honeypot, '')), '') is not null then
    return 'APP-' || to_char(current_date, 'YYYY') || '-RECEIVED';
  end if;
  if length(v_company) < 2 or length(v_company) > 200 then raise exception 'Enter your company name (2 to 200 characters)'; end if;
  if length(v_contact) < 2 or length(v_contact) > 200 then raise exception 'Enter the contact name (2 to 200 characters)'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'Enter a valid email address'; end if;
  if length(coalesce(p_country, '')) > 100 then raise exception 'Country is too long'; end if;
  if p_category is not null and p_category not in ('Print','Packaging','POS','Digital','Logistics','Merchandise','Creative') then
    raise exception 'Choose a category from the list';
  end if;
  if jsonb_typeof(v_data) <> 'object' then raise exception 'Invalid application'; end if;
  if length(v_data::text) > 40000 then raise exception 'The application is too long. Shorten some answers and try again.'; end if;
  if exists (select 1 from public.vendor_applications where lower(company_name) = lower(v_company) and lower(contact_email) = v_email
               and status in ('new','reviewing')) then
    raise exception 'We already have an application from % for this email address. Our procurement team will be in touch.', v_company;
  end if;
  if (select count(*) from public.vendor_applications where lower(contact_email) = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Too many applications from this email address today. Try again tomorrow.';
  end if;
  if (select count(*) from public.vendor_applications where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'We are receiving a lot of applications right now. Try again in an hour.';
  end if;
  v_ref := 'APP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.vendor_application_no')::text, 5, '0');
  insert into public.vendor_applications (application_ref, company_name, contact_name, contact_email, country, major_category, data)
  values (v_ref, v_company, v_contact, v_email, nullif(trim(p_country), ''), p_category, v_data);
  perform public.notify_role('procurement', 'assure', 'New vendor application: ' || v_company,
    format('%s (%s) applied to become a vendor. Ref %s.', v_company, coalesce(p_category, 'no category'), v_ref), '/assure/pre-assessments');
  perform public.notify_role('head', 'assure', 'New vendor application: ' || v_company,
    format('%s (%s) applied to become a vendor. Ref %s.', v_company, coalesce(p_category, 'no category'), v_ref), '/assure/pre-assessments');
  return v_ref;
end $$;

-- Staff move an application along (reviewing / invited / rejected / duplicate).
create or replace function public.vendor_application_decide(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.vendor_applications;
begin
  perform public._assure_require_internal();
  if not (public.assure_is_procurement() or public.assure_is_vendor_manager()) then
    raise exception 'Only procurement or vendor managers can review applications' using errcode = '42501';
  end if;
  if p_status not in ('reviewing','invited','rejected','duplicate') then raise exception 'Unknown status %', p_status; end if;
  select * into a from public.vendor_applications where id = p_id for update;
  if a.id is null then raise exception 'Application not found'; end if;
  if a.status in ('invited','rejected','duplicate') then raise exception 'This application is closed'; end if;
  if p_status in ('rejected','duplicate') and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Record a reason'; end if;
  update public.vendor_applications set status = p_status, review_note = coalesce(nullif(trim(p_note), ''), review_note),
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._vendor_require(text) from public, anon, authenticated;
revoke execute on function public.vendor_my_permission(), public.vendor_request_subscription(text, text),
  public.assure_set_subscription(uuid, text, text, date, text), public.assure_decline_subscription_request(uuid, text),
  public.vendor_team_invite(text, text), public.vendor_team_set_level(uuid, text), public.vendor_team_remove(uuid),
  public.vendor_site_save(uuid, jsonb), public.vendor_site_set_default(uuid), public.vendor_site_archive(uuid),
  public.vendor_po_detail(uuid), public.vendor_contract_open(uuid), public.vendor_contract_sign(uuid, text, text),
  public.vendor_contract_comment(uuid, text), public.vendor_task_add(text, text, text, text, date),
  public.vendor_application_decide(uuid, text, text) from public, anon;
grant execute on function public.vendor_my_permission(), public.vendor_request_subscription(text, text),
  public.assure_set_subscription(uuid, text, text, date, text), public.assure_decline_subscription_request(uuid, text),
  public.vendor_team_invite(text, text), public.vendor_team_set_level(uuid, text), public.vendor_team_remove(uuid),
  public.vendor_site_save(uuid, jsonb), public.vendor_site_set_default(uuid), public.vendor_site_archive(uuid),
  public.vendor_po_detail(uuid), public.vendor_contract_open(uuid), public.vendor_contract_sign(uuid, text, text),
  public.vendor_contract_comment(uuid, text), public.vendor_task_add(text, text, text, text, date),
  public.vendor_application_decide(uuid, text, text) to authenticated;
-- The public application is the one function anonymous visitors may call.
revoke execute on function public.vendor_apply(text, text, text, text, text, jsonb, text) from public;
grant execute on function public.vendor_apply(text, text, text, text, text, jsonb, text) to anon, authenticated;
