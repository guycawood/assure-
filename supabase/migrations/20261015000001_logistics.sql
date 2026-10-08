-- Logistics+: deliveries (per PO x destination x spec version), shipments, legs (milestones), proof of delivery with the
-- governed 8-point checklist, transport CO2e snapshots (Scope 3 Cat. 4) and OTIF per supplier.
-- Rebuilt from the Base44 Logistics portal (Delivery, Shipment, ShipmentLeg, Carrier, podConfig, shipmentMilestones) with:
--   * every write through checked security-definer functions (tables are read-only to users, RLS on every table);
--   * shipped quantity can never exceed the planned quantity (function check + trigger);
--   * POD verified only by an internal user who did not upload it, against the pod_checklist library, audited;
--   * vendors only through logistics_vendor_* functions scoped to my_supplier_id();
--   * immutable emission snapshots that record the factor code + version effective on the delivery date.

-- ---------------------------------------------------------------------------
-- Business numbers
-- ---------------------------------------------------------------------------
create sequence public.delivery_number_seq;
create sequence public.shipment_number_seq;

create or replace function public._logistics_number(p_prefix text) returns text
language sql volatile security definer set search_path = public as $$
  select p_prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval(
    case p_prefix when 'DL' then 'public.delivery_number_seq' when 'SH' then 'public.shipment_number_seq' end::regclass
  )::text, 5, '0');
$$;

-- Great-circle distance (km). Used for delivery distance and install GPS checks.
create or replace function public.geo_distance_km(p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
returns numeric language sql immutable as $$
  select case when p_lat1 is null or p_lon1 is null or p_lat2 is null or p_lon2 is null then null else
    (6371 * 2 * atan2(sqrt(a), sqrt(1 - a)))::numeric end
  from (select power(sin(radians((p_lat2 - p_lat1)::float8) / 2), 2)
             + cos(radians(p_lat1::float8)) * cos(radians(p_lat2::float8)) * power(sin(radians((p_lon2 - p_lon1)::float8) / 2), 2) as a) x;
$$;

-- ---------------------------------------------------------------------------
-- Deliveries: the plan, one row per destination per spec version on a PO
-- ---------------------------------------------------------------------------
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_number text not null unique,
  po_id uuid not null references public.purchase_orders(id),
  job_id uuid not null references public.jobs(id),
  supplier_id uuid not null references public.suppliers(id),
  spec_id uuid not null references public.job_specs(id),
  spec_version_id uuid references public.spec_versions(id),
  quantity int not null check (quantity > 0),
  uom text not null default 'units' check (length(trim(uom)) > 0),
  recipient_name text,
  recipient_contact text,
  recipient_phone text,
  recipient_email text,
  address_line text,
  city text,
  postcode text,
  -- destination: region and market kept separate
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  destination_lat numeric(9,6) check (destination_lat between -90 and 90),
  destination_lon numeric(9,6) check (destination_lon between -180 and 180),
  -- origin (optional, snapshotted at plan time)
  origin_name text,
  origin_market text references public.markets(code),
  origin_lat numeric(9,6) check (origin_lat between -90 and 90),
  origin_lon numeric(9,6) check (origin_lon between -180 and 180),
  delivery_method text not null default 'road' check (delivery_method in ('road','air','sea','rail','courier','postal','collection')),
  incoterm text check (incoterm in ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF')),
  planned_dispatch_date date,
  planned_delivery_date date,
  actual_delivery_date date,
  status text not null default 'planned' check (status in ('planned','booked','dispatched','in_transit','delivered','failed','cancelled')),
  gross_weight_kg numeric(12,3) check (gross_weight_kg >= 0),
  distance_km numeric(10,1) check (distance_km >= 0),
  special_instructions text,
  delivered_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_delivery_date is null or planned_dispatch_date is null or planned_delivery_date >= planned_dispatch_date)
);
create index deliveries_po_idx on public.deliveries (po_id);
create index deliveries_job_idx on public.deliveries (job_id);
create index deliveries_supplier_idx on public.deliveries (supplier_id, status);
create index deliveries_status_idx on public.deliveries (status, planned_delivery_date);

-- ---------------------------------------------------------------------------
-- Shipments: what actually moved (several per delivery when it goes in parts)
-- ---------------------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_number text not null unique,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  carrier_record_id uuid references public.library_records(id),
  carrier_code text,
  service_level text,
  tracking_reference text,
  dispatch_date date not null,
  actual_delivery_date date,
  quantity_shipped int not null check (quantity_shipped > 0),
  gross_weight_kg numeric(12,3) check (gross_weight_kg >= 0),
  pod_file_id uuid references public.files(id),
  pod_status text not null default 'not_received' check (pod_status in ('not_received','received','verified','rejected')),
  pod_uploaded_by uuid references public.profiles(id),
  pod_received_at timestamptz,
  pod_checklist jsonb not null default '[]'::jsonb,
  pod_verified_by uuid references public.profiles(id),
  pod_verified_at timestamptz,
  pod_rejection_reason text,
  recorded_by uuid references public.profiles(id),
  recorded_by_vendor boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shipments_delivery_idx on public.shipments (delivery_id);
create index shipments_pod_idx on public.shipments (pod_status);

-- Legs: how a shipment moved (factory -> port -> DC -> outlet). Status derived from the actuals.
create table public.shipment_legs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  sequence int not null check (sequence > 0),
  from_location text not null check (length(trim(from_location)) > 0),
  to_location text not null check (length(trim(to_location)) > 0),
  mode text not null check (mode in ('road','air','sea','rail','courier','postal')),
  carrier_code text,
  planned_departure date,
  actual_departure date,
  planned_arrival date,
  actual_arrival date,
  status text not null default 'planned' check (status in ('planned','in_transit','arrived')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (shipment_id, sequence)
);

-- Append-only audit for Logistics+.
create table public.logistics_events (
  id bigint generated always as identity primary key,
  delivery_id uuid references public.deliveries(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index logistics_events_delivery_idx on public.logistics_events (delivery_id, at desc);

create or replace function public._logistics_event(p_delivery uuid, p_shipment uuid, p_event text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.logistics_events (delivery_id, shipment_id, event, detail, actor)
  values (p_delivery, p_shipment, p_event, coalesce(p_detail, '{}'::jsonb), auth.uid());
$$;

-- Transport CO2e snapshots: immutable. A recompute adds a new row; the latest row is current.
create table public.emission_snapshots (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  mode text not null,
  delivery_date date not null,
  planned_weight_kg numeric(12,3),
  actual_weight_kg numeric(12,3),
  distance_km numeric(10,1),
  factor_record_id uuid references public.library_records(id),
  factor_code text,
  factor_version int,
  factor_g_per_tkm numeric(12,4),
  distance_correction numeric(8,4),
  planned_kgco2e numeric(14,3),
  kgco2e numeric(14,3),
  complete boolean not null,
  missing text[] not null default '{}',
  basis text not null,
  region text not null references public.regions(code),
  market text not null references public.markets(code),
  reason text,
  computed_by uuid references public.profiles(id),
  computed_at timestamptz not null default now()
);
create index emission_snapshots_delivery_idx on public.emission_snapshots (delivery_id, computed_at desc);

create or replace function public.trg_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'Snapshots are immutable: record a new one instead';
end $$;
create trigger emission_snapshots_immutable before update or delete on public.emission_snapshots
  for each row execute function public.trg_immutable();

-- ---------------------------------------------------------------------------
-- Triggers: numbers, derived fields and the over-shipping guard
-- ---------------------------------------------------------------------------
create or replace function public.trg_deliveries_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_shipped int; v_region text;
begin
  if tg_op = 'INSERT' then
    new.delivery_number := public._logistics_number('DL');
  else
    new.delivery_number := old.delivery_number; new.po_id := old.po_id; new.job_id := old.job_id; new.supplier_id := old.supplier_id;
    new.created_by := old.created_by; new.updated_at := now();
    select coalesce(sum(quantity_shipped), 0) into v_shipped from public.shipments where delivery_id = new.id;
    if new.quantity < v_shipped then raise exception 'The planned quantity can''t go below the % already shipped', v_shipped; end if;
  end if;
  select region_code into v_region from public.markets where code = new.market;
  if v_region is distinct from new.region then raise exception 'Market % is in region %, not %', new.market, v_region, new.region; end if;
  if new.distance_km is null then
    new.distance_km := round(public.geo_distance_km(new.origin_lat, new.origin_lon, new.destination_lat, new.destination_lon), 1);
  end if;
  return new;
end $$;
create trigger deliveries_before before insert or update on public.deliveries for each row execute function public.trg_deliveries_before();

create or replace function public.trg_shipments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; v_other int;
begin
  select * into d from public.deliveries where id = new.delivery_id for update;
  if tg_op = 'INSERT' then
    new.shipment_number := public._logistics_number('SH');
  else
    new.shipment_number := old.shipment_number; new.delivery_id := old.delivery_id; new.supplier_id := old.supplier_id; new.updated_at := now();
  end if;
  select coalesce(sum(quantity_shipped), 0) into v_other from public.shipments where delivery_id = new.delivery_id and id <> new.id;
  if v_other + new.quantity_shipped > d.quantity then
    raise exception 'That would ship % of %: only % left to ship on this delivery', v_other + new.quantity_shipped, d.quantity, greatest(d.quantity - v_other, 0);
  end if;
  return new;
end $$;
create trigger shipments_before before insert or update on public.shipments for each row execute function public.trg_shipments_before();

create or replace function public.trg_legs_before() returns trigger
language plpgsql as $$
begin
  new.status := case when new.actual_arrival is not null then 'arrived' when new.actual_departure is not null then 'in_transit' else 'planned' end;
  return new;
end $$;
create trigger shipment_legs_before before insert or update on public.shipment_legs for each row execute function public.trg_legs_before();

-- ---------------------------------------------------------------------------
-- Planning (internal)
-- ---------------------------------------------------------------------------
create or replace function public._logistics_require_internal() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() or public.my_supplier_id() is not null then
    raise exception 'Only internal staff can do this' using errcode = '42501';
  end if;
end $$;

-- One delivery per spec version on the PO's estimate lines, to the job's market, due on the PO delivery date.
-- Destinations are then edited (or split) per delivery.
create or replace function public.logistics_plan_from_po(p_po uuid) returns int
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; v_market text; v_region text; l record; v record; n int := 0; v_versions int;
begin
  perform public._logistics_require_internal();
  select * into p from public.purchase_orders where id = p_po for update;
  if p.id is null then raise exception 'Purchase order not found'; end if;
  if p.status not in ('issued','accepted') then raise exception 'Plan deliveries once the PO is approved and issued (it is %)', replace(p.status, '_', ' '); end if;
  if exists (select 1 from public.deliveries where po_id = p_po and status <> 'cancelled') then
    raise exception 'This PO already has deliveries planned; add or split destinations on the delivery instead';
  end if;
  select code, region_code into v_market, v_region from public.markets where code = p.market or lower(name) = lower(p.market) limit 1;
  if v_market is null then raise exception 'Market "%" is not in the market master data', p.market; end if;
  for l in select el.* from public.estimate_lines el where el.estimate_id = p.estimate_id loop
    select count(*) into v_versions from public.spec_versions where spec_id = l.spec_id;
    if v_versions = 0 then
      insert into public.deliveries (po_id, job_id, supplier_id, spec_id, quantity, region, market, planned_delivery_date, created_by)
      values (p_po, p.job_id, p.supplier_id, l.spec_id, l.quantity, v_region, v_market, p.delivery_date, auth.uid());
      n := n + 1;
    else
      for v in select * from public.spec_versions where spec_id = l.spec_id order by sort, created_at loop
        insert into public.deliveries (po_id, job_id, supplier_id, spec_id, spec_version_id, quantity, region, market, planned_delivery_date, created_by)
        values (p_po, p.job_id, p.supplier_id, l.spec_id, v.id, case when v_versions = 1 then l.quantity else v.quantity end, v_region, v_market, p.delivery_date, auth.uid());
        n := n + 1;
      end loop;
    end if;
  end loop;
  if n = 0 then raise exception 'The PO''s estimate has no lines to deliver'; end if;
  perform public._logistics_event(null, null, 'planned_from_po', jsonb_build_object('po_id', p_po, 'po_number', p.po_number, 'deliveries', n));
  return n;
end $$;

-- Add one destination for a spec (version) on a PO. p_data carries the destination and plan fields.
create or replace function public.logistics_create_delivery(p_po uuid, p_spec uuid, p_spec_version uuid, p_quantity int, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; v_id uuid; v_market text; v_region text;
begin
  perform public._logistics_require_internal();
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null then raise exception 'Purchase order not found'; end if;
  if p.status not in ('issued','accepted') then raise exception 'Plan deliveries once the PO is approved and issued'; end if;
  if not exists (select 1 from public.estimate_lines where estimate_id = p.estimate_id and spec_id = p_spec) then
    raise exception 'That spec is not on this purchase order';
  end if;
  if p_spec_version is not null and not exists (select 1 from public.spec_versions where id = p_spec_version and spec_id = p_spec) then
    raise exception 'That version does not belong to the spec';
  end if;
  v_market := upper(nullif(trim(p_data->>'market'), ''));
  if v_market is null then select code into v_market from public.markets where code = p.market or lower(name) = lower(p.market) limit 1; end if;
  select region_code into v_region from public.markets where code = v_market;
  if v_region is null then raise exception 'Choose a destination market'; end if;
  insert into public.deliveries (po_id, job_id, supplier_id, spec_id, spec_version_id, quantity, uom, recipient_name, recipient_contact, recipient_phone,
    recipient_email, address_line, city, postcode, region, market, destination_lat, destination_lon, origin_name, origin_market, origin_lat, origin_lon,
    delivery_method, incoterm, planned_dispatch_date, planned_delivery_date, gross_weight_kg, distance_km, special_instructions, created_by)
  values (p_po, p.job_id, p.supplier_id, p_spec, p_spec_version, p_quantity, coalesce(nullif(trim(p_data->>'uom'), ''), 'units'),
    nullif(trim(p_data->>'recipient_name'), ''), nullif(trim(p_data->>'recipient_contact'), ''), nullif(trim(p_data->>'recipient_phone'), ''),
    nullif(trim(p_data->>'recipient_email'), ''), nullif(trim(p_data->>'address_line'), ''), nullif(trim(p_data->>'city'), ''), nullif(trim(p_data->>'postcode'), ''),
    v_region, v_market, (p_data->>'destination_lat')::numeric, (p_data->>'destination_lon')::numeric,
    nullif(trim(p_data->>'origin_name'), ''), upper(nullif(trim(p_data->>'origin_market'), '')), (p_data->>'origin_lat')::numeric, (p_data->>'origin_lon')::numeric,
    coalesce(nullif(p_data->>'delivery_method', ''), 'road'), nullif(p_data->>'incoterm', ''),
    (nullif(p_data->>'planned_dispatch_date', ''))::date, coalesce((nullif(p_data->>'planned_delivery_date', ''))::date, p.delivery_date),
    (nullif(p_data->>'gross_weight_kg', ''))::numeric, (nullif(p_data->>'distance_km', ''))::numeric, nullif(trim(p_data->>'special_instructions'), ''), auth.uid())
  returning id into v_id;
  perform public._logistics_event(v_id, null, 'created', jsonb_build_object('po_id', p_po, 'quantity', p_quantity, 'market', v_market));
  return v_id;
end $$;

-- Edit the plan while the delivery has not been delivered/cancelled. Quantity can't drop below what has shipped (trigger).
create or replace function public.logistics_update_delivery(p_delivery uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; v_market text; v_region text;
begin
  perform public._logistics_require_internal();
  select * into d from public.deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Delivery not found'; end if;
  if d.status in ('delivered','cancelled') then raise exception 'A % delivery can''t be changed', d.status; end if;
  v_market := coalesce(upper(nullif(trim(p_data->>'market'), '')), d.market);
  select region_code into v_region from public.markets where code = v_market;
  if v_region is null then raise exception 'Unknown market %', v_market; end if;
  update public.deliveries set
    quantity = coalesce((nullif(p_data->>'quantity', ''))::int, quantity),
    uom = coalesce(nullif(trim(p_data->>'uom'), ''), uom),
    recipient_name = nullif(trim(p_data->>'recipient_name'), ''), recipient_contact = nullif(trim(p_data->>'recipient_contact'), ''),
    recipient_phone = nullif(trim(p_data->>'recipient_phone'), ''), recipient_email = nullif(trim(p_data->>'recipient_email'), ''),
    address_line = nullif(trim(p_data->>'address_line'), ''), city = nullif(trim(p_data->>'city'), ''), postcode = nullif(trim(p_data->>'postcode'), ''),
    region = v_region, market = v_market,
    destination_lat = (nullif(p_data->>'destination_lat', ''))::numeric, destination_lon = (nullif(p_data->>'destination_lon', ''))::numeric,
    origin_name = nullif(trim(p_data->>'origin_name'), ''), origin_market = upper(nullif(trim(p_data->>'origin_market'), '')),
    origin_lat = (nullif(p_data->>'origin_lat', ''))::numeric, origin_lon = (nullif(p_data->>'origin_lon', ''))::numeric,
    delivery_method = coalesce(nullif(p_data->>'delivery_method', ''), delivery_method), incoterm = nullif(p_data->>'incoterm', ''),
    planned_dispatch_date = (nullif(p_data->>'planned_dispatch_date', ''))::date, planned_delivery_date = (nullif(p_data->>'planned_delivery_date', ''))::date,
    gross_weight_kg = (nullif(p_data->>'gross_weight_kg', ''))::numeric, distance_km = (nullif(p_data->>'distance_km', ''))::numeric,
    special_instructions = nullif(trim(p_data->>'special_instructions'), '')
  where id = p_delivery;
  perform public._logistics_event(p_delivery, null, 'updated', p_data - 'special_instructions');
end $$;

-- Manual status moves (booking, in transit, failed, cancelled). Delivered goes through logistics_mark_delivered.
create or replace function public.logistics_set_status(p_delivery uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; ok boolean;
begin
  perform public._logistics_require_internal();
  select * into d from public.deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Delivery not found'; end if;
  ok := case d.status
    when 'planned' then p_status in ('booked','cancelled')
    when 'booked' then p_status in ('planned','dispatched','cancelled')
    when 'dispatched' then p_status in ('in_transit','failed')
    when 'in_transit' then p_status in ('failed')
    when 'failed' then p_status in ('planned','cancelled')
    else false end;
  if not ok then raise exception 'A delivery can''t move from % to %', replace(d.status, '_', ' '), replace(p_status, '_', ' '); end if;
  if p_status in ('failed','cancelled') and coalesce(trim(p_note), '') = '' then raise exception 'Say why'; end if;
  if p_status = 'cancelled' and exists (select 1 from public.shipments where delivery_id = p_delivery) then
    raise exception 'Goods have already shipped on this delivery, so it can''t be cancelled';
  end if;
  update public.deliveries set status = p_status where id = p_delivery;
  perform public._logistics_event(p_delivery, null, 'status_changed', jsonb_build_object('from', d.status, 'to', p_status, 'note', p_note));
end $$;

-- ---------------------------------------------------------------------------
-- Transport CO2e snapshot: kgCO2e = tonnes x km x distance correction x gCO2e/t.km / 1000
-- Factor = transport_emission_factors record for the mode, version effective on the delivery date.
-- ---------------------------------------------------------------------------
create or replace function public._transport_factor(p_mode text, p_date date) returns public.library_records
language plpgsql stable security definer set search_path = public as $$
declare v_code text; r public.library_records; v_mode text := case when p_mode = 'postal' then 'courier' else p_mode end;
begin
  for v_mode in select unnest(case when p_mode = 'postal' then array['postal','courier'] else array[p_mode] end) loop
    select code into v_code from public.library_records
     where library_key = 'transport_emission_factors' and data->>'transport_mode' = v_mode and code is not null
       and status in ('active','superseded') and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
     order by code limit 1;
    if v_code is not null then
      r := public.library_effective('transport_emission_factors', v_code, p_date);
      return r;
    end if;
  end loop;
  return null;
end $$;

create or replace function public._logistics_emission_snapshot(p_delivery uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; f public.library_records; v_date date; v_actual numeric; v_all boolean; v_missing text[] := '{}';
  v_factor numeric; v_corr numeric; v_planned numeric; v_kg numeric; v_basis text; v_id uuid;
begin
  select * into d from public.deliveries where id = p_delivery;
  v_date := coalesce(d.actual_delivery_date, current_date);
  select sum(gross_weight_kg), bool_and(gross_weight_kg is not null) into v_actual, v_all from public.shipments where delivery_id = p_delivery;
  if not coalesce(v_all, false) then v_actual := null; end if;
  if d.delivery_method = 'collection' then
    v_basis := 'Collected by the recipient: no transport arranged by us, so nothing is counted.';
    v_planned := 0; v_kg := 0;
  else
    f := public._transport_factor(d.delivery_method, v_date);
    if f.id is null then v_missing := v_missing || ('transport emission factor for ' || d.delivery_method); end if;
    if d.distance_km is null then v_missing := v_missing || 'distance (km)'::text; end if;
    if coalesce(v_actual, d.gross_weight_kg) is null then v_missing := v_missing || 'gross weight (kg)'::text; end if;
    v_factor := (f.data->>'factor_gco2e_per_tonne_km')::numeric;
    v_corr := coalesce((f.data->>'distance_correction_factor')::numeric, 1);
    if f.id is not null and d.distance_km is not null then
      if d.gross_weight_kg is not null then v_planned := round((d.gross_weight_kg / 1000) * d.distance_km * v_corr * v_factor / 1000, 3); end if;
      if coalesce(v_actual, d.gross_weight_kg) is not null then v_kg := round((coalesce(v_actual, d.gross_weight_kg) / 1000) * d.distance_km * v_corr * v_factor / 1000, 3); end if;
    end if;
    v_basis := case when v_actual is not null then 'Actual shipped gross weight' when d.gross_weight_kg is not null then 'Planned gross weight (shipment weights not all recorded)' else 'Incomplete' end;
  end if;
  insert into public.emission_snapshots (delivery_id, mode, delivery_date, planned_weight_kg, actual_weight_kg, distance_km, factor_record_id, factor_code,
    factor_version, factor_g_per_tkm, distance_correction, planned_kgco2e, kgco2e, complete, missing, basis, region, market, reason, computed_by)
  values (p_delivery, d.delivery_method, v_date, d.gross_weight_kg, v_actual, d.distance_km, f.id, f.code, f.version, v_factor, v_corr,
    v_planned, v_kg, cardinality(v_missing) = 0, v_missing, v_basis, d.region, d.market, p_reason, auth.uid())
  returning id into v_id;
  if f.id is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (f.id, 'emission_snapshots', v_id::text, d.delivery_number) on conflict do nothing;
  end if;
  return v_id;
end $$;

-- Recompute (e.g. weights were corrected): adds a new snapshot; old ones stay.
create or replace function public.logistics_recompute_emissions(p_delivery uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; v_id uuid;
begin
  perform public._logistics_require_internal();
  select * into d from public.deliveries where id = p_delivery;
  if d.id is null or d.status <> 'delivered' then raise exception 'Transport CO2e is recorded once a delivery is delivered'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it is being recomputed'; end if;
  v_id := public._logistics_emission_snapshot(p_delivery, trim(p_reason));
  perform public._logistics_event(p_delivery, null, 'emissions_recomputed', jsonb_build_object('snapshot_id', v_id, 'reason', p_reason));
  return v_id;
end $$;

create or replace function public._logistics_deliver(p_delivery uuid, p_date date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; v_snap uuid;
begin
  select * into d from public.deliveries where id = p_delivery for update;
  update public.deliveries set status = 'delivered', actual_delivery_date = p_date, delivered_by = auth.uid() where id = p_delivery;
  v_snap := public._logistics_emission_snapshot(p_delivery, 'Delivered');
  perform public._logistics_event(p_delivery, null, 'delivered', jsonb_build_object('from', d.status, 'date', p_date, 'note', p_note, 'snapshot_id', v_snap));
end $$;

create or replace function public.logistics_mark_delivered(p_delivery uuid, p_delivered_on date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; v_date date;
begin
  perform public._logistics_require_internal();
  select * into d from public.deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Delivery not found'; end if;
  if d.status not in ('booked','dispatched','in_transit') then raise exception 'Only a delivery on its way can be marked delivered (it is %)', replace(d.status, '_', ' '); end if;
  if not exists (select 1 from public.shipments where delivery_id = p_delivery) then raise exception 'Record the shipment before marking it delivered'; end if;
  v_date := coalesce(p_delivered_on, (select max(actual_delivery_date) from public.shipments where delivery_id = p_delivery), current_date);
  if v_date > current_date then raise exception 'The delivery date can''t be in the future'; end if;
  perform public._logistics_deliver(p_delivery, v_date, p_note);
end $$;

-- ---------------------------------------------------------------------------
-- Shipments and POD
-- ---------------------------------------------------------------------------
create or replace function public._logistics_insert_shipment(d public.deliveries, p_carrier_code text, p_service_level text, p_tracking text,
  p_dispatch_date date, p_quantity int, p_gross_weight_kg numeric, p_notes text, p_vendor boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.library_records; v_id uuid; v_shipped int;
begin
  if d.status not in ('planned','booked','dispatched','in_transit') then raise exception 'Shipments can''t be added to a % delivery', replace(d.status, '_', ' '); end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter the quantity shipped'; end if;
  if p_dispatch_date is null then raise exception 'Enter the dispatch date'; end if;
  select coalesce(sum(quantity_shipped), 0) into v_shipped from public.shipments where delivery_id = d.id;
  if v_shipped + p_quantity > d.quantity then
    raise exception 'Only % left to ship on this delivery (% planned, % already shipped)', d.quantity - v_shipped, d.quantity, v_shipped;
  end if;
  if nullif(trim(p_carrier_code), '') is not null then
    select * into c from public.library_records where library_key = 'carriers' and code = trim(p_carrier_code) and status = 'active';
    if c.id is null then raise exception 'Choose an active carrier from the carrier library'; end if;
  end if;
  insert into public.shipments (delivery_id, supplier_id, carrier_record_id, carrier_code, service_level, tracking_reference, dispatch_date,
    quantity_shipped, gross_weight_kg, recorded_by, recorded_by_vendor, notes)
  values (d.id, d.supplier_id, c.id, c.code, nullif(trim(p_service_level), ''), nullif(trim(p_tracking), ''), p_dispatch_date,
    p_quantity, p_gross_weight_kg, auth.uid(), p_vendor, nullif(trim(p_notes), ''))
  returning id into v_id;
  if c.id is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (c.id, 'shipments', v_id::text, 'Shipment') on conflict do nothing;
  end if;
  if d.status in ('planned','booked') then update public.deliveries set status = 'dispatched' where id = d.id; end if;
  perform public._logistics_event(d.id, v_id, 'shipment_recorded', jsonb_build_object('quantity', p_quantity, 'carrier', c.code, 'tracking', p_tracking, 'by_vendor', p_vendor));
  return v_id;
end $$;

create or replace function public.logistics_record_shipment(p_delivery uuid, p_carrier_code text, p_service_level text, p_tracking text,
  p_dispatch_date date, p_quantity int, p_gross_weight_kg numeric default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.deliveries;
begin
  perform public._logistics_require_internal();
  select * into d from public.deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Delivery not found'; end if;
  return public._logistics_insert_shipment(d, p_carrier_code, p_service_level, p_tracking, p_dispatch_date, p_quantity, p_gross_weight_kg, p_notes, false);
end $$;

create or replace function public._logistics_attach_pod(s public.shipments, p_file uuid, p_delivered_on date) returns void
language plpgsql security definer set search_path = public as $$
declare f public.files;
begin
  select * into f from public.files where id = p_file;
  if f.id is null or f.entity_type <> 'shipment' or f.entity_id <> s.id::text then raise exception 'Upload the POD against this shipment first'; end if;
  if s.pod_status = 'verified' then raise exception 'The POD on this shipment is already verified'; end if;
  if p_delivered_on is not null and (p_delivered_on > current_date or p_delivered_on < s.dispatch_date) then
    raise exception 'The delivery date must be between the dispatch date and today';
  end if;
  update public.shipments set pod_file_id = p_file, pod_status = 'received', pod_uploaded_by = auth.uid(), pod_received_at = now(),
    pod_verified_by = null, pod_verified_at = null, pod_rejection_reason = null, pod_checklist = '[]'::jsonb,
    actual_delivery_date = coalesce(p_delivered_on, actual_delivery_date, current_date)
  where id = s.id;
  perform public._logistics_event(s.delivery_id, s.id, 'pod_received', jsonb_build_object('file_id', p_file, 'by_vendor', not public.is_internal()));
end $$;

create or replace function public.logistics_attach_pod(p_shipment uuid, p_file uuid, p_delivered_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shipments;
begin
  perform public._logistics_require_internal();
  select * into s from public.shipments where id = p_shipment for update;
  if s.id is null then raise exception 'Shipment not found'; end if;
  perform public._logistics_attach_pod(s, p_file, p_delivered_on);
end $$;

-- p_checks: {"POD-1": true, ...} against the active pod_checklist library. Verified only by an internal user who is not
-- the vendor and did not upload the POD, with every mandatory point ticked. Audited; vendor notified.
create or replace function public._logistics_pod_checklist(p_checks jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'version', r.version, 'record_id', r.id,
    'mandatory', coalesce((r.data->>'mandatory')::boolean, true), 'passed', coalesce((p_checks->>r.code)::boolean, false)) order by r.code), '[]'::jsonb)
  from public.library_records r
  where r.library_key = 'pod_checklist' and r.status = 'active' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date);
$$;

create or replace function public.logistics_pod_verify(p_shipment uuid, p_checks jsonb, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shipments; d public.deliveries; v_list jsonb; v_failed text; v_shipped int; v_unverified int; p public.purchase_orders;
begin
  perform public._logistics_require_internal();
  select * into s from public.shipments where id = p_shipment for update;
  if s.id is null then raise exception 'Shipment not found'; end if;
  if s.pod_status <> 'received' then raise exception 'There is no POD waiting for verification on this shipment'; end if;
  if s.pod_uploaded_by = auth.uid() then raise exception 'You uploaded this POD, so someone else must verify it' using errcode = '42501'; end if;
  v_list := public._logistics_pod_checklist(p_checks);
  if jsonb_array_length(v_list) = 0 then raise exception 'The POD checklist is not set up in the Logistics+ Watchtower'; end if;
  select string_agg(x->>'name', ', ') into v_failed from jsonb_array_elements(v_list) x where (x->>'mandatory')::boolean and not (x->>'passed')::boolean;
  if v_failed is not null then raise exception 'Every mandatory point must be checked before the POD is verified. Missing: %', v_failed; end if;
  update public.shipments set pod_status = 'verified', pod_checklist = v_list, pod_verified_by = auth.uid(), pod_verified_at = now(), pod_rejection_reason = null
   where id = p_shipment;
  insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
  select (x->>'record_id')::uuid, 'shipments', p_shipment::text, 'POD check' from jsonb_array_elements(v_list) x on conflict do nothing;
  select * into d from public.deliveries where id = s.delivery_id for update;
  select * into p from public.purchase_orders where id = d.po_id;
  perform public._logistics_event(d.id, p_shipment, 'pod_verified', jsonb_build_object('checks', jsonb_array_length(v_list), 'note', p_note));
  perform public.notify_supplier(d.supplier_id, 'logistics', 'POD verified', format('Proof of delivery for %s on %s was verified.', s.shipment_number, p.po_number), '/vendor');
  -- Fully shipped and every POD verified: the delivery is delivered.
  select coalesce(sum(quantity_shipped), 0), count(*) filter (where pod_status <> 'verified') into v_shipped, v_unverified from public.shipments where delivery_id = d.id;
  if d.status in ('booked','dispatched','in_transit') and v_shipped >= d.quantity and v_unverified = 0 then
    perform public._logistics_deliver(d.id, coalesce((select max(actual_delivery_date) from public.shipments where delivery_id = d.id), current_date), 'All PODs verified');
  end if;
end $$;

create or replace function public.logistics_pod_reject(p_shipment uuid, p_checks jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shipments; d public.deliveries; p public.purchase_orders;
begin
  perform public._logistics_require_internal();
  select * into s from public.shipments where id = p_shipment for update;
  if s.id is null then raise exception 'Shipment not found'; end if;
  if s.pod_status <> 'received' then raise exception 'There is no POD waiting for verification on this shipment'; end if;
  if s.pod_uploaded_by = auth.uid() then raise exception 'You uploaded this POD, so someone else must check it' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say what is wrong with the POD so the vendor can fix it'; end if;
  update public.shipments set pod_status = 'rejected', pod_checklist = public._logistics_pod_checklist(p_checks), pod_rejection_reason = trim(p_reason),
    pod_verified_by = auth.uid(), pod_verified_at = now() where id = p_shipment;
  select * into d from public.deliveries where id = s.delivery_id;
  select * into p from public.purchase_orders where id = d.po_id;
  perform public._logistics_event(d.id, p_shipment, 'pod_rejected', jsonb_build_object('reason', trim(p_reason)));
  perform public.notify_supplier(d.supplier_id, 'logistics', 'POD rejected', format('The proof of delivery for %s on %s was rejected: %s. Upload a corrected POD.', s.shipment_number, p.po_number, trim(p_reason)), '/vendor');
end $$;

-- Legs / milestones (internal).
create or replace function public.logistics_leg_save(p_shipment uuid, p_leg uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.shipments; v_id uuid; v_seq int;
begin
  perform public._logistics_require_internal();
  select * into s from public.shipments where id = p_shipment;
  if s.id is null then raise exception 'Shipment not found'; end if;
  if nullif(trim(p_data->>'carrier_code'), '') is not null and not exists (select 1 from public.library_records where library_key = 'carriers' and code = trim(p_data->>'carrier_code') and status = 'active') then
    raise exception 'Choose an active carrier from the carrier library';
  end if;
  if p_leg is null then
    select coalesce(max(sequence), 0) + 1 into v_seq from public.shipment_legs where shipment_id = p_shipment;
    insert into public.shipment_legs (shipment_id, sequence, from_location, to_location, mode, carrier_code, planned_departure, actual_departure, planned_arrival, actual_arrival, notes, created_by)
    values (p_shipment, v_seq, trim(p_data->>'from_location'), trim(p_data->>'to_location'), coalesce(nullif(p_data->>'mode', ''), 'road'), nullif(trim(p_data->>'carrier_code'), ''),
      (nullif(p_data->>'planned_departure', ''))::date, (nullif(p_data->>'actual_departure', ''))::date, (nullif(p_data->>'planned_arrival', ''))::date,
      (nullif(p_data->>'actual_arrival', ''))::date, nullif(trim(p_data->>'notes'), ''), auth.uid())
    returning id into v_id;
  else
    update public.shipment_legs set from_location = trim(p_data->>'from_location'), to_location = trim(p_data->>'to_location'),
      mode = coalesce(nullif(p_data->>'mode', ''), mode), carrier_code = nullif(trim(p_data->>'carrier_code'), ''),
      planned_departure = (nullif(p_data->>'planned_departure', ''))::date, actual_departure = (nullif(p_data->>'actual_departure', ''))::date,
      planned_arrival = (nullif(p_data->>'planned_arrival', ''))::date, actual_arrival = (nullif(p_data->>'actual_arrival', ''))::date,
      notes = nullif(trim(p_data->>'notes'), '')
    where id = p_leg and shipment_id = p_shipment returning id into v_id;
    if v_id is null then raise exception 'Leg not found'; end if;
  end if;
  perform public._logistics_event(s.delivery_id, p_shipment, 'leg_saved', jsonb_build_object('leg_id', v_id, 'from', p_data->>'from_location', 'to', p_data->>'to_location'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Vendor functions (vendor portal). Always scoped to my_supplier_id() and the PO the delivery belongs to.
-- ---------------------------------------------------------------------------
create or replace function public._logistics_vendor_delivery(p_delivery uuid) returns public.deliveries
language plpgsql stable security definer set search_path = public as $$
declare d public.deliveries; v_sup uuid := public.my_supplier_id();
begin
  select dl.* into d from public.deliveries dl join public.purchase_orders p on p.id = dl.po_id
   where dl.id = p_delivery and v_sup is not null and p.supplier_id = v_sup and dl.supplier_id = v_sup and p.status in ('issued','accepted');
  if d.id is null then raise exception 'Delivery not found' using errcode = '42501'; end if;
  return d;
end $$;

create or replace function public.logistics_vendor_deliveries() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'delivery_number', d.delivery_number, 'po_id', d.po_id, 'po_number', p.po_number, 'job_number', j.job_number,
    'spec_title', sp.title, 'spec_version', v.name, 'quantity', d.quantity, 'uom', d.uom,
    'shipped', coalesce(sh.shipped, 0), 'remaining', d.quantity - coalesce(sh.shipped, 0),
    'recipient_name', d.recipient_name, 'recipient_contact', d.recipient_contact, 'recipient_phone', d.recipient_phone,
    'address_line', d.address_line, 'city', d.city, 'postcode', d.postcode, 'region', d.region, 'market', d.market,
    'delivery_method', d.delivery_method, 'incoterm', d.incoterm, 'planned_dispatch_date', d.planned_dispatch_date,
    'planned_delivery_date', d.planned_delivery_date, 'actual_delivery_date', d.actual_delivery_date, 'status', d.status,
    'special_instructions', d.special_instructions,
    'shipments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'shipment_number', s.shipment_number, 'carrier_code', s.carrier_code,
        'service_level', s.service_level, 'tracking_reference', s.tracking_reference, 'dispatch_date', s.dispatch_date,
        'actual_delivery_date', s.actual_delivery_date, 'quantity_shipped', s.quantity_shipped, 'gross_weight_kg', s.gross_weight_kg,
        'pod_file_id', s.pod_file_id, 'pod_status', s.pod_status, 'pod_rejection_reason', s.pod_rejection_reason,
        'pod_checklist', (select coalesce(jsonb_agg(jsonb_build_object('code', x->>'code', 'name', x->>'name', 'passed', (x->>'passed')::boolean)), '[]'::jsonb) from jsonb_array_elements(s.pod_checklist) x))
        order by s.dispatch_date, s.created_at) from public.shipments s where s.delivery_id = d.id), '[]'::jsonb)
  ) order by d.planned_delivery_date nulls last, d.delivery_number), '[]'::jsonb)
  from public.deliveries d
  join public.purchase_orders p on p.id = d.po_id
  join public.jobs j on j.id = d.job_id
  join public.job_specs sp on sp.id = d.spec_id
  left join public.spec_versions v on v.id = d.spec_version_id
  left join lateral (select sum(quantity_shipped)::int shipped from public.shipments where delivery_id = d.id) sh on true
  where public.my_supplier_id() is not null and d.supplier_id = public.my_supplier_id() and p.supplier_id = public.my_supplier_id()
    and p.status in ('issued','accepted') and d.status <> 'cancelled';
$$;

create or replace function public.logistics_vendor_record_shipment(p_delivery uuid, p_carrier_code text, p_service_level text, p_tracking text,
  p_dispatch_date date, p_quantity int, p_gross_weight_kg numeric default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.deliveries := public._logistics_vendor_delivery(p_delivery);
begin
  perform 1 from public.deliveries where id = d.id for update;
  return public._logistics_insert_shipment(d, p_carrier_code, p_service_level, p_tracking, p_dispatch_date, p_quantity, p_gross_weight_kg, p_notes, true);
end $$;

-- The vendor uploads the file with file_register('logistics', 'shipment', <shipment id>, ...) then attaches it here.
create or replace function public.logistics_vendor_attach_pod(p_shipment uuid, p_file_id uuid, p_delivered_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shipments; d public.deliveries; f public.files;
begin
  select * into s from public.shipments where id = p_shipment for update;
  if s.id is null then raise exception 'Shipment not found' using errcode = '42501'; end if;
  d := public._logistics_vendor_delivery(s.delivery_id);
  select * into f from public.files where id = p_file_id;
  if f.id is null or f.supplier_id is distinct from public.my_supplier_id() then raise exception 'Upload the POD against this shipment first'; end if;
  perform public._logistics_attach_pod(s, p_file_id, p_delivered_on);
end $$;

-- ---------------------------------------------------------------------------
-- Read views (security invoker: caller's RLS applies, so internal only)
-- ---------------------------------------------------------------------------
create view public.v_deliveries with (security_invoker = true) as
  select d.*, p.po_number, p.status as po_status, j.job_number, j.title as job_title, c.name as client_name, su.name as supplier_name, su.supplier_code,
         sp.title as spec_title, sp.spec_no, v.name as spec_version_name, mk.name as market_name, om.name as origin_market_name,
         coalesce(sh.shipped, 0)::int as quantity_shipped, (d.quantity - coalesce(sh.shipped, 0))::int as quantity_remaining,
         coalesce(sh.shipments, 0)::int as shipment_count, coalesce(sh.pods_to_verify, 0)::int as pods_to_verify,
         coalesce(sh.pods_verified, 0)::int as pods_verified,
         es.kgco2e, es.planned_kgco2e, es.complete as co2e_complete,
         (d.status = 'delivered' and d.actual_delivery_date <= d.planned_delivery_date) as on_time,
         (d.status = 'delivered' and coalesce(sh.shipped, 0) >= d.quantity) as in_full
    from public.deliveries d
    join public.purchase_orders p on p.id = d.po_id
    join public.jobs j on j.id = d.job_id
    join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers su on su.id = d.supplier_id
    join public.job_specs sp on sp.id = d.spec_id
    left join public.spec_versions v on v.id = d.spec_version_id
    left join public.markets mk on mk.code = d.market
    left join public.markets om on om.code = d.origin_market
    left join lateral (select sum(quantity_shipped) shipped, count(*) shipments, count(*) filter (where pod_status = 'received') pods_to_verify,
                              count(*) filter (where pod_status = 'verified') pods_verified
                         from public.shipments where delivery_id = d.id) sh on true
    left join lateral (select kgco2e, planned_kgco2e, complete from public.emission_snapshots where delivery_id = d.id order by computed_at desc limit 1) es on true;

create view public.v_shipments with (security_invoker = true) as
  select s.*, d.delivery_number, d.po_id, d.job_id, d.quantity as delivery_quantity, d.status as delivery_status, d.planned_delivery_date,
         d.region, d.market, p.po_number, j.job_number, su.name as supplier_name, cr.name as carrier_name, cr.data->>'tracking_url' as carrier_tracking_url,
         ub.full_name as pod_uploaded_by_name, vb.full_name as pod_verified_by_name
    from public.shipments s join public.deliveries d on d.id = s.delivery_id
    join public.purchase_orders p on p.id = d.po_id join public.jobs j on j.id = d.job_id
    join public.suppliers su on su.id = s.supplier_id
    left join public.library_records cr on cr.id = s.carrier_record_id
    left join public.profiles ub on ub.id = s.pod_uploaded_by
    left join public.profiles vb on vb.id = s.pod_verified_by;

-- OTIF per supplier (the Assure+ scorecard reads this). On time = delivered on/before the planned date;
-- in full = quantity shipped covers the planned quantity. Failed deliveries count against both.
create view public.v_supplier_otif with (security_invoker = true) as
  select d.supplier_id, su.name as supplier_name, su.supplier_code,
         count(*)::int as deliveries,
         count(*) filter (where d.status = 'delivered' and d.actual_delivery_date <= d.planned_delivery_date)::int as on_time,
         count(*) filter (where d.status = 'delivered' and coalesce(sh.shipped, 0) >= d.quantity)::int as in_full,
         count(*) filter (where d.status = 'delivered' and d.actual_delivery_date <= d.planned_delivery_date and coalesce(sh.shipped, 0) >= d.quantity)::int as otif,
         round(100.0 * count(*) filter (where d.status = 'delivered' and d.actual_delivery_date <= d.planned_delivery_date and coalesce(sh.shipped, 0) >= d.quantity) / nullif(count(*), 0), 1) as otif_percent,
         round(100.0 * count(*) filter (where d.status = 'delivered' and d.actual_delivery_date <= d.planned_delivery_date) / nullif(count(*), 0), 1) as on_time_percent,
         round(100.0 * count(*) filter (where d.status = 'delivered' and coalesce(sh.shipped, 0) >= d.quantity) / nullif(count(*), 0), 1) as in_full_percent
    from public.deliveries d join public.suppliers su on su.id = d.supplier_id
    left join lateral (select sum(quantity_shipped) shipped from public.shipments where delivery_id = d.id) sh on true
   where d.status in ('delivered','failed') and d.planned_delivery_date is not null
   group by d.supplier_id, su.name, su.supplier_code;

create view public.v_emission_snapshots with (security_invoker = true) as
  select e.*, d.delivery_number, d.supplier_id, su.name as supplier_name, j.job_number, d.job_id
    from public.emission_snapshots e join public.deliveries d on d.id = e.delivery_id
    join public.suppliers su on su.id = d.supplier_id join public.jobs j on j.id = d.job_id;

create view public.watchtower_health_logistics with (security_invoker = true) as
  with pods as (select count(*)::numeric n from public.shipments where pod_status = 'received'),
  ot as (select coalesce(round(100.0 * count(*) filter (where actual_delivery_date <= planned_delivery_date) / nullif(count(*), 0), 1), 0) pct
           from public.deliveries where status = 'delivered' and planned_delivery_date is not null),
  overdue as (select count(*)::numeric n from public.deliveries where status in ('planned','booked','dispatched','in_transit') and planned_delivery_date < current_date),
  inc as (select count(*)::numeric n from public.deliveries d where d.status = 'delivered'
            and not coalesce((select complete from public.emission_snapshots e where e.delivery_id = d.id order by computed_at desc limit 1), false))
  select 'logistics'::text as module, 'pods_to_verify'::text as metric, 'PODs waiting for verification'::text as label, pods.n as value, 0::numeric as target,
         case when pods.n = 0 then 'ok' when pods.n <= 5 then 'warn' else 'bad' end as status from pods
  union all select 'logistics', 'on_time_percent', 'Delivered on time (%)', ot.pct, 95, case when ot.pct >= 95 then 'ok' when ot.pct >= 80 then 'warn' else 'bad' end from ot
  union all select 'logistics', 'overdue_deliveries', 'Deliveries past their planned date', overdue.n, 0, case when overdue.n = 0 then 'ok' when overdue.n <= 3 then 'warn' else 'bad' end from overdue
  union all select 'logistics', 'co2e_incomplete', 'Delivered without complete transport CO2e', inc.n, 0, case when inc.n = 0 then 'ok' else 'warn' end from inc;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.deliveries enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_legs enable row level security;
alter table public.logistics_events enable row level security;
alter table public.emission_snapshots enable row level security;
create policy deliveries_read on public.deliveries for select to authenticated using (public.is_internal());
create policy shipments_read on public.shipments for select to authenticated using (public.is_internal());
create policy legs_read on public.shipment_legs for select to authenticated using (public.is_internal());
create policy logev_read on public.logistics_events for select to authenticated using (public.is_internal());
create policy emis_read on public.emission_snapshots for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.deliveries, public.shipments, public.shipment_legs, public.logistics_events, public.emission_snapshots from authenticated, anon;
revoke insert, update, delete on public.v_deliveries, public.v_shipments, public.v_supplier_otif, public.v_emission_snapshots, public.watchtower_health_logistics from authenticated, anon;

revoke execute on function public._logistics_number(text), public._logistics_event(uuid, uuid, text, jsonb), public._logistics_require_internal(),
  public._transport_factor(text, date), public._logistics_emission_snapshot(uuid, text), public._logistics_deliver(uuid, date, text),
  public._logistics_insert_shipment(public.deliveries, text, text, text, date, int, numeric, text, boolean),
  public._logistics_attach_pod(public.shipments, uuid, date), public._logistics_pod_checklist(jsonb), public._logistics_vendor_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.logistics_plan_from_po(uuid), public.logistics_create_delivery(uuid, uuid, uuid, int, jsonb),
  public.logistics_update_delivery(uuid, jsonb), public.logistics_set_status(uuid, text, text), public.logistics_mark_delivered(uuid, date, text),
  public.logistics_recompute_emissions(uuid, text), public.logistics_record_shipment(uuid, text, text, text, date, int, numeric, text),
  public.logistics_attach_pod(uuid, uuid, date), public.logistics_pod_verify(uuid, jsonb, text), public.logistics_pod_reject(uuid, jsonb, text),
  public.logistics_leg_save(uuid, uuid, jsonb), public.logistics_vendor_deliveries(),
  public.logistics_vendor_record_shipment(uuid, text, text, text, date, int, numeric, text), public.logistics_vendor_attach_pod(uuid, uuid, date),
  public.geo_distance_km(numeric, numeric, numeric, numeric)
  to authenticated;
