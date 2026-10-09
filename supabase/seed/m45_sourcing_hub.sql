-- DUMMY DATA for the Sourcing Hub parity features (20261019000001_sourcing_hub_parity.sql), layered on the m40_sourcing rows.
-- Every value here is made up. Safe to run on a database that already has m40 data: updates target the seeded ids,
-- inserts skip rows that already exist.
select set_config('sourcing.system_write', 'on', false);

-- ---------------------------------------------------------------------------
-- Libraries: branding methods, AQL levels, incoterms
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from)
select v.key, v.code, v.name, v.data::jsonb, 'active', date '2026-01-01'
  from (values
    ('branding_methods', 'BM-SCREEN', 'Screen print', '{"process":"print","max_colours":6,"min_qty":100,"typical_substrates":["textile","paper","plastic"]}'),
    ('branding_methods', 'BM-DIGITAL', 'Digital print', '{"process":"print","max_colours":null,"min_qty":1,"typical_substrates":["paper","vinyl","textile"]}'),
    ('branding_methods', 'BM-OFFSET', 'Offset litho', '{"process":"print","max_colours":6,"min_qty":1000,"typical_substrates":["paper","board"]}'),
    ('branding_methods', 'BM-HEAT', 'Heat transfer', '{"process":"transfer","max_colours":null,"min_qty":50,"typical_substrates":["textile"]}'),
    ('branding_methods', 'BM-UV', 'UV print', '{"process":"print","max_colours":null,"min_qty":1,"typical_substrates":["plastic","metal","wood","glass"]}'),
    ('branding_methods', 'BM-PAD', 'Pad print', '{"process":"print","max_colours":4,"min_qty":250,"typical_substrates":["plastic","metal"]}'),
    ('branding_methods', 'BM-EMBOSS', 'Embossing', '{"process":"forming","max_colours":0,"min_qty":250,"typical_substrates":["paper","board","leather"]}'),
    ('branding_methods', 'BM-DEBOSS', 'Debossing', '{"process":"forming","max_colours":0,"min_qty":250,"typical_substrates":["paper","board","leather","silicone"]}'),
    ('branding_methods', 'BM-LASER', 'Laser engraving', '{"process":"engraving","max_colours":0,"min_qty":1,"typical_substrates":["metal","wood","glass"]}'),
    ('branding_methods', 'BM-EMBROID', 'Embroidery', '{"process":"stitching","max_colours":12,"min_qty":25,"typical_substrates":["textile"]}'),
    ('aql_levels', 'AQL-0.65', 'AQL 0.65 (critical items)', '{"inspection_level":"II","critical":0,"major":0.65,"minor":1.5}'),
    ('aql_levels', 'AQL-1.0', 'AQL 1.0 (strict)', '{"inspection_level":"II","critical":0,"major":1.0,"minor":2.5}'),
    ('aql_levels', 'AQL-1.5', 'AQL 1.5 (electronics)', '{"inspection_level":"II","critical":0,"major":1.5,"minor":4.0}'),
    ('aql_levels', 'AQL-2.5', 'AQL 2.5 (standard promo)', '{"inspection_level":"II","critical":0,"major":2.5,"minor":4.0}'),
    ('aql_levels', 'AQL-4.0', 'AQL 4.0 (low risk)', '{"inspection_level":"II","critical":0,"major":4.0,"minor":6.5}'),
    ('incoterms', 'DDP', 'Delivered Duty Paid', '{"risk_transfers":"At the named destination, cleared for import","seller_pays_freight":true,"seller_pays_duty":true,"needs_named_place":true,"default":true}'),
    ('incoterms', 'DAP', 'Delivered At Place', '{"risk_transfers":"At the named destination, before import clearance","seller_pays_freight":true,"seller_pays_duty":false,"needs_named_place":true}'),
    ('incoterms', 'FCA', 'Free Carrier', '{"risk_transfers":"When handed to our carrier at the named place","seller_pays_freight":false,"seller_pays_duty":false,"needs_named_place":true}'),
    ('incoterms', 'FOB', 'Free On Board', '{"risk_transfers":"On board the vessel at the named port","seller_pays_freight":false,"seller_pays_duty":false,"needs_named_place":true,"sea_only":true}'),
    ('incoterms', 'EXW', 'Ex Works', '{"risk_transfers":"At the supplier''s premises","seller_pays_freight":false,"seller_pays_duty":false,"needs_named_place":true}'),
    ('incoterms', 'CIF', 'Cost, Insurance and Freight', '{"risk_transfers":"On board at the port of shipment; seller pays freight and insurance to the named port","seller_pays_freight":true,"seller_pays_duty":false,"needs_named_place":true,"sea_only":true}')
  ) v(key, code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = v.key and r.code = v.code);

-- ---------------------------------------------------------------------------
-- Client commercial rules: GSC commission and year-end rebate
-- ---------------------------------------------------------------------------
update public.sourcing_clients set gsc_commission_percent = 2.5, year_end_rebate_percent = 1.5 where code = 'UL' and gsc_commission_percent = 0 and year_end_rebate_percent = 0;
update public.sourcing_clients set gsc_commission_percent = 2.0, year_end_rebate_percent = 1.0 where code = 'HNK' and gsc_commission_percent = 0 and year_end_rebate_percent = 0;
update public.sourcing_clients set gsc_commission_percent = 0, year_end_rebate_percent = 2.0 where code = 'CPL' and gsc_commission_percent = 0 and year_end_rebate_percent = 0;
update public.sourcing_clients set gsc_commission_percent = 3.0, year_end_rebate_percent = 0 where code = 'BAU' and gsc_commission_percent = 0 and year_end_rebate_percent = 0;

-- ---------------------------------------------------------------------------
-- Structured spec fields on the seeded specs
-- ---------------------------------------------------------------------------
-- Bar runner mat (promo, on the open RFQ "Bar runner mats"): full Promo & Merch detail.
update public.job_specs set spec_form = 'fixed', product_category = 'Bar accessories', product_sub_type = 'Bar runner', has_components = false,
  size_description = '600 x 250 mm, 5 mm corner radius', material = 'Nitrile rubber base, polyester fabric top', substrate_weight_gsm = 1800,
  branding_method_id = (select id from public.library_records where library_key = 'branding_methods' and code = 'BM-DIGITAL' and status = 'active'),
  life_expectancy = '12 months of daily bar use', finished_style = 'Flat, sealed edges', testing_checklist = '{pre_screen,lab_test,final_inspection}',
  aql_level_id = (select id from public.library_records where library_key = 'aql_levels' and code = 'AQL-2.5' and status = 'active'),
  units_per_inner = 10, units_per_outer = 50, carton_length_cm = 62, carton_width_cm = 27, carton_height_cm = 30, packing_method = 'Rolled in tens, polybag, 5 inners per carton',
  design_guidelines = 'Heineken brand book 2026; green PMS 356 C', end_market = 'Germany', reusable = true, number_of_uses = 300, designed_for_disassembly = false,
  recycled_content_percent = 20, origin_country = 'China', unit_of_measure = 'EA', selling_unit_qty = 1, moq = 250, net_weight_kg = 0.420, gross_weight_kg = 0.450
 where id = 'b5000000-0000-4000-8000-000000000012' and product_category is null;

-- Tet gift hamper: an ideation brief (loose spec, suppliers propose); no HS code yet, so it can't go to RFQ until one is added.
update public.job_specs set spec_form = 'ideation', product_category = 'Gifting', product_sub_type = 'Hamper', has_components = true,
  size_description = 'About 400 x 300 x 150 mm, holds four product packs', material = 'Kraft board or rattan: supplier to propose',
  branding_method_id = (select id from public.library_records where library_key = 'branding_methods' and code = 'BM-OFFSET' and status = 'active'),
  life_expectancy = 'Keepsake: reusable as a storage box', finished_style = 'Lidded box with ribbon', testing_checklist = '{pre_screen,drop_test,final_inspection}',
  aql_level_id = (select id from public.library_records where library_key = 'aql_levels' and code = 'AQL-2.5' and status = 'active'),
  units_per_outer = 10, packing_method = 'Flat-packed, assembled at the co-packer', design_guidelines = 'Knorr Tet key visual; red and gold, no plastic windows',
  end_market = 'Vietnam', reusable = true, number_of_uses = 10, designed_for_disassembly = true, recycled_content_percent = 60, unit_of_measure = 'EA', moq = 1000
 where id = 'b5000000-0000-4000-8000-000000000051' and product_category is null;
update public.job_specs set spec_form = 'open', product_category = 'Gifting', product_sub_type = 'Ribbon and tag'
 where id = 'b5000000-0000-4000-8000-000000000052' and product_category is null;

-- Clinic stand (3D, awarded): sustainability and Stocktool article data complete.
update public.job_specs set spec_form = 'fixed', product_category = 'Display', product_sub_type = 'Freestanding stand', has_components = true,
  testing_checklist = '{loading_test,final_inspection}', aql_level_id = (select id from public.library_records where library_key = 'aql_levels' and code = 'AQL-1.0' and status = 'active'),
  reusable = true, number_of_uses = 20, designed_for_disassembly = true, recycled_content_percent = 30, origin_country = 'United States',
  unit_of_measure = 'EA', selling_unit_qty = 1, moq = 25, net_weight_kg = 14.5, gross_weight_kg = 17.2, units_per_outer = 1,
  carton_length_cm = 200, carton_width_cm = 65, carton_height_cm = 20, packing_method = 'Flat-packed, one per carton'
 where id = 'b5000000-0000-4000-8000-000000000041' and product_category is null;

-- Flagship back-bar fixture (3D, draft RFQ): lighting and electronics.
update public.job_specs set spec_form = 'fixed', product_category = 'Fixture', product_sub_type = 'Back-bar unit', has_components = true,
  has_lighting_electronics = true, lighting_electronics_detail = 'LED strip 24 V with CE-marked driver, EU plug, 2 m lead', life_expectancy = '5 years',
  testing_checklist = '{pre_screen,full_inspection,loading_test,final_inspection}',
  aql_level_id = (select id from public.library_records where library_key = 'aql_levels' and code = 'AQL-1.5' and status = 'active'),
  origin_country = 'Germany', unit_of_measure = 'EA', designed_for_disassembly = true
 where id = 'b5000000-0000-4000-8000-000000000061' and product_category is null;

-- Dove wobbler (awarded): origin known, weights still missing (shows up on the hand-off dashboard).
update public.job_specs set spec_form = 'fixed', product_category = 'POS print', product_sub_type = 'Wobbler', origin_country = 'United Kingdom', unit_of_measure = 'EA', moq = 5000
 where id = 'b5000000-0000-4000-8000-000000000021' and product_category is null;

-- ---------------------------------------------------------------------------
-- Spec revisions: the bar runner mat changed after the RFQ went out (re-quote asked of the suppliers)
-- ---------------------------------------------------------------------------
select public._spec_ensure_revision(s.id, 'Sent on ' || r.rfq_number)
  from public.job_specs s join public.rfq_lines l on l.spec_id = s.id join public.rfqs r on r.id = l.rfq_id
 where s.id::text like 'b5000000-%' and r.id::text like 'd5000000-%' and r.status in ('sent','awarded');
update public.rfq_lines l set spec_revision = 1
 where l.id in ('d6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000004') and l.spec_revision is null;

update public.job_specs set size_description = '600 x 250 mm, 10 mm corner radius', revision = 2, revised_at = now() - interval '1 day'
 where id = 'b5000000-0000-4000-8000-000000000012' and revision = 1
   and exists (select 1 from public.spec_revisions where spec_id = 'b5000000-0000-4000-8000-000000000012' and revision = 1);
insert into public.spec_revisions (spec_id, revision, change_note, snapshot, created_at)
select s.id, 2, 'Corner radius increased to 10 mm (bar safety audit)', public._spec_snapshot(s.id), now() - interval '1 day'
  from public.job_specs s where s.id = 'b5000000-0000-4000-8000-000000000012' and s.revision = 2
on conflict (spec_id, revision) do nothing;

update public.rfqs set spec_changed = true, spec_changed_at = now() - interval '1 day'
 where id = 'd5000000-0000-4000-8000-000000000001' and status = 'sent' and not spec_changed;
update public.rfq_invitations i set requote_needed = (s.supplier_code <> 'DEMO-015'),
  requote_reason = '"Bar runner mat" changed to revision 2: Corner radius increased to 10 mm (bar safety audit)',
  requoted_at = case when s.supplier_code = 'DEMO-015' then now() - interval '6 hours' end
  from public.suppliers s
 where s.id = i.supplier_id and i.rfq_id = 'd5000000-0000-4000-8000-000000000001' and i.status <> 'declined' and i.requote_reason is null;

-- ---------------------------------------------------------------------------
-- RFQ terms: incoterms, run-on, delivery date, delivery points, more quantity breaks
-- ---------------------------------------------------------------------------
update public.rfqs set incoterm_id = (select id from public.library_records where library_key = 'incoterms' and code = 'DDP' and status = 'active'), incoterm_place = 'Berlin and Munich DCs'
 where id = 'd5000000-0000-4000-8000-000000000001' and incoterm_id is null;
update public.rfqs set incoterm_id = (select id from public.library_records where library_key = 'incoterms' and code = 'DDP' and status = 'active'), incoterm_place = 'Unilever UK DC, Leeds'
 where id = 'd5000000-0000-4000-8000-000000000002' and incoterm_id is null;
update public.rfqs set incoterm_id = (select id from public.library_records where library_key = 'incoterms' and code = 'DAP' and status = 'active'), incoterm_place = 'Amsterdam'
 where id = 'd5000000-0000-4000-8000-000000000006' and incoterm_id is null;

update public.rfq_lines set run_on_quantity = 100, delivery_date = current_date + 40
 where id = 'd6000000-0000-4000-8000-000000000001' and run_on_quantity is null;
-- The flagship fixture draft asks for seven price points (more than the old limit of six).
update public.rfq_lines set quantity_breaks = array[6,8,10,12,15,20,25], run_on_quantity = 5, delivery_date = current_date + 75,
  incoterm_id = (select id from public.library_records where library_key = 'incoterms' and code = 'FCA' and status = 'active')
 where id = 'd6000000-0000-4000-8000-000000000006' and cardinality(quantity_breaks) = 2
   and exists (select 1 from public.rfqs where id = 'd5000000-0000-4000-8000-000000000006' and status = 'draft');

insert into public.rfq_line_delivery_points (id, line_id, point_no, label, address, country, quantity, delivery_date)
select v.id::uuid, v.line::uuid, v.no, v.label, v.address, v.country, v.qty, current_date + v.days
  from (values
    ('d8000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', 1, 'Berlin DC', 'Logistikpark 4, Berlin', 'Germany', 300, 38),
    ('d8000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000001', 2, 'Munich DC', 'Industriestrasse 12, Munich', 'Germany', 200, 40)
  ) v(id, line, no, label, address, country, qty, days)
 where exists (select 1 from public.rfq_lines where id = v.line::uuid)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Vendor quote details, alternatives and delivery-point prices (sealed; internal staff see them after bidding closes)
-- ---------------------------------------------------------------------------
insert into public.rfq_response_lines (response_id, line_id, lead_time_days, carton_length_cm, carton_width_cm, carton_height_cm, units_per_carton,
  gross_weight_kg, net_weight_kg, hs_code, country_of_origin, run_on_price, sample_cost, sample_lead_time_days, recycled_content_percent, reusable, number_of_uses, notes)
select v.resp::uuid, v.line::uuid, v.lead, v.cl, v.cw, v.ch, v.upc, v.gw, v.nw, v.hs, v.origin, v.runon, v.sample, v.sample_days, v.rec, v.reuse, v.uses, v.notes
  from (values
    ('d7000000-0000-4000-8000-000000000011', 'd6000000-0000-4000-8000-000000000001', 14, 62.0, 27.0, 30.0, 50, 0.450, 0.420, '4016.91', 'China', 560.00, 45.00, 7, 20.0, true, 300, 'Price includes 10 mm corner radius (revision 2)'),
    ('d7000000-0000-4000-8000-000000000012', 'd6000000-0000-4000-8000-000000000001', 18, 60.0, 30.0, 28.0, 40, 0.470, 0.430, '4016.91', 'Vietnam', 600.00, 60.00, 10, 0.0, true, 250, null),
    ('d7000000-0000-4000-8000-000000000022', 'd6000000-0000-4000-8000-000000000002', 10, 40.0, 30.0, 25.0, 1000, null, null, '4911.10', 'United Kingdom', null, 0, 3, 85.0, false, null, null),
    ('d7000000-0000-4000-8000-000000000041', 'd6000000-0000-4000-8000-000000000004', 21, 200.0, 65.0, 20.0, 1, 17.200, 14.500, '9403.60', 'United States', null, 150.00, 10, 30.0, true, 20, null)
  ) v(resp, line, lead, cl, cw, ch, upc, gw, nw, hs, origin, runon, sample, sample_days, rec, reuse, uses, notes)
 where exists (select 1 from public.rfq_responses where id = v.resp::uuid) and exists (select 1 from public.rfq_lines where id = v.line::uuid)
on conflict do nothing;

insert into public.rfq_response_alternatives (response_id, line_id, alt_no, description, quantity, unit_price, lead_time_days)
select 'd7000000-0000-4000-8000-000000000011', 'd6000000-0000-4000-8000-000000000001', 1,
       'Recycled rubber backing (60% recycled), same top fabric', 500, 5.95, 18
 where exists (select 1 from public.rfq_responses where id = 'd7000000-0000-4000-8000-000000000011')
on conflict do nothing;

insert into public.rfq_response_point_prices (response_id, delivery_point_id, quantity, unit_price)
select v.resp::uuid, v.dp::uuid, v.qty, v.price
  from (values
    ('d7000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000001', 300, 6.15),
    ('d7000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000002', 200, 6.30)
  ) v(resp, dp, qty, price)
 where exists (select 1 from public.rfq_line_delivery_points where id = v.dp::uuid) and exists (select 1 from public.rfq_responses where id = v.resp::uuid)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Estimates: cost split and commission on the draft, client POs on the approved ones, hand-off data
-- ---------------------------------------------------------------------------
insert into public.estimate_cost_lines (estimate_id, category, description, amount, sort)
select v.est::uuid, v.cat, v.descr, v.amount, v.sort
  from (values
    ('e5000000-0000-4000-8000-000000000003', 'logistics', 'Freight to the Orchard Road store', 120.00, 1),
    ('e5000000-0000-4000-8000-000000000003', 'inspection', 'Pre-shipment colour check', 80.00, 2)
  ) v(est, cat, descr, amount, sort)
 where exists (select 1 from public.estimates where id = v.est::uuid and status = 'draft')
   and not exists (select 1 from public.estimate_cost_lines c where c.estimate_id = v.est::uuid);
update public.estimates e set additional_cost = x.total, gsc_commission_percent = 3.0
  from (select estimate_id, sum(amount) total from public.estimate_cost_lines where estimate_id = 'e5000000-0000-4000-8000-000000000003' group by estimate_id) x
 where e.id = x.estimate_id and e.status = 'draft' and e.additional_cost = 0;

insert into public.client_pos (estimate_id, po_number, amount, currency, po_date)
select e.id, v.po, least(v.amount, e.sell_price), e.currency, current_date - v.days
  from (values
    ('e5000000-0000-4000-8000-000000000002', 'UL-PO-44821', 3000.00, 7),
    ('e5000000-0000-4000-8000-000000000002', 'UL-PO-44907', 2000.00, 3),
    ('e5000000-0000-4000-8000-000000000004', 'CPL-77310', 1000000.00, 18)
  ) v(est, po, amount, days)
  join public.estimates e on e.id = v.est::uuid and e.status = 'approved'
on conflict (estimate_id, po_number) do nothing;

update public.estimates set port_of_loading = 'Felixstowe', forwarder = 'DemoFreight UK', consignee = 'Unilever UK DC (demo)', hub = 'UK hub'
 where id = 'e5000000-0000-4000-8000-000000000002' and port_of_loading is null;
update public.estimates set forwarder = 'DemoFreight US', consignee = 'Coloplast clinic network (demo)', hub = 'US hub'
 where id = 'e5000000-0000-4000-8000-000000000004' and forwarder is null;

-- The Coloplast hand-off went to Stocktool two days after approval; the Unilever one is waiting (weights missing).
update public.integration_outbox o set sent_at = e.approved_at + interval '2 days'
  from public.estimates e
 where e.id = o.aggregate_id and o.event = 'estimate.approved' and o.status = 'sent' and o.sent_at is null and o.aggregate_id::text like 'e5000000-%';
update public.integration_outbox set payload = public._estimate_handoff_payload(aggregate_id) || jsonb_build_object('demo', true)
 where event = 'estimate.approved' and status = 'queued' and aggregate_id = 'e5000000-0000-4000-8000-000000000002' and not (payload ? 'missing_fields');

-- Activity trail for the new steps.
insert into public.sourcing_events (job_id, entity, entity_id, event, detail, at)
select v.job::uuid, v.entity, v.eid::uuid, v.event, v.detail::jsonb || '{"demo":true}'::jsonb, now() - v.ago::interval
  from (values
    ('a5000000-0000-4000-8000-000000000001', 'spec', 'b5000000-0000-4000-8000-000000000012', 'revised', '{"revision":2,"note":"Corner radius increased to 10 mm (bar safety audit)"}', '1 day'),
    ('a5000000-0000-4000-8000-000000000001', 'rfq', 'd5000000-0000-4000-8000-000000000001', 'requote_requested', '{"spec":"Bar runner mat","revision":2}', '1 day'),
    ('a5000000-0000-4000-8000-000000000001', 'rfq', 'd5000000-0000-4000-8000-000000000001', 'requote_submitted', '{"source":"vendor_portal"}', '6 hours'),
    ('a5000000-0000-4000-8000-000000000002', 'estimate', 'e5000000-0000-4000-8000-000000000002', 'client_po_added', '{"po_number":"UL-PO-44907","amount":2000}', '3 days')
  ) v(job, entity, eid, event, detail, ago)
 where exists (select 1 from public.jobs where id = v.job::uuid)
   and not exists (select 1 from public.sourcing_events se where se.entity_id = v.eid::uuid and se.event = v.event);

select set_config('sourcing.system_write', 'off', false);
