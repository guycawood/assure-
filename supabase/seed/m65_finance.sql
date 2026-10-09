-- DUMMY DATA for Finance+. Every invoice, amount, reference and person here is made up.
-- Loaded after m40_sourcing.sql (jobs, estimates, POs), m50_logistics.sql (deliveries, PODs) and m60_execution.sql (installs).
-- Rows are written directly (the seed runs before any user exists); the app's own writes go through the checked functions.
-- The three-way match is computed with the same server-side function the app uses (_finance_compute_match).
select set_config('sourcing.system_write', 'on', false);

-- ---------------------------------------------------------------------------
-- Finance rules (new codes only)
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from)
select 'finance_rules', v.code, v.name, v.data::jsonb, 'active', date '2026-01-01'
  from (values
    ('FR-TOL', 'Invoice match tolerance', '{"value":2,"unit":"percent","note":"Total invoiced on a PO may exceed the PO value by up to this much"}'),
    ('FR-TERMS', 'Default supplier payment terms', '{"value":30,"unit":"days","note":"Used when the supplier has no terms in Assure+"}'),
    ('FR-DUE-WINDOW', 'Payments shown as due', '{"value":7,"unit":"days","note":"Unpaid instalments due within this many days show as due"}'),
    ('FR-CLIENT-TERMS', 'Client payment terms', '{"value":30,"unit":"days","note":"Due date on client bills"}'),
    ('FR-MIN-MARGIN', 'Minimum margin before finance review', '{"value":10,"unit":"percent"}'),
    ('FR-REVIEW-VALUE', 'Estimate value needing finance review', '{"value":10000,"unit":"EUR"}')
  ) v(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'finance_rules' and r.code = v.code);

-- ---------------------------------------------------------------------------
-- Extra finished orders for the finance demo (dummy jobs, estimates and accepted POs)
-- ---------------------------------------------------------------------------
insert into public.jobs (id, title, client_id, billing_entity_id, region, market, category, campaign_name, brand, budget, currency, opened_date, target_delivery_date, status, notes) values
  ('65000000-0000-4000-8000-000000000001', 'Amstel bar runners', 'c5000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000002', 'EMEA', 'Netherlands', 'Print', 'Amstel on-trade', 'Amstel', 7000, 'EUR', current_date - 70, current_date - 20, 'delivered', 'Dummy job'),
  ('65000000-0000-4000-8000-000000000002', 'Clinic leaflet dispensers', 'c5000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000002', 'EMEA', 'Germany', 'Fixtures', 'Clinic visibility', null, 5000, 'EUR', current_date - 90, current_date - 45, 'delivered', 'Dummy job'),
  ('65000000-0000-4000-8000-000000000003', 'Knorr shelf strips', 'c5000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 'EMEA', 'Germany', 'Print', 'Knorr winter', 'Knorr', 3000, 'EUR', current_date - 120, current_date - 80, 'closed', 'Dummy job'),
  ('65000000-0000-4000-8000-000000000004', 'Heineken festival bar kit', 'c5000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000002', 'EMEA', 'Germany', 'Fixtures', 'Festival season 2027', 'Heineken', 14000, 'EUR', current_date - 5, current_date + 60, 'quoting', 'Dummy job')
on conflict (id) do nothing;

insert into public.estimates (id, job_id, supplier_id, source, currency, base_cost, benchmark_value, benchmark_source, pricing_mode, pricing_percent,
  savings_vs_benchmark, savings_target_percent, selection_reason, status, client_order_ref, sent_at, approved_at, region, market)
select v.id::uuid, v.job::uuid, s.id, 'adopt', 'EUR', v.cost, v.bench, 'rate_card', 'markup', v.pct, v.bench - v.cost, 5, 'Dummy: rate-card price',
       v.status, v.ref, now() - (v.age || ' days')::interval, case when v.status = 'approved' then now() - ((v.age - 2) || ' days')::interval end, 'EMEA', v.market
  from (values
    ('65100000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', 'DEMO-015', 5800, 6200, 14, 'approved', 'HNK-PO-2026-151', 65, 'Netherlands'),
    ('65100000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000002', 'DEMO-019', 4800, 5000, 12, 'approved', 'CPL-77402', 85, 'Germany'),
    ('65100000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000003', 'DEMO-024', 2500, 2650, 15, 'approved', 'UL-PO-44102', 115, 'Germany'),
    -- Waiting for a finance review: big and thin (over FR-REVIEW-VALUE, margin under FR-MIN-MARGIN).
    ('65100000-0000-4000-8000-000000000004', '65000000-0000-4000-8000-000000000004', 'DEMO-024', 12800, 13200, 7, 'draft', null, 2, 'Germany')
  ) v(id, job, sup, cost, bench, pct, status, ref, age, market)
  join public.suppliers s on s.supplier_code = v.sup
on conflict (id) do nothing;

insert into public.purchase_orders (id, job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, status, required_doa_level, doa_record_id,
  doa_basis, approver_doa_level, approved_at, vendor_responded_at, region, market, notes)
select v.id::uuid, e.job_id, e.id, e.supplier_id, 'EUR', e.base_cost, current_date - v.age, current_date - v.age + 25, 'accepted', 0,
       (select id from public.library_records where library_key = 'doa_levels' and code = 'L0' and status = 'active'),
       'Dummy: from the DOA matrix in force', 2, now() - (v.age || ' days')::interval, now() - ((v.age - 1) || ' days')::interval, 'EMEA', e.market, 'Dummy PO'
  from (values
    ('65200000-0000-4000-8000-000000000001', '65100000-0000-4000-8000-000000000001', 60),
    ('65200000-0000-4000-8000-000000000002', '65100000-0000-4000-8000-000000000002', 80),
    ('65200000-0000-4000-8000-000000000003', '65100000-0000-4000-8000-000000000003', 110)
  ) v(id, est, age)
  join public.estimates e on e.id = v.est::uuid
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Supplier invoices, one per state
-- ---------------------------------------------------------------------------
insert into public.supplier_invoices (id, po_id, supplier_id, job_id, invoice_number, invoice_date, payment_terms, payment_terms_days, due_date, currency,
  net_amount, vat_amount, region, market, submitted_by_vendor, submitted_at)
select v.id::uuid, p.id, p.supplier_id, p.job_id, v.num, current_date - v.age, coalesce(sp.payment_terms, 'net_30'),
       coalesce(case sp.payment_terms when 'immediate' then 0 when 'custom' then sp.payment_terms_days else replace(sp.payment_terms, 'net_', '')::int end, 30),
       current_date - v.age + coalesce(case sp.payment_terms when 'immediate' then 0 when 'custom' then sp.payment_terms_days else replace(sp.payment_terms, 'net_', '')::int end, 30),
       p.currency, v.net, v.vat, m.region_code, m.code, true, now() - (v.age || ' days')::interval
  from (values
    -- Missing evidence: one delivery still in transit with its POD unverified, installs not finished (Logistics+ / Execution+ seed).
    ('65300000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000004', 'CO-2026-2291', 9000.00, 0.00, 3),
    -- Just arrived from the demo vendor (Wei Chen, Northwind Print Co): waiting to be matched.
    ('65300000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000050', 'NW-INV-1140', 1140.00, 102.60, 1),
    -- Variance: invoiced 5.5% above the PO value.
    ('65300000-0000-4000-8000-000000000003', '65200000-0000-4000-8000-000000000001', 'HB-77310', 6119.00, 1162.61, 6),
    -- Approved on an override, scheduled in two instalments (one paid, one overdue).
    ('65300000-0000-4000-8000-000000000004', '65200000-0000-4000-8000-000000000002', 'VW/2026/0193', 4800.00, 912.00, 40),
    -- Paid in full.
    ('65300000-0000-4000-8000-000000000005', '65200000-0000-4000-8000-000000000003', 'CO-2026-1984', 2500.00, 475.00, 75)
  ) v(id, po, num, net, vat, age)
  join public.purchase_orders p on p.id = v.po::uuid
  left join public.supplier_profiles sp on sp.supplier_id = p.supplier_id
  join public.markets m on m.code = upper(p.market) or lower(m.name) = lower(p.market)
 where not exists (select 1 from public.supplier_invoices x where x.id = v.id::uuid);

-- Invoice PDFs (dummy one-line files) attached to each invoice.
insert into public.files (id, module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, content, label, uploaded_by_vendor)
select ('65400000-0000-4000-8000-00000000000' || right(i.id::text, 1))::uuid, 'finance', 'supplier_invoice', i.id::text, i.supplier_id,
       'Invoice-' || replace(i.invoice_number, '/', '-') || '.pdf', 'application/pdf',
       length(convert_to('%PDF-1.4 dummy invoice ' || i.invoice_number, 'UTF8')), convert_to('%PDF-1.4 dummy invoice ' || i.invoice_number, 'UTF8'), 'Invoice', true
  from public.supplier_invoices i where i.id::text like '65300000-%'
on conflict (id) do nothing;
update public.supplier_invoices set file_id = ('65400000-0000-4000-8000-00000000000' || right(id::text, 1))::uuid where id::text like '65300000-%' and file_id is null;

-- Run the real three-way match on everything except the brand-new one.
select public._finance_compute_match(id) from public.supplier_invoices where id::text like '65300000-%' and id <> '65300000-0000-4000-8000-000000000002';

update public.supplier_invoices set status = 'matching' where id in ('65300000-0000-4000-8000-000000000001', '65300000-0000-4000-8000-000000000003');
update public.supplier_invoices set status = 'scheduled', override_reason = 'Dummy: goods received before Logistics+ went live; buyer confirmed by email',
  override_requested_at = now() - interval '36 days', approved_at = now() - interval '35 days', approval_note = 'Dummy: override approved'
 where id = '65300000-0000-4000-8000-000000000004';
update public.supplier_invoices set status = 'paid', override_reason = 'Dummy: delivered and installed before Finance+ went live',
  override_requested_at = now() - interval '70 days', approved_at = now() - interval '69 days', paid_at = now() - interval '40 days'
 where id = '65300000-0000-4000-8000-000000000005';

insert into public.payment_schedule_items (id, invoice_id, seq, due_date, amount, currency, paid_at, paid_on, payment_reference)
select v.id::uuid, i.id, v.seq, current_date + v.due, round(i.gross_amount * v.share, 2), i.currency,
       case when v.ref is not null then now() + (v.due || ' days')::interval end, case when v.ref is not null then current_date + v.due end, v.ref
  from (values
    ('65500000-0000-4000-8000-000000000001', '65300000-0000-4000-8000-000000000004', 1, -25, 0.5, 'BACS-DEMO-55120'),
    ('65500000-0000-4000-8000-000000000002', '65300000-0000-4000-8000-000000000004', 2, -3, 0.5, null),
    ('65500000-0000-4000-8000-000000000003', '65300000-0000-4000-8000-000000000005', 1, -40, 1.0, 'BACS-DEMO-54871')
  ) v(id, inv, seq, due, share, ref)
  join public.supplier_invoices i on i.id = v.inv::uuid
on conflict (id) do nothing;

-- History (actor unknown in the seed).
insert into public.finance_events (entity, entity_id, invoice_id, event, from_status, to_status, detail, at)
select 'invoice', i.id, i.id, v.event, v.f, v.t, v.detail::jsonb, i.submitted_at + (v.after || ' hours')::interval
  from public.supplier_invoices i
  join (values
    ('submitted', null, 'submitted', '{"by_vendor":true}', 0, 'all'),
    ('matched', 'submitted', 'matching', '{}', 20, 'matched'),
    ('override_requested', 'matching', 'matching', '{"reason":"Dummy override"}', 40, 'override'),
    ('approved', 'matching', 'approved', '{"override":true}', 50, 'override'),
    ('payment_scheduled', 'approved', 'scheduled', '{}', 60, 'override'),
    ('paid', 'scheduled', 'paid', '{"reference":"BACS-DEMO-54871"}', 840, 'paid')
  ) v(event, f, t, detail, after, applies) on
     v.applies = 'all'
  or (v.applies = 'matched' and i.status <> 'submitted')
  or (v.applies = 'override' and i.status in ('scheduled','paid'))
  or (v.applies = 'paid' and i.status = 'paid')
 where i.id::text like '65300000-%'
   and not exists (select 1 from public.finance_events e where e.invoice_id = i.id);

-- ---------------------------------------------------------------------------
-- Client bills from approved estimates
-- ---------------------------------------------------------------------------
insert into public.client_bills (id, estimate_id, job_id, client_id, billing_entity_id, client_order_ref, currency, net_amount, vat_percent, vat_amount, cost_amount,
  status, issue_date, due_date, sent_at, paid_at, payment_reference, region, market, notes)
select v.id::uuid, e.id, e.job_id, j.client_id, j.billing_entity_id, e.client_order_ref, e.currency, e.sell_price, v.vat, round(e.sell_price * v.vat / 100, 2), e.base_cost,
       v.status, case when v.status <> 'draft' then current_date - v.age end, case when v.status <> 'draft' then current_date - v.age + 30 end,
       case when v.status <> 'draft' then now() - (v.age || ' days')::interval end,
       case when v.status = 'paid' then now() - ((v.age - 25) || ' days')::interval end, case when v.status = 'paid' then 'CLIENT-DEMO-9921' end,
       m.region_code, m.code, 'Dummy bill'
  from (values
    ('65600000-0000-4000-8000-000000000001', '65100000-0000-4000-8000-000000000003', 'paid', 19, 100),
    ('65600000-0000-4000-8000-000000000002', '65100000-0000-4000-8000-000000000002', 'sent', 19, 20),
    ('65600000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000004', 'draft', 0, 0)
  ) v(id, est, status, vat, age)
  join public.estimates e on e.id = v.est::uuid
  join public.jobs j on j.id = e.job_id
  join public.markets m on m.code = upper(e.market) or lower(m.name) = lower(e.market)
on conflict (id) do nothing;

insert into public.finance_events (entity, entity_id, event, from_status, to_status, detail, at)
select 'bill', b.id, 'created', null, 'draft', jsonb_build_object('net', b.net_amount), b.created_at
  from public.client_bills b where b.id::text like '65600000-%' and not exists (select 1 from public.finance_events e where e.entity_id = b.id);

select set_config('sourcing.system_write', 'off', false);
