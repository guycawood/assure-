-- Execution+: outlets (with supplier visibility via a link table), recces (units-fit computed server-side), deployments
-- (stage synced from deliveries, vendor installs with photo + GPS evidence, distance to outlet computed server-side),
-- deployment audits scored against the display_scoring library, maintenance tickets, visits, job quality gates
-- (mock-up -> production -> installation -> closure) and the job close check.
-- Rebuilt from the Base44 Execution portal (Outlet, Recce, Deployment, Visit, MaintenanceTicket, DisplayScoringMethodology,
-- recceCalc, deploymentStageSync, recceOutletActivator, outletVisibilityRecompute) with all writes through checked functions.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('execution_rules', 'execution', 'Execution rules', 'Thresholds Execution+ applies: audit pass mark (EXR-PASS, %) and install GPS tolerance (EXR-GPS, metres).', true, 2)
on conflict (key) do nothing;

create sequence public.recce_code_seq;
create sequence public.deployment_code_seq;
create sequence public.ticket_code_seq;
create sequence public.visit_code_seq;

create or replace function public._execution_code(p_prefix text) returns text
language sql volatile security definer set search_path = public as $$
  select p_prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval(
    case p_prefix when 'RCE' then 'public.recce_code_seq' when 'DEP' then 'public.deployment_code_seq'
                  when 'MT' then 'public.ticket_code_seq' when 'VIS' then 'public.visit_code_seq' end::regclass
  )::text, 5, '0');
$$;

-- Numeric rule from the execution_rules library (version in force today), with a default.
create or replace function public._execution_rule(p_code text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (r.data->>'value')::numeric from public.library_effective('execution_rules', p_code, current_date) r where r.id is not null), p_default);
$$;

create or replace function public._execution_require_internal() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() or public.my_supplier_id() is not null then
    raise exception 'Only internal staff can do this' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Outlets
-- ---------------------------------------------------------------------------
create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.sourcing_clients(id),
  name text not null check (length(trim(name)) > 0),
  outlet_code text not null check (length(trim(outlet_code)) > 0),
  address_line text,
  city text,
  postcode text,
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  store_type text not null default 'other' check (store_type in ('supermarket','convenience','horeca','pharmacy','duty_free','forecourt','department_store','other')),
  status text not null default 'active' check (status in ('active','inactive','pending_survey')),
  contact_name text,
  contact_phone text,
  contact_email text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, outlet_code)
);
create index outlets_market_idx on public.outlets (region, market);

-- Which suppliers may see an outlet (manual, or automatically from a delivery or deployment to it).
create table public.outlet_suppliers (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  source text not null check (source in ('manual','delivery','deployment')),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  primary key (outlet_id, supplier_id)
);

create or replace function public.trg_region_market_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_region text;
begin
  select region_code into v_region from public.markets where code = new.market;
  if v_region is distinct from new.region then raise exception 'Market % is in region %, not %', new.market, v_region, new.region; end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); new.created_by := old.created_by; end if;
  return new;
end $$;
create trigger outlets_before before insert or update on public.outlets for each row execute function public.trg_region_market_check();

-- Delivery destinations can point at an outlet (Logistics+ <-> Execution+ link).
alter table public.deliveries add column outlet_id uuid references public.outlets(id);
create index deliveries_outlet_idx on public.deliveries (outlet_id);

-- ---------------------------------------------------------------------------
-- Recces (site surveys)
-- ---------------------------------------------------------------------------
create table public.recces (
  id uuid primary key default gen_random_uuid(),
  recce_code text not null unique,
  outlet_id uuid not null references public.outlets(id),
  job_id uuid references public.jobs(id),
  supplier_id uuid references public.suppliers(id),
  product_name text,
  location_in_store text,
  surface_type text check (surface_type in ('glass','wall','shelf','floor','ceiling','counter','gondola_end','other')),
  available_width_cm numeric(10,2) check (available_width_cm > 0),
  available_height_cm numeric(10,2) check (available_height_cm > 0),
  available_depth_cm numeric(10,2) check (available_depth_cm > 0),
  unit_width_cm numeric(10,2) check (unit_width_cm > 0),
  unit_height_cm numeric(10,2) check (unit_height_cm > 0),
  unit_depth_cm numeric(10,2) check (unit_depth_cm > 0),
  units_fit int,
  wall_space_available boolean,
  power_outlet_nearby boolean,
  recommended_width_cm numeric(10,2) check (recommended_width_cm > 0),
  recommended_height_cm numeric(10,2) check (recommended_height_cm > 0),
  recommended_depth_cm numeric(10,2) check (recommended_depth_cm > 0),
  recommended_notes text,
  recommended_by uuid references public.profiles(id),
  survey_date date not null default current_date,
  surveyed_by uuid references public.profiles(id),
  captured_by_vendor boolean not null default false,
  status text not null default 'draft' check (status in ('draft','confirmed','production_ready')),
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recces_outlet_idx on public.recces (outlet_id);

-- units_fit = floor(aw/uw) x floor(ah/uh) x floor(ad/ud) (depth only when both depths are known).
create or replace function public.execution_units_fit(aw numeric, ah numeric, ad numeric, uw numeric, uh numeric, ud numeric)
returns int language sql immutable as $$
  select case when coalesce(aw, 0) <= 0 or coalesce(ah, 0) <= 0 or coalesce(uw, 0) <= 0 or coalesce(uh, 0) <= 0 then null
    else (floor(aw / uw) * floor(ah / uh) * case when coalesce(ad, 0) > 0 and coalesce(ud, 0) > 0 then floor(ad / ud) else 1 end)::int end;
$$;

create or replace function public.trg_recces_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.outlets;
begin
  select * into o from public.outlets where id = new.outlet_id;
  if tg_op = 'INSERT' then new.recce_code := public._execution_code('RCE');
  else new.recce_code := old.recce_code; new.updated_at := now(); end if;
  new.region := o.region; new.market := o.market;
  new.units_fit := public.execution_units_fit(new.available_width_cm, new.available_height_cm, new.available_depth_cm,
    new.unit_width_cm, new.unit_height_cm, new.unit_depth_cm);
  return new;
end $$;
create trigger recces_before before insert or update on public.recces for each row execute function public.trg_recces_before();

-- Confirming a recce activates an outlet still pending survey (recceOutletActivator).
create or replace function public.trg_recces_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('confirmed','production_ready') then
    update public.outlets set status = 'active' where id = new.outlet_id and status = 'pending_survey';
  end if;
  return null;
end $$;
create trigger recces_after after insert or update of status on public.recces for each row execute function public.trg_recces_after();

-- ---------------------------------------------------------------------------
-- Deployments (an asset installed at an outlet)
-- ---------------------------------------------------------------------------
create table public.deployments (
  id uuid primary key default gen_random_uuid(),
  deployment_code text not null unique,
  outlet_id uuid not null references public.outlets(id),
  po_id uuid not null references public.purchase_orders(id),
  job_id uuid not null references public.jobs(id),
  supplier_id uuid not null references public.suppliers(id),
  spec_id uuid not null references public.job_specs(id),
  spec_version_id uuid references public.spec_versions(id),
  delivery_id uuid references public.deliveries(id),
  quantity int not null check (quantity > 0),
  planned_date date,
  stage text not null default 'planned' check (stage in ('planned','in_transit','delivered','installed','audited','rejected')),
  installation_date date,
  installed_quantity int check (installed_quantity >= 0),
  installer_name text,
  installed_by uuid references public.profiles(id),
  installed_by_vendor boolean,
  install_notes text,
  gps_lat numeric(9,6) check (gps_lat between -90 and 90),
  gps_lon numeric(9,6) check (gps_lon between -180 and 180),
  gps_distance_m numeric(12,1),
  gps_tolerance_m numeric(10,1),
  gps_flag boolean,
  audit_status text not null default 'pending' check (audit_status in ('pending','passed','failed','needs_review')),
  audit_score numeric(5,1),
  audited_by uuid references public.profiles(id),
  audited_at timestamptz,
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deployments_outlet_idx on public.deployments (outlet_id);
create index deployments_job_idx on public.deployments (job_id);
create index deployments_delivery_idx on public.deployments (delivery_id);
create index deployments_supplier_idx on public.deployments (supplier_id, stage);

create or replace function public.trg_deployments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.outlets;
begin
  select * into o from public.outlets where id = new.outlet_id;
  if tg_op = 'INSERT' then new.deployment_code := public._execution_code('DEP');
  else
    new.deployment_code := old.deployment_code; new.po_id := old.po_id; new.job_id := old.job_id; new.supplier_id := old.supplier_id;
    new.created_by := old.created_by; new.updated_at := now();
  end if;
  new.region := o.region; new.market := o.market;
  return new;
end $$;
create trigger deployments_before before insert or update on public.deployments for each row execute function public.trg_deployments_before();

-- Outlet visibility follows deliveries and deployments (outletVisibilityRecompute).
create or replace function public.trg_outlet_visibility() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.outlet_id is not null then
    insert into public.outlet_suppliers (outlet_id, supplier_id, source, added_by)
    values (new.outlet_id, new.supplier_id, case when tg_table_name = 'deliveries' then 'delivery' else 'deployment' end, auth.uid())
    on conflict do nothing;
  end if;
  return null;
end $$;
create trigger deployments_visibility after insert or update of outlet_id on public.deployments for each row execute function public.trg_outlet_visibility();
create trigger deliveries_visibility after insert or update of outlet_id on public.deliveries for each row execute function public.trg_outlet_visibility();

-- Stage sync from the delivery (deploymentStageSync): only automatic stages move; installed/audited/rejected never.
create or replace function public.trg_delivery_stage_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'delivered' then
      update public.deployments set stage = 'delivered' where delivery_id = new.id and stage in ('planned','in_transit');
    elsif new.status in ('dispatched','in_transit') then
      update public.deployments set stage = 'in_transit' where delivery_id = new.id and stage = 'planned';
    elsif new.status in ('planned','booked','failed') then
      update public.deployments set stage = 'planned' where delivery_id = new.id and stage = 'in_transit';
    end if;
  end if;
  return null;
end $$;
create trigger deliveries_stage_sync after update of status on public.deliveries for each row execute function public.trg_delivery_stage_sync();

-- ---------------------------------------------------------------------------
-- Deployment audits, maintenance tickets, visits
-- ---------------------------------------------------------------------------
create table public.deployment_audits (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  scores jsonb not null,
  weights_total numeric(6,2) not null,
  total_score numeric(5,1) not null,
  pass_mark numeric(5,1) not null,
  result text not null check (result in ('passed','failed','needs_review')),
  notes text,
  audited_by uuid references public.profiles(id),
  audited_at timestamptz not null default now()
);
create index deployment_audits_dep_idx on public.deployment_audits (deployment_id, audited_at desc);

create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  deployment_id uuid references public.deployments(id),
  outlet_id uuid not null references public.outlets(id),
  supplier_id uuid references public.suppliers(id),
  issue_type text not null check (issue_type in ('damage','defect','missing_part','incorrect_install','wear','other')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed','cancelled')),
  root_cause text check (root_cause in ('installation','material','design','handling','environmental','other')),
  description text not null check (length(trim(description)) > 0),
  resolution_notes text,
  reported_by uuid references public.profiles(id),
  reported_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  closed_at timestamptz,
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  updated_at timestamptz not null default now()
);
create index maintenance_tickets_status_idx on public.maintenance_tickets (status);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  visit_code text not null unique,
  visit_type text not null check (visit_type in ('installation','maintenance','audit','recce','other')),
  outlet_id uuid not null references public.outlets(id),
  deployment_id uuid references public.deployments(id),
  ticket_id uuid references public.maintenance_tickets(id),
  recce_id uuid references public.recces(id),
  supplier_id uuid references public.suppliers(id),
  assigned_to text,
  scheduled_date date not null,
  completed_date date,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  outcome text check (outcome in ('successful','issues_found','failed','pending')),
  outcome_notes text,
  gps_lat numeric(9,6),
  gps_lon numeric(9,6),
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index visits_outlet_idx on public.visits (outlet_id, scheduled_date);

create or replace function public.trg_outlet_child_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.outlets;
begin
  select * into o from public.outlets where id = new.outlet_id;
  new.region := o.region; new.market := o.market;
  if tg_table_name = 'maintenance_tickets' then
    if tg_op = 'INSERT' then new.ticket_code := public._execution_code('MT'); else new.ticket_code := old.ticket_code; new.updated_at := now(); end if;
  elsif tg_table_name = 'visits' then
    if tg_op = 'INSERT' then new.visit_code := public._execution_code('VIS'); else new.visit_code := old.visit_code; end if;
  end if;
  return new;
end $$;
create trigger maintenance_tickets_before before insert or update on public.maintenance_tickets for each row execute function public.trg_outlet_child_before();
create trigger visits_before before insert or update on public.visits for each row execute function public.trg_outlet_child_before();

-- ---------------------------------------------------------------------------
-- Job quality gates (white paper: vendor onboard -> mock-up -> production -> installation -> post-production closure).
-- Vendor onboarding is the Assure+ supplier gate; the four job-level gates live here. Documents are files with
-- entity_type 'job_quality_gate' and entity_id '<job id>:<gate key>'.
-- ---------------------------------------------------------------------------
create table public.job_quality_gates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  gate_key text not null check (gate_key in ('mockup','production','installation','closure')),
  status text not null default 'pending' check (status in ('pending','passed','failed')),
  notes text,
  signed_off_by uuid references public.profiles(id),
  signed_off_at timestamptz,
  unique (job_id, gate_key)
);

create table public.execution_events (
  id bigint generated always as identity primary key,
  job_id uuid references public.jobs(id) on delete set null,
  entity text not null,
  entity_id uuid,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index execution_events_entity_idx on public.execution_events (entity, entity_id, at desc);
create index execution_events_job_idx on public.execution_events (job_id, at desc);

create or replace function public._execution_event(p_job uuid, p_entity text, p_id uuid, p_event text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.execution_events (job_id, entity, entity_id, event, detail, actor)
  values (p_job, p_entity, p_id, p_event, coalesce(p_detail, '{}'::jsonb), auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Functions: outlets
-- ---------------------------------------------------------------------------
create or replace function public.execution_outlet_save(p_outlet uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_market text := upper(nullif(trim(p_data->>'market'), '')); v_region text;
begin
  perform public._execution_require_internal();
  select region_code into v_region from public.markets where code = v_market;
  if v_region is null then raise exception 'Choose a market'; end if;
  if coalesce(trim(p_data->>'name'), '') = '' or coalesce(trim(p_data->>'outlet_code'), '') = '' then raise exception 'Give the outlet a name and code'; end if;
  if p_outlet is null then
    insert into public.outlets (client_id, name, outlet_code, address_line, city, postcode, region, market, latitude, longitude, store_type, status,
      contact_name, contact_phone, contact_email, notes, created_by)
    values ((nullif(p_data->>'client_id', ''))::uuid, trim(p_data->>'name'), trim(p_data->>'outlet_code'), nullif(trim(p_data->>'address_line'), ''),
      nullif(trim(p_data->>'city'), ''), nullif(trim(p_data->>'postcode'), ''), v_region, v_market,
      (nullif(p_data->>'latitude', ''))::numeric, (nullif(p_data->>'longitude', ''))::numeric, coalesce(nullif(p_data->>'store_type', ''), 'other'),
      coalesce(nullif(p_data->>'status', ''), 'active'), nullif(trim(p_data->>'contact_name'), ''), nullif(trim(p_data->>'contact_phone'), ''),
      nullif(trim(p_data->>'contact_email'), ''), nullif(trim(p_data->>'notes'), ''), auth.uid())
    returning id into v_id;
    perform public._execution_event(null, 'outlet', v_id, 'created', jsonb_build_object('name', p_data->>'name', 'market', v_market));
  else
    update public.outlets set client_id = (nullif(p_data->>'client_id', ''))::uuid, name = trim(p_data->>'name'), outlet_code = trim(p_data->>'outlet_code'),
      address_line = nullif(trim(p_data->>'address_line'), ''), city = nullif(trim(p_data->>'city'), ''), postcode = nullif(trim(p_data->>'postcode'), ''),
      region = v_region, market = v_market, latitude = (nullif(p_data->>'latitude', ''))::numeric, longitude = (nullif(p_data->>'longitude', ''))::numeric,
      store_type = coalesce(nullif(p_data->>'store_type', ''), store_type), status = coalesce(nullif(p_data->>'status', ''), status),
      contact_name = nullif(trim(p_data->>'contact_name'), ''), contact_phone = nullif(trim(p_data->>'contact_phone'), ''),
      contact_email = nullif(trim(p_data->>'contact_email'), ''), notes = nullif(trim(p_data->>'notes'), '')
    where id = p_outlet returning id into v_id;
    if v_id is null then raise exception 'Outlet not found'; end if;
    perform public._execution_event(null, 'outlet', v_id, 'updated', p_data - 'notes');
  end if;
  return v_id;
end $$;

create or replace function public.execution_outlet_set_supplier(p_outlet uuid, p_supplier uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._execution_require_internal();
  if p_visible then
    insert into public.outlet_suppliers (outlet_id, supplier_id, source, added_by) values (p_outlet, p_supplier, 'manual', auth.uid()) on conflict do nothing;
  else
    if exists (select 1 from public.deployments where outlet_id = p_outlet and supplier_id = p_supplier and stage not in ('audited','rejected')) then
      raise exception 'This supplier has live work at the outlet, so it must stay visible';
    end if;
    delete from public.outlet_suppliers where outlet_id = p_outlet and supplier_id = p_supplier;
  end if;
  perform public._execution_event(null, 'outlet', p_outlet, case when p_visible then 'supplier_added' else 'supplier_removed' end, jsonb_build_object('supplier_id', p_supplier));
end $$;

-- Point a delivery at an outlet: destination, coordinates, region and market come from the outlet.
create or replace function public.execution_delivery_set_outlet(p_delivery uuid, p_outlet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; o public.outlets;
begin
  perform public._execution_require_internal();
  select * into d from public.deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Delivery not found'; end if;
  if d.status in ('delivered','cancelled') then raise exception 'A % delivery can''t be changed', d.status; end if;
  select * into o from public.outlets where id = p_outlet;
  if o.id is null then raise exception 'Outlet not found'; end if;
  update public.deliveries set outlet_id = o.id, recipient_name = coalesce(recipient_name, o.name), recipient_contact = coalesce(recipient_contact, o.contact_name),
    recipient_phone = coalesce(recipient_phone, o.contact_phone), recipient_email = coalesce(recipient_email, o.contact_email),
    address_line = o.address_line, city = o.city, postcode = o.postcode, region = o.region, market = o.market,
    destination_lat = o.latitude, destination_lon = o.longitude,
    distance_km = case when origin_lat is not null and o.latitude is not null then null else distance_km end
  where id = p_delivery;
  perform public._logistics_event(p_delivery, null, 'outlet_linked', jsonb_build_object('outlet_id', p_outlet, 'outlet', o.name));
end $$;

-- ---------------------------------------------------------------------------
-- Functions: recces
-- ---------------------------------------------------------------------------
create or replace function public._recce_fields(p_id uuid, p_data jsonb) returns void
language sql security definer set search_path = public as $$
  update public.recces set product_name = nullif(trim(p_data->>'product_name'), ''), location_in_store = nullif(trim(p_data->>'location_in_store'), ''),
    surface_type = nullif(p_data->>'surface_type', ''),
    available_width_cm = (nullif(p_data->>'available_width_cm', ''))::numeric, available_height_cm = (nullif(p_data->>'available_height_cm', ''))::numeric,
    available_depth_cm = (nullif(p_data->>'available_depth_cm', ''))::numeric, unit_width_cm = (nullif(p_data->>'unit_width_cm', ''))::numeric,
    unit_height_cm = (nullif(p_data->>'unit_height_cm', ''))::numeric, unit_depth_cm = (nullif(p_data->>'unit_depth_cm', ''))::numeric,
    wall_space_available = (nullif(p_data->>'wall_space_available', ''))::boolean, power_outlet_nearby = (nullif(p_data->>'power_outlet_nearby', ''))::boolean,
    survey_date = coalesce((nullif(p_data->>'survey_date', ''))::date, survey_date), notes = nullif(trim(p_data->>'notes'), '')
  where id = p_id;
$$;

-- Internal: create/update, including the recommended dimensions (internal only) and the job link.
create or replace function public.execution_recce_save(p_recce uuid, p_outlet uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.recces; v_id uuid := p_recce;
begin
  perform public._execution_require_internal();
  if v_id is null then
    if not exists (select 1 from public.outlets where id = p_outlet) then raise exception 'Choose an outlet'; end if;
    insert into public.recces (outlet_id, surveyed_by, region, market) values (p_outlet, auth.uid(), 'EMEA', 'GB') returning id into v_id;
  else
    select * into r from public.recces where id = v_id for update;
    if r.id is null then raise exception 'Recce not found'; end if;
  end if;
  perform public._recce_fields(v_id, p_data);
  update public.recces set job_id = (nullif(p_data->>'job_id', ''))::uuid,
    recommended_width_cm = (nullif(p_data->>'recommended_width_cm', ''))::numeric, recommended_height_cm = (nullif(p_data->>'recommended_height_cm', ''))::numeric,
    recommended_depth_cm = (nullif(p_data->>'recommended_depth_cm', ''))::numeric, recommended_notes = nullif(trim(p_data->>'recommended_notes'), ''),
    recommended_by = case when nullif(p_data->>'recommended_width_cm', '') is not null then auth.uid() else recommended_by end
  where id = v_id;
  perform public._execution_event((nullif(p_data->>'job_id', ''))::uuid, 'recce', v_id, case when p_recce is null then 'created' else 'updated' end, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.execution_recce_set_status(p_recce uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.recces;
begin
  perform public._execution_require_internal();
  select * into r from public.recces where id = p_recce for update;
  if r.id is null then raise exception 'Recce not found'; end if;
  if p_status not in ('draft','confirmed','production_ready') then raise exception 'Unknown status'; end if;
  if p_status in ('confirmed','production_ready') and r.units_fit is null then raise exception 'Measure the available space and the unit size first'; end if;
  if p_status = 'production_ready' and (r.recommended_width_cm is null or r.recommended_height_cm is null) then
    raise exception 'Set the recommended finished size before marking the recce production ready';
  end if;
  update public.recces set status = p_status where id = p_recce;
  perform public._execution_event(r.job_id, 'recce', p_recce, 'status_changed', jsonb_build_object('from', r.status, 'to', p_status));
end $$;

-- ---------------------------------------------------------------------------
-- Functions: deployments, installs, audits
-- ---------------------------------------------------------------------------
create or replace function public.execution_deployment_create(p_outlet uuid, p_po uuid, p_spec uuid, p_spec_version uuid, p_quantity int,
  p_planned_date date default null, p_delivery uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; d public.deliveries; v_id uuid; v_stage text := 'planned';
begin
  perform public._execution_require_internal();
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null then raise exception 'Purchase order not found'; end if;
  if p.status not in ('issued','accepted') then raise exception 'Plan installs once the PO is approved and issued'; end if;
  if not exists (select 1 from public.outlets where id = p_outlet) then raise exception 'Choose an outlet'; end if;
  if not exists (select 1 from public.estimate_lines where estimate_id = p.estimate_id and spec_id = p_spec) then raise exception 'That spec is not on this purchase order'; end if;
  if p_spec_version is not null and not exists (select 1 from public.spec_versions where id = p_spec_version and spec_id = p_spec) then raise exception 'That version does not belong to the spec'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter the quantity to install'; end if;
  if p_delivery is not null then
    select * into d from public.deliveries where id = p_delivery;
    if d.id is null or d.po_id <> p_po then raise exception 'That delivery is not on this purchase order'; end if;
    v_stage := case when d.status = 'delivered' then 'delivered' when d.status in ('dispatched','in_transit') then 'in_transit' else 'planned' end;
  end if;
  insert into public.deployments (outlet_id, po_id, job_id, supplier_id, spec_id, spec_version_id, delivery_id, quantity, planned_date, stage, region, market, created_by)
  values (p_outlet, p_po, p.job_id, p.supplier_id, p_spec, p_spec_version, p_delivery, p_quantity, p_planned_date, v_stage, 'EMEA', 'GB', auth.uid())
  returning id into v_id;
  perform public._execution_event(p.job_id, 'deployment', v_id, 'created', jsonb_build_object('outlet_id', p_outlet, 'quantity', p_quantity, 'stage', v_stage));
  return v_id;
end $$;

create or replace function public._execution_install(dep public.deployments, p_date date, p_installer text, p_quantity int, p_lat numeric, p_lon numeric, p_notes text, p_vendor boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o public.outlets; v_dist numeric; v_tol numeric := public._execution_rule('EXR-GPS', 200); v_flag boolean; j public.jobs;
begin
  if dep.stage not in ('planned','in_transit','delivered') then raise exception 'This deployment is already %', dep.stage; end if;
  if dep.delivery_id is not null and dep.stage <> 'delivered' then raise exception 'The goods haven''t been delivered to the outlet yet'; end if;
  if p_date is null or p_date > current_date then raise exception 'Enter the installation date (not in the future)'; end if;
  if coalesce(trim(p_installer), '') = '' then raise exception 'Enter who installed it'; end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > dep.quantity then raise exception 'Installed quantity must be between 0 and %', dep.quantity; end if;
  if not exists (select 1 from public.files where entity_type = 'deployment' and entity_id = dep.id::text and lower(coalesce(label, '')) = 'before')
     or not exists (select 1 from public.files where entity_type = 'deployment' and entity_id = dep.id::text and lower(coalesce(label, '')) = 'after') then
    raise exception 'Upload a before and an after photo first';
  end if;
  select * into o from public.outlets where id = dep.outlet_id;
  v_dist := round(public.geo_distance_km(p_lat, p_lon, o.latitude, o.longitude) * 1000, 1);
  v_flag := v_dist is null or v_dist > v_tol;
  update public.deployments set stage = 'installed', installation_date = p_date, installer_name = trim(p_installer), installed_quantity = p_quantity,
    installed_by = auth.uid(), installed_by_vendor = p_vendor, install_notes = nullif(trim(p_notes), ''), gps_lat = p_lat, gps_lon = p_lon,
    gps_distance_m = v_dist, gps_tolerance_m = v_tol, gps_flag = v_flag,
    audit_status = case when v_flag then 'needs_review' else 'pending' end, audit_score = null, audited_by = null, audited_at = null
  where id = dep.id;
  perform public._execution_event(dep.job_id, 'deployment', dep.id, 'installed', jsonb_build_object('quantity', p_quantity, 'gps_distance_m', v_dist, 'gps_flag', v_flag, 'by_vendor', p_vendor));
  select * into j from public.jobs where id = dep.job_id;
  perform public.notify(j.manager, 'execution', 'Install recorded', format('%s was installed%s.', dep.deployment_code,
    case when v_flag then format(' but the GPS position is %s from the outlet', coalesce(v_dist::text || ' m', 'not recorded')) else '' end), '/execution/deployments/' || dep.id);
end $$;

create or replace function public.execution_record_install(p_deployment uuid, p_installation_date date, p_installer_name text, p_quantity int,
  p_lat numeric, p_lon numeric, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare dep public.deployments;
begin
  perform public._execution_require_internal();
  select * into dep from public.deployments where id = p_deployment for update;
  if dep.id is null then raise exception 'Deployment not found'; end if;
  perform public._execution_install(dep, p_installation_date, p_installer_name, p_quantity, p_lat, p_lon, p_notes, false);
end $$;

-- Display score: Σ(weight x score) / 100 over the active display_scoring criteria (scores 0-100 each). Weights must total 100.
create or replace function public.execution_display_score(p_scores jsonb)
returns table (total numeric, weights_total numeric, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_total numeric := 0; v_w numeric := 0; v_detail jsonb := '[]'::jsonb; v_s numeric;
begin
  for r in select * from public.library_records where library_key = 'display_scoring' and status = 'active'
             and effective_from <= current_date and (effective_to is null or effective_to >= current_date) order by code loop
    v_s := (p_scores->>r.code)::numeric;
    if v_s is null or v_s < 0 or v_s > 100 then raise exception 'Score "%" from 0 to 100', r.name; end if;
    v_w := v_w + coalesce((r.data->>'weight_percent')::numeric, 0);
    v_total := v_total + coalesce((r.data->>'weight_percent')::numeric, 0) * v_s / 100;
    v_detail := v_detail || jsonb_build_object('code', r.code, 'name', r.name, 'version', r.version, 'record_id', r.id,
      'weight', (r.data->>'weight_percent')::numeric, 'score', v_s);
  end loop;
  if jsonb_array_length(v_detail) = 0 then raise exception 'Display scoring criteria are not set up in the Execution+ Watchtower'; end if;
  if v_w <> 100 then raise exception 'Display scoring weights must total 100 percent (they total % percent). Fix them in the Watchtower.', v_w; end if;
  return query select round(v_total, 1), v_w, v_detail;
end $$;

create or replace function public.execution_audit_deployment(p_deployment uuid, p_scores jsonb, p_notes text default null, p_needs_review boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare dep public.deployments; s record; v_pass numeric := public._execution_rule('EXR-PASS', 70); v_result text; v_id uuid; v_ticket uuid;
begin
  perform public._execution_require_internal();
  select * into dep from public.deployments where id = p_deployment for update;
  if dep.id is null then raise exception 'Deployment not found'; end if;
  if dep.stage not in ('installed','audited','rejected') then raise exception 'Only an installed deployment can be audited'; end if;
  if dep.installed_by = auth.uid() then raise exception 'You recorded this install, so someone else must audit it' using errcode = '42501'; end if;
  select * into s from public.execution_display_score(p_scores);
  v_result := case when p_needs_review then 'needs_review' when s.total >= v_pass then 'passed' else 'failed' end;
  if v_result <> 'passed' and coalesce(trim(p_notes), '') = '' then raise exception 'Add a note saying what needs fixing'; end if;
  insert into public.deployment_audits (deployment_id, scores, weights_total, total_score, pass_mark, result, notes, audited_by)
  values (p_deployment, s.detail, s.weights_total, s.total, v_pass, v_result, nullif(trim(p_notes), ''), auth.uid()) returning id into v_id;
  insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
  select (x->>'record_id')::uuid, 'deployment_audits', v_id::text, dep.deployment_code from jsonb_array_elements(s.detail) x on conflict do nothing;
  update public.deployments set audit_status = v_result, audit_score = s.total, audited_by = auth.uid(), audited_at = now(),
    stage = case v_result when 'passed' then 'audited' when 'failed' then 'rejected' else 'installed' end
  where id = p_deployment;
  if v_result = 'failed' then
    insert into public.maintenance_tickets (deployment_id, outlet_id, supplier_id, issue_type, severity, description, reported_by, region, market)
    values (p_deployment, dep.outlet_id, dep.supplier_id, 'incorrect_install', 'medium', 'Audit failed (' || s.total || '%): ' || trim(p_notes), auth.uid(), dep.region, dep.market)
    returning id into v_ticket;
    perform public.notify_supplier(dep.supplier_id, 'execution', 'Install audit failed', format('%s scored %s%% (pass mark %s%%): %s', dep.deployment_code, s.total, v_pass, trim(p_notes)), '/vendor');
  end if;
  perform public._execution_event(dep.job_id, 'deployment', p_deployment, 'audited', jsonb_build_object('result', v_result, 'score', s.total, 'pass_mark', v_pass, 'ticket_id', v_ticket));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Functions: maintenance tickets and visits
-- ---------------------------------------------------------------------------
create or replace function public.execution_ticket_create(p_deployment uuid, p_outlet uuid, p_issue_type text, p_severity text, p_description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare dep public.deployments; v_outlet uuid := p_outlet; v_id uuid;
begin
  perform public._execution_require_internal();
  if p_deployment is not null then
    select * into dep from public.deployments where id = p_deployment;
    if dep.id is null then raise exception 'Deployment not found'; end if;
    v_outlet := dep.outlet_id;
  end if;
  if v_outlet is null then raise exception 'Choose an outlet or a deployment'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Describe the issue'; end if;
  insert into public.maintenance_tickets (deployment_id, outlet_id, supplier_id, issue_type, severity, description, reported_by, region, market)
  values (p_deployment, v_outlet, dep.supplier_id, p_issue_type, coalesce(nullif(p_severity, ''), 'medium'), trim(p_description), auth.uid(), 'EMEA', 'GB')
  returning id into v_id;
  perform public._execution_event(dep.job_id, 'ticket', v_id, 'created', jsonb_build_object('issue_type', p_issue_type, 'severity', p_severity));
  return v_id;
end $$;

create or replace function public.execution_ticket_move(p_ticket uuid, p_status text, p_note text default null, p_root_cause text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.maintenance_tickets; ok boolean;
begin
  perform public._execution_require_internal();
  select * into t from public.maintenance_tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  ok := case t.status
    when 'open' then p_status in ('in_progress','cancelled')
    when 'in_progress' then p_status in ('resolved','open','cancelled')
    when 'resolved' then p_status in ('closed','in_progress')
    else false end;
  if not ok then raise exception 'A ticket can''t move from % to %', replace(t.status, '_', ' '), replace(p_status, '_', ' '); end if;
  if p_status = 'resolved' and (coalesce(trim(p_note), '') = '' or p_root_cause is null) then raise exception 'Record what was done and the root cause'; end if;
  if p_status = 'cancelled' and coalesce(trim(p_note), '') = '' then raise exception 'Say why the ticket is cancelled'; end if;
  update public.maintenance_tickets set status = p_status,
    root_cause = coalesce(p_root_cause, root_cause),
    resolution_notes = case when p_status = 'resolved' then trim(p_note) else resolution_notes end,
    resolved_by = case when p_status = 'resolved' then auth.uid() when p_status = 'in_progress' then null else resolved_by end,
    resolved_at = case when p_status = 'resolved' then now() when p_status = 'in_progress' then null else resolved_at end,
    closed_at = case when p_status in ('closed','cancelled') then now() else null end
  where id = p_ticket;
  perform public._execution_event((select job_id from public.deployments where id = t.deployment_id), 'ticket', p_ticket, 'status_changed',
    jsonb_build_object('from', t.status, 'to', p_status, 'note', p_note, 'root_cause', p_root_cause));
end $$;

create or replace function public.execution_visit_create(p_outlet uuid, p_type text, p_scheduled date, p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._execution_require_internal();
  if not exists (select 1 from public.outlets where id = p_outlet) then raise exception 'Choose an outlet'; end if;
  if p_scheduled is null then raise exception 'Pick a date for the visit'; end if;
  insert into public.visits (visit_type, outlet_id, deployment_id, ticket_id, recce_id, supplier_id, assigned_to, scheduled_date, notes, created_by, region, market)
  values (p_type, p_outlet, (nullif(p_data->>'deployment_id', ''))::uuid, (nullif(p_data->>'ticket_id', ''))::uuid, (nullif(p_data->>'recce_id', ''))::uuid,
    (nullif(p_data->>'supplier_id', ''))::uuid, nullif(trim(p_data->>'assigned_to'), ''), p_scheduled, nullif(trim(p_data->>'notes'), ''), auth.uid(), 'EMEA', 'GB')
  returning id into v_id;
  perform public._execution_event(null, 'visit', v_id, 'scheduled', jsonb_build_object('type', p_type, 'date', p_scheduled));
  return v_id;
end $$;

create or replace function public.execution_visit_update(p_visit uuid, p_status text, p_outcome text default null, p_notes text default null,
  p_lat numeric default null, p_lon numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.visits; ok boolean;
begin
  perform public._execution_require_internal();
  select * into v from public.visits where id = p_visit for update;
  if v.id is null then raise exception 'Visit not found'; end if;
  ok := case v.status when 'scheduled' then p_status in ('in_progress','completed','cancelled') when 'in_progress' then p_status in ('completed','cancelled') else false end;
  if not ok then raise exception 'A visit can''t move from % to %', replace(v.status, '_', ' '), replace(p_status, '_', ' '); end if;
  if p_status = 'completed' and p_outcome is null then raise exception 'Record the outcome'; end if;
  if (p_status = 'cancelled' or p_outcome in ('issues_found','failed')) and coalesce(trim(p_notes), '') = '' then raise exception 'Add a note'; end if;
  update public.visits set status = p_status, outcome = coalesce(p_outcome, outcome), outcome_notes = coalesce(nullif(trim(p_notes), ''), outcome_notes),
    completed_date = case when p_status = 'completed' then current_date end, gps_lat = coalesce(p_lat, gps_lat), gps_lon = coalesce(p_lon, gps_lon)
  where id = p_visit;
  perform public._execution_event(null, 'visit', p_visit, 'status_changed', jsonb_build_object('from', v.status, 'to', p_status, 'outcome', p_outcome));
end $$;

-- ---------------------------------------------------------------------------
-- Quality gates and job close
-- ---------------------------------------------------------------------------
create or replace function public.execution_gate_order(p_key text) returns int language sql immutable as $$
  select case p_key when 'mockup' then 1 when 'production' then 2 when 'installation' then 3 when 'closure' then 4 end;
$$;

create or replace function public.execution_gate_sign_off(p_job uuid, p_gate text, p_passed boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.jobs; g public.job_quality_gates; v_prev text;
begin
  perform public._execution_require_internal();
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status in ('closed','cancelled') then raise exception 'This job is %', j.status; end if;
  if public.execution_gate_order(p_gate) is null then raise exception 'Unknown quality gate'; end if;
  insert into public.job_quality_gates (job_id, gate_key) select p_job, k from unnest(array['mockup','production','installation','closure']) k on conflict do nothing;
  select gate_key into v_prev from public.job_quality_gates
   where job_id = p_job and public.execution_gate_order(gate_key) < public.execution_gate_order(p_gate) and status <> 'passed'
   order by public.execution_gate_order(gate_key) limit 1;
  if v_prev is not null then raise exception 'Pass the % gate first', v_prev; end if;
  if not exists (select 1 from public.files where entity_type = 'job_quality_gate' and entity_id = p_job::text || ':' || p_gate) then
    raise exception 'Upload the check sheet for this gate before signing it off';
  end if;
  if not p_passed and coalesce(trim(p_notes), '') = '' then raise exception 'Say why the gate failed'; end if;
  select * into g from public.job_quality_gates where job_id = p_job and gate_key = p_gate for update;
  update public.job_quality_gates set status = case when p_passed then 'passed' else 'failed' end, notes = nullif(trim(p_notes), ''),
    signed_off_by = auth.uid(), signed_off_at = now() where id = g.id;
  perform public._execution_event(p_job, 'quality_gate', g.id, case when p_passed then 'gate_passed' else 'gate_failed' end, jsonb_build_object('gate', p_gate, 'notes', p_notes));
  perform public._sourcing_event(p_job, 'quality_gate', g.id, case when p_passed then 'gate_passed' else 'gate_failed' end, jsonb_build_object('gate', p_gate));
end $$;

-- What blocks closing a job. Returns {can_close, checks: [{key, label, ok, detail, overridable}]}.
create or replace function public.job_close_check(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j public.jobs; v jsonb := '[]'::jsonb; n_po int; n_pending int; n_bad_sup int; n_gates int; v_gate_detail text;
  n_del int; n_del_open int; n_pod_open int; n_dep int; n_dep_open int;
begin
  perform public._execution_require_internal();
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  select count(*) filter (where status in ('issued','accepted')), count(*) filter (where status = 'pending_approval') into n_po, n_pending
    from public.purchase_orders where job_id = p_job;
  v := v || jsonb_build_object('key', 'po', 'label', 'Supplier PO approved', 'ok', n_po > 0 and n_pending = 0, 'overridable', false,
    'detail', case when n_po = 0 then 'No approved purchase order on this job' when n_pending > 0 then n_pending || ' PO(s) still waiting for approval' else n_po || ' approved PO(s)' end);
  select count(*) into n_bad_sup from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
   where p.job_id = p_job and p.status in ('issued','accepted') and not s.active;
  v := v || jsonb_build_object('key', 'vendor', 'label', 'Vendor onboarded (Assure+)', 'ok', n_bad_sup = 0, 'overridable', false,
    'detail', case when n_bad_sup = 0 then 'Suppliers on the PO(s) are active in Assure+' else n_bad_sup || ' supplier(s) are inactive in Assure+' end);
  select count(*) filter (where status = 'passed'),
         string_agg(case when status <> 'passed' then gate_key end, ', ' order by public.execution_gate_order(gate_key))
    into n_gates, v_gate_detail from public.job_quality_gates where job_id = p_job;
  v := v || jsonb_build_object('key', 'gates', 'label', 'Quality gates passed', 'ok', coalesce(n_gates, 0) = 4, 'overridable', false,
    'detail', case when coalesce(n_gates, 0) = 4 then 'Mock-up, production, installation and closure signed off' else coalesce(n_gates, 0) || ' of 4 passed' || coalesce('; not passed: ' || v_gate_detail, '') end);
  select count(*), count(*) filter (where status <> 'delivered') into n_del, n_del_open from public.deliveries where job_id = p_job and status <> 'cancelled';
  select count(*) into n_pod_open from public.shipments s join public.deliveries d on d.id = s.delivery_id
   where d.job_id = p_job and d.status <> 'cancelled' and s.pod_status <> 'verified';
  v := v || jsonb_build_object('key', 'deliveries', 'label', 'Deliveries confirmed and POD verified', 'ok', n_del > 0 and n_del_open = 0 and n_pod_open = 0, 'overridable', true,
    'detail', case when n_del = 0 then 'No deliveries recorded' else format('%s of %s delivered; %s POD(s) not verified', n_del - n_del_open, n_del, n_pod_open) end);
  select count(*), count(*) filter (where not (stage = 'audited' and audit_status = 'passed')) into n_dep, n_dep_open from public.deployments where job_id = p_job;
  v := v || jsonb_build_object('key', 'deployments', 'label', 'Installs done and audited', 'ok', n_dep_open = 0, 'overridable', false,
    'detail', case when n_dep = 0 then 'No installations on this job' else format('%s of %s installed and passed audit', n_dep - n_dep_open, n_dep) end);
  return jsonb_build_object('job_id', p_job, 'status', j.status,
    'can_close', j.status not in ('closed','cancelled') and not exists (select 1 from jsonb_array_elements(v) x where not (x->>'ok')::boolean),
    'checks', v);
end $$;

create or replace function public.execution_close_job(p_job uuid, p_override_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.jobs; c jsonb; v_hard text; v_soft text;
begin
  perform public._execution_require_internal();
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status not in ('ordered','in_production','delivered') then raise exception 'A % job can''t be closed', replace(j.status, '_', ' '); end if;
  c := public.job_close_check(p_job);
  select string_agg(x->>'label', '; ') into v_hard from jsonb_array_elements(c->'checks') x where not (x->>'ok')::boolean and not (x->>'overridable')::boolean;
  if v_hard is not null then raise exception 'This job can''t close yet: %', v_hard; end if;
  select string_agg(x->>'label', '; ') into v_soft from jsonb_array_elements(c->'checks') x where not (x->>'ok')::boolean and (x->>'overridable')::boolean;
  if v_soft is not null and coalesce(trim(p_override_reason), '') = '' then
    raise exception 'Not done: %. Give an override reason to close anyway.', v_soft;
  end if;
  perform set_config('sourcing.system_write', 'on', true);
  update public.jobs set status = 'closed', closed_at = now() where id = p_job;
  perform set_config('sourcing.system_write', 'off', true);
  perform public._execution_event(p_job, 'job', p_job, 'closed', jsonb_build_object('from', j.status, 'override', v_soft, 'override_reason', nullif(trim(p_override_reason), ''), 'checks', c->'checks'));
  perform public._sourcing_event(p_job, 'job', p_job, 'status_changed', jsonb_build_object('from', j.status, 'to', 'closed', 'note', 'Closed in Execution+',
    'override', v_soft, 'override_reason', nullif(trim(p_override_reason), '')));
end $$;

-- ---------------------------------------------------------------------------
-- Vendor functions (vendor portal), scoped to my_supplier_id() and the PO behind each deployment
-- ---------------------------------------------------------------------------
create or replace function public.execution_vendor_deployments() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'deployment_code', d.deployment_code, 'po_number', p.po_number, 'job_number', j.job_number,
    'spec_title', sp.title, 'spec_version', v.name, 'quantity', d.quantity, 'planned_date', d.planned_date, 'stage', d.stage,
    'outlet_id', o.id, 'outlet_name', o.name, 'outlet_code', o.outlet_code, 'address_line', o.address_line, 'city', o.city, 'postcode', o.postcode,
    'market', o.market, 'region', o.region, 'outlet_lat', o.latitude, 'outlet_lon', o.longitude,
    'installation_date', d.installation_date, 'installed_quantity', d.installed_quantity, 'installer_name', d.installer_name,
    'gps_distance_m', d.gps_distance_m, 'gps_flag', d.gps_flag, 'audit_status', d.audit_status, 'audit_score', d.audit_score)
    order by d.planned_date nulls last, d.deployment_code), '[]'::jsonb)
  from public.deployments d join public.purchase_orders p on p.id = d.po_id join public.jobs j on j.id = d.job_id
  join public.job_specs sp on sp.id = d.spec_id left join public.spec_versions v on v.id = d.spec_version_id
  join public.outlets o on o.id = d.outlet_id
  where public.my_supplier_id() is not null and d.supplier_id = public.my_supplier_id() and p.supplier_id = public.my_supplier_id() and p.status in ('issued','accepted');
$$;

-- The vendor uploads before/after photos with file_register('execution', 'deployment', <id>, ..., label 'Before'/'After') first.
-- Audit status is never a parameter: only the internal audit sets it.
create or replace function public.execution_vendor_record_install(p_deployment uuid, p_installation_date date, p_installer_name text, p_quantity int,
  p_lat numeric, p_lon numeric, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare dep public.deployments; v_sup uuid := public.my_supplier_id();
begin
  select d.* into dep from public.deployments d join public.purchase_orders p on p.id = d.po_id
   where d.id = p_deployment and v_sup is not null and d.supplier_id = v_sup and p.supplier_id = v_sup and p.status in ('issued','accepted')
   for update of d;
  if dep.id is null then raise exception 'Deployment not found' using errcode = '42501'; end if;
  perform public._execution_install(dep, p_installation_date, p_installer_name, p_quantity, p_lat, p_lon, p_notes, true);
end $$;

create or replace function public.execution_vendor_outlets() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'outlet_code', o.outlet_code, 'address_line', o.address_line, 'city', o.city,
    'postcode', o.postcode, 'region', o.region, 'market', o.market, 'latitude', o.latitude, 'longitude', o.longitude, 'store_type', o.store_type, 'status', o.status)
    order by o.name), '[]'::jsonb)
  from public.outlets o join public.outlet_suppliers os on os.outlet_id = o.id
  where public.my_supplier_id() is not null and os.supplier_id = public.my_supplier_id();
$$;

create or replace function public.execution_vendor_recces() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'recce_code', r.recce_code, 'outlet_id', r.outlet_id, 'outlet_name', o.name,
    'product_name', r.product_name, 'location_in_store', r.location_in_store, 'surface_type', r.surface_type,
    'available_width_cm', r.available_width_cm, 'available_height_cm', r.available_height_cm, 'available_depth_cm', r.available_depth_cm,
    'unit_width_cm', r.unit_width_cm, 'unit_height_cm', r.unit_height_cm, 'unit_depth_cm', r.unit_depth_cm, 'units_fit', r.units_fit,
    'wall_space_available', r.wall_space_available, 'power_outlet_nearby', r.power_outlet_nearby, 'survey_date', r.survey_date,
    'status', r.status, 'notes', r.notes) order by r.created_at desc), '[]'::jsonb)
  from public.recces r join public.outlets o on o.id = r.outlet_id
  where public.my_supplier_id() is not null and r.supplier_id = public.my_supplier_id();
$$;

-- Vendor recce capture for an outlet visible to them. New or own draft only; recommended dimensions are internal-only.
create or replace function public.execution_vendor_recce_save(p_recce uuid, p_outlet uuid, p_data jsonb, p_confirm boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); r public.recces; v_id uuid := p_recce;
begin
  if v_sup is null then raise exception 'Vendor access only' using errcode = '42501'; end if;
  if v_id is null then
    if not exists (select 1 from public.outlet_suppliers where outlet_id = p_outlet and supplier_id = v_sup) then raise exception 'Outlet not found' using errcode = '42501'; end if;
    insert into public.recces (outlet_id, supplier_id, surveyed_by, captured_by_vendor, region, market) values (p_outlet, v_sup, auth.uid(), true, 'EMEA', 'GB') returning id into v_id;
  else
    select * into r from public.recces where id = v_id for update;
    if r.id is null or r.supplier_id is distinct from v_sup then raise exception 'Recce not found' using errcode = '42501'; end if;
    if r.status <> 'draft' then raise exception 'This recce is already confirmed; ask adm Indicia to reopen it'; end if;
  end if;
  perform public._recce_fields(v_id, p_data);
  if p_confirm then
    if (select units_fit from public.recces where id = v_id) is null then raise exception 'Measure the available space and the unit size before confirming'; end if;
    update public.recces set status = 'confirmed' where id = v_id;
  end if;
  perform public._execution_event(null, 'recce', v_id, case when p_recce is null then 'created' else 'updated' end, jsonb_build_object('by_vendor', true, 'confirmed', p_confirm));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Read views
-- ---------------------------------------------------------------------------
-- v_deliveries again, now with the outlet link (deliveries.outlet_id is added above).
drop view public.v_deliveries;
create view public.v_deliveries with (security_invoker = true) as
  select d.*, p.po_number, p.status as po_status, j.job_number, j.title as job_title, c.name as client_name, su.name as supplier_name, su.supplier_code,
         sp.title as spec_title, sp.spec_no, v.name as spec_version_name, mk.name as market_name, om.name as origin_market_name,
         coalesce(sh.shipped, 0)::int as quantity_shipped, (d.quantity - coalesce(sh.shipped, 0))::int as quantity_remaining,
         coalesce(sh.shipments, 0)::int as shipment_count, coalesce(sh.pods_to_verify, 0)::int as pods_to_verify,
         coalesce(sh.pods_verified, 0)::int as pods_verified,
         es.kgco2e, es.planned_kgco2e, es.complete as co2e_complete,
         (d.status = 'delivered' and d.actual_delivery_date <= d.planned_delivery_date) as on_time,
         (d.status = 'delivered' and coalesce(sh.shipped, 0) >= d.quantity) as in_full,
         o.name as outlet_name, o.outlet_code
    from public.deliveries d
    join public.purchase_orders p on p.id = d.po_id
    join public.jobs j on j.id = d.job_id
    join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers su on su.id = d.supplier_id
    join public.job_specs sp on sp.id = d.spec_id
    left join public.spec_versions v on v.id = d.spec_version_id
    left join public.markets mk on mk.code = d.market
    left join public.markets om on om.code = d.origin_market
    left join public.outlets o on o.id = d.outlet_id
    left join lateral (select sum(quantity_shipped) shipped, count(*) shipments, count(*) filter (where pod_status = 'received') pods_to_verify,
                              count(*) filter (where pod_status = 'verified') pods_verified
                         from public.shipments where delivery_id = d.id) sh on true
    left join lateral (select kgco2e, planned_kgco2e, complete from public.emission_snapshots where delivery_id = d.id order by computed_at desc limit 1) es on true;
revoke insert, update, delete on public.v_deliveries from authenticated, anon;

create view public.v_outlets with (security_invoker = true) as
  select o.*, c.name as client_name, m.name as market_name,
         (select count(*) from public.deployments d where d.outlet_id = o.id)::int as deployment_count,
         (select count(*) from public.recces r where r.outlet_id = o.id)::int as recce_count,
         (select count(*) from public.maintenance_tickets t where t.outlet_id = o.id and t.status in ('open','in_progress'))::int as open_tickets,
         (select round(avg(d.audit_score), 1) from public.deployments d where d.outlet_id = o.id and d.audit_score is not null) as avg_audit_score
    from public.outlets o left join public.sourcing_clients c on c.id = o.client_id left join public.markets m on m.code = o.market;

create view public.v_recces with (security_invoker = true) as
  select r.*, o.name as outlet_name, o.outlet_code, j.job_number, s.name as supplier_name, p.full_name as surveyed_by_name
    from public.recces r join public.outlets o on o.id = r.outlet_id left join public.jobs j on j.id = r.job_id
    left join public.suppliers s on s.id = r.supplier_id left join public.profiles p on p.id = r.surveyed_by;

create view public.v_deployments with (security_invoker = true) as
  select d.*, o.name as outlet_name, o.outlet_code, o.latitude as outlet_lat, o.longitude as outlet_lon, o.store_type, o.client_id as outlet_client_id,
         p.po_number, j.job_number, j.title as job_title, j.campaign_name, j.brand, c.name as client_name, s.name as supplier_name,
         sp.title as spec_title, v.name as spec_version_name, dl.delivery_number, dl.status as delivery_status,
         ib.full_name as installed_by_name, ab.full_name as audited_by_name
    from public.deployments d join public.outlets o on o.id = d.outlet_id join public.purchase_orders p on p.id = d.po_id
    join public.jobs j on j.id = d.job_id join public.sourcing_clients c on c.id = j.client_id join public.suppliers s on s.id = d.supplier_id
    join public.job_specs sp on sp.id = d.spec_id left join public.spec_versions v on v.id = d.spec_version_id
    left join public.deliveries dl on dl.id = d.delivery_id
    left join public.profiles ib on ib.id = d.installed_by left join public.profiles ab on ab.id = d.audited_by;

create view public.v_deployment_audits with (security_invoker = true) as
  select a.*, d.deployment_code, d.outlet_id, d.job_id, d.region, d.market, o.name as outlet_name, j.job_number, j.campaign_name, j.brand,
         c.name as client_name, s.name as supplier_name, p.full_name as audited_by_name
    from public.deployment_audits a join public.deployments d on d.id = a.deployment_id join public.outlets o on o.id = d.outlet_id
    join public.jobs j on j.id = d.job_id join public.sourcing_clients c on c.id = j.client_id join public.suppliers s on s.id = d.supplier_id
    left join public.profiles p on p.id = a.audited_by;

create view public.v_maintenance_tickets with (security_invoker = true) as
  select t.*, o.name as outlet_name, d.deployment_code, d.job_id, s.name as supplier_name, rb.full_name as reported_by_name
    from public.maintenance_tickets t join public.outlets o on o.id = t.outlet_id left join public.deployments d on d.id = t.deployment_id
    left join public.suppliers s on s.id = t.supplier_id left join public.profiles rb on rb.id = t.reported_by;

create view public.v_visits with (security_invoker = true) as
  select v.*, o.name as outlet_name, d.deployment_code, t.ticket_code, r.recce_code, s.name as supplier_name
    from public.visits v join public.outlets o on o.id = v.outlet_id left join public.deployments d on d.id = v.deployment_id
    left join public.maintenance_tickets t on t.id = v.ticket_id left join public.recces r on r.id = v.recce_id
    left join public.suppliers s on s.id = v.supplier_id;

create view public.v_job_quality_gates with (security_invoker = true) as
  select j.id as job_id, k.gate_key, k.seq, k.label, coalesce(g.status, 'pending') as status, g.notes, g.signed_off_by, g.signed_off_at,
         p.full_name as signed_off_by_name,
         (select count(*) from public.files f where f.entity_type = 'job_quality_gate' and f.entity_id = j.id::text || ':' || k.gate_key)::int as document_count
    from public.jobs j
    cross join (values ('mockup', 1, 'Pre-production mock-up check sheet'), ('production', 2, 'Production check sheet'),
                       ('installation', 3, 'Installation check sheet'), ('closure', 4, 'Post-production closure')) k(gate_key, seq, label)
    left join public.job_quality_gates g on g.job_id = j.id and g.gate_key = k.gate_key
    left join public.profiles p on p.id = g.signed_off_by;

create view public.watchtower_health_execution with (security_invoker = true) as
  with aw as (select count(*)::numeric n from public.deployments where stage = 'delivered'),
  tk as (select count(*)::numeric n from public.maintenance_tickets where status in ('open','in_progress')),
  pr as (select coalesce(round(100.0 * count(*) filter (where result = 'passed') / nullif(count(*), 0), 1), 0) pct from public.deployment_audits),
  gps as (select count(*)::numeric n from public.deployments where gps_flag and stage = 'installed')
  select 'execution'::text as module, 'awaiting_install'::text as metric, 'Delivered, awaiting install'::text as label, aw.n as value, 0::numeric as target,
         case when aw.n <= 5 then 'ok' when aw.n <= 20 then 'warn' else 'bad' end as status from aw
  union all select 'execution', 'open_tickets', 'Open maintenance tickets', tk.n, 0, case when tk.n = 0 then 'ok' when tk.n <= 5 then 'warn' else 'bad' end from tk
  union all select 'execution', 'audit_pass_rate', 'Audit pass rate (%)', pr.pct, 90, case when pr.pct >= 90 then 'ok' when pr.pct >= 75 then 'warn' else 'bad' end from pr
  union all select 'execution', 'gps_flags', 'Installs flagged on GPS, not yet audited', gps.n, 0, case when gps.n = 0 then 'ok' else 'warn' end from gps;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.outlets enable row level security;
alter table public.outlet_suppliers enable row level security;
alter table public.recces enable row level security;
alter table public.deployments enable row level security;
alter table public.deployment_audits enable row level security;
alter table public.maintenance_tickets enable row level security;
alter table public.visits enable row level security;
alter table public.job_quality_gates enable row level security;
alter table public.execution_events enable row level security;
create policy outlets_read on public.outlets for select to authenticated using (public.is_internal());
create policy outlet_suppliers_read on public.outlet_suppliers for select to authenticated using (public.is_internal());
create policy recces_read on public.recces for select to authenticated using (public.is_internal());
create policy deployments_read on public.deployments for select to authenticated using (public.is_internal());
create policy audits_read on public.deployment_audits for select to authenticated using (public.is_internal());
create policy tickets_read on public.maintenance_tickets for select to authenticated using (public.is_internal());
create policy visits_read on public.visits for select to authenticated using (public.is_internal());
create policy gates_read on public.job_quality_gates for select to authenticated using (public.is_internal());
create policy exev_read on public.execution_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.outlets, public.outlet_suppliers, public.recces, public.deployments, public.deployment_audits,
  public.maintenance_tickets, public.visits, public.job_quality_gates, public.execution_events from authenticated, anon;
revoke insert, update, delete on public.v_outlets, public.v_recces, public.v_deployments, public.v_deployment_audits, public.v_maintenance_tickets,
  public.v_visits, public.v_job_quality_gates, public.watchtower_health_execution from authenticated, anon;

revoke execute on function public._execution_code(text), public._execution_rule(text, numeric), public._execution_require_internal(),
  public._execution_event(uuid, text, uuid, text, jsonb), public._recce_fields(uuid, jsonb),
  public._execution_install(public.deployments, date, text, int, numeric, numeric, text, boolean)
  from public, anon, authenticated;
grant execute on function public.execution_units_fit(numeric, numeric, numeric, numeric, numeric, numeric), public.execution_outlet_save(uuid, jsonb),
  public.execution_outlet_set_supplier(uuid, uuid, boolean), public.execution_delivery_set_outlet(uuid, uuid), public.execution_recce_save(uuid, uuid, jsonb),
  public.execution_recce_set_status(uuid, text), public.execution_deployment_create(uuid, uuid, uuid, uuid, int, date, uuid),
  public.execution_record_install(uuid, date, text, int, numeric, numeric, text), public.execution_display_score(jsonb),
  public.execution_audit_deployment(uuid, jsonb, text, boolean), public.execution_ticket_create(uuid, uuid, text, text, text),
  public.execution_ticket_move(uuid, text, text, text), public.execution_visit_create(uuid, text, date, jsonb),
  public.execution_visit_update(uuid, text, text, text, numeric, numeric), public.execution_gate_order(text),
  public.execution_gate_sign_off(uuid, text, boolean, text), public.job_close_check(uuid), public.execution_close_job(uuid, text),
  public.execution_vendor_deployments(), public.execution_vendor_record_install(uuid, date, text, int, numeric, numeric, text),
  public.execution_vendor_outlets(), public.execution_vendor_recces(), public.execution_vendor_recce_save(uuid, uuid, jsonb, boolean)
  to authenticated;
