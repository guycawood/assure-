-- Assure+ core identity + SRT Onboarding Desk
-- Access is enforced here, in Postgres row-level security and security-definer
-- functions. The app never relies on the browser to decide who can see or change what.

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table public.srt_settings (
  id boolean primary key default true check (id),
  sla_days jsonb not null default '{
    "new_onboarding": 16, "document_verification": 5, "missing_document": 5,
    "remediation": 10, "certificate_renewal": 10, "bank_change": 3,
    "query": 2, "deactivation": 5
  }'::jsonb,
  tier1_spend_threshold numeric(14,2) not null default 100000,
  expiry_warning_days int not null default 30,
  fast_track_default_days int not null default 14,
  enforce_purchasing_block boolean not null default false,
  internal_email_domains text[] not null default array['adm-indicia.com'],
  updated_at timestamptz not null default now()
);
insert into public.srt_settings default values;

-- ---------------------------------------------------------------------------
-- Suppliers (core record; other Assure+ modules extend this later)
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text unique,
  name text not null,
  market text,
  region text check (region in ('APAC','EMEA','Americas','GSC')),
  client text check (client in ('Unilever','Heineken','Coloplast','BAU','Other')),
  category text,
  status text not null default 'onboarding'
    check (status in ('active','pending_approval','onboarding','under_review','suspended','offboarded','inactive')),
  tier text check (tier in ('strategic','preferred','approved','conditional','transactional','tail')),
  primary_contact_email text,
  onboarding_route text not null default 'standard' check (onboarding_route in ('standard','fast_track')),
  fast_track_justification text,
  fast_track_approved_by uuid,
  fast_track_approved_at timestamptz,
  fast_track_close_by date,
  ytd_spend numeric(14,2) not null default 0 check (ytd_spend >= 0),
  strategic boolean not null default false,
  active boolean not null default true,
  srt_owner uuid,
  procurement_owner uuid,
  notes text,
  -- computed by recompute_supplier_compliance(); never set by users
  rag text not null default 'red' check (rag in ('green','amber','red')),
  priority_tier int check (priority_tier between 1 and 4),
  gates_clear int not null default 0,
  critical_open int not null default 0,
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started','in_progress','compliant','suspended')),
  purchasing_blocked boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_primary_contact_email_idx on public.suppliers (lower(primary_contact_email));

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user). Role fields are admin-controlled only.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  user_type text not null default 'vendor' check (user_type in ('internal','vendor','client')),
  is_admin boolean not null default false,
  srt_role text check (srt_role in ('agent','lead','finance','procurement')),
  supplier_id uuid references public.suppliers(id) on delete set null,
  created_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

alter table public.suppliers
  add constraint suppliers_srt_owner_fk foreign key (srt_owner) references public.profiles(id) on delete set null,
  add constraint suppliers_procurement_owner_fk foreign key (procurement_owner) references public.profiles(id) on delete set null,
  add constraint suppliers_fast_track_approved_by_fk foreign key (fast_track_approved_by) references public.profiles(id) on delete set null,
  add constraint suppliers_created_by_fk foreign key (created_by) references public.profiles(id) on delete set null;

-- Vendor team invitations: lets a supplier's staff be linked on first login.
create table public.supplier_team_members (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  email text not null,
  permission_level text not null default 'standard' check (permission_level in ('admin','standard','viewer')),
  status text not null default 'pending' check (status in ('pending','active','removed')),
  linked_user_id uuid references public.profiles(id) on delete set null,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (supplier_id, email)
);

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so RLS policies can call them cheaply)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_internal() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or user_type = 'internal' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_srt_role() returns text
language sql stable security definer set search_path = public as $$
  select srt_role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_supplier_id() returns uuid
language sql stable security definer set search_path = public as $$
  select supplier_id from public.profiles where id = auth.uid();
$$;

-- New auth user -> profile. Linking to a supplier happens here, server-side,
-- from a verified email; users can never set supplier_id or user_type themselves.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(new.email);
  v_domain text := split_part(lower(new.email), '@', 2);
  v_internal boolean;
  v_supplier uuid;
begin
  select v_domain = any (select lower(d) from unnest(internal_email_domains) d)
    into v_internal from public.srt_settings where id;

  if not coalesce(v_internal, false) then
    select id into v_supplier from public.suppliers
      where lower(primary_contact_email) = v_email order by created_at limit 1;
    if v_supplier is null then
      select supplier_id into v_supplier from public.supplier_team_members
        where lower(email) = v_email and status = 'pending' order by created_at limit 1;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, user_type, supplier_id)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name',
          case when coalesce(v_internal, false) then 'internal' else 'vendor' end,
          v_supplier);

  if v_supplier is not null then
    update public.supplier_team_members set status = 'active', linked_user_id = new.id
      where supplier_id = v_supplier and lower(email) = v_email and status = 'pending';
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin-only role management.
create or replace function public.admin_set_user_access(
  p_user uuid, p_user_type text, p_srt_role text, p_is_admin boolean, p_supplier uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change user access' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_is_admin = false then raise exception 'You cannot remove your own admin access'; end if;
  update public.profiles
     set user_type = p_user_type, srt_role = p_srt_role, is_admin = p_is_admin,
         supplier_id = case when p_user_type = 'vendor' then p_supplier else null end
   where id = p_user;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding gates
-- ---------------------------------------------------------------------------
create table public.gate_definitions (
  key text primary key,
  label text not null,
  stage text not null,
  critical boolean not null default false,
  has_expiry boolean not null default false,
  verifier_role text not null default 'srt' check (verifier_role in ('srt','finance','quality','category')),
  sort int not null,
  active boolean not null default true
);

insert into public.gate_definitions (key, label, stage, critical, has_expiry, verifier_role, sort) values
  ('request',        'Onboarding request & business reason',               'Intake',         false, false, 'srt',      10),
  ('rfi',            'RFI / vendor information form',                      'Intake',         false, false, 'srt',      20),
  ('registration',   'Company registration & VAT',                         'Due diligence',  true,  false, 'srt',      30),
  ('financial',      'Financial check (accounts / CreditSafe)',            'Due diligence',  true,  true,  'srt',      40),
  ('bank',           'Bank details verified by Finance',                   'Finance',        true,  false, 'finance',  50),
  ('nda',            'NDA signed',                                         'Contract',       false, false, 'srt',      60),
  ('msa',            'MSA signed',                                         'Contract',       true,  false, 'srt',      70),
  ('coc',            'Code of Conduct signed',                             'Contract',       true,  false, 'srt',      80),
  ('capability',     'Capability assessment',                              'Capability',     true,  false, 'category', 90),
  ('quality',        'Quality evaluation / ISO 9001',                      'Capability',     false, true,  'quality', 100),
  ('environment',    'ISO 14001 / FSC / PEFC',                             'Sustainability', false, true,  'srt',     110),
  ('sustainability', 'Sustainability screening (Sedex / EcoVadis, SMETA)', 'Sustainability', true,  true,  'srt',     120),
  ('setup',          'System set-up (Stocktool, NAV, Sourcing Hub)',       'Set-up',         false, false, 'srt',     130),
  ('approval',       'Onboarding approval',                                'Set-up',         true,  false, 'srt',     140);

create table public.supplier_gates (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  gate_key text not null references public.gate_definitions(key),
  status text not null default 'missing'
    check (status in ('missing','requested','received','verified','rejected','not_required')),
  expiry_date date,
  note text,
  evidence_path text,
  rejection_reason text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (supplier_id, gate_key),
  check (status <> 'rejected' or rejection_reason is not null)
);

create table public.gate_audit_log (
  id bigint generated always as identity primary key,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  gate_key text not null,
  from_status text,
  to_status text,
  expiry_from date,
  expiry_to date,
  note text,
  ticket_id uuid,
  actor uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index gate_audit_log_supplier_idx on public.gate_audit_log (supplier_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Compliance computation: RAG, tier, purchasing block
-- ---------------------------------------------------------------------------
create or replace function public.recompute_supplier_compliance(p_supplier uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.suppliers%rowtype;
  cfg public.srt_settings%rowtype;
  v_total int; v_clear int; v_open int; v_crit_open int; v_crit_missing int; v_approval_ok boolean;
  v_rag text; v_tier int; v_status text; v_blocked boolean; v_exception boolean;
begin
  select * into s from public.suppliers where id = p_supplier;
  if not found then return; end if;
  select * into cfg from public.srt_settings where id;

  with g as (
    select d.key, d.critical,
           case when sg.status in ('verified','received') and sg.expiry_date is not null and sg.expiry_date < current_date
                then 'expired' else coalesce(sg.status, 'missing') end as st
      from public.gate_definitions d
      left join public.supplier_gates sg on sg.gate_key = d.key and sg.supplier_id = p_supplier
     where d.active
  )
  select count(*),
         count(*) filter (where st in ('verified','not_required')),
         count(*) filter (where st not in ('verified','not_required')),
         count(*) filter (where critical and st not in ('verified','not_required')),
         count(*) filter (where critical and st in ('missing','rejected','expired')),
         bool_or(key = 'approval' and st = 'verified')
    into v_total, v_clear, v_open, v_crit_open, v_crit_missing, v_approval_ok
    from g;

  v_rag := case when v_open = 0 then 'green' when v_crit_missing > 0 then 'red' else 'amber' end;

  v_tier := case
    when v_open = 0 then null
    when not s.active or s.ytd_spend <= 0 then 4
    when v_crit_open > 0 and (s.ytd_spend >= cfg.tier1_spend_threshold or s.strategic) then 1
    when v_crit_open > 0 then 2
    else 3 end;

  v_status := case
    when s.status = 'suspended' then 'suspended'
    when v_rag = 'green' and coalesce(v_approval_ok, false) then 'compliant'
    when v_clear = 0 then 'not_started'
    else 'in_progress' end;

  v_exception := s.onboarding_route = 'fast_track'
             and s.fast_track_approved_by is not null
             and s.fast_track_close_by is not null
             and current_date <= s.fast_track_close_by;
  v_blocked := v_crit_open > 0 and not v_exception;

  perform set_config('assure.system_write', 'on', true);
  update public.suppliers
     set rag = v_rag, priority_tier = v_tier, gates_clear = v_clear, critical_open = v_crit_open,
         onboarding_status = v_status, purchasing_blocked = v_blocked
   where id = p_supplier
     and (rag, priority_tier, gates_clear, critical_open, onboarding_status, purchasing_blocked)
         is distinct from (v_rag, v_tier, v_clear, v_crit_open, v_status, v_blocked);
  perform set_config('assure.system_write', 'off', true);
end $$;

-- New supplier -> one gate row per active gate, then compute.
create or replace function public.trg_supplier_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.supplier_gates (supplier_id, gate_key)
    select new.id, key from public.gate_definitions where active
    on conflict do nothing;
  perform public.recompute_supplier_compliance(new.id);
  return null;
end $$;
create trigger supplier_after_insert after insert on public.suppliers
  for each row execute function public.trg_supplier_after_insert();

-- Inputs to the computation changed -> recompute.
create or replace function public.trg_supplier_inputs_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_supplier_compliance(new.id);
  return null;
end $$;
create trigger supplier_inputs_changed after update of ytd_spend, strategic, active, status,
  onboarding_route, fast_track_approved_by, fast_track_close_by on public.suppliers
  for each row execute function public.trg_supplier_inputs_changed();

create or replace function public.trg_gate_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_supplier_compliance(coalesce(new.supplier_id, old.supplier_id));
  return null;
end $$;
create trigger gate_changed after insert or update or delete on public.supplier_gates
  for each row execute function public.trg_gate_changed();

-- Keep updated_at honest.
create or replace function public.trg_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger suppliers_touch before update on public.suppliers
  for each row execute function public.trg_touch_updated_at();

-- Users can't write computed fields or fast-track approval directly.
create or replace function public.trg_supplier_guard() returns trigger
language plpgsql as $$
begin
  -- System functions set this transaction-local flag before writing computed/approval fields.
  if current_setting('assure.system_write', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.rag := 'red'; new.priority_tier := null; new.gates_clear := 0; new.critical_open := 0;
    new.onboarding_status := 'not_started'; new.purchasing_blocked := true;
    new.fast_track_approved_by := null; new.fast_track_approved_at := null;
    new.created_by := auth.uid();
  else
    new.rag := old.rag; new.priority_tier := old.priority_tier; new.gates_clear := old.gates_clear;
    new.critical_open := old.critical_open; new.onboarding_status := old.onboarding_status;
    new.purchasing_blocked := old.purchasing_blocked;
    new.fast_track_approved_by := old.fast_track_approved_by; new.fast_track_approved_at := old.fast_track_approved_at;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger suppliers_guard before insert or update on public.suppliers
  for each row execute function public.trg_supplier_guard();

-- ---------------------------------------------------------------------------
-- Gate updates: the only write path to supplier_gates
-- ---------------------------------------------------------------------------
create or replace function public.update_supplier_gate(
  p_supplier uuid, p_gate text, p_status text default null, p_expiry date default null,
  p_clear_expiry boolean default false, p_note text default null, p_rejection_reason text default null,
  p_ticket uuid default null
) returns public.supplier_gates
language plpgsql security definer set search_path = public as $$
declare
  d public.gate_definitions%rowtype;
  cur public.supplier_gates%rowtype;
  v_role text := public.my_srt_role();
  v_admin boolean := public.is_admin();
  v_status text; v_expiry date; v_out public.supplier_gates%rowtype;
begin
  if not public.is_internal() then raise exception 'Only internal staff can change onboarding gates' using errcode = '42501'; end if;
  select * into d from public.gate_definitions where key = p_gate;
  if not found then raise exception 'Unknown gate %', p_gate; end if;
  select * into cur from public.supplier_gates where supplier_id = p_supplier and gate_key = p_gate for update;
  if not found then raise exception 'Supplier or gate not found'; end if;

  v_status := coalesce(p_status, cur.status);
  v_expiry := case when p_clear_expiry then null when p_expiry is not null then p_expiry else cur.expiry_date end;

  if v_status is distinct from cur.status then
    if v_status in ('verified','rejected') and not v_admin then
      if d.verifier_role = 'finance' and coalesce(v_role,'') <> 'finance' then
        raise exception 'Only Finance can verify or reject "%"', d.label using errcode = '42501';
      elsif d.verifier_role <> 'finance' and coalesce(v_role,'') not in ('agent','lead') then
        raise exception 'Only SRT agents or leads can verify or reject "%"', d.label using errcode = '42501';
      end if;
    end if;
    if v_status = 'not_required' and not v_admin and coalesce(v_role,'') <> 'lead' then
      raise exception 'Only an SRT lead can mark a gate as not required' using errcode = '42501';
    end if;
    if v_status = 'rejected' and nullif(trim(coalesce(p_rejection_reason,'')), '') is null then
      raise exception 'A rejection needs a reason the vendor can act on';
    end if;
  end if;
  if v_expiry is not null and not d.has_expiry then raise exception '"%" does not take an expiry date', d.label; end if;

  update public.supplier_gates set
    status = v_status,
    expiry_date = v_expiry,
    note = coalesce(p_note, note),
    rejection_reason = case when v_status = 'rejected' then p_rejection_reason else null end,
    verified_by = case when v_status = 'verified' and cur.status <> 'verified' then auth.uid()
                       when v_status <> 'verified' then null else verified_by end,
    verified_at = case when v_status = 'verified' and cur.status <> 'verified' then now()
                       when v_status <> 'verified' then null else verified_at end,
    updated_by = auth.uid(),
    updated_at = now()
  where supplier_id = p_supplier and gate_key = p_gate
  returning * into v_out;

  if v_status is distinct from cur.status or v_expiry is distinct from cur.expiry_date then
    insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, expiry_from, expiry_to, note, ticket_id, actor)
    values (p_supplier, p_gate, cur.status, v_status, cur.expiry_date, v_expiry,
            coalesce(p_rejection_reason, p_note), p_ticket, auth.uid());
  end if;
  return v_out;
end $$;

-- Fast-track exception: SRT lead (or admin) approves; cannot approve own request.
create or replace function public.approve_fast_track(p_supplier uuid, p_justification text, p_close_by date)
returns void language plpgsql security definer set search_path = public as $$
declare s public.suppliers%rowtype;
begin
  if not (public.is_admin() or public.my_srt_role() = 'lead') then
    raise exception 'Only an SRT lead can approve a fast-track exception' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_justification,'')), '') is null then raise exception 'A justification is required'; end if;
  if p_close_by is null or p_close_by < current_date then raise exception 'Choose a close-by date in the future'; end if;
  select * into s from public.suppliers where id = p_supplier;
  if not found then raise exception 'Supplier not found'; end if;
  if s.created_by = auth.uid() and not public.is_admin() then
    raise exception 'You cannot approve a fast-track exception for a supplier you created';
  end if;
  update public.suppliers set onboarding_route = 'fast_track', fast_track_justification = p_justification,
         fast_track_close_by = p_close_by where id = p_supplier;
  -- approval columns are guarded against direct writes; set them at depth > 1 via a nested statement
  perform public._set_fast_track_approval(p_supplier, auth.uid());
end $$;

create or replace function public._set_fast_track_approval(p_supplier uuid, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('assure.system_write', 'on', true);
  update public.suppliers set fast_track_approved_by = p_by, fast_track_approved_at = now() where id = p_supplier;
  perform set_config('assure.system_write', 'off', true);
end $$;
revoke all on function public._set_fast_track_approval(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- SRT tickets
-- ---------------------------------------------------------------------------
create table public.srt_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity unique,
  type text not null check (type in ('new_onboarding','document_verification','missing_document','remediation',
                                     'certificate_renewal','bank_change','query','deactivation')),
  title text not null check (length(trim(title)) > 0),
  description text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  prospect_name text,
  client text,
  market text,
  gate_key text references public.gate_definitions(key),
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  status text not null default 'new' check (status in ('new','triage','in_progress','waiting_vendor','waiting_finance','resolved')),
  assignee uuid references public.profiles(id) on delete set null,
  owner uuid references public.profiles(id) on delete set null,
  due_date date,
  source text not null default 'manual' check (source in ('manual','pre_assessment','vendor_upload','cert_expiry','import','gate_review','fast_track')),
  source_ref text,
  resolution text check (resolution in ('completed','rejected','duplicate','withdrawn')),
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supplier_id is not null or nullif(trim(coalesce(prospect_name,'')), '') is not null)
);
create index srt_tickets_status_idx on public.srt_tickets (status, due_date);
create index srt_tickets_supplier_idx on public.srt_tickets (supplier_id);
create index srt_tickets_assignee_idx on public.srt_tickets (assignee) where status <> 'resolved';
-- One open ticket per supplier + gate + type.
create unique index srt_tickets_open_dedupe on public.srt_tickets (supplier_id, gate_key, type)
  where status <> 'resolved' and supplier_id is not null and gate_key is not null;

create table public.srt_ticket_activity (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.srt_tickets(id) on delete cascade,
  kind text not null check (kind in ('comment','event')),
  body text not null,
  actor uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index srt_ticket_activity_ticket_idx on public.srt_ticket_activity (ticket_id, created_at);

create or replace function public.trg_ticket_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.due_date is null then
      select (sla_days->>new.type)::int into v_days from public.srt_settings where id;
      new.due_date := current_date + coalesce(v_days, 5);
    end if;
    if new.status = 'new' and new.assignee is not null then new.status := 'triage'; end if;
  else
    new.updated_at := now();
    new.created_by := old.created_by;
    if new.due_date is distinct from old.due_date and not (public.is_admin() or public.my_srt_role() = 'lead') then
      raise exception 'Only an SRT lead can change a due date' using errcode = '42501';
    end if;
  end if;
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then
    new.resolved_at := now(); new.resolution := coalesce(new.resolution, 'completed');
  elsif new.status <> 'resolved' then
    new.resolved_at := null; new.resolution := null;
  end if;
  return new;
end $$;
create trigger ticket_before before insert or update on public.srt_tickets
  for each row execute function public.trg_ticket_before();

-- Log status / assignment / priority changes automatically.
create or replace function public.trg_ticket_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.srt_ticket_activity (ticket_id, kind, body, actor)
      values (new.id, 'event', 'Ticket raised', auth.uid());
    return null;
  end if;
  if new.status is distinct from old.status then v := v || format('status %s → %s', old.status, new.status); end if;
  if new.assignee is distinct from old.assignee then
    v := v || coalesce('assigned to ' || (select coalesce(full_name, email) from public.profiles where id = new.assignee), 'unassigned');
  end if;
  if new.priority is distinct from old.priority then v := v || format('priority → %s', new.priority); end if;
  if new.due_date is distinct from old.due_date then v := v || format('due → %s', new.due_date); end if;
  if array_length(v, 1) > 0 then
    insert into public.srt_ticket_activity (ticket_id, kind, body, actor)
      values (new.id, 'event', 'Changed ' || array_to_string(v, ', '), auth.uid());
  end if;
  return null;
end $$;
create trigger ticket_after after insert or update on public.srt_tickets
  for each row execute function public.trg_ticket_after();

-- Raise one remediation ticket per open critical gate (skips gates that already have one).
create or replace function public.raise_gap_tickets(p_supplier uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s public.suppliers%rowtype; n int;
begin
  if not public.is_internal() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into s from public.suppliers where id = p_supplier;
  if not found then raise exception 'Supplier not found'; end if;
  insert into public.srt_tickets (type, title, supplier_id, gate_key, priority, assignee, source, client, market, created_by)
  select 'remediation', d.label || ': ' || s.name, s.id, d.key,
         case when s.priority_tier = 1 then 'high' else 'normal' end,
         s.srt_owner, 'gate_review', s.client, s.market, auth.uid()
    from public.gate_definitions d
    join public.supplier_gates g on g.gate_key = d.key and g.supplier_id = s.id
   where d.active and d.critical
     and (g.status not in ('verified','not_required')
          or (g.expiry_date is not null and g.expiry_date < current_date))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.srt_settings enable row level security;
alter table public.suppliers enable row level security;
alter table public.profiles enable row level security;
alter table public.supplier_team_members enable row level security;
alter table public.gate_definitions enable row level security;
alter table public.supplier_gates enable row level security;
alter table public.gate_audit_log enable row level security;
alter table public.srt_tickets enable row level security;
alter table public.srt_ticket_activity enable row level security;

-- settings
create policy settings_read on public.srt_settings for select to authenticated using (public.is_internal());
create policy settings_admin on public.srt_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- suppliers: internal see all; vendors see only their own record (read-only here)
create policy suppliers_read on public.suppliers for select to authenticated
  using (public.is_internal() or id = public.my_supplier_id());
create policy suppliers_insert on public.suppliers for insert to authenticated with check (public.is_internal());
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy suppliers_delete on public.suppliers for delete to authenticated using (public.is_admin());

-- profiles: see yourself; internal see everyone (for assignee pickers)
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_internal());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Column privileges: a user may only edit their own display name. Role fields go through admin_set_user_access().
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated, anon;

-- team members: internal manage; vendor team admins see their own supplier's list
create policy team_read on public.supplier_team_members for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy team_write on public.supplier_team_members for all to authenticated
  using (public.is_internal()) with check (public.is_internal());

-- gate definitions: readable by staff; admin manages
create policy gatedef_read on public.gate_definitions for select to authenticated using (public.is_internal());
create policy gatedef_admin on public.gate_definitions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- gates + audit: internal read only; writes only via update_supplier_gate() / triggers
create policy gates_read on public.supplier_gates for select to authenticated using (public.is_internal());
create policy audit_read on public.gate_audit_log for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.supplier_gates from authenticated, anon;
revoke insert, update, delete on public.gate_audit_log from authenticated, anon;

-- tickets: internal only
create policy tickets_read on public.srt_tickets for select to authenticated using (public.is_internal());
create policy tickets_insert on public.srt_tickets for insert to authenticated with check (public.is_internal());
create policy tickets_update on public.srt_tickets for update to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy tickets_delete on public.srt_tickets for delete to authenticated
  using (public.is_admin() or public.my_srt_role() = 'lead');

create policy activity_read on public.srt_ticket_activity for select to authenticated using (public.is_internal());
create policy activity_insert on public.srt_ticket_activity for insert to authenticated
  with check (public.is_internal() and actor = auth.uid() and kind = 'comment');
revoke update, delete on public.srt_ticket_activity from authenticated, anon;

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;

-- Functions callable by signed-in users (each checks roles internally).
revoke execute on function public.recompute_supplier_compliance(uuid) from public, anon, authenticated;
grant execute on function public.update_supplier_gate(uuid, text, text, date, boolean, text, text, uuid) to authenticated;
grant execute on function public.approve_fast_track(uuid, text, date) to authenticated;
grant execute on function public.raise_gap_tickets(uuid) to authenticated;
grant execute on function public.admin_set_user_access(uuid, text, text, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily recompute (expiry dates and fast-track close-by dates move with time).
-- Enable pg_cron in Supabase (Database > Extensions), then run:
--   select cron.schedule('srt-daily-recompute', '15 0 * * *',
--     $$ select public.recompute_supplier_compliance(id) from public.suppliers $$);
-- ---------------------------------------------------------------------------
