-- DUMMY DATA for Logistics+. Every delivery, address and person here is made up.
-- Loaded after m40_sourcing.sql (POs, jobs, specs) and m10_watchtower.sql (carriers CAR-*, POD-1..8, TEF-*).
-- Rows are written directly (the seed runs before any user exists); the app's own writes go through the checked functions.
select set_config('sourcing.system_write', 'on', false);

-- Extra carrier (new code only).
insert into public.library_records (library_key, code, name, data, status, effective_from)
select 'carriers', 'CAR-DPD', 'DPD', '{"modes":["courier","road"],"regions":["EMEA","APAC"],"tracking_url":"https://www.dpd.com"}'::jsonb, 'active', date '2026-01-01'
 where not exists (select 1 from public.library_records where library_key = 'carriers' and code = 'CAR-DPD');

-- A purchase order for the demo vendor (Wei Chen, DEMO-001) so the vendor portal has deliveries and installs to work on.
insert into public.estimates (id, job_id, supplier_id, source, currency, base_cost, benchmark_value, benchmark_source, pricing_mode, pricing_percent,
  selection_reason, status, client_order_ref, sent_at, approved_at, region, market)
select 'e5000000-0000-4000-8000-000000000050', 'a5000000-0000-4000-8000-000000000003', s.id, 'adopt', 'EUR', 1140, 1140, 'rate_card', 'markup', 18,
  'Dummy: window clings for the Orchard Road opening', 'approved', 'BAU-55120', now() - interval '12 days', now() - interval '10 days', 'APAC', 'Singapore'
  from public.suppliers s where s.supplier_code = 'DEMO-001';
insert into public.estimate_lines (estimate_id, spec_id, quantity, unit_cost, line_cost, benchmark_unit)
select 'e5000000-0000-4000-8000-000000000050', 'b5000000-0000-4000-8000-000000000032', 120, 9.50, 1140, 9.50
 where exists (select 1 from public.estimates where id = 'e5000000-0000-4000-8000-000000000050');
insert into public.purchase_orders (id, job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, status, required_doa_level, doa_record_id,
  doa_basis, approver_doa_level, approved_at, vendor_responded_at, region, market, notes)
select 'f5000000-0000-4000-8000-000000000050', 'a5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000050', e.supplier_id, 'EUR', 1140,
  current_date - 9, current_date + 6, 'accepted', 0, (select id from public.library_records where library_key = 'doa_levels' and code = 'L0' and status = 'active'),
  'Up to £5,000 from the DOA matrix in force; no levels in EUR, so all currencies were used', 2, now() - interval '9 days', now() - interval '8 days', 'APAC', 'Singapore', 'Dummy PO'
  from public.estimates e where e.id = 'e5000000-0000-4000-8000-000000000050';

-- ---------------------------------------------------------------------------
-- Deliveries
-- ---------------------------------------------------------------------------
insert into public.deliveries (id, po_id, job_id, supplier_id, spec_id, spec_version_id, quantity, uom, recipient_name, recipient_contact, recipient_phone,
  address_line, city, postcode, region, market, origin_name, origin_market, origin_lat, origin_lon, destination_lat, destination_lon,
  delivery_method, incoterm, planned_dispatch_date, planned_delivery_date, actual_delivery_date, status, gross_weight_kg, distance_km, special_instructions)
select v.id::uuid, v.po::uuid, p.job_id, p.supplier_id, v.spec::uuid, (select id from public.spec_versions sv where sv.spec_id = v.spec::uuid order by sort limit 1),
  v.qty, 'units', v.recipient, v.contact, v.phone, v.addr, v.city, v.pc, v.region, v.market, v.origin, v.omarket, v.olat, v.olon, v.dlat, v.dlon,
  v.method, v.inco, current_date + v.disp, current_date + v.due, case when v.delivered is not null then current_date + v.delivered end, v.status, v.kg, v.km, v.note
  from (values
    ('15000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', 30, 'Clinic reception', 'M. Alvarez', '+1 212 555 0100',
     '200 Example Ave', 'New York', '10001', 'Americas', 'US', 'Supplier works, Newark', 'US', 40.7357, -74.1724, 40.7128, -74.0060,
     'road', 'DAP', -9, -5, -6, 'delivered', 900.0, 18.0, 'Dummy: deliver to the loading bay'),
    ('15000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000041', 20, 'Clinic manager', 'J. Brooks', '+1 312 555 0199',
     '1 Sample Plaza', 'Chicago', '60601', 'Americas', 'US', 'Supplier works, Newark', 'US', 40.7357, -74.1724, 41.8781, -87.6298,
     'road', 'DAP', -3, 2, null, 'in_transit', 600.0, 1150.0, null),
    ('15000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000050', 'b5000000-0000-4000-8000-000000000032', 80, 'Store manager', 'L. Tan', '+65 5550 1000',
     '2 Demo Road', 'Singapore', '238801', 'APAC', 'SG', 'Northwind dispatch', 'SG', 1.3290, 103.8930, 1.3048, 103.8318,
     'courier', 'DAP', 2, 4, null, 'booked', 64.0, 9.0, 'Dummy: before 10am'),
    ('15000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000050', 'b5000000-0000-4000-8000-000000000032', 40, 'Mall operations', 'R. Lim', '+65 5550 2000',
     '10 Sample Bayfront', 'Singapore', '018956', 'APAC', 'SG', 'Northwind dispatch', 'SG', 1.3290, 103.8930, 1.2834, 103.8607,
     'courier', 'DAP', -1, 1, null, 'dispatched', 32.0, 7.5, null)
  ) v(id, po, spec, qty, recipient, contact, phone, addr, city, pc, region, market, origin, omarket, olat, olon, dlat, dlon, method, inco, disp, due, delivered, status, kg, km, note)
  join public.purchase_orders p on p.id = v.po::uuid;

insert into public.shipments (id, delivery_id, supplier_id, carrier_record_id, carrier_code, service_level, tracking_reference, dispatch_date, actual_delivery_date,
  quantity_shipped, gross_weight_kg, pod_status, pod_received_at, pod_checklist, pod_verified_at, recorded_by_vendor, notes)
select v.id::uuid, v.del::uuid, d.supplier_id, (select id from public.library_records where library_key = 'carriers' and code = v.carrier and status = 'active'), v.carrier,
  v.svc, v.trk, current_date + v.disp, case when v.arr is not null then current_date + v.arr end, v.qty, v.kg, v.pod,
  case when v.pod in ('received','verified') then now() - interval '5 days' end,
  case when v.pod = 'verified' then (select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'version', r.version, 'record_id', r.id,
      'mandatory', coalesce((r.data->>'mandatory')::boolean, true), 'passed', true) order by r.code)
      from public.library_records r where r.library_key = 'pod_checklist' and r.status = 'active') else '[]'::jsonb end,
  case when v.pod = 'verified' then now() - interval '5 days' end, true, 'Dummy shipment'
  from (values
    ('15100000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'CAR-UPS', 'Ground', '1Z999DEMO0001', -8, -6, 30, 905.0, 'verified'),
    ('15100000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000002', 'CAR-UPS', 'Ground', '1Z999DEMO0002', -3, -1, 20, 610.0, 'received'),
    ('15100000-0000-4000-8000-000000000004', '15000000-0000-4000-8000-000000000004', 'CAR-DHL', 'Same day', 'DHLDEMO0004', -1, null, 40, 31.5, 'not_received')
  ) v(id, del, carrier, svc, trk, disp, arr, qty, kg, pod)
  join public.deliveries d on d.id = v.del::uuid;

-- POD files (1-page dummy PDFs) on the two shipments that have one.
insert into public.files (id, module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, content, label, uploaded_by_vendor)
select v.id::uuid, 'logistics', 'shipment', v.ship, s.supplier_id, v.name, 'application/pdf', length(convert_to(v.body, 'UTF8')), convert_to(v.body, 'UTF8'), 'POD', true
  from (values
    ('15200000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-000000000001', 'POD-1Z999DEMO0001.pdf', '%PDF-1.4 dummy proof of delivery, signed J. Doe'),
    ('15200000-0000-4000-8000-000000000002', '15100000-0000-4000-8000-000000000002', 'POD-1Z999DEMO0002.pdf', '%PDF-1.4 dummy proof of delivery, stamp only')
  ) v(id, ship, name, body)
  join public.shipments s on s.id = v.ship::uuid;
update public.shipments set pod_file_id = '15200000-0000-4000-8000-000000000001' where id = '15100000-0000-4000-8000-000000000001';
update public.shipments set pod_file_id = '15200000-0000-4000-8000-000000000002' where id = '15100000-0000-4000-8000-000000000002';

insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
select carrier_record_id, 'shipments', id::text, shipment_number from public.shipments where carrier_record_id is not null and id::text like '15100000-%'
on conflict do nothing;

-- Legs for the in-transit US shipment.
insert into public.shipment_legs (shipment_id, sequence, from_location, to_location, mode, carrier_code, planned_departure, actual_departure, planned_arrival, actual_arrival) values
  ('15100000-0000-4000-8000-000000000002', 1, 'Supplier works, Newark', 'UPS hub, Secaucus', 'road', 'CAR-UPS', current_date - 3, current_date - 3, current_date - 3, current_date - 3),
  ('15100000-0000-4000-8000-000000000002', 2, 'UPS hub, Secaucus', 'UPS hub, Chicago', 'road', 'CAR-UPS', current_date - 2, current_date - 2, current_date, null),
  ('15100000-0000-4000-8000-000000000002', 3, 'UPS hub, Chicago', 'Clinic, Chicago', 'road', 'CAR-UPS', current_date + 1, null, current_date + 2, null);

-- Transport CO2e snapshot for the delivered delivery (factor version in force on the delivery date).
select public._logistics_emission_snapshot('15000000-0000-4000-8000-000000000001', 'Delivered (demo)');

insert into public.logistics_events (delivery_id, shipment_id, event, detail, at) values
  ('15000000-0000-4000-8000-000000000001', null, 'created', '{"demo":true}', now() - interval '12 days'),
  ('15000000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-000000000001', 'shipment_recorded', '{"quantity":30,"carrier":"CAR-UPS","by_vendor":true}', now() - interval '8 days'),
  ('15000000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-000000000001', 'pod_verified', '{"checks":8}', now() - interval '5 days'),
  ('15000000-0000-4000-8000-000000000001', null, 'delivered', '{"note":"All PODs verified"}', now() - interval '5 days'),
  ('15000000-0000-4000-8000-000000000002', '15100000-0000-4000-8000-000000000002', 'shipment_recorded', '{"quantity":20,"carrier":"CAR-UPS","by_vendor":true}', now() - interval '3 days'),
  ('15000000-0000-4000-8000-000000000002', '15100000-0000-4000-8000-000000000002', 'pod_received', '{"by_vendor":true}', now() - interval '1 day'),
  ('15000000-0000-4000-8000-000000000004', '15100000-0000-4000-8000-000000000004', 'shipment_recorded', '{"quantity":40,"carrier":"CAR-DHL","by_vendor":true}', now() - interval '1 day');

select set_config('sourcing.system_write', 'off', false);
