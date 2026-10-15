-- DUMMY DATA: vendor technical & packaging data sheets (migration 20261029000001). Every figure here is made up.
-- Packaging materials library, the requirement matrix, tolerance settings, and sheets in every state on the seeded
-- specs / POs: a quote-stage draft with a "to be confirmed by" date, one declared complete, one verified, one mismatch
-- on weight, one EU line missing packaging weights by material, and a draft on a PO waiting for the vendor.
-- Written as the system (no signed-in user). Safe to re-run: everything is guarded by "not exists".

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'packaging_materials', x.code, x.name, x.data::jsonb, 'active', date '2026-01-01', 'Demo packaging material'
  from (values
    ('PM-CORR-SW', 'Corrugated board, single wall', '{"material_group":"paper","epr_category":"Paper and board","default_recycled_pct":80,"recyclable":true,"emission_factor_code":"MEF-CORR"}'),
    ('PM-CORR-DW', 'Corrugated board, double wall', '{"material_group":"paper","epr_category":"Paper and board","default_recycled_pct":75,"recyclable":true,"emission_factor_code":"MEF-CORR"}'),
    ('PM-PAPERBOARD', 'Paperboard (folding carton, tube)', '{"material_group":"paper","epr_category":"Paper and board","default_recycled_pct":60,"recyclable":true,"emission_factor_code":"MEF-BOARD-V","recycled_factor_code":"MEF-BOARD-R"}'),
    ('PM-KRAFT', 'Kraft paper', '{"material_group":"paper","epr_category":"Paper and board","default_recycled_pct":100,"recyclable":true,"emission_factor_code":"MEF-PAPER"}'),
    ('PM-PAPER-FILL', 'Paper void fill', '{"material_group":"paper","epr_category":"Paper and board","default_recycled_pct":100,"recyclable":true,"emission_factor_code":"MEF-PAPER"}'),
    ('PM-LDPE', 'LDPE film or bag', '{"material_group":"plastic","epr_category":"Plastic","default_recycled_pct":0,"recyclable":true}'),
    ('PM-STRETCH', 'Stretch wrap (LLDPE)', '{"material_group":"plastic","epr_category":"Plastic","default_recycled_pct":30,"recyclable":true}'),
    ('PM-PET', 'PET (clear tray or window)', '{"material_group":"plastic","epr_category":"Plastic","default_recycled_pct":50,"recyclable":true}'),
    ('PM-PP-STRAP', 'PP strapping', '{"material_group":"plastic","epr_category":"Plastic","default_recycled_pct":0,"recyclable":true}'),
    ('PM-EPS', 'Expanded polystyrene corners', '{"material_group":"plastic","epr_category":"Plastic","default_recycled_pct":0,"recyclable":false}'),
    ('PM-WOOD-PALLET', 'Wood pallet', '{"material_group":"wood","epr_category":"Wood","default_recycled_pct":0,"recyclable":true,"reusable_by_default":true,"emission_factor_code":"MEF-WOOD"}'),
    ('PM-LABEL', 'Paper label', '{"material_group":"paper","epr_category":"Paper and board","default_recycled_pct":0,"recyclable":true,"emission_factor_code":"MEF-PAPER"}')
  ) x(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'packaging_materials' and r.code = x.code);

insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'tech_sheet_requirements', x.code, x.name, x.data::jsonb, 'active', date '2026-01-01', 'Demo requirement'
  from (values
    ('TSR-QUOTE', 'Proposed packing at quote', '{"stage":"quote","fields":["units_per_carton","carton_dims","packing_method"],"explanation":"At quote stage we need the proposed packing so freight can be estimated. If it is not known yet, give a date it will be confirmed by."}'),
    ('TSR-PO-BASE', 'As-built basics at PO acceptance', '{"stage":"po_acceptance","fields":["product_dims","net_weight","materials","origin_country","hs_code","units_per_carton","carton_dims","carton_gross_weight","carton_marking"],"explanation":"Once the order is accepted we need the item as it will be built and the carton it ships in: Stocktool, customs and freight all use these."}'),
    ('TSR-PRE-PALLET', 'Shipping unit before pre-shipment', '{"stage":"pre_shipment","fields":["pallet","pallet_config","pallet_gross_weight","max_stack"],"explanation":"Before the pre-shipment check we need the shipping unit: the pallet (or no pallet), how cartons are stacked and the full pallet weight."}'),
    ('TSR-L3-PACK', 'Unit pack and finishes at L3 and above', '{"stage":"po_acceptance","min_level":3,"fields":["primary_pack","primary_materials","protective_fill","finishes","components"],"explanation":"Orders at QA/QC level L3 or above are checked against the unit pack, finishes and components, so they must be declared."}'),
    ('TSR-ELEC', 'Electrical parts and batteries', '{"stage":"po_acceptance","electronics":true,"fields":["electrical"],"explanation":"Items with lighting or electronics must declare the electrical parts and any batteries (transport and safety rules)."}'),
    ('TSR-3D', 'Displays and fixtures', '{"stage":"po_acceptance","spec_types":["3d"],"fields":["components","max_stack"],"explanation":"Displays and fixtures list their parts and how high cartons can be stacked."}'),
    ('TSR-PROMO', 'Promo and merchandise materials', '{"stage":"po_acceptance","spec_types":["promo_merch"],"fields":["materials_weight","materials_recycled"],"explanation":"Promo and merchandise items declare the weight and recycled content of each material for sustainability reporting."}'),
    ('TSR-EPR-EU-UK', 'Packaging by material for the EU and UK', '{"stage":"po_acceptance","markets":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","GB"],"fields":["materials_recycled","primary_materials","primary_material_weights","primary_recycled","carton_materials","carton_material_weights","carton_recycled","pallet_materials","pallet_material_weights","pallet_recycled","reusable_packaging"],"explanation":"Goods for the EU or UK fall under packaging rules (EPR and the EU packaging regulation): we report packaging weight by material, recycled content and reuse for every level."}')
  ) x(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'tech_sheet_requirements' and r.code = x.code);

insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'qaqc_settings', x.code, x.name, x.data::jsonb, 'active', date '2026-01-01', 'Demo tolerance (technical & packaging data sheet)'
  from (values
    ('TECH-WEIGHT-TOL-PCT', 'Data sheet check: carton weight tolerance (%)', '{"value":5}'),
    ('TECH-DIM-TOL-MM', 'Data sheet check: carton size tolerance (mm per side)', '{"value":10}')
  ) x(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'qaqc_settings' and r.code = x.code);

-- ---------------------------------------------------------------------------
-- Sheets
-- ---------------------------------------------------------------------------
do $$
declare v_sheet uuid; v_sup uuid; v_spec uuid; v_line uuid; v_resp uuid; v_po uuid; c public.qaqc_checkpoints; v_m uuid; v_cmp jsonb; s public.job_specs;
begin
  -- 1. Quote-stage draft with a "to be confirmed by" date: Northbrew bar runner mat, open RFQ, quote from DEMO-015.
  select l.id, l.spec_id, q.id, q.supplier_id into v_line, v_spec, v_resp, v_sup
    from public.rfq_lines l join public.rfq_responses q on q.rfq_id = l.rfq_id join public.suppliers su on su.id = q.supplier_id
   where l.rfq_id = 'd5000000-0000-4000-8000-000000000001' and su.supplier_code = 'DEMO-015' limit 1;
  if v_spec is not null and not exists (select 1 from public.spec_tech_sheets where spec_id = v_spec and supplier_id = v_sup) then
    v_sheet := public._tech_sheet_ensure(v_spec, null, v_sup, 'quote', null, v_line, v_resp);
    perform public._tech_sheet_save(v_sheet, jsonb_build_object('packing_method', 'Rolled in tens, one poly bag per ten', 'tbc_by', current_date + 7,
      'tbc_note', 'Carton gross weight and packaging materials once the pre-production sample is packed',
      'packs', jsonb_build_array(jsonb_build_object('level', 'secondary', 'units_per_pack', 50, 'length_mm', 600, 'width_mm', 400, 'height_mm', 300))), false, true);
  end if;

  -- 2. Declared complete: window clings for Wei Chen (DEMO-001), PO-2026-00003 (Singapore, QA/QC L3).
  v_po := 'f5000000-0000-4000-8000-000000000050'; v_spec := 'b5000000-0000-4000-8000-000000000032';
  select supplier_id into v_sup from public.purchase_orders where id = v_po;
  if v_sup is not null and exists (select 1 from public.job_specs where id = v_spec) and not exists (select 1 from public.spec_tech_sheets where spec_id = v_spec and supplier_id = v_sup) then
    v_sheet := public._tech_sheet_ensure(v_spec, null, v_sup, 'po', v_po, null, null);
    perform public._tech_sheet_save(v_sheet, jsonb_build_object(
      'length_mm', 600, 'width_mm', 400, 'height_mm', 0.2, 'net_weight_g', 35, 'finishes', 'Reverse printed 4/0 CMYK on static cling',
      'components_note', 'Cling and backing liner', 'has_electrical', false, 'has_battery', false, 'origin_country', 'Malaysia', 'hs_code', '3919.90',
      'packing_method', 'Rolled in tens around a card core, in a tube',
      'materials', jsonb_build_array(jsonb_build_object('substrate_code', 'SUB-VINYL', 'share_pct', 100, 'weight_g', 35, 'recycled_pct', 0)),
      'packs', jsonb_build_array(
        jsonb_build_object('level', 'primary', 'description', 'Kraft sleeve per cling', 'length_mm', 610, 'width_mm', 410, 'height_mm', 1, 'units_per_pack', 1, 'protective_fill', 'None',
          'materials', jsonb_build_array(jsonb_build_object('material_code', 'PM-KRAFT', 'component', 'Sleeve', 'weight_g', 8, 'recycled_pct', 100, 'reusable', false))),
        jsonb_build_object('level', 'secondary', 'description', 'Postal tube', 'units_per_pack', 60, 'length_mm', 650, 'width_mm', 120, 'height_mm', 120, 'gross_weight_kg', 2.6,
          'max_stack', 8, 'labelling', 'PO number, SKU and quantity on the tube end',
          'materials', jsonb_build_array(jsonb_build_object('material_code', 'PM-PAPERBOARD', 'component', 'Tube and end caps', 'weight_g', 180, 'recycled_pct', 90, 'reusable', false))),
        jsonb_build_object('level', 'tertiary', 'not_used', true, 'description', 'Ships by courier, no pallet'))), true, true);
    update public.spec_tech_sheets set declared_at = now() - interval '2 days' where id = v_sheet;
  end if;

  -- 3. Verified: Northbrew gondola end displays (DEMO-024), PO-2026-00008, measured at the pre-shipment inspection.
  v_po := 'f9000000-0000-4000-8000-000000000001'; v_spec := 'b9000000-0000-4000-8000-000000000011';
  select supplier_id into v_sup from public.purchase_orders where id = v_po;
  if v_sup is not null and exists (select 1 from public.job_specs where id = v_spec) and not exists (select 1 from public.spec_tech_sheets where spec_id = v_spec and supplier_id = v_sup) then
    v_sheet := public._tech_sheet_ensure(v_spec, null, v_sup, 'po', v_po, null, null);
    perform public._tech_sheet_save(v_sheet, jsonb_build_object(
      'length_mm', 1800, 'width_mm', 900, 'height_mm', 400, 'net_weight_g', 18500, 'finishes', 'Printed graphics with matt laminate; edges painted black',
      'components_note', 'Carcass, header, three shelves, fixings pack', 'has_electrical', false, 'has_battery', false, 'origin_country', 'Poland', 'hs_code', '9403.60',
      'packing_method', 'Flat-packed, one display per carton',
      'materials', jsonb_build_array(
        jsonb_build_object('substrate_code', 'SUB-PINEPLY', 'share_pct', 70, 'weight_g', 12950, 'recycled_pct', 0),
        jsonb_build_object('substrate_code', 'SUB-ACRYL3', 'share_pct', 10, 'weight_g', 1850, 'recycled_pct', 0),
        jsonb_build_object('substrate_code', 'SUB-FBB350', 'share_pct', 20, 'weight_g', 3700, 'recycled_pct', 0)),
      'packs', jsonb_build_array(
        jsonb_build_object('level', 'primary', 'not_used', true),
        jsonb_build_object('level', 'secondary', 'units_per_pack', 1, 'length_mm', 1850, 'width_mm', 950, 'height_mm', 180, 'gross_weight_kg', 21.5, 'max_stack', 6,
          'labelling', 'PO number, SKU, "this way up" and gross weight on two sides', 'protective_fill', 'Corner protectors and paper void fill',
          'materials', jsonb_build_array(
            jsonb_build_object('material_code', 'PM-CORR-DW', 'component', 'Outer carton', 'weight_g', 2400, 'recycled_pct', 75, 'reusable', false),
            jsonb_build_object('material_code', 'PM-PAPER-FILL', 'component', 'Void fill', 'weight_g', 300, 'recycled_pct', 100, 'reusable', false),
            jsonb_build_object('material_code', 'PM-LDPE', 'component', 'Fixings bag', 'weight_g', 20, 'recycled_pct', 0, 'reusable', false))),
        jsonb_build_object('level', 'tertiary', 'pallet_type', 'Block pallet', 'length_mm', 2000, 'width_mm', 1000, 'height_mm', 150, 'cartons_per_layer', 1, 'layers', 6,
          'gross_weight_kg', 160, 'max_stack', 1,
          'materials', jsonb_build_array(
            jsonb_build_object('material_code', 'PM-WOOD-PALLET', 'component', 'Pallet', 'weight_g', 25000, 'recycled_pct', 0, 'reusable', true),
            jsonb_build_object('material_code', 'PM-STRETCH', 'component', 'Stretch wrap', 'weight_g', 400, 'recycled_pct', 30, 'reusable', false))))), true, true);
    update public.spec_tech_sheets set declared_at = now() - interval '24 days' where id = v_sheet;
    select ck.* into c from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id where pl.po_id = v_po and ck.checkpoint = 'pre_shipment' limit 1;
    if c.id is not null then
      insert into public.spec_tech_sheet_measures (sheet_id, checkpoint_id, submission_no, gross_weight_kg, length_mm, width_mm, height_mm, by_vendor, at)
      values (v_sheet, c.id, greatest(c.submission_count, 1), 21.9, 1848, 952, 182, false, coalesce(c.submitted_at, now() - interval '15 days')) returning id into v_m;
      v_cmp := public._tech_compare(v_m);
      update public.spec_tech_sheet_measures set within_tolerance = true, comparisons = v_cmp where id = v_m;
      update public.spec_tech_sheets set status = 'verified', actual_gross_weight_kg = 21.9, actual_length_mm = 1848, actual_width_mm = 952, actual_height_mm = 182,
        measured_at = coalesce(c.submitted_at, now() - interval '15 days'), verified_at = coalesce(c.submitted_at, now() - interval '15 days'), verification = v_cmp, checkpoint_id = c.id
       where id = v_sheet;
      update public.qaqc_checkpoints set checks = checks || jsonb_build_object('code', 'tech_sheet', 'label', 'Packed carton matches the declared data sheet',
        'ok', true, 'hard', false, 'detail', 'Within tolerance: ' || (select string_agg(x->>'detail', '; ') from jsonb_array_elements(v_cmp) x)) where id = c.id;
      select * into s from public.job_specs where id = v_spec;
      insert into public.spec_tech_library (sheet_id, spec_id, spec_version_id, supplier_id, title_key, spec_type, product_category, substrate_id, verified_at)
      values (v_sheet, v_spec, null, v_sup, lower(trim(s.title)), s.spec_type, s.product_category, s.substrate_id, now() - interval '15 days') on conflict do nothing;
      perform public._tech_sheet_event(v_sheet, 'verified', jsonb_build_object('checkpoint_id', c.id, 'comparisons', v_cmp), false, false);
    end if;
  end if;

  -- 4. Mismatch on weight: Carewell freestanding clinic stands (DEMO-024), PO-2026-00002: the packed carton weighs 14% more than declared.
  v_po := 'f5000000-0000-4000-8000-000000000004'; v_spec := 'b5000000-0000-4000-8000-000000000041';
  select supplier_id into v_sup from public.purchase_orders where id = v_po;
  if v_sup is not null and exists (select 1 from public.job_specs where id = v_spec) and not exists (select 1 from public.spec_tech_sheets where spec_id = v_spec and supplier_id = v_sup) then
    v_sheet := public._tech_sheet_ensure(v_spec, null, v_sup, 'po', v_po, null, null);
    perform public._tech_sheet_save(v_sheet, jsonb_build_object(
      'length_mm', 1600, 'width_mm', 500, 'height_mm', 400, 'net_weight_g', 14200, 'finishes', 'Painted white; printed acrylic fascia',
      'components_note', 'Carcass, fascia, three leaflet holders, outer carton', 'has_electrical', false, 'has_battery', false, 'origin_country', 'Vietnam', 'hs_code', '9403.60',
      'packing_method', 'One stand per carton, flat-packed',
      'materials', jsonb_build_array(
        jsonb_build_object('substrate_code', 'SUB-PINEPLY', 'share_pct', 85, 'weight_g', 12070, 'recycled_pct', 0),
        jsonb_build_object('substrate_code', 'SUB-ACRYL3', 'share_pct', 15, 'weight_g', 2130, 'recycled_pct', 0)),
      'packs', jsonb_build_array(
        jsonb_build_object('level', 'primary', 'not_used', true),
        jsonb_build_object('level', 'secondary', 'units_per_pack', 1, 'length_mm', 1650, 'width_mm', 550, 'height_mm', 200, 'gross_weight_kg', 17.0, 'max_stack', 5,
          'labelling', 'PO number, SKU and handling marks', 'protective_fill', 'EPS corners',
          'materials', jsonb_build_array(
            jsonb_build_object('material_code', 'PM-CORR-DW', 'component', 'Outer carton', 'weight_g', 2100, 'recycled_pct', 70, 'reusable', false),
            jsonb_build_object('material_code', 'PM-EPS', 'component', 'Corners', 'weight_g', 250, 'recycled_pct', 0, 'reusable', false))),
        jsonb_build_object('level', 'tertiary', 'pallet_type', 'Block pallet', 'length_mm', 1800, 'width_mm', 1200, 'height_mm', 150, 'cartons_per_layer', 2, 'layers', 5,
          'gross_weight_kg', 200, 'max_stack', 1,
          'materials', jsonb_build_array(
            jsonb_build_object('material_code', 'PM-WOOD-PALLET', 'component', 'Pallet', 'weight_g', 22000, 'recycled_pct', 0, 'reusable', true),
            jsonb_build_object('material_code', 'PM-STRETCH', 'component', 'Stretch wrap', 'weight_g', 350, 'recycled_pct', 30, 'reusable', false))))), true, true);
    update public.spec_tech_sheets set declared_at = now() - interval '9 days' where id = v_sheet;
    select ck.* into c from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id where pl.po_id = v_po and ck.checkpoint = 'pre_shipment' limit 1;
    if c.id is not null then
      insert into public.spec_tech_sheet_measures (sheet_id, checkpoint_id, submission_no, gross_weight_kg, length_mm, width_mm, height_mm, by_vendor, at)
      values (v_sheet, c.id, greatest(c.submission_count, 1), 19.4, 1652, 548, 203, true, coalesce(c.submitted_at, now() - interval '2 days')) returning id into v_m;
      v_cmp := public._tech_compare(v_m);
      update public.spec_tech_sheet_measures set within_tolerance = false, comparisons = v_cmp where id = v_m;
      update public.spec_tech_sheets set status = 'mismatch', actual_gross_weight_kg = 19.4, actual_length_mm = 1652, actual_width_mm = 548, actual_height_mm = 203,
        measured_at = coalesce(c.submitted_at, now() - interval '2 days'), mismatch_at = coalesce(c.submitted_at, now() - interval '2 days'), verification = v_cmp, checkpoint_id = c.id
       where id = v_sheet;
      update public.qaqc_checkpoints set checks = checks || jsonb_build_object('code', 'tech_sheet', 'label', 'Packed carton matches the declared data sheet',
        'ok', false, 'hard', false, 'detail', 'Mismatch: ' || (select string_agg(x->>'detail', '; ') from jsonb_array_elements(v_cmp) x where not (x->>'ok')::boolean)) where id = c.id;
      perform public._tech_sheet_event(v_sheet, 'mismatch', jsonb_build_object('checkpoint_id', c.id, 'comparisons', v_cmp), false, true);
    end if;
  end if;

  -- 5. EU line missing packaging weights by material: Halden gift pack sleeves (DEMO-015), PO-2026-00009, Netherlands.
  v_po := 'f9000000-0000-4000-8000-000000000003'; v_spec := 'b9000000-0000-4000-8000-000000000021';
  select supplier_id into v_sup from public.purchase_orders where id = v_po;
  if v_sup is not null and exists (select 1 from public.job_specs where id = v_spec) and not exists (select 1 from public.spec_tech_sheets where spec_id = v_spec and supplier_id = v_sup) then
    v_sheet := public._tech_sheet_ensure(v_spec, null, v_sup, 'po', v_po, null, null);
    perform public._tech_sheet_save(v_sheet, jsonb_build_object(
      'length_mm', 300, 'width_mm', 210, 'height_mm', 0.4, 'net_weight_g', 12, 'origin_country', 'Netherlands', 'hs_code', '4819.20',
      'packing_method', 'Flat, banded in hundreds',
      'materials', jsonb_build_array(jsonb_build_object('substrate_code', 'SUB-FBB350', 'share_pct', 100, 'weight_g', 12)),
      'packs', jsonb_build_array(
        jsonb_build_object('level', 'primary', 'not_used', true),
        jsonb_build_object('level', 'secondary', 'units_per_pack', 500, 'length_mm', 320, 'width_mm', 230, 'height_mm', 220, 'gross_weight_kg', 6.6,
          'labelling', 'SKU and quantity label', 'materials', jsonb_build_array(jsonb_build_object('material_code', 'PM-CORR-SW', 'component', 'Outer carton'))),
        jsonb_build_object('level', 'tertiary', 'pallet_type', 'EUR pallet', 'length_mm', 1200, 'width_mm', 800, 'height_mm', 144, 'cartons_per_layer', 12, 'layers', 4,
          'gross_weight_kg', 340, 'max_stack', 2, 'materials', jsonb_build_array(jsonb_build_object('material_code', 'PM-WOOD-PALLET', 'component', 'Pallet'))))), true, true);
    update public.spec_tech_sheets set declared_at = now() - interval '60 days' where id = v_sheet;
  end if;

  -- 6. Draft on a PO waiting for the vendor: opening day posters (DEMO-030), PO-2026-00007.
  v_po := 'f5000000-0000-4000-8000-000000000003'; v_spec := 'b5000000-0000-4000-8000-000000000031';
  select supplier_id into v_sup from public.purchase_orders where id = v_po;
  if v_sup is not null and exists (select 1 from public.job_specs where id = v_spec) and not exists (select 1 from public.spec_tech_sheets where spec_id = v_spec and supplier_id = v_sup) then
    v_sheet := public._tech_sheet_ensure(v_spec, null, v_sup, 'po', v_po, null, null);
    perform public._tech_sheet_save(v_sheet, jsonb_build_object('hs_code', '4911.10'), false, false);
  end if;
end $$;
