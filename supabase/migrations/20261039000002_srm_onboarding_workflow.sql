-- SRM supplier onboarding (2 of 3): the stage workflow.
--   Stage 1-3  onboarding_request_submit (structured request + duplicate / existing-supplier check) and onboarding_triage
--              (Procurement approves need and route; never the requester). send_vendor_rfi refuses any information request
--              before triage: no supplier RFI outside the route.
--   Stage 4    onboarding_gap_raise / onboarding_gap_decide: a documented gap (reason, owner, due date) approved by a second
--              person is a valid exit for due-diligence evidence.
--   Stage 5    onboarding_risk_submit / onboarding_risk_decide: one combined risk review; the risk rules library decides when
--              the Category Manager and Quality must approve.
--   Stage 6    contracts in the register are tagged with the onboarding document they are (NDA, CoC, MSA, PSA/SSA, schedule);
--              a counter-signed, stored contract verifies its gate.
--   Stage 7    onboarding_finance_decide: Local Finance for the supplier's market.
--   Stage 8    onboarding_record_system_id / onboarding_reconcile_ids / onboarding_allocate_panels (capture and reconciliation
--              only; an integration_outbox event carries the IDs and status).
--   Stage 9    onboarding_activate: activation pack; releases the supplier. The activator is never the triage approver.
--   Fast-track fast_track_request opens two approvals (FAST_TRACK: Procurement Director; FAST_TRACK_FINANCE: Local Finance for
--              the market) through the approvals framework; when both approve, the exception applies with its restricted
--              scope and a remediation item per missing evidence. Sourcing refuses invitations and POs outside the scope;
--              an overdue remediation item blocks purchasing (closure gate). approve_fast_track (one SRT lead) is superseded.
--   Gates with verifier_role 'system' can't be changed by hand: _core_update_supplier_gate is wrapped (the previous core is
--   _core_update_supplier_gate_pre_onboarding; the public maker-checker wrapper is unchanged).

-- ===========================================================================
-- Helpers
-- ===========================================================================
create or replace function public._onb_event(p_supplier uuid, p_case uuid, p_kind text, p_title text, p_detail jsonb default '{}'::jsonb,
  p_vendor boolean default false, p_outbox boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.onboarding_events (supplier_id, case_id, kind, title, detail, vendor_visible, actor)
  values (p_supplier, p_case, p_kind, p_title, coalesce(p_detail, '{}'::jsonb), p_vendor, auth.uid());
  if p_outbox then
    insert into public.integration_outbox (module, event, aggregate_type, aggregate_id, payload, created_by)
    values ('assure', 'srm.onboarding.' || p_kind, 'supplier', p_supplier,
            jsonb_build_object('supplier_id', p_supplier, 'case_id', p_case, 'title', p_title) || coalesce(p_detail, '{}'::jsonb), auth.uid());
  end if;
end $$;

-- Workflow write to a gate (bypasses the hand-edit rules; always audited).
create or replace function public._onb_set_gate(p_supplier uuid, p_gate text, p_status text, p_note text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cur public.supplier_gates;
begin
  select * into cur from public.supplier_gates where supplier_id = p_supplier and gate_key = p_gate for update;
  if cur.supplier_id is null then
    insert into public.supplier_gates (supplier_id, gate_key) values (p_supplier, p_gate) on conflict do nothing;
    select * into cur from public.supplier_gates where supplier_id = p_supplier and gate_key = p_gate for update;
  end if;
  update public.supplier_gates set status = p_status, note = coalesce(p_note, note),
         rejection_reason = case when p_status = 'rejected' then coalesce(p_reason, p_note) end,
         verified_by = case when p_status = 'verified' then auth.uid() end,
         verified_at = case when p_status = 'verified' then now() end,
         expiry_date = case when p_status in ('verified','received') then expiry_date end,
         updated_by = auth.uid(), updated_at = now()
   where supplier_id = p_supplier and gate_key = p_gate;
  if cur.status is distinct from p_status then
    insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, note, actor)
    values (p_supplier, p_gate, cur.status, p_status, coalesce(p_reason, p_note), auth.uid());
  end if;
end $$;

create or replace function public._onb_case(p_supplier uuid) returns public.onboarding_cases
language sql stable security definer set search_path = public as $$
  select * from public.onboarding_cases where supplier_id = p_supplier order by (kind = 'new') desc, requested_at desc limit 1;
$$;

create or replace function public._onb_gate_clear(p_supplier uuid, p_gate text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select g.clear from public._onb_gate_states(p_supplier) g where g.gate_key = p_gate), false);
$$;

create or replace function public._onb_first_open(p_supplier uuid) returns text
language sql stable security definer set search_path = public as $$
  select format('stage %s (%s)', st.stage_no, st.label) from public.onboarding_stages st
   where st.stage_no = (select min(g.stage_no) from public._onb_gate_states(p_supplier) g where not g.clear);
$$;

create or replace function public._onb_require_stages(p_supplier uuid, p_upto int, p_what text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.suppliers where id = p_supplier) then raise exception 'Supplier not found'; end if;
  if not public._onb_stages_complete(p_supplier, p_upto) then
    raise exception '% comes after stage %. % is not complete yet.', p_what, p_upto, initcap(public._onb_first_open(p_supplier));
  end if;
end $$;

-- Name, number and domain normalisation for the duplicate check.
create or replace function public._onb_norm_name(p text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(regexp_replace(' ' || regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g') || ' ',
      ' (ltd|limited|co|company|inc|llc|gmbh|sa|srl|spa|plc|pte|pty|bv|ag|kg|the|and|group|sdn|bhd|jsc|corp|corporation|sas|oy|ab|nv|kft|sro) ', ' ', 'g'),
      ' (ltd|limited|co|company|inc|llc|gmbh|sa|srl|spa|plc|pte|pty|bv|ag|kg|the|and|group|sdn|bhd|jsc|corp|corporation|sas|oy|ab|nv|kft|sro) ', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;
create or replace function public._onb_digits(p text) returns text
language sql immutable as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 6 then regexp_replace(p, '\D', '', 'g') end;
$$;
create or replace function public._onb_domain(p text) returns text
language sql immutable as $$
  select nullif(case when p like '%@%' then lower(split_part(p, '@', 2))
                     else lower(split_part(regexp_replace(coalesce(p, ''), '^https?://(www\.)?', '', 'i'), '/', 1)) end, '');
$$;
create or replace function public._onb_name_similar(a text, b text) returns boolean
language sql immutable as $$
  select a is not null and b is not null and (
    a = b
    or (length(a) >= 5 and length(b) >= 5 and (strpos(a, b) > 0 or strpos(b, a) > 0))
    or ((select count(*) from (select unnest(string_to_array(a, ' ')) intersect select unnest(string_to_array(b, ' '))) i)::numeric
        / greatest(1, (select count(*) from (select unnest(string_to_array(a, ' ')) union select unnest(string_to_array(b, ' '))) u)) >= 0.5));
$$;

-- ===========================================================================
-- Gates: workflow-only gates can't be changed by hand. Clearing a gate closes its gap and remediation item.
-- ===========================================================================
alter function public._core_update_supplier_gate(uuid, text, text, date, boolean, text, text, uuid) rename to _core_update_supplier_gate_pre_onboarding;
create function public._core_update_supplier_gate(
  p_supplier uuid, p_gate text, p_status text default null, p_expiry date default null,
  p_clear_expiry boolean default false, p_note text default null, p_rejection_reason text default null, p_ticket uuid default null
) returns public.supplier_gates
language plpgsql security definer set search_path = public as $$
declare d public.gate_definitions; v_stage text;
begin
  select * into d from public.gate_definitions where key = p_gate;
  if d.verifier_role = 'system' and p_status is not null
     and exists (select 1 from public.supplier_gates where supplier_id = p_supplier and gate_key = p_gate and status is distinct from p_status) then
    select label into v_stage from public.onboarding_stages where key = d.stage_key;
    raise exception '"%" is recorded by the onboarding workflow (stage: %), not by hand', d.label, v_stage using errcode = '42501';
  end if;
  return public._core_update_supplier_gate_pre_onboarding(p_supplier, p_gate, p_status, p_expiry, p_clear_expiry, p_note, p_rejection_reason, p_ticket);
end $$;

create or replace function public.trg_onb_gate_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('verified','not_required') and old.status is distinct from new.status then
    update public.onboarding_remediation_items set status = 'done', done_at = now(), note = coalesce(note, 'Closed when the gate was ' || replace(new.status, '_', ' '))
     where supplier_id = new.supplier_id and gate_key = new.gate_key and status = 'open';
    update public.onboarding_gaps set status = 'closed', closed_at = now()
     where supplier_id = new.supplier_id and gate_key = new.gate_key and status in ('proposed','approved');
  end if;
  return null;
end $$;
create trigger supplier_gates_onboarding_close after update of status on public.supplier_gates
  for each row execute function public.trg_onb_gate_status();

-- ===========================================================================
-- Stage 1-3: request, duplicate check, triage
-- ===========================================================================
create or replace function public.onboarding_duplicate_check(p_name text, p_vat text default null, p_registration text default null,
  p_email text default null, p_code text default null, p_exclude_case uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_norm text := public._onb_norm_name(p_name); v_vat text := public._onb_digits(p_vat); v_reg text := public._onb_digits(p_registration);
        v_dom text := public._onb_domain(p_email); v jsonb;
begin
  perform public._assure_require_internal();
  if v_dom in ('gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','qq.com','163.com','126.com',
               'example.com','example.org','example.net') then v_dom := null; end if;
  select coalesce(jsonb_agg(m order by score desc, m->>'name'), '[]'::jsonb) into v from (
    select jsonb_build_object('kind', 'supplier', 'supplier_id', s.id, 'name', s.name, 'supplier_code', s.supplier_code, 'market', s.market,
             'state', s.onboarding_state, 'reasons', to_jsonb(r.reasons)) as m, cardinality(r.reasons) as score
      from public.suppliers s
      left join public.supplier_profiles p on p.supplier_id = s.id
      cross join lateral (select array_remove(array[
          case when v_norm is not null and public._onb_norm_name(s.name) = v_norm then 'Same name'
               when public._onb_name_similar(public._onb_norm_name(s.name), v_norm)
                 or public._onb_name_similar(public._onb_norm_name(p.legal_entity), v_norm) then 'Similar name' end,
          case when v_vat is not null and v_vat in (public._onb_digits(p.vat_number), public._onb_digits(p.uen_number)) then 'Same VAT / tax number' end,
          case when v_reg is not null and v_reg in (public._onb_digits(p.uen_number), public._onb_digits(p.vat_number)) then 'Same registration number' end,
          case when v_dom is not null and (public._onb_domain(s.primary_contact_email) = v_dom or public._onb_domain(p.website) = v_dom) then 'Same email domain' end,
          case when nullif(trim(p_code), '') is not null and upper(s.supplier_code) = upper(trim(p_code)) then 'Same supplier ID' end], null) as reasons) r
     where cardinality(r.reasons) > 0
    union all
    select jsonb_build_object('kind', 'case', 'case_id', c.id, 'case_no', c.case_no, 'name', c.proposed_name, 'market', c.market,
             'state', c.status, 'reasons', jsonb_build_array('Already requested (onboarding case #' || c.case_no || ')')), 1
      from public.onboarding_cases c
     where c.status = 'submitted' and c.id is distinct from p_exclude_case
       and public._onb_name_similar(public._onb_norm_name(c.proposed_name), v_norm)
  ) x;
  return v;
end $$;

create or replace function public.onboarding_request_submit(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(trim(p->>'proposed_name'), ''); v_email text := lower(nullif(trim(p->>'proposed_email'), ''));
  v_type text := nullif(p->>'supplier_type', ''); v_market text := public._market_name(p->>'market'); v_region text;
  v_urgency text := coalesce(nullif(p->>'urgency', ''), 'standard'); v_spend numeric; v_matches jsonb; v_link uuid := nullif(p->>'linked_supplier_id', '')::uuid;
  v_confirm boolean := coalesce((p->>'duplicate_confirmed')::boolean, false); v_ticket uuid; v_id uuid; v_no bigint; v_client text := nullif(p->>'client', '');
  v_required date := nullif(p->>'required_date', '')::date;
begin
  perform public._assure_require_internal();
  if nullif(trim(p->>'business_case'), '') is null then raise exception 'Describe the business need: why this supplier is needed'; end if;
  if v_type is null or v_type not in ('manufacturer','distributor','service_provider','raw_material','logistics') then raise exception 'Choose the supplier type'; end if;
  if nullif(trim(p->>'category'), '') is null then raise exception 'Choose a category'; end if;
  if v_market is null then raise exception 'Choose the market'; end if;
  if v_client is not null and v_client not in ('Brightlane','Northbrew','Carewell','BAU','Other') then raise exception 'Choose a client from the list'; end if;
  if v_urgency not in ('standard','urgent') then raise exception 'Choose the urgency'; end if;
  begin v_spend := nullif(p->>'estimated_spend', '')::numeric; exception when others then raise exception 'Enter the estimated annual spend as a number'; end;
  if v_spend is null or v_spend < 0 then raise exception 'Enter the estimated annual spend'; end if;
  if v_name is null then raise exception 'Enter the proposed supplier''s name'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid supplier contact email'; end if;
  if v_urgency = 'urgent' and (nullif(trim(p->>'urgency_reason'), '') is null or nullif(trim(p->>'client_need'), '') is null or v_required is null) then
    raise exception 'An urgent request needs the urgency reason, the client need and the required date';
  end if;
  if v_required is not null and v_required < current_date then raise exception 'Choose a required date in the future'; end if;
  if v_link is not null and not exists (select 1 from public.suppliers where id = v_link) then raise exception 'Supplier not found'; end if;

  v_matches := public.onboarding_duplicate_check(v_name, p->>'proposed_vat', p->>'proposed_registration', v_email, null, null);
  if jsonb_array_length(v_matches) > 0 and not v_confirm and v_link is null then
    raise exception 'Possible duplicate: %. Confirm it is not a duplicate, or link the existing supplier.',
      (select string_agg((m->>'name') || ' (' || (select string_agg(x, ', ') from jsonb_array_elements_text(m->'reasons') x) || ')', '; ')
         from jsonb_array_elements(v_matches) m);
  end if;
  select m.region_code into v_region from public.markets m where m.code = public._market_code(v_market);

  insert into public.srt_tickets (type, title, description, prospect_name, supplier_id, client, market, priority, status, source, source_ref, created_by)
  values ('new_onboarding', 'Onboarding request: ' || v_name, trim(p->>'business_case'), v_name, v_link, v_client, v_market,
          case when v_urgency = 'urgent' then 'high' else 'normal' end, 'new', 'manual', 'onboarding_case', auth.uid())
  returning id into v_ticket;

  insert into public.onboarding_cases (business_case, supplier_type, category, tax_category_id, client, market, region, urgency, urgency_reason, client_need,
    required_date, estimated_spend, currency, proposed_name, proposed_email, proposed_contact, proposed_website, proposed_vat, proposed_registration,
    duplicate_matches, duplicate_confirmed, linked_supplier_id, ticket_id, requested_by)
  values (trim(p->>'business_case'), v_type, trim(p->>'category'), nullif(p->>'tax_category_id', '')::uuid, v_client, v_market, v_region, v_urgency,
    nullif(trim(p->>'urgency_reason'), ''), nullif(trim(p->>'client_need'), ''), v_required, v_spend, coalesce(nullif(upper(p->>'currency'), ''), 'EUR'),
    v_name, v_email, nullif(trim(p->>'proposed_contact'), ''), nullif(trim(p->>'proposed_website'), ''), nullif(trim(p->>'proposed_vat'), ''),
    nullif(trim(p->>'proposed_registration'), ''), v_matches, v_confirm and jsonb_array_length(v_matches) > 0, v_link, v_ticket, auth.uid())
  returning id, case_no into v_id, v_no;

  perform public._ticket_event(v_ticket, 'Onboarding request #' || v_no || ' submitted; waiting for Procurement triage');
  perform public._onb_event(v_link, v_id, 'submitted', 'Onboarding request #' || v_no || ' submitted for ' || v_name,
    jsonb_build_object('duplicate_matches', jsonb_array_length(v_matches), 'urgency', v_urgency));
  perform public._approval_notify('procurement', 'assure', 'assure', 'Onboarding request to triage: ' || v_name,
    trim(p->>'business_case'), '/assure/srt/requests/' || v_id, auth.uid());
  return v_id;
end $$;

-- Minimum evidence set (governed library): gates outside the set become "not required" at triage.
create or replace function public._onb_apply_evidence_set(p_supplier uuid, p_type text) returns text
language plpgsql security definer set search_path = public as $$
declare s public.suppliers; r public.library_records; v_nr text[]; v_sys text[]; k text; v_code text;
begin
  select * into s from public.suppliers where id = p_supplier;
  select lr.* into r from public.library_records lr
   where lr.library_key = 'onboarding_evidence_sets' and lr.status = 'active'
     and lr.effective_from <= current_date and (lr.effective_to is null or lr.effective_to >= current_date)
     and (nullif(lr.data->>'region', '') is null or lr.data->>'region' = s.region)
     and (nullif(lr.data->>'market', '') is null or public._market_code(lr.data->>'market') = public._market_code(s.market))
     and (nullif(lr.data->>'client', '') is null or lr.data->>'client' = s.client)
     and (nullif(lr.data->>'supplier_type', '') is null or lr.data->>'supplier_type' = p_type)
   order by (nullif(lr.data->>'client', '') is not null) desc, (nullif(lr.data->>'market', '') is not null) desc,
            (nullif(lr.data->>'supplier_type', '') is not null) desc, (nullif(lr.data->>'region', '') is not null) desc, lr.version desc
   limit 1;
  v_code := coalesce(r.code, 'global default');
  v_nr := case when r.id is null then array['psa','client_requirements']
               else array(select jsonb_array_elements_text(coalesce(r.data->'not_required_gates', '[]'::jsonb))) end;
  v_sys := array(select jsonb_array_elements_text(coalesce(public._onb_setting(s.region)->'required_systems', '[]'::jsonb)));
  v_nr := v_nr || array(select 'id_' || case x when 'sourcing_hub' then 'hub' else x end from unnest(array['stocktool','erp','sourcing_hub']) x where x <> all (v_sys));
  foreach k in array v_nr loop
    if exists (select 1 from public.gate_definitions d join public.supplier_gates g on g.gate_key = d.key and g.supplier_id = p_supplier
                where d.key = k and not d.critical and g.status in ('missing','requested')) then
      perform public._onb_set_gate(p_supplier, k, 'not_required', 'Not in the minimum evidence set (' || v_code || ')');
    end if;
  end loop;
  return v_code;
end $$;

create or replace function public.onboarding_triage(p_case uuid, p_decision text, p_route text default null, p_relationship text default null,
  p_note text default null, p_existing_supplier uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.onboarding_cases; v_sup uuid; v_set text; v_who text;
begin
  perform public._assure_require_internal();
  if not public.approval_has_role('procurement', 'assure') then
    raise exception 'Only Procurement (in-market procurement, the Procurement head or the Procurement Director) can triage onboarding requests' using errcode = '42501';
  end if;
  select * into c from public.onboarding_cases where id = p_case for update;
  if c.id is null then raise exception 'Onboarding request not found'; end if;
  if c.status <> 'submitted' then raise exception 'This request has already been triaged'; end if;
  if c.requested_by = auth.uid() then raise exception 'You raised this request, so someone else in Procurement must triage it' using errcode = '42501'; end if;
  select coalesce(nullif(full_name, ''), email) into v_who from public.profiles where id = auth.uid();

  if p_decision = 'decline' then
    if nullif(trim(p_note), '') is null then raise exception 'Say why the request is declined'; end if;
    update public.onboarding_cases set status = 'declined', decline_reason = trim(p_note), triage_note = trim(p_note), triaged_by = auth.uid(), triaged_at = now(), updated_at = now()
     where id = p_case;
    update public.srt_tickets set status = 'resolved', resolution = 'rejected' where id = c.ticket_id and status <> 'resolved';
    perform public._ticket_event(c.ticket_id, 'Procurement declined the request: ' || trim(p_note));
    perform public._onb_event(c.linked_supplier_id, p_case, 'declined', 'Request #' || c.case_no || ' declined at triage', jsonb_build_object('reason', trim(p_note)));
    perform public.notify(c.requested_by, 'assure', 'Onboarding request declined: ' || c.proposed_name, trim(p_note), '/assure/srt/requests/' || p_case);
    return null;
  elsif p_decision = 'duplicate' then
    v_sup := coalesce(p_existing_supplier, c.linked_supplier_id);
    if v_sup is null or not exists (select 1 from public.suppliers where id = v_sup) then raise exception 'Choose the existing supplier this request duplicates'; end if;
    update public.onboarding_cases set status = 'duplicate', linked_supplier_id = v_sup, triage_note = nullif(trim(p_note), ''),
           decline_reason = coalesce(nullif(trim(p_note), ''), 'Duplicate of an existing supplier'), triaged_by = auth.uid(), triaged_at = now(), updated_at = now()
     where id = p_case;
    update public.srt_tickets set status = 'resolved', resolution = 'duplicate' where id = c.ticket_id and status <> 'resolved';
    perform public._ticket_event(c.ticket_id, 'Procurement closed the request as a duplicate of an existing supplier');
    perform public._onb_event(v_sup, p_case, 'duplicate', 'Duplicate request #' || c.case_no || ' (' || c.proposed_name || ') linked to this supplier',
      jsonb_build_object('note', nullif(trim(p_note), '')));
    perform public.notify(c.requested_by, 'assure', 'Onboarding request closed as a duplicate: ' || c.proposed_name,
      coalesce(nullif(trim(p_note), ''), 'Use the existing supplier.'), '/assure/suppliers/' || v_sup);
    return v_sup;
  elsif p_decision <> 'approve' then
    raise exception 'Choose approve, decline or duplicate';
  end if;

  if coalesce(p_route, '') not in ('standard','exception') then raise exception 'Choose the route: standard or exception'; end if;
  if p_route = 'exception' and c.urgency <> 'urgent' then
    raise exception 'The exception route needs an urgent request (urgency reason, client need and required date)';
  end if;
  if coalesce(p_relationship, '') not in ('incumbent','strategic','tactical') then raise exception 'Say whether the supplier is incumbent, strategic or tactical'; end if;

  v_sup := coalesce(p_existing_supplier, c.linked_supplier_id);
  if v_sup is null then
    insert into public.suppliers (supplier_code, name, market, region, client, category, primary_contact_email, strategic, onboarding_route, notes)
    values ('SRM-' || lpad(c.case_no::text, 5, '0'), c.proposed_name, c.market, case when c.region in ('APAC','EMEA','Americas','GSC') then c.region end, c.client, c.category, c.proposed_email,
            p_relationship = 'strategic', case when p_route = 'exception' then 'fast_track' else 'standard' end, 'Onboarding case #' || c.case_no)
    returning id into v_sup;
    insert into public.supplier_profiles (supplier_id, legal_entity, entity_type, uen_number, vat_number, website, primary_contact_name, annual_spend_forecast)
    values (v_sup, c.proposed_name, c.supplier_type, c.proposed_registration, c.proposed_vat,
            case when c.proposed_website ~* '^https?://' then c.proposed_website end, c.proposed_contact, c.estimated_spend)
    on conflict (supplier_id) do update set legal_entity = coalesce(supplier_profiles.legal_entity, excluded.legal_entity),
      entity_type = coalesce(supplier_profiles.entity_type, excluded.entity_type), uen_number = coalesce(supplier_profiles.uen_number, excluded.uen_number),
      vat_number = coalesce(supplier_profiles.vat_number, excluded.vat_number), website = coalesce(supplier_profiles.website, excluded.website),
      primary_contact_name = coalesce(supplier_profiles.primary_contact_name, excluded.primary_contact_name),
      annual_spend_forecast = coalesce(supplier_profiles.annual_spend_forecast, excluded.annual_spend_forecast);
  elsif p_route = 'exception' then
    update public.suppliers set onboarding_route = 'fast_track' where id = v_sup;
  end if;

  perform public._onb_set_gate(v_sup, 'request', 'verified', 'Business case recorded on onboarding request #' || c.case_no);
  perform public._onb_set_gate(v_sup, 'intake', 'verified', 'Complete request #' || c.case_no);
  perform public._onb_set_gate(v_sup, 'triage', 'verified', 'Need and ' || p_route || ' route approved by ' || v_who || coalesce(': ' || nullif(trim(p_note), ''), ''));
  v_set := public._onb_apply_evidence_set(v_sup, c.supplier_type);

  update public.onboarding_cases set status = 'in_onboarding', supplier_id = v_sup, route = p_route, relationship = p_relationship,
         triage_note = nullif(trim(p_note), ''), triaged_by = auth.uid(), triaged_at = now(), updated_at = now()
   where id = p_case;
  update public.srt_tickets set supplier_id = v_sup, status = 'in_progress' where id = c.ticket_id and status <> 'resolved';
  perform public._ticket_event(c.ticket_id, 'Procurement approved the need and the ' || p_route || ' route; the information request can now be sent');
  perform public._onb_event(v_sup, p_case, 'triage_approved', 'Need and ' || p_route || ' route approved at triage',
    jsonb_build_object('route', p_route, 'relationship', p_relationship, 'evidence_set', v_set), false, true);
  perform public.notify(c.requested_by, 'assure', 'Onboarding request approved at triage: ' || c.proposed_name, 'Route: ' || p_route, '/assure/suppliers/' || v_sup || '?tab=record');
  perform public.recompute_supplier_compliance(v_sup);
  return v_sup;
end $$;

-- Requests can be put on hold or withdrawn by the requester (or Procurement).
create or replace function public.onboarding_case_set_status(p_case uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.onboarding_cases;
begin
  perform public._assure_require_internal();
  select * into c from public.onboarding_cases where id = p_case for update;
  if c.id is null then raise exception 'Onboarding request not found'; end if;
  if p_status not in ('on_hold','withdrawn','submitted','in_onboarding') then raise exception 'Unknown status %', p_status; end if;
  if not (c.requested_by = auth.uid() or public.approval_has_role('procurement', 'assure')) then
    raise exception 'Only the requester or Procurement can change this request' using errcode = '42501';
  end if;
  if c.status in ('released','declined','duplicate','withdrawn') then raise exception 'This request is closed'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Give a reason'; end if;
  if p_status in ('submitted','in_onboarding') and c.status <> 'on_hold' then raise exception 'Only a request on hold can be resumed'; end if;
  if p_status in ('submitted','in_onboarding') then p_status := case when c.triaged_at is null then 'submitted' else 'in_onboarding' end; end if;
  update public.onboarding_cases set status = p_status, updated_at = now() where id = p_case;
  if p_status = 'withdrawn' then update public.srt_tickets set status = 'resolved', resolution = 'withdrawn' where id = c.ticket_id and status <> 'resolved'; end if;
  perform public._onb_event(c.supplier_id, p_case, 'case_' || p_status, 'Request #' || c.case_no || ': ' || replace(p_status, '_', ' '), jsonb_build_object('note', trim(p_note)));
  if c.supplier_id is not null then perform public.recompute_supplier_compliance(c.supplier_id); end if;
end $$;

-- No supplier information request outside the route.
alter function public.send_vendor_rfi(uuid, text, text, text) rename to _core_send_vendor_rfi;
create function public.send_vendor_rfi(p_ticket uuid, p_email text, p_contact_name text, p_link_base text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.srt_tickets;
begin
  if not public.is_internal() or (not public.is_admin() and coalesce(public.my_srt_role(), '') not in ('agent','lead','procurement','head','director')) then
    raise exception 'Only SRT, procurement or admin can send a vendor information request' using errcode = '42501';
  end if;
  select * into t from public.srt_tickets where id = p_ticket;
  if t.id is not null then
    if t.supplier_id is null then
      raise exception 'No information request outside the onboarding route: raise an onboarding request and get Procurement triage first';
    end if;
    if not public._onb_gate_clear(t.supplier_id, 'triage') then
      raise exception 'Procurement has not approved the need and route for this supplier yet, so no information request can be sent';
    end if;
  end if;
  return public._core_send_vendor_rfi(p_ticket, p_email, p_contact_name, p_link_base);
end $$;

-- ===========================================================================
-- Stage 4: documented gaps
-- ===========================================================================
create or replace function public.onboarding_gap_raise(p_supplier uuid, p_gate text, p_reason text, p_owner uuid, p_owner_type text, p_due date) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.gate_definitions; v_id uuid; s public.suppliers;
begin
  perform public._assure_require_internal();
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null then raise exception 'Supplier not found'; end if;
  select * into d from public.gate_definitions where key = p_gate;
  if d.key is null or not d.allows_gap then raise exception 'Only due-diligence evidence can be covered by a documented gap'; end if;
  if public._onb_gate_clear(p_supplier, p_gate) then raise exception '"%" is already complete', d.label; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give the reason for the gap'; end if;
  if coalesce(p_owner_type, '') not in ('internal','vendor') then raise exception 'Say who owns closing the gap: adm Indicia or the vendor'; end if;
  if p_owner_type = 'internal' and not exists (select 1 from public.profiles where id = p_owner and (user_type = 'internal' or is_admin)) then
    raise exception 'Choose the person at adm Indicia who owns closing the gap';
  end if;
  if p_due is null or p_due <= current_date then raise exception 'Choose a due date in the future'; end if;
  if p_due > current_date + 180 then raise exception 'A documented gap can stay open for at most 180 days'; end if;
  if exists (select 1 from public.onboarding_gaps where supplier_id = p_supplier and gate_key = p_gate and status in ('proposed','approved')) then
    raise exception 'There is already an open documented gap for "%"', d.label;
  end if;
  insert into public.onboarding_gaps (supplier_id, gate_key, reason, owner, owner_type, due_date, raised_by)
  values (p_supplier, p_gate, trim(p_reason), case when p_owner_type = 'internal' then p_owner end, p_owner_type, p_due, auth.uid())
  returning id into v_id;
  perform public._onb_event(p_supplier, (public._onb_case(p_supplier)).id, 'gap_raised', 'Documented gap proposed: ' || d.label,
    jsonb_build_object('gap_id', v_id, 'reason', trim(p_reason), 'due_date', p_due));
  perform public._approval_notify('srt_lead', 'assure', 'assure', 'Documented gap to approve: ' || s.name, d.label || ': ' || trim(p_reason),
    '/assure/suppliers/' || p_supplier || '?tab=record', auth.uid());
  return v_id;
end $$;

create or replace function public.onboarding_gap_decide(p_gap uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.onboarding_gaps; d public.gate_definitions;
begin
  perform public._assure_require_internal();
  if not (public.approval_has_role('srt_lead', 'assure') or public.approval_has_role('procurement', 'assure')) then
    raise exception 'Only an SRT lead or Procurement can approve a documented gap' using errcode = '42501';
  end if;
  select * into g from public.onboarding_gaps where id = p_gap for update;
  if g.id is null then raise exception 'Documented gap not found'; end if;
  if g.status <> 'proposed' then raise exception 'This gap is already %', g.status; end if;
  if g.raised_by = auth.uid() then raise exception 'You raised this gap, so a second person must approve it' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Say why the gap is not accepted'; end if;
  select * into d from public.gate_definitions where key = g.gate_key;
  update public.onboarding_gaps set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(p_note), '') where id = p_gap;
  perform public._approval_decision('assure', 'ONBOARDING_GAP', 'onboarding_gap', p_gap::text, case when p_approve then 'approved' else 'rejected' end, p_note, null);
  perform public._onb_event(g.supplier_id, (public._onb_case(g.supplier_id)).id, case when p_approve then 'gap_approved' else 'gap_rejected' end,
    'Documented gap ' || case when p_approve then 'approved' else 'not accepted' end || ': ' || d.label,
    jsonb_build_object('gap_id', p_gap, 'note', nullif(trim(p_note), ''), 'due_date', g.due_date));
  perform public.notify(g.raised_by, 'assure', 'Documented gap ' || case when p_approve then 'approved' else 'not accepted' end || ': ' || d.label,
    nullif(trim(p_note), ''), '/assure/suppliers/' || g.supplier_id || '?tab=record');
end $$;

-- ===========================================================================
-- Stage 5: risk gates
-- ===========================================================================
create or replace function public._onb_risk_rules(p_supplier uuid)
returns table (needs_cm boolean, needs_quality boolean, audit_required boolean, codes text[])
language plpgsql stable security definer set search_path = public as $$
declare s public.suppliers; c public.onboarding_cases; v_spend numeric; r record; v_cm boolean; v_q boolean := false; v_a boolean := false; v_codes text[] := '{}';
begin
  select * into s from public.suppliers where id = p_supplier;
  c := public._onb_case(p_supplier);
  v_spend := greatest(coalesce(c.estimated_spend, 0), coalesce(s.ytd_spend, 0));
  v_cm := coalesce((public._onb_setting(s.region)->>'cm_always')::boolean, true);
  for r in select lr.code, lr.data from public.library_records lr
            where lr.library_key = 'onboarding_risk_rules' and lr.status = 'active'
              and lr.effective_from <= current_date and (lr.effective_to is null or lr.effective_to >= current_date) loop
    if (jsonb_array_length(coalesce(r.data->'categories', '[]'::jsonb)) = 0
          or exists (select 1 from jsonb_array_elements_text(r.data->'categories') x where lower(x) = lower(coalesce(s.category, ''))))
       and (jsonb_array_length(coalesce(r.data->'clients', '[]'::jsonb)) = 0
          or exists (select 1 from jsonb_array_elements_text(r.data->'clients') x where x = s.client))
       and (nullif(r.data->>'min_spend', '') is null or v_spend >= (r.data->>'min_spend')::numeric)
       and (jsonb_array_length(coalesce(r.data->'categories', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(r.data->'clients', '[]'::jsonb)) > 0
            or nullif(r.data->>'min_spend', '') is not null) then
      v_codes := v_codes || r.code;
      v_cm := v_cm or coalesce((r.data->>'needs_cm')::boolean, false);
      v_q := v_q or coalesce((r.data->>'needs_quality')::boolean, false);
      v_a := v_a or coalesce((r.data->>'audit_required')::boolean, false);
    end if;
  end loop;
  return query select v_cm, v_q, v_a, v_codes;
end $$;

create or replace function public.onboarding_risk_submit(p_supplier uuid, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare r record; cur public.onboarding_risk_reviews; v_status text; s public.suppliers;
begin
  perform public._assure_require_internal();
  if not (public.assure_is_vendor_manager() or public.approval_has_role('procurement', 'assure')) then
    raise exception 'Only SRT or Procurement can submit the risk review' using errcode = '42501';
  end if;
  perform public._onb_require_stages(p_supplier, 4, 'The risk review');
  select * into s from public.suppliers where id = p_supplier;
  select * into cur from public.onboarding_risk_reviews where supplier_id = p_supplier for update;
  if cur.status = 'approved' then raise exception 'The risk review is already approved'; end if;
  if nullif(trim(p->>'category_fit'), '') is null then raise exception 'Describe the category fit'; end if;
  select * into r from public._onb_risk_rules(p_supplier);
  v_status := case when not r.needs_cm and not r.needs_quality then 'approved' else 'submitted' end;
  insert into public.onboarding_risk_reviews (supplier_id, case_id, category_fit, competitiveness, nti_percent, quality, sustainability, audit_needed, audit_notes,
    client_requirements, needs_cm, needs_quality, rules_applied, status, submitted_by, submitted_at)
  values (p_supplier, (public._onb_case(p_supplier)).id, trim(p->>'category_fit'), nullif(trim(p->>'competitiveness'), ''), nullif(p->>'nti_percent', '')::numeric,
    nullif(trim(p->>'quality'), ''), nullif(trim(p->>'sustainability'), ''), coalesce((p->>'audit_needed')::boolean, false) or r.audit_required,
    nullif(trim(p->>'audit_notes'), ''), nullif(trim(p->>'client_requirements'), ''), r.needs_cm, r.needs_quality, r.codes, v_status, auth.uid(), now())
  on conflict (supplier_id) do update set case_id = excluded.case_id, category_fit = excluded.category_fit, competitiveness = excluded.competitiveness,
    nti_percent = excluded.nti_percent, quality = excluded.quality, sustainability = excluded.sustainability, audit_needed = excluded.audit_needed,
    audit_notes = excluded.audit_notes, client_requirements = excluded.client_requirements, needs_cm = excluded.needs_cm, needs_quality = excluded.needs_quality,
    rules_applied = excluded.rules_applied, status = excluded.status, submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at,
    cm_decision = null, cm_by = null, cm_at = null, cm_note = null, quality_decision = null, quality_by = null, quality_at = null, quality_note = null;
  perform public._onb_set_gate(p_supplier, 'risk_review', case when v_status = 'approved' then 'verified' else 'requested' end,
    case when v_status = 'approved' then 'No Category Manager or Quality approval needed under the risk rules' else 'Risk review submitted; waiting for '
      || concat_ws(' and ', case when r.needs_cm then 'the Category Manager' end, case when r.needs_quality then 'Quality' end) end);
  perform public._onb_event(p_supplier, (public._onb_case(p_supplier)).id, 'risk_submitted', 'Risk review submitted',
    jsonb_build_object('needs_cm', r.needs_cm, 'needs_quality', r.needs_quality, 'rules', r.codes));
  if r.needs_cm then perform public._approval_notify('category_manager', 'assure', 'assure', 'Risk gate to approve: ' || s.name, 'Category fit and commercials', '/assure/suppliers/' || p_supplier || '?tab=record', auth.uid()); end if;
  if r.needs_quality then perform public._approval_notify('quality', 'assure', 'assure', 'Risk gate to approve: ' || s.name, 'Quality and sustainability evidence', '/assure/suppliers/' || p_supplier || '?tab=record', auth.uid()); end if;
  return v_status;
end $$;

create or replace function public.onboarding_risk_decide(p_supplier uuid, p_role text, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare v public.onboarding_risk_reviews; c public.onboarding_cases; v_done boolean;
begin
  perform public._assure_require_internal();
  select * into v from public.onboarding_risk_reviews where supplier_id = p_supplier for update;
  if v.supplier_id is null or v.status <> 'submitted' then raise exception 'There is no risk review waiting for approval'; end if;
  if p_role = 'cm' then
    if not v.needs_cm then raise exception 'This review does not need a Category Manager approval'; end if;
    if v.cm_decision is not null then raise exception 'The Category Manager has already decided'; end if;
    if not public.approval_has_role('category_manager', 'assure') then raise exception 'Only a Category Manager can approve category fit and commercials' using errcode = '42501'; end if;
  elsif p_role = 'quality' then
    if not v.needs_quality then raise exception 'This review does not need a Quality approval'; end if;
    if v.quality_decision is not null then raise exception 'Quality has already decided'; end if;
    if not public.approval_has_role('quality', 'assure') then raise exception 'Only Quality can approve the quality and sustainability evidence' using errcode = '42501'; end if;
  else raise exception 'Choose cm or quality';
  end if;
  if v.submitted_by = auth.uid() then raise exception 'You submitted this review, so someone else must approve it' using errcode = '42501'; end if;
  c := public._onb_case(p_supplier);
  if c.requested_by = auth.uid() then raise exception 'You requested this supplier, so someone else must approve its risk gate' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Say why the risk gate is not approved'; end if;
  if p_role = 'cm' then
    update public.onboarding_risk_reviews set cm_decision = case when p_approve then 'approved' else 'rejected' end, cm_by = auth.uid(), cm_at = now(), cm_note = nullif(trim(p_note), '')
     where supplier_id = p_supplier returning * into v;
  else
    update public.onboarding_risk_reviews set quality_decision = case when p_approve then 'approved' else 'rejected' end, quality_by = auth.uid(), quality_at = now(), quality_note = nullif(trim(p_note), '')
     where supplier_id = p_supplier returning * into v;
  end if;
  perform public._approval_decision('assure', case when p_role = 'cm' then 'ONBOARDING_RISK_CM' else 'ONBOARDING_RISK_QUALITY' end, 'supplier', p_supplier::text,
    case when p_approve then 'approved' else 'rejected' end, p_note, null);
  if not p_approve then
    update public.onboarding_risk_reviews set status = 'rejected' where supplier_id = p_supplier;
    perform public._onb_set_gate(p_supplier, 'risk_review', 'rejected', null, (case when p_role = 'cm' then 'Category Manager: ' else 'Quality: ' end) || trim(p_note));
    perform public._onb_event(p_supplier, c.id, 'risk_rejected', 'Risk gate not approved (' || case when p_role = 'cm' then 'Category Manager' else 'Quality' end || ')', jsonb_build_object('note', trim(p_note)));
    return 'rejected';
  end if;
  v_done := (not v.needs_cm or v.cm_decision = 'approved') and (not v.needs_quality or v.quality_decision = 'approved');
  perform public._onb_event(p_supplier, c.id, 'risk_' || p_role || '_approved', 'Risk gate approved by ' || case when p_role = 'cm' then 'the Category Manager' else 'Quality' end,
    jsonb_build_object('note', nullif(trim(p_note), '')));
  if v_done then
    update public.onboarding_risk_reviews set status = 'approved' where supplier_id = p_supplier;
    perform public._onb_set_gate(p_supplier, 'risk_review', 'verified', 'Risk gates approved (' || concat_ws(' and ', case when v.needs_cm then 'Category Manager' end, case when v.needs_quality then 'Quality' end) || ')');
    return 'approved';
  end if;
  return 'submitted';
end $$;

-- ===========================================================================
-- Stage 6: the contract set (contracts register)
-- ===========================================================================
create or replace function public._onb_sync_contract(c public.contracts) returns void
language plpgsql security definer set search_path = public as $$
declare v_gate text; v_cur text;
begin
  if c.supplier_id is null or c.onboarding_doc is null then return; end if;
  v_gate := case c.onboarding_doc when 'schedule' then 'psa' else c.onboarding_doc end;
  select status into v_cur from public.supplier_gates where supplier_id = c.supplier_id and gate_key = v_gate;
  if v_cur is null or v_cur in ('verified','not_required') then return; end if;
  if c.status = 'counter_signed' and nullif(trim(c.document_path), '') is not null then
    perform public._onb_set_gate(c.supplier_id, v_gate, 'verified', 'Signed and stored: ' || coalesce(c.contract_ref, c.title));
    perform public._onb_event(c.supplier_id, (public._onb_case(c.supplier_id)).id, 'contract_signed', 'Signed and stored: ' || c.title,
      jsonb_build_object('contract_id', c.id, 'doc', c.onboarding_doc), true);
  elsif c.status in ('counter_signed','signed') then
    if v_cur <> 'received' then perform public._onb_set_gate(c.supplier_id, v_gate, 'received', 'Signed: ' || coalesce(c.contract_ref, c.title) || '; store the fully signed copy to complete'); end if;
  elsif c.status in ('sent','viewed','in_review') and v_cur = 'missing' then
    perform public._onb_set_gate(c.supplier_id, v_gate, 'requested', 'Sent for signature: ' || coalesce(c.contract_ref, c.title));
  end if;
end $$;

create or replace function public.trg_onb_contract() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.onboarding_doc is distinct from old.onboarding_doc
     or new.document_path is distinct from old.document_path then
    perform public._onb_sync_contract(new);
  end if;
  return null;
end $$;
create trigger contracts_onboarding after insert or update on public.contracts for each row execute function public.trg_onb_contract();

create or replace function public.trg_onb_contract_default_doc() returns trigger
language plpgsql as $$
begin
  if new.onboarding_doc is null and new.document_type = 'nda' then new.onboarding_doc := 'nda'; end if;
  return new;
end $$;
create trigger contracts_onboarding_doc before insert on public.contracts for each row execute function public.trg_onb_contract_default_doc();

create or replace function public.onboarding_contract_link(p_contract uuid, p_doc text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.contracts;
begin
  perform public._assure_require_internal();
  if not (public.assure_is_vendor_manager() or public.assure_is_procurement()) then raise exception 'Only SRT or Procurement can tag contracts' using errcode = '42501'; end if;
  if p_doc is not null and p_doc not in ('nda','coc','msa','psa','schedule') then raise exception 'Choose NDA, Code of Conduct, MSA, PSA / SSA or a schedule'; end if;
  select * into c from public.contracts where id = p_contract;
  if c.id is null or c.supplier_id is null then raise exception 'Choose a contract that belongs to a supplier'; end if;
  update public.contracts set onboarding_doc = p_doc where id = p_contract;
end $$;

-- ===========================================================================
-- Stage 7: Finance approval (Local Finance)
-- ===========================================================================
create or replace function public.onboarding_finance_decide(p_supplier uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.suppliers; c public.onboarding_cases;
begin
  perform public._assure_require_internal();
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null then raise exception 'Supplier not found'; end if;
  if not public.approval_has_role('local_finance', s.market) then
    raise exception 'Only Local Finance for % can approve this supplier''s finance set-up', coalesce(s.market, 'this market') using errcode = '42501';
  end if;
  perform public._onb_require_stages(p_supplier, 6, 'Finance approval');
  if public._onb_gate_clear(p_supplier, 'finance_approval') then raise exception 'Finance has already approved this supplier'; end if;
  if not public._onb_gate_clear(p_supplier, 'bank') then raise exception 'Verify the bank details first'; end if;
  c := public._onb_case(p_supplier);
  if c.requested_by = auth.uid() then raise exception 'You requested this supplier, so someone else in Finance must approve it' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Say what Finance needs before it can approve'; end if;
  perform public._onb_set_gate(p_supplier, 'finance_approval', case when p_approve then 'verified' else 'rejected' end,
    case when p_approve then 'Bank, tax and set-up validated by Local Finance' || coalesce(': ' || nullif(trim(p_note), ''), '') end,
    case when not p_approve then trim(p_note) end);
  perform public._approval_decision('assure', 'ONBOARDING_FINANCE', 'supplier', p_supplier::text, case when p_approve then 'approved' else 'rejected' end, p_note, null);
  perform public._onb_event(p_supplier, c.id, case when p_approve then 'finance_approved' else 'finance_rejected' end,
    case when p_approve then 'Finance approval given' else 'Finance approval refused' end, jsonb_build_object('note', nullif(trim(p_note), '')), false, p_approve);
end $$;

-- ===========================================================================
-- Stage 8: system IDs, reconciliation, panels
-- ===========================================================================
create or replace function public.onboarding_record_system_id(p_supplier uuid, p_system text, p_external_id text, p_name text, p_vat text) returns void
language plpgsql security definer set search_path = public as $$
declare v_gate text := 'id_' || case p_system when 'sourcing_hub' then 'hub' else p_system end;
begin
  perform public._assure_require_internal();
  if not (public.assure_is_vendor_manager() or public.approval_has_role('finance', 'assure')) then
    raise exception 'Only SRT or Finance can record system IDs' using errcode = '42501';
  end if;
  if coalesce(p_system, '') not in ('stocktool','erp','sourcing_hub') then raise exception 'Choose StockTool, NAV / ERP or Sourcing Hub'; end if;
  if nullif(trim(p_external_id), '') is null then raise exception 'Enter the ID the system returned'; end if;
  perform public._onb_require_stages(p_supplier, 7, 'Recording system IDs');
  if exists (select 1 from public.supplier_gates where supplier_id = p_supplier and gate_key = v_gate and status = 'not_required') then
    raise exception 'This system is not required for this supplier';
  end if;
  if exists (select 1 from public.supplier_system_ids where system = p_system and upper(trim(external_id)) = upper(trim(p_external_id)) and supplier_id <> p_supplier) then
    raise exception 'That ID is already used by another supplier in this system';
  end if;
  insert into public.supplier_system_ids (supplier_id, system, external_id, name_in_system, vat_in_system, reconciled, recorded_by, recorded_at)
  values (p_supplier, p_system, trim(p_external_id), nullif(trim(p_name), ''), nullif(trim(p_vat), ''), false, auth.uid(), now())
  on conflict (supplier_id, system) do update set external_id = excluded.external_id, name_in_system = excluded.name_in_system,
    vat_in_system = excluded.vat_in_system, reconciled = false, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;
  perform public._onb_set_gate(p_supplier, v_gate, 'received', 'ID ' || trim(p_external_id) || ' recorded; reconcile to complete');
  if public._onb_gate_clear(p_supplier, 'setup') then perform public._onb_set_gate(p_supplier, 'setup', 'requested', 'An ID changed; reconcile again'); end if;
  perform public._onb_event(p_supplier, (public._onb_case(p_supplier)).id, 'system_id_recorded', 'ID recorded for ' || p_system,
    jsonb_build_object('system', p_system, 'external_id', trim(p_external_id)));
end $$;

create or replace function public.onboarding_reconcile_ids(p_supplier uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.suppliers; p public.supplier_profiles; v_problems text[] := '{}'; r record; v_ids jsonb;
begin
  perform public._assure_require_internal();
  if not (public.assure_is_vendor_manager() or public.approval_has_role('finance', 'assure')) then
    raise exception 'Only SRT or Finance can reconcile system IDs' using errcode = '42501';
  end if;
  perform public._onb_require_stages(p_supplier, 7, 'Reconciling system IDs');
  select * into s from public.suppliers where id = p_supplier;
  select * into p from public.supplier_profiles where supplier_id = p_supplier;
  for r in select x.sys, x.gate, x.label, i.external_id, i.name_in_system, i.vat_in_system
             from (values ('stocktool','id_stocktool','StockTool'), ('erp','id_erp','NAV / ERP'), ('sourcing_hub','id_hub','Sourcing Hub')) x(sys, gate, label)
             join public.supplier_gates g on g.supplier_id = p_supplier and g.gate_key = x.gate and g.status <> 'not_required'
             left join public.supplier_system_ids i on i.supplier_id = p_supplier and i.system = x.sys loop
    if r.external_id is null then v_problems := v_problems || (r.label || ': no ID recorded');
    else
      if r.name_in_system is null then v_problems := v_problems || (r.label || ': name in the system not recorded');
      elsif public._onb_norm_name(r.name_in_system) is distinct from public._onb_norm_name(s.name)
            and public._onb_norm_name(r.name_in_system) is distinct from public._onb_norm_name(p.legal_entity) then
        v_problems := v_problems || (r.label || ': name "' || r.name_in_system || '" does not match ' || s.name);
      end if;
      if r.vat_in_system is not null and p.vat_number is not null and public._onb_digits(r.vat_in_system) is distinct from public._onb_digits(p.vat_number) then
        v_problems := v_problems || (r.label || ': VAT number does not match the supplier record');
      end if;
    end if;
  end loop;
  if cardinality(v_problems) > 0 then raise exception 'The IDs do not reconcile: %', array_to_string(v_problems, '; '); end if;
  update public.supplier_system_ids set reconciled = true where supplier_id = p_supplier;
  for r in select gate_key from public.supplier_gates where supplier_id = p_supplier and gate_key in ('id_stocktool','id_erp','id_hub') and status = 'received' loop
    perform public._onb_set_gate(p_supplier, r.gate_key, 'verified', 'Reconciled: name and VAT match the supplier record');
  end loop;
  perform public._onb_set_gate(p_supplier, 'setup', 'verified', 'IDs reconciled and status synchronised');
  perform set_config('assure.system_write', 'on', true);
  update public.suppliers set ids_synced_at = now() where id = p_supplier;
  perform set_config('assure.system_write', 'off', true);
  select coalesce(jsonb_object_agg(system, external_id), '{}'::jsonb) into v_ids from public.supplier_system_ids where supplier_id = p_supplier;
  perform public._onb_event(p_supplier, (public._onb_case(p_supplier)).id, 'ids_reconciled', 'System IDs reconciled and status synchronised',
    jsonb_build_object('ids', v_ids, 'supplier_code', s.supplier_code, 'status', s.onboarding_state), false, true);
  return jsonb_build_object('ok', true, 'ids', v_ids);
end $$;

create or replace function public.onboarding_allocate_panels(p_supplier uuid, p_panels text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  perform public._assure_require_internal();
  if not (public.approval_has_role('procurement', 'assure') or public.approval_has_role('category_manager', 'assure')) then
    raise exception 'Only Procurement or a Category Manager can allocate groups and panels' using errcode = '42501';
  end if;
  perform public._onb_require_stages(p_supplier, 7, 'Allocating groups and panels');
  v := array(select distinct trim(x) from unnest(coalesce(p_panels, '{}')) x where nullif(trim(x), '') is not null);
  if cardinality(v) = 0 then raise exception 'Choose at least one group or panel'; end if;
  delete from public.supplier_panels where supplier_id = p_supplier and panel <> all (v);
  insert into public.supplier_panels (supplier_id, panel, allocated_by) select p_supplier, x, auth.uid() from unnest(v) x on conflict do nothing;
  perform public._onb_set_gate(p_supplier, 'panels', 'verified', 'Allocated: ' || array_to_string(v, ', '));
  perform public._onb_event(p_supplier, (public._onb_case(p_supplier)).id, 'panels_allocated', 'Groups and panels allocated', jsonb_build_object('panels', to_jsonb(v)));
end $$;

-- ===========================================================================
-- Stage 9: activation pack and release
-- ===========================================================================
create or replace function public.onboarding_activate(p_supplier uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.suppliers; c public.onboarding_cases; v_triager uuid; v_owner uuid := nullif(p->>'owner', '')::uuid; v_training text := p->>'training';
        v_cadence text := p->>'review_cadence'; v_next date; v_who text;
begin
  perform public._assure_require_internal();
  if not public.approval_has_role('procurement', 'assure') then raise exception 'Only Procurement can release a supplier' using errcode = '42501'; end if;
  select * into s from public.suppliers where id = p_supplier for update;
  if s.id is null then raise exception 'Supplier not found'; end if;
  if s.onboarding_released and s.onboarding_baseline = 'standard' then raise exception 'This supplier is already released'; end if;
  perform public._onb_require_stages(p_supplier, 8, 'Activation');
  c := public._onb_case(p_supplier);
  v_triager := coalesce(c.triaged_by, (select verified_by from public.supplier_gates where supplier_id = p_supplier and gate_key = 'triage'));
  if v_triager = auth.uid() then raise exception 'You approved this supplier at triage, so someone else must release it' using errcode = '42501'; end if;
  if v_owner is null or not exists (select 1 from public.profiles where id = v_owner and (user_type = 'internal' or is_admin)) then
    raise exception 'Choose the named procurement owner';
  end if;
  if coalesce((p->>'welcome_pack_sent')::boolean, false) is not true then raise exception 'Send the welcome pack first'; end if;
  if coalesce(v_training, '') not in ('assigned','completed','not_required') then raise exception 'Say whether training is assigned, completed or not required'; end if;
  if nullif(trim(p->>'evidence_location'), '') is null then raise exception 'Record where the evidence is kept'; end if;
  if coalesce((p->>'expiry_confirmed')::boolean, false) is not true then raise exception 'Confirm the certificate and document expiry dates'; end if;
  if coalesce(v_cadence, '') not in ('quarterly','semi_annual','annual','biennial') then raise exception 'Choose the review cadence'; end if;
  v_next := current_date + (case v_cadence when 'quarterly' then 3 when 'semi_annual' then 6 when 'annual' then 12 else 24 end || ' months')::interval;
  select coalesce(nullif(full_name, ''), email) into v_who from public.profiles where id = auth.uid();

  insert into public.onboarding_activations (supplier_id, case_id, owner, welcome_pack_sent_at, training, evidence_location, expiry_confirmed, review_cadence,
    next_review_due, note, activated_by, activated_at)
  values (p_supplier, c.id, v_owner, now(), v_training, trim(p->>'evidence_location'), true, v_cadence, v_next, nullif(trim(p->>'note'), ''), auth.uid(), now())
  on conflict (supplier_id) do update set case_id = excluded.case_id, owner = excluded.owner, welcome_pack_sent_at = excluded.welcome_pack_sent_at,
    training = excluded.training, evidence_location = excluded.evidence_location, expiry_confirmed = true, review_cadence = excluded.review_cadence,
    next_review_due = excluded.next_review_due, note = excluded.note, activated_by = excluded.activated_by, activated_at = excluded.activated_at;

  perform public._onb_set_gate(p_supplier, 'welcome_pack', 'verified', 'Welcome pack sent');
  perform public._onb_set_gate(p_supplier, 'training', case when v_training = 'not_required' then 'not_required' else 'verified' end, 'Training ' || replace(v_training, '_', ' '));
  perform public._onb_set_gate(p_supplier, 'owner', 'verified', 'Owner: ' || (select coalesce(nullif(full_name, ''), email) from public.profiles where id = v_owner));
  perform public._onb_set_gate(p_supplier, 'review_cadence', 'verified', 'Review ' || replace(v_cadence, '_', '-') || '; evidence at ' || trim(p->>'evidence_location'));
  perform public._onb_set_gate(p_supplier, 'approval', 'verified', 'Released for use by ' || v_who);

  update public.suppliers set procurement_owner = v_owner, status = 'active', active = true where id = p_supplier;
  perform set_config('assure.system_write', 'on', true);
  update public.suppliers set next_review_due = v_next where id = p_supplier;
  perform set_config('assure.system_write', 'off', true);
  if c.id is not null and c.status <> 'released' then
    update public.onboarding_cases set status = 'released', activated_by = auth.uid(), activated_at = now(), updated_at = now() where id = c.id;
  end if;
  if s.primary_contact_email is not null then
    insert into public.email_outbox (to_email, subject, body, supplier_id, created_by)
    values (s.primary_contact_email, 'Welcome to adm Indicia: you are ready to receive work',
      format(E'Hello,\n\n%s is now fully onboarded with adm Indicia. Your welcome pack explains how quotes, orders, shipping and invoices work, and who to contact.\n\nPlease complete your onboarding training in the vendor portal.\n\nadm Indicia Supplier Team', s.name),
      p_supplier, auth.uid());
  end if;
  perform public.notify_supplier(p_supplier, 'assure', 'You are fully onboarded', 'adm Indicia has released your company for work.', '/vendor/onboarding');
  perform public.recompute_supplier_compliance(p_supplier);
  perform public._onb_event(p_supplier, c.id, 'released', 'Supplier released for use', jsonb_build_object('owner', v_owner, 'review_cadence', v_cadence,
    'next_review_due', v_next, 'training', v_training), true, true);
end $$;

-- ===========================================================================
-- Fast-track: exception route with dual named approval, restricted scope, remediation clock and closure gate
-- ===========================================================================
create or replace function public.onboarding_min_pack(p_supplier uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.supplier_profiles; v_rfi jsonb; items jsonb;
  st_rfi text; st_bank text; st_nda text; st_coc text; v_ident boolean;
begin
  perform public._assure_require_internal();
  select * into p from public.supplier_profiles where supplier_id = p_supplier;
  select data into v_rfi from public.vendor_rfis where supplier_id = p_supplier and status in ('submitted','approved') order by submitted_at desc nulls last limit 1;
  select max(status) filter (where gate_key = 'rfi'), max(status) filter (where gate_key = 'bank'), max(status) filter (where gate_key = 'nda'),
         max(status) filter (where gate_key = 'coc')
    into st_rfi, st_bank, st_nda, st_coc from public.supplier_gates where supplier_id = p_supplier;
  v_ident := coalesce(nullif(trim(p.uen_number), ''), nullif(trim(p.vat_number), ''), nullif(trim(v_rfi->>'registration_number'), ''), nullif(trim(v_rfi->>'vat_number'), '')) is not null;
  items := jsonb_build_array(
    jsonb_build_object('key', 'identity', 'label', 'Supplier identifiable (registration or VAT number)', 'ok', v_ident),
    jsonb_build_object('key', 'rfi', 'label', 'Vendor form received', 'ok', coalesce(st_rfi in ('received','verified'), false)),
    jsonb_build_object('key', 'bank', 'label', 'Bank details received', 'ok', coalesce(st_bank in ('received','verified'), false)),
    jsonb_build_object('key', 'nda', 'label', 'NDA status known (sent or signed)', 'ok', coalesce(st_nda <> 'missing', false)),
    jsonb_build_object('key', 'coc', 'label', 'Code of Conduct status known (sent or signed)', 'ok', coalesce(st_coc <> 'missing', false)));
  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(items) i where not (i->>'ok')::boolean), 'items', items);
end $$;

create or replace function public.fast_track_request(p_supplier uuid, p_urgency_reason text, p_client_need text, p_required_date date,
  p_scope jsonb, p_close_by date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.suppliers; c public.onboarding_cases; cfg jsonb; v_pack jsonb; v_jobs uuid[]; v_cap numeric; v_cur text; v_sys text[]; v_close date; v_id uuid;
        v_missing text;
begin
  perform public._assure_require_internal();
  select * into s from public.suppliers where id = p_supplier for update;
  if s.id is null then raise exception 'Supplier not found'; end if;
  if s.onboarding_released then raise exception '% is already fully onboarded; no exception is needed', s.name; end if;
  if not public._onb_gate_clear(p_supplier, 'triage') then raise exception 'Procurement must approve the need and route at triage before an exception can be requested'; end if;
  if exists (select 1 from public.onboarding_fast_tracks where supplier_id = p_supplier and status in ('requested','approved')) then
    raise exception 'There is already an open fast-track for this supplier';
  end if;
  if nullif(trim(p_urgency_reason), '') is null or nullif(trim(p_client_need), '') is null or p_required_date is null then
    raise exception 'Declare the urgency: the reason, the client need and the required date';
  end if;
  if p_required_date < current_date then raise exception 'Choose a required date in the future'; end if;
  v_pack := public.onboarding_min_pack(p_supplier);
  if not (v_pack->>'ok')::boolean then
    select string_agg(i->>'label', '; ') into v_missing from jsonb_array_elements(v_pack->'items') i where not (i->>'ok')::boolean;
    raise exception 'The minimum pack is incomplete: %', v_missing;
  end if;
  cfg := public._onb_setting(s.region);
  v_jobs := array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_scope->'jobs', '[]'::jsonb)) x where nullif(x, '') is not null);
  if exists (select 1 from unnest(v_jobs) j where not exists (select 1 from public.jobs where id = j)) then raise exception 'A job in the scope was not found'; end if;
  v_cap := nullif(p_scope->>'value_cap', '')::numeric;
  v_cur := coalesce(nullif(upper(p_scope->>'currency'), ''), 'EUR');
  v_sys := array(select x from jsonb_array_elements_text(coalesce(p_scope->'systems', '[]'::jsonb)) x);
  if cardinality(v_jobs) = 0 and v_cap is null then raise exception 'Restrict the activation: name the job(s) or a value cap for the urgent transaction'; end if;
  if v_cap is not null and v_cap <= 0 then raise exception 'The value cap must be above zero'; end if;
  if v_cap is not null and nullif(cfg->>'ft_value_cap_max', '') is not null and v_cap > (cfg->>'ft_value_cap_max')::numeric then
    raise exception 'The value cap can be at most % (SRM Watchtower setting)', cfg->>'ft_value_cap_max';
  end if;
  if exists (select 1 from unnest(v_sys) x where x not in ('stocktool','erp','sourcing_hub')) then raise exception 'Systems in scope must be StockTool, NAV / ERP or Sourcing Hub'; end if;
  v_close := coalesce(p_close_by, greatest(p_required_date, current_date) + coalesce((cfg->>'remediation_days')::int, 30));
  if v_close <= current_date then raise exception 'Choose a remediation close-by date in the future'; end if;
  if v_close > current_date + coalesce((cfg->>'ft_max_days')::int, 60) then
    raise exception 'The remediation clock can run for at most % days', coalesce((cfg->>'ft_max_days')::int, 60);
  end if;
  c := public._onb_case(p_supplier);

  insert into public.onboarding_fast_tracks (supplier_id, case_id, urgency_reason, client_need, required_date, scope_jobs, scope_value_cap, scope_currency,
    scope_systems, scope_note, close_by, min_pack, requested_by)
  values (p_supplier, c.id, trim(p_urgency_reason), trim(p_client_need), p_required_date, v_jobs, v_cap, v_cur, v_sys, nullif(trim(p_scope->>'note'), ''),
    v_close, v_pack, auth.uid())
  returning id into v_id;
  update public.suppliers set onboarding_route = 'fast_track', fast_track_justification = trim(p_urgency_reason) where id = p_supplier;
  if c.id is not null and c.route is distinct from 'exception' then update public.onboarding_cases set route = 'exception', updated_at = now() where id = c.id; end if;

  perform public._approval_request_open('assure', 'FAST_TRACK', 'supplier', p_supplier::text, s.supplier_code,
    'Fast-track exception for ' || s.name || ' (Procurement Director)', jsonb_build_object('fast_track_id', v_id, 'step', 'director'), trim(p_urgency_reason),
    v_cap, v_cur, null, s.market, s.region, '/assure/suppliers/' || p_supplier || '?tab=record', coalesce(cfg->>'ft_director_role', 'procurement_director'), 'assure', 'approver',
    array[auth.uid(), c.requested_by], format('Client need: %s. Required by %s. Remediation closes by %s.', trim(p_client_need), to_char(p_required_date, 'DD Mon YYYY'), to_char(v_close, 'DD Mon YYYY')));
  perform public._approval_request_open('assure', 'FAST_TRACK_FINANCE', 'supplier', p_supplier::text, s.supplier_code,
    'Fast-track exception for ' || s.name || ' (Local Finance)', jsonb_build_object('fast_track_id', v_id, 'step', 'finance'), trim(p_urgency_reason),
    v_cap, v_cur, null, s.market, s.region, '/assure/suppliers/' || p_supplier || '?tab=record', coalesce(cfg->>'ft_finance_role', 'local_finance'), public._market_code(s.market), 'approver',
    array[auth.uid(), c.requested_by], format('Finance validates the set-up for the urgent transaction. Value cap: %s.', coalesce(v_cap::text || ' ' || v_cur, 'named jobs only')));
  perform public._onb_event(p_supplier, c.id, 'fast_track_requested', 'Fast-track exception requested',
    jsonb_build_object('fast_track_id', v_id, 'urgency_reason', trim(p_urgency_reason), 'client_need', trim(p_client_need), 'required_date', p_required_date,
      'scope_jobs', to_jsonb(v_jobs), 'value_cap', v_cap, 'currency', v_cur, 'systems', to_jsonb(v_sys), 'close_by', v_close));
  return v_id;
end $$;

-- Applying one of the two approvals (called by the approvals framework when a request is approved).
create or replace function public._onb_ft_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
declare ft public.onboarding_fast_tracks; s public.suppliers; n int;
begin
  select * into ft from public.onboarding_fast_tracks where id = (r.payload->>'fast_track_id')::uuid for update;
  if ft.id is null then raise exception 'Fast-track not found'; end if;
  if ft.status <> 'requested' then raise exception 'This fast-track is no longer waiting for approval'; end if;
  if r.approval_type = 'FAST_TRACK' then
    update public.onboarding_fast_tracks set director_approved_by = r.decided_by, director_approved_at = now() where id = ft.id returning * into ft;
  else
    update public.onboarding_fast_tracks set finance_approved_by = r.decided_by, finance_approved_at = now() where id = ft.id returning * into ft;
  end if;
  perform public._onb_event(ft.supplier_id, ft.case_id, case when r.approval_type = 'FAST_TRACK' then 'fast_track_director_approved' else 'fast_track_finance_approved' end,
    'Fast-track approved by ' || case when r.approval_type = 'FAST_TRACK' then 'the Procurement Director' else 'Local Finance' end, jsonb_build_object('request', r.request_no));
  if ft.director_approved_by is null or ft.finance_approved_by is null then return; end if;

  select * into s from public.suppliers where id = ft.supplier_id;
  update public.onboarding_fast_tracks set status = 'approved', approved_at = now() where id = ft.id;
  insert into public.onboarding_remediation_items (supplier_id, fast_track_id, gate_key, item, owner_type, owner, due_date, created_by)
  select ft.supplier_id, ft.id, g.gate_key, g.label, case when g.vendor_facing then 'vendor' else 'internal' end,
         case when g.vendor_facing then null else coalesce(s.srt_owner, ft.requested_by) end, ft.close_by, r.decided_by
    from public._onb_gate_states(ft.supplier_id) g
   where g.stage_no between 4 and 6 and not g.clear and g.verifier_role <> 'system';
  get diagnostics n = row_count;
  update public.suppliers set onboarding_route = 'fast_track', fast_track_justification = ft.urgency_reason, fast_track_close_by = ft.close_by where id = ft.supplier_id;
  perform public._set_fast_track_approval(ft.supplier_id, ft.director_approved_by);
  perform public.recompute_supplier_compliance(ft.supplier_id);
  perform public._onb_event(ft.supplier_id, ft.case_id, 'fast_track_approved', 'Fast-track exception approved: restricted activation',
    jsonb_build_object('fast_track_id', ft.id, 'remediation_items', n, 'close_by', ft.close_by, 'scope_jobs', to_jsonb(ft.scope_jobs),
      'value_cap', ft.scope_value_cap, 'systems', to_jsonb(ft.scope_systems)), false, true);
  perform public.notify(ft.requested_by, 'assure', 'Fast-track approved: ' || s.name, format('%s remediation item(s) due by %s', n, to_char(ft.close_by, 'DD Mon YYYY')),
    '/assure/suppliers/' || ft.supplier_id || '?tab=record');
  perform public.notify_supplier(ft.supplier_id, 'assure', 'Items to complete for your onboarding',
    format('Please complete the open items by %s.', to_char(ft.close_by, 'DD Mon YYYY')), '/vendor/onboarding');
end $$;

alter function public._approval_request_apply(public.approval_requests) rename to _approval_request_apply_before_srm_onboarding;
create function public._approval_request_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
begin
  if r.approval_type in ('FAST_TRACK','FAST_TRACK_FINANCE') and r.payload ? 'fast_track_id' then perform public._onb_ft_apply(r);
  else perform public._approval_request_apply_before_srm_onboarding(r);
  end if;
end $$;

-- Either approval refused: the fast-track is refused and the other request withdrawn.
create or replace function public.trg_onb_ft_request_rejected() returns trigger
language plpgsql security definer set search_path = public as $$
declare ft public.onboarding_fast_tracks;
begin
  if new.status = 'rejected' and old.status = 'pending' and new.approval_type in ('FAST_TRACK','FAST_TRACK_FINANCE') and new.payload ? 'fast_track_id' then
    update public.onboarding_fast_tracks set status = 'rejected', closed_at = now(), close_note = 'Not approved: ' || coalesce(new.decision_note, '')
     where id = (new.payload->>'fast_track_id')::uuid and status = 'requested' returning * into ft;
    update public.approval_requests set status = 'cancelled', decided_at = now(), decision_note = 'The other approval was refused'
     where approval_type in ('FAST_TRACK','FAST_TRACK_FINANCE') and entity_id = new.entity_id and status = 'pending' and id <> new.id;
    insert into public.approval_request_events (request_id, action, note, actor)
      select id, 'cancelled', 'The other approval was refused', new.decided_by from public.approval_requests
       where approval_type in ('FAST_TRACK','FAST_TRACK_FINANCE') and entity_id = new.entity_id and status = 'cancelled' and decided_at >= now() - interval '1 second' and id <> new.id;
    if ft.id is not null then
      update public.suppliers set onboarding_route = 'standard' where id = ft.supplier_id and fast_track_approved_by is null;
      perform public._onb_event(ft.supplier_id, ft.case_id, 'fast_track_rejected', 'Fast-track exception not approved', jsonb_build_object('note', new.decision_note));
    end if;
  end if;
  return null;
end $$;
create trigger approval_requests_onboarding_ft after update of status on public.approval_requests
  for each row execute function public.trg_onb_ft_request_rejected();

-- The old single-approver fast-track is superseded by the exception route above.
create or replace function public.approve_fast_track(p_supplier uuid, p_justification text, p_close_by date) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Fast-track is an exception route: request it with the urgency reason, client need, required date and the restricted scope; the Procurement Director and Local Finance both approve it';
end $$;
update public.approval_requests set status = 'cancelled', decided_at = now(), decision_note = 'Superseded by the nine-stage onboarding standard (fast-track needs two named approvals)'
 where approval_type = 'FAST_TRACK' and status = 'pending' and not (payload ? 'fast_track_id');

-- Remediation items: done or waived by hand (waiving needs the Procurement Director and a reason).
create or replace function public.onboarding_remediation_update(p_item uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.onboarding_remediation_items;
begin
  perform public._assure_require_internal();
  select * into i from public.onboarding_remediation_items where id = p_item for update;
  if i.id is null then raise exception 'Remediation item not found'; end if;
  if i.status <> 'open' then raise exception 'This item is already %', i.status; end if;
  if p_status = 'done' then
    if i.gate_key is not null and not public._onb_gate_clear(i.supplier_id, i.gate_key) then
      raise exception 'Verify the evidence on the gate first; the item closes when the gate is complete';
    end if;
  elsif p_status = 'waived' then
    if not public.approval_has_role('procurement_director', 'assure') then raise exception 'Only the Procurement Director can waive a remediation item' using errcode = '42501'; end if;
    if nullif(trim(p_note), '') is null then raise exception 'Say why the item is waived'; end if;
  else raise exception 'Choose done or waived';
  end if;
  update public.onboarding_remediation_items set status = p_status, done_at = now(), note = nullif(trim(p_note), '') where id = p_item;
  perform public._onb_event(i.supplier_id, null, 'remediation_' || p_status, 'Remediation item ' || p_status || ': ' || i.item, jsonb_build_object('note', nullif(trim(p_note), '')));
end $$;

-- Sourcing respects the restricted scope while a supplier is on a fast-track.
create or replace function public.onboarding_scope_block(p_supplier uuid, p_job uuid, p_value numeric, p_for text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s public.suppliers; ft public.onboarding_fast_tracks; v_used numeric := 0;
begin
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null or s.onboarding_released then return null; end if;
  select * into ft from public.onboarding_fast_tracks where supplier_id = p_supplier and status = 'approved' order by approved_at desc limit 1;
  if ft.id is null then return null; end if;
  if cardinality(ft.scope_jobs) > 0 and (p_job is null or p_job <> all (ft.scope_jobs)) then
    return format('%s is on a fast-track exception and can only be used for the approved job(s) until onboarding is complete', s.name);
  end if;
  if ft.scope_value_cap is not null then
    if p_for = 'rfq' and p_value is null then
      return format('%s is on a fast-track exception capped at %s %s: add an estimated value to the RFQ first', s.name, ft.scope_value_cap, ft.scope_currency);
    end if;
    if p_for = 'po' then
      select coalesce(sum(total_value), 0) into v_used from public.purchase_orders where supplier_id = p_supplier and status not in ('rejected','cancelled','declined');
    end if;
    if v_used + coalesce(p_value, 0) > ft.scope_value_cap then
      return format('%s is on a fast-track exception capped at %s %s (already ordered %s); this would go over the cap', s.name, ft.scope_value_cap, ft.scope_currency, v_used);
    end if;
  end if;
  return null;
end $$;

create or replace function public.trg_onb_scope_rfq_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.rfqs; v text;
begin
  select * into r from public.rfqs where id = new.rfq_id;
  v := public.onboarding_scope_block(new.supplier_id, r.job_id, r.estimated_value, 'rfq');
  if v is not null then raise exception '%', v using errcode = '42501'; end if;
  return new;
end $$;
create trigger rfq_invitations_onboarding_scope before insert on public.rfq_invitations for each row execute function public.trg_onb_scope_rfq_invite();

create or replace function public.trg_onb_scope_po() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := public.onboarding_scope_block(new.supplier_id, new.job_id, new.total_value, 'po');
  if v is not null then raise exception '%', v using errcode = '42501'; end if;
  return new;
end $$;
create trigger purchase_orders_onboarding_scope before insert on public.purchase_orders for each row execute function public.trg_onb_scope_po();

-- ===========================================================================
-- Privileges
-- ===========================================================================
revoke execute on function public._onb_event(uuid, uuid, text, text, jsonb, boolean, boolean), public._onb_set_gate(uuid, text, text, text, text),
  public._onb_case(uuid), public._onb_gate_clear(uuid, text), public._onb_first_open(uuid), public._onb_require_stages(uuid, int, text),
  public._core_update_supplier_gate_pre_onboarding(uuid, text, text, date, boolean, text, text, uuid),
  public._core_update_supplier_gate(uuid, text, text, date, boolean, text, text, uuid), public.trg_onb_gate_status(),
  public._onb_apply_evidence_set(uuid, text), public._core_send_vendor_rfi(uuid, text, text, text), public._onb_risk_rules(uuid),
  public._onb_sync_contract(public.contracts), public.trg_onb_contract(), public.trg_onb_contract_default_doc(), public._onb_ft_apply(public.approval_requests),
  public._approval_request_apply(public.approval_requests), public._approval_request_apply_before_srm_onboarding(public.approval_requests),
  public.trg_onb_ft_request_rejected(), public.trg_onb_scope_rfq_invite(), public.trg_onb_scope_po()
  from public, anon, authenticated;
revoke execute on function public.onboarding_duplicate_check(text, text, text, text, text, uuid), public.onboarding_request_submit(jsonb),
  public.onboarding_triage(uuid, text, text, text, text, uuid), public.onboarding_case_set_status(uuid, text, text),
  public.send_vendor_rfi(uuid, text, text, text), public.onboarding_gap_raise(uuid, text, text, uuid, text, date), public.onboarding_gap_decide(uuid, boolean, text),
  public.onboarding_risk_submit(uuid, jsonb), public.onboarding_risk_decide(uuid, text, boolean, text), public.onboarding_contract_link(uuid, text),
  public.onboarding_finance_decide(uuid, boolean, text), public.onboarding_record_system_id(uuid, text, text, text, text), public.onboarding_reconcile_ids(uuid),
  public.onboarding_allocate_panels(uuid, text[]), public.onboarding_activate(uuid, jsonb), public.onboarding_min_pack(uuid),
  public.fast_track_request(uuid, text, text, date, jsonb, date), public.approve_fast_track(uuid, text, date),
  public.onboarding_remediation_update(uuid, text, text), public.onboarding_scope_block(uuid, uuid, numeric, text),
  public.srm_set_role_scope(uuid, text, text, text, text, boolean), public._onb_norm_name(text), public._onb_digits(text), public._onb_domain(text),
  public._onb_name_similar(text, text)
  from public, anon;
grant execute on function public.onboarding_duplicate_check(text, text, text, text, text, uuid), public.onboarding_request_submit(jsonb),
  public.onboarding_triage(uuid, text, text, text, text, uuid), public.onboarding_case_set_status(uuid, text, text),
  public.send_vendor_rfi(uuid, text, text, text), public.onboarding_gap_raise(uuid, text, text, uuid, text, date), public.onboarding_gap_decide(uuid, boolean, text),
  public.onboarding_risk_submit(uuid, jsonb), public.onboarding_risk_decide(uuid, text, boolean, text), public.onboarding_contract_link(uuid, text),
  public.onboarding_finance_decide(uuid, boolean, text), public.onboarding_record_system_id(uuid, text, text, text, text), public.onboarding_reconcile_ids(uuid),
  public.onboarding_allocate_panels(uuid, text[]), public.onboarding_activate(uuid, jsonb), public.onboarding_min_pack(uuid),
  public.fast_track_request(uuid, text, text, date, jsonb, date), public.approve_fast_track(uuid, text, date),
  public.onboarding_remediation_update(uuid, text, text), public.onboarding_scope_block(uuid, uuid, numeric, text),
  public.srm_set_role_scope(uuid, text, text, text, text, boolean), public._onb_norm_name(text), public._onb_digits(text), public._onb_domain(text),
  public._onb_name_similar(text, text)
  to authenticated;
