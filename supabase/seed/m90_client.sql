-- DUMMY DATA for the Client Portal and External Reporting. Every job, price and person here is made up.
-- Loaded after m40_sourcing.sql. Gives the Heineken (demo) account an estimate waiting for a decision and two finished
-- orders (spend, savings and spec CO2e for the reports). The demo client user and their grant are added in src/lib/demo/db.ts.
select set_config('sourcing.system_write', 'on', false);

insert into public.jobs (id, title, client_id, billing_entity_id, region, market, brief_id, category, campaign_name, brand, budget, currency, opened_date, target_delivery_date, status, client_job_ref, notes) values
  ('a9000000-0000-4000-8000-000000000001', 'Heineken 0.0 gondola ends', 'c5000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000001', 'EMEA', 'United Kingdom',
   (select id from public.briefs where brief_code = 'BR-2026-00001'), 'Fixtures', 'Summer of Football', 'Heineken 0.0', 12000, 'EUR', current_date - 60, current_date - 10, 'delivered', 'HNK-GB-0418', 'Dummy job'),
  ('a9000000-0000-4000-8000-000000000002', 'Amstel gift pack sleeves', 'c5000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000002', 'EMEA', 'Netherlands',
   (select id from public.briefs where brief_code = 'BR-2026-00007'), 'Print', 'Amstel Christmas Gifting', 'Amstel', 8000, 'EUR', current_date - 110, current_date - 45, 'delivered', 'HNK-NL-0377', 'Dummy job');

insert into public.job_specs (id, job_id, title, spec_type, description, size_unit, unit_weight_grams, weight_basis, co2e_kg_per_unit, co2e_total_kg, co2e_computed_at, is_draft) values
  ('b9000000-0000-4000-8000-000000000011', 'a9000000-0000-4000-8000-000000000001', 'Gondola end display', '3d', 'Corrugated gondola end with tournament header, holds 4- and 10-packs', 'mm', 16500, 'calculated_from_material', 8.25, 412.5, now() - interval '50 days', false),
  ('b9000000-0000-4000-8000-000000000021', 'a9000000-0000-4000-8000-000000000002', 'Gift pack sleeve', '2d', 'Printed board sleeve for the 4-pack gift box', 'mm', 48, 'calculated_from_material', 0.048, 960, now() - interval '100 days', false);

insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width, sort) values
  ('b9000000-0000-4000-8000-000000000011', 'Standard', 50, 1800, 900, 0),
  ('b9000000-0000-4000-8000-000000000021', 'Standard', 20000, 320, 180, 0);

insert into public.estimates (id, job_id, supplier_id, source, currency, base_cost, benchmark_value, benchmark_source, pricing_mode, pricing_percent,
  savings_vs_benchmark, savings_target_percent, selection_reason, status, client_order_ref, sent_at, approved_at, region, market) values
  ('e9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', (select id from public.suppliers where supplier_code = 'DEMO-024'), 'adapt', 'EUR',
   9500, 10200, 'rate_card', 'markup', 14, 700, 6, 'Rate-card price applied at triage', 'approved', 'HNK-PO-2026-118', now() - interval '42 days', now() - interval '40 days', 'EMEA', 'United Kingdom'),
  ('e9000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000002', (select id from public.suppliers where supplier_code = 'DEMO-015'), 'adopt', 'EUR',
   6400, 6700, 'rate_card', 'markup', 14, 300, 6, 'Rate-card price applied at triage', 'approved', 'HNK-PO-2026-071', now() - interval '78 days', now() - interval '75 days', 'EMEA', 'Netherlands'),
  -- Waiting for the client: the Adopt line on the German cooler kit.
  ('e9000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', (select id from public.suppliers where supplier_code = 'DEMO-015'), 'adopt', 'EUR',
   3700, 3700, 'rate_card', 'markup', 14, 0, 6, 'Rate-card price applied at triage', 'sent', null, now() - interval '1 day', null, 'EMEA', 'Germany');

insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost, benchmark_unit, triage_id) values
  ('e9000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000011', 50, 190, 9500, 204, null),
  ('e9000000-0000-4000-8000-000000000003', 'b9000000-0000-4000-8000-000000000021', 20000, 0.32, 6400, 0.335, null),
  ('e9000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000011', 2000, 1.85, 3700, 1.85,
   (select id from public.spec_triage where spec_id = 'b5000000-0000-4000-8000-000000000011' and is_current));

insert into public.purchase_orders (id, job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, status, required_doa_level, doa_record_id, doa_basis,
  approver_doa_level, approved_at, vendor_responded_at, region, market) values
  ('f9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', (select id from public.suppliers where supplier_code = 'DEMO-024'),
   'EUR', 9500, current_date - 38, current_date - 10, 'accepted', 1, (select id from public.library_records where library_key = 'doa_levels' and code = 'L1' and status = 'active'),
   'Up to £25,000 from the DOA matrix in force', 2, now() - interval '38 days', now() - interval '37 days', 'EMEA', 'United Kingdom'),
  ('f9000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000003', (select id from public.suppliers where supplier_code = 'DEMO-015'),
   'EUR', 6400, current_date - 73, current_date - 45, 'accepted', 1, (select id from public.library_records where library_key = 'doa_levels' and code = 'L1' and status = 'active'),
   'Up to £25,000 from the DOA matrix in force', 2, now() - interval '73 days', now() - interval '72 days', 'EMEA', 'Netherlands');

insert into public.sourcing_events (job_id, entity, entity_id, event, detail, at) values
  ('a9000000-0000-4000-8000-000000000001', 'estimate', 'e9000000-0000-4000-8000-000000000001', 'approved', '{"client_order_ref":"HNK-PO-2026-118"}', now() - interval '40 days'),
  ('a9000000-0000-4000-8000-000000000001', 'job', 'a9000000-0000-4000-8000-000000000001', 'status_changed', '{"from":"ordered","to":"in_production"}', now() - interval '37 days'),
  ('a9000000-0000-4000-8000-000000000001', 'job', 'a9000000-0000-4000-8000-000000000001', 'status_changed', '{"from":"in_production","to":"delivered"}', now() - interval '9 days'),
  ('a9000000-0000-4000-8000-000000000002', 'estimate', 'e9000000-0000-4000-8000-000000000003', 'approved', '{"client_order_ref":"HNK-PO-2026-071"}', now() - interval '75 days'),
  ('a9000000-0000-4000-8000-000000000002', 'job', 'a9000000-0000-4000-8000-000000000002', 'status_changed', '{"from":"ordered","to":"in_production"}', now() - interval '72 days'),
  ('a9000000-0000-4000-8000-000000000002', 'job', 'a9000000-0000-4000-8000-000000000002', 'status_changed', '{"from":"in_production","to":"delivered"}', now() - interval '46 days'),
  ('a9000000-0000-4000-8000-000000000002', 'job', 'a9000000-0000-4000-8000-000000000002', 'status_changed', '{"from":"delivered","to":"closed"}', now() - interval '30 days'),
  ('a5000000-0000-4000-8000-000000000001', 'estimate', 'e9000000-0000-4000-8000-000000000002', 'sent', '{}', now() - interval '1 day');

-- Closed only after its specs were added (a closed job takes no new specs).
update public.jobs set status = 'closed', closed_at = now() - interval '30 days' where id = 'a9000000-0000-4000-8000-000000000002';

select set_config('sourcing.system_write', 'off', false);
