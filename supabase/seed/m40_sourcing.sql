-- DUMMY DATA for Sourcing+, RFQ+ and Order Management+. Every client, job, price and person here is made up.
-- Loaded after demo_data.sql and m10_watchtower.sql (substrates, control matrix, DOA levels, bypass reasons come from there).
-- Rows are written directly (as the seed runs before any user exists); the app's own writes go through the checked functions.
select set_config('sourcing.system_write', 'on', false);

-- ---------------------------------------------------------------------------
-- Sourcing+ access for the demo users (applied automatically when each person's profile is created)
-- ---------------------------------------------------------------------------
insert into public.sourcing_access_invites (email, is_lead, is_finance, doa_level) values
  ('ada.admin@adm-indicia.com', true, false, 5),
  ('lena.lead@adm-indicia.com', true, false, 2),
  ('arjun.agent@adm-indicia.com', false, false, 0),
  ('fiona.finance@adm-indicia.com', false, true, null),
  ('pedro.procurement@adm-indicia.com', false, false, 1),
  ('hana.head@adm-indicia.com', true, false, 4)
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Clients (commercial rules) and billing entities
-- ---------------------------------------------------------------------------
insert into public.sourcing_clients (id, code, name, default_currency, default_markup_percent, savings_target_percent, quote_tolerance_percent, min_quotes_required, e_tender_threshold) values
  ('c5000000-0000-4000-8000-000000000001', 'UL',  'Unilever (demo)',  'GBP', 15, 5, 10, 3, 55000),
  ('c5000000-0000-4000-8000-000000000002', 'HNK', 'Heineken (demo)',  'EUR', 14, 6, 15, 3, 50000),
  ('c5000000-0000-4000-8000-000000000003', 'CPL', 'Coloplast (demo)', 'EUR', 12, 4, null, 2, 40000),
  ('c5000000-0000-4000-8000-000000000004', 'BAU', 'BAU clients (demo)', 'EUR', 18, 3, null, 3, null)
on conflict (code) do nothing;

insert into public.sourcing_billing_entities (id, code, name, region, market, vat_number, currency) values
  ('c6000000-0000-4000-8000-000000000001', 'BE-UK', 'adm Indicia UK Ltd (demo)', 'EMEA', 'United Kingdom', 'GB000000000', 'GBP'),
  ('c6000000-0000-4000-8000-000000000002', 'BE-DE', 'adm Indicia GmbH (demo)', 'EMEA', 'Germany', 'DE000000000', 'EUR'),
  ('c6000000-0000-4000-8000-000000000003', 'BE-SG', 'adm Indicia Asia Pte (demo)', 'APAC', 'Singapore', 'SG000000000', 'EUR'),
  ('c6000000-0000-4000-8000-000000000004', 'BE-US', 'adm Indicia Inc (demo)', 'Americas', 'United States', 'US000000000', 'EUR'),
  ('c6000000-0000-4000-8000-000000000005', 'BE-VN', 'adm Indicia Vietnam (demo)', 'APAC', 'Vietnam', 'VN000000000', 'EUR')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Sourcing+ libraries: rate cards and high-value thresholds (distinct codes; skipped if already present)
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from)
select v.key, v.code, v.name, v.data::jsonb, 'active', date '2026-01-01'
  from (values
    ('rate_cards', 'RC-HNK-A2', 'Heineken A2 header card, FBB 350gsm', '{"spec_type":"2d","substrate_code":"SUB-FBB350","finished_length_mm":600,"finished_width_mm":400,"min_qty":500,"max_qty":10000,"unit_price":1.85,"currency":"EUR","supplier_code":"DEMO-015","client_code":"HNK"}'),
    ('rate_cards', 'RC-A1-POSTER', 'A1 poster, FBB 350gsm', '{"spec_type":"2d","substrate_code":"SUB-FBB350","finished_length_mm":594,"finished_width_mm":841,"min_qty":100,"max_qty":2000,"unit_price":4.20,"currency":"EUR","supplier_code":"DEMO-030"}'),
    ('rate_cards', 'RC-CLING-1000', 'Window cling 1000 x 700, vinyl', '{"spec_type":"2d","substrate_code":"SUB-VINYL","finished_length_mm":1000,"finished_width_mm":700,"min_qty":50,"max_qty":1000,"unit_price":9.50,"currency":"EUR","supplier_code":"DEMO-030"}'),
    ('rate_cards', 'RC-WOBBLER', 'Shelf wobbler 100 x 150, SBS 300gsm', '{"spec_type":"2d","substrate_code":"SUB-SBS300","finished_length_mm":100,"finished_width_mm":150,"min_qty":5000,"max_qty":15000,"unit_price":0.30,"currency":"GBP","supplier_code":"DEMO-019","client_code":"UL"}'),
    ('high_value_thresholds', 'HV-DEFAULT', 'All other markets', '{"market":null,"threshold":100000,"currency":"EUR"}'),
    ('high_value_thresholds', 'HV-DE', 'Germany', '{"market":"Germany","threshold":50000,"currency":"EUR"}'),
    ('high_value_thresholds', 'HV-UK', 'United Kingdom', '{"market":"United Kingdom","threshold":60000,"currency":"GBP"}'),
    ('high_value_thresholds', 'HV-CN', 'China', '{"market":"China","threshold":40000,"currency":"EUR"}')
  ) v(key, code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = v.key and r.code = v.code);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
insert into public.jobs (id, title, client_id, billing_entity_id, region, market, category, campaign_name, brand, budget, currency, quote_due_date, target_delivery_date, status, notes) values
  ('a5000000-0000-4000-8000-000000000001', 'Summer cooler POS kit', 'c5000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000002', 'EMEA', 'Germany', 'POSM', 'Summer refresh 2026', 'Heineken', 15000, 'EUR', current_date + 5, current_date + 45, 'quoting', 'Dummy job'),
  ('a5000000-0000-4000-8000-000000000002', 'Dove shelf wobblers', 'c5000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'EMEA', 'United Kingdom', 'Print', 'Real beauty in-store', 'Dove', 8000, 'GBP', current_date - 10, current_date + 20, 'quoting', 'Dummy job'),
  ('a5000000-0000-4000-8000-000000000003', 'Store opening kit', 'c5000000-0000-4000-8000-000000000004', 'c6000000-0000-4000-8000-000000000003', 'APAC', 'Singapore', 'Print', 'Orchard Road opening', null, 6000, 'EUR', null, current_date + 30, 'open', 'Dummy job'),
  ('a5000000-0000-4000-8000-000000000004', 'Clinic display stands', 'c5000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004', 'Americas', 'United States', 'Fixtures', 'Clinic visibility', null, 12000, 'EUR', current_date - 20, current_date + 15, 'in_production', 'Dummy job'),
  ('a5000000-0000-4000-8000-000000000005', 'Tet promo hampers', 'c5000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000005', 'APAC', 'Vietnam', 'Premiums', 'Tet 2027', 'Knorr', 20000, 'EUR', null, current_date + 90, 'open', 'Dummy job'),
  ('a5000000-0000-4000-8000-000000000006', 'Flagship bar fixture', 'c5000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000002', 'EMEA', 'Germany', 'Fixtures', 'Flagship bars', 'Heineken', 80000, 'EUR', current_date + 14, current_date + 75, 'open', 'Dummy job');

-- ---------------------------------------------------------------------------
-- Specs, versions and components (substrates from the Watchtower library)
-- ---------------------------------------------------------------------------
insert into public.job_specs (id, job_id, title, spec_type, description, size_unit, substrate_id, unit_weight_grams, weight_basis, hs_code, is_draft) values
  ('b5000000-0000-4000-8000-000000000011', 'a5000000-0000-4000-8000-000000000001', 'Cooler header card A2', '2d', 'Single-sided header card, 4/0 CMYK, matt varnish', 'mm', (select id from public.library_records where library_key = 'substrates' and code = 'SUB-FBB350' and status = 'active'), 84, 'calculated_from_material', '4911.10', false),
  ('b5000000-0000-4000-8000-000000000012', 'a5000000-0000-4000-8000-000000000001', 'Bar runner mat', 'promo_merch', 'Rubber-backed bar runner, full-colour print, 600 x 250 mm', 'mm', null, 420, 'supplier_confirmed', '4016.91', false),
  ('b5000000-0000-4000-8000-000000000021', 'a5000000-0000-4000-8000-000000000002', 'Dove shelf wobbler', '2d', 'Die-cut wobbler with clear PET arm', 'mm', (select id from public.library_records where library_key = 'substrates' and code = 'SUB-SBS300' and status = 'active'), 5, 'calculated_from_material', '4911.10', false),
  ('b5000000-0000-4000-8000-000000000031', 'a5000000-0000-4000-8000-000000000003', 'Opening day poster A1', '2d', 'A1 poster, 4/0', 'mm', (select id from public.library_records where library_key = 'substrates' and code = 'SUB-FBB350' and status = 'active'), 175, 'calculated_from_material', '4911.10', false),
  ('b5000000-0000-4000-8000-000000000032', 'a5000000-0000-4000-8000-000000000003', 'Window cling', '2d', 'Static cling, reverse printed', 'mm', (select id from public.library_records where library_key = 'substrates' and code = 'SUB-VINYL' and status = 'active'), null, null, null, false),
  ('b5000000-0000-4000-8000-000000000041', 'a5000000-0000-4000-8000-000000000004', 'Freestanding clinic stand', '3d', 'Plywood stand with acrylic leaflet holders', 'mm', null, null, null, '9403.60', false),
  ('b5000000-0000-4000-8000-000000000051', 'a5000000-0000-4000-8000-000000000005', 'Tet gift hamper', 'promo_merch', 'Kraft hamper box with branded sleeve and four product slots', 'mm', null, null, null, null, false),
  ('b5000000-0000-4000-8000-000000000052', 'a5000000-0000-4000-8000-000000000005', 'Hamper ribbon and tag', 'promo_merch', 'Draft: waiting for artwork', 'mm', null, null, null, null, true),
  ('b5000000-0000-4000-8000-000000000061', 'a5000000-0000-4000-8000-000000000006', 'Flagship back-bar fixture', '3d', 'Illuminated back-bar unit, plywood carcass, acrylic fascia', 'mm', null, null, null, '9403.60', false);

insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width, sort) values
  ('b5000000-0000-4000-8000-000000000011', 'Standard', 2000, 600, 400, 0),
  ('b5000000-0000-4000-8000-000000000012', 'Standard', 500, 600, 250, 0),
  ('b5000000-0000-4000-8000-000000000021', 'Original', 12000, 100, 150, 0),
  ('b5000000-0000-4000-8000-000000000021', 'Sensitive', 8000, 100, 150, 1),
  ('b5000000-0000-4000-8000-000000000031', 'Main', 300, 594, 841, 0),
  ('b5000000-0000-4000-8000-000000000032', 'Main', 120, 1020, 700, 0),
  ('b5000000-0000-4000-8000-000000000041', 'Standard', 50, 600, 1800, 0),
  ('b5000000-0000-4000-8000-000000000051', 'Hamper', 1500, 400, 300, 0),
  ('b5000000-0000-4000-8000-000000000061', 'Bar unit', 6, 3000, 2200, 0);

insert into public.spec_components (spec_id, component_name, component_type, is_packaging, substrate_id, quantity_per_unit, area_length_cm, area_width_cm, direct_weight_grams, sort) values
  ('b5000000-0000-4000-8000-000000000041', 'Carcass', 'body', false, (select id from public.library_records where library_key = 'substrates' and code = 'SUB-PINEPLY' and status = 'active'), 1, 180, 60, null, 0),
  ('b5000000-0000-4000-8000-000000000041', 'Leaflet holders', 'fixing', false, (select id from public.library_records where library_key = 'substrates' and code = 'SUB-ACRYL3' and status = 'active'), 3, 22, 30, null, 1),
  ('b5000000-0000-4000-8000-000000000041', 'Outer carton', 'packaging', true, (select id from public.library_records where library_key = 'substrates' and code = 'SUB-CORR-BC' and status = 'active'), 1, 200, 140, null, 2),
  ('b5000000-0000-4000-8000-000000000051', 'Hamper box', 'body', false, (select id from public.library_records where library_key = 'substrates' and code = 'SUB-KRAFT120' and status = 'active'), 1, 90, 70, null, 0),
  ('b5000000-0000-4000-8000-000000000061', 'Carcass', 'body', false, (select id from public.library_records where library_key = 'substrates' and code = 'SUB-PINEPLY' and status = 'active'), 1, 300, 220, null, 0),
  ('b5000000-0000-4000-8000-000000000061', 'Fascia', 'panel', false, (select id from public.library_records where library_key = 'substrates' and code = 'SUB-ACRYL3' and status = 'active'), 1, 300, 40, null, 1);

-- ---------------------------------------------------------------------------
-- Triage decisions (as the rules would have made them)
-- ---------------------------------------------------------------------------
insert into public.spec_triage (spec_id, route, reason, confidence, rate_card_id, unit_price, currency, quantity, supplier_id, push_status, push_respond_by, rule_version, source)
select v.spec_id::uuid, v.route, v.reason, v.conf, (select id from public.library_records where library_key = 'rate_cards' and code = v.card and status = 'active'),
       v.price, v.cur, v.qty, (select id from public.suppliers where supplier_code = v.sup), v.push, case when v.push is not null then current_date + 3 end, 'triage-rules-v1', v.src
  from (values
    ('b5000000-0000-4000-8000-000000000011', 'adopt', 'Exact match to rate card "Heineken A2 header card, FBB 350gsm": card price applies.', 1.0, 'RC-HNK-A2', 1.85, 'EUR', 2000, 'DEMO-015', null, 'rule'),
    ('b5000000-0000-4000-8000-000000000012', 'create', 'No live rate card matches this spec type and material: run an RFQ.', 0, null, null, 'EUR', 500, null, null, 'rule'),
    ('b5000000-0000-4000-8000-000000000021', 'create', 'Override: Client asked for a competitive round this season', 0, 'RC-WOBBLER', 0.30, 'GBP', 20000, null, null, 'override'),
    ('b5000000-0000-4000-8000-000000000031', 'adopt', 'Exact match to rate card "A1 poster, FBB 350gsm": card price applies.', 0.95, 'RC-A1-POSTER', 4.20, 'EUR', 300, 'DEMO-030', null, 'rule'),
    ('b5000000-0000-4000-8000-000000000032', 'push', 'Inside the ±10% band of "Window cling 1000 x 700, vinyl" with 98% confidence: we state the price and Straits Component Supply confirms.', 0.98, 'RC-CLING-1000', 9.69, 'EUR', 120, 'DEMO-030', 'pending', 'rule'),
    ('b5000000-0000-4000-8000-000000000041', 'create', 'No live rate card matches this spec type and material: run an RFQ.', 0, null, null, 'EUR', 50, null, null, 'rule'),
    ('b5000000-0000-4000-8000-000000000061', 'create', 'No live rate card matches this spec type and material: run an RFQ.', 0, null, null, 'EUR', 6, null, null, 'rule')
  ) v(spec_id, route, reason, conf, card, price, cur, qty, sup, push, src);

insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
select t.rate_card_id, 'spec_triage', t.id::text, 'Triage decision' from public.spec_triage t
 where t.rate_card_id is not null and t.spec_id::text like 'b5000000-%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RFQs, invitations and sealed quotes
-- ---------------------------------------------------------------------------
insert into public.rfqs (id, job_id, title, status, currency, due_at, estimated_value, region, market, control_record_id, control_band, min_quotes_required, min_quotes_basis,
                         high_value_threshold, high_value_alert, notes, sent_at, awarded_at, award_reason) values
  ('d5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'Bar runner mats', 'sent', 'EUR', now() + interval '5 days', 3250, 'EMEA', 'Germany',
   (select id from public.library_records where library_key = 'sourcing_control_matrix' and code = 'SCM-1' and status = 'active'), 'Under €5k', 3, 'Band "Under €5k": at least 3 in-country supplier(s).',
   50000, false, 'Dummy RFQ', now() - interval '2 days', null, null),
  ('d5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'Dove wobblers 2026', 'awarded', 'GBP', now() - interval '12 days', 6000, 'EMEA', 'United Kingdom',
   (select id from public.library_records where library_key = 'sourcing_control_matrix' and code = 'SCM-2' and status = 'active'), '€5k to €25k', 3, 'Band "€5k to €25k": at least 3 in-country supplier(s).',
   60000, false, 'Dummy RFQ', now() - interval '20 days', now() - interval '11 days', 'Lowest price and shortest lead time'),
  ('d5000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000004', 'Clinic stands', 'awarded', 'EUR', now() - interval '22 days', 10000, 'Americas', 'United States',
   (select id from public.library_records where library_key = 'sourcing_control_matrix' and code = 'SCM-2' and status = 'active'), '€5k to €25k', 3, 'Band "€5k to €25k": at least 3 in-country supplier(s).',
   100000, false, 'Dummy RFQ', now() - interval '30 days', now() - interval '21 days', 'Lowest price, in-country supplier'),
  ('d5000000-0000-4000-8000-000000000006', 'a5000000-0000-4000-8000-000000000006', 'Flagship back-bar fixtures', 'draft', 'EUR', now() + interval '14 days', 65000, 'EMEA', 'Germany',
   null, null, null, null, 50000, true, 'Dummy RFQ: over the German high-value threshold, waiting for a sourcing lead', null, null, null);

insert into public.rfq_lines (id, rfq_id, spec_id, line_no, quantity_breaks, target_prices, show_targets) values
  ('d6000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000012', 1, array[500,1000], array[6.5,6.0]::numeric[], false),
  ('d6000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000021', 1, array[20000,10000,40000], array[0.30,0.38,0.27]::numeric[], true),
  ('d6000000-0000-4000-8000-000000000004', 'd5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', 1, array[50,100], array[200,190]::numeric[], false),
  ('d6000000-0000-4000-8000-000000000006', 'd5000000-0000-4000-8000-000000000006', 'b5000000-0000-4000-8000-000000000061', 1, array[6,10], null, false);

insert into public.rfq_invitations (rfq_id, supplier_id, status, cross_border, invited_at, viewed_at, responded_at)
select v.rfq::uuid, s.id, v.status, s.market <> v.market, now() - interval '20 days', case when v.status <> 'invited' then now() - interval '2 days' end,
       case when v.status = 'quoted' then now() - interval '1 day' end
  from (values
    ('d5000000-0000-4000-8000-000000000001', 'DEMO-015', 'quoted', 'Germany'),
    ('d5000000-0000-4000-8000-000000000001', 'DEMO-019', 'quoted', 'Germany'),
    ('d5000000-0000-4000-8000-000000000001', 'DEMO-030', 'viewed', 'Germany'),
    ('d5000000-0000-4000-8000-000000000002', 'DEMO-015', 'quoted', 'United Kingdom'),
    ('d5000000-0000-4000-8000-000000000002', 'DEMO-019', 'quoted', 'United Kingdom'),
    ('d5000000-0000-4000-8000-000000000002', 'DEMO-024', 'quoted', 'United Kingdom'),
    ('d5000000-0000-4000-8000-000000000004', 'DEMO-024', 'quoted', 'United States'),
    ('d5000000-0000-4000-8000-000000000004', 'DEMO-019', 'quoted', 'United States'),
    ('d5000000-0000-4000-8000-000000000004', 'DEMO-030', 'quoted', 'United States'),
    ('d5000000-0000-4000-8000-000000000006', 'DEMO-015', 'invited', 'Germany'),
    ('d5000000-0000-4000-8000-000000000006', 'DEMO-019', 'invited', 'Germany'),
    ('d5000000-0000-4000-8000-000000000006', 'DEMO-030', 'invited', 'Germany')
  ) v(rfq, code, status, market)
  join public.suppliers s on s.supplier_code = v.code;

insert into public.rfq_responses (id, rfq_id, supplier_id, status, source, currency, lead_time_days, total_value, submitted_at, finance_status, finance_at, finance_notes)
select v.id::uuid, v.rfq::uuid, s.id, v.status, v.source, v.cur, v.lead, v.total, now() - interval '1 day', v.fin, case when v.fin <> 'pending' then now() - interval '1 day' end, v.fnotes
  from (values
    ('d7000000-0000-4000-8000-000000000011', 'd5000000-0000-4000-8000-000000000001', 'DEMO-015', 'submitted', 'vendor_portal', 'EUR', 14, 3100.00, 'pending', null),
    ('d7000000-0000-4000-8000-000000000012', 'd5000000-0000-4000-8000-000000000001', 'DEMO-019', 'submitted', 'internal_entry', 'EUR', 18, 3300.00, 'pending', null),
    ('d7000000-0000-4000-8000-000000000021', 'd5000000-0000-4000-8000-000000000002', 'DEMO-015', 'declined', 'vendor_portal', 'GBP', 12, 5800.00, 'approved', 'Within budget'),
    ('d7000000-0000-4000-8000-000000000022', 'd5000000-0000-4000-8000-000000000002', 'DEMO-019', 'awarded', 'vendor_portal', 'GBP', 10, 5400.00, 'approved', 'Within budget'),
    ('d7000000-0000-4000-8000-000000000023', 'd5000000-0000-4000-8000-000000000002', 'DEMO-024', 'declined', 'vendor_portal', 'GBP', 15, 6200.00, 'approved', null),
    ('d7000000-0000-4000-8000-000000000041', 'd5000000-0000-4000-8000-000000000004', 'DEMO-024', 'awarded', 'vendor_portal', 'EUR', 21, 9000.00, 'approved', 'OK'),
    ('d7000000-0000-4000-8000-000000000042', 'd5000000-0000-4000-8000-000000000004', 'DEMO-019', 'declined', 'vendor_portal', 'EUR', 28, 9750.00, 'approved', null),
    ('d7000000-0000-4000-8000-000000000043', 'd5000000-0000-4000-8000-000000000004', 'DEMO-030', 'declined', 'internal_entry', 'EUR', 35, 10500.00, 'pending', null)
  ) v(id, rfq, code, status, source, cur, lead, total, fin, fnotes)
  join public.suppliers s on s.supplier_code = v.code;

insert into public.rfq_response_prices (response_id, line_id, quantity, unit_price) values
  ('d7000000-0000-4000-8000-000000000011', 'd6000000-0000-4000-8000-000000000001', 500, 6.20), ('d7000000-0000-4000-8000-000000000011', 'd6000000-0000-4000-8000-000000000001', 1000, 5.80),
  ('d7000000-0000-4000-8000-000000000012', 'd6000000-0000-4000-8000-000000000001', 500, 6.60), ('d7000000-0000-4000-8000-000000000012', 'd6000000-0000-4000-8000-000000000001', 1000, 6.10),
  ('d7000000-0000-4000-8000-000000000021', 'd6000000-0000-4000-8000-000000000002', 20000, 0.29), ('d7000000-0000-4000-8000-000000000021', 'd6000000-0000-4000-8000-000000000002', 10000, 0.36), ('d7000000-0000-4000-8000-000000000021', 'd6000000-0000-4000-8000-000000000002', 40000, 0.26),
  ('d7000000-0000-4000-8000-000000000022', 'd6000000-0000-4000-8000-000000000002', 20000, 0.27), ('d7000000-0000-4000-8000-000000000022', 'd6000000-0000-4000-8000-000000000002', 10000, 0.34), ('d7000000-0000-4000-8000-000000000022', 'd6000000-0000-4000-8000-000000000002', 40000, 0.25),
  ('d7000000-0000-4000-8000-000000000023', 'd6000000-0000-4000-8000-000000000002', 20000, 0.31), ('d7000000-0000-4000-8000-000000000023', 'd6000000-0000-4000-8000-000000000002', 10000, 0.40), ('d7000000-0000-4000-8000-000000000023', 'd6000000-0000-4000-8000-000000000002', 40000, 0.28),
  ('d7000000-0000-4000-8000-000000000041', 'd6000000-0000-4000-8000-000000000004', 50, 180), ('d7000000-0000-4000-8000-000000000041', 'd6000000-0000-4000-8000-000000000004', 100, 170),
  ('d7000000-0000-4000-8000-000000000042', 'd6000000-0000-4000-8000-000000000004', 50, 195), ('d7000000-0000-4000-8000-000000000042', 'd6000000-0000-4000-8000-000000000004', 100, 185),
  ('d7000000-0000-4000-8000-000000000043', 'd6000000-0000-4000-8000-000000000004', 50, 210), ('d7000000-0000-4000-8000-000000000043', 'd6000000-0000-4000-8000-000000000004', 100, 200);

update public.rfqs set awarded_response_id = 'd7000000-0000-4000-8000-000000000022' where id = 'd5000000-0000-4000-8000-000000000002';
update public.rfqs set awarded_response_id = 'd7000000-0000-4000-8000-000000000041' where id = 'd5000000-0000-4000-8000-000000000004';

insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
select control_record_id, 'rfqs', id::text, rfq_number from public.rfqs where control_record_id is not null and id::text like 'd5000000-%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Estimates, POs and the integration outbox
-- ---------------------------------------------------------------------------
insert into public.estimates (id, job_id, rfq_id, response_id, supplier_id, source, currency, base_cost, benchmark_value, benchmark_source, target_value,
  pricing_mode, pricing_percent, savings_vs_benchmark, savings_vs_target, savings_target_percent, selection_reason, status, client_order_ref, sent_at, approved_at, region, market) values
  ('e5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000022',
   (select id from public.suppliers where supplier_code = 'DEMO-019'), 'rfq', 'GBP', 5400, 5800, 'live', 6000, 'markup', 15, 400, 600, 5,
   'Lowest price and shortest lead time', 'approved', 'UL-PO-44821', now() - interval '9 days', now() - interval '7 days', 'EMEA', 'United Kingdom'),
  ('e5000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000004', 'd5000000-0000-4000-8000-000000000004', 'd7000000-0000-4000-8000-000000000041',
   (select id from public.suppliers where supplier_code = 'DEMO-024'), 'rfq', 'EUR', 9000, 9750, 'live', 10000, 'margin', 12, 750, 1000, 4,
   'Lowest price, in-country supplier', 'approved', 'CPL-77310', now() - interval '19 days', now() - interval '18 days', 'Americas', 'United States'),
  ('e5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000003', null, null,
   (select id from public.suppliers where supplier_code = 'DEMO-030'), 'adopt', 'EUR', 1260, 1260, 'rate_card', null, 'markup', 18, 0, null, 3,
   'Rate-card price applied at triage', 'draft', null, null, null, 'APAC', 'Singapore');

insert into public.estimate_lines (estimate_id, spec_id, rfq_line_id, quantity, unit_cost, line_cost, benchmark_unit, target_unit) values
  ('e5000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000021', 'd6000000-0000-4000-8000-000000000002', 20000, 0.27, 5400, 0.29, 0.30),
  ('e5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', 'd6000000-0000-4000-8000-000000000004', 50, 180, 9000, 195, 200),
  ('e5000000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000031', null, 300, 4.20, 1260, 4.20, null);

insert into public.purchase_orders (id, job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, status, required_doa_level, doa_record_id, doa_basis,
  exceeds_e_tender, approver_doa_level, approved_at, vendor_responded_at, region, market) values
  ('f5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000002', (select id from public.suppliers where supplier_code = 'DEMO-019'),
   'GBP', 5400, current_date - 6, current_date + 20, 'pending_approval', 1, (select id from public.library_records where library_key = 'doa_levels' and code = 'L1' and status = 'active'),
   'Up to £25,000 (GBP 25000) from the DOA matrix in force', false, null, null, null, 'EMEA', 'United Kingdom'),
  ('f5000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000004', (select id from public.suppliers where supplier_code = 'DEMO-024'),
   'EUR', 9000, current_date - 17, current_date + 15, 'accepted', 1, (select id from public.library_records where library_key = 'doa_levels' and code = 'L1' and status = 'active'),
   'Up to £25,000 (GBP 25000) from the DOA matrix in force; no levels in EUR, so all currencies were used', false, 2, now() - interval '16 days', now() - interval '15 days', 'Americas', 'United States');

insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
select doa_record_id, 'purchase_orders', id::text, po_number from public.purchase_orders where doa_record_id is not null and id::text like 'f5000000-%'
on conflict do nothing;

insert into public.integration_outbox (module, event, aggregate_type, aggregate_id, payload, status)
select 'sourcing', 'estimate.approved', 'estimate', e.id,
       jsonb_build_object('estimate_number', e.estimate_number, 'job_number', j.job_number, 'client_code', c.code, 'client_order_ref', e.client_order_ref,
         'supplier_code', s.supplier_code, 'currency', e.currency, 'base_cost', e.base_cost, 'sell_price', e.sell_price, 'region', e.region, 'market', e.market, 'demo', true),
       case when e.id = 'e5000000-0000-4000-8000-000000000004' then 'sent' else 'queued' end
  from public.estimates e join public.jobs j on j.id = e.job_id join public.sourcing_clients c on c.id = j.client_id join public.suppliers s on s.id = e.supplier_id
 where e.status = 'approved' and e.id::text like 'e5000000-%';

-- A short activity trail so the job pages aren't empty.
insert into public.sourcing_events (job_id, entity, entity_id, event, detail, at)
select j.id, 'job', j.id, 'created', jsonb_build_object('job_number', j.job_number, 'title', j.title, 'demo', true), now() - interval '25 days'
  from public.jobs j where j.id::text like 'a5000000-%';
insert into public.sourcing_events (job_id, entity, entity_id, event, detail, at) values
  ('a5000000-0000-4000-8000-000000000001', 'rfq', 'd5000000-0000-4000-8000-000000000001', 'sent', '{"suppliers":3,"min_required":3,"band":"Under €5k"}', now() - interval '2 days'),
  ('a5000000-0000-4000-8000-000000000002', 'rfq', 'd5000000-0000-4000-8000-000000000002', 'awarded', '{"reason":"Lowest price and shortest lead time","valid_quotes":3,"min_required":3}', now() - interval '11 days'),
  ('a5000000-0000-4000-8000-000000000002', 'estimate', 'e5000000-0000-4000-8000-000000000002', 'approved', '{"client_order_ref":"UL-PO-44821"}', now() - interval '7 days'),
  ('a5000000-0000-4000-8000-000000000002', 'po', 'f5000000-0000-4000-8000-000000000002', 'created', '{"required_doa_level":1}', now() - interval '6 days'),
  ('a5000000-0000-4000-8000-000000000004', 'po', 'f5000000-0000-4000-8000-000000000004', 'vendor_accepted', '{}', now() - interval '15 days'),
  ('a5000000-0000-4000-8000-000000000006', 'rfq', 'd5000000-0000-4000-8000-000000000006', 'high_value_alert', '{"estimated_value":65000,"threshold":50000,"market":"Germany"}', now() - interval '1 day');

select set_config('sourcing.system_write', 'off', false);
