-- SRM vendor capability profile (5 Nov 2026): what a vendor can make, on which machines, and the tooling they hold.
--
-- Three registers per supplier (optionally per site): capabilities (process, size limits, runs, capacity, lead time,
-- in-house or subcontracted), machines (type, make, model, year, quantity, format, colours/stations, speed,
-- condition) and tooling (moulds, dies, cutting formes, screens, jigs: who owns it, which spec it was made for,
-- cavities, wear, storage cost, status). Vendors keep their own entries in the vendor portal ('declared'); SRM
-- verifies them (a different person from whoever last changed the entry). Process, machine and tooling types are
-- governed libraries in the SRM Watchtower. Tooling is an asset register: it is retired or returned, never deleted.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('srm_processes', 'assure', 'Manufacturing processes', 'Processes a vendor can offer (print, converting, plastics, metal, wood, textile, finishing, assembly), with the capacity unit each is measured in.', false, 40),
  ('srm_machine_types', 'assure', 'Machine types', 'Machine types vendors list in their capability profile, with the processes each serves.', false, 41),
  ('srm_tooling_types', 'assure', 'Tooling types', 'Moulds, dies, cutting formes, screens, plates and jigs held at vendors.', false, 42)
on conflict (key) do nothing;

insert into public.library_records (library_key, code, name, data, status, effective_from) values
  ('srm_processes','PRT-OFFSET','Offset litho printing','{"group":"print","capacity_unit":"sheets per month","seq":1}','active','2026-01-01'),
  ('srm_processes','PRT-DIGITAL','Digital printing (large format)','{"group":"print","capacity_unit":"m2 per month","seq":2}','active','2026-01-01'),
  ('srm_processes','PRT-FLEXO','Flexo printing','{"group":"print","capacity_unit":"linear m per month","seq":3}','active','2026-01-01'),
  ('srm_processes','PRT-SCREEN','Screen printing','{"group":"print","capacity_unit":"units per month","seq":4}','active','2026-01-01'),
  ('srm_processes','CNV-DIECUT','Die cutting and creasing','{"group":"converting","capacity_unit":"sheets per month","seq":10}','active','2026-01-01'),
  ('srm_processes','CNV-CORR','Corrugated converting','{"group":"converting","capacity_unit":"m2 per month","seq":11}','active','2026-01-01'),
  ('srm_processes','CNV-LAMIN','Lamination and mounting','{"group":"converting","capacity_unit":"m2 per month","seq":12}','active','2026-01-01'),
  ('srm_processes','PLS-INJECT','Injection moulding','{"group":"plastics","capacity_unit":"parts per month","seq":20}','active','2026-01-01'),
  ('srm_processes','PLS-VACUUM','Vacuum forming / thermoforming','{"group":"plastics","capacity_unit":"parts per month","seq":21}','active','2026-01-01'),
  ('srm_processes','PLS-BLOW','Blow moulding','{"group":"plastics","capacity_unit":"parts per month","seq":22}','active','2026-01-01'),
  ('srm_processes','PLS-EXTRUDE','Extrusion','{"group":"plastics","capacity_unit":"kg per month","seq":23}','active','2026-01-01'),
  ('srm_processes','PLS-ACRYLIC','Acrylic fabrication (cut, bend, polish)','{"group":"plastics","capacity_unit":"units per month","seq":24}','active','2026-01-01'),
  ('srm_processes','CNC-ROUTE','CNC routing','{"group":"fabrication","capacity_unit":"machine hours per month","seq":30}','active','2026-01-01'),
  ('srm_processes','CUT-LASER','Laser cutting','{"group":"fabrication","capacity_unit":"machine hours per month","seq":31}','active','2026-01-01'),
  ('srm_processes','MET-SHEET','Sheet metal (punch, bend, weld)','{"group":"metal","capacity_unit":"units per month","seq":40}','active','2026-01-01'),
  ('srm_processes','MET-WIRE','Wire forming','{"group":"metal","capacity_unit":"units per month","seq":41}','active','2026-01-01'),
  ('srm_processes','MET-POWDER','Powder coating','{"group":"finishing","capacity_unit":"m2 per month","seq":42}','active','2026-01-01'),
  ('srm_processes','WOD-JOIN','Wood joinery and furniture','{"group":"wood","capacity_unit":"units per month","seq":50}','active','2026-01-01'),
  ('srm_processes','TEX-PRINT','Textile printing (sublimation, DTG)','{"group":"textile","capacity_unit":"units per month","seq":60}','active','2026-01-01'),
  ('srm_processes','TEX-EMBROID','Embroidery','{"group":"textile","capacity_unit":"units per month","seq":61}','active','2026-01-01'),
  ('srm_processes','TEX-SEW','Cut and sew','{"group":"textile","capacity_unit":"units per month","seq":62}','active','2026-01-01'),
  ('srm_processes','ELE-LIGHT','Lighting and electronics integration','{"group":"electronics","capacity_unit":"units per month","seq":70}','active','2026-01-01'),
  ('srm_processes','ASM-KIT','Assembly, kitting and fulfilment','{"group":"assembly","capacity_unit":"units per month","seq":80}','active','2026-01-01'),
  ('srm_processes','PRM-BRAND','Promo branding (pad print, engrave, transfer)','{"group":"promo","capacity_unit":"units per month","seq":90}','active','2026-01-01'),
  ('srm_machine_types','MC-OFFSET','Sheetfed offset press','{"processes":["PRT-OFFSET"],"examples":"Heidelberg Speedmaster, KBA Rapida, Komori Lithrone"}','active','2026-01-01'),
  ('srm_machine_types','MC-FLATBED','UV flatbed printer','{"processes":["PRT-DIGITAL"],"examples":"Durst P5, EFI VUTEk, Canon Arizona"}','active','2026-01-01'),
  ('srm_machine_types','MC-ROLL','Roll-to-roll printer','{"processes":["PRT-DIGITAL"],"examples":"HP Latex, Mimaki, Epson SureColor"}','active','2026-01-01'),
  ('srm_machine_types','MC-FLEXO','Flexo press','{"processes":["PRT-FLEXO"],"examples":"BOBST, Mark Andy"}','active','2026-01-01'),
  ('srm_machine_types','MC-SCREEN','Screen printing line','{"processes":["PRT-SCREEN","TEX-PRINT"],"examples":"Thieme, M&R"}','active','2026-01-01'),
  ('srm_machine_types','MC-DIECUT','Flatbed die cutter','{"processes":["CNV-DIECUT"],"examples":"BOBST Novacut, Heidelberg Promatrix"}','active','2026-01-01'),
  ('srm_machine_types','MC-DIGICUT','Digital cutting table','{"processes":["CNV-DIECUT","CNV-CORR"],"examples":"Zund G3, Esko Kongsberg"}','active','2026-01-01'),
  ('srm_machine_types','MC-LAMIN','Laminator / mounting press','{"processes":["CNV-LAMIN"],"examples":"Vivid, Kala"}','active','2026-01-01'),
  ('srm_machine_types','MC-INJECT','Injection moulding machine','{"processes":["PLS-INJECT"],"examples":"Engel, Arburg, Haitian (clamp force in tonnes)"}','active','2026-01-01'),
  ('srm_machine_types','MC-VACUUM','Vacuum former','{"processes":["PLS-VACUUM"],"examples":"Formech, Geiss"}','active','2026-01-01'),
  ('srm_machine_types','MC-CNC','CNC router','{"processes":["CNC-ROUTE","WOD-JOIN","PLS-ACRYLIC"],"examples":"Biesse, Homag, AXYZ"}','active','2026-01-01'),
  ('srm_machine_types','MC-LASER','Laser cutter','{"processes":["CUT-LASER","PLS-ACRYLIC","MET-SHEET"],"examples":"Trumpf, Trotec, Bystronic"}','active','2026-01-01'),
  ('srm_machine_types','MC-PRESSBRAKE','Press brake','{"processes":["MET-SHEET"],"examples":"Amada, Trumpf"}','active','2026-01-01'),
  ('srm_machine_types','MC-WELD','Welding cell','{"processes":["MET-SHEET","MET-WIRE"],"examples":"MIG / TIG / robotic"}','active','2026-01-01'),
  ('srm_machine_types','MC-POWDER','Powder coating line','{"processes":["MET-POWDER"],"examples":"Batch or conveyor line"}','active','2026-01-01'),
  ('srm_machine_types','MC-EMBROID','Embroidery machine','{"processes":["TEX-EMBROID"],"examples":"Tajima, Barudan (heads)"}','active','2026-01-01'),
  ('srm_machine_types','MC-PAD','Pad printer / engraver','{"processes":["PRM-BRAND"],"examples":"Tampoprint, laser engraver"}','active','2026-01-01'),
  ('srm_tooling_types','TL-INJ-MOULD','Injection mould','{"wear_unit":"shots"}','active','2026-01-01'),
  ('srm_tooling_types','TL-BLOW-MOULD','Blow mould','{"wear_unit":"shots"}','active','2026-01-01'),
  ('srm_tooling_types','TL-VAC-TOOL','Vacuum-forming tool','{"wear_unit":"pulls"}','active','2026-01-01'),
  ('srm_tooling_types','TL-CUT-FORME','Cutting forme / die','{"wear_unit":"impressions"}','active','2026-01-01'),
  ('srm_tooling_types','TL-EMBOSS','Embossing / foil die','{"wear_unit":"impressions"}','active','2026-01-01'),
  ('srm_tooling_types','TL-PLATE','Printing plate set','{"wear_unit":"impressions"}','active','2026-01-01'),
  ('srm_tooling_types','TL-SCREEN','Screen set','{"wear_unit":"pulls"}','active','2026-01-01'),
  ('srm_tooling_types','TL-EXT-DIE','Extrusion die','{"wear_unit":"kg"}','active','2026-01-01'),
  ('srm_tooling_types','TL-JIG','Jig / fixture / template','{"wear_unit":"uses"}','active','2026-01-01'),
  ('srm_tooling_types','TL-PRESS-TOOL','Press / stamping tool','{"wear_unit":"hits"}','active','2026-01-01')
on conflict do nothing;

create table public.supplier_capabilities (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  site_id uuid references public.supplier_sites(id) on delete set null,
  process_id uuid not null references public.library_records(id),
  in_house boolean not null default true,
  subcontractor text check (subcontractor is null or length(subcontractor) <= 200),
  materials text[] not null default '{}',
  max_width_mm numeric check (max_width_mm is null or max_width_mm > 0),
  max_height_mm numeric check (max_height_mm is null or max_height_mm > 0),
  max_depth_mm numeric check (max_depth_mm is null or max_depth_mm > 0),
  min_run int check (min_run is null or min_run >= 0),
  max_run int check (max_run is null or max_run >= 0),
  monthly_capacity numeric check (monthly_capacity is null or monthly_capacity >= 0),
  lead_time_days int check (lead_time_days is null or lead_time_days between 0 and 365),
  colours int check (colours is null or colours between 0 and 20),
  notes text check (notes is null or length(notes) <= 2000),
  evidence_status text not null default 'declared' check (evidence_status in ('declared', 'verified', 'rejected')),
  verified_by uuid references public.profiles(id) on delete set null, verified_at timestamptz, verification_note text,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now(),
  check (max_run is null or min_run is null or max_run >= min_run)
);
create index supplier_capabilities_supplier_idx on public.supplier_capabilities (supplier_id);

create table public.supplier_machines (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  site_id uuid references public.supplier_sites(id) on delete set null,
  machine_type_id uuid not null references public.library_records(id),
  make text check (make is null or length(make) <= 120),
  model text check (model is null or length(model) <= 120),
  year_built int check (year_built is null or year_built between 1950 and 2100),
  quantity int not null default 1 check (quantity between 1 and 999),
  max_width_mm numeric check (max_width_mm is null or max_width_mm > 0),
  max_height_mm numeric check (max_height_mm is null or max_height_mm > 0),
  colours_stations int check (colours_stations is null or colours_stations between 0 and 50),
  speed numeric check (speed is null or speed >= 0),
  speed_unit text check (speed_unit is null or length(speed_unit) <= 40),
  condition text check (condition is null or condition in ('new', 'good', 'fair', 'poor')),
  notes text check (notes is null or length(notes) <= 2000),
  evidence_status text not null default 'declared' check (evidence_status in ('declared', 'verified', 'rejected')),
  verified_by uuid references public.profiles(id) on delete set null, verified_at timestamptz, verification_note text,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now()
);
create index supplier_machines_supplier_idx on public.supplier_machines (supplier_id);

create sequence public.supplier_tool_no;
create table public.supplier_tooling (
  id uuid primary key default gen_random_uuid(),
  tool_code text not null unique default ('TL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.supplier_tool_no')::text, 5, '0')),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  site_id uuid references public.supplier_sites(id) on delete set null,
  tooling_type_id uuid not null references public.library_records(id),
  description text not null check (length(trim(description)) between 1 and 300),
  owner text not null check (owner in ('supplier', 'adm_indicia', 'client')),
  owner_client_id uuid references public.sourcing_clients(id) on delete set null,
  spec_id uuid references public.job_specs(id) on delete set null,
  material text check (material is null or length(material) <= 120),
  cavities int check (cavities is null or cavities between 1 and 256),
  dimensions text check (dimensions is null or length(dimensions) <= 120),
  made_year int check (made_year is null or made_year between 1950 and 2100),
  last_used date,
  lifetime int check (lifetime is null or lifetime > 0),
  used int check (used is null or used >= 0),
  storage_cost_month numeric check (storage_cost_month is null or storage_cost_month >= 0),
  currency text not null default 'EUR',
  insured boolean not null default false,
  status text not null default 'active' check (status in ('active', 'in_repair', 'retired', 'returned')),
  notes text check (notes is null or length(notes) <= 2000),
  evidence_status text not null default 'declared' check (evidence_status in ('declared', 'verified', 'rejected')),
  verified_by uuid references public.profiles(id) on delete set null, verified_at timestamptz, verification_note text,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now(),
  check (owner = 'client' or owner_client_id is null),
  check (owner <> 'client' or owner_client_id is not null)
);
create index supplier_tooling_supplier_idx on public.supplier_tooling (supplier_id);
create index supplier_tooling_client_idx on public.supplier_tooling (owner_client_id);

create table public.supplier_capability_events (
  id bigint generated always as identity primary key,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  kind text not null check (kind in ('capability', 'machine', 'tooling')),
  item_id uuid not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index supplier_capability_events_idx on public.supplier_capability_events (supplier_id, at desc);

alter table public.supplier_capabilities enable row level security;
alter table public.supplier_machines enable row level security;
alter table public.supplier_tooling enable row level security;
alter table public.supplier_capability_events enable row level security;
create policy sc_read on public.supplier_capabilities for select to authenticated using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy sm_read on public.supplier_machines for select to authenticated using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy st_read on public.supplier_tooling for select to authenticated using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy sce_read on public.supplier_capability_events for select to authenticated using (public.is_internal() or supplier_id = public.my_supplier_id());
revoke insert, update, delete on public.supplier_capabilities, public.supplier_machines, public.supplier_tooling, public.supplier_capability_events from authenticated, anon;

create or replace function public._srm_cap_lib(p_key text, p_id uuid) returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if p_id is null or not exists (select 1 from public.library_records where id = p_id and library_key = p_key and status = 'active') then
    raise exception 'Choose a % from the list', replace(replace(p_key, 'srm_', ''), '_', ' ');
  end if;
  return p_id;
end $$;

/** Who may change a supplier's capability profile: SRM internal users, or a vendor (standard or admin) of that supplier. */
create or replace function public._srm_cap_actor(p_supplier uuid) returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_internal() then return 'internal'; end if;
  if public._vendor_require('standard') = p_supplier then return 'vendor'; end if;
  raise exception 'Not allowed' using errcode = '42501';
end $$;

/**
 * Add or change one capability, machine or tooling entry. Any change (by vendor or SRM) makes it 'declared' again
 * until SRM verifies it. Returns the id.
 */
create or replace function public.srm_capability_save(p_kind text, p_id uuid, p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_site uuid := nullif(p->>'site_id', '')::uuid; v_actor text; v_sup uuid := p_supplier;
  num_ text[] := array[]::text[];
begin
  if p_id is not null then
    execute format('select supplier_id from public.%I where id = $1', case p_kind when 'capability' then 'supplier_capabilities' when 'machine' then 'supplier_machines' when 'tooling' then 'supplier_tooling' else 'x' end)
      into v_sup using p_id;
    if v_sup is null then raise exception 'Entry not found'; end if;
  end if;
  if p_kind not in ('capability', 'machine', 'tooling') then raise exception 'Unknown kind %', p_kind; end if;
  v_actor := public._srm_cap_actor(v_sup);
  if v_site is not null and not exists (select 1 from public.supplier_sites where id = v_site and supplier_id = v_sup) then
    raise exception 'That site belongs to another supplier';
  end if;

  if p_kind = 'capability' then
    if p_id is null then
      insert into public.supplier_capabilities (supplier_id, process_id, created_by, updated_by) values (v_sup, public._srm_cap_lib('srm_processes', nullif(p->>'process_id', '')::uuid), auth.uid(), auth.uid()) returning id into v_id;
    end if;
    update public.supplier_capabilities set site_id = v_site, process_id = public._srm_cap_lib('srm_processes', nullif(p->>'process_id', '')::uuid),
      in_house = coalesce((p->>'in_house')::boolean, true), subcontractor = nullif(trim(p->>'subcontractor'), ''),
      materials = coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(coalesce(p->'materials', '[]'::jsonb)) x where trim(x) <> ''), '{}'),
      max_width_mm = nullif(p->>'max_width_mm', '')::numeric, max_height_mm = nullif(p->>'max_height_mm', '')::numeric, max_depth_mm = nullif(p->>'max_depth_mm', '')::numeric,
      min_run = nullif(p->>'min_run', '')::int, max_run = nullif(p->>'max_run', '')::int, monthly_capacity = nullif(p->>'monthly_capacity', '')::numeric,
      lead_time_days = nullif(p->>'lead_time_days', '')::int, colours = nullif(p->>'colours', '')::int, notes = nullif(trim(p->>'notes'), ''),
      evidence_status = 'declared', verified_by = null, verified_at = null, verification_note = null, updated_by = auth.uid(), updated_at = now()
    where id = v_id;
  elsif p_kind = 'machine' then
    if p_id is null then
      insert into public.supplier_machines (supplier_id, machine_type_id, created_by, updated_by) values (v_sup, public._srm_cap_lib('srm_machine_types', nullif(p->>'machine_type_id', '')::uuid), auth.uid(), auth.uid()) returning id into v_id;
    end if;
    update public.supplier_machines set site_id = v_site, machine_type_id = public._srm_cap_lib('srm_machine_types', nullif(p->>'machine_type_id', '')::uuid),
      make = nullif(trim(p->>'make'), ''), model = nullif(trim(p->>'model'), ''), year_built = nullif(p->>'year_built', '')::int,
      quantity = coalesce(nullif(p->>'quantity', '')::int, 1), max_width_mm = nullif(p->>'max_width_mm', '')::numeric, max_height_mm = nullif(p->>'max_height_mm', '')::numeric,
      colours_stations = nullif(p->>'colours_stations', '')::int, speed = nullif(p->>'speed', '')::numeric, speed_unit = nullif(trim(p->>'speed_unit'), ''),
      condition = nullif(p->>'condition', ''), notes = nullif(trim(p->>'notes'), ''),
      evidence_status = 'declared', verified_by = null, verified_at = null, verification_note = null, updated_by = auth.uid(), updated_at = now()
    where id = v_id;
  else
    if nullif(p->>'owner', '') = 'client' and nullif(p->>'owner_client_id', '') is null then raise exception 'Say which client owns this tooling'; end if;
    if nullif(p->>'spec_id', '') is not null and not exists (select 1 from public.job_specs where id = (p->>'spec_id')::uuid) then raise exception 'Spec not found'; end if;
    if p_id is null then
      insert into public.supplier_tooling (supplier_id, tooling_type_id, description, owner, owner_client_id, created_by, updated_by)
      values (v_sup, public._srm_cap_lib('srm_tooling_types', nullif(p->>'tooling_type_id', '')::uuid), coalesce(nullif(trim(p->>'description'), ''), 'Tooling'),
        coalesce(nullif(p->>'owner', ''), 'supplier'), case when p->>'owner' = 'client' then nullif(p->>'owner_client_id', '')::uuid end, auth.uid(), auth.uid())
      returning id into v_id;
    end if;
    update public.supplier_tooling set site_id = v_site, tooling_type_id = public._srm_cap_lib('srm_tooling_types', nullif(p->>'tooling_type_id', '')::uuid),
      description = coalesce(nullif(trim(p->>'description'), ''), description), owner = coalesce(nullif(p->>'owner', ''), owner),
      owner_client_id = case when coalesce(nullif(p->>'owner', ''), owner) = 'client' then nullif(p->>'owner_client_id', '')::uuid end,
      spec_id = nullif(p->>'spec_id', '')::uuid, material = nullif(trim(p->>'material'), ''), cavities = nullif(p->>'cavities', '')::int,
      dimensions = nullif(trim(p->>'dimensions'), ''), made_year = nullif(p->>'made_year', '')::int, last_used = nullif(p->>'last_used', '')::date,
      lifetime = nullif(p->>'lifetime', '')::int, used = nullif(p->>'used', '')::int, storage_cost_month = nullif(p->>'storage_cost_month', '')::numeric,
      currency = coalesce(nullif(p->>'currency', ''), currency), insured = coalesce((p->>'insured')::boolean, false),
      status = coalesce(nullif(p->>'status', ''), status), notes = nullif(trim(p->>'notes'), ''),
      evidence_status = 'declared', verified_by = null, verified_at = null, verification_note = null, updated_by = auth.uid(), updated_at = now()
    where id = v_id;
  end if;
  insert into public.supplier_capability_events (supplier_id, kind, item_id, action, detail, actor)
  values (v_sup, p_kind, v_id, case when p_id is null then 'added' else 'changed' end, p || jsonb_build_object('by', v_actor), auth.uid());
  return v_id;
end $$;

/** SRM verifies (or rejects) a declared entry. Never the person who last changed it. */
create or replace function public.srm_capability_verify(p_kind text, p_id uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_t text := case p_kind when 'capability' then 'supplier_capabilities' when 'machine' then 'supplier_machines' when 'tooling' then 'supplier_tooling' end;
  v_sup uuid; v_by uuid;
begin
  if v_t is null then raise exception 'Unknown kind %', p_kind; end if;
  if not public.is_internal() then raise exception 'Only SRM can verify' using errcode = '42501'; end if;
  execute format('select supplier_id, updated_by from public.%I where id = $1', v_t) into v_sup, v_by using p_id;
  if v_sup is null then raise exception 'Entry not found'; end if;
  if v_by = auth.uid() then raise exception 'A different person must verify what you entered'; end if;
  if not p_ok and coalesce(trim(p_note), '') = '' then raise exception 'Say why it is rejected'; end if;
  execute format('update public.%I set evidence_status = $1, verified_by = auth.uid(), verified_at = now(), verification_note = $2 where id = $3', v_t)
    using case when p_ok then 'verified' else 'rejected' end, nullif(trim(p_note), ''), p_id;
  insert into public.supplier_capability_events (supplier_id, kind, item_id, action, detail, actor)
  values (v_sup, p_kind, p_id, case when p_ok then 'verified' else 'rejected' end, jsonb_build_object('note', p_note), auth.uid());
end $$;

/** Capabilities and machines can be removed; tooling is an asset register and is only retired or returned. */
create or replace function public.srm_capability_remove(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_t text := case p_kind when 'capability' then 'supplier_capabilities' when 'machine' then 'supplier_machines' end; v_sup uuid;
begin
  if v_t is null then raise exception 'Tooling is kept as a record: set its status to retired or returned instead'; end if;
  execute format('select supplier_id from public.%I where id = $1', v_t) into v_sup using p_id;
  if v_sup is null then raise exception 'Entry not found'; end if;
  perform public._srm_cap_actor(v_sup);
  execute format('delete from public.%I where id = $1', v_t) using p_id;
  insert into public.supplier_capability_events (supplier_id, kind, item_id, action, actor) values (v_sup, p_kind, p_id, 'removed', auth.uid());
end $$;

revoke execute on function public._srm_cap_lib(text, uuid), public._srm_cap_actor(uuid) from public, anon, authenticated;
grant execute on function public.srm_capability_save(text, uuid, uuid, jsonb), public.srm_capability_verify(text, uuid, boolean, text),
  public.srm_capability_remove(text, uuid) to authenticated;
