-- DUMMY DATA: QA/QC threshold management, OTIF and speed to market (migrations 20261026000001-3). Runs last.
-- Every body, person and document here is made up. Approved bodies are fictional names.
-- Rows are written directly (the seed may run before any user exists); the app's own writes go through the checked
-- functions. Safe to apply on an existing demo database: everything is guarded by "not exists" / idempotent updates.
select set_config('sourcing.system_write', 'on', false);

-- ---------------------------------------------------------------------------
-- Approved bodies (fictional) and approval policies
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'qaqc_approved_bodies', x.code, x.name, x.data::jsonb, 'active', date '2026-01-01', 'Demo (fictional body)'
  from (values
    ('ADM-QC', 'adm Indicia QC team', '{"body_type":"inspection_agency","accreditation":"Internal QC (ISO 9001 system)","markets":["GB","NL","DE","US","SG"],"accredited_until":"2027-12-31"}'),
    ('NBTL', 'Northbridge Testing Labs', '{"body_type":"lab","accreditation":"ISO/IEC 17025","scopes":["food contact migration","toy safety","electrical safety"],"accredited_until":"2027-06-30"}'),
    ('MERIDIAN', 'Meridian Inspection Services', '{"body_type":"inspection_agency","accreditation":"ISO/IEC 17020","markets":["CN","VN","US","GB","DE"],"accredited_until":"2027-03-31"}'),
    ('CASTELLAN', 'Castellan Certification', '{"body_type":"certification_body","accreditation":"ISO/IEC 17065 / 17021","scopes":["FSC chain of custody","recycled content","factory audit"],"accredited_until":"2028-01-31"}'),
    ('HARBOURLINE', 'Harbourline Audit Group', '{"body_type":"certification_body","accreditation":"ISO/IEC 17021 (lapsed)","accredited_until":"2026-05-31"}')
  ) x(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'qaqc_approved_bodies' and r.code = x.code);

insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'approval_policies', x.code, x.name, x.data::jsonb, 'active', date '2026-01-01', 'Demo policy (QA/QC)'
  from (values
    ('AP-QAQC-VERIFY', 'QA/QC evidence verification', '{"module":"orders","approval_type":"QAQC_VERIFY","approver_role":"quality","maker_checker":true,"sla_days":2,"description":"QA/QC evidence that did not auto-verify (or any L4/L5 evidence) is verified or rejected by a quality role, never the uploader.","decided_in":"qaqc_review_checkpoint","where_in_ui":"/orders/purchase-orders/<po>#qaqc"}'),
    ('AP-QAQC-LOWER', 'Lower a QA/QC level below the rules', '{"module":"orders","approval_type":"QAQC_LOWER","approver_role":"quality","maker_checker":true,"sla_days":2,"description":"Setting a plan below the level the threshold rules computed needs a second person with a quality role.","decided_in":"qaqc_set_level, approval_request_decide","where_in_ui":"/orders/purchase-orders/<po>#qaqc"}'),
    ('AP-QAQC-WAIVE', 'Waive QA/QC on a plan', '{"module":"orders","approval_type":"QAQC_WAIVE","approver_role":"quality","maker_checker":true,"sla_days":3,"description":"Waiving a QA/QC plan (e.g. a client concession) so the job can close needs a quality role.","decided_in":"qaqc_request_waiver, approval_request_decide","where_in_ui":"/orders/purchase-orders/<po>#qaqc"}')
  ) x(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'approval_policies' and r.code = x.code);

-- Coloplast's contract asks for production control (L3) or above on every line.
update public.sourcing_clients set qa_min_level = 3 where code = 'CPL' and qa_min_level is null;

-- ---------------------------------------------------------------------------
-- Journey timestamps: the earlier demo seeds created rows "now"; move them to when they happened
-- ---------------------------------------------------------------------------
update public.jobs set created_at = (opened_date + time '09:00')::timestamptz where created_at::date > opened_date;
-- Jobs opened "today" by earlier seeds but already ordered: created before their first RFQ, estimate and PO.
update public.jobs j set created_at = x.at from (
    select j2.id, least((select min(p.po_date) from public.purchase_orders p where p.job_id = j2.id) - 14 + time '09:00',
                        (select min(r.sent_at) from public.rfqs r where r.job_id = j2.id) - interval '3 days',
                        (select min(e.sent_at) from public.estimates e where e.job_id = j2.id) - interval '7 days') as at
      from public.jobs j2) x
 where x.id = j.id and x.at is not null and x.at < j.created_at;
update public.job_specs s set created_at = least(s.created_at, j.created_at + interval '1 day')
  from public.jobs j where j.id = s.job_id and s.created_at > j.created_at + interval '1 day';
update public.spec_triage t set decided_at = s.created_at + interval '2 days'
  from public.job_specs s where s.id = t.spec_id and t.decided_at > s.created_at + interval '2 days'
   and exists (select 1 from public.purchase_orders p where p.job_id = s.job_id and p.po_date < current_date - 7);
update public.spec_triage t set decided_at = least(t.decided_at, (j.opened_date + 3 + time '11:00')::timestamptz)
  from public.job_specs s join public.jobs j on j.id = s.job_id where s.id = t.spec_id and t.decided_at::date > j.opened_date + 3 and j.opened_date < current_date - 10;
-- Briefs behind the two delivered Heineken jobs: submitted and approved before the job opened.
update public.briefs b set submitted_at = (j.opened_date - 12 + time '10:00')::timestamptz, reviewed_at = (j.opened_date - 9 + time '15:30')::timestamptz,
       approval_status = coalesce(b.approval_status, 'approved')
  from public.jobs j where j.brief_id = b.id and j.id in ('a9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000002')
   and (b.submitted_at is null or b.submitted_at > (j.opened_date + time '09:00')::timestamptz);
update public.ideation_concepts c set decided_at = b.reviewed_at + interval '3 days',
       client_decided_at = case when c.client_decided_at is not null then b.reviewed_at + interval '5 days' end
  from public.briefs b join public.jobs j on j.brief_id = b.id
 where c.brief_id = b.id and c.status = 'approved' and j.id in ('a9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000002')
   and c.decided_at > (j.opened_date + time '09:00')::timestamptz;
update public.client_pos cp set created_at = e.approved_at - interval '1 hour'
  from public.estimates e where e.id = cp.estimate_id and e.approved_at is not null and cp.created_at > e.approved_at + interval '1 day';
update public.estimates e set sent_at = least(e.sent_at, e.approved_at - interval '2 days') where e.approved_at is not null and e.sent_at > e.approved_at;
-- Re-run the timestamp backfills of 20261026000002 (on a fresh build the earlier seeds ran after that migration).
update public.purchase_orders set issued_at = approved_at where issued_at is null and approved_at is not null and status in ('issued','accepted','declined');
update public.shipments set pod_captured_at = coalesce(case when actual_delivery_date is not null and actual_delivery_date < coalesce(pod_received_at::date, current_date)
    then (actual_delivery_date + time '12:00')::timestamptz end, pod_received_at),
  pod_time_stated = actual_delivery_date is not null and actual_delivery_date < coalesce(pod_received_at::date, current_date)
 where pod_captured_at is null and pod_status in ('received','verified');
update public.deliveries d set delivered_at = coalesce(
    (select max(s.pod_captured_at) from public.shipments s where s.delivery_id = d.id and s.pod_status <> 'rejected'),
    (d.actual_delivery_date + time '12:00')::timestamptz)
 where d.status = 'delivered' and d.delivered_at is null;
update public.jobs j set production_started_at = x.at from (
    select job_id, min(at) at from public.sourcing_events where entity = 'job' and event = 'status_changed' and detail->>'to' = 'in_production' group by job_id) x
 where x.job_id = j.id and j.production_started_at is null;
update public.jobs j set delivered_at = x.at from (
    select job_id, min(at) at from public.sourcing_events where entity = 'job' and event = 'status_changed' and detail->>'to' = 'delivered' group by job_id) x
 where x.job_id = j.id and j.delivered_at is null;
-- Jobs moved on by earlier seeds without an event: production started when the vendor accepted; delivered on the target date.
update public.jobs j set production_started_at = (select min(p.vendor_responded_at) from public.purchase_orders p where p.job_id = j.id and p.status = 'accepted')
 where j.production_started_at is null and j.status in ('in_production','delivered','closed');
update public.jobs j set delivered_at = (coalesce(j.target_delivery_date, j.opened_date + 40) + time '14:00')::timestamptz
 where j.delivered_at is null and j.status in ('delivered','closed') and coalesce(j.target_delivery_date, j.opened_date + 40) <= current_date;
update public.jobs j set closed_at = j.delivered_at + interval '12 days' where j.status = 'closed' and j.closed_at is not null and j.delivered_at is not null
   and (j.closed_at < j.delivered_at or j.closed_at::date = current_date);

-- ---------------------------------------------------------------------------
-- Deliveries with POD timestamps: one late, one short-shipped (Heineken jobs)
-- ---------------------------------------------------------------------------
insert into public.deliveries (id, po_id, job_id, supplier_id, spec_id, quantity, uom, recipient_name, address_line, city, postcode, region, market,
  delivery_method, incoterm, planned_dispatch_date, planned_delivery_date, actual_delivery_date, status, gross_weight_kg, distance_km, delivered_at, special_instructions)
select v.id::uuid, p.id, p.job_id, p.supplier_id, v.spec::uuid, v.qty, 'units', v.recipient, v.addr, v.city, v.pc, 'EMEA', v.market, 'road', 'DAP',
       current_date + v.disp, current_date + v.due, current_date + v.arr, 'delivered', v.kg, v.km,
       (current_date + v.arr + v.tm)::timestamptz, 'Dummy delivery (QA/QC and OTIF demo)'
  from (values
    ('95000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000011', 50, 'Store receiving', '1 Example Way', 'Leeds', 'LS1 1AA', 'GB', -13, -10, -8, time '10:40', 825.0, 310.0),
    ('95000000-0000-4000-8000-000000000002', 'f9000000-0000-4000-8000-000000000003', 'b9000000-0000-4000-8000-000000000021', 20000, 'Co-packer goods in', '5 Sample Kade', 'Utrecht', '3511 AA', 'NL', -50, -45, -46, time '08:15', 960.0, 45.0)
  ) v(id, po, spec, qty, recipient, addr, city, pc, market, disp, due, arr, tm, kg, km)
  join public.purchase_orders p on p.id = v.po::uuid
 where not exists (select 1 from public.deliveries d where d.id = v.id::uuid);

insert into public.shipments (id, delivery_id, supplier_id, carrier_code, service_level, tracking_reference, dispatch_date, actual_delivery_date, quantity_shipped,
  gross_weight_kg, pod_status, pod_received_at, pod_captured_at, pod_time_stated, pod_verified_at, recorded_by_vendor, notes)
select v.id::uuid, v.del::uuid, d.supplier_id, null, 'Pallet', v.trk, current_date + v.disp, current_date + v.arr, v.qty, v.kg, 'verified',
       (current_date + v.arr + 1 + time '09:00')::timestamptz, (current_date + v.arr + v.tm)::timestamptz, true, (current_date + v.arr + 2 + time '11:00')::timestamptz,
       true, v.note
  from (values
    ('95100000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'PLT-95-0001', -13, -8, 50, 825.0, time '10:40', 'Dummy: arrived two days after the promised date'),
    ('95100000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', 'PLT-95-0002', -50, -46, 19200, 921.6, time '08:15', 'Dummy: 800 sleeves short (damaged at the printer)')
  ) v(id, del, trk, disp, arr, qty, kg, tm, note)
  join public.deliveries d on d.id = v.del::uuid
 where not exists (select 1 from public.shipments s where s.id = v.id::uuid);

update public.shipments s set pod_checklist = (select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'version', r.version, 'record_id', r.id,
      'mandatory', coalesce((r.data->>'mandatory')::boolean, true), 'passed', true) order by r.code), '[]'::jsonb)
      from public.library_records r where r.library_key = 'pod_checklist' and r.status = 'active')
 where s.id in ('95100000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000002') and s.pod_checklist = '[]'::jsonb;

insert into public.files (id, module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, content, label, uploaded_by_vendor)
select v.id::uuid, 'logistics', 'shipment', v.ship, s.supplier_id, v.name, 'application/pdf', length(convert_to(v.body, 'UTF8')), convert_to(v.body, 'UTF8'), 'POD', true
  from (values
    ('95200000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000001', 'POD-PLT-95-0001.pdf', '%PDF-1.4 dummy POD, signed 10:40'),
    ('95200000-0000-4000-8000-000000000002', '95100000-0000-4000-8000-000000000002', 'POD-PLT-95-0002.pdf', '%PDF-1.4 dummy POD, 19,200 received, 800 short noted')
  ) v(id, ship, name, body)
  join public.shipments s on s.id = v.ship::uuid
 where not exists (select 1 from public.files f where f.id = v.id::uuid);
update public.shipments set pod_file_id = '95200000-0000-4000-8000-000000000001' where id = '95100000-0000-4000-8000-000000000001' and pod_file_id is null;
update public.shipments set pod_file_id = '95200000-0000-4000-8000-000000000002' where id = '95100000-0000-4000-8000-000000000002' and pod_file_id is null;

-- ---------------------------------------------------------------------------
-- QA/QC plans on every issued or accepted PO (as if created when each PO was issued)
-- ---------------------------------------------------------------------------
select public._qaqc_create_plans(p.id) from public.purchase_orders p
 where p.status in ('issued','accepted') and not exists (select 1 from public.qaqc_plans q where q.po_id = p.id);
update public.qaqc_plans q set created_at = coalesce(p.issued_at, (p.po_date + time '09:00')::timestamptz)
  from public.purchase_orders p where p.id = q.po_id and q.created_at::date = current_date and p.po_date < current_date;

-- Demo helper (dropped at the end): submit evidence on a PO's checkpoint and run the verification at upload.
create or replace function public._m95_submit(p_po uuid, p_checkpoint text, p_items jsonb, p_result text, p_days_ago int) returns uuid
language plpgsql as $$
declare c public.qaqc_checkpoints; x jsonb; v_file uuid; n int; i int; v_sup uuid;
begin
  select ck.* into c from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id
   where pl.po_id = p_po and ck.checkpoint = p_checkpoint order by pl.plan_ref limit 1;
  if c.id is null or c.submission_count > 0 then return c.id; end if;
  select pl.supplier_id into v_sup from public.qaqc_plans pl where pl.id = c.plan_id;
  for x in select * from jsonb_array_elements(p_items) loop
    n := coalesce((x->>'count')::int, 1);
    for i in 1..n loop
      insert into public.files (module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, content, label, uploaded_by_vendor, created_at)
      values ('orders', 'qaqc_checkpoint', c.id::text, v_sup, coalesce(x->>'file', lower(x->>'type')) || case when n > 1 then '-' || i else '' end
                || case when coalesce(x->>'ctype', 'application/pdf') like 'image/%' then '.jpg' else '.pdf' end,
              coalesce(x->>'ctype', 'application/pdf'), 40, convert_to('dummy QA/QC evidence ' || (x->>'type'), 'UTF8'), x->>'type', true,
              now() - make_interval(days => p_days_ago))
      returning id into v_file;
      insert into public.qaqc_evidence (checkpoint_id, plan_id, supplier_id, submission_no, evidence_type, evidence_record_id, file_id, issued_on, expires_on,
        inspection_date, body_code, body_record_id, body_name, certificate_number, sample_size, defects_critical, defects_major, defects_minor, result,
        uploaded_by_vendor, created_at)
      values (c.id, c.plan_id, v_sup, 1, x->>'type', (select id from public.library_effective('qaqc_evidence_types', x->>'type', current_date)), v_file,
        current_date - nullif(x->>'issued_ago', '')::int, current_date + nullif(x->>'expires_in', '')::int, current_date - nullif(x->>'inspected_ago', '')::int,
        x->>'body', (select id from public.library_effective('qaqc_approved_bodies', x->>'body', current_date)),
        (select name from public.library_effective('qaqc_approved_bodies', x->>'body', current_date)), x->>'cert',
        nullif(x->>'sample', '')::int, nullif(x->>'critical', '')::int, nullif(x->>'major', '')::int, nullif(x->>'minor', '')::int, x->>'result',
        true, now() - make_interval(days => p_days_ago));
    end loop;
  end loop;
  update public.qaqc_checkpoints set submission_count = 1, submitted_at = now() - make_interval(days => p_days_ago), submitted_by_vendor = true,
    submission = jsonb_build_object('result', p_result, 'notes', 'Dummy submission'), status = 'submitted' where id = c.id;
  perform public._qaqc_verify(c.id);
  update public.qaqc_checkpoints set verified_at = case when status = 'auto_verified' then submitted_at + interval '1 minute' else verified_at end where id = c.id;
  return c.id;
end $$;

-- A quality role (Hana Head when the user exists) signs off checkpoints that needed a review.
create or replace function public._m95_signoff(p_po uuid, p_checkpoint text, p_days_ago int, p_note text) returns void
language plpgsql as $$
declare c public.qaqc_checkpoints;
begin
  select ck.* into c from public.qaqc_checkpoints ck join public.qaqc_plans pl on pl.id = ck.plan_id where pl.po_id = p_po and ck.checkpoint = p_checkpoint limit 1;
  if c.id is null or c.status <> 'needs_review' then return; end if;
  update public.qaqc_checkpoints set status = 'verified', verified_at = now() - make_interval(days => p_days_ago), review_note = p_note,
    verified_by = (select id from public.profiles where email = 'hana.head@adm-indicia.com'), first_time_pass = (submission_count = 1 and not failed)
   where id = c.id;
  perform public._qaqc_plan_refresh(c.plan_id);
end $$;

-- L1 (lowered with approval): Knorr shelf strips, a repeat print run. A certificate of conformity auto-verified.
do $$
declare v_plan uuid; v_req uuid;
begin
  select id into v_plan from public.qaqc_plans where po_id = '65200000-0000-4000-8000-000000000003' and required_level > 1 and status = 'not_started';
  if v_plan is not null then
    insert into public.approval_requests (module, approval_type, entity_type, entity_id, ref, title, payload, approver_role, approver_module, maker_checker, run_as,
      status, reason, requested_by, requested_at, decided_by, decided_at, decision_note)
    select 'orders', 'QAQC_LOWER', 'qaqc_plan', v_plan::text, pl.plan_ref, 'Lower QA/QC from L' || pl.required_level || ' to L1 · Knorr shelf strips',
      jsonb_build_object('level', 1, 'reason', 'Repeat of an approved print run; the client accepts a certificate of conformity'), 'quality', 'orders', true, 'approver',
      'approved', 'Repeat of an approved print run; the client accepts a certificate of conformity',
      (select id from public.profiles where email = 'pedro.procurement@adm-indicia.com'), now() - interval '109 days',
      (select id from public.profiles where email = 'hana.head@adm-indicia.com'), now() - interval '108 days', 'Agreed: repeat job, same supplier and artwork'
      from public.qaqc_plans pl where pl.id = v_plan returning id into v_req;
    update public.qaqc_plans set required_level = 1, level_reason = 'Lowered to L1 with approval: repeat of an approved print run (approval request)', level_set_at = now() - interval '108 days'
     where id = v_plan;
    perform public._qaqc_build_checkpoints(v_plan);
  end if;
end $$;
select public._m95_submit('65200000-0000-4000-8000-000000000003', 'pre_shipment', '[{"type":"COC","file":"coc-knorr-strips","issued_ago":92}]', 'pass', 92);

-- L2 passed: Amstel gift pack sleeves and Amstel bar runners (self-inspection with photos, then a CoC).
select public._m95_submit('f9000000-0000-4000-8000-000000000003', 'production', '[{"type":"CHECKLIST","file":"check-sheet-sleeves"},{"type":"PHOTO_SET","file":"sleeves-photo","ctype":"image/jpeg","count":4}]', 'pass', 58);
select public._m95_submit('f9000000-0000-4000-8000-000000000003', 'pre_shipment', '[{"type":"COC","file":"coc-sleeves","issued_ago":52}]', 'pass', 52);
select public._m95_submit('65200000-0000-4000-8000-000000000001', 'production', '[{"type":"CHECKLIST","file":"check-sheet-runners"},{"type":"PHOTO_SET","file":"runners-photo","ctype":"image/jpeg","count":3}]', 'pass', 40);
select public._m95_submit('65200000-0000-4000-8000-000000000001', 'pre_shipment', '[{"type":"DECLARATION","file":"declaration-runners","issued_ago":37}]', 'pass', 37);

-- L4 passed: Heineken 0.0 gondola ends, independent inspection by Meridian, verified by a quality role.
select public._m95_submit('f9000000-0000-4000-8000-000000000001', 'mockup', '[{"type":"SAMPLE_APPROVAL","file":"gondola-mockup-approval","issued_ago":33}]', 'pass', 33);
select public._m95_submit('f9000000-0000-4000-8000-000000000001', 'production', '[{"type":"CHECKLIST","file":"gondola-production-sheet"}]', 'pass', 22);
select public._m95_submit('f9000000-0000-4000-8000-000000000001', 'pre_shipment', '[{"type":"INSPECTION_REPORT","file":"meridian-psi-gondola","inspected_ago":15,"body":"MERIDIAN","sample":32,"critical":0,"major":1,"minor":3,"result":"pass"}]', 'pass', 15);
select public._m95_signoff('f9000000-0000-4000-8000-000000000001', 'mockup', 32, 'Mock-up matches the approved render');
select public._m95_signoff('f9000000-0000-4000-8000-000000000001', 'production', 21, null);
select public._m95_signoff('f9000000-0000-4000-8000-000000000001', 'pre_shipment', 14, 'Within AQL 2.5; one major (scuffed header) reworked before shipping');

-- L5 passed: clinic leaflet dispensers (Coloplast), factory audit and certificate from Castellan, final inspection by adm Indicia QC.
select public._m95_submit('65200000-0000-4000-8000-000000000002', 'mockup', '[{"type":"SAMPLE_APPROVAL","file":"dispenser-sample-approval","issued_ago":76}]', 'pass', 76);
select public._m95_submit('65200000-0000-4000-8000-000000000002', 'production', '[{"type":"AUDIT_REPORT","file":"castellan-factory-audit","issued_ago":120,"body":"CASTELLAN","result":"pass"}]', 'pass', 70);
select public._m95_submit('65200000-0000-4000-8000-000000000002', 'pre_shipment', '[{"type":"INSPECTION_REPORT","file":"admqc-final-inspection","inspected_ago":60,"body":"ADM-QC","sample":50,"critical":0,"major":1,"minor":2,"result":"pass"},{"type":"CERTIFICATE","file":"castellan-recycled-content-cert","body":"CASTELLAN","cert":"CC-RC-2026-0412","issued_ago":200,"expires_in":300}]', 'pass', 60);
select public._m95_signoff('65200000-0000-4000-8000-000000000002', 'mockup', 75, null);
select public._m95_signoff('65200000-0000-4000-8000-000000000002', 'production', 69, 'Audit by an accredited body, valid for this order');
select public._m95_signoff('65200000-0000-4000-8000-000000000002', 'pre_shipment', 59, 'Certificate checked against the Castellan register');

-- L4 failed: Coloplast clinic displays (US). Mock-up and production signed off; the pre-shipment inspection failed AQL -> NCR.
select public._m95_submit('f5000000-0000-4000-8000-000000000004', 'mockup', '[{"type":"SAMPLE_APPROVAL","file":"clinic-display-sample","issued_ago":12}]', 'pass', 12);
select public._m95_signoff('f5000000-0000-4000-8000-000000000004', 'mockup', 11, null);
select public._m95_submit('f5000000-0000-4000-8000-000000000004', 'production', '[{"type":"CHECKLIST","file":"clinic-display-production"}]', 'pass', 6);
select public._m95_signoff('f5000000-0000-4000-8000-000000000004', 'production', 5, null);
select public._m95_submit('f5000000-0000-4000-8000-000000000004', 'pre_shipment', '[{"type":"INSPECTION_REPORT","file":"meridian-psi-clinic-display","inspected_ago":2,"body":"MERIDIAN","sample":32,"critical":0,"major":4,"minor":2,"result":"fail"}]', 'fail', 2);

-- L3 needing review: Wei Chen's window clings, raised to L3 by the account team; mock-up auto-verified, production short of photos.
do $$
declare v_plan uuid;
begin
  select id into v_plan from public.qaqc_plans where po_id = 'f5000000-0000-4000-8000-000000000050' and required_level < 3 and status = 'not_started';
  if v_plan is not null then
    update public.qaqc_plans set required_level = 3, level_reason = 'Raised: first order of window clings for this mall; the client wants AQL sampling',
      level_set_at = now() - interval '8 days' where id = v_plan;
    perform public._qaqc_build_checkpoints(v_plan);
    perform public._qaqc_event(v_plan, null, 'level_raised', jsonb_build_object('to', 3, 'reason', 'First order of window clings for this mall'));
  end if;
end $$;
select public._m95_submit('f5000000-0000-4000-8000-000000000050', 'mockup', '[{"type":"SAMPLE_APPROVAL","file":"cling-proof-approval","issued_ago":6}]', 'pass', 6);
select public._m95_submit('f5000000-0000-4000-8000-000000000050', 'production', '[{"type":"CHECKLIST","file":"cling-production-sheet"},{"type":"PHOTO_SET","file":"cling-photo","ctype":"image/jpeg","count":2}]', 'pass', 1);

-- Plan timestamps where the demo backdated the checkpoints.
update public.qaqc_plans q set passed_at = x.at from (
    select plan_id, max(verified_at) at from public.qaqc_checkpoints where status in ('verified','auto_verified') group by plan_id) x
 where x.plan_id = q.id and q.status = 'passed';
update public.ncrs n set created_at = c.submitted_at from public.qaqc_checkpoints c where c.ncr_id = n.id and n.created_at::date = current_date and c.submitted_at::date < current_date;

drop function public._m95_submit(uuid, text, jsonb, text, int);
drop function public._m95_signoff(uuid, text, int, text);
select set_config('sourcing.system_write', 'off', false);
