-- DUMMY DATA for Execution+. Every outlet, coordinate, photo and person here is made up.
-- Loaded after m50_logistics.sql (deliveries) and m40_sourcing.sql (jobs, POs). Display scoring criteria DS-* come from m10_watchtower.sql.
select set_config('sourcing.system_write', 'on', false);

-- Execution rules (new library; codes only added when missing).
insert into public.library_records (library_key, code, name, data, status, effective_from)
select v.key, v.code, v.name, v.data::jsonb, 'active', date '2026-01-01'
  from (values
    ('execution_rules', 'EXR-PASS', 'Audit pass mark', '{"value":70,"unit":"%","description":"An audit passes when the weighted display score reaches this mark."}'),
    ('execution_rules', 'EXR-GPS', 'Install GPS tolerance', '{"value":200,"unit":"m","description":"Installs recorded further than this from the outlet are flagged for review."}')
  ) v(key, code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = v.key and r.code = v.code);

-- ---------------------------------------------------------------------------
-- Outlets (several markets; region and market separate)
-- ---------------------------------------------------------------------------
insert into public.outlets (id, client_id, name, outlet_code, address_line, city, postcode, region, market, latitude, longitude, store_type, status, contact_name, contact_phone, notes) values
  ('16000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000003', 'Midtown Clinic (demo)', 'CPL-US-001', '200 Example Ave', 'New York', '10001', 'Americas', 'US', 40.712800, -74.006000, 'pharmacy', 'active', 'M. Alvarez', '+1 212 555 0100', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000003', 'Lakeside Clinic (demo)', 'CPL-US-002', '1 Sample Plaza', 'Chicago', '60601', 'Americas', 'US', 41.878100, -87.629800, 'pharmacy', 'active', 'J. Brooks', '+1 312 555 0199', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000004', 'Orchard Road flagship (demo)', 'BAU-SG-001', '2 Demo Road', 'Singapore', '238801', 'APAC', 'SG', 1.304800, 103.831800, 'department_store', 'active', 'L. Tan', '+65 5550 1000', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000004', 'c5000000-0000-4000-8000-000000000004', 'Bayfront mall kiosk (demo)', 'BAU-SG-002', '10 Sample Bayfront', 'Singapore', '018956', 'APAC', 'SG', 1.283400, 103.860700, 'convenience', 'active', 'R. Lim', '+65 5550 2000', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000005', 'c5000000-0000-4000-8000-000000000002', 'Mitte bar (demo)', 'HNK-DE-101', 'Beispielstrasse 1', 'Berlin', '10115', 'EMEA', 'DE', 52.520000, 13.405000, 'horeca', 'active', 'K. Weber', '+49 30 5550 100', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000006', 'c5000000-0000-4000-8000-000000000002', 'Altstadt bar (demo)', 'HNK-DE-102', 'Musterplatz 5', 'Munich', '80331', 'EMEA', 'DE', 48.135100, 11.582000, 'horeca', 'active', 'S. Bauer', '+49 89 5550 200', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000007', 'c5000000-0000-4000-8000-000000000001', 'High Street superstore (demo)', 'UL-GB-201', '1 Example Street', 'London', 'EC1A 1AA', 'EMEA', 'GB', 51.507400, -0.127800, 'supermarket', 'active', 'A. Shah', '+44 20 5550 0100', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000008', 'c5000000-0000-4000-8000-000000000001', 'Northern superstore (demo)', 'UL-GB-202', '9 Sample Road', 'Manchester', 'M1 1AA', 'EMEA', 'GB', 53.480800, -2.242600, 'supermarket', 'active', 'D. Hughes', '+44 161 555 0200', 'Dummy outlet'),
  ('16000000-0000-4000-8000-000000000009', 'c5000000-0000-4000-8000-000000000001', 'District 1 minimart (demo)', 'UL-VN-301', '12 Duong Mau', 'Ho Chi Minh City', '700000', 'APAC', 'VN', 10.776900, 106.700900, 'convenience', 'pending_survey', null, null, 'Dummy outlet waiting for a recce');

-- Link the planned deliveries to their outlets (also makes the outlet visible to the supplier).
update public.deliveries d set outlet_id = v.outlet::uuid
  from (values ('15000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001'), ('15000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000002'),
               ('15000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000003'), ('15000000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000004')) v(del, outlet)
 where d.id = v.del::uuid;

-- The demo vendor may also survey the Vietnam outlet.
insert into public.outlet_suppliers (outlet_id, supplier_id, source)
select '16000000-0000-4000-8000-000000000009', id, 'manual' from public.suppliers where supplier_code = 'DEMO-001'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Recces
-- ---------------------------------------------------------------------------
insert into public.recces (id, outlet_id, job_id, supplier_id, product_name, location_in_store, surface_type, available_width_cm, available_height_cm, available_depth_cm,
  unit_width_cm, unit_height_cm, unit_depth_cm, wall_space_available, power_outlet_nearby, recommended_width_cm, recommended_height_cm, recommended_depth_cm, recommended_notes,
  survey_date, captured_by_vendor, status, region, market, notes)
select v.id::uuid, v.outlet::uuid, v.job::uuid, (select id from public.suppliers where supplier_code = v.sup), v.product, v.loc, v.surface, v.aw, v.ah, v.ad::numeric, v.uw, v.uh, v.ud::numeric,
  v.wall, v.power, v.rw::numeric, v.rh::numeric, v.rd::numeric, v.rnotes::text, current_date + v.svy, v.sup is not null, v.status, 'EMEA', 'GB', 'Dummy recce'
  from (values
    ('16100000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000007', null, null, 'Dove shelf wobbler', 'Aisle 7, haircare', 'shelf', 120, 40, null, 10, 15, null, false, false, null, null, null, null, -2, 'draft'),
    ('16100000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000005', 'a5000000-0000-4000-8000-000000000006', null, 'Back-bar fixture', 'Behind the main bar', 'wall', 320, 240, 60, 300, 220, 55, true, true, null, null, null, null, -6, 'confirmed'),
    ('16100000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000003', 'DEMO-001', 'Window cling', 'Front windows, left of entrance', 'glass', 410, 220, null, 100, 70, null, false, false, 100, 70, null, 'Two rows of four; keep 10 cm clear of the door frame', -15, 'production_ready'),
    ('16100000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000009', 'a5000000-0000-4000-8000-000000000005', 'DEMO-001', 'Tet hamper display', 'Counter by the till', 'counter', 90, 60, 45, 40, 30, 30, false, true, null, null, null, null, -1, 'draft')
  ) v(id, outlet, job, sup, product, loc, surface, aw, ah, ad, uw, uh, ud, wall, power, rw, rh, rd, rnotes, svy, status);

-- ---------------------------------------------------------------------------
-- Deployments, one in each stage
-- ---------------------------------------------------------------------------
insert into public.deployments (id, outlet_id, po_id, job_id, supplier_id, spec_id, spec_version_id, delivery_id, quantity, planned_date, stage, installation_date,
  installed_quantity, installer_name, installed_by_vendor, gps_lat, gps_lon, gps_distance_m, gps_tolerance_m, gps_flag, audit_status, audit_score, audited_at, region, market, notes)
select v.id::uuid, v.outlet::uuid, p.id, p.job_id, p.supplier_id, v.spec::uuid, (select id from public.spec_versions sv where sv.spec_id = v.spec::uuid order by sort limit 1),
  v.del::uuid, v.qty, current_date + v.plan, v.stage, case when v.inst is not null then current_date + v.inst end, v.iqty, v.installer, case when v.installer is not null then true end,
  v.lat, v.lon, case when v.lat is not null then round(public.geo_distance_km(v.lat, v.lon, o.latitude, o.longitude) * 1000, 1) end,
  case when v.lat is not null then 200 end, case when v.lat is not null then public.geo_distance_km(v.lat, v.lon, o.latitude, o.longitude) * 1000 > 200 end,
  v.audit, v.score, case when v.score is not null then now() - interval '3 days' end, 'EMEA', 'GB', 'Dummy deployment'
  from (values
    ('16200000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', '15000000-0000-4000-8000-000000000001', 20, -5, 'audited', -4, 20, 'C. Ortiz (installer)', 40.713300, -74.006400, 'passed', 86.0),
    ('16200000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', '15000000-0000-4000-8000-000000000002', 20, 4, 'in_transit', null, null, null, null, null, 'pending', null),
    ('16200000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000050', 'b5000000-0000-4000-8000-000000000032', '15000000-0000-4000-8000-000000000003', 80, 6, 'planned', null, null, null, null, null, 'pending', null),
    ('16200000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000050', 'b5000000-0000-4000-8000-000000000032', '15000000-0000-4000-8000-000000000004', 40, 3, 'in_transit', null, null, null, null, null, 'pending', null),
    ('16200000-0000-4000-8000-000000000005', '16000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', '15000000-0000-4000-8000-000000000001', 10, 2, 'delivered', null, null, null, null, null, 'pending', null),
    ('16200000-0000-4000-8000-000000000006', '16000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', null, 5, -3, 'installed', -1, 5, 'C. Ortiz (installer)', 41.896000, -87.640000, 'needs_review', null),
    ('16200000-0000-4000-8000-000000000007', '16000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', null, 5, -6, 'rejected', -5, 5, 'C. Ortiz (installer)', 40.712900, -74.006100, 'failed', 45.0),
    ('16200000-0000-4000-8000-000000000008', '16000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000050', 'b5000000-0000-4000-8000-000000000032', null, 6, 1, 'delivered', null, null, null, null, null, 'pending', null)
  ) v(id, outlet, po, spec, del, qty, plan, stage, inst, iqty, installer, lat, lon, audit, score)
  join public.purchase_orders p on p.id = v.po::uuid
  join public.outlets o on o.id = v.outlet::uuid;

-- Install photos (1x1 dummy PNGs) for the installed deployments.
insert into public.files (module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, content, label, uploaded_by_vendor)
select 'execution', 'deployment', d.id::text, d.supplier_id, lower(l.label) || '-' || d.deployment_code || '.png', 'image/png', 68,
  decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), l.label, true
  from public.deployments d cross join (values ('Before'), ('After')) l(label)
 where d.id in ('16200000-0000-4000-8000-000000000001', '16200000-0000-4000-8000-000000000006', '16200000-0000-4000-8000-000000000007');

-- Audits scored against the display_scoring library in force.
insert into public.deployment_audits (deployment_id, scores, weights_total, total_score, pass_mark, result, notes, audited_at)
select v.dep::uuid, x.detail, x.wt, round(x.total, 1), 70, v.result, v.notes, now() - interval '3 days'
  from (values
    ('16200000-0000-4000-8000-000000000001', '{"DS-PLACE":90,"DS-COND":90,"DS-STOCK":80,"DS-COMMS":80}', 'passed', null),
    ('16200000-0000-4000-8000-000000000007', '{"DS-PLACE":30,"DS-COND":60,"DS-STOCK":40,"DS-COMMS":50}', 'failed', 'Dummy: stand placed in the waiting area, not by reception')
  ) v(dep, scores, result, notes)
  cross join lateral (
    select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'version', r.version, 'record_id', r.id, 'weight', (r.data->>'weight_percent')::numeric,
             'score', (v.scores::jsonb->>r.code)::numeric) order by r.code) detail,
           sum((r.data->>'weight_percent')::numeric) wt,
           sum((r.data->>'weight_percent')::numeric * (v.scores::jsonb->>r.code)::numeric / 100) total
      from public.library_records r where r.library_key = 'display_scoring' and r.status = 'active') x;
update public.deployments d set audit_score = a.total_score from public.deployment_audits a where a.deployment_id = d.id and d.id::text like '16200000-%';

-- ---------------------------------------------------------------------------
-- Maintenance tickets and visits
-- ---------------------------------------------------------------------------
insert into public.maintenance_tickets (id, deployment_id, outlet_id, supplier_id, issue_type, severity, status, root_cause, description, resolution_notes, reported_at, resolved_at, region, market) values
  ('16300000-0000-4000-8000-000000000001', '16200000-0000-4000-8000-000000000007', '16000000-0000-4000-8000-000000000001', (select supplier_id from public.deployments where id = '16200000-0000-4000-8000-000000000007'),
   'incorrect_install', 'medium', 'open', null, 'Audit failed (45%): stand placed in the waiting area, not by reception', null, now() - interval '3 days', null, 'EMEA', 'GB'),
  ('16300000-0000-4000-8000-000000000002', '16200000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', (select supplier_id from public.deployments where id = '16200000-0000-4000-8000-000000000001'),
   'damage', 'low', 'in_progress', null, 'Dummy: leaflet holder cracked by a trolley', null, now() - interval '1 day', null, 'EMEA', 'GB'),
  ('16300000-0000-4000-8000-000000000003', null, '16000000-0000-4000-8000-000000000005', null,
   'wear', 'low', 'resolved', 'handling', 'Dummy: bar runner edges lifting', 'Replaced with spare stock', now() - interval '20 days', now() - interval '14 days', 'EMEA', 'GB');

insert into public.visits (visit_type, outlet_id, deployment_id, ticket_id, recce_id, supplier_id, assigned_to, scheduled_date, completed_date, status, outcome, outcome_notes, region, market, notes) values
  ('installation', '16000000-0000-4000-8000-000000000001', '16200000-0000-4000-8000-000000000005', null, null, (select supplier_id from public.purchase_orders where id = 'f5000000-0000-4000-8000-000000000004'), 'C. Ortiz', current_date + 2, null, 'scheduled', null, null, 'EMEA', 'GB', 'Dummy visit'),
  ('audit', '16000000-0000-4000-8000-000000000001', '16200000-0000-4000-8000-000000000001', null, null, null, 'Field team NY', current_date - 3, current_date - 3, 'completed', 'successful', 'Display in place and stocked', 'EMEA', 'GB', 'Dummy visit'),
  ('maintenance', '16000000-0000-4000-8000-000000000001', '16200000-0000-4000-8000-000000000001', '16300000-0000-4000-8000-000000000002', null, null, 'Field team NY', current_date + 1, null, 'scheduled', null, null, 'EMEA', 'GB', 'Dummy visit'),
  ('recce', '16000000-0000-4000-8000-000000000009', null, null, '16100000-0000-4000-8000-000000000004', (select id from public.suppliers where supplier_code = 'DEMO-001'), 'Northwind field team', current_date + 5, null, 'scheduled', null, null, 'EMEA', 'GB', 'Dummy visit');

-- ---------------------------------------------------------------------------
-- Quality gates on the clinic stands job: mock-up and production passed, installation sheet uploaded and waiting.
-- ---------------------------------------------------------------------------
insert into public.job_quality_gates (job_id, gate_key, status, notes, signed_off_at) values
  ('a5000000-0000-4000-8000-000000000004', 'mockup', 'passed', 'Mock-up approved by the client (demo)', now() - interval '18 days'),
  ('a5000000-0000-4000-8000-000000000004', 'production', 'passed', 'Production check sheet clean (demo)', now() - interval '10 days'),
  ('a5000000-0000-4000-8000-000000000004', 'installation', 'pending', null, null),
  ('a5000000-0000-4000-8000-000000000004', 'closure', 'pending', null, null);
insert into public.files (module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, content, label, uploaded_by_vendor)
select 'execution', 'job_quality_gate', 'a5000000-0000-4000-8000-000000000004:' || v.gate, null, v.name, 'application/pdf', length(convert_to(v.body, 'UTF8')), convert_to(v.body, 'UTF8'), v.label, false
  from (values ('mockup', 'mockup-check-sheet.pdf', 'Mock-up check sheet', '%PDF-1.4 dummy mock-up check sheet'),
               ('production', 'production-check-sheet.pdf', 'Production check sheet', '%PDF-1.4 dummy production check sheet'),
               ('installation', 'installation-check-sheet.pdf', 'Installation check sheet', '%PDF-1.4 dummy installation check sheet')) v(gate, name, label, body);

insert into public.execution_events (job_id, entity, entity_id, event, detail, at) values
  ('a5000000-0000-4000-8000-000000000004', 'deployment', '16200000-0000-4000-8000-000000000001', 'installed', '{"quantity":20,"gps_flag":false,"by_vendor":true}', now() - interval '4 days'),
  ('a5000000-0000-4000-8000-000000000004', 'deployment', '16200000-0000-4000-8000-000000000001', 'audited', '{"result":"passed","score":86}', now() - interval '3 days'),
  ('a5000000-0000-4000-8000-000000000004', 'deployment', '16200000-0000-4000-8000-000000000007', 'audited', '{"result":"failed","score":45}', now() - interval '3 days'),
  ('a5000000-0000-4000-8000-000000000004', 'deployment', '16200000-0000-4000-8000-000000000006', 'installed', '{"quantity":5,"gps_flag":true,"by_vendor":true}', now() - interval '1 day');

select set_config('sourcing.system_write', 'off', false);
