-- Sourcing+ (part 1): access, clients, billing entities, jobs (job bags), specs, BOM, triage.
-- Rebuilt from the Base44 Sourcing Hub prototype (JobBag, JobSpecification, SpecComponent, aacClassificationSuggest)
-- with real foreign keys, RLS, sequence-generated job numbers and server-side triage (h.i.ve Adopt / Adapt / Create / Push).
-- RFQ+, estimates, POs and PSA exceptions follow in 20261011000002/3 (same schema; RFQ+ and Order Management+ have their own pages).

-- ---------------------------------------------------------------------------
-- Libraries owned by Sourcing+ (records are governed in the Watchtower; demo records are in the seed)
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('rate_cards', 'sourcing', 'Rate cards', 'Agreed unit prices by spec type, substrate, size and quantity band. An exact match routes a spec line to Adopt; a near match inside the tolerance band routes it to Adapt or Push.', true, 3),
  ('high_value_thresholds', 'sourcing', 'High-value thresholds', 'RFQ value per country above which a sourcing lead must approve the RFQ before it goes out.', true, 4)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Module settings (single row) and the module audit trail
-- ---------------------------------------------------------------------------
create table public.sourcing_settings (
  id boolean primary key default true check (id),
  triage_tolerance_percent numeric(6,2) not null default 10 check (triage_tolerance_percent between 0 and 100),
  push_confidence_threshold numeric(4,3) not null default 0.90 check (push_confidence_threshold between 0 and 1),
  instant_price_limit numeric(14,2) not null default 25000 check (instant_price_limit >= 0),
  push_respond_days int not null default 3 check (push_respond_days between 1 and 30),
  default_currency text not null default 'EUR',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.sourcing_settings default values;

-- Who can do what in Sourcing+ / RFQ+ / Order Management+ (admin-managed). DOA level drives PO approval.
create table public.sourcing_user_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_lead boolean not null default false,
  is_finance boolean not null default false,
  doa_level int check (doa_level between 0 and 8),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
-- Access granted by email before the person first signs in (applied on profile creation).
create table public.sourcing_access_invites (
  email text primary key,
  is_lead boolean not null default false,
  is_finance boolean not null default false,
  doa_level int check (doa_level between 0 and 8)
);

create or replace function public.trg_profile_sourcing_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sourcing_user_access (user_id, is_lead, is_finance, doa_level)
  select new.id, i.is_lead, i.is_finance, i.doa_level from public.sourcing_access_invites i
   where lower(i.email) = lower(new.email)
  on conflict (user_id) do nothing;
  return null;
end $$;
create trigger profile_sourcing_access after insert on public.profiles
  for each row execute function public.trg_profile_sourcing_access();

create or replace function public.sourcing_is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce((select is_lead from public.sourcing_user_access where user_id = auth.uid()), false);
$$;
create or replace function public.sourcing_is_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.my_srt_role() = 'finance', false)
      or coalesce((select is_finance from public.sourcing_user_access where user_id = auth.uid()), false);
$$;
-- No admin bypass: delegated authority must be granted explicitly.
create or replace function public.sourcing_doa_level() returns int
language sql stable security definer set search_path = public as $$
  select doa_level from public.sourcing_user_access where user_id = auth.uid();
$$;

create or replace function public.sourcing_set_access(p_user uuid, p_is_lead boolean, p_is_finance boolean, p_doa_level int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_govern('sourcing') then raise exception 'Only admins and Sourcing+ owners can change Sourcing+ access' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user and (user_type = 'internal' or is_admin)) then
    raise exception 'Choose an internal person';
  end if;
  insert into public.sourcing_user_access (user_id, is_lead, is_finance, doa_level, updated_by, updated_at)
  values (p_user, coalesce(p_is_lead, false), coalesce(p_is_finance, false), p_doa_level, auth.uid(), now())
  on conflict (user_id) do update set is_lead = excluded.is_lead, is_finance = excluded.is_finance,
    doa_level = excluded.doa_level, updated_by = auth.uid(), updated_at = now();
  perform public._sourcing_event(null, 'access', p_user, 'access_changed',
    jsonb_build_object('is_lead', p_is_lead, 'is_finance', p_is_finance, 'doa_level', p_doa_level));
end $$;

-- ---------------------------------------------------------------------------
-- Clients (with their commercial rules) and billing entities
-- ---------------------------------------------------------------------------
create table public.sourcing_clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) > 0),
  name text not null check (length(trim(name)) > 0),
  default_currency text not null default 'EUR',
  default_markup_percent numeric(6,2) not null default 15 check (default_markup_percent >= 0),
  savings_target_percent numeric(6,2) not null default 5 check (savings_target_percent >= 0),
  quote_tolerance_percent numeric(6,2) check (quote_tolerance_percent between 0 and 100),
  min_quotes_required int not null default 3 check (min_quotes_required between 1 and 10),
  e_tender_threshold numeric(14,2) check (e_tender_threshold >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.sourcing_billing_entities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (length(trim(name)) > 0),
  region text not null check (region in ('APAC','EMEA','Americas','GSC')),
  market text not null,
  vat_number text,
  currency text not null default 'EUR',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jobs (job bags). Job number comes from a sequence, never from the client.
-- ---------------------------------------------------------------------------
create sequence public.job_number_seq;
create or replace function public.next_job_number() returns text
language sql volatile security definer set search_path = public as $$
  select 'JB-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.job_number_seq')::text, 5, '0');
$$;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique, -- set by trg_jobs_before from job_number_seq
  title text not null check (length(trim(title)) > 0),
  client_id uuid not null references public.sourcing_clients(id),
  billing_entity_id uuid references public.sourcing_billing_entities(id),
  region text not null check (region in ('APAC','EMEA','Americas','GSC')),
  market text not null check (length(trim(market)) > 0),
  brief_id uuid, -- Briefing+ brief this job came from; FK to briefs added by the integrator
  category text,
  campaign_name text,
  brand text,
  client_job_ref text,
  budget numeric(14,2) check (budget >= 0),
  currency text not null default 'EUR',
  opened_date date not null default current_date,
  quote_due_date date,
  target_delivery_date date,
  status text not null default 'open' check (status in ('open','quoting','ordered','in_production','delivered','closed','cancelled')),
  manager uuid references public.profiles(id) on delete set null default auth.uid(),
  notes text,
  closed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_idx on public.jobs (status, created_at desc);
create index jobs_client_idx on public.jobs (client_id);

create or replace function public.trg_jobs_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.job_number := public.next_job_number();
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    if current_setting('sourcing.system_write', true) is distinct from 'on' then new.status := 'open'; end if;
  else
    new.job_number := old.job_number;
    new.created_by := old.created_by;
    new.updated_at := now();
    if new.status is distinct from old.status and current_setting('sourcing.system_write', true) is distinct from 'on' then
      raise exception 'Change the job status with "Move job" so the step is checked and logged';
    end if;
  end if;
  return new;
end $$;
create trigger jobs_before before insert or update on public.jobs
  for each row execute function public.trg_jobs_before();

-- ---------------------------------------------------------------------------
-- Audit / activity for every Sourcing+, RFQ+ and Order Management+ record (append-only)
-- ---------------------------------------------------------------------------
create table public.sourcing_events (
  id bigint generated always as identity primary key,
  job_id uuid references public.jobs(id) on delete set null,
  entity text not null,
  entity_id uuid,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index sourcing_events_job_idx on public.sourcing_events (job_id, at desc);
create index sourcing_events_entity_idx on public.sourcing_events (entity, entity_id, at desc);

create or replace function public._sourcing_event(p_job uuid, p_entity text, p_id uuid, p_event text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.sourcing_events (job_id, entity, entity_id, event, detail, actor)
  values (p_job, p_entity, p_id, p_event, coalesce(p_detail, '{}'::jsonb), auth.uid());
$$;

create or replace function public.trg_jobs_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._sourcing_event(new.id, 'job', new.id, 'created', jsonb_build_object('job_number', new.job_number, 'title', new.title));
  elsif (new.region, new.market) is distinct from (old.region, old.market) then
    update public.job_specs set region = new.region, market = new.market where job_id = new.id;
    perform public._sourcing_event(new.id, 'job', new.id, 'location_changed',
      jsonb_build_object('region', new.region, 'market', new.market));
  end if;
  return null;
end $$;

-- Legal job lifecycle moves.
create or replace function public.job_set_status(p_job uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.jobs; ok boolean;
begin
  if not public.is_internal() then raise exception 'Only internal staff can move jobs' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  ok := case j.status
    when 'open' then p_status in ('quoting','cancelled')
    when 'quoting' then p_status in ('open','ordered','cancelled')
    when 'ordered' then p_status in ('in_production','cancelled')
    when 'in_production' then p_status in ('delivered','cancelled')
    when 'delivered' then p_status in ('closed','in_production')
    else false end;
  if not ok then raise exception 'A job can''t move from % to %', replace(j.status, '_', ' '), replace(p_status, '_', ' '); end if;
  if p_status = 'cancelled' and coalesce(trim(p_note), '') = '' then raise exception 'Say why the job is cancelled'; end if;
  perform set_config('sourcing.system_write', 'on', true);
  update public.jobs set status = p_status, closed_at = case when p_status in ('closed','cancelled') then now() end where id = p_job;
  perform set_config('sourcing.system_write', 'off', true);
  perform public._sourcing_event(p_job, 'job', p_job, 'status_changed', jsonb_build_object('from', j.status, 'to', p_status, 'note', p_note));
end $$;

-- Internal helper used by RFQ/PO functions to advance a job automatically.
create or replace function public._job_advance(p_job uuid, p_from text[], p_to text)
returns void language plpgsql security definer set search_path = public as $$
declare v_from text;
begin
  select status into v_from from public.jobs where id = p_job;
  if v_from = any (p_from) then
    perform set_config('sourcing.system_write', 'on', true);
    update public.jobs set status = p_to where id = p_job;
    perform set_config('sourcing.system_write', 'off', true);
    perform public._sourcing_event(p_job, 'job', p_job, 'status_changed', jsonb_build_object('from', v_from, 'to', p_to, 'note', 'automatic'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Specs, versions (quantities and sizes), components (bill of materials)
-- ---------------------------------------------------------------------------
create table public.job_specs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  spec_no int not null,
  title text not null check (length(trim(title)) > 0),
  spec_type text not null check (spec_type in ('2d','3d','custom_goods_services','design','promo_merch')),
  description text,
  calculation_method text not null default 'quantity' check (calculation_method in ('quantity','square_measurement')),
  hs_code text,
  substrate_id uuid references public.library_records(id),
  size_unit text check (size_unit in ('mm','cm','in')),
  unit_weight_grams numeric(14,2) check (unit_weight_grams >= 0),
  packaging_weight_grams numeric(14,2) check (packaging_weight_grams >= 0),
  weight_basis text check (weight_basis in ('supplier_confirmed','estimated','calculated_from_material')),
  co2e_kg_per_unit numeric(16,5),
  co2e_total_kg numeric(16,3),
  co2e_detail jsonb,
  co2e_computed_at timestamptz,
  spec_data jsonb not null default '{}'::jsonb,
  region text not null check (region in ('APAC','EMEA','Americas','GSC')),
  market text not null,
  brief_id uuid, -- provenance from Briefing+ (FK added by the integrator)
  is_draft boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, spec_no)
);
create index job_specs_job_idx on public.job_specs (job_id);

create table public.spec_versions (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.job_specs(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  quantity int not null check (quantity > 0),
  finished_length numeric(12,2) check (finished_length > 0),
  finished_width numeric(12,2) check (finished_width > 0),
  item_code text,
  unit_weight_grams numeric(14,2) check (unit_weight_grams >= 0),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index spec_versions_spec_idx on public.spec_versions (spec_id, sort);

create table public.spec_components (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.job_specs(id) on delete cascade,
  version_id uuid references public.spec_versions(id) on delete cascade,
  component_name text not null check (length(trim(component_name)) > 0),
  component_type text not null default 'body' check (component_type in ('body','base','header','panel','fixing','print','finishing','packaging','other')),
  is_packaging boolean not null default false,
  substrate_id uuid references public.library_records(id),
  quantity_per_unit numeric(12,3) not null default 1 check (quantity_per_unit > 0),
  area_length_cm numeric(12,2) check (area_length_cm > 0),
  area_width_cm numeric(12,2) check (area_width_cm > 0),
  direct_weight_grams numeric(14,2) check (direct_weight_grams > 0),
  thickness_mm_override numeric(10,3) check (thickness_mm_override > 0),
  grammage_gsm_override numeric(10,2) check (grammage_gsm_override > 0),
  derived_weight_grams numeric(14,2),
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index spec_components_spec_idx on public.spec_components (spec_id, sort);

create or replace function public.trg_job_specs_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare j public.jobs;
begin
  if tg_op = 'INSERT' then
    select * into j from public.jobs where id = new.job_id for update;
    if j.id is null then raise exception 'Job not found'; end if;
    if j.status in ('closed','cancelled') then raise exception 'This job is %: specs can''t be added', j.status; end if;
    new.spec_no := coalesce((select max(spec_no) from public.job_specs where job_id = new.job_id), 0) + 1;
    new.region := j.region; new.market := j.market;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    if new.job_id <> old.job_id then raise exception 'A spec can''t move to another job; duplicate it instead'; end if;
    new.spec_no := old.spec_no; new.created_by := old.created_by; new.updated_at := now();
    if current_setting('sourcing.system_write', true) is distinct from 'on' then
      select region, market into new.region, new.market from public.jobs where id = new.job_id;
    end if;
  end if;
  return new;
end $$;
create trigger job_specs_before before insert or update on public.job_specs
  for each row execute function public.trg_job_specs_before();

-- Substrates are Watchtower library records; check the reference and keep the usage guard (library_refs) in step.
create or replace function public.trg_substrate_ref_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.substrate_id is not null and (tg_op = 'INSERT' or new.substrate_id is distinct from old.substrate_id) then
    if not exists (select 1 from public.library_records where id = new.substrate_id and library_key = 'substrates' and status = 'active') then
      raise exception 'Choose an active substrate from the Watchtower substrate library';
    end if;
  end if;
  return new;
end $$;

create or replace function public.trg_substrate_ref_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.substrate_id is not null
     and (tg_op = 'DELETE' or new.substrate_id is distinct from old.substrate_id) then
    delete from public.library_refs where record_id = old.substrate_id and ref_table = tg_table_name and ref_id = old.id::text;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.substrate_id is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
    values (new.substrate_id, tg_table_name, new.id::text,
            case when tg_table_name = 'job_specs' then 'Spec ' || new.id::text else 'Spec component ' || new.id::text end)
    on conflict do nothing;
  end if;
  return null;
end $$;

create trigger job_specs_substrate_check before insert or update of substrate_id on public.job_specs
  for each row execute function public.trg_substrate_ref_check();
create trigger job_specs_substrate_sync after insert or update of substrate_id or delete on public.job_specs
  for each row execute function public.trg_substrate_ref_sync();
create trigger spec_components_substrate_check before insert or update of substrate_id on public.spec_components
  for each row execute function public.trg_substrate_ref_check();
create trigger spec_components_substrate_sync after insert or update of substrate_id or delete on public.spec_components
  for each row execute function public.trg_substrate_ref_sync();

create trigger jobs_after after insert or update on public.jobs
  for each row execute function public.trg_jobs_after();

-- ---------------------------------------------------------------------------
-- Triage before RFQ (h.i.ve): every spec line is routed Adopt / Adapt / Create / Push
-- with a reason, confidence and rule version. Rule-based for now; history is kept.
-- ---------------------------------------------------------------------------
create table public.spec_triage (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.job_specs(id) on delete cascade,
  route text not null check (route in ('adopt','adapt','create','push')),
  reason text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  rate_card_id uuid references public.library_records(id),
  unit_price numeric(14,4) check (unit_price >= 0),
  currency text,
  quantity int,
  supplier_id uuid references public.suppliers(id),
  push_status text check (push_status in ('pending','accepted','declined')),
  push_respond_by date,
  push_responded_at timestamptz,
  push_decline_reason text,
  rule_version text not null,
  source text not null check (source in ('rule','override','supplier')),
  is_current boolean not null default true,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now()
);
create unique index spec_triage_current on public.spec_triage (spec_id) where is_current;

create or replace function public._triage_insert(p_spec uuid, p_route text, p_reason text, p_conf numeric, p_card uuid,
  p_price numeric, p_currency text, p_qty int, p_supplier uuid, p_source text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_job uuid; v_days int;
begin
  select push_respond_days into v_days from public.sourcing_settings where id;
  update public.spec_triage set is_current = false where spec_id = p_spec and is_current;
  insert into public.spec_triage (spec_id, route, reason, confidence, rate_card_id, unit_price, currency, quantity, supplier_id,
    push_status, push_respond_by, rule_version, source, decided_by)
  values (p_spec, p_route, p_reason, round(p_conf, 3), p_card, round(p_price, 4), p_currency, p_qty, p_supplier,
    case when p_route = 'push' then 'pending' end, case when p_route = 'push' then current_date + v_days end,
    'triage-rules-v1', p_source, auth.uid())
  returning id into v_id;
  if p_card is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (p_card, 'spec_triage', v_id::text, 'Triage decision')
    on conflict do nothing;
  end if;
  select job_id into v_job from public.job_specs where id = p_spec;
  perform public._sourcing_event(v_job, 'spec', p_spec, 'triaged',
    jsonb_build_object('route', p_route, 'reason', p_reason, 'confidence', round(p_conf, 3), 'unit_price', round(p_price, 4), 'source', p_source));
  return v_id;
end $$;

-- Rule-based triage. Inputs: the spec (type, substrate, first version size, total quantity), live rate cards,
-- the tolerance band, push confidence threshold and instant-price limit from sourcing_settings.
create or replace function public.spec_triage_run(p_spec uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.job_specs; j public.jobs; c public.sourcing_clients; cfg public.sourcing_settings;
  v_sub uuid; v_sub_code text; v_qty int; v_len numeric; v_wid numeric; v_unit text; v_mm numeric; v_area numeric;
  b record; v_price numeric; v_conf numeric; v_value numeric; v_sup public.suppliers;
begin
  if not public.is_internal() then raise exception 'Only internal staff can triage specs' using errcode = '42501'; end if;
  select * into s from public.job_specs where id = p_spec;
  if s.id is null then raise exception 'Spec not found'; end if;
  if s.is_draft then raise exception 'Finish the spec before triage'; end if;
  if exists (select 1 from public.spec_triage where spec_id = p_spec and is_current and route = 'push' and push_status = 'accepted') then
    raise exception 'The supplier has accepted the pushed price for this spec; it can''t be re-triaged';
  end if;
  select * into j from public.jobs where id = s.job_id;
  select * into c from public.sourcing_clients where id = j.client_id;
  select * into cfg from public.sourcing_settings where id;

  v_sub := coalesce(s.substrate_id, (select substrate_id from public.spec_components
                                     where spec_id = p_spec and not is_packaging and substrate_id is not null
                                     order by sort, created_at limit 1));
  select code into v_sub_code from public.library_records where id = v_sub;
  select coalesce(sum(quantity), 0) into v_qty from public.spec_versions where spec_id = p_spec;
  if v_qty = 0 then raise exception 'Add at least one version with a quantity before triage'; end if;
  select finished_length, finished_width into v_len, v_wid from public.spec_versions where spec_id = p_spec order by sort, created_at limit 1;
  v_unit := coalesce(s.size_unit, s.spec_data->>'size_unit');
  v_mm := case v_unit when 'mm' then 1 when 'cm' then 10 when 'in' then 25.4 end;
  v_area := case when v_len is not null and v_wid is not null and v_mm is not null then (v_len * v_mm) * (v_wid * v_mm) end;

  select r.id, r.name, r.data, sup.id as supplier_id, coalesce((r.data->>'unit_price')::numeric, 0) as price,
         (r.data->>'client_code') is not null as client_specific,
         case when ca.area is null and v_area is null then 0
              when ca.area is null or v_area is null then 100
              else abs(v_area - ca.area) / ca.area * 100 end as size_dev,
         ca.area as card_area,
         (v_qty >= coalesce((r.data->>'min_qty')::int, 0) and (r.data->>'max_qty' is null or v_qty <= (r.data->>'max_qty')::int)) as qty_ok
    into b
    from public.library_records r
    cross join lateral (select (r.data->>'finished_length_mm')::numeric * (r.data->>'finished_width_mm')::numeric as area) ca
    left join public.suppliers sup on sup.supplier_code = r.data->>'supplier_code'
   where r.library_key = 'rate_cards' and r.status = 'active'
     and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date)
     and r.data->>'spec_type' = s.spec_type
     and (r.data->>'client_code' is null or r.data->>'client_code' = c.code)
     and (r.data->>'substrate_code' is null or r.data->>'substrate_code' = v_sub_code)
     and coalesce(r.data->>'currency', j.currency) = j.currency
   order by size_dev, qty_ok desc, client_specific desc, r.effective_from desc
   limit 1;

  if b.id is null then
    return public._triage_insert(p_spec, 'create', 'No live rate card matches this spec type and material: run an RFQ.', 0, null, null, j.currency, v_qty, null, 'rule');
  end if;
  if b.supplier_id is not null then select * into v_sup from public.suppliers where id = b.supplier_id; end if;

  if b.size_dev <= 0.5 and b.qty_ok then
    if v_sup.id is not null and (not v_sup.active or v_sup.purchasing_blocked) then
      return public._triage_insert(p_spec, 'create', format('Exact match to rate card "%s", but its supplier %s is blocked for purchasing in Assure+: run an RFQ.', b.name, v_sup.name),
        0.5, b.id, b.price, j.currency, v_qty, null, 'rule');
    end if;
    return public._triage_insert(p_spec, 'adopt', format('Exact match to rate card "%s": card price applies.', b.name),
      case when b.client_specific then 1.0 else 0.95 end, b.id, b.price, j.currency, v_qty, v_sup.id, 'rule');
  end if;

  if b.size_dev <= cfg.triage_tolerance_percent then
    v_price := b.price * case when v_area is not null and b.card_area is not null then v_area / b.card_area else 1 end;
    v_conf := greatest(0, 1 - b.size_dev / 100 - case when b.qty_ok then 0 else 0.05 end);
    v_value := v_price * v_qty;
    if v_value > cfg.instant_price_limit then
      return public._triage_insert(p_spec, 'create', format('Priced in band from "%s" (%s%% off), but the value %s is over the instant-price limit of %s: run an RFQ.',
        b.name, round(b.size_dev, 1), round(v_value, 2), cfg.instant_price_limit), v_conf, b.id, v_price, j.currency, v_qty, null, 'rule');
    end if;
    if v_conf >= cfg.push_confidence_threshold and v_sup.id is not null and v_sup.active and not v_sup.purchasing_blocked then
      return public._triage_insert(p_spec, 'push', format('Inside the ±%s%% band of "%s" with %s confidence: we state the price and %s confirms.',
        cfg.triage_tolerance_percent, b.name, round(v_conf * 100) || '%', v_sup.name), v_conf, b.id, v_price, j.currency, v_qty, v_sup.id, 'rule');
    end if;
    if v_sup.id is null or not v_sup.active or v_sup.purchasing_blocked then
      return public._triage_insert(p_spec, 'create', format('Inside the band of "%s" but the card has no eligible supplier: run an RFQ.', b.name),
        v_conf, b.id, v_price, j.currency, v_qty, null, 'rule');
    end if;
    return public._triage_insert(p_spec, 'adapt', format('Inside the ±%s%% band of "%s" (%s%% off): priced from the card, no RFQ.',
      cfg.triage_tolerance_percent, b.name, round(b.size_dev, 1)), v_conf, b.id, v_price, j.currency, v_qty, v_sup.id, 'rule');
  end if;

  return public._triage_insert(p_spec, 'create', format('Nearest rate card "%s" is %s%% off, outside the ±%s%% band: run an RFQ.',
    b.name, round(b.size_dev, 1), cfg.triage_tolerance_percent), 0, null, null, j.currency, v_qty, null, 'rule');
end $$;

-- Overrides: anyone internal can send a line to Create (RFQ); routing away from Create needs a sourcing lead
-- and an existing rate-card price on the current decision.
create or replace function public.spec_triage_override(p_spec uuid, p_route text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.spec_triage; v_sup public.suppliers; j public.jobs;
begin
  if not public.is_internal() then raise exception 'Only internal staff can triage specs' using errcode = '42501'; end if;
  if p_route not in ('adopt','adapt','create','push') then raise exception 'Unknown route'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the override'; end if;
  select * into t from public.spec_triage where spec_id = p_spec and is_current;
  if t.id is null then raise exception 'Run triage on this spec first'; end if;
  if t.route = 'push' and t.push_status = 'accepted' then raise exception 'The supplier has accepted the pushed price; it can''t be overridden'; end if;
  if p_route <> 'create' then
    if not public.sourcing_is_lead() then raise exception 'Only a sourcing lead can route a line away from an RFQ' using errcode = '42501'; end if;
    if t.rate_card_id is null or t.unit_price is null then raise exception 'There is no rate-card price to apply; this line needs an RFQ'; end if;
    select * into v_sup from public.suppliers where id = coalesce(t.supplier_id,
      (select s.id from public.library_records r join public.suppliers s on s.supplier_code = r.data->>'supplier_code' where r.id = t.rate_card_id));
    if v_sup.id is null or not v_sup.active or v_sup.purchasing_blocked then
      raise exception 'The rate-card supplier is not eligible in Assure+; this line needs an RFQ';
    end if;
  end if;
  select j2.* into j from public.jobs j2 join public.job_specs s on s.job_id = j2.id where s.id = p_spec;
  return public._triage_insert(p_spec, p_route, 'Override: ' || trim(p_reason), case when p_route = 'create' then 0 else t.confidence end,
    t.rate_card_id, t.unit_price, t.currency, t.quantity, case when p_route = 'create' then null else v_sup.id end, 'override');
end $$;

-- Vendor side of Push (for the vendor portal): list and respond to pushed prices for my supplier.
create or replace function public.triage_push_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'spec_title', s.title, 'spec_type', s.spec_type, 'description', s.description, 'job_number', j.job_number,
    'quantity', t.quantity, 'unit_price', t.unit_price, 'currency', t.currency, 'respond_by', t.push_respond_by,
    'status', t.push_status) order by t.decided_at desc), '[]'::jsonb)
  from public.spec_triage t join public.job_specs s on s.id = t.spec_id join public.jobs j on j.id = s.job_id
  where t.route = 'push' and t.is_current and t.supplier_id = public.my_supplier_id() and public.my_supplier_id() is not null;
$$;

create or replace function public.triage_push_respond(p_triage uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.spec_triage; v_job uuid;
begin
  select * into t from public.spec_triage where id = p_triage for update;
  if t.id is null or public.my_supplier_id() is null or t.supplier_id is distinct from public.my_supplier_id() or t.route <> 'push' or not t.is_current then
    raise exception 'Pushed price not found' using errcode = '42501';
  end if;
  if t.push_status <> 'pending' then raise exception 'You have already responded to this price'; end if;
  if current_date > t.push_respond_by then raise exception 'The respond-by date has passed'; end if;
  select job_id into v_job from public.job_specs where id = t.spec_id;
  if p_accept then
    update public.spec_triage set push_status = 'accepted', push_responded_at = now() where id = p_triage;
    perform public._sourcing_event(v_job, 'spec', t.spec_id, 'push_accepted', jsonb_build_object('triage_id', p_triage));
  else
    if coalesce(trim(p_reason), '') = '' then raise exception 'Say why you are declining'; end if;
    update public.spec_triage set push_status = 'declined', push_responded_at = now(), push_decline_reason = trim(p_reason) where id = p_triage;
    perform public._sourcing_event(v_job, 'spec', t.spec_id, 'push_declined', jsonb_build_object('triage_id', p_triage, 'reason', trim(p_reason)));
    perform public._triage_insert(t.spec_id, 'create', 'Supplier declined the pushed price: run an RFQ.', 0, t.rate_card_id, null, t.currency, t.quantity, null, 'supplier');
  end if;
end $$;

-- Settings: governed by admins / Sourcing+ owners, audited.
create or replace function public.sourcing_update_settings(p_tolerance numeric, p_push_threshold numeric, p_instant_limit numeric, p_respond_days int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.sourcing_settings;
begin
  if not public.can_govern('sourcing') then raise exception 'Only admins and Sourcing+ owners can change Sourcing+ settings' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the change'; end if;
  select * into o from public.sourcing_settings where id for update;
  update public.sourcing_settings set triage_tolerance_percent = p_tolerance, push_confidence_threshold = p_push_threshold,
    instant_price_limit = p_instant_limit, push_respond_days = p_respond_days, updated_by = auth.uid(), updated_at = now() where id;
  perform public._sourcing_event(null, 'settings', null, 'settings_changed', jsonb_build_object(
    'before', jsonb_build_object('tolerance', o.triage_tolerance_percent, 'push_threshold', o.push_confidence_threshold, 'instant_limit', o.instant_price_limit, 'respond_days', o.push_respond_days),
    'after', jsonb_build_object('tolerance', p_tolerance, 'push_threshold', p_push_threshold, 'instant_limit', p_instant_limit, 'respond_days', p_respond_days),
    'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------
alter table public.sourcing_settings enable row level security;
alter table public.sourcing_user_access enable row level security;
alter table public.sourcing_access_invites enable row level security;
alter table public.sourcing_clients enable row level security;
alter table public.sourcing_billing_entities enable row level security;
alter table public.jobs enable row level security;
alter table public.sourcing_events enable row level security;
alter table public.job_specs enable row level security;
alter table public.spec_versions enable row level security;
alter table public.spec_components enable row level security;
alter table public.spec_triage enable row level security;

create policy ss_read on public.sourcing_settings for select to authenticated using (public.is_internal());
create policy sua_read on public.sourcing_user_access for select to authenticated using (public.is_internal());
create policy sai_read on public.sourcing_access_invites for select to authenticated using (public.is_admin());
create policy sc_read on public.sourcing_clients for select to authenticated using (public.is_internal());
create policy sc_write on public.sourcing_clients for all to authenticated
  using (public.can_govern('sourcing') or public.sourcing_is_lead()) with check (public.can_govern('sourcing') or public.sourcing_is_lead());
create policy sbe_read on public.sourcing_billing_entities for select to authenticated using (public.is_internal());
create policy sbe_write on public.sourcing_billing_entities for all to authenticated
  using (public.can_govern('sourcing') or public.sourcing_is_lead()) with check (public.can_govern('sourcing') or public.sourcing_is_lead());
create policy jobs_read on public.jobs for select to authenticated using (public.is_internal());
create policy jobs_insert on public.jobs for insert to authenticated with check (public.is_internal());
create policy jobs_update on public.jobs for update to authenticated using (public.is_internal()) with check (public.is_internal());
create policy se_read on public.sourcing_events for select to authenticated using (public.is_internal());
create policy specs_read on public.job_specs for select to authenticated using (public.is_internal());
create policy specs_write on public.job_specs for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy sv_read on public.spec_versions for select to authenticated using (public.is_internal());
create policy sv_write on public.spec_versions for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy scomp_read on public.spec_components for select to authenticated using (public.is_internal());
create policy scomp_write on public.spec_components for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy st_read on public.spec_triage for select to authenticated using (public.is_internal());

revoke insert, update, delete on public.sourcing_settings, public.sourcing_user_access, public.sourcing_access_invites,
  public.sourcing_events, public.spec_triage from authenticated, anon;
-- Jobs: only descriptive columns are writable; number, status and authorship are set by the database.
revoke insert, update, delete on public.jobs from authenticated, anon;
grant insert (title, client_id, billing_entity_id, region, market, brief_id, category, campaign_name, brand, client_job_ref,
  budget, currency, quote_due_date, target_delivery_date, manager, notes) on public.jobs to authenticated;
grant update (title, client_id, billing_entity_id, region, market, brief_id, category, campaign_name, brand, client_job_ref,
  budget, currency, quote_due_date, target_delivery_date, manager, notes) on public.jobs to authenticated;
-- Specs: region/market/numbering/authorship are set by triggers; a spec on an RFQ can't be deleted (FK) or edited (lock trigger).

revoke execute on function public._sourcing_event(uuid, text, uuid, text, jsonb), public._job_advance(uuid, text[], text),
  public._triage_insert(uuid, text, text, numeric, uuid, numeric, text, int, uuid, text), public.next_job_number()
  from public, anon, authenticated;
