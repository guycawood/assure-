-- Sourcing Hub parity (Sourcing+ / RFQ+ / Order Management+), closing the gaps raised in the Sourcing Hub gap analysis
-- (Promo, Premiums), the Unilever pilot UAT and the E2E process / Wave 2 / Wave 4 decks:
--   1. Spec forms (ideation / open / fixed) and structured Promo & Merch, sustainability and Stocktool article fields;
--      governed libraries branding_methods, aql_levels, incoterms. HS code is mandatory to send a promo RFQ.
--   2. Spec revisions instead of a hard lock: revising a spec that is on a sent RFQ creates a new revision (snapshot,
--      change note, audit), flags the RFQ "spec changed" and asks invited suppliers to re-quote. The sent revision is kept.
--   3. RFQ: up to 12 quantity breaks, run-on quantities, variant lines, rate-card exception with reason, incoterm per RFQ
--      and per line (non-DDP allowed), per-line delivery date and delivery points, copy an RFQ for a reorder.
--   4. Vendor quote details (still sealed, still through rfq_submit_quote / rfq_log_quote): per-line packing, weights,
--      HS code, origin, lead time, run-on price, sample cost, emissions declaration, proposed spec (ideation), prices per
--      delivery point and alternative proposals.
--   5. Estimate cost split, GSC commission and client year-end rebate in the sell price, client POs (many per estimate),
--      order flags, logistics hand-off fields and a richer estimate.approved payload for Stocktool.
--   6. Hand-off (hypercare) view for the Order Management+ dashboard.
-- Safe on existing data: every new column is nullable or has a default. Viewer-gated vendor functions are changed through
-- public._core_<name> only (see 20261017000001_vendor_viewer_gate.sql).

-- ---------------------------------------------------------------------------
-- Libraries owned by Sourcing+ (records are governed in the Watchtower; demo records are in the seed)
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('branding_methods', 'sourcing', 'Branding methods', 'How a promo or merch item is printed or decorated (screen, digital, offset, heat transfer, UV, pad, embossing, debossing, laser, embroidery). Chosen on Promo & Merch specs.', false, 5),
  ('aql_levels', 'sourcing', 'AQL levels', 'Acceptance quality limits used to sample goods at inspection. Chosen on specs that need an inspection.', true, 6),
  ('incoterms', 'sourcing', 'Incoterms', 'Delivery terms an RFQ or a line is quoted on. DDP is the default; others (DAP, FCA, FOB, EXW, CIF) are allowed and need a named place.', true, 7)
on conflict (key) do nothing;

-- Generic check + usage guard for library references held in a uuid column.
-- tg_argv: [0] column name, [1] library key, [2] label for library_refs.
create or replace function public.trg_sourcing_library_ref() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_col text := tg_argv[0]; v_key text := tg_argv[1]; v_label text := coalesce(tg_argv[2], tg_table_name);
  v_new uuid; v_old uuid; v_id text;
begin
  if tg_op in ('INSERT','UPDATE') then v_new := (to_jsonb(new) ->> v_col)::uuid; end if;
  if tg_op in ('UPDATE','DELETE') then v_old := (to_jsonb(old) ->> v_col)::uuid; end if;
  if tg_when = 'BEFORE' then
    if v_new is not null and v_new is distinct from v_old
       and not exists (select 1 from public.library_records where id = v_new and library_key = v_key and status = 'active') then
      raise exception 'Choose an active record from the Watchtower % library', replace(v_key, '_', ' ');
    end if;
    return new;
  end if;
  v_id := case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end;
  if v_old is not null and v_old is distinct from v_new then
    delete from public.library_refs where record_id = v_old and ref_table = tg_table_name and ref_id = v_id;
  end if;
  if v_new is not null and v_new is distinct from v_old then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (v_new, tg_table_name, v_id, v_label || ' ' || v_id)
    on conflict do nothing;
  end if;
  return null;
end $$;

-- Active incoterm by code (null when empty).
create or replace function public._incoterm_id(p_code text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if coalesce(trim(p_code), '') = '' then return null; end if;
  select id into v from public.library_records
   where library_key = 'incoterms' and upper(code) = upper(trim(p_code)) and status = 'active' order by version desc limit 1;
  if v is null then raise exception 'Incoterm % is not an active record in the Watchtower incoterm library', upper(trim(p_code)); end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Spec forms and structured Promo & Merch / sustainability / Stocktool fields
-- ---------------------------------------------------------------------------
alter table public.job_specs
  add column if not exists spec_form text not null default 'fixed' check (spec_form in ('ideation','open','fixed')),
  add column if not exists product_category text,
  add column if not exists product_sub_type text,
  add column if not exists has_components boolean not null default false,
  add column if not exists size_description text,
  add column if not exists material text,
  add column if not exists substrate_weight_gsm numeric(10,2) check (substrate_weight_gsm > 0),
  add column if not exists branding_method_id uuid references public.library_records(id),
  add column if not exists life_expectancy text,
  add column if not exists finished_style text,
  add column if not exists testing_checklist text[] not null default '{}'::text[]
    check (testing_checklist <@ array['pre_screen','lab_test','full_inspection','drop_test','loading_test','final_inspection']::text[]),
  add column if not exists aql_level_id uuid references public.library_records(id),
  add column if not exists has_lighting_electronics boolean not null default false,
  add column if not exists lighting_electronics_detail text,
  add column if not exists units_per_inner int check (units_per_inner > 0),
  add column if not exists units_per_outer int check (units_per_outer > 0),
  add column if not exists carton_length_cm numeric(10,2) check (carton_length_cm > 0),
  add column if not exists carton_width_cm numeric(10,2) check (carton_width_cm > 0),
  add column if not exists carton_height_cm numeric(10,2) check (carton_height_cm > 0),
  add column if not exists packing_method text,
  add column if not exists design_guidelines text,
  add column if not exists end_market text,
  add column if not exists reusable boolean,
  add column if not exists number_of_uses int check (number_of_uses > 0),
  add column if not exists designed_for_disassembly boolean,
  add column if not exists recycled_content_percent numeric(5,2) check (recycled_content_percent between 0 and 100),
  add column if not exists origin_country text,
  add column if not exists unit_of_measure text not null default 'EA',
  add column if not exists selling_unit_qty int check (selling_unit_qty > 0),
  add column if not exists moq int check (moq > 0),
  add column if not exists net_weight_kg numeric(12,3) check (net_weight_kg >= 0),
  add column if not exists gross_weight_kg numeric(12,3) check (gross_weight_kg >= 0),
  add column if not exists revision int not null default 1 check (revision > 0),
  add column if not exists revised_at timestamptz;
alter table public.job_specs add constraint job_specs_weights_check
  check (gross_weight_kg is null or net_weight_kg is null or gross_weight_kg >= net_weight_kg);

-- The revision number is the database's: users can't set it.
create or replace function public.trg_job_specs_revision_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('sourcing.system_write', true) is distinct from 'on' then
    if tg_op = 'INSERT' then new.revision := 1; new.revised_at := null;
    else new.revision := old.revision; new.revised_at := old.revised_at; end if;
  end if;
  return new;
end $$;
create trigger job_specs_revision_guard before insert or update on public.job_specs
  for each row execute function public.trg_job_specs_revision_guard();

create trigger job_specs_branding_check before insert or update of branding_method_id on public.job_specs
  for each row execute function public.trg_sourcing_library_ref('branding_method_id', 'branding_methods', 'Spec');
create trigger job_specs_branding_sync after insert or update of branding_method_id or delete on public.job_specs
  for each row execute function public.trg_sourcing_library_ref('branding_method_id', 'branding_methods', 'Spec');
create trigger job_specs_aql_check before insert or update of aql_level_id on public.job_specs
  for each row execute function public.trg_sourcing_library_ref('aql_level_id', 'aql_levels', 'Spec');
create trigger job_specs_aql_sync after insert or update of aql_level_id or delete on public.job_specs
  for each row execute function public.trg_sourcing_library_ref('aql_level_id', 'aql_levels', 'Spec');

-- ---------------------------------------------------------------------------
-- 2. Spec revisions
-- ---------------------------------------------------------------------------
create table public.spec_revisions (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.job_specs(id) on delete cascade,
  revision int not null check (revision > 0),
  change_note text,
  snapshot jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (spec_id, revision)
);

-- The spec as it stands: row, versions and bill of materials.
create or replace function public._spec_snapshot(p_spec uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select (to_jsonb(s) - 'co2e_detail') || jsonb_build_object(
    'versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.sort, v.created_at), '[]'::jsonb) from public.spec_versions v where v.spec_id = s.id),
    'components', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort, c.created_at), '[]'::jsonb) from public.spec_components c where c.spec_id = s.id))
  from public.job_specs s where s.id = p_spec;
$$;

-- Keep the current revision on record (once). Used when an RFQ is sent and before a revision is made.
create or replace function public._spec_ensure_revision(p_spec uuid, p_note text) returns void
language sql security definer set search_path = public as $$
  insert into public.spec_revisions (spec_id, revision, change_note, snapshot, created_by)
  select s.id, s.revision, p_note, public._spec_snapshot(s.id), auth.uid() from public.job_specs s where s.id = p_spec
  on conflict (spec_id, revision) do nothing;
$$;

-- RFQ / invitation flags for "spec changed: re-quote needed".
alter table public.rfqs
  add column if not exists incoterm_id uuid references public.library_records(id),
  add column if not exists incoterm_place text,
  add column if not exists rate_card_exception boolean not null default false,
  add column if not exists rate_card_exception_reason text,
  add column if not exists copied_from_rfq_id uuid references public.rfqs(id),
  add column if not exists spec_changed boolean not null default false,
  add column if not exists spec_changed_at timestamptz;
alter table public.rfqs add constraint rfqs_rate_card_exception_reason
  check (not rate_card_exception or length(trim(coalesce(rate_card_exception_reason, ''))) > 0);

alter table public.rfq_invitations
  add column if not exists requote_needed boolean not null default false,
  add column if not exists requote_reason text,
  add column if not exists requoted_at timestamptz;

-- Revise a spec. Not on any RFQ: a plain edit with a revision on record. On a sent RFQ: a new revision, the RFQ is
-- flagged "spec changed" and every invited supplier (not declined) is asked to re-quote. On an awarded RFQ: only
-- Stocktool master data (HS code, origin, units, weights, cartons) can change, so hand-off data can be completed.
-- p_changes: { <column>: value, ..., versions: [{ id?, name, quantity, finished_length, finished_width, item_code }] }
create or replace function public.spec_revise(p_spec uuid, p_changes jsonb, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.job_specs; n public.job_specs; v_ch jsonb; x jsonb; v_rev int; r record; v_awarded boolean; v_bad text;
  v_allowed text[] := array['title','description','spec_form','calculation_method','hs_code','size_unit','substrate_id',
    'product_category','product_sub_type','has_components','size_description','material','substrate_weight_gsm','branding_method_id',
    'life_expectancy','finished_style','testing_checklist','aql_level_id','has_lighting_electronics','lighting_electronics_detail',
    'units_per_inner','units_per_outer','carton_length_cm','carton_width_cm','carton_height_cm','packing_method','design_guidelines',
    'end_market','reusable','number_of_uses','designed_for_disassembly','recycled_content_percent','origin_country','unit_of_measure',
    'selling_unit_qty','moq','net_weight_kg','gross_weight_kg'];
  v_master text[] := array['hs_code','origin_country','unit_of_measure','selling_unit_qty','moq','net_weight_kg','gross_weight_kg',
    'units_per_inner','units_per_outer','carton_length_cm','carton_width_cm','carton_height_cm'];
begin
  if not public.is_internal() then raise exception 'Only internal staff can revise specs' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what changed: the change note goes to the suppliers'; end if;
  select * into s from public.job_specs where id = p_spec for update;
  if s.id is null then raise exception 'Spec not found'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'Nothing to change'; end if;
  select coalesce(jsonb_object_agg(key, case when value = '""'::jsonb then 'null'::jsonb else value end), '{}'::jsonb) into v_ch
    from jsonb_each(p_changes) where key = any (v_allowed);
  -- Only real changes count.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_ch
    from jsonb_each(v_ch) where (to_jsonb(s) -> key) is distinct from value;
  if v_ch = '{}'::jsonb and coalesce(jsonb_array_length(case when jsonb_typeof(p_changes->'versions') = 'array' then p_changes->'versions' end), 0) = 0 then
    raise exception 'Nothing has changed';
  end if;
  v_awarded := exists (select 1 from public.rfq_lines l join public.rfqs rq on rq.id = l.rfq_id where l.spec_id = p_spec and rq.status = 'awarded');
  if v_awarded then
    select string_agg(key, ', ') into v_bad from jsonb_each(v_ch) where not (key = any (v_master));
    if v_bad is not null or jsonb_typeof(p_changes->'versions') = 'array' and jsonb_array_length(p_changes->'versions') > 0 then
      raise exception 'This spec is on an awarded RFQ: only Stocktool master data (HS code, origin, units, weights, cartons) can change. Duplicate it for anything else.';
    end if;
  end if;

  perform public._spec_ensure_revision(p_spec, null); -- the current (possibly sent) revision stays on record as it was
  n := jsonb_populate_record(s, v_ch);
  v_rev := s.revision + 1;
  perform set_config('sourcing.system_write', 'on', true);
  update public.job_specs set
    title = n.title, description = n.description, spec_form = n.spec_form, calculation_method = n.calculation_method, hs_code = n.hs_code,
    size_unit = n.size_unit, substrate_id = n.substrate_id, product_category = n.product_category, product_sub_type = n.product_sub_type,
    has_components = n.has_components, size_description = n.size_description, material = n.material, substrate_weight_gsm = n.substrate_weight_gsm,
    branding_method_id = n.branding_method_id, life_expectancy = n.life_expectancy, finished_style = n.finished_style,
    testing_checklist = coalesce(n.testing_checklist, '{}'::text[]), aql_level_id = n.aql_level_id,
    has_lighting_electronics = coalesce(n.has_lighting_electronics, false), lighting_electronics_detail = n.lighting_electronics_detail,
    units_per_inner = n.units_per_inner, units_per_outer = n.units_per_outer, carton_length_cm = n.carton_length_cm,
    carton_width_cm = n.carton_width_cm, carton_height_cm = n.carton_height_cm, packing_method = n.packing_method,
    design_guidelines = n.design_guidelines, end_market = n.end_market, reusable = n.reusable, number_of_uses = n.number_of_uses,
    designed_for_disassembly = n.designed_for_disassembly, recycled_content_percent = n.recycled_content_percent,
    origin_country = n.origin_country, unit_of_measure = coalesce(n.unit_of_measure, 'EA'), selling_unit_qty = n.selling_unit_qty,
    moq = n.moq, net_weight_kg = n.net_weight_kg, gross_weight_kg = n.gross_weight_kg,
    revision = v_rev, revised_at = now()
  where id = p_spec;
  if jsonb_typeof(p_changes->'versions') = 'array' then
    for x in select * from jsonb_array_elements(p_changes->'versions') loop
      if nullif(x->>'quantity', '') is null or (x->>'quantity')::int <= 0 then raise exception 'Each version needs a quantity above zero'; end if;
      if nullif(x->>'id', '') is not null then
        update public.spec_versions set quantity = (x->>'quantity')::int,
          name = coalesce(nullif(trim(x->>'name'), ''), name),
          finished_length = coalesce(nullif(x->>'finished_length', '')::numeric, finished_length),
          finished_width = coalesce(nullif(x->>'finished_width', '')::numeric, finished_width),
          item_code = coalesce(nullif(trim(x->>'item_code'), ''), item_code)
        where id = (x->>'id')::uuid and spec_id = p_spec;
        if not found then raise exception 'A version does not belong to this spec'; end if;
      else
        insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width, item_code, sort)
        values (p_spec, coalesce(nullif(trim(x->>'name'), ''), 'Version'), (x->>'quantity')::int, nullif(x->>'finished_length', '')::numeric,
                nullif(x->>'finished_width', '')::numeric, nullif(trim(x->>'item_code'), ''),
                coalesce((select max(sort) + 1 from public.spec_versions where spec_id = p_spec), 0));
      end if;
    end loop;
  end if;
  perform set_config('sourcing.system_write', 'off', true);

  insert into public.spec_revisions (spec_id, revision, change_note, snapshot, created_by)
  values (p_spec, v_rev, trim(p_note), public._spec_snapshot(p_spec), auth.uid());
  perform public._sourcing_event(s.job_id, 'spec', p_spec, 'revised',
    jsonb_build_object('revision', v_rev, 'note', trim(p_note), 'fields', (select string_agg(key, ', ') from jsonb_each(v_ch))));

  for r in select distinct rq.id, rq.rfq_number, rq.title, rq.job_id from public.rfq_lines l join public.rfqs rq on rq.id = l.rfq_id
            where l.spec_id = p_spec and rq.status = 'sent' loop
    update public.rfqs set spec_changed = true, spec_changed_at = now() where id = r.id;
    update public.rfq_invitations set requote_needed = true,
      requote_reason = format('"%s" changed to revision %s: %s', n.title, v_rev, trim(p_note))
     where rfq_id = r.id and status <> 'declined';
    perform public.notify_supplier(i.supplier_id, 'rfq', 'Spec changed on ' || r.rfq_number,
      format('"%s" changed to revision %s: %s. Please review and re-quote before the due date.', n.title, v_rev, trim(p_note)),
      '/vendor/quotes/' || r.id)
      from public.rfq_invitations i where i.rfq_id = r.id and i.status <> 'declined';
    insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
    select sp.primary_contact_email, 'Spec changed on ' || r.rfq_number || ': re-quote needed',
           format('"%s" on %s (%s) changed to revision %s: %s. Open your vendor portal to review and re-quote.', n.title, r.rfq_number, r.title, v_rev, trim(p_note)),
           sp.id, auth.uid()
      from public.rfq_invitations i join public.suppliers sp on sp.id = i.supplier_id
     where i.rfq_id = r.id and i.status <> 'declined' and sp.primary_contact_email is not null;
    perform public._sourcing_event(r.job_id, 'rfq', r.id, 'requote_requested', jsonb_build_object('spec', n.title, 'revision', v_rev, 'note', trim(p_note)));
  end loop;
  return v_rev;
end $$;

-- Direct edits of a spec on a live RFQ stay blocked; the message points at "Revise spec".
create or replace function public.trg_spec_locked() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_spec uuid;
begin
  if current_setting('sourcing.system_write', true) = 'on' then return coalesce(new, old); end if;
  -- Field access through jsonb: the same function serves job_specs (id) and its child tables (spec_id).
  v_spec := (case when tg_table_name = 'job_specs' then coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id')
                  else coalesce(to_jsonb(new) ->> 'spec_id', to_jsonb(old) ->> 'spec_id') end)::uuid;
  if exists (select 1 from public.rfq_lines l join public.rfqs r on r.id = l.rfq_id
              where l.spec_id = v_spec and r.status in ('sent','awarded')) then
    raise exception 'This spec is on a live or awarded RFQ, so it is locked. Use "Revise spec" to make a new revision (invited suppliers are asked to re-quote), or duplicate it.';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- 3. RFQ lines: more breaks, variants, run-on, incoterm, delivery date and delivery points
-- ---------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.rfq_lines'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%cardinality(quantity_breaks) <= 6%' loop
    execute format('alter table public.rfq_lines drop constraint %I', c);
  end loop;
end $$;
alter table public.rfq_lines add constraint rfq_lines_breaks_check
  check (cardinality(quantity_breaks) between 1 and 12 and 0 < all (quantity_breaks));

alter table public.rfq_lines
  add column if not exists spec_version_id uuid references public.spec_versions(id),
  add column if not exists variant_label text,
  add column if not exists run_on_quantity int check (run_on_quantity > 0),
  add column if not exists incoterm_id uuid references public.library_records(id),
  add column if not exists delivery_date date,
  add column if not exists spec_revision int;
alter table public.rfq_lines drop constraint if exists rfq_lines_rfq_id_spec_id_key;
create unique index if not exists rfq_lines_spec_variant
  on public.rfq_lines (rfq_id, spec_id, coalesce(spec_version_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.rfq_line_delivery_points (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.rfq_lines(id) on delete cascade,
  point_no int not null,
  label text not null check (length(trim(label)) > 0),
  address text,
  country text,
  quantity int check (quantity > 0),
  delivery_date date,
  unique (line_id, point_no)
);

create trigger rfqs_incoterm_check before insert or update of incoterm_id on public.rfqs
  for each row execute function public.trg_sourcing_library_ref('incoterm_id', 'incoterms', 'RFQ');
create trigger rfqs_incoterm_sync after insert or update of incoterm_id or delete on public.rfqs
  for each row execute function public.trg_sourcing_library_ref('incoterm_id', 'incoterms', 'RFQ');
create trigger rfq_lines_incoterm_check before insert or update of incoterm_id on public.rfq_lines
  for each row execute function public.trg_sourcing_library_ref('incoterm_id', 'incoterms', 'RFQ line');
create trigger rfq_lines_incoterm_sync after insert or update of incoterm_id or delete on public.rfq_lines
  for each row execute function public.trg_sourcing_library_ref('incoterm_id', 'incoterms', 'RFQ line');

-- Lines from the form. Each item: spec_id, spec_version_id?, variant_label?, quantity_breaks (1-12), target_prices?,
-- show_targets?, notes?, run_on_quantity?, incoterm? (code), delivery_date?, delivery_points? [{label,address,country,quantity,delivery_date}].
-- A line not routed Create needs a rate-card exception on the RFQ.
create or replace function public._rfq_write_lines(p_rfq uuid, p_job uuid, p_lines jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare x jsonb; dp jsonb; s public.job_specs; t public.spec_triage; v public.spec_versions; v_breaks int[]; v_targets numeric[]; n int := 0; k int;
  v_value numeric := 0; v_has_target boolean := false; v_exc boolean; v_line uuid;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one spec line'; end if;
  select rate_card_exception into v_exc from public.rfqs where id = p_rfq;
  delete from public.rfq_lines where rfq_id = p_rfq;
  for x in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into s from public.job_specs where id = (x->>'spec_id')::uuid;
    if s.id is null or s.job_id <> p_job then raise exception 'Line %: the spec must belong to this job', n; end if;
    if s.is_draft then raise exception 'Line %: "%" is still a draft', n, s.title; end if;
    select * into t from public.spec_triage where spec_id = s.id and is_current;
    if t.id is null then raise exception 'Line %: run triage on "%" before it goes to RFQ', n, s.title; end if;
    if t.route <> 'create' and not coalesce(v_exc, false) then
      raise exception 'Line %: "%" is routed %, so it doesn''t need an RFQ. Override it to Create first, or flag a rate-card exception with a reason.', n, s.title, initcap(t.route);
    end if;
    v := null;
    if nullif(x->>'spec_version_id', '') is not null then
      select * into v from public.spec_versions where id = (x->>'spec_version_id')::uuid and spec_id = s.id;
      if v.id is null then raise exception 'Line %: that variant is not a version of "%"', n, s.title; end if;
    end if;
    -- Order is kept: the first break is the primary quantity used for totals, benchmarks and the estimate.
    select array_agg((q)::int order by o) into v_breaks from jsonb_array_elements_text(x->'quantity_breaks') with ordinality a(q, o) where nullif(q, '') is not null;
    if v_breaks is null or cardinality(v_breaks) = 0 then raise exception 'Line %: give at least one quantity', n; end if;
    if (select count(distinct q) from unnest(v_breaks) q) <> cardinality(v_breaks) then raise exception 'Line %: quantity breaks must be different', n; end if;
    if cardinality(v_breaks) > 12 then raise exception 'Line %: up to 12 quantity breaks', n; end if;
    if exists (select 1 from unnest(v_breaks) q where q <= 0) then raise exception 'Line %: quantities must be above zero', n; end if;
    v_targets := null;
    if jsonb_typeof(x->'target_prices') = 'array' and jsonb_array_length(x->'target_prices') > 0 then
      select array_agg(nullif(p, '')::numeric order by o) into v_targets from jsonb_array_elements_text(x->'target_prices') with ordinality a(p, o);
      if cardinality(v_targets) <> cardinality(v_breaks) then raise exception 'Line %: give one target price per quantity break', n; end if;
      if exists (select 1 from unnest(v_targets) p where p < 0) then raise exception 'Line %: target prices can''t be negative', n; end if;
      if v_targets[1] is not null then v_value := v_value + v_targets[1] * v_breaks[1]; v_has_target := true; end if;
    end if;
    if nullif(x->>'run_on_quantity', '') is not null and (x->>'run_on_quantity')::int <= 0 then raise exception 'Line %: the run-on quantity must be above zero', n; end if;
    insert into public.rfq_lines (rfq_id, spec_id, line_no, quantity_breaks, target_prices, show_targets, notes, spec_version_id, variant_label,
      run_on_quantity, incoterm_id, delivery_date)
    values (p_rfq, s.id, n, v_breaks, v_targets, coalesce((x->>'show_targets')::boolean, false), nullif(trim(x->>'notes'), ''), v.id,
      coalesce(nullif(trim(x->>'variant_label'), ''), v.name), nullif(x->>'run_on_quantity', '')::int, public._incoterm_id(x->>'incoterm'),
      nullif(x->>'delivery_date', '')::date)
    returning id into v_line;
    k := 0;
    for dp in select * from jsonb_array_elements(case when jsonb_typeof(x->'delivery_points') = 'array' then x->'delivery_points' else '[]'::jsonb end) loop
      if coalesce(trim(dp->>'label'), '') = '' then continue; end if;
      k := k + 1;
      if nullif(dp->>'quantity', '') is not null and (dp->>'quantity')::int <= 0 then raise exception 'Line %: delivery point quantities must be above zero', n; end if;
      insert into public.rfq_line_delivery_points (line_id, point_no, label, address, country, quantity, delivery_date)
      values (v_line, k, trim(dp->>'label'), nullif(trim(dp->>'address'), ''), nullif(trim(dp->>'country'), ''), nullif(dp->>'quantity', '')::int,
              nullif(dp->>'delivery_date', '')::date);
    end loop;
  end loop;
  return case when v_has_target then v_value end;
end $$;

-- rfq_create / rfq_update_draft gain p_options: { rate_card_exception, rate_card_exception_reason, incoterm, incoterm_place }.
drop function if exists public.rfq_create(uuid, text, timestamptz, numeric, jsonb, text);
create function public.rfq_create(p_job uuid, p_title text, p_due_at timestamptz, p_estimated_value numeric, p_lines jsonb,
  p_notes text default null, p_options jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_id uuid; v_target numeric; r public.rfqs; o jsonb := coalesce(p_options, '{}'::jsonb); v_exc boolean;
begin
  if not public.is_internal() then raise exception 'Only internal staff can create RFQs' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status in ('closed','cancelled') then raise exception 'This job is %', j.status; end if;
  if p_due_at is null or p_due_at <= now() then raise exception 'Choose a due date in the future'; end if;
  if p_estimated_value is not null and p_estimated_value < 0 then raise exception 'The estimated value can''t be negative'; end if;
  v_exc := coalesce((o->>'rate_card_exception')::boolean, false);
  if v_exc and coalesce(trim(o->>'rate_card_exception_reason'), '') = '' then raise exception 'Give the reason for the rate-card exception'; end if;
  insert into public.rfqs (job_id, title, currency, due_at, estimated_value, region, market, notes, created_by,
    rate_card_exception, rate_card_exception_reason, incoterm_id, incoterm_place)
  values (p_job, trim(p_title), j.currency, p_due_at, p_estimated_value, j.region, j.market, p_notes, auth.uid(),
    v_exc, case when v_exc then trim(o->>'rate_card_exception_reason') end, public._incoterm_id(o->>'incoterm'), nullif(trim(o->>'incoterm_place'), ''))
  returning id into v_id;
  v_target := public._rfq_write_lines(v_id, p_job, p_lines);
  update public.rfqs set estimated_value = coalesce(p_estimated_value, v_target) where id = v_id;
  perform public._rfq_flag_high_value(v_id);
  select * into r from public.rfqs where id = v_id;
  perform public._sourcing_event(p_job, 'rfq', v_id, 'created', jsonb_build_object('rfq_number', r.rfq_number, 'estimated_value', r.estimated_value,
    'high_value_alert', r.high_value_alert, 'rate_card_exception', case when v_exc then r.rate_card_exception_reason end));
  if r.high_value_alert then
    perform public._sourcing_event(p_job, 'rfq', v_id, 'high_value_alert', jsonb_build_object('estimated_value', r.estimated_value, 'threshold', r.high_value_threshold, 'market', r.market));
  end if;
  return v_id;
end $$;

drop function if exists public.rfq_update_draft(uuid, text, timestamptz, numeric, jsonb, text);
create function public.rfq_update_draft(p_rfq uuid, p_title text, p_due_at timestamptz, p_estimated_value numeric, p_lines jsonb,
  p_notes text default null, p_options jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v_target numeric; v_exc boolean;
begin
  if not public.is_internal() then raise exception 'Only internal staff can edit RFQs' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft RFQ can be edited'; end if;
  if p_due_at is null or p_due_at <= now() then raise exception 'Choose a due date in the future'; end if;
  if p_options is not null then
    v_exc := coalesce((p_options->>'rate_card_exception')::boolean, false);
    if v_exc and coalesce(trim(p_options->>'rate_card_exception_reason'), '') = '' then raise exception 'Give the reason for the rate-card exception'; end if;
    update public.rfqs set rate_card_exception = v_exc, rate_card_exception_reason = case when v_exc then trim(p_options->>'rate_card_exception_reason') end,
      incoterm_id = public._incoterm_id(p_options->>'incoterm'), incoterm_place = nullif(trim(p_options->>'incoterm_place'), '')
     where id = p_rfq;
  end if;
  v_target := public._rfq_write_lines(p_rfq, r.job_id, p_lines);
  update public.rfqs set title = trim(p_title), due_at = p_due_at, estimated_value = coalesce(p_estimated_value, v_target), notes = p_notes where id = p_rfq;
  perform public._rfq_flag_high_value(p_rfq);
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'edited', '{}'::jsonb);
end $$;

-- Send: as before, plus HS code mandatory for Promo & Merch lines, and the sent spec revision is recorded per line.
create or replace function public.rfq_send(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v_count int; v_cb_only boolean; ctl record; v_bad text; v_spec record;
begin
  if not public.is_internal() then raise exception 'Only internal staff can send RFQs' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null then raise exception 'RFQ not found'; end if;
  if r.status <> 'draft' then raise exception 'This RFQ has already been sent'; end if;
  if r.due_at <= now() then raise exception 'The due date has passed; choose a new one'; end if;
  select string_agg(format('line %s ("%s")', l2.line_no, s.title), ', ' order by l2.line_no) into v_bad
    from public.rfq_lines l2 join public.job_specs s on s.id = l2.spec_id
   where l2.rfq_id = p_rfq and s.spec_type = 'promo_merch' and coalesce(trim(s.hs_code), '') = '';
  if v_bad is not null then raise exception 'Promo and merch items need an HS code before the RFQ goes out: %', v_bad; end if;
  if r.estimated_value is null then raise exception 'Add an estimated value or target prices so the control matrix can be applied'; end if;
  select string_agg(s.name, ', ') into v_bad from public.rfq_invitations i join public.suppliers s on s.id = i.supplier_id
   where i.rfq_id = p_rfq and (not s.active or s.purchasing_blocked);
  if v_bad is not null then raise exception 'No longer eligible in Assure+: %. Remove them first.', v_bad; end if;
  select count(*), coalesce(bool_and(cross_border), false) into v_count, v_cb_only from public.rfq_invitations where rfq_id = p_rfq;
  if v_count = 0 then raise exception 'Choose suppliers from the eligible pool first'; end if;
  perform public._rfq_flag_high_value(p_rfq);
  select * into r from public.rfqs where id = p_rfq;
  if r.high_value_alert and r.high_value_approved_by is null then
    raise exception 'High-value RFQ (% or more in %): a sourcing lead must approve it before it goes out', r.high_value_threshold, r.market;
  end if;
  select * into ctl from public._control_rule(r.estimated_value, (select client_id from public.jobs where id = r.job_id), r.market, v_cb_only, current_date);
  if v_count < ctl.min_required then
    raise exception 'Not enough suppliers: % invited, at least % needed. %', v_count, ctl.min_required, ctl.basis;
  end if;
  update public.rfqs set status = 'sent', sent_at = now(), sent_by = auth.uid(), control_record_id = ctl.record_id,
    control_band = ctl.band, min_quotes_required = ctl.min_required, min_quotes_basis = ctl.basis, spec_changed = false, spec_changed_at = null where id = p_rfq;
  -- Record which spec revision went out, and keep that revision on file.
  update public.rfq_lines rl set spec_revision = s.revision from public.job_specs s where s.id = rl.spec_id and rl.rfq_id = p_rfq;
  for v_spec in select distinct spec_id from public.rfq_lines where rfq_id = p_rfq loop
    perform public._spec_ensure_revision(v_spec.spec_id, 'Sent on ' || r.rfq_number);
  end loop;
  if ctl.record_id is not null then
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (ctl.record_id, 'rfqs', p_rfq::text, r.rfq_number) on conflict do nothing;
  end if;
  insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
  select s.primary_contact_email, 'Request for quote ' || r.rfq_number || ': ' || r.title,
         format('You have been invited to quote on %s (%s). Quotes are sealed and due by %s. Open your vendor portal to respond.',
                r.rfq_number, r.title, to_char(r.due_at, 'DD Mon YYYY HH24:MI')), s.id, auth.uid()
    from public.rfq_invitations i join public.suppliers s on s.id = i.supplier_id
   where i.rfq_id = p_rfq and s.primary_contact_email is not null;
  perform public._job_advance(r.job_id, array['open'], 'quoting');
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'sent', jsonb_build_object('suppliers', v_count, 'min_required', ctl.min_required, 'band', ctl.band));
end $$;

-- Copy an RFQ for a reorder: a new draft on the same job with the same lines, delivery points (dates cleared),
-- incoterm and the suppliers that are still eligible. Linked to the original.
create or replace function public.rfq_copy(p_rfq uuid, p_title text default null, p_due_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.rfqs; j public.jobs; v_id uuid; l public.rfq_lines; v_line uuid; r public.rfqs;
begin
  if not public.is_internal() then raise exception 'Only internal staff can copy RFQs' using errcode = '42501'; end if;
  select * into o from public.rfqs where id = p_rfq;
  if o.id is null then raise exception 'RFQ not found'; end if;
  select * into j from public.jobs where id = o.job_id;
  if j.status in ('closed','cancelled') then raise exception 'This job is %: reopen it or start a new job for the reorder', j.status; end if;
  if p_due_at is not null and p_due_at <= now() then raise exception 'Choose a due date in the future'; end if;
  insert into public.rfqs (job_id, title, currency, due_at, estimated_value, region, market, notes, created_by, incoterm_id, incoterm_place,
    rate_card_exception, rate_card_exception_reason, copied_from_rfq_id)
  values (o.job_id, coalesce(nullif(trim(p_title), ''), 'Reorder: ' || o.title), o.currency, coalesce(p_due_at, now() + interval '7 days'),
    o.estimated_value, j.region, j.market, o.notes, auth.uid(),
    case when exists (select 1 from public.library_records where id = o.incoterm_id and status = 'active') then o.incoterm_id end,
    o.incoterm_place, o.rate_card_exception, o.rate_card_exception_reason, o.id)
  returning id into v_id;
  for l in select * from public.rfq_lines where rfq_id = p_rfq order by line_no loop
    insert into public.rfq_lines (rfq_id, spec_id, line_no, quantity_breaks, target_prices, show_targets, notes, spec_version_id, variant_label,
      run_on_quantity, incoterm_id)
    values (v_id, l.spec_id, l.line_no, l.quantity_breaks, l.target_prices, l.show_targets, l.notes, l.spec_version_id, l.variant_label,
      l.run_on_quantity, case when exists (select 1 from public.library_records where id = l.incoterm_id and status = 'active') then l.incoterm_id end)
    returning id into v_line;
    insert into public.rfq_line_delivery_points (line_id, point_no, label, address, country, quantity)
    select v_line, point_no, label, address, country, quantity from public.rfq_line_delivery_points where line_id = l.id;
  end loop;
  insert into public.rfq_invitations (rfq_id, supplier_id, cross_border, invited_by)
  select v_id, i.supplier_id, s.market is distinct from j.market, auth.uid()
    from public.rfq_invitations i join public.suppliers s on s.id = i.supplier_id
   where i.rfq_id = p_rfq and s.active and not s.purchasing_blocked;
  perform public._rfq_flag_high_value(v_id);
  select * into r from public.rfqs where id = v_id;
  perform public._sourcing_event(o.job_id, 'rfq', v_id, 'created', jsonb_build_object('rfq_number', r.rfq_number, 'copied_from', o.rfq_number, 'estimated_value', r.estimated_value));
  perform public._sourcing_event(o.job_id, 'rfq', p_rfq, 'copied', jsonb_build_object('new_rfq', r.rfq_number));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Vendor quote details (sealed: written only by _rfq_save_prices, read by vendors only through rfq_vendor_view)
-- ---------------------------------------------------------------------------
create table public.rfq_response_lines (
  response_id uuid not null references public.rfq_responses(id) on delete cascade,
  line_id uuid not null references public.rfq_lines(id) on delete cascade,
  lead_time_days int check (lead_time_days >= 0),
  carton_length_cm numeric(10,2) check (carton_length_cm > 0),
  carton_width_cm numeric(10,2) check (carton_width_cm > 0),
  carton_height_cm numeric(10,2) check (carton_height_cm > 0),
  units_per_carton int check (units_per_carton > 0),
  gross_weight_kg numeric(12,3) check (gross_weight_kg >= 0),
  net_weight_kg numeric(12,3) check (net_weight_kg >= 0),
  hs_code text,
  country_of_origin text,
  run_on_price numeric(14,4) check (run_on_price >= 0),
  sample_cost numeric(14,2) check (sample_cost >= 0),
  sample_lead_time_days int check (sample_lead_time_days >= 0),
  recycled_content_percent numeric(5,2) check (recycled_content_percent between 0 and 100),
  reusable boolean,
  number_of_uses int check (number_of_uses > 0),
  proposed_spec text,
  notes text,
  primary key (response_id, line_id)
);

create table public.rfq_response_alternatives (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.rfq_responses(id) on delete cascade,
  line_id uuid not null references public.rfq_lines(id) on delete cascade,
  alt_no int not null,
  description text not null check (length(trim(description)) > 0),
  quantity int not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  lead_time_days int check (lead_time_days >= 0),
  unique (response_id, alt_no)
);

create table public.rfq_response_point_prices (
  response_id uuid not null references public.rfq_responses(id) on delete cascade,
  delivery_point_id uuid not null references public.rfq_line_delivery_points(id) on delete cascade,
  quantity int not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  primary key (response_id, delivery_point_id, quantity)
);

-- Line details, alternatives and delivery-point prices from the object form of p_prices:
-- { prices: [...], lines: [{line_id, ...}], alternatives: [{line_id, description, quantity, unit_price, lead_time_days}],
--   point_prices: [{delivery_point_id, quantity, unit_price}] }
create or replace function public._rfq_save_details(p_response uuid, p_rfq uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare x jsonb; l public.rfq_lines; d record; n int := 0;
begin
  delete from public.rfq_response_lines where response_id = p_response;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p->'lines') = 'array' then p->'lines' else '[]'::jsonb end) loop
    select * into l from public.rfq_lines where id = (x->>'line_id')::uuid and rfq_id = p_rfq;
    if l.id is null then raise exception 'Quote details refer to a line that is not on this RFQ'; end if;
    insert into public.rfq_response_lines (response_id, line_id, lead_time_days, carton_length_cm, carton_width_cm, carton_height_cm, units_per_carton,
      gross_weight_kg, net_weight_kg, hs_code, country_of_origin, run_on_price, sample_cost, sample_lead_time_days, recycled_content_percent,
      reusable, number_of_uses, proposed_spec, notes)
    values (p_response, l.id, nullif(x->>'lead_time_days', '')::int, nullif(x->>'carton_length_cm', '')::numeric, nullif(x->>'carton_width_cm', '')::numeric,
      nullif(x->>'carton_height_cm', '')::numeric, nullif(x->>'units_per_carton', '')::int, nullif(x->>'gross_weight_kg', '')::numeric,
      nullif(x->>'net_weight_kg', '')::numeric, nullif(trim(x->>'hs_code'), ''), nullif(trim(x->>'country_of_origin'), ''),
      nullif(x->>'run_on_price', '')::numeric, nullif(x->>'sample_cost', '')::numeric, nullif(x->>'sample_lead_time_days', '')::int,
      nullif(x->>'recycled_content_percent', '')::numeric, nullif(x->>'reusable', '')::boolean, nullif(x->>'number_of_uses', '')::int,
      nullif(trim(x->>'proposed_spec'), ''), nullif(trim(x->>'notes'), ''));
  end loop;
  delete from public.rfq_response_alternatives where response_id = p_response;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p->'alternatives') = 'array' then p->'alternatives' else '[]'::jsonb end) loop
    if coalesce(trim(x->>'description'), '') = '' and nullif(x->>'unit_price', '') is null then continue; end if;
    select * into l from public.rfq_lines where id = (x->>'line_id')::uuid and rfq_id = p_rfq;
    if l.id is null then raise exception 'An alternative refers to a line that is not on this RFQ'; end if;
    if coalesce(trim(x->>'description'), '') = '' then raise exception 'Line %: describe the alternative you are proposing', l.line_no; end if;
    if nullif(x->>'unit_price', '') is null then raise exception 'Line %: give a unit price for the alternative', l.line_no; end if;
    n := n + 1;
    insert into public.rfq_response_alternatives (response_id, line_id, alt_no, description, quantity, unit_price, lead_time_days)
    values (p_response, l.id, n, trim(x->>'description'), coalesce(nullif(x->>'quantity', '')::int, l.quantity_breaks[1]),
            (x->>'unit_price')::numeric, nullif(x->>'lead_time_days', '')::int);
  end loop;
  delete from public.rfq_response_point_prices where response_id = p_response;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p->'point_prices') = 'array' then p->'point_prices' else '[]'::jsonb end) loop
    if nullif(x->>'unit_price', '') is null then continue; end if;
    select dp.id, dp.quantity, ln.quantity_breaks into d from public.rfq_line_delivery_points dp join public.rfq_lines ln on ln.id = dp.line_id
     where dp.id = (x->>'delivery_point_id')::uuid and ln.rfq_id = p_rfq;
    if d.id is null then raise exception 'A delivery-point price refers to a delivery point that is not on this RFQ'; end if;
    insert into public.rfq_response_point_prices (response_id, delivery_point_id, quantity, unit_price)
    values (p_response, d.id, coalesce(nullif(x->>'quantity', '')::int, d.quantity, d.quantity_breaks[1]), (x->>'unit_price')::numeric)
    on conflict (response_id, delivery_point_id, quantity) do update set unit_price = excluded.unit_price;
  end loop;
end $$;

-- Prices per break (unit prices only; totals are always calculated here). Accepts the old array form or the object form.
create or replace function public._rfq_save_prices(p_response uuid, p_rfq uuid, p_prices jsonb, p_require_all boolean) returns numeric
language plpgsql security definer set search_path = public as $$
declare x jsonb; l public.rfq_lines; v_total numeric := 0; v_missing text; v_prices jsonb;
begin
  v_prices := case when jsonb_typeof(p_prices) = 'object' then coalesce(p_prices->'prices', '[]'::jsonb) else coalesce(p_prices, '[]'::jsonb) end;
  if jsonb_typeof(v_prices) <> 'array' then raise exception 'Prices must be a list'; end if;
  delete from public.rfq_response_prices where response_id = p_response;
  for x in select * from jsonb_array_elements(v_prices) loop
    if nullif(x->>'unit_price', '') is null then continue; end if;
    select * into l from public.rfq_lines where id = (x->>'line_id')::uuid and rfq_id = p_rfq;
    if l.id is null then raise exception 'A price refers to a line that is not on this RFQ'; end if;
    if not ((x->>'quantity')::int = any (l.quantity_breaks)) then raise exception 'Line %: % is not one of the quantity breaks', l.line_no, x->>'quantity'; end if;
    if (x->>'unit_price')::numeric < 0 then raise exception 'Prices can''t be negative'; end if;
    insert into public.rfq_response_prices (response_id, line_id, quantity, unit_price, lead_time_days)
    values (p_response, l.id, (x->>'quantity')::int, (x->>'unit_price')::numeric, nullif(x->>'lead_time_days', '')::int)
    on conflict (response_id, line_id, quantity) do update set unit_price = excluded.unit_price, lead_time_days = excluded.lead_time_days;
  end loop;
  if jsonb_typeof(p_prices) = 'object' then perform public._rfq_save_details(p_response, p_rfq, p_prices); end if;
  select string_agg('line ' || l2.line_no, ', ') into v_missing from public.rfq_lines l2
   where l2.rfq_id = p_rfq and not exists (select 1 from public.rfq_response_prices p where p.response_id = p_response and p.line_id = l2.id and p.quantity = l2.quantity_breaks[1]);
  if p_require_all and v_missing is not null then raise exception 'Price at least the first quantity break of every line (missing: %)', v_missing; end if;
  select coalesce(sum(p.unit_price * p.quantity), 0) into v_total from public.rfq_lines l3
    join public.rfq_response_prices p on p.line_id = l3.id and p.quantity = l3.quantity_breaks[1] and p.response_id = p_response
   where l3.rfq_id = p_rfq;
  return round(v_total, 2);
end $$;

-- Vendor quote (viewer-gated: the public wrapper blocks view-only users, this core holds the logic).
-- Same as before; submitting also clears a "re-quote needed" flag.
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

-- A buyer keys in a quote received by email (also takes the object form, so details and alternatives can be logged).
create or replace function public.rfq_log_quote(p_rfq uuid, p_supplier uuid, p_prices jsonb, p_lead_time_days int, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.rfqs; i public.rfq_invitations; q public.rfq_responses; v_total numeric;
begin
  if not public.is_internal() then raise exception 'Only internal staff can log quotes' using errcode = '42501'; end if;
  select * into r from public.rfqs where id = p_rfq for update;
  if r.id is null or r.status <> 'sent' then raise exception 'Quotes can only be logged on an open RFQ'; end if;
  select * into i from public.rfq_invitations where rfq_id = p_rfq and supplier_id = p_supplier;
  if i.rfq_id is null then raise exception 'That supplier was not invited to this RFQ'; end if;
  if i.status = 'declined' then raise exception 'That supplier declined this RFQ'; end if;
  select * into q from public.rfq_responses where rfq_id = p_rfq and supplier_id = p_supplier for update;
  if q.id is not null and q.status in ('awarded','declined') then raise exception 'This quote is closed'; end if;
  if q.id is null then
    insert into public.rfq_responses (rfq_id, supplier_id, status, source, currency) values (p_rfq, p_supplier, 'draft', 'internal_entry', r.currency) returning * into q;
  end if;
  v_total := public._rfq_save_prices(q.id, p_rfq, p_prices, true);
  update public.rfq_responses set status = 'submitted', source = 'internal_entry', lead_time_days = p_lead_time_days, notes = p_notes,
    total_value = v_total, submitted_at = now(), submitted_by = auth.uid(), finance_status = 'pending', finance_by = null, finance_at = null,
    finance_notes = null, updated_at = now() where id = q.id;
  update public.rfq_invitations set status = 'quoted', responded_at = now(),
    requoted_at = case when requote_needed then now() else requoted_at end, requote_needed = false
   where rfq_id = p_rfq and supplier_id = p_supplier;
  perform public._sourcing_event(r.job_id, 'rfq', p_rfq, 'quote_logged', jsonb_build_object('response_id', q.id, 'supplier_id', p_supplier));
  return q.id;
end $$;

-- Vendor list: adds the re-quote flag.
create or replace function public.rfq_vendor_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rfq_id', r.id, 'rfq_number', r.rfq_number, 'title', r.title, 'due_at', r.due_at, 'currency', r.currency,
    'open', r.status = 'sent' and r.due_at > now(), 'rfq_status', case when r.status = 'sent' and r.due_at <= now() then 'closed' else r.status end,
    'invitation_status', i.status, 'quote_status', q.status, 'line_count', (select count(*) from public.rfq_lines where rfq_id = r.id),
    'requote_needed', i.requote_needed and r.status = 'sent'
  ) order by r.due_at desc), '[]'::jsonb)
  from public.rfq_invitations i join public.rfqs r on r.id = i.rfq_id
  left join public.rfq_responses q on q.rfq_id = i.rfq_id and q.supplier_id = i.supplier_id
  where i.supplier_id = public.my_supplier_id() and public.my_supplier_id() is not null and r.status <> 'draft';
$$;

-- What one invited vendor may see: the RFQ, its lines (targets only when shared), the structured spec, delivery points,
-- and its own invitation and quote (with its own details and alternatives). Never other suppliers, counts of bidders,
-- internal notes, minimums or finance decisions.
create or replace function public.rfq_vendor_view(p_rfq uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.rfq_invitations := public._vendor_invitation(p_rfq); r public.rfqs; j public.jobs; q public.rfq_responses; v jsonb;
begin
  if i.status = 'invited' then
    update public.rfq_invitations set status = 'viewed', viewed_at = now() where rfq_id = p_rfq and supplier_id = i.supplier_id;
    i.status := 'viewed';
  end if;
  select * into r from public.rfqs where id = p_rfq;
  select * into j from public.jobs where id = r.job_id;
  select * into q from public.rfq_responses where rfq_id = p_rfq and supplier_id = i.supplier_id;
  v := jsonb_build_object(
    'rfq', jsonb_build_object('id', r.id, 'rfq_number', r.rfq_number, 'title', r.title, 'due_at', r.due_at, 'currency', r.currency,
       'open', r.status = 'sent' and r.due_at > now(), 'status', case when r.status = 'sent' and r.due_at <= now() then 'closed' else r.status end,
       'job_number', j.job_number, 'market', r.market, 'region', r.region,
       'incoterm', coalesce((select code from public.library_records where id = r.incoterm_id), 'DDP'), 'incoterm_place', r.incoterm_place),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'line_no', l.line_no, 'quantity_breaks', to_jsonb(l.quantity_breaks),
        'target_prices', case when l.show_targets then to_jsonb(l.target_prices) end, 'notes', l.notes,
        'variant_label', l.variant_label, 'run_on_quantity', l.run_on_quantity, 'delivery_date', l.delivery_date,
        'incoterm', (select code from public.library_records where id = l.incoterm_id),
        'spec_revision_sent', l.spec_revision, 'spec_revision', s.revision,
        'spec_changes', (select coalesce(jsonb_agg(jsonb_build_object('revision', sr.revision, 'note', sr.change_note, 'at', sr.created_at) order by sr.revision), '[]'::jsonb)
                           from public.spec_revisions sr where sr.spec_id = s.id and sr.revision > coalesce(l.spec_revision, s.revision)),
        'delivery_points', (select coalesce(jsonb_agg(jsonb_build_object('id', dp.id, 'point_no', dp.point_no, 'label', dp.label, 'address', dp.address,
              'country', dp.country, 'quantity', dp.quantity, 'delivery_date', dp.delivery_date) order by dp.point_no), '[]'::jsonb)
            from public.rfq_line_delivery_points dp where dp.line_id = l.id),
        'spec', jsonb_build_object('title', s.title, 'spec_type', s.spec_type, 'spec_form', s.spec_form, 'description', s.description, 'hs_code', s.hs_code,
           'versions', (select coalesce(jsonb_agg(jsonb_build_object('name', sv.name, 'quantity', sv.quantity, 'finished_length', sv.finished_length,
              'finished_width', sv.finished_width) order by sv.sort), '[]'::jsonb) from public.spec_versions sv where sv.spec_id = s.id),
           'size_unit', s.size_unit, 'product_category', s.product_category, 'product_sub_type', s.product_sub_type,
           'size_description', s.size_description, 'material', s.material, 'substrate_weight_gsm', s.substrate_weight_gsm,
           'branding_method', (select name from public.library_records where id = s.branding_method_id),
           'life_expectancy', s.life_expectancy, 'finished_style', s.finished_style, 'testing_checklist', to_jsonb(s.testing_checklist),
           'aql_level', (select name from public.library_records where id = s.aql_level_id),
           'has_lighting_electronics', s.has_lighting_electronics, 'lighting_electronics_detail', s.lighting_electronics_detail,
           'units_per_inner', s.units_per_inner, 'units_per_outer', s.units_per_outer, 'carton_length_cm', s.carton_length_cm,
           'carton_width_cm', s.carton_width_cm, 'carton_height_cm', s.carton_height_cm, 'packing_method', s.packing_method,
           'design_guidelines', s.design_guidelines, 'end_market', s.end_market, 'reusable', s.reusable, 'number_of_uses', s.number_of_uses,
           'designed_for_disassembly', s.designed_for_disassembly, 'recycled_content_percent', s.recycled_content_percent,
           'origin_country', s.origin_country, 'unit_of_measure', s.unit_of_measure, 'moq', s.moq,
           'components', (select coalesce(jsonb_agg(c.component_name order by c.sort), '[]'::jsonb) from public.spec_components c where c.spec_id = s.id))
       ) order by l.line_no), '[]'::jsonb)
       from public.rfq_lines l join public.job_specs s on s.id = l.spec_id where l.rfq_id = p_rfq),
    'invitation', jsonb_build_object('status', i.status, 'declined_at', i.declined_at, 'decline_reason', i.decline_reason,
       'requote_needed', i.requote_needed and r.status = 'sent', 'requote_reason', case when i.requote_needed then i.requote_reason end),
    'quote', case when q.id is null then null else jsonb_build_object('id', q.id, 'status', q.status, 'lead_time_days', q.lead_time_days,
       'notes', q.notes, 'total_value', q.total_value, 'submitted_at', q.submitted_at,
       'prices', (select coalesce(jsonb_agg(jsonb_build_object('line_id', p.line_id, 'quantity', p.quantity, 'unit_price', p.unit_price, 'lead_time_days', p.lead_time_days)), '[]'::jsonb)
                  from public.rfq_response_prices p where p.response_id = q.id),
       'lines', (select coalesce(jsonb_agg(to_jsonb(d) - 'response_id'), '[]'::jsonb) from public.rfq_response_lines d where d.response_id = q.id),
       'alternatives', (select coalesce(jsonb_agg(jsonb_build_object('line_id', a.line_id, 'alt_no', a.alt_no, 'description', a.description, 'quantity', a.quantity,
                          'unit_price', a.unit_price, 'lead_time_days', a.lead_time_days) order by a.alt_no), '[]'::jsonb)
                        from public.rfq_response_alternatives a where a.response_id = q.id),
       'point_prices', (select coalesce(jsonb_agg(jsonb_build_object('delivery_point_id', pp.delivery_point_id, 'quantity', pp.quantity, 'unit_price', pp.unit_price)), '[]'::jsonb)
                        from public.rfq_response_point_prices pp where pp.response_id = q.id)) end);
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Estimates: cost split, GSC commission, client year-end rebate, client POs, logistics hand-off fields
-- ---------------------------------------------------------------------------
alter table public.sourcing_clients
  add column if not exists gsc_commission_percent numeric(6,2) not null default 0 check (gsc_commission_percent between 0 and 50),
  add column if not exists year_end_rebate_percent numeric(6,2) not null default 0 check (year_end_rebate_percent between 0 and 50);

alter table public.estimates
  add column if not exists gsc_commission_percent numeric(6,2) not null default 0 check (gsc_commission_percent >= 0),
  add column if not exists rebate_percent numeric(6,2) not null default 0 check (rebate_percent >= 0),
  add column if not exists additional_cost numeric(14,2) not null default 0 check (additional_cost >= 0),
  add column if not exists incoterm_id uuid references public.library_records(id),
  add column if not exists port_of_loading text,
  add column if not exists forwarder text,
  add column if not exists consignee text,
  add column if not exists hub text;
alter table public.estimates add constraint estimates_deductions_check check (gsc_commission_percent + rebate_percent < 100);

create trigger estimates_incoterm_check before insert or update of incoterm_id on public.estimates
  for each row execute function public.trg_sourcing_library_ref('incoterm_id', 'incoterms', 'Estimate');
create trigger estimates_incoterm_sync after insert or update of incoterm_id or delete on public.estimates
  for each row execute function public.trg_sourcing_library_ref('incoterm_id', 'incoterms', 'Estimate');

-- Sell price: cost (supplier cost + other cost lines) with markup or margin, then grossed up so the GSC commission and the
-- client's year-end rebate (both a % of the sell price) don't eat into the margin. Mirrors estimateSell() in src/lib/sourcing-hub.ts.
create or replace function public._estimate_sell(p_cost numeric, p_mode text, p_percent numeric, p_commission numeric, p_rebate numeric) returns numeric
language sql immutable as $$
  select round((case when p_mode = 'margin' then p_cost / (1 - p_percent / 100) else p_cost * (1 + p_percent / 100) end)
               / (1 - (coalesce(p_commission, 0) + coalesce(p_rebate, 0)) / 100), 2);
$$;

create or replace function public.trg_estimates_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.sourcing_clients;
begin
  if tg_op = 'INSERT' then
    new.estimate_number := public._next_number('EST');
    -- Estimates drafted by people (award, triage) take the client's rules; system / seed writes keep what they set.
    if auth.uid() is not null and coalesce(new.gsc_commission_percent, 0) = 0 and coalesce(new.rebate_percent, 0) = 0 then
      select sc.* into c from public.sourcing_clients sc join public.jobs j on j.client_id = sc.id where j.id = new.job_id;
      new.gsc_commission_percent := coalesce(c.gsc_commission_percent, 0);
      new.rebate_percent := coalesce(c.year_end_rebate_percent, 0);
    end if;
  else
    new.estimate_number := old.estimate_number; new.updated_at := now();
  end if;
  new.sell_price := public._estimate_sell(new.base_cost + coalesce(new.additional_cost, 0), new.pricing_mode, new.pricing_percent,
    new.gsc_commission_percent, new.rebate_percent);
  return new;
end $$;

create table public.estimate_cost_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  category text not null check (category in ('testing','inspection','samples','logistics','design','installation')),
  description text,
  amount numeric(14,2) not null check (amount >= 0),
  supplier_id uuid references public.suppliers(id),
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index estimate_cost_lines_est_idx on public.estimate_cost_lines (estimate_id, sort);

-- Cost split (draft only): product cost comes from the supplier lines; these are the other costs Stocktool splits out.
create or replace function public.estimate_set_cost_lines(p_estimate uuid, p_lines jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare e public.estimates; x jsonb; n int := 0; v_total numeric;
begin
  if not public.is_internal() then raise exception 'Only internal staff can price estimates' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status <> 'draft' then raise exception 'Only a draft estimate can be repriced'; end if;
  delete from public.estimate_cost_lines where estimate_id = p_estimate;
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if nullif(x->>'amount', '') is null then continue; end if;
    if x->>'category' not in ('testing','inspection','samples','logistics','design','installation') then
      raise exception 'Choose a cost category: testing, inspection, samples, logistics, design or installation';
    end if;
    if (x->>'amount')::numeric < 0 then raise exception 'Costs can''t be negative'; end if;
    if nullif(x->>'supplier_id', '') is not null and not exists (select 1 from public.suppliers where id = (x->>'supplier_id')::uuid) then
      raise exception 'Supplier not found';
    end if;
    n := n + 1;
    insert into public.estimate_cost_lines (estimate_id, category, description, amount, supplier_id, sort, created_by)
    values (p_estimate, x->>'category', nullif(trim(x->>'description'), ''), round((x->>'amount')::numeric, 2), nullif(x->>'supplier_id', '')::uuid, n, auth.uid());
  end loop;
  select coalesce(sum(amount), 0) into v_total from public.estimate_cost_lines where estimate_id = p_estimate;
  update public.estimates set additional_cost = v_total where id = p_estimate;
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'cost_split_set', jsonb_build_object('lines', n, 'additional_cost', v_total));
  return v_total;
end $$;

-- GSC commission and client year-end rebate (draft only; defaults come from the client's commercial rules).
create or replace function public.estimate_set_commercials(p_estimate uuid, p_commission numeric, p_rebate numeric) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  if not public.is_internal() then raise exception 'Only internal staff can price estimates' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status <> 'draft' then raise exception 'Only a draft estimate can be repriced'; end if;
  if coalesce(p_commission, 0) < 0 or coalesce(p_rebate, 0) < 0 or coalesce(p_commission, 0) > 50 or coalesce(p_rebate, 0) > 50 then
    raise exception 'Commission and rebate must each be between 0 and 50%%';
  end if;
  update public.estimates set gsc_commission_percent = coalesce(p_commission, 0), rebate_percent = coalesce(p_rebate, 0) where id = p_estimate;
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'commercials_set', jsonb_build_object('gsc_commission_percent', p_commission, 'rebate_percent', p_rebate));
end $$;

-- Logistics hand-off fields (incoterm override, port of loading, forwarder, consignee, hub). Editable until the hand-off is sent.
create or replace function public.estimate_set_logistics(p_estimate uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  if not public.is_internal() then raise exception 'Only internal staff can edit estimates' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status = 'declined' then raise exception 'This estimate can''t be changed'; end if;
  if exists (select 1 from public.integration_outbox where aggregate_id = p_estimate and event = 'estimate.approved' and status = 'sent') then
    raise exception 'This estimate has already been handed to Stocktool';
  end if;
  update public.estimates set incoterm_id = public._incoterm_id(p_data->>'incoterm'), port_of_loading = nullif(trim(p_data->>'port_of_loading'), ''),
    forwarder = nullif(trim(p_data->>'forwarder'), ''), consignee = nullif(trim(p_data->>'consignee'), ''), hub = nullif(trim(p_data->>'hub'), '')
   where id = p_estimate;
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'logistics_set', coalesce(p_data, '{}'::jsonb));
end $$;

-- Client purchase orders: many per estimate; together they can't exceed the sell price.
create table public.client_pos (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  po_number text not null check (length(trim(po_number)) > 0),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null,
  po_date date not null default current_date,
  file_id uuid references public.files(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (estimate_id, po_number)
);

create or replace function public.estimate_add_client_po(p_estimate uuid, p_po_number text, p_amount numeric, p_po_date date default null, p_file uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_sum numeric; v_id uuid;
begin
  if not public.is_internal() then raise exception 'Only internal staff can record client POs' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  if e.status not in ('sent','approved') then raise exception 'Client POs can be added once the estimate is with the client'; end if;
  if coalesce(trim(p_po_number), '') = '' then raise exception 'Enter the client''s PO number'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the PO amount'; end if;
  if exists (select 1 from public.client_pos where estimate_id = p_estimate and lower(po_number) = lower(trim(p_po_number))) then
    raise exception 'PO % is already on this estimate', trim(p_po_number);
  end if;
  if p_file is not null and not exists (select 1 from public.files where id = p_file) then raise exception 'File not found'; end if;
  select coalesce(sum(amount), 0) into v_sum from public.client_pos where estimate_id = p_estimate;
  if v_sum + p_amount > e.sell_price + 0.01 then
    raise exception 'Client POs would total % %, more than the estimate sell price of % %', e.currency, round(v_sum + p_amount, 2), e.currency, e.sell_price;
  end if;
  insert into public.client_pos (estimate_id, po_number, amount, currency, po_date, file_id, created_by)
  values (p_estimate, trim(p_po_number), round(p_amount, 2), e.currency, coalesce(p_po_date, current_date), p_file, auth.uid())
  returning id into v_id;
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'client_po_added',
    jsonb_build_object('po_number', trim(p_po_number), 'amount', round(p_amount, 2), 'total', round(v_sum + p_amount, 2)));
  return v_id;
end $$;

create or replace function public.estimate_remove_client_po(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.client_pos; e public.estimates;
begin
  if not public.is_internal() then raise exception 'Only internal staff can change client POs' using errcode = '42501'; end if;
  select * into c from public.client_pos where id = p_id for update;
  if c.id is null then raise exception 'Client PO not found'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the PO is removed'; end if;
  select * into e from public.estimates where id = c.estimate_id;
  if exists (select 1 from public.integration_outbox where aggregate_id = e.id and event = 'estimate.approved' and status = 'sent') then
    raise exception 'This estimate has already been handed to Stocktool';
  end if;
  delete from public.client_pos where id = p_id;
  perform public._sourcing_event(e.job_id, 'estimate', e.id, 'client_po_removed', jsonb_build_object('po_number', c.po_number, 'amount', c.amount, 'reason', trim(p_reason)));
end $$;

-- What Stocktool still needs before the hand-off can go through (empty = complete).
create or replace function public._estimate_missing_fields(p_estimate uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; v text[] := '{}'::text[];
begin
  if auth.uid() is not null and not public.is_internal() then return null; end if;
  select * into e from public.estimates where id = p_estimate;
  if e.id is null then return null; end if;
  if not exists (select 1 from public.client_pos where estimate_id = e.id) and coalesce(trim(e.client_order_ref), '') = '' then
    v := array_append(v, 'Client PO');
  end if;
  if exists (select 1 from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id
              left join public.rfq_response_lines d on d.response_id = e.response_id and d.line_id = el.rfq_line_id
             where el.estimate_id = e.id and coalesce(nullif(trim(d.hs_code), ''), nullif(trim(sp.hs_code), '')) is null) then
    v := array_append(v, 'HS code');
  end if;
  if exists (select 1 from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id
              left join public.rfq_response_lines d on d.response_id = e.response_id and d.line_id = el.rfq_line_id
             where el.estimate_id = e.id and coalesce(d.net_weight_kg, sp.net_weight_kg) is null) then
    v := array_append(v, 'Net weight');
  end if;
  if exists (select 1 from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id
              left join public.rfq_response_lines d on d.response_id = e.response_id and d.line_id = el.rfq_line_id
             where el.estimate_id = e.id and coalesce(d.gross_weight_kg, sp.gross_weight_kg) is null) then
    v := array_append(v, 'Gross weight');
  end if;
  if exists (select 1 from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id
              left join public.rfq_response_lines d on d.response_id = e.response_id and d.line_id = el.rfq_line_id
             where el.estimate_id = e.id and coalesce(nullif(trim(d.country_of_origin), ''), nullif(trim(sp.origin_country), '')) is null) then
    v := array_append(v, 'Country of origin');
  end if;
  return v;
end $$;

-- The estimate.approved payload for Stocktool (SO / PO creation and cost split).
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
        'variant', rl.variant_label, 'hs_code', coalesce(nullif(trim(d.hs_code), ''), sp.hs_code),
        'origin_country', coalesce(nullif(trim(d.country_of_origin), ''), sp.origin_country),
        'incoterm', coalesce((select code from public.library_records where id = rl.incoterm_id), v_inc),
        'unit_of_measure', sp.unit_of_measure, 'selling_unit_qty', sp.selling_unit_qty, 'moq', sp.moq,
        'net_weight_kg', coalesce(d.net_weight_kg, sp.net_weight_kg), 'gross_weight_kg', coalesce(d.gross_weight_kg, sp.gross_weight_kg),
        'units_per_carton', coalesce(d.units_per_carton, sp.units_per_outer),
        'carton_cm', case when coalesce(d.carton_length_cm, sp.carton_length_cm) is not null then jsonb_build_array(
            coalesce(d.carton_length_cm, sp.carton_length_cm), coalesce(d.carton_width_cm, sp.carton_width_cm), coalesce(d.carton_height_cm, sp.carton_height_cm)) end,
        'quantity', el.quantity, 'unit_cost', el.unit_cost,
        'unit_sell', public._estimate_sell(el.unit_cost, e.pricing_mode, e.pricing_percent, e.gsc_commission_percent, e.rebate_percent),
        'unit_weight_grams', sp.unit_weight_grams, 'delivery_date', rl.delivery_date,
        'delivery_points', (select coalesce(jsonb_agg(jsonb_build_object('label', dp.label, 'country', dp.country, 'quantity', dp.quantity, 'delivery_date', dp.delivery_date) order by dp.point_no), '[]'::jsonb)
                            from public.rfq_line_delivery_points dp where dp.line_id = rl.id),
        'reusable', sp.reusable, 'recycled_content_percent', coalesce(d.recycled_content_percent, sp.recycled_content_percent)) order by sp.spec_no), '[]'::jsonb)
      from public.estimate_lines el join public.job_specs sp on sp.id = el.spec_id
      left join public.rfq_lines rl on rl.id = el.rfq_line_id
      left join public.rfq_response_lines d on d.response_id = e.response_id and d.line_id = el.rfq_line_id
      where el.estimate_id = e.id),
    'missing_fields', to_jsonb(coalesce(public._estimate_missing_fields(e.id), '{}'::text[])));
end $$;

-- Client acceptance (recorded internally) = estimate approved: Sourcing+ hands off to Stocktool with the full payload.
create or replace function public.estimate_approve(p_estimate uuid, p_client_order_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  if not public.is_internal() then raise exception 'Only internal staff can record a client approval' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null or e.status <> 'sent' then raise exception 'Send the estimate to the client before recording approval'; end if;
  update public.estimates set status = 'approved', client_order_ref = nullif(trim(p_client_order_ref), ''), approved_by = auth.uid(), approved_at = now()
   where id = p_estimate returning * into e;
  insert into public.integration_outbox (module, event, aggregate_type, aggregate_id, payload, created_by)
  values ('sourcing', 'estimate.approved', 'estimate', e.id, public._estimate_handoff_payload(e.id), auth.uid());
  perform public._sourcing_event(e.job_id, 'estimate', p_estimate, 'approved', jsonb_build_object('client_order_ref', e.client_order_ref));
end $$;

-- Rebuild a hand-off that hasn't gone yet (after missing data was filled in).
create or replace function public.estimate_refresh_handoff(p_estimate uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare e public.estimates; n int;
begin
  if not public.is_internal() then raise exception 'Only internal staff can refresh the hand-off' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate;
  if e.id is null or e.status <> 'approved' then raise exception 'Only an approved estimate has a hand-off'; end if;
  update public.integration_outbox set payload = public._estimate_handoff_payload(e.id), status = 'queued', last_error = null
   where aggregate_id = e.id and event = 'estimate.approved' and status in ('queued','failed');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'There is no waiting hand-off to refresh (it has already gone to Stocktool)'; end if;
  perform public._sourcing_event(e.job_id, 'estimate', e.id, 'handoff_refreshed', jsonb_build_object('missing', array_to_string(public._estimate_missing_fields(e.id), ', ')));
  return public._estimate_missing_fields(e.id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Views (recreated so they carry the new columns) and the hand-off (hypercare) view
-- ---------------------------------------------------------------------------
drop view if exists public.v_specs;
create view public.v_specs with (security_invoker = true) as
  select s.*, j.job_number, j.title as job_title, c.name as client_name, sub.name as substrate_name,
         (select coalesce(sum(quantity), 0) from public.spec_versions v where v.spec_id = s.id)::int as total_quantity,
         t.id as triage_id, t.route, t.reason as triage_reason, t.confidence, t.unit_price as triage_unit_price, t.push_status,
         t.supplier_id as triage_supplier_id, ts.name as triage_supplier_name, t.decided_at as triage_at, t.source as triage_source,
         rc.name as rate_card_name, bm.name as branding_method_name, aql.name as aql_level_name,
         exists (select 1 from public.rfq_lines l join public.rfqs r on r.id = l.rfq_id where l.spec_id = s.id and r.status in ('sent','awarded')) as on_live_rfq
    from public.job_specs s join public.jobs j on j.id = s.job_id join public.sourcing_clients c on c.id = j.client_id
    left join public.library_records sub on sub.id = s.substrate_id
    left join public.spec_triage t on t.spec_id = s.id and t.is_current
    left join public.suppliers ts on ts.id = t.supplier_id
    left join public.library_records rc on rc.id = t.rate_card_id
    left join public.library_records bm on bm.id = s.branding_method_id
    left join public.library_records aql on aql.id = s.aql_level_id;

drop view if exists public.v_rfqs;
create view public.v_rfqs with (security_invoker = true) as
  select r.*, j.job_number, j.title as job_title, c.name as client_name,
         (select count(*) from public.rfq_invitations i where i.rfq_id = r.id)::int as invited_count,
         (select count(*) from public.rfq_responses q where q.rfq_id = r.id and q.status in ('submitted','awarded'))::int as quote_count,
         (select count(*) from public.rfq_invitations i where i.rfq_id = r.id and i.status = 'declined')::int as declined_count,
         (select count(*) from public.rfq_lines l where l.rfq_id = r.id)::int as line_count,
         ws.name as awarded_supplier_name,
         inc.code as incoterm_code,
         cf.rfq_number as copied_from_rfq_number,
         (select count(*) from public.rfq_invitations i where i.rfq_id = r.id and i.requote_needed)::int as requote_pending
    from public.rfqs r join public.jobs j on j.id = r.job_id join public.sourcing_clients c on c.id = j.client_id
    left join public.rfq_responses wr on wr.id = r.awarded_response_id
    left join public.suppliers ws on ws.id = wr.supplier_id
    left join public.library_records inc on inc.id = r.incoterm_id
    left join public.rfqs cf on cf.id = r.copied_from_rfq_id;

drop view if exists public.v_estimates;
create view public.v_estimates with (security_invoker = true) as
  select e.*, j.job_number, j.title as job_title, c.name as client_name, s.name as supplier_name, r.rfq_number,
         po.total as client_po_total, po.n as client_po_count,
         case when e.status = 'sent' then 'pending_estimate_approval'
              when e.status = 'approved' and (po.total + 0.005 >= e.sell_price or (po.n = 0 and coalesce(trim(e.client_order_ref), '') <> '')) then 'po_received'
              when e.status = 'approved' then 'po_pending' end as order_flag,
         inc.code as incoterm_code
    from public.estimates e join public.jobs j on j.id = e.job_id join public.sourcing_clients c on c.id = j.client_id
    join public.suppliers s on s.id = e.supplier_id left join public.rfqs r on r.id = e.rfq_id
    left join public.library_records inc on inc.id = e.incoterm_id
    cross join lateral (select coalesce(sum(cp.amount), 0) as total, count(*)::int as n from public.client_pos cp where cp.estimate_id = e.id) po;

-- One row per approved estimate: where its Stocktool hand-off stands and what data is missing.
create view public.v_sourcing_handoff with (security_invoker = true) as
  select e.id, e.estimate_number, e.job_id, j.job_number, j.title as job_title, c.name as client_name, e.currency, e.sell_price,
         e.approved_at, o.id as outbox_id, o.status as outbox_status, o.created_at as queued_at, o.sent_at,
         case when o.sent_at is not null then round((extract(epoch from (o.sent_at - e.approved_at)) / 86400.0)::numeric, 1) end as days_to_handoff,
         round((extract(epoch from (now() - e.approved_at)) / 86400.0)::numeric, 1) as days_since_approval,
         public._estimate_missing_fields(e.id) as missing_fields
    from public.estimates e join public.jobs j on j.id = e.job_id join public.sourcing_clients c on c.id = j.client_id
    left join lateral (select x.* from public.integration_outbox x where x.aggregate_id = e.id and x.event = 'estimate.approved'
                        order by x.created_at desc limit 1) o on true
   where e.status = 'approved';

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------
alter table public.spec_revisions enable row level security;
alter table public.rfq_line_delivery_points enable row level security;
alter table public.rfq_response_lines enable row level security;
alter table public.rfq_response_alternatives enable row level security;
alter table public.rfq_response_point_prices enable row level security;
alter table public.estimate_cost_lines enable row level security;
alter table public.client_pos enable row level security;

-- Internal staff read; vendors read nothing directly (only their own quote through rfq_vendor_view).
create policy specrev_read on public.spec_revisions for select to authenticated using (public.is_internal());
create policy rfqdp_read on public.rfq_line_delivery_points for select to authenticated using (public.is_internal());
create policy rfqrl_read on public.rfq_response_lines for select to authenticated using (public.is_internal());
create policy rfqra_read on public.rfq_response_alternatives for select to authenticated using (public.is_internal());
create policy rfqrpp_read on public.rfq_response_point_prices for select to authenticated using (public.is_internal());
create policy estcl_read on public.estimate_cost_lines for select to authenticated using (public.is_internal());
create policy clientpo_read on public.client_pos for select to authenticated using (public.is_internal());

revoke insert, update, delete on public.spec_revisions, public.rfq_line_delivery_points, public.rfq_response_lines,
  public.rfq_response_alternatives, public.rfq_response_point_prices, public.estimate_cost_lines, public.client_pos from authenticated, anon;
revoke insert, update, delete on public.v_specs, public.v_rfqs, public.v_estimates, public.v_sourcing_handoff from authenticated, anon;
grant select on public.v_specs, public.v_rfqs, public.v_estimates, public.v_sourcing_handoff to authenticated;

revoke execute on function public._incoterm_id(text), public._spec_snapshot(uuid), public._spec_ensure_revision(uuid, text),
  public._rfq_save_details(uuid, uuid, jsonb), public._estimate_handoff_payload(uuid)
  from public, anon, authenticated;
-- _rfq_write_lines / _rfq_save_prices keep the revoke from 20261011000002 (create or replace keeps privileges).
