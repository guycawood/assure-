-- Vendor technical & packaging data sheet (SRM quality, part of the quality spec).
-- For years the vendor's as-built specification and the packaging spec were never collected properly: buyers don't
-- prescribe packaging and say they don't know it at RFQ time. This adds one data sheet per spec (version) x supplier,
-- declared by the vendor in stages, verified by QA/QC and reused through a library of verified sheets.
--   A. Governed libraries (owner SRM = 'assure', maker-checker): packaging_materials and tech_sheet_requirements
--      (which fields are required at which stage: quote / po_acceptance / pre_shipment, by QA/QC level, spec type,
--      category, electronics and destination market). Evidence types for the packed-carton photos are added to
--      qaqc_evidence_types; tolerances come from qaqc_settings (TECH-WEIGHT-TOL-PCT, TECH-DIM-TOL-MM).
--   B. spec_tech_sheets (+ product materials, packaging levels primary/secondary/tertiary and their materials,
--      append-only events with snapshots, QA/QC measurements, and spec_tech_library of verified sheets).
--   C. tech_sheet_required_fields() / tech_sheet_completeness(): required fields in plain words and what is missing.
--   D. Stage capture: the vendor quote (packaging proposal or "to be confirmed by" date, through _core_rfq_submit_quote),
--      PO issue (draft sheets when a rule applies), the vendor PO page (tech_sheet_vendor_save / _copy, viewer-gated).
--   E. Gate and verification: the QA/QC pre-shipment checkpoint can't be submitted until the sheet is complete and
--      declared, and it needs photos plus the measured carton weight and size; _qaqc_verify compares declared vs measured
--      within the tolerances: verified (stored in the library) or mismatch (the checkpoint goes to a quality review).
--   F. Downstream: the Stocktool hand-off reads verified (else declared) sheet values; deliveries and shipments default
--      their gross weight from the sheet; views v_spec_declared_materials, v_packaging_by_material,
--      v_supplier_declaration_accuracy, v_tech_sheets and watchtower_health_tech_sheets.
-- Policy-driven like the approval framework: without requirement rules (seeded in m96) nothing is gated, so existing
-- flows behave as before. Functions that were wrapped are renamed to *_before_tech and called by the new version.

-- ---------------------------------------------------------------------------
-- A. Libraries and default evidence types
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('packaging_materials', 'assure', 'Packaging materials',
   'Materials a vendor declares packaging in (corrugated board, paperboard, LDPE film, PET, wood pallet, ...), with the material group used for packaging (EPR) reporting and the emission factor.', true, 25),
  ('tech_sheet_requirements', 'assure', 'Technical & packaging data requirements',
   'Which technical and packaging fields a vendor must declare at quote, PO acceptance and pre-shipment, by QA/QC level, spec type, category and destination market. Every matching rule adds its fields.', true, 26)
on conflict (key) do nothing;

insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'qaqc_evidence_types', x.code, x.name, x.data::jsonb, 'active', date '2026-01-01', 'Default (technical & packaging data sheet)'
  from (values
    ('PACKED_CARTON_PHOTO', 'Photo of a packed carton', '{"description":"A full carton as it will ship, open and closed, so the packing can be compared with the data sheet.","needs":[],"window":"none","allowed_types":["image/"],"min_files":1}'),
    ('CARTON_LABEL_PHOTO', 'Photo of the carton label', '{"description":"The shipping label and markings on the carton.","needs":[],"window":"none","allowed_types":["image/"],"min_files":1}'),
    ('PALLET_PHOTO', 'Photo of a built pallet', '{"description":"A built, wrapped pallet showing the cartons per layer and the pallet type.","needs":[],"window":"none","allowed_types":["image/"],"min_files":1}')
  ) x(code, name, data)
 where exists (select 1 from public.library_definitions d where d.key = 'qaqc_evidence_types')
   and not exists (select 1 from public.library_records r where r.library_key = 'qaqc_evidence_types' and r.code = x.code);

-- ---------------------------------------------------------------------------
-- B. Tables
-- ---------------------------------------------------------------------------
create sequence public.tech_sheet_no;

create table public.spec_tech_sheets (
  id uuid primary key default gen_random_uuid(),
  sheet_ref text unique,
  spec_id uuid not null references public.job_specs(id) on delete cascade,
  spec_version_id uuid references public.spec_versions(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  region text,
  market text,
  status text not null default 'draft' check (status in ('draft','declared','verified','mismatch')),
  source text not null default 'po' check (source in ('quote','po','copied','library')),
  copied_from_id uuid references public.spec_tech_sheets(id) on delete set null,
  rfq_line_id uuid references public.rfq_lines(id) on delete set null,
  response_id uuid references public.rfq_responses(id) on delete set null,
  po_id uuid references public.purchase_orders(id) on delete set null,
  version int not null default 0,
  spec_revision int,
  tbc_by date,
  tbc_note text,
  -- product as built
  length_mm numeric(10,1) check (length_mm > 0),
  width_mm numeric(10,1) check (width_mm > 0),
  height_mm numeric(10,1) check (height_mm > 0),
  net_weight_g numeric(12,2) check (net_weight_g >= 0),
  finishes text,
  components_note text,
  has_electrical boolean,
  has_battery boolean,
  electrical_detail text,
  origin_country text,
  hs_code text,
  packing_method text,
  notes text,
  declared_by uuid references public.profiles(id) on delete set null,
  declared_at timestamptz,
  declared_by_vendor boolean,
  -- measured at the QA/QC pre-shipment check
  actual_gross_weight_kg numeric(12,3),
  actual_length_mm numeric(10,1),
  actual_width_mm numeric(10,1),
  actual_height_mm numeric(10,1),
  measured_at timestamptz,
  verification jsonb not null default '[]'::jsonb,
  verified_at timestamptz,
  mismatch_at timestamptz,
  checkpoint_id uuid references public.qaqc_checkpoints(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index spec_tech_sheets_uq on public.spec_tech_sheets (spec_id, coalesce(spec_version_id, '00000000-0000-0000-0000-000000000000'::uuid), supplier_id);
create index spec_tech_sheets_supplier_idx on public.spec_tech_sheets (supplier_id, status);
create index spec_tech_sheets_po_idx on public.spec_tech_sheets (po_id);

create table public.spec_tech_sheet_materials (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.spec_tech_sheets(id) on delete cascade,
  substrate_id uuid references public.library_records(id),
  material_name text,
  share_pct numeric(5,2) check (share_pct between 0 and 100),
  weight_g numeric(12,2) check (weight_g >= 0),
  recycled_pct numeric(5,2) check (recycled_pct between 0 and 100),
  sort int not null default 0,
  check (substrate_id is not null or length(trim(coalesce(material_name, ''))) > 0)
);
create index spec_tech_sheet_materials_idx on public.spec_tech_sheet_materials (sheet_id, sort);

create table public.spec_tech_sheet_packs (
  sheet_id uuid not null references public.spec_tech_sheets(id) on delete cascade,
  level text not null check (level in ('primary','secondary','tertiary')),
  not_used boolean not null default false,
  description text,
  length_mm numeric(10,1) check (length_mm > 0),
  width_mm numeric(10,1) check (width_mm > 0),
  height_mm numeric(10,1) check (height_mm > 0),
  units_per_pack int check (units_per_pack > 0),        -- primary: units in a unit pack; secondary: units per carton
  packs_per_carton int check (packs_per_carton > 0),    -- secondary: unit or inner packs per carton
  cartons_per_layer int check (cartons_per_layer > 0),  -- tertiary
  layers int check (layers > 0),                        -- tertiary
  cartons_per_pallet int check (cartons_per_pallet > 0),
  pallet_type text,
  max_stack int check (max_stack > 0),
  gross_weight_kg numeric(12,3) check (gross_weight_kg >= 0),
  labelling text,
  protective_fill text,
  primary key (sheet_id, level)
);

create table public.spec_tech_sheet_pack_materials (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.spec_tech_sheets(id) on delete cascade,
  level text not null check (level in ('primary','secondary','tertiary')),
  packaging_material_id uuid not null references public.library_records(id),
  component text,
  weight_g numeric(12,2) check (weight_g >= 0),
  recycled_pct numeric(5,2) check (recycled_pct between 0 and 100),
  reusable boolean,
  sort int not null default 0
);
create index spec_tech_sheet_pack_materials_idx on public.spec_tech_sheet_pack_materials (sheet_id, level, sort);

create table public.spec_tech_sheet_events (
  id bigint generated always as identity primary key,
  sheet_id uuid not null references public.spec_tech_sheets(id) on delete cascade,
  event text not null,
  version int,
  detail jsonb not null default '{}'::jsonb,
  snapshot jsonb,
  actor uuid references public.profiles(id) on delete set null,
  by_vendor boolean not null default false,
  at timestamptz not null default now()
);
create index spec_tech_sheet_events_idx on public.spec_tech_sheet_events (sheet_id, at);
create trigger spec_tech_sheet_events_no_update before update on public.spec_tech_sheet_events for each row execute function public.trg_client_append_only();

create table public.spec_tech_sheet_measures (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.spec_tech_sheets(id) on delete cascade,
  checkpoint_id uuid not null references public.qaqc_checkpoints(id) on delete cascade,
  submission_no int not null,
  gross_weight_kg numeric(12,3) not null check (gross_weight_kg > 0),
  length_mm numeric(10,1) not null check (length_mm > 0),
  width_mm numeric(10,1) not null check (width_mm > 0),
  height_mm numeric(10,1) not null check (height_mm > 0),
  within_tolerance boolean,
  comparisons jsonb not null default '[]'::jsonb,
  measured_by uuid references public.profiles(id) on delete set null,
  by_vendor boolean not null default false,
  at timestamptz not null default now(),
  unique (checkpoint_id, submission_no)
);

-- The library of verified sheets: what a new RFQ, PO or spec version for the same or a matched spec is pre-filled from.
create table public.spec_tech_library (
  sheet_id uuid primary key references public.spec_tech_sheets(id) on delete cascade,
  spec_id uuid not null references public.job_specs(id) on delete cascade,
  spec_version_id uuid references public.spec_versions(id) on delete set null,
  supplier_id uuid not null references public.suppliers(id),
  title_key text,
  spec_type text,
  product_category text,
  substrate_id uuid references public.library_records(id),
  verified_at timestamptz not null default now()
);

create or replace function public.trg_spec_tech_sheets_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.sheet_ref := 'TS-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.tech_sheet_no')::text, 5, '0');
    select s.job_id, s.region, s.market into new.job_id, new.region, new.market from public.job_specs s where s.id = new.spec_id;
    new.created_at := now(); new.updated_at := now();
  else
    new.sheet_ref := old.sheet_ref; new.spec_id := old.spec_id; new.spec_version_id := old.spec_version_id; new.supplier_id := old.supplier_id;
    new.job_id := old.job_id; new.created_by := old.created_by; new.created_at := old.created_at; new.updated_at := now();
  end if;
  return new;
end $$;
create trigger spec_tech_sheets_before before insert or update on public.spec_tech_sheets for each row execute function public.trg_spec_tech_sheets_before();

-- Library references are checked and kept in the usage guard.
create trigger spec_tech_sheet_materials_sub_check before insert or update of substrate_id on public.spec_tech_sheet_materials
  for each row execute function public.trg_sourcing_library_ref('substrate_id', 'substrates', 'Tech sheet material');
create trigger spec_tech_sheet_materials_sub_sync after insert or update of substrate_id or delete on public.spec_tech_sheet_materials
  for each row execute function public.trg_sourcing_library_ref('substrate_id', 'substrates', 'Tech sheet material');
create trigger spec_tech_sheet_pack_materials_check before insert or update of packaging_material_id on public.spec_tech_sheet_pack_materials
  for each row execute function public.trg_sourcing_library_ref('packaging_material_id', 'packaging_materials', 'Tech sheet packaging');
create trigger spec_tech_sheet_pack_materials_sync after insert or update of packaging_material_id or delete on public.spec_tech_sheet_pack_materials
  for each row execute function public.trg_sourcing_library_ref('packaging_material_id', 'packaging_materials', 'Tech sheet packaging');

-- Logistics: where a default gross weight came from.
alter table public.deliveries add column if not exists weight_source text;
alter table public.shipments add column if not exists weight_source text;

-- ---------------------------------------------------------------------------
-- C. Field catalogue, requirements and completeness
-- ---------------------------------------------------------------------------
create or replace function public.tech_sheet_fields() returns table (code text, label text, section text, seq int)
language sql immutable as $$
  select * from (values
    ('product_dims', 'Finished product size (length x width x height, mm)', 'product', 1),
    ('net_weight', 'Net weight of one unit (g)', 'product', 2),
    ('materials', 'Materials breakdown (each material and its share of the product, %)', 'product', 3),
    ('materials_weight', 'Weight of each product material (g)', 'product', 4),
    ('materials_recycled', 'Recycled content of each product material (%)', 'product', 5),
    ('finishes', 'Finishes (print, coatings, laminates)', 'product', 6),
    ('components', 'Components (bill of materials)', 'product', 7),
    ('electrical', 'Electrical parts or batteries (yes or no, with details)', 'product', 8),
    ('origin_country', 'Country of origin', 'product', 9),
    ('hs_code', 'HS code', 'product', 10),
    ('packing_method', 'Packing method', 'packaging', 11),
    ('primary_pack', 'Unit pack: what it is and its size (or "no unit pack")', 'primary', 12),
    ('primary_materials', 'Unit pack materials', 'primary', 13),
    ('primary_material_weights', 'Unit pack weight by material (g)', 'primary', 14),
    ('primary_recycled', 'Recycled content of the unit pack materials (%)', 'primary', 15),
    ('units_per_carton', 'Units per carton', 'secondary', 16),
    ('carton_dims', 'Carton size (length x width x height, mm)', 'secondary', 17),
    ('carton_gross_weight', 'Gross weight of a full carton (kg)', 'secondary', 18),
    ('carton_materials', 'Carton materials', 'secondary', 19),
    ('carton_material_weights', 'Carton weight by material (g)', 'secondary', 20),
    ('carton_recycled', 'Recycled content of the carton materials (%)', 'secondary', 21),
    ('carton_marking', 'Carton labelling and marking', 'secondary', 22),
    ('protective_fill', 'Protective packaging or void fill (or "none")', 'secondary', 23),
    ('pallet', 'Pallet type and size (or "no pallet")', 'tertiary', 24),
    ('pallet_config', 'Cartons per layer and layers per pallet', 'tertiary', 25),
    ('pallet_gross_weight', 'Gross weight of a full pallet (kg)', 'tertiary', 26),
    ('max_stack', 'Maximum stacking', 'tertiary', 27),
    ('pallet_materials', 'Pallet and wrapping materials', 'tertiary', 28),
    ('pallet_material_weights', 'Pallet and wrapping weight by material (g)', 'tertiary', 29),
    ('pallet_recycled', 'Recycled content of the pallet and wrapping (%)', 'tertiary', 30),
    ('reusable_packaging', 'Whether each packaging material is reusable', 'packaging', 31)
  ) x(code, label, section, seq);
$$;

create or replace function public.tech_sheet_stage_seq(p text) returns int language sql immutable as $$
  select case p when 'quote' then 1 when 'po_acceptance' then 2 when 'pre_shipment' then 3 end;
$$;
create or replace function public.tech_sheet_stage_label(p text) returns text language sql immutable as $$
  select case p when 'quote' then 'Quote' when 'po_acceptance' then 'PO acceptance' when 'pre_shipment' then 'Pre-shipment' else p end;
$$;

-- The fields a sheet actually has (codes from tech_sheet_fields).
create or replace function public._tech_present(p_sheet uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare s public.spec_tech_sheets; p1 public.spec_tech_sheet_packs; p2 public.spec_tech_sheet_packs; p3 public.spec_tech_sheet_packs;
  pk public.spec_tech_sheet_packs; v text[] := '{}'; n int; ns int; nw int; nr int; lvl text; pre text; skip boolean;
  ft text := '';
begin
  select * into s from public.spec_tech_sheets where id = p_sheet;
  if s.id is null then return v; end if;
  select * into p1 from public.spec_tech_sheet_packs where sheet_id = p_sheet and level = 'primary';
  select * into p2 from public.spec_tech_sheet_packs where sheet_id = p_sheet and level = 'secondary';
  select * into p3 from public.spec_tech_sheet_packs where sheet_id = p_sheet and level = 'tertiary';
  if s.length_mm is not null and s.width_mm is not null and s.height_mm is not null then v := v || 'product_dims'::text; end if;
  if s.net_weight_g is not null then v := v || 'net_weight'::text; end if;
  select count(*), count(share_pct), count(weight_g), count(recycled_pct) into n, ns, nw, nr from public.spec_tech_sheet_materials where sheet_id = p_sheet;
  if n > 0 and ns = n then v := v || 'materials'::text; end if;
  if n > 0 and nw = n then v := v || 'materials_weight'::text; end if;
  if n > 0 and nr = n then v := v || 'materials_recycled'::text; end if;
  if coalesce(trim(s.finishes), '') <> '' then v := v || 'finishes'::text; end if;
  if coalesce(trim(s.components_note), '') <> '' or exists (select 1 from public.spec_components c where c.spec_id = s.spec_id) then v := v || 'components'::text; end if;
  if s.has_electrical is not null and (not s.has_electrical or (coalesce(trim(s.electrical_detail), '') <> '' and s.has_battery is not null)) then v := v || 'electrical'::text; end if;
  if coalesce(trim(s.origin_country), '') <> '' then v := v || 'origin_country'::text; end if;
  if coalesce(trim(s.hs_code), '') <> '' then v := v || 'hs_code'::text; end if;
  if coalesce(trim(s.packing_method), '') <> '' then v := v || 'packing_method'::text; end if;
  -- materials per packaging level
  foreach lvl in array array['primary','secondary','tertiary'] loop
    pk := case lvl when 'primary' then p1 when 'secondary' then p2 else p3 end;
    pre := case lvl when 'primary' then 'primary_' when 'secondary' then 'carton_' else 'pallet_' end;
    skip := pk.sheet_id is not null and pk.not_used;
    select count(*), count(weight_g), count(recycled_pct) into n, nw, nr from public.spec_tech_sheet_pack_materials where sheet_id = p_sheet and level = lvl;
    if skip or n > 0 then v := v || (pre || 'materials'); end if;
    if skip or (n > 0 and nw = n) then v := v || (pre || 'material_weights'); end if;
    if skip or (n > 0 and nr = n) then v := v || (pre || 'recycled'); end if;
  end loop;
  if p1.sheet_id is not null and (p1.not_used or (p1.length_mm is not null and p1.width_mm is not null and p1.height_mm is not null)) then v := v || 'primary_pack'::text; end if;
  if p2.sheet_id is not null and (p2.not_used or p2.units_per_pack is not null) then v := v || 'units_per_carton'::text; end if;
  if p2.sheet_id is not null and (p2.not_used or (p2.length_mm is not null and p2.width_mm is not null and p2.height_mm is not null)) then v := v || 'carton_dims'::text; end if;
  if p2.sheet_id is not null and (p2.not_used or p2.gross_weight_kg is not null) then v := v || 'carton_gross_weight'::text; end if;
  if p2.sheet_id is not null and (p2.not_used or coalesce(trim(p2.labelling), '') <> '') then v := v || 'carton_marking'::text; end if;
  ft := coalesce(trim(p1.protective_fill), '') || coalesce(trim(p2.protective_fill), '') || coalesce(trim(p3.protective_fill), '');
  if ft <> '' then v := v || 'protective_fill'::text; end if;
  if p3.sheet_id is not null and (p3.not_used or (coalesce(trim(p3.pallet_type), '') <> '' and p3.length_mm is not null and p3.width_mm is not null)) then v := v || 'pallet'::text; end if;
  if p3.sheet_id is not null and (p3.not_used or p3.cartons_per_pallet is not null or (p3.cartons_per_layer is not null and p3.layers is not null)) then v := v || 'pallet_config'::text; end if;
  if p3.sheet_id is not null and (p3.not_used or p3.gross_weight_kg is not null) then v := v || 'pallet_gross_weight'::text; end if;
  if p2.max_stack is not null or p3.max_stack is not null then v := v || 'max_stack'::text; end if;
  select count(*), count(reusable) into n, nr from public.spec_tech_sheet_pack_materials where sheet_id = p_sheet;
  if n > 0 and nr = n then v := v || 'reusable_packaging'::text; end if;
  return v;
end $$;

-- Every matching requirement rule (stage at or before p_stage) adds its fields. Returns
-- [{code, label, section, rules: [{rule, stage, why}]}] in catalogue order.
create or replace function public._tech_requirements(p_spec uuid, p_version uuid, p_supplier uuid, p_stage text, p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.job_specs; j public.jobs; v_level int; v_markets text[]; v_cat text; r public.library_records; v_stage int := public.tech_sheet_stage_seq(p_stage);
  v_fields jsonb := '{}'::jsonb; f text; vals text[];
begin
  if v_stage is null then raise exception 'Unknown stage %: use quote, po_acceptance or pre_shipment', coalesce(p_stage, '(none)'); end if;
  select * into s from public.job_specs where id = p_spec;
  if s.id is null then return '[]'::jsonb; end if;
  select * into j from public.jobs where id = s.job_id;
  select coalesce(array_agg(distinct m) filter (where m is not null), '{}') into v_markets from (
    select public._market_code(j.market) m
    union select public._market_code(s.end_market)
    union select d.market from public.deliveries d where d.spec_id = p_spec and d.supplier_id is not distinct from p_supplier and d.status <> 'cancelled'
    union select public._market_code(dp.country) from public.rfq_line_delivery_points dp join public.rfq_lines l on l.id = dp.line_id where l.spec_id = p_spec) x;
  v_cat := lower(coalesce(s.product_category, '') || ' ' || coalesce(s.product_sub_type, '') || ' ' || coalesce(j.category, ''));
  for r in select * from public._lib_current('tech_sheet_requirements', p_date) order by code loop
    if coalesce(public.tech_sheet_stage_seq(r.data->>'stage'), 9) > v_stage then continue; end if;
    if jsonb_typeof(r.data->'spec_types') = 'array' and jsonb_array_length(r.data->'spec_types') > 0 and not ((r.data->'spec_types') ? s.spec_type) then continue; end if;
    vals := coalesce(array(select lower(x) from jsonb_array_elements_text(case when jsonb_typeof(r.data->'categories') = 'array' then r.data->'categories' else '[]'::jsonb end) x), '{}');
    if cardinality(vals) > 0 and not exists (select 1 from unnest(vals) v where v_cat like '%' || v || '%') then continue; end if;
    vals := coalesce(array(select upper(x) from jsonb_array_elements_text(case when jsonb_typeof(r.data->'markets') = 'array' then r.data->'markets' else '[]'::jsonb end) x), '{}');
    if cardinality(vals) > 0 and not (v_markets && vals) then continue; end if;
    if coalesce((r.data->>'electronics')::boolean, false) and not coalesce(s.has_lighting_electronics, false) then continue; end if;
    if nullif(r.data->>'min_level', '') is not null then
      if v_level is null then
        v_level := (select required_level from public.qaqc_plans where spec_id = p_spec and supplier_id is not distinct from p_supplier and status <> 'waived' order by created_at desc limit 1);
        if v_level is null then v_level := coalesce((public._qaqc_compute(p_spec, null, p_date)->>'level')::int, 1); end if;
      end if;
      if v_level < (r.data->>'min_level')::int then continue; end if;
    end if;
    for f in select jsonb_array_elements_text(case when jsonb_typeof(r.data->'fields') = 'array' then r.data->'fields' else '[]'::jsonb end) loop
      if not exists (select 1 from public.tech_sheet_fields() x where x.code = f) then continue; end if;
      v_fields := jsonb_set(v_fields, array[f], coalesce(v_fields->f, '[]'::jsonb)
        || jsonb_build_object('rule', r.code, 'stage', r.data->>'stage', 'why', coalesce(nullif(r.data->>'explanation', ''), r.name)));
    end loop;
  end loop;
  return coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'section', x.section, 'rules', v_fields->x.code) order by x.seq)
                     from public.tech_sheet_fields() x where v_fields ? x.code), '[]'::jsonb);
end $$;

create or replace function public._tech_completeness(p_sheet uuid, p_stage text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.spec_tech_sheets; v_req jsonb; v_have text[]; v_total int; v_ok int;
begin
  select * into s from public.spec_tech_sheets where id = p_sheet;
  if s.id is null then return null; end if;
  v_req := public._tech_requirements(s.spec_id, s.spec_version_id, s.supplier_id, p_stage);
  v_have := public._tech_present(p_sheet);
  select count(*), count(*) filter (where x->>'code' = any (v_have)) into v_total, v_ok from jsonb_array_elements(v_req) x;
  return jsonb_build_object('stage', p_stage, 'required', v_total, 'present', v_ok,
    'percent', case when v_total = 0 then 100 else floor(100.0 * v_ok / v_total) end,
    'complete', v_ok = v_total, 'declared', s.status <> 'draft', 'tbc_by', s.tbc_by,
    'missing', coalesce((select jsonb_agg(x->>'label') from jsonb_array_elements(v_req) x where not (x->>'code' = any (v_have))), '[]'::jsonb),
    'missing_codes', coalesce((select jsonb_agg(x->>'code') from jsonb_array_elements(v_req) x where not (x->>'code' = any (v_have))), '[]'::jsonb),
    'required_fields', v_req);
end $$;

-- A vendor may work on a spec it was invited to quote on (RFQ sent) or that is on its issued / accepted PO.
create or replace function public._tech_vendor_can(p_spec uuid, p_supplier uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_supplier is not null and (
    exists (select 1 from public.purchase_orders p join public.estimate_lines el on el.estimate_id = p.estimate_id
             where el.spec_id = p_spec and p.supplier_id = p_supplier and p.status in ('issued','accepted'))
    or exists (select 1 from public.rfq_invitations i join public.rfqs r on r.id = i.rfq_id join public.rfq_lines l on l.rfq_id = r.id
                where l.spec_id = p_spec and i.supplier_id = p_supplier and r.status <> 'draft'));
$$;

create or replace function public.tech_sheet_required_fields(p_spec uuid, p_supplier uuid, p_stage text, p_spec_version uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() and (public.my_supplier_id() is null or p_supplier is distinct from public.my_supplier_id()
                                   or not public._tech_vendor_can(p_spec, p_supplier)) then
    raise exception 'Spec not found' using errcode = '42501';
  end if;
  return public._tech_requirements(p_spec, p_spec_version, p_supplier, p_stage);
end $$;

create or replace function public.tech_sheet_completeness(p_sheet uuid, p_stage text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_internal()
     and not exists (select 1 from public.spec_tech_sheets where id = p_sheet and supplier_id = public.my_supplier_id()) then
    raise exception 'Sheet not found' using errcode = '42501';
  end if;
  return public._tech_completeness(p_sheet, p_stage);
end $$;

-- ---------------------------------------------------------------------------
-- Sheet content: snapshot, copy, save
-- ---------------------------------------------------------------------------
create or replace function public._tech_sheet_snapshot(p_sheet uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'length_mm', s.length_mm, 'width_mm', s.width_mm, 'height_mm', s.height_mm, 'net_weight_g', s.net_weight_g, 'finishes', s.finishes,
    'components_note', s.components_note, 'has_electrical', s.has_electrical, 'has_battery', s.has_battery, 'electrical_detail', s.electrical_detail,
    'origin_country', s.origin_country, 'hs_code', s.hs_code, 'packing_method', s.packing_method, 'notes', s.notes, 'tbc_by', s.tbc_by, 'tbc_note', s.tbc_note,
    'materials', coalesce((select jsonb_agg(jsonb_build_object('substrate_id', m.substrate_id, 'substrate_code', lr.code, 'substrate_name', lr.name,
        'material_name', m.material_name, 'share_pct', m.share_pct, 'weight_g', m.weight_g, 'recycled_pct', m.recycled_pct) order by m.sort)
      from public.spec_tech_sheet_materials m left join public.library_records lr on lr.id = m.substrate_id where m.sheet_id = s.id), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg((to_jsonb(p) - 'sheet_id') || jsonb_build_object('materials', coalesce((
        select jsonb_agg(jsonb_build_object('packaging_material_id', pm.packaging_material_id, 'material_code', lr.code, 'material_name', lr.name,
          'material_group', lr.data->>'material_group', 'component', pm.component, 'weight_g', pm.weight_g, 'recycled_pct', pm.recycled_pct, 'reusable', pm.reusable) order by pm.sort)
        from public.spec_tech_sheet_pack_materials pm join public.library_records lr on lr.id = pm.packaging_material_id
       where pm.sheet_id = s.id and pm.level = p.level), '[]'::jsonb))
      order by case p.level when 'primary' then 1 when 'secondary' then 2 else 3 end)
      from public.spec_tech_sheet_packs p where p.sheet_id = s.id), '[]'::jsonb))
  from public.spec_tech_sheets s where s.id = p_sheet;
$$;

create or replace function public._tech_sheet_event(p_sheet uuid, p_event text, p_detail jsonb, p_snapshot boolean, p_vendor boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.spec_tech_sheet_events (sheet_id, event, version, detail, snapshot, actor, by_vendor)
  select s.id, p_event, s.version, coalesce(p_detail, '{}'::jsonb), case when p_snapshot then public._tech_sheet_snapshot(s.id) end, auth.uid(), coalesce(p_vendor, false)
    from public.spec_tech_sheets s where s.id = p_sheet;
$$;

-- Copy the declared content (not the status, measurements or links) from one sheet to another.
create or replace function public._tech_sheet_copy_content(p_target uuid, p_source uuid) returns void
language plpgsql security definer set search_path = public as $$
declare src public.spec_tech_sheets;
begin
  select * into src from public.spec_tech_sheets where id = p_source;
  if src.id is null then raise exception 'The sheet to copy from was not found'; end if;
  update public.spec_tech_sheets set length_mm = src.length_mm, width_mm = src.width_mm, height_mm = src.height_mm, net_weight_g = src.net_weight_g,
    finishes = src.finishes, components_note = src.components_note, has_electrical = src.has_electrical, has_battery = src.has_battery,
    electrical_detail = src.electrical_detail, origin_country = src.origin_country, hs_code = src.hs_code, packing_method = src.packing_method,
    copied_from_id = src.id
   where id = p_target;
  delete from public.spec_tech_sheet_materials where sheet_id = p_target;
  insert into public.spec_tech_sheet_materials (sheet_id, substrate_id, material_name, share_pct, weight_g, recycled_pct, sort)
  select p_target, m.substrate_id, m.material_name, m.share_pct, m.weight_g, m.recycled_pct, m.sort from public.spec_tech_sheet_materials m
   where m.sheet_id = p_source and (m.substrate_id is null or exists (select 1 from public.library_records r where r.id = m.substrate_id and r.status = 'active'));
  delete from public.spec_tech_sheet_packs where sheet_id = p_target;
  insert into public.spec_tech_sheet_packs (sheet_id, level, not_used, description, length_mm, width_mm, height_mm, units_per_pack, packs_per_carton,
    cartons_per_layer, layers, cartons_per_pallet, pallet_type, max_stack, gross_weight_kg, labelling, protective_fill)
  select p_target, level, not_used, description, length_mm, width_mm, height_mm, units_per_pack, packs_per_carton, cartons_per_layer, layers,
    cartons_per_pallet, pallet_type, max_stack, gross_weight_kg, labelling, protective_fill from public.spec_tech_sheet_packs where sheet_id = p_source;
  delete from public.spec_tech_sheet_pack_materials where sheet_id = p_target;
  insert into public.spec_tech_sheet_pack_materials (sheet_id, level, packaging_material_id, component, weight_g, recycled_pct, reusable, sort)
  select p_target, pm.level, pm.packaging_material_id, pm.component, pm.weight_g, pm.recycled_pct, pm.reusable, pm.sort from public.spec_tech_sheet_pack_materials pm
   where pm.sheet_id = p_source and exists (select 1 from public.library_records r where r.id = pm.packaging_material_id and r.status = 'active');
end $$;

-- Best verified sheet in the library for a spec (version) x supplier: the same spec first, then the same item (title and
-- type), then a similar spec (type, category and substrate). Only the same supplier's sheets: packaging data is the
-- supplier's own and is never shown to another supplier.
create or replace function public._tech_prefill_source(p_spec uuid, p_version uuid, p_supplier uuid, p_exclude uuid default null)
returns table (sheet_id uuid, sheet_ref text, match text)
language sql stable security definer set search_path = public as $$
  with me as (select s.id, lower(trim(s.title)) as title_key, s.spec_type, lower(coalesce(s.product_category, '')) as cat, s.substrate_id from public.job_specs s where s.id = p_spec)
  select l.sheet_id, t.sheet_ref,
         case when l.spec_id = me.id then 'the same spec' when l.title_key = me.title_key and l.spec_type = me.spec_type then 'the same item on an earlier job' else 'a similar spec' end
    from public.spec_tech_library l join me on true join public.spec_tech_sheets t on t.id = l.sheet_id
   where l.supplier_id = p_supplier and l.sheet_id is distinct from p_exclude and t.status = 'verified'
     and (l.spec_id = me.id or (l.title_key = me.title_key and l.spec_type = me.spec_type)
          or (l.spec_type = me.spec_type and lower(coalesce(l.product_category, '')) = me.cat and me.cat <> '' and l.substrate_id is not distinct from me.substrate_id and me.substrate_id is not null))
   order by (l.spec_id = me.id) desc, (l.spec_version_id is not distinct from p_version) desc, (l.title_key = me.title_key) desc, l.verified_at desc
   limit 1;
$$;

-- Find or create the sheet for a spec (version) x supplier. A new sheet is pre-filled from the supplier's best verified sheet.
create or replace function public._tech_sheet_ensure(p_spec uuid, p_version uuid, p_supplier uuid, p_source text, p_po uuid, p_rfq_line uuid, p_response uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; pf record;
begin
  if p_version is not null and not exists (select 1 from public.spec_versions where id = p_version and spec_id = p_spec) then
    raise exception 'That version does not belong to the spec';
  end if;
  select id into v_id from public.spec_tech_sheets
   where spec_id = p_spec and spec_version_id is not distinct from p_version and supplier_id = p_supplier;
  if v_id is not null then return v_id; end if;
  insert into public.spec_tech_sheets (spec_id, spec_version_id, supplier_id, source, po_id, rfq_line_id, response_id, created_by)
  values (p_spec, p_version, p_supplier, coalesce(p_source, 'po'), p_po, p_rfq_line, p_response, auth.uid())
  returning id into v_id;
  select * into pf from public._tech_prefill_source(p_spec, p_version, p_supplier, v_id);
  if pf.sheet_id is not null then
    perform public._tech_sheet_copy_content(v_id, pf.sheet_id);
    update public.spec_tech_sheets set source = 'library' where id = v_id;
    perform public._tech_sheet_event(v_id, 'created', jsonb_build_object('source', 'library', 'prefilled_from', pf.sheet_ref, 'match', pf.match), true, false);
  else
    perform public._tech_sheet_event(v_id, 'created', jsonb_build_object('source', coalesce(p_source, 'po')), false, false);
  end if;
  return v_id;
end $$;

-- Save content (keys present in p_data are changed; materials / packs are replaced when given) and optionally declare it.
-- p_data: { length_mm, width_mm, height_mm, net_weight_g, finishes, components_note, has_electrical, has_battery, electrical_detail,
--   origin_country, hs_code, packing_method, notes, tbc_by, tbc_note,
--   materials: [{substrate_code|substrate_id, material_name, share_pct, weight_g, recycled_pct}],
--   packs: [{level, not_used, description, length_mm, width_mm, height_mm, units_per_pack, packs_per_carton, cartons_per_layer, layers,
--            cartons_per_pallet, pallet_type, max_stack, gross_weight_kg, labelling, protective_fill,
--            materials: [{material_code|packaging_material_id, component, weight_g, recycled_pct, reusable}]}] }
create or replace function public._tech_sheet_save(p_sheet uuid, p_data jsonb, p_declare boolean, p_vendor boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.spec_tech_sheets; d jsonb := coalesce(p_data, '{}'::jsonb); k text; x jsonb; m jsonb; v_sub uuid; v_pm uuid; n int := 0; nm int;
  v_sum numeric; v_all boolean; v_lvl text; v_was text; v_rev int;
begin
  select * into s from public.spec_tech_sheets where id = p_sheet for update;
  if s.id is null then raise exception 'Sheet not found' using errcode = '42501'; end if;
  if s.status = 'verified' then raise exception 'This data sheet is verified against the goods, so it is locked. Ask adm Indicia to reopen it if something changed.'; end if;
  if jsonb_typeof(d) <> 'object' then raise exception 'Nothing to save'; end if;
  foreach k in array array['length_mm','width_mm','height_mm','net_weight_g'] loop
    if d ? k and nullif(d->>k, '') is not null and (d->>k)::numeric <= 0 then raise exception 'Sizes and weights must be above zero'; end if;
  end loop;
  if d ? 'tbc_by' and nullif(d->>'tbc_by', '') is not null and (d->>'tbc_by')::date < current_date then
    raise exception 'The "to be confirmed by" date can''t be in the past';
  end if;
  update public.spec_tech_sheets set
    length_mm = case when d ? 'length_mm' then nullif(d->>'length_mm', '')::numeric else length_mm end,
    width_mm = case when d ? 'width_mm' then nullif(d->>'width_mm', '')::numeric else width_mm end,
    height_mm = case when d ? 'height_mm' then nullif(d->>'height_mm', '')::numeric else height_mm end,
    net_weight_g = case when d ? 'net_weight_g' then nullif(d->>'net_weight_g', '')::numeric else net_weight_g end,
    finishes = case when d ? 'finishes' then left(nullif(trim(d->>'finishes'), ''), 1000) else finishes end,
    components_note = case when d ? 'components_note' then left(nullif(trim(d->>'components_note'), ''), 2000) else components_note end,
    has_electrical = case when d ? 'has_electrical' then nullif(d->>'has_electrical', '')::boolean else has_electrical end,
    has_battery = case when d ? 'has_battery' then nullif(d->>'has_battery', '')::boolean else has_battery end,
    electrical_detail = case when d ? 'electrical_detail' then left(nullif(trim(d->>'electrical_detail'), ''), 1000) else electrical_detail end,
    origin_country = case when d ? 'origin_country' then left(nullif(trim(d->>'origin_country'), ''), 100) else origin_country end,
    hs_code = case when d ? 'hs_code' then left(nullif(trim(d->>'hs_code'), ''), 20) else hs_code end,
    packing_method = case when d ? 'packing_method' then left(nullif(trim(d->>'packing_method'), ''), 500) else packing_method end,
    notes = case when d ? 'notes' then left(nullif(trim(d->>'notes'), ''), 2000) else notes end,
    tbc_by = case when d ? 'tbc_by' then nullif(d->>'tbc_by', '')::date else tbc_by end,
    tbc_note = case when d ? 'tbc_note' then left(nullif(trim(d->>'tbc_note'), ''), 500) else tbc_note end
   where id = p_sheet;
  update public.spec_tech_sheets set has_battery = false where id = p_sheet and has_electrical = false and has_battery is null;

  if jsonb_typeof(d->'materials') = 'array' then
    delete from public.spec_tech_sheet_materials where sheet_id = p_sheet;
    v_sum := 0; v_all := true; nm := 0;
    for x in select * from jsonb_array_elements(d->'materials') loop
      v_sub := null;
      if nullif(x->>'substrate_id', '') is not null then v_sub := (x->>'substrate_id')::uuid;
      elsif nullif(trim(x->>'substrate_code'), '') is not null then
        select id into v_sub from public.library_records where library_key = 'substrates' and code = trim(x->>'substrate_code') and status = 'active' order by version desc limit 1;
        if v_sub is null then raise exception 'Material % is not an active substrate in the Watchtower library', trim(x->>'substrate_code'); end if;
      end if;
      if v_sub is null and coalesce(trim(x->>'material_name'), '') = '' then continue; end if;
      foreach k in array array['share_pct','weight_g','recycled_pct'] loop
        if nullif(x->>k, '') is not null and (x->>k)::numeric < 0 then raise exception 'Material shares, weights and recycled content can''t be negative'; end if;
      end loop;
      if coalesce(nullif(x->>'share_pct', '')::numeric, 0) > 100 or coalesce(nullif(x->>'recycled_pct', '')::numeric, 0) > 100 then
        raise exception 'Percentages can''t be more than 100';
      end if;
      nm := nm + 1;
      if nullif(x->>'share_pct', '') is null then v_all := false; else v_sum := v_sum + (x->>'share_pct')::numeric; end if;
      insert into public.spec_tech_sheet_materials (sheet_id, substrate_id, material_name, share_pct, weight_g, recycled_pct, sort)
      values (p_sheet, v_sub, left(nullif(trim(x->>'material_name'), ''), 200), nullif(x->>'share_pct', '')::numeric, nullif(x->>'weight_g', '')::numeric,
              nullif(x->>'recycled_pct', '')::numeric, nm);
    end loop;
    if nm > 0 and v_all and abs(v_sum - 100) > 1 then raise exception 'The material shares must add up to 100%% (they add up to %)', round(v_sum, 1) || '%'; end if;
  end if;

  if jsonb_typeof(d->'packs') = 'array' then
    delete from public.spec_tech_sheet_pack_materials where sheet_id = p_sheet;
    delete from public.spec_tech_sheet_packs where sheet_id = p_sheet;
    for x in select * from jsonb_array_elements(d->'packs') loop
      v_lvl := x->>'level';
      if v_lvl not in ('primary','secondary','tertiary') then raise exception 'Packaging level must be primary, secondary or tertiary'; end if;
      foreach k in array array['length_mm','width_mm','height_mm','units_per_pack','packs_per_carton','cartons_per_layer','layers','cartons_per_pallet','max_stack','gross_weight_kg'] loop
        if nullif(x->>k, '') is not null and (x->>k)::numeric <= 0 then raise exception 'Packaging sizes, counts and weights must be above zero'; end if;
      end loop;
      insert into public.spec_tech_sheet_packs (sheet_id, level, not_used, description, length_mm, width_mm, height_mm, units_per_pack, packs_per_carton,
        cartons_per_layer, layers, cartons_per_pallet, pallet_type, max_stack, gross_weight_kg, labelling, protective_fill)
      values (p_sheet, v_lvl, coalesce(nullif(x->>'not_used', '')::boolean, false), left(nullif(trim(x->>'description'), ''), 500),
        nullif(x->>'length_mm', '')::numeric, nullif(x->>'width_mm', '')::numeric, nullif(x->>'height_mm', '')::numeric,
        nullif(x->>'units_per_pack', '')::numeric::int, nullif(x->>'packs_per_carton', '')::numeric::int, nullif(x->>'cartons_per_layer', '')::numeric::int,
        nullif(x->>'layers', '')::numeric::int, nullif(x->>'cartons_per_pallet', '')::numeric::int, left(nullif(trim(x->>'pallet_type'), ''), 100),
        nullif(x->>'max_stack', '')::numeric::int, nullif(x->>'gross_weight_kg', '')::numeric, left(nullif(trim(x->>'labelling'), ''), 1000),
        left(nullif(trim(x->>'protective_fill'), ''), 500))
      on conflict (sheet_id, level) do nothing;
      nm := 0;
      for m in select * from jsonb_array_elements(case when jsonb_typeof(x->'materials') = 'array' then x->'materials' else '[]'::jsonb end) loop
        v_pm := null;
        if nullif(m->>'packaging_material_id', '') is not null then v_pm := (m->>'packaging_material_id')::uuid;
        elsif nullif(trim(m->>'material_code'), '') is not null then
          select id into v_pm from public.library_records where library_key = 'packaging_materials' and code = trim(m->>'material_code') and status = 'active' order by version desc limit 1;
          if v_pm is null then raise exception 'Packaging material % is not in the Watchtower packaging materials library', trim(m->>'material_code'); end if;
        end if;
        if v_pm is null then continue; end if;
        if coalesce(nullif(m->>'weight_g', '')::numeric, 0) < 0 or coalesce(nullif(m->>'recycled_pct', '')::numeric, 0) not between 0 and 100 then
          raise exception 'Packaging weights must be zero or more and recycled content between 0 and 100%%';
        end if;
        nm := nm + 1;
        insert into public.spec_tech_sheet_pack_materials (sheet_id, level, packaging_material_id, component, weight_g, recycled_pct, reusable, sort)
        values (p_sheet, v_lvl, v_pm, left(nullif(trim(m->>'component'), ''), 200), nullif(m->>'weight_g', '')::numeric, nullif(m->>'recycled_pct', '')::numeric,
                nullif(m->>'reusable', '')::boolean, nm);
      end loop;
    end loop;
  end if;

  v_was := s.status;
  if coalesce(p_declare, false) then
    select revision into v_rev from public.job_specs where id = s.spec_id;
    update public.spec_tech_sheets set status = 'declared', version = version + 1, declared_by = auth.uid(), declared_at = now(),
      declared_by_vendor = coalesce(p_vendor, false), spec_revision = v_rev, tbc_by = null, tbc_note = null
     where id = p_sheet;
    perform public._tech_sheet_event(p_sheet, case when v_was = 'mismatch' then 'redeclared_after_mismatch' else 'declared' end,
      jsonb_build_object('from', v_was), true, p_vendor);
  else
    perform public._tech_sheet_event(p_sheet, 'saved', jsonb_build_object('sections', (select jsonb_agg(key) from jsonb_object_keys(d) key)), false, p_vendor);
  end if;
  perform public._tech_apply_evidence_for_sheet(p_sheet);
  return jsonb_build_object('sheet_id', p_sheet, 'status', (select status from public.spec_tech_sheets where id = p_sheet),
    'po_acceptance', public._tech_completeness(p_sheet, 'po_acceptance') - 'required_fields',
    'pre_shipment', public._tech_completeness(p_sheet, 'pre_shipment') - 'required_fields');
end $$;

-- ---------------------------------------------------------------------------
-- QA/QC links: the plan's sheet, extra pre-shipment evidence
-- ---------------------------------------------------------------------------
create or replace function public._tech_sheet_for_plan(p_plan uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from public.qaqc_plans pl
    left join public.estimate_lines el on el.id = pl.estimate_line_id
    left join public.rfq_lines rl on rl.id = el.rfq_line_id
    join public.spec_tech_sheets t on t.spec_id = pl.spec_id and t.supplier_id = pl.supplier_id
   where pl.id = p_plan
   order by (t.spec_version_id is not distinct from rl.spec_version_id) desc, t.updated_at desc limit 1;
$$;

-- When a sheet applies to a plan and the rules need data at pre-shipment, the pre-shipment checkpoint also needs photos
-- of a packed carton and its label (and of a built pallet when the goods ship on pallets).
create or replace function public._tech_apply_evidence(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl public.qaqc_plans; v_sheet uuid; t public.spec_tech_sheets; v_add text[] := '{}'; c public.qaqc_checkpoints; v_pallet boolean; x text;
begin
  select * into pl from public.qaqc_plans where id = p_plan;
  if pl.id is null or pl.po_id is null or pl.spec_id is null or pl.status in ('passed','waived') then return; end if;
  v_sheet := public._tech_sheet_for_plan(p_plan);
  if v_sheet is null then return; end if;
  select * into t from public.spec_tech_sheets where id = v_sheet;
  if jsonb_array_length(public._tech_requirements(t.spec_id, t.spec_version_id, t.supplier_id, 'pre_shipment')) = 0 then return; end if;
  v_pallet := exists (select 1 from public.spec_tech_sheet_packs where sheet_id = v_sheet and level = 'tertiary' and not not_used);
  foreach x in array array['PACKED_CARTON_PHOTO','CARTON_LABEL_PHOTO'] || case when v_pallet then array['PALLET_PHOTO'] else '{}'::text[] end loop
    if (public.library_effective('qaqc_evidence_types', x, current_date)).id is not null then v_add := v_add || x; end if;
  end loop;
  if cardinality(v_add) = 0 then return; end if;
  select * into c from public.qaqc_checkpoints where plan_id = p_plan and checkpoint = 'pre_shipment' for update;
  if c.id is null or c.status in ('verified','auto_verified','withdrawn') then return; end if;
  update public.qaqc_checkpoints
     set required_evidence = c.required_evidence || coalesce(array(select a from unnest(v_add) a where not (a = any (c.required_evidence))), '{}'), updated_at = now()
   where id = c.id and exists (select 1 from unnest(v_add) a where not (a = any (c.required_evidence)));
end $$;

create or replace function public._tech_apply_evidence_for_sheet(p_sheet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.spec_tech_sheets; v uuid;
begin
  select * into t from public.spec_tech_sheets where id = p_sheet;
  for v in select pl.id from public.qaqc_plans pl join public.purchase_orders p on p.id = pl.po_id
            where pl.spec_id = t.spec_id and pl.supplier_id = t.supplier_id and p.status in ('issued','accepted') loop
    if public._tech_sheet_for_plan(v) = p_sheet then perform public._tech_apply_evidence(v); end if;
  end loop;
end $$;

-- Rebuilding checkpoints (level changes) keeps the extra evidence.
alter function public._qaqc_build_checkpoints(uuid) rename to _qaqc_build_checkpoints_before_tech;
create function public._qaqc_build_checkpoints(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._qaqc_build_checkpoints_before_tech(p_plan);
  perform public._tech_apply_evidence(p_plan);
end $$;

-- PO issued: link existing sheets (from the quote) to the PO, and open a draft sheet for each line a rule applies to.
create or replace function public._tech_sheets_for_po(p_po uuid) returns int
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; l record; v_sheet uuid; n int := 0;
begin
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null then return 0; end if;
  for l in select el.spec_id, rl.spec_version_id from public.estimate_lines el left join public.rfq_lines rl on rl.id = el.rfq_line_id
            where el.estimate_id = p.estimate_id loop
    select id into v_sheet from public.spec_tech_sheets where spec_id = l.spec_id and spec_version_id is not distinct from l.spec_version_id and supplier_id = p.supplier_id;
    if v_sheet is null and jsonb_array_length(public._tech_requirements(l.spec_id, l.spec_version_id, p.supplier_id, 'pre_shipment')) > 0 then
      v_sheet := public._tech_sheet_ensure(l.spec_id, l.spec_version_id, p.supplier_id, 'po', p_po, null, null);
    end if;
    if v_sheet is not null then
      update public.spec_tech_sheets set po_id = p_po where id = v_sheet and po_id is distinct from p_po;
      perform public._tech_apply_evidence_for_sheet(v_sheet);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.trg_po_tech_sheets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    perform public._tech_sheets_for_po(new.id);
    if exists (select 1 from public.spec_tech_sheets where po_id = new.id and status = 'draft') then
      perform public.notify_supplier(new.supplier_id, 'orders', 'Technical & packaging data needed: ' || new.po_number,
        'Fill in the technical & packaging data sheet on the order. It must be complete before the pre-shipment QA/QC check.', '/vendor/orders/' || new.id || '#tech-sheet');
    end if;
  end if;
  return null;
end $$;
-- Named after purchase_orders_qaqc_plans so it runs after the QA/QC plans exist (triggers fire in name order).
create trigger purchase_orders_tech_sheets after update of status on public.purchase_orders for each row execute function public.trg_po_tech_sheets();

-- ---------------------------------------------------------------------------
-- E. Gate at the pre-shipment checkpoint and declared vs measured
-- ---------------------------------------------------------------------------
alter function public._qaqc_submit(uuid, jsonb, jsonb, boolean) rename to _qaqc_submit_before_tech;
create function public._qaqc_submit(p_checkpoint uuid, p_evidence jsonb, p_data jsonb, p_vendor boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.qaqc_checkpoints; v_sheet uuid; t public.spec_tech_sheets; v_comp jsonb; m jsonb; k text;
begin
  select * into c from public.qaqc_checkpoints where id = p_checkpoint;
  if c.id is not null and c.checkpoint = 'pre_shipment' and c.status not in ('verified','auto_verified','withdrawn') then
    v_sheet := public._tech_sheet_for_plan(c.plan_id);
    if v_sheet is not null then
      select * into t from public.spec_tech_sheets where id = v_sheet;
      v_comp := public._tech_completeness(v_sheet, 'pre_shipment');
      if (v_comp->>'required')::int > 0 then
        if not (v_comp->>'complete')::boolean then
          raise exception 'Complete the technical & packaging data sheet % before the pre-shipment check. Still missing: %', t.sheet_ref,
            (select string_agg(x, '; ') from jsonb_array_elements_text(v_comp->'missing') x);
        end if;
        if t.status = 'draft' then raise exception 'Declare the technical & packaging data sheet % before the pre-shipment check', t.sheet_ref; end if;
        m := p_data->'measured';
        foreach k in array array['gross_weight_kg','length_mm','width_mm','height_mm'] loop
          if m is null or jsonb_typeof(m) <> 'object' or nullif(m->>k, '') is null or (m->>k)::numeric <= 0 then
            raise exception 'Enter what you measured on a packed carton: gross weight (kg) and length, width and height (mm)';
          end if;
        end loop;
        insert into public.spec_tech_sheet_measures (sheet_id, checkpoint_id, submission_no, gross_weight_kg, length_mm, width_mm, height_mm, measured_by, by_vendor)
        values (v_sheet, c.id, c.submission_count + 1, (m->>'gross_weight_kg')::numeric, (m->>'length_mm')::numeric, (m->>'width_mm')::numeric,
                (m->>'height_mm')::numeric, auth.uid(), coalesce(p_vendor, false))
        on conflict (checkpoint_id, submission_no) do update set gross_weight_kg = excluded.gross_weight_kg, length_mm = excluded.length_mm,
          width_mm = excluded.width_mm, height_mm = excluded.height_mm, measured_by = excluded.measured_by, at = now();
      end if;
    end if;
  end if;
  return public._qaqc_submit_before_tech(p_checkpoint, p_evidence, p_data, p_vendor);
end $$;

-- Compare one measurement with the sheet it belongs to. Tolerances from the QA/QC settings library.
create or replace function public._tech_compare(p_measure uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.spec_tech_sheet_measures; p2 public.spec_tech_sheet_packs; v_tw numeric := public.qaqc_setting('TECH-WEIGHT-TOL-PCT', 5);
  v_td numeric := public.qaqc_setting('TECH-DIM-TOL-MM', 10); v jsonb := '[]'::jsonb; dd numeric[]; aa numeric[]; i int; v_pct numeric;
  names text[] := array['longest side','middle side','shortest side'];
begin
  select * into me from public.spec_tech_sheet_measures where id = p_measure;
  select * into p2 from public.spec_tech_sheet_packs where sheet_id = me.sheet_id and level = 'secondary';
  if p2.gross_weight_kg is null or p2.gross_weight_kg = 0 then
    v := v || jsonb_build_object('field', 'carton_gross_weight', 'label', 'Carton gross weight', 'declared', null, 'actual', me.gross_weight_kg, 'ok', false,
      'detail', 'No carton gross weight declared');
  else
    v_pct := round(100 * abs(me.gross_weight_kg - p2.gross_weight_kg) / p2.gross_weight_kg, 1);
    v := v || jsonb_build_object('field', 'carton_gross_weight', 'label', 'Carton gross weight', 'declared', p2.gross_weight_kg, 'actual', me.gross_weight_kg,
      'unit', 'kg', 'difference', round(me.gross_weight_kg - p2.gross_weight_kg, 3), 'difference_pct', v_pct, 'tolerance', '±' || v_tw || '%', 'ok', v_pct <= v_tw,
      'detail', format('Declared %s kg, measured %s kg (%s%s%%, allowed ±%s%%)', p2.gross_weight_kg, me.gross_weight_kg,
        case when me.gross_weight_kg >= p2.gross_weight_kg then '+' else '-' end, v_pct, v_tw));
  end if;
  if p2.length_mm is null or p2.width_mm is null or p2.height_mm is null then
    v := v || jsonb_build_object('field', 'carton_dims', 'label', 'Carton size', 'ok', false, 'detail', 'No carton size declared');
  else
    -- Sides are compared longest to shortest, so a carton measured in another orientation still matches.
    dd := array(select x from unnest(array[p2.length_mm, p2.width_mm, p2.height_mm]) x order by x desc);
    aa := array(select x from unnest(array[me.length_mm, me.width_mm, me.height_mm]) x order by x desc);
    for i in 1..3 loop
      v := v || jsonb_build_object('field', 'carton_dims', 'label', 'Carton ' || names[i], 'declared', dd[i], 'actual', aa[i], 'unit', 'mm',
        'difference', aa[i] - dd[i], 'tolerance', '±' || v_td || ' mm', 'ok', abs(aa[i] - dd[i]) <= v_td,
        'detail', format('Carton %s: declared %s mm, measured %s mm (allowed ±%s mm)', names[i], dd[i], aa[i], v_td));
    end loop;
  end if;
  return v;
end $$;

alter function public._qaqc_verify(uuid) rename to _qaqc_verify_before_tech;
create function public._qaqc_verify(p_checkpoint uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.qaqc_checkpoints; me public.spec_tech_sheet_measures; t public.spec_tech_sheets; s public.job_specs; v_cmp jsonb; v_ok boolean;
  v_flip boolean := false; r jsonb; v_check jsonb; v_detail text;
begin
  select * into c from public.qaqc_checkpoints where id = p_checkpoint;
  if c.id is null or c.checkpoint <> 'pre_shipment' then return public._qaqc_verify_before_tech(p_checkpoint); end if;
  select * into me from public.spec_tech_sheet_measures where checkpoint_id = c.id and submission_no = c.submission_count;
  if me.id is null then return public._qaqc_verify_before_tech(p_checkpoint); end if;
  select * into t from public.spec_tech_sheets where id = me.sheet_id for update;
  v_cmp := public._tech_compare(me.id);
  v_ok := not exists (select 1 from jsonb_array_elements(v_cmp) x where not (x->>'ok')::boolean);
  -- A mismatch sends the checkpoint to a quality review (as a sign-off level would), never straight to auto-verified.
  if not v_ok and c.verifier = 'auto' then
    update public.qaqc_checkpoints set verifier = 'quality' where id = c.id;
    v_flip := true;
  end if;
  r := public._qaqc_verify_before_tech(p_checkpoint);
  if v_flip then update public.qaqc_checkpoints set verifier = 'auto' where id = c.id; end if;
  select string_agg(x->>'detail', '; ') into v_detail from jsonb_array_elements(v_cmp) x where v_ok or not (x->>'ok')::boolean;
  v_check := jsonb_build_object('code', 'tech_sheet', 'label', 'Packed carton matches the declared data sheet (' || t.sheet_ref || ')', 'ok', v_ok, 'hard', false,
    'detail', case when v_ok then 'Within tolerance: ' || v_detail else 'Mismatch: ' || v_detail end);
  update public.qaqc_checkpoints set checks = checks || v_check where id = c.id;
  update public.spec_tech_sheet_measures set within_tolerance = v_ok, comparisons = v_cmp where id = me.id;
  update public.spec_tech_sheets set actual_gross_weight_kg = me.gross_weight_kg, actual_length_mm = me.length_mm, actual_width_mm = me.width_mm,
    actual_height_mm = me.height_mm, measured_at = me.at, verification = v_cmp, checkpoint_id = c.id,
    status = case when v_ok then 'verified' else 'mismatch' end,
    verified_at = case when v_ok then now() else null end, mismatch_at = case when v_ok then mismatch_at else now() end
   where id = t.id;
  if v_ok then
    select * into s from public.job_specs where id = t.spec_id;
    insert into public.spec_tech_library (sheet_id, spec_id, spec_version_id, supplier_id, title_key, spec_type, product_category, substrate_id, verified_at)
    values (t.id, t.spec_id, t.spec_version_id, t.supplier_id, lower(trim(s.title)), s.spec_type, s.product_category, s.substrate_id, now())
    on conflict (sheet_id) do update set verified_at = now();
  else
    delete from public.spec_tech_library where sheet_id = t.id;
    perform public.notify_supplier(t.supplier_id, 'orders', 'Packaging does not match your data sheet ' || t.sheet_ref, v_detail,
      coalesce('/vendor/orders/' || t.po_id || '#tech-sheet', '/vendor/tech-sheets'));
  end if;
  perform public._tech_sheet_event(t.id, case when v_ok then 'verified' else 'mismatch' end,
    jsonb_build_object('checkpoint_id', c.id, 'submission', c.submission_count, 'comparisons', v_cmp), false, me.by_vendor);
  perform public._qaqc_event(c.plan_id, c.id, case when v_ok then 'tech_sheet_verified' else 'tech_sheet_mismatch' end, jsonb_build_object('sheet', t.sheet_ref));
  return r || jsonb_build_object('status', (select status from public.qaqc_checkpoints where id = c.id), 'ok', coalesce((r->>'ok')::boolean, true) and v_ok,
    'checks', coalesce(r->'checks', '[]'::jsonb) || v_check, 'tech_sheet', jsonb_build_object('ref', t.sheet_ref, 'ok', v_ok, 'comparisons', v_cmp));
end $$;

-- ---------------------------------------------------------------------------
-- D. Stage capture
-- ---------------------------------------------------------------------------
-- Quote: the per-line packing details plus the "Packaging (proposed)" section become a draft sheet (source quote).
-- p_packaging: [{line_id, units_per_carton, carton_length_mm, carton_width_mm, carton_height_mm, carton_gross_weight_kg, packing_method,
--   primary_material_code, tbc_by, tbc_note}]. A declared or verified sheet is never overwritten by a quote.
create or replace function public._tech_sheet_from_quote(p_response uuid, p_rfq uuid, p_supplier uuid, p_packaging jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare l public.rfq_lines; d public.rfq_response_lines; x jsonb; t public.spec_tech_sheets; v_id uuid; n int := 0; k text; p2 public.spec_tech_sheet_packs; v_pm uuid;
  v_pk jsonb := case when jsonb_typeof(p_packaging) = 'array' then p_packaging else '[]'::jsonb end;
begin
  for x in select * from jsonb_array_elements(v_pk) loop
    if not exists (select 1 from public.rfq_lines where id = nullif(x->>'line_id', '')::uuid and rfq_id = p_rfq) then
      raise exception 'The packaging proposal refers to a line that is not on this RFQ';
    end if;
    foreach k in array array['units_per_carton','carton_length_mm','carton_width_mm','carton_height_mm','carton_gross_weight_kg'] loop
      if nullif(x->>k, '') is not null and (x->>k)::numeric <= 0 then raise exception 'Packaging sizes, counts and weights must be above zero'; end if;
    end loop;
    if nullif(x->>'tbc_by', '') is not null and (x->>'tbc_by')::date < current_date then raise exception 'The "to be confirmed by" date can''t be in the past'; end if;
  end loop;
  for l in select * from public.rfq_lines where rfq_id = p_rfq order by line_no loop
    select * into d from public.rfq_response_lines where response_id = p_response and line_id = l.id;
    x := (select e from jsonb_array_elements(v_pk) e where e->>'line_id' = l.id::text limit 1);
    if x is not null then x := (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(x) where key <> 'line_id' and value not in ('null'::jsonb, '""'::jsonb)); end if;
    if coalesce(x, '{}'::jsonb) = '{}'::jsonb and d.response_id is null then continue; end if;
    if coalesce(x, '{}'::jsonb) = '{}'::jsonb and d.units_per_carton is null and d.carton_length_cm is null and d.gross_weight_kg is null and d.net_weight_kg is null then continue; end if;
    select * into t from public.spec_tech_sheets where spec_id = l.spec_id and spec_version_id is not distinct from l.spec_version_id and supplier_id = p_supplier;
    if t.id is not null and t.status <> 'draft' then continue; end if;
    v_id := coalesce(t.id, public._tech_sheet_ensure(l.spec_id, l.spec_version_id, p_supplier, 'quote', null, l.id, p_response));
    select * into p2 from public.spec_tech_sheet_packs where sheet_id = v_id and level = 'secondary';
    update public.spec_tech_sheets set rfq_line_id = l.id, response_id = p_response,
      net_weight_g = coalesce(round(d.net_weight_kg * 1000, 2), net_weight_g), hs_code = coalesce(nullif(trim(d.hs_code), ''), hs_code),
      origin_country = coalesce(nullif(trim(d.country_of_origin), ''), origin_country),
      packing_method = coalesce(left(nullif(trim(x->>'packing_method'), ''), 500), packing_method),
      tbc_by = case when x ? 'tbc_by' then (x->>'tbc_by')::date else tbc_by end,
      tbc_note = case when x ? 'tbc_note' then left(trim(x->>'tbc_note'), 500) else tbc_note end
     where id = v_id;
    insert into public.spec_tech_sheet_packs (sheet_id, level, units_per_pack, length_mm, width_mm, height_mm, gross_weight_kg)
    values (v_id, 'secondary', coalesce(nullif(x->>'units_per_carton', '')::numeric::int, d.units_per_carton, p2.units_per_pack),
      coalesce(nullif(x->>'carton_length_mm', '')::numeric, d.carton_length_cm * 10, p2.length_mm),
      coalesce(nullif(x->>'carton_width_mm', '')::numeric, d.carton_width_cm * 10, p2.width_mm),
      coalesce(nullif(x->>'carton_height_mm', '')::numeric, d.carton_height_cm * 10, p2.height_mm),
      coalesce(nullif(x->>'carton_gross_weight_kg', '')::numeric, p2.gross_weight_kg))
    on conflict (sheet_id, level) do update set units_per_pack = excluded.units_per_pack, length_mm = excluded.length_mm, width_mm = excluded.width_mm,
      height_mm = excluded.height_mm, gross_weight_kg = excluded.gross_weight_kg;
    if nullif(trim(x->>'primary_material_code'), '') is not null then
      select id into v_pm from public.library_records where library_key = 'packaging_materials' and code = trim(x->>'primary_material_code') and status = 'active' order by version desc limit 1;
      if v_pm is null then raise exception 'Packaging material % is not in the Watchtower packaging materials library', trim(x->>'primary_material_code'); end if;
      insert into public.spec_tech_sheet_packs (sheet_id, level) values (v_id, 'primary') on conflict do nothing;
      if not exists (select 1 from public.spec_tech_sheet_pack_materials where sheet_id = v_id and level = 'primary' and packaging_material_id = v_pm) then
        insert into public.spec_tech_sheet_pack_materials (sheet_id, level, packaging_material_id, component, sort)
        values (v_id, 'primary', v_pm, 'Unit pack', coalesce((select max(sort) + 1 from public.spec_tech_sheet_pack_materials where sheet_id = v_id and level = 'primary'), 1));
      end if;
    end if;
    perform public._tech_sheet_event(v_id, 'quote_proposal', jsonb_build_object('response_id', p_response, 'line_no', l.line_no, 'tbc_by', x->>'tbc_by'), true, true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Vendor quote (viewer-gated through the public wrapper of 20261017000001): as 20261019000001, plus the packaging proposal.
create or replace function public._core_rfq_submit_quote(p_rfq uuid, p_prices jsonb, p_lead_time_days int, p_notes text, p_submit boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.rfq_invitations := public._vendor_invitation(p_rfq); r public.rfqs; q public.rfq_responses; v_total numeric;
begin
  select * into r from public.rfqs where id = p_rfq for update;
  if r.status <> 'sent' then raise exception 'This RFQ is not open for quotes'; end if;
  if now() >= r.due_at then raise exception 'The due date has passed: quotes can no longer be changed'; end if;
  if i.status = 'declined' then raise exception 'You declined this RFQ'; end if;
  select * into q from public.rfq_responses where rfq_id = p_rfq and supplier_id = i.supplier_id for update;
  if q.id is not null and q.status in ('awarded','declined') then raise exception 'This quote is closed'; end if;
  if q.id is not null and q.status = 'submitted' and not p_submit then raise exception 'Already submitted: change the prices and resubmit'; end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then raise exception 'Lead time can''t be negative'; end if;
  if q.id is null then
    insert into public.rfq_responses (rfq_id, supplier_id, status, source, currency)
    values (p_rfq, i.supplier_id, 'draft', 'vendor_portal', r.currency) returning * into q;
  end if;
  v_total := public._rfq_save_prices(q.id, p_rfq, p_prices, p_submit);
  perform public._tech_sheet_from_quote(q.id, p_rfq, i.supplier_id, case when jsonb_typeof(p_prices) = 'object' then p_prices->'packaging' end);
  update public.rfq_responses set lead_time_days = p_lead_time_days, notes = p_notes, total_value = v_total, updated_at = now(),
    status = case when p_submit then 'submitted' else 'draft' end,
    submitted_at = case when p_submit then now() else submitted_at end,
    submitted_by = case when p_submit then auth.uid() else submitted_by end,
    finance_status = case when p_submit then 'pending' else finance_status end, finance_by = null, finance_at = null, finance_notes = null
  where id = q.id;
  if p_submit then
    update public.rfq_invitations set status = 'quoted', responded_at = now(),
      requoted_at = case when requote_needed then now() else requoted_at end, requote_needed = false
     where rfq_id = p_rfq and supplier_id = i.supplier_id;
    perform public._sourcing_event(r.job_id, 'rfq', p_rfq, case when i.requote_needed then 'requote_submitted' else 'quote_submitted' end,
      jsonb_build_object('response_id', q.id, 'source', 'vendor_portal'));
  end if;
  return q.id;
end $$;

-- Vendor read for the quote form: per line, the packaging proposal on file and what it can be pre-filled from.
create or replace function public.tech_sheet_vendor_quote(p_rfq uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i public.rfq_invitations := public._vendor_invitation(p_rfq);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id, 'sheet_id', t.id, 'sheet_ref', t.sheet_ref, 'status', t.status, 'source', t.source,
      'packing_method', t.packing_method, 'tbc_by', t.tbc_by, 'tbc_note', t.tbc_note,
      'units_per_carton', p2.units_per_pack, 'carton_length_mm', p2.length_mm, 'carton_width_mm', p2.width_mm, 'carton_height_mm', p2.height_mm,
      'carton_gross_weight_kg', p2.gross_weight_kg,
      'primary_material_code', (select lr.code from public.spec_tech_sheet_pack_materials pm join public.library_records lr on lr.id = pm.packaging_material_id
                                  where pm.sheet_id = t.id and pm.level = 'primary' order by pm.sort limit 1),
      'prefill', (select jsonb_build_object('sheet_id', pf.sheet_id, 'sheet_ref', pf.sheet_ref, 'match', pf.match,
                    'units_per_carton', pp.units_per_pack, 'carton_length_mm', pp.length_mm, 'carton_width_mm', pp.width_mm, 'carton_height_mm', pp.height_mm,
                    'carton_gross_weight_kg', pp.gross_weight_kg, 'packing_method', ps.packing_method)
                  from public._tech_prefill_source(l.spec_id, l.spec_version_id, i.supplier_id, t.id) pf
                  join public.spec_tech_sheets ps on ps.id = pf.sheet_id
                  left join public.spec_tech_sheet_packs pp on pp.sheet_id = pf.sheet_id and pp.level = 'secondary'),
      'quote_required', public._tech_requirements(l.spec_id, l.spec_version_id, i.supplier_id, 'quote')) order by l.line_no)
    from public.rfq_lines l
    left join public.spec_tech_sheets t on t.spec_id = l.spec_id and t.spec_version_id is not distinct from l.spec_version_id and t.supplier_id = i.supplier_id
    left join public.spec_tech_sheet_packs p2 on p2.sheet_id = t.id and p2.level = 'secondary'
   where l.rfq_id = p_rfq), '[]'::jsonb);
end $$;

-- Full sheet for the portal and the internal pages.
create or replace function public._tech_sheet_json(p_sheet uuid, p_vendor boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select public._tech_sheet_snapshot(t.id) || jsonb_build_object(
    'id', t.id, 'sheet_ref', t.sheet_ref, 'status', t.status, 'source', t.source, 'version', t.version, 'spec_id', t.spec_id, 'spec_version_id', t.spec_version_id,
    'supplier_id', t.supplier_id, 'spec_title', s.title, 'spec_type', s.spec_type, 'spec_revision', t.spec_revision, 'current_spec_revision', s.revision,
    'version_name', sv.name, 'po_id', t.po_id, 'po_number', p.po_number, 'supplier_name', su.name,
    'copied_from_ref', (select c.sheet_ref from public.spec_tech_sheets c where c.id = t.copied_from_id),
    'declared_at', t.declared_at, 'declared_by_vendor', t.declared_by_vendor,
    'declared_by_name', case when p_vendor then null else (select coalesce(nullif(full_name, ''), email) from public.profiles where id = t.declared_by) end,
    'actual', jsonb_build_object('gross_weight_kg', t.actual_gross_weight_kg, 'length_mm', t.actual_length_mm, 'width_mm', t.actual_width_mm, 'height_mm', t.actual_height_mm,
      'measured_at', t.measured_at),
    'verification', t.verification, 'verified_at', t.verified_at, 'mismatch_at', t.mismatch_at,
    'completeness', jsonb_build_object('quote', public._tech_completeness(t.id, 'quote') - 'required_fields',
      'po_acceptance', public._tech_completeness(t.id, 'po_acceptance') - 'required_fields',
      'pre_shipment', public._tech_completeness(t.id, 'pre_shipment') - 'required_fields'),
    'required', public._tech_requirements(t.spec_id, t.spec_version_id, t.supplier_id, 'pre_shipment'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'version', e.version, 'at', e.at, 'by_vendor', e.by_vendor, 'detail', e.detail,
        'actor', case when p_vendor then null else (select coalesce(nullif(full_name, ''), email) from public.profiles where id = e.actor) end,
        'snapshot', case when p_vendor then null else e.snapshot end) order by e.at desc, e.id desc)
      from public.spec_tech_sheet_events e where e.sheet_id = t.id), '[]'::jsonb),
    'measures', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'gross_weight_kg', m.gross_weight_kg, 'length_mm', m.length_mm, 'width_mm', m.width_mm,
        'height_mm', m.height_mm, 'within_tolerance', m.within_tolerance, 'submission_no', m.submission_no) order by m.at desc)
      from public.spec_tech_sheet_measures m where m.sheet_id = t.id), '[]'::jsonb))
  from public.spec_tech_sheets t join public.job_specs s on s.id = t.spec_id join public.suppliers su on su.id = t.supplier_id
  left join public.spec_versions sv on sv.id = t.spec_version_id left join public.purchase_orders p on p.id = t.po_id
  where t.id = p_sheet;
$$;

create or replace function public.tech_sheet_detail(p_sheet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  return public._tech_sheet_json(p_sheet, false);
end $$;

-- Libraries a vendor picks from (names and codes only).
create or replace function public.tech_sheet_materials() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'packaging', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'group', r.data->>'material_group', 'default_recycled_pct', r.data->'default_recycled_pct') order by r.name)
      from public._lib_current('packaging_materials') r where r.status = 'active'), '[]'::jsonb),
    'substrates', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'type', r.data->>'substrate_type') order by r.name)
      from public._lib_current('substrates') r where r.status = 'active'), '[]'::jsonb))
  where public.is_internal() or public.my_supplier_id() is not null;
$$;

-- Vendor: the data sheet panel of one PO (own issued / accepted PO only).
create or replace function public.tech_sheet_vendor_po(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); p public.purchase_orders;
begin
  select * into p from public.purchase_orders where id = p_po;
  if v_sup is null or public.is_internal() or p.id is null or p.supplier_id <> v_sup or p.status not in ('issued','accepted') then
    raise exception 'Purchase order not found' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'spec_id', el.spec_id, 'spec_version_id', rl.spec_version_id, 'spec_title', s.title, 'version_name', sv.name, 'quantity', el.quantity,
      'spec_type', s.spec_type, 'po_status', p.status,
      'sheet', case when t.id is null then null else public._tech_sheet_json(t.id, true) end,
      'required_po', public._tech_requirements(el.spec_id, rl.spec_version_id, v_sup, 'po_acceptance'),
      'required_pre', public._tech_requirements(el.spec_id, rl.spec_version_id, v_sup, 'pre_shipment'),
      'pre_shipment_due', (select ck.due_date from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id
                             where pl.po_id = p.id and pl.estimate_line_id = el.id and ck.checkpoint = 'pre_shipment' limit 1),
      'prefill', (select jsonb_build_object('sheet_id', pf.sheet_id, 'sheet_ref', pf.sheet_ref, 'match', pf.match)
                    from public._tech_prefill_source(el.spec_id, rl.spec_version_id, v_sup, t.id) pf),
      'copy_sources', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'sheet_ref', o.sheet_ref, 'status', o.status, 'spec_title', os.title,
            'same_spec', o.spec_id = el.spec_id) order by (o.spec_id = el.spec_id) desc, (lower(os.title) = lower(s.title)) desc, o.updated_at desc)
          from public.spec_tech_sheets o join public.job_specs os on os.id = o.spec_id
         where o.supplier_id = v_sup and o.id is distinct from t.id and o.status in ('declared','verified','mismatch')), '[]'::jsonb))
      order by s.spec_no, sv.sort)
    from public.estimate_lines el join public.job_specs s on s.id = el.spec_id
    left join public.rfq_lines rl on rl.id = el.rfq_line_id left join public.spec_versions sv on sv.id = rl.spec_version_id
    left join public.spec_tech_sheets t on t.spec_id = el.spec_id and t.spec_version_id is not distinct from rl.spec_version_id and t.supplier_id = v_sup
   where el.estimate_id = p.estimate_id), '[]'::jsonb);
end $$;

-- Vendor: every sheet due (own sheets, and lines on own POs that have none yet).
create or replace function public.tech_sheet_vendor_list() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (select public.my_supplier_id() as sup where not public.is_internal()),
  lines as (
    select el.spec_id, rl.spec_version_id, p.id as po_id, p.po_number, p.status as po_status, el.id as el_id
      from mine join public.purchase_orders p on p.supplier_id = mine.sup and p.status in ('issued','accepted')
      join public.estimate_lines el on el.estimate_id = p.estimate_id left join public.rfq_lines rl on rl.id = el.rfq_line_id
  ), rws as (
    select t.id as sheet_id, t.spec_id, t.spec_version_id, coalesce(l.po_id, t.po_id) as po_id, l.el_id from public.spec_tech_sheets t join mine on t.supplier_id = mine.sup
      left join lines l on l.spec_id = t.spec_id and l.spec_version_id is not distinct from t.spec_version_id
    union all
    -- Lines with no sheet yet, while the goods have not passed QA/QC (older, finished orders are not "due").
    select null, l.spec_id, l.spec_version_id, l.po_id, l.el_id from lines l
     where not exists (select 1 from public.spec_tech_sheets t, mine where t.supplier_id = mine.sup and t.spec_id = l.spec_id and t.spec_version_id is not distinct from l.spec_version_id)
       and not exists (select 1 from public.qaqc_plans pl where pl.po_id = l.po_id and pl.spec_id = l.spec_id and pl.status in ('passed','waived'))
       and not exists (select 1 from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id
                        where pl.po_id = l.po_id and pl.spec_id = l.spec_id and ck.checkpoint = 'pre_shipment' and ck.status in ('verified','auto_verified'))
  )
  select coalesce(jsonb_agg(x order by (x->>'blocking')::boolean desc, x->>'due' nulls last, x->>'spec_title'), '[]'::jsonb) from (
    select jsonb_build_object('sheet_id', r.sheet_id, 'sheet_ref', t.sheet_ref, 'status', coalesce(t.status, 'not_started'), 'source', t.source,
      'spec_title', s.title, 'version_name', sv.name, 'po_id', r.po_id, 'po_number', p.po_number, 'po_status', p.status,
      'stage', case when r.po_id is null then 'quote' when t.status in ('declared','verified','mismatch') then 'pre_shipment' else 'po_acceptance' end,
      'completeness', case when t.id is null then null else public._tech_completeness(t.id, case when r.po_id is null then 'quote' else 'pre_shipment' end) - 'required_fields' end,
      'required_count', jsonb_array_length(public._tech_requirements(r.spec_id, r.spec_version_id, (select sup from mine), case when r.po_id is null then 'quote' else 'pre_shipment' end)),
      'tbc_by', t.tbc_by,
      'due', (select ck.due_date from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id
               where pl.po_id = r.po_id and pl.spec_id = r.spec_id and ck.checkpoint = 'pre_shipment' limit 1),
      'blocking', r.po_id is not null and p.status = 'accepted'
        and jsonb_array_length(public._tech_requirements(r.spec_id, r.spec_version_id, (select sup from mine), 'pre_shipment')) > 0
        and (t.id is null or t.status = 'draft' or not (public._tech_completeness(t.id, 'pre_shipment')->>'complete')::boolean)
        and not exists (select 1 from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id
                         where pl.po_id = r.po_id and pl.spec_id = r.spec_id and ck.checkpoint = 'pre_shipment' and ck.status in ('verified','auto_verified'))) x
      from rws r join public.job_specs s on s.id = r.spec_id left join public.spec_tech_sheets t on t.id = r.sheet_id
      left join public.spec_versions sv on sv.id = r.spec_version_id left join public.purchase_orders p on p.id = r.po_id) z;
$$;

-- Vendor writes (viewer-gated: public wrapper -> _core_).
create or replace function public._tech_vendor_po_line(p_po uuid, p_spec uuid, p_spec_version uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); p public.purchase_orders; v_version uuid; v_found boolean;
begin
  if v_sup is null or public.is_internal() then raise exception 'Vendor access only' using errcode = '42501'; end if;
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null or p.supplier_id <> v_sup or p.status not in ('issued','accepted') then raise exception 'Purchase order not found' using errcode = '42501'; end if;
  select true, rl.spec_version_id into v_found, v_version from public.estimate_lines el left join public.rfq_lines rl on rl.id = el.rfq_line_id
   where el.estimate_id = p.estimate_id and el.spec_id = p_spec and (p_spec_version is null or rl.spec_version_id = p_spec_version)
   order by (rl.spec_version_id is not distinct from p_spec_version) desc limit 1;
  if not coalesce(v_found, false) then raise exception 'That item is not on this purchase order' using errcode = '42501'; end if;
  return public._tech_sheet_ensure(p_spec, coalesce(p_spec_version, v_version), v_sup, 'po', p_po, null, null);
end $$;

create or replace function public._core_tech_sheet_vendor_save(p_po uuid, p_spec uuid, p_spec_version uuid, p_data jsonb, p_declare boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sheet uuid := public._tech_vendor_po_line(p_po, p_spec, p_spec_version);
begin
  update public.spec_tech_sheets set po_id = p_po where id = v_sheet and po_id is distinct from p_po;
  return public._tech_sheet_save(v_sheet, p_data, p_declare, true);
end $$;
create or replace function public.tech_sheet_vendor_save(p_po uuid, p_spec uuid, p_spec_version uuid, p_data jsonb, p_declare boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); return public._core_tech_sheet_vendor_save(p_po, p_spec, p_spec_version, p_data, p_declare); end $$;

create or replace function public._core_tech_sheet_vendor_copy(p_po uuid, p_spec uuid, p_spec_version uuid, p_source uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sheet uuid := public._tech_vendor_po_line(p_po, p_spec, p_spec_version); t public.spec_tech_sheets; src public.spec_tech_sheets;
begin
  select * into t from public.spec_tech_sheets where id = v_sheet for update;
  select * into src from public.spec_tech_sheets where id = p_source;
  if src.id is null or src.supplier_id <> t.supplier_id or src.id = t.id then raise exception 'Choose one of your own earlier data sheets' using errcode = '42501'; end if;
  if t.status = 'verified' then raise exception 'This data sheet is verified against the goods, so it is locked.'; end if;
  perform public._tech_sheet_copy_content(v_sheet, p_source);
  update public.spec_tech_sheets set source = 'copied', po_id = p_po where id = v_sheet;
  perform public._tech_sheet_event(v_sheet, 'copied', jsonb_build_object('from', src.sheet_ref), true, true);
  return jsonb_build_object('sheet_id', v_sheet, 'copied_from', src.sheet_ref, 'pre_shipment', public._tech_completeness(v_sheet, 'pre_shipment') - 'required_fields');
end $$;
create or replace function public.tech_sheet_vendor_copy(p_po uuid, p_spec uuid, p_spec_version uuid, p_source uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); return public._core_tech_sheet_vendor_copy(p_po, p_spec, p_spec_version, p_source); end $$;

-- Internal: open a sheet for a spec (version) x supplier (pre-filled from that supplier's library), key data on the
-- vendor's behalf, and reopen a verified or mismatched sheet.
create or replace function public.tech_sheet_ensure(p_spec uuid, p_supplier uuid, p_spec_version uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; po uuid;
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier) then raise exception 'Supplier not found'; end if;
  select p.id into po from public.purchase_orders p join public.estimate_lines el on el.estimate_id = p.estimate_id
   where el.spec_id = p_spec and p.supplier_id = p_supplier and p.status in ('issued','accepted') order by p.po_date desc limit 1;
  v := public._tech_sheet_ensure(p_spec, p_spec_version, p_supplier, case when po is null then 'quote' else 'po' end, po, null, null);
  return v;
end $$;

create or replace function public.tech_sheet_save(p_sheet uuid, p_data jsonb, p_declare boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() or public.my_supplier_id() is not null then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  return public._tech_sheet_save(p_sheet, p_data, p_declare, false);
end $$;

create or replace function public.tech_sheet_reopen(p_sheet uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.spec_tech_sheets;
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the data sheet is reopened'; end if;
  select * into t from public.spec_tech_sheets where id = p_sheet for update;
  if t.id is null then raise exception 'Sheet not found'; end if;
  if t.status not in ('verified','mismatch','declared') then raise exception 'Only a declared, verified or mismatched sheet can be reopened'; end if;
  update public.spec_tech_sheets set status = 'draft' where id = p_sheet;
  delete from public.spec_tech_library where sheet_id = p_sheet;
  perform public._tech_sheet_event(p_sheet, 'reopened', jsonb_build_object('from', t.status, 'reason', trim(p_reason)), false, false);
  perform public.notify_supplier(t.supplier_id, 'orders', 'Data sheet reopened: ' || t.sheet_ref, trim(p_reason), coalesce('/vendor/orders/' || t.po_id || '#tech-sheet', '/vendor/tech-sheets'));
end $$;

-- ---------------------------------------------------------------------------
-- F. Downstream: hand-off, logistics weights
-- ---------------------------------------------------------------------------
-- Best sheet for a spec (version) x supplier: verified, then declared, then a mismatch (measured values win there).
create or replace function public._tech_sheet_best(p_spec uuid, p_version uuid, p_supplier uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.spec_tech_sheets
   where spec_id = p_spec and supplier_id = p_supplier and status in ('verified','declared','mismatch')
     and (spec_version_id is not distinct from p_version or spec_version_id is null)
   order by (spec_version_id is not distinct from p_version) desc, case status when 'verified' then 1 when 'declared' then 2 else 3 end, updated_at desc limit 1;
$$;

create or replace function public._tech_values(p_sheet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.spec_tech_sheets; p2 public.spec_tech_sheet_packs; v_cg numeric; v_l numeric; v_w numeric; v_h numeric;
begin
  select * into t from public.spec_tech_sheets where id = p_sheet;
  if t.id is null then return null; end if;
  select * into p2 from public.spec_tech_sheet_packs where sheet_id = p_sheet and level = 'secondary';
  v_cg := case when t.status = 'mismatch' then coalesce(t.actual_gross_weight_kg, p2.gross_weight_kg) else p2.gross_weight_kg end;
  v_l := case when t.status = 'mismatch' then coalesce(t.actual_length_mm, p2.length_mm) else p2.length_mm end;
  v_w := case when t.status = 'mismatch' then coalesce(t.actual_width_mm, p2.width_mm) else p2.width_mm end;
  v_h := case when t.status = 'mismatch' then coalesce(t.actual_height_mm, p2.height_mm) else p2.height_mm end;
  return jsonb_build_object('sheet_ref', t.sheet_ref, 'basis', case t.status when 'verified' then 'verified' when 'mismatch' then 'measured' else 'declared' end,
    'hs_code', nullif(trim(t.hs_code), ''), 'origin_country', nullif(trim(t.origin_country), ''),
    'net_weight_kg', round(t.net_weight_g / 1000, 3),
    'gross_weight_kg', case when v_cg is not null and p2.units_per_pack is not null then round(v_cg / p2.units_per_pack, 3) end,
    'units_per_carton', p2.units_per_pack, 'carton_gross_weight_kg', v_cg,
    'carton_cm', case when v_l is not null and v_w is not null and v_h is not null then jsonb_build_array(round(v_l / 10, 1), round(v_w / 10, 1), round(v_h / 10, 1)) end);
end $$;

-- What Stocktool still needs (empty = complete): the verified / declared data sheet now fills HS code, weights and origin.
create or replace function public._estimate_missing_fields(p_estimate uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; v text[] := '{}'::text[]; l record; tv jsonb; v_hs boolean := false; v_nw boolean := false; v_gw boolean := false; v_or boolean := false;
begin
  if auth.uid() is not null and not public.is_internal() then return null; end if;
  select * into e from public.estimates where id = p_estimate;
  if e.id is null then return null; end if;
  if not exists (select 1 from public.client_pos where estimate_id = e.id) and coalesce(trim(e.client_order_ref), '') = '' then
    v := array_append(v, 'Client PO');
  end if;
  for l in select el.spec_id, rl.spec_version_id, sp.hs_code, sp.net_weight_kg, sp.gross_weight_kg, sp.origin_country,
                  d.hs_code as d_hs, d.net_weight_kg as d_nw, d.gross_weight_kg as d_gw, d.country_of_origin as d_or
             from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id
             left join public.rfq_lines rl on rl.id = el.rfq_line_id
             left join public.rfq_response_lines d on d.response_id = e.response_id and d.line_id = el.rfq_line_id
            where el.estimate_id = e.id loop
    tv := public._tech_values(public._tech_sheet_best(l.spec_id, l.spec_version_id, e.supplier_id));
    if coalesce(tv->>'hs_code', nullif(trim(l.d_hs), ''), nullif(trim(l.hs_code), '')) is null then v_hs := true; end if;
    if coalesce((tv->>'net_weight_kg')::numeric, l.d_nw, l.net_weight_kg) is null then v_nw := true; end if;
    if coalesce((tv->>'gross_weight_kg')::numeric, l.d_gw, l.gross_weight_kg) is null then v_gw := true; end if;
    if coalesce(tv->>'origin_country', nullif(trim(l.d_or), ''), nullif(trim(l.origin_country), '')) is null then v_or := true; end if;
  end loop;
  if v_hs then v := array_append(v, 'HS code'); end if;
  if v_nw then v := array_append(v, 'Net weight'); end if;
  if v_gw then v := array_append(v, 'Gross weight'); end if;
  if v_or then v := array_append(v, 'Country of origin'); end if;
  return v;
end $$;

-- The estimate.approved payload for Stocktool: as 20261019000001, with article data from the verified (else declared) data sheet.
create or replace function public._estimate_handoff_payload(p_estimate uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; j public.jobs; c public.sourcing_clients; b public.sourcing_billing_entities; s public.suppliers; r public.rfqs; v_inc text;
begin
  select * into e from public.estimates where id = p_estimate;
  select * into j from public.jobs where id = e.job_id;
  select * into c from public.sourcing_clients where id = j.client_id;
  select * into b from public.sourcing_billing_entities where id = j.billing_entity_id;
  select * into s from public.suppliers where id = e.supplier_id;
  select * into r from public.rfqs where id = e.rfq_id;
  v_inc := coalesce((select code from public.library_records where id = e.incoterm_id), (select code from public.library_records where id = r.incoterm_id), 'DDP');
  return jsonb_build_object(
    'estimate_number', e.estimate_number, 'job_number', j.job_number, 'job_title', j.title,
    'client_code', c.code, 'client_order_ref', e.client_order_ref, 'billing_entity_code', b.code,
    'supplier_code', s.supplier_code, 'supplier_vat_country', s.market, 'currency', e.currency, 'region', e.region, 'market', e.market,
    'base_cost', e.base_cost, 'additional_cost', e.additional_cost, 'sell_price', e.sell_price, 'pricing_mode', e.pricing_mode, 'pricing_percent', e.pricing_percent,
    'gsc_commission_percent', e.gsc_commission_percent, 'gsc_commission_amount', round(e.sell_price * e.gsc_commission_percent / 100, 2),
    'rebate_percent', e.rebate_percent, 'rebate_amount', round(e.sell_price * e.rebate_percent / 100, 2),
    'approved_at', e.approved_at, 'incoterm', v_inc, 'incoterm_place', r.incoterm_place,
    'port_of_loading', e.port_of_loading, 'forwarder', e.forwarder, 'consignee', e.consignee, 'hub', e.hub,
    'client_pos', (select coalesce(jsonb_agg(jsonb_build_object('po_number', cp.po_number, 'amount', cp.amount, 'po_date', cp.po_date, 'file_id', cp.file_id) order by cp.po_date, cp.created_at), '[]'::jsonb)
                   from public.client_pos cp where cp.estimate_id = e.id),
    'cost_split', jsonb_build_array(jsonb_build_object('category', 'product', 'amount', e.base_cost))
                  || coalesce((select jsonb_agg(jsonb_build_object('category', cl.category, 'description', cl.description, 'amount', cl.amount,
                       'supplier_code', (select supplier_code from public.suppliers where id = cl.supplier_id)) order by cl.sort)
                     from public.estimate_cost_lines cl where cl.estimate_id = e.id), '[]'::jsonb),
    'articles', (select coalesce(jsonb_agg(jsonb_build_object('spec_no', sp.spec_no, 'description', sp.title, 'spec_type', sp.spec_type,
        'variant', rl.variant_label, 'hs_code', coalesce(tv->>'hs_code', nullif(trim(d.hs_code), ''), sp.hs_code),
        'origin_country', coalesce(tv->>'origin_country', nullif(trim(d.country_of_origin), ''), sp.origin_country),
        'incoterm', coalesce((select code from public.library_records where id = rl.incoterm_id), v_inc),
        'unit_of_measure', sp.unit_of_measure, 'selling_unit_qty', sp.selling_unit_qty, 'moq', sp.moq,
        'net_weight_kg', coalesce((tv->>'net_weight_kg')::numeric, d.net_weight_kg, sp.net_weight_kg),
        'gross_weight_kg', coalesce((tv->>'gross_weight_kg')::numeric, d.gross_weight_kg, sp.gross_weight_kg),
        'units_per_carton', coalesce((tv->>'units_per_carton')::int, d.units_per_carton, sp.units_per_outer),
        'carton_cm', coalesce(tv->'carton_cm', case when coalesce(d.carton_length_cm, sp.carton_length_cm) is not null then jsonb_build_array(
            coalesce(d.carton_length_cm, sp.carton_length_cm), coalesce(d.carton_width_cm, sp.carton_width_cm), coalesce(d.carton_height_cm, sp.carton_height_cm)) end),
        'carton_gross_weight_kg', (tv->>'carton_gross_weight_kg')::numeric,
        'tech_sheet_ref', tv->>'sheet_ref', 'data_basis', coalesce(tv->>'basis', case when d.response_id is not null then 'quote' else 'spec' end),
        'quantity', el.quantity, 'unit_cost', el.unit_cost,
        'unit_sell', public._estimate_sell(el.unit_cost, e.pricing_mode, e.pricing_percent, e.gsc_commission_percent, e.rebate_percent),
        'unit_weight_grams', sp.unit_weight_grams, 'delivery_date', rl.delivery_date,
        'delivery_points', (select coalesce(jsonb_agg(jsonb_build_object('label', dp.label, 'country', dp.country, 'quantity', dp.quantity, 'delivery_date', dp.delivery_date) order by dp.point_no), '[]'::jsonb)
                            from public.rfq_line_delivery_points dp where dp.line_id = rl.id),
        'reusable', sp.reusable, 'recycled_content_percent', coalesce(d.recycled_content_percent, sp.recycled_content_percent)) order by sp.spec_no), '[]'::jsonb)
      from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id
      left join public.rfq_lines rl on rl.id = el.rfq_line_id
      left join public.rfq_response_lines d on d.response_id = e.response_id and d.line_id = el.rfq_line_id
      left join lateral (select public._tech_values(public._tech_sheet_best(el.spec_id, rl.spec_version_id, e.supplier_id)) as tv) x on true
      where el.estimate_id = e.id),
    'missing_fields', to_jsonb(coalesce(public._estimate_missing_fields(e.id), '{}'::text[])));
end $$;

-- Deliveries and shipments without a gross weight default it from the sheet: cartons needed x carton gross weight.
create or replace function public.trg_deliveries_tech_weight() returns trigger
language plpgsql security definer set search_path = public as $$
declare tv jsonb;
begin
  if new.gross_weight_kg is null and new.spec_id is not null then
    tv := public._tech_values(public._tech_sheet_best(new.spec_id, new.spec_version_id, new.supplier_id));
    if (tv->>'carton_gross_weight_kg') is not null and (tv->>'units_per_carton') is not null then
      new.gross_weight_kg := round(ceil(new.quantity::numeric / (tv->>'units_per_carton')::int) * (tv->>'carton_gross_weight_kg')::numeric, 3);
      new.weight_source := 'tech_sheet_' || (tv->>'basis') || ':' || (tv->>'sheet_ref');
    end if;
  end if;
  return new;
end $$;
create trigger deliveries_tech_weight before insert on public.deliveries for each row execute function public.trg_deliveries_tech_weight();

create or replace function public.trg_shipments_tech_weight() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; tv jsonb;
begin
  if new.gross_weight_kg is null then
    select * into d from public.deliveries where id = new.delivery_id;
    tv := public._tech_values(public._tech_sheet_best(d.spec_id, d.spec_version_id, d.supplier_id));
    if (tv->>'carton_gross_weight_kg') is not null and (tv->>'units_per_carton') is not null then
      new.gross_weight_kg := round(ceil(new.quantity_shipped::numeric / (tv->>'units_per_carton')::int) * (tv->>'carton_gross_weight_kg')::numeric, 3);
      new.weight_source := 'tech_sheet_' || (tv->>'basis') || ':' || (tv->>'sheet_ref');
    end if;
  end if;
  return new;
end $$;
create trigger shipments_tech_weight before insert on public.shipments for each row execute function public.trg_shipments_tech_weight();

-- ---------------------------------------------------------------------------
-- Views (security invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create view public.v_tech_sheets with (security_invoker = true) as
  select t.id, t.sheet_ref, t.spec_id, t.spec_version_id, t.supplier_id, t.job_id, t.region, t.market, t.status, t.source, t.version, t.po_id,
         t.tbc_by, t.tbc_note, t.declared_at, t.verified_at, t.mismatch_at, t.measured_at, t.updated_at, t.created_at,
         s.title as spec_title, s.spec_no, s.spec_type, sv.name as version_name, j.job_number, j.client_id, c.name as client_name,
         su.name as supplier_name, su.supplier_code, p.po_number, p.status as po_status,
         (q.v->>'percent')::int as quote_pct, (pa.v->>'percent')::int as po_pct, (ps.v->>'percent')::int as pre_shipment_pct,
         (q.v->>'required')::int as quote_required, (pa.v->>'required')::int as po_required, (ps.v->>'required')::int as pre_shipment_required,
         q.v->'missing' as missing_quote, pa.v->'missing' as missing_po, ps.v->'missing' as missing_pre_shipment,
         ck.status as pre_shipment_status, ck.due_date as pre_shipment_due,
         (t.po_id is not null and p.status in ('issued','accepted') and (ps.v->>'required')::int > 0
           and (t.status = 'draft' or not (ps.v->>'complete')::boolean)
           and coalesce(ck.status, 'required') not in ('verified','auto_verified','withdrawn')) as blocking
    from public.spec_tech_sheets t join public.job_specs s on s.id = t.spec_id join public.jobs j on j.id = t.job_id
    join public.sourcing_clients c on c.id = j.client_id join public.suppliers su on su.id = t.supplier_id
    left join public.spec_versions sv on sv.id = t.spec_version_id left join public.purchase_orders p on p.id = t.po_id
    left join lateral (select public.tech_sheet_completeness(t.id, 'quote') v) q on true
    left join lateral (select public.tech_sheet_completeness(t.id, 'po_acceptance') v) pa on true
    left join lateral (select public.tech_sheet_completeness(t.id, 'pre_shipment') v) ps on true
    left join lateral (select x.status, x.due_date from public.qaqc_checkpoints x join public.qaqc_plans pl on pl.id = x.plan_id
                        where pl.po_id = t.po_id and pl.spec_id = t.spec_id and x.checkpoint = 'pre_shipment' order by pl.created_at limit 1) ck on true;

-- Declared materials (product and packaging), for Impact Grade and CO2e: verified, declared or measured sheets only.
create view public.v_spec_declared_materials with (security_invoker = true) as
  select t.id as sheet_id, t.sheet_ref, t.spec_id, t.spec_version_id, t.supplier_id, t.status, 'product'::text as kind, null::text as level,
         m.substrate_id as material_record_id, lr.code as material_code, coalesce(lr.name, m.material_name) as material_name,
         lr.data->>'substrate_type' as material_group, m.share_pct, m.weight_g, m.recycled_pct, null::boolean as reusable,
         lr.data->>'virgin_factor_code' as emission_factor_code, lr.data->>'recycled_factor_code' as recycled_factor_code
    from public.spec_tech_sheets t join public.spec_tech_sheet_materials m on m.sheet_id = t.id left join public.library_records lr on lr.id = m.substrate_id
   where t.status in ('declared','verified','mismatch')
  union all
  select t.id, t.sheet_ref, t.spec_id, t.spec_version_id, t.supplier_id, t.status, 'packaging', pm.level,
         pm.packaging_material_id, lr.code, lr.name, lr.data->>'material_group', null, pm.weight_g, pm.recycled_pct, pm.reusable,
         lr.data->>'emission_factor_code', lr.data->>'recycled_factor_code'
    from public.spec_tech_sheets t join public.spec_tech_sheet_pack_materials pm on pm.sheet_id = t.id join public.library_records lr on lr.id = pm.packaging_material_id
   where t.status in ('declared','verified','mismatch');

-- Packaging placed on the market (EPR-style): weight per material and level, by client, destination market and month,
-- from ordered quantities on issued / accepted POs x declared packaging per unit.
create view public.v_packaging_by_material with (security_invoker = true) as
  with lines as (
    select p.id as po_id, p.po_date, p.supplier_id, j.client_id, public._market_code(j.market) as market, el.spec_id, rl.spec_version_id, el.quantity
      from public.purchase_orders p join public.jobs j on j.id = p.job_id join public.estimate_lines el on el.estimate_id = p.estimate_id
      left join public.rfq_lines rl on rl.id = el.rfq_line_id
     where p.status in ('issued','accepted')
  ), per_unit as (
    select l.*, t.id as sheet_id, t.status as sheet_status, pm.level, pm.packaging_material_id, pm.recycled_pct, pm.reusable,
           pm.weight_g / nullif(case pm.level
             when 'primary' then coalesce(p1.units_per_pack, 1)
             when 'secondary' then p2.units_per_pack
             else coalesce(p3.cartons_per_pallet, p3.cartons_per_layer * p3.layers) * p2.units_per_pack end, 0) as grams_per_unit
      from lines l
      join lateral (select x.* from public.spec_tech_sheets x where x.spec_id = l.spec_id and x.supplier_id = l.supplier_id
                      and x.status in ('declared','verified','mismatch') and (x.spec_version_id is not distinct from l.spec_version_id or x.spec_version_id is null)
                    order by (x.spec_version_id is not distinct from l.spec_version_id) desc limit 1) t on true
      join public.spec_tech_sheet_pack_materials pm on pm.sheet_id = t.id
      left join public.spec_tech_sheet_packs p1 on p1.sheet_id = t.id and p1.level = 'primary'
      left join public.spec_tech_sheet_packs p2 on p2.sheet_id = t.id and p2.level = 'secondary'
      left join public.spec_tech_sheet_packs p3 on p3.sheet_id = t.id and p3.level = 'tertiary'
  )
  select u.client_id, c.name as client_name, u.market, to_char(u.po_date, 'YYYY-MM') as period, u.level,
         lr.code as material_code, lr.name as material_name, lr.data->>'material_group' as material_group,
         round(sum(u.grams_per_unit * u.quantity) / 1000, 3) as packaging_kg,
         round(sum(u.grams_per_unit * u.quantity * coalesce(u.recycled_pct, 0) / 100) / 1000, 3) as recycled_kg,
         round(100 * sum(u.grams_per_unit * u.quantity * coalesce(u.recycled_pct, 0) / 100) / nullif(sum(u.grams_per_unit * u.quantity), 0), 1) as recycled_pct,
         round(sum(u.grams_per_unit * u.quantity) filter (where u.reusable) / 1000, 3) as reusable_kg,
         sum(u.quantity)::bigint as units, count(distinct u.sheet_id)::int as sheets,
         count(*) filter (where u.grams_per_unit is null)::int as lines_without_weight,
         string_agg(distinct u.sheet_status, ', ') as basis
    from per_unit u join public.sourcing_clients c on c.id = u.client_id join public.library_records lr on lr.id = u.packaging_material_id
   group by u.client_id, c.name, u.market, to_char(u.po_date, 'YYYY-MM'), u.level, lr.code, lr.name, lr.data->>'material_group';

-- Supplier declaration accuracy for SRM (verified vs mismatch): an input view only, the scorecard method is unchanged.
create view public.v_supplier_declaration_accuracy with (security_invoker = true) as
  select su.id as supplier_id, su.name as supplier_name, su.supplier_code,
         count(distinct t.id)::int as sheets,
         count(distinct t.id) filter (where t.status <> 'draft')::int as declared,
         count(distinct t.id) filter (where t.status = 'verified')::int as verified,
         count(distinct t.id) filter (where t.status = 'mismatch')::int as mismatch,
         count(m.id)::int as measurements,
         count(m.id) filter (where m.within_tolerance)::int as measurements_within,
         round(100.0 * count(m.id) filter (where m.within_tolerance) / nullif(count(m.id) filter (where m.within_tolerance is not null), 0), 1) as accuracy_pct,
         round(100.0 * count(distinct t.id) filter (where t.status = 'verified') / nullif(count(distinct t.id) filter (where t.status in ('verified','mismatch')), 0), 1) as verified_rate,
         max(t.mismatch_at) as last_mismatch_at
    from public.suppliers su join public.spec_tech_sheets t on t.supplier_id = su.id
    left join public.spec_tech_sheet_measures m on m.sheet_id = t.id
   group by su.id, su.name, su.supplier_code;

-- Health (standard shape): orders blocked by missing technical data, the mismatch rate, quote proposals past their TBC date.
create view public.watchtower_health_tech_sheets with (security_invoker = true) as
  with bl as (select count(distinct po_id)::numeric n from public.v_tech_sheets where blocking),
  mm as (select coalesce(round(100.0 * count(*) filter (where not within_tolerance) / nullif(count(*), 0), 1), 0) pct
           from public.spec_tech_sheet_measures where within_tolerance is not null and at >= now() - interval '365 days'),
  tbc as (select count(*)::numeric n from public.spec_tech_sheets where status = 'draft' and tbc_by < current_date)
  select * from (
    select 'orders'::text as module, 'tech_orders_blocked'::text as metric, 'Orders blocked by missing technical & packaging data'::text as label,
           bl.n as value, 0::numeric as target, case when bl.n = 0 then 'ok' when bl.n <= 3 then 'warn' else 'bad' end as status from bl
    union all select 'orders', 'tech_mismatch_rate', 'Packed cartons not matching the declared data sheet, last 12 months (%)', mm.pct, 5,
           case when mm.pct <= 5 then 'ok' when mm.pct <= 15 then 'warn' else 'bad' end from mm
    union all select 'sourcing', 'tech_tbc_overdue', 'Quote packaging proposals past their "to be confirmed by" date', tbc.n, 0,
           case when tbc.n = 0 then 'ok' else 'warn' end from tbc
  ) h where public.is_internal();

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------
alter table public.spec_tech_sheets enable row level security;
alter table public.spec_tech_sheet_materials enable row level security;
alter table public.spec_tech_sheet_packs enable row level security;
alter table public.spec_tech_sheet_pack_materials enable row level security;
alter table public.spec_tech_sheet_events enable row level security;
alter table public.spec_tech_sheet_measures enable row level security;
alter table public.spec_tech_library enable row level security;

create policy tech_sheets_read on public.spec_tech_sheets for select to authenticated
  using (public.is_internal() or (public.my_supplier_id() is not null and supplier_id = public.my_supplier_id()));
create policy tech_sheet_materials_read on public.spec_tech_sheet_materials for select to authenticated
  using (exists (select 1 from public.spec_tech_sheets t where t.id = sheet_id));
create policy tech_sheet_packs_read on public.spec_tech_sheet_packs for select to authenticated
  using (exists (select 1 from public.spec_tech_sheets t where t.id = sheet_id));
create policy tech_sheet_pack_materials_read on public.spec_tech_sheet_pack_materials for select to authenticated
  using (exists (select 1 from public.spec_tech_sheets t where t.id = sheet_id));
create policy tech_sheet_events_read on public.spec_tech_sheet_events for select to authenticated using (public.is_internal());
create policy tech_sheet_measures_read on public.spec_tech_sheet_measures for select to authenticated
  using (exists (select 1 from public.spec_tech_sheets t where t.id = sheet_id));
create policy tech_library_read on public.spec_tech_library for select to authenticated using (public.is_internal());

revoke insert, update, delete on public.spec_tech_sheets, public.spec_tech_sheet_materials, public.spec_tech_sheet_packs, public.spec_tech_sheet_pack_materials,
  public.spec_tech_sheet_events, public.spec_tech_sheet_measures, public.spec_tech_library from authenticated, anon;
revoke all on public.spec_tech_sheets, public.spec_tech_sheet_materials, public.spec_tech_sheet_packs, public.spec_tech_sheet_pack_materials,
  public.spec_tech_sheet_events, public.spec_tech_sheet_measures, public.spec_tech_library from anon;
revoke insert, update, delete on public.v_tech_sheets, public.v_spec_declared_materials, public.v_packaging_by_material,
  public.v_supplier_declaration_accuracy, public.watchtower_health_tech_sheets from authenticated, anon;
revoke all on public.v_tech_sheets, public.v_spec_declared_materials, public.v_packaging_by_material,
  public.v_supplier_declaration_accuracy, public.watchtower_health_tech_sheets from anon;

revoke execute on function public.trg_spec_tech_sheets_before(), public._tech_present(uuid), public._tech_requirements(uuid, uuid, uuid, text, date),
  public._tech_completeness(uuid, text), public._tech_vendor_can(uuid, uuid), public._tech_sheet_snapshot(uuid),
  public._tech_sheet_event(uuid, text, jsonb, boolean, boolean), public._tech_sheet_copy_content(uuid, uuid), public._tech_prefill_source(uuid, uuid, uuid, uuid),
  public._tech_sheet_ensure(uuid, uuid, uuid, text, uuid, uuid, uuid), public._tech_sheet_save(uuid, jsonb, boolean, boolean),
  public._tech_sheet_for_plan(uuid), public._tech_apply_evidence(uuid), public._tech_apply_evidence_for_sheet(uuid),
  public._qaqc_build_checkpoints(uuid), public._qaqc_build_checkpoints_before_tech(uuid), public._tech_sheets_for_po(uuid), public.trg_po_tech_sheets(),
  public._qaqc_submit(uuid, jsonb, jsonb, boolean), public._qaqc_submit_before_tech(uuid, jsonb, jsonb, boolean), public._tech_compare(uuid),
  public._qaqc_verify(uuid), public._qaqc_verify_before_tech(uuid), public._tech_sheet_from_quote(uuid, uuid, uuid, jsonb),
  public._core_rfq_submit_quote(uuid, jsonb, int, text, boolean), public._tech_sheet_json(uuid, boolean), public._tech_vendor_po_line(uuid, uuid, uuid),
  public._core_tech_sheet_vendor_save(uuid, uuid, uuid, jsonb, boolean), public._core_tech_sheet_vendor_copy(uuid, uuid, uuid, uuid),
  public._tech_sheet_best(uuid, uuid, uuid), public._tech_values(uuid), public._estimate_handoff_payload(uuid),
  public.trg_deliveries_tech_weight(), public.trg_shipments_tech_weight()
  from public, anon, authenticated;
revoke execute on function public.tech_sheet_required_fields(uuid, uuid, text, uuid), public.tech_sheet_completeness(uuid, text),
  public.tech_sheet_vendor_quote(uuid), public.tech_sheet_detail(uuid), public.tech_sheet_materials(), public.tech_sheet_vendor_po(uuid),
  public.tech_sheet_vendor_list(), public.tech_sheet_vendor_save(uuid, uuid, uuid, jsonb, boolean), public.tech_sheet_vendor_copy(uuid, uuid, uuid, uuid),
  public.tech_sheet_ensure(uuid, uuid, uuid), public.tech_sheet_save(uuid, jsonb, boolean), public.tech_sheet_reopen(uuid, text) from public, anon;
grant execute on function public.tech_sheet_required_fields(uuid, uuid, text, uuid), public.tech_sheet_completeness(uuid, text),
  public.tech_sheet_vendor_quote(uuid), public.tech_sheet_detail(uuid), public.tech_sheet_materials(), public.tech_sheet_vendor_po(uuid),
  public.tech_sheet_vendor_list(), public.tech_sheet_vendor_save(uuid, uuid, uuid, jsonb, boolean), public.tech_sheet_vendor_copy(uuid, uuid, uuid, uuid),
  public.tech_sheet_ensure(uuid, uuid, uuid), public.tech_sheet_save(uuid, jsonb, boolean), public.tech_sheet_reopen(uuid, text),
  public.tech_sheet_fields(), public.tech_sheet_stage_seq(text), public.tech_sheet_stage_label(text) to authenticated;
