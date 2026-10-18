-- DUMMY DATA for the nine-stage SRM onboarding standard. Every company, person and client here is made up.
-- The demo cases are created by calling the real workflow functions as the (fictional) demo users, so every rule applies:
--   Harbour Print Finishing   submitted, waiting for Procurement triage
--   Thameside Litho Ltd       a duplicate of an existing supplier, caught and closed at triage
--   Alpine Board Systems      due diligence closed with a documented gap; risk gate waiting for the Category Manager
--   Lumen Signage Works       in contracts (stage 6)
--   Rapid Retail Fixtures     fast-track exception with an overdue remediation item: purchasing blocked (closure gate)
--   Meridian Display Group    fully onboarded through all nine stages and released

-- Fast-track needs two named approvals: the policy now names the Procurement Director, and Local Finance is added.
do $$
declare v1 public.library_records;
begin
  select * into v1 from public.library_records where library_key = 'approval_policies' and code = 'AP-FAST-TRACK' and status = 'active' order by version desc limit 1;
  if v1.id is not null and v1.data->>'approver_role' is distinct from 'procurement_director' then
    insert into public.library_records (library_key, code, name, data, version, status, effective_from, supersedes, notes)
    values ('approval_policies', 'AP-FAST-TRACK', 'Fast-track exception: Procurement Director',
      v1.data || '{"approver_role":"procurement_director","maker_checker":true,"description":"Fast-track is an exception route: the Procurement Director approves the urgency, minimum pack and restricted scope; Local Finance approves too (AP-FAST-TRACK-FIN). Never the requester.","decided_in":"fast_track_request","where_in_ui":"/assure/suppliers/<supplier>?tab=record"}'::jsonb,
      v1.version + 1, 'active', v1.effective_from, v1.id, 'Nine-stage onboarding standard')
    returning id into v1.superseded_by;
    update public.library_records set status = 'superseded', superseded_by = v1.superseded_by where id = v1.id;
  end if;
  if not exists (select 1 from public.library_records where library_key = 'approval_policies' and code = 'AP-FAST-TRACK-FIN') then
    insert into public.library_records (library_key, code, name, data, status, effective_from)
    values ('approval_policies', 'AP-FAST-TRACK-FIN', 'Fast-track exception: Local Finance',
      '{"module":"assure","approval_type":"FAST_TRACK_FINANCE","approver_role":"local_finance","maker_checker":true,"sla_days":2,"description":"Local Finance for the supplier''s market validates the set-up for the urgent transaction. Never the requester.","decided_in":"fast_track_request","where_in_ui":"/assure/suppliers/<supplier>?tab=record"}',
      'active', current_date - 1);
  end if;
end $$;

do $$
declare
  u_ada uuid := 'd0000000-0000-4000-8000-000000000001';
  u_lena uuid := 'd0000000-0000-4000-8000-000000000002';
  u_arjun uuid := 'd0000000-0000-4000-8000-000000000003';
  u_fiona uuid := 'd0000000-0000-4000-8000-000000000004';
  u_pedro uuid := 'd0000000-0000-4000-8000-000000000005';
  u_hana uuid := 'd0000000-0000-4000-8000-000000000007';
  u_dara uuid := 'd0000000-0000-4000-8000-0000000000d1';
  u_felix uuid := 'd0000000-0000-4000-8000-0000000000f2';
  v_case uuid; v_sup uuid; v_req uuid; v_job uuid; k text;
begin
  if exists (select 1 from public.onboarding_cases where proposed_name = 'Meridian Display Group') then return; end if;

  -- The people these cases are recorded by (created here if the seed runs before the app adds its demo users).
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_ada, 'ada.admin@adm-indicia.com', '{"full_name":"Ada Admin"}'), (u_lena, 'lena.lead@adm-indicia.com', '{"full_name":"Lena Lead"}'),
    (u_arjun, 'arjun.agent@adm-indicia.com', '{"full_name":"Arjun Agent"}'), (u_fiona, 'fiona.finance@adm-indicia.com', '{"full_name":"Fiona Finance"}'),
    (u_pedro, 'pedro.procurement@adm-indicia.com', '{"full_name":"Pedro Procurement"}'), (u_hana, 'hana.head@adm-indicia.com', '{"full_name":"Hana Head"}'),
    (u_dara, 'dara.director@adm-indicia.com', '{"full_name":"Dara Director"}'), (u_felix, 'felix.finance@adm-indicia.com', '{"full_name":"Felix Finance (EMEA)"}')
  on conflict (id) do nothing;
  update public.profiles set is_admin = true where id = u_ada;
  update public.profiles p set srt_role = x.r from (values (u_lena, 'lead'), (u_arjun, 'agent'), (u_fiona, 'finance'), (u_pedro, 'procurement'),
    (u_hana, 'head'), (u_dara, 'director'), (u_felix, 'finance')) x(id, r) where p.id = x.id and p.srt_role is null;
  insert into public.srm_role_scopes (user_id, role, region) values (u_fiona, 'local_finance', 'APAC'), (u_fiona, 'local_finance', 'Americas'),
    (u_felix, 'local_finance', 'EMEA') on conflict do nothing;

  -- 1. Submitted, waiting for triage.
  perform set_config('request.jwt.claim.sub', u_pedro::text, true);
  perform public.onboarding_request_submit(jsonb_build_object('business_case', 'Brightlane needs a second UK finisher for seasonal window graphics; the current finisher is at capacity in Q1.',
    'supplier_type', 'manufacturer', 'category', 'Print', 'client', 'Brightlane', 'market', 'United Kingdom', 'urgency', 'standard', 'estimated_spend', 85000,
    'proposed_name', 'Harbour Print Finishing', 'proposed_email', 'hello@harbourprint.example', 'proposed_contact', 'Sam Okafor',
    'proposed_registration', '09876543', 'proposed_vat', 'GB 987 6543 21', 'duplicate_confirmed', true));

  -- 2. Duplicate caught at triage (the requester thought it was new; Procurement links the existing supplier).
  v_case := public.onboarding_request_submit(jsonb_build_object('business_case', 'Litho printing for BAU point-of-sale reprints.',
    'supplier_type', 'manufacturer', 'category', 'Print', 'client', 'BAU', 'market', 'United Kingdom', 'urgency', 'standard', 'estimated_spend', 40000,
    'proposed_name', 'Thameside Litho Ltd', 'proposed_email', 'sales@thamesidelitho.example', 'duplicate_confirmed', true));
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  perform public.onboarding_triage(v_case, 'duplicate', null, null, 'Already onboarded as Thameside Litho (DEMO-013); use the existing supplier.',
    (select id from public.suppliers where supplier_code = 'DEMO-013'));

  -- 3. Due diligence closed with a documented gap; risk gate waiting for the Category Manager.
  perform set_config('request.jwt.claim.sub', u_pedro::text, true);
  v_case := public.onboarding_request_submit(jsonb_build_object('business_case', 'Northbrew wants a German corrugated partner for multipack trays across DACH.',
    'supplier_type', 'manufacturer', 'category', 'Packaging', 'client', 'Northbrew', 'market', 'Germany', 'urgency', 'standard', 'estimated_spend', 140000,
    'proposed_name', 'Alpine Board Systems', 'proposed_email', 'info@alpineboard.example', 'proposed_registration', 'HRB 204518', 'proposed_vat', 'DE 318 204 518',
    'duplicate_confirmed', true));
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  v_sup := public.onboarding_triage(v_case, 'approve', 'standard', 'strategic', 'Strategic for Northbrew DACH packaging.');
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  perform public.update_supplier_gate(v_sup, 'rfi', 'verified', null, false, 'Information request complete');
  perform public.update_supplier_gate(v_sup, 'registration', 'verified', null, false, 'Handelsregister extract and VAT checked in VIES');
  perform public.update_supplier_gate(v_sup, 'capability', 'verified', null, false, 'Two corrugators, die-cutting, 3-shift capacity');
  perform public.update_supplier_gate(v_sup, 'quality', 'verified', current_date + 300, false, 'ISO 9001 certificate');
  perform public.update_supplier_gate(v_sup, 'environment', 'verified', current_date + 400, false, 'FSC chain of custody');
  perform public.update_supplier_gate(v_sup, 'sustainability', 'verified', current_date + 200, false, 'EcoVadis silver');
  perform public.update_supplier_gate(v_sup, 'sanctions', 'verified', current_date + 365, false, 'No matches on the screening lists');
  perform public.onboarding_gap_raise(v_sup, 'financial', 'Company is in its first trading year under the current owner; audited accounts are due after year end.',
    null, 'vendor', current_date + 45);
  perform set_config('request.jwt.claim.sub', u_lena::text, true);
  perform public.onboarding_gap_decide((select id from public.onboarding_gaps where supplier_id = v_sup and gate_key = 'financial'), true,
    'Accepted: credit check is clean; accounts due within 45 days.');
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  perform public.onboarding_risk_submit(v_sup, '{"category_fit":"Corrugated multipacks fit the Northbrew packaging category plan.","competitiveness":"Benchmarked 6% below the incumbent on the tray range.","nti_percent":4,"quality":"ISO 9001; first-article check planned.","sustainability":"FSC and EcoVadis silver.","audit_needed":true,"audit_notes":"On-site audit before the first production run.","client_requirements":"Northbrew packaging spec v3 acknowledged."}'::jsonb);
  perform set_config('request.jwt.claim.sub', u_lena::text, true);
  perform public.onboarding_risk_decide(v_sup, 'quality', true, 'Quality evidence is complete; audit booked.');

  -- 4. In contracts.
  perform set_config('request.jwt.claim.sub', u_pedro::text, true);
  v_case := public.onboarding_request_submit(jsonb_build_object('business_case', 'Northbrew Vietnam needs illuminated signage for on-trade outlets.',
    'supplier_type', 'manufacturer', 'category', 'Signage', 'client', 'Northbrew', 'market', 'Vietnam', 'urgency', 'standard', 'estimated_spend', 52000,
    'proposed_name', 'Lumen Signage Works', 'proposed_email', 'contact@lumensignage.example', 'proposed_registration', '0316677889', 'duplicate_confirmed', true));
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  v_sup := public.onboarding_triage(v_case, 'approve', 'standard', 'tactical', null);
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  foreach k in array array['rfi','registration','financial','capability','quality','environment','sustainability','sanctions'] loop
    perform public.update_supplier_gate(v_sup, k, 'verified', case when k in ('financial','quality','environment','sustainability','sanctions') then current_date + 330 end,
      false, 'Checked');
  end loop;
  perform public.onboarding_risk_submit(v_sup, '{"category_fit":"Fits the signage panel for Vietnam on-trade.","competitiveness":"Three quotes; middle on price, best on lead time.","quality":"CE-marked LED components.","sustainability":"Sedex member."}'::jsonb);
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  perform public.onboarding_risk_decide(v_sup, 'cm', true, 'Category fit confirmed.');
  perform set_config('request.jwt.claim.sub', u_lena::text, true);
  perform public.onboarding_risk_decide(v_sup, 'quality', true, null);
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  perform public.update_supplier_gate(v_sup, 'nda', 'verified', null, false, 'Signed NDA stored');
  perform public.update_supplier_gate(v_sup, 'coc', 'requested', null, false, 'Code of Conduct sent for signature');
  perform public.update_supplier_gate(v_sup, 'msa', 'requested', null, false, 'MSA with the vendor''s legal team');

  -- 5. Fast-track with an overdue remediation item: the closure gate blocks further orders.
  perform set_config('request.jwt.claim.sub', u_pedro::text, true);
  v_case := public.onboarding_request_submit(jsonb_build_object('business_case', 'Carewell store-launch fixtures; the nominated fixture maker went into administration.',
    'supplier_type', 'manufacturer', 'category', 'Fixtures', 'client', 'Carewell', 'market', 'China', 'urgency', 'urgent',
    'urgency_reason', 'Store launch date is fixed and the original fixture maker has stopped trading.', 'client_need', 'Carewell launch fixtures for 40 stores',
    'required_date', current_date + 21, 'estimated_spend', 60000, 'proposed_name', 'Rapid Retail Fixtures', 'proposed_email', 'orders@rapidretail.example',
    'proposed_registration', '91440300MA5FRR1234', 'duplicate_confirmed', true));
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  v_sup := public.onboarding_triage(v_case, 'approve', 'exception', 'tactical', 'Urgent replacement; exception route.');
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  perform public.update_supplier_gate(v_sup, 'rfi', 'received', null, false, 'Vendor form received');
  perform public.update_supplier_gate(v_sup, 'bank', 'received', null, false, 'Bank details received');
  perform public.update_supplier_gate(v_sup, 'nda', 'requested', null, false, 'NDA sent');
  perform public.update_supplier_gate(v_sup, 'coc', 'requested', null, false, 'Code of Conduct sent');
  perform public.update_supplier_gate(v_sup, 'registration', 'verified', null, false, 'Business licence checked');
  select id into v_job from public.jobs order by created_at limit 1;
  perform set_config('request.jwt.claim.sub', u_pedro::text, true);
  perform public.fast_track_request(v_sup, 'Store launch date is fixed and the original fixture maker has stopped trading.', 'Carewell launch fixtures for 40 stores',
    current_date + 21, jsonb_build_object('jobs', case when v_job is null then '[]'::jsonb else jsonb_build_array(v_job) end, 'value_cap', 25000, 'currency', 'EUR',
      'systems', jsonb_build_array('stocktool','erp'), 'note', 'Launch fixtures only'));
  select id into v_req from public.approval_requests where approval_type = 'FAST_TRACK' and entity_id = v_sup::text and status = 'pending';
  perform set_config('request.jwt.claim.sub', u_dara::text, true);
  perform public.approval_request_decide(v_req, true, 'Launch date is contractual; scope limited to the launch job.');
  select id into v_req from public.approval_requests where approval_type = 'FAST_TRACK_FINANCE' and entity_id = v_sup::text and status = 'pending';
  perform set_config('request.jwt.claim.sub', u_fiona::text, true);
  perform public.approval_request_decide(v_req, true, 'Bank details checked by call-back; cap 25,000 EUR.');
  -- Time has passed: the ethical audit was due two days ago and has not arrived.
  update public.onboarding_remediation_items set due_date = current_date - 2 where supplier_id = v_sup and gate_key = 'sustainability';

  -- 6. Fully onboarded and released.
  perform set_config('request.jwt.claim.sub', u_pedro::text, true);
  v_case := public.onboarding_request_submit(jsonb_build_object('business_case', 'BAU needs a French POSM maker for perfumery counter units.',
    'supplier_type', 'manufacturer', 'category', 'POSM', 'client', 'BAU', 'market', 'France', 'urgency', 'standard', 'estimated_spend', 60000,
    'proposed_name', 'Meridian Display Group', 'proposed_email', 'bonjour@meridiandisplay.example', 'proposed_contact', 'Camille Laurent',
    'proposed_registration', '812 345 678', 'proposed_vat', 'FR 12 812345678', 'duplicate_confirmed', true));
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  v_sup := public.onboarding_triage(v_case, 'approve', 'standard', 'tactical', null);
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  foreach k in array array['rfi','registration','financial','capability','quality','environment','sustainability','sanctions'] loop
    perform public.update_supplier_gate(v_sup, k, 'verified', case when k in ('financial','quality','environment','sustainability','sanctions') then current_date + 320 end,
      false, 'Checked');
  end loop;
  perform public.onboarding_risk_submit(v_sup, '{"category_fit":"Counter units for perfumery fit the BAU POSM category.","competitiveness":"Lowest of three quotes.","nti_percent":3,"quality":"ISO 9001.","sustainability":"ISO 14001 and SMETA."}'::jsonb);
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  perform public.onboarding_risk_decide(v_sup, 'cm', true, 'Approved.');
  perform set_config('request.jwt.claim.sub', u_lena::text, true);
  perform public.onboarding_risk_decide(v_sup, 'quality', true, 'Approved.');
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  foreach k in array array['nda','coc','msa'] loop
    perform public.update_supplier_gate(v_sup, k, 'verified', null, false, 'Signed copy stored in the contracts register');
  end loop;
  perform set_config('request.jwt.claim.sub', u_felix::text, true);
  perform public.update_supplier_gate(v_sup, 'bank', 'verified', null, false, 'Bank details confirmed by call-back');
  perform public.onboarding_finance_decide(v_sup, true, 'VAT validated in VIES; bank confirmed.');
  perform set_config('request.jwt.claim.sub', u_arjun::text, true);
  perform public.onboarding_record_system_id(v_sup, 'stocktool', 'ST-FR-20418', 'Meridian Display Group', 'FR12812345678');
  perform public.onboarding_record_system_id(v_sup, 'erp', 'V-77215', 'Meridian Display Group SAS', 'FR12812345678');
  perform public.onboarding_record_system_id(v_sup, 'sourcing_hub', 'SH-3391', 'Meridian Display Group', null);
  perform public.onboarding_reconcile_ids(v_sup);
  perform set_config('request.jwt.claim.sub', u_hana::text, true);
  perform public.onboarding_allocate_panels(v_sup, array['EMEA POSM panel', 'BAU counter units']);
  perform set_config('request.jwt.claim.sub', u_dara::text, true);
  perform public.onboarding_activate(v_sup, jsonb_build_object('owner', u_pedro, 'welcome_pack_sent', true, 'training', 'assigned',
    'evidence_location', 'SRM evidence store: Meridian Display Group', 'expiry_confirmed', true, 'review_cadence', 'annual'));

  perform set_config('request.jwt.claim.sub', '', true);
end $$;
