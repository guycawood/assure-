-- SRM supplier onboarding (3 of 3): governance and the read models the app uses.
--   * srm_status_taxonomy: one status vocabulary (Submitted / In review / Approved / Declined / Exception / On hold) mapped from
--     tickets, gates, cases and fast-tracks.
--   * Review cadence (governed library onboarding_review_cadence): srm_run_review_cadence creates weekly, monthly, quarterly and
--     revalidation-by-risk tasks; srm_raise_event opens a revalidation case for a material change, client request or adverse
--     finding. srt_daily_sweep (wrapped) also runs the cadence.
--   * Single source for the Code of Conduct: scorecard_inputs_effective takes "coc" from the onboarding CoC gate, never from a
--     separately keyed input.
--   * Read models: srm_onboarding_dashboard (control dashboard), srm_supplier_record (single supplier record),
--     vendor_onboarding_tracker (the vendor's plain-words view of its own onboarding; nothing internal).

-- ===========================================================================
-- Status taxonomy
-- ===========================================================================
create or replace function public.srm_status_taxonomy(p_kind text, p_status text, p_resolution text default null) returns text
language sql immutable as $$
  select case p_kind
    when 'ticket' then case when p_status in ('new','triage') then 'submitted'
                            when p_status = 'resolved' then case when coalesce(p_resolution, 'completed') = 'completed' then 'approved' else 'declined' end
                            else 'in_review' end
    when 'gate' then case when p_status in ('verified','not_required') then 'approved' when p_status = 'rejected' then 'declined'
                          when p_status in ('requested','received') then 'in_review' else 'submitted' end
    when 'case' then case p_status when 'submitted' then 'submitted' when 'in_onboarding' then 'in_review' when 'released' then 'approved'
                          when 'on_hold' then 'on_hold' else 'declined' end
    when 'fast_track' then case p_status when 'requested' then 'submitted' when 'approved' then 'exception' when 'closed' then 'approved' else 'declined' end
    when 'supplier' then p_status
  end;
$$;

-- ===========================================================================
-- Review cadence and event-based revalidation
-- ===========================================================================
create or replace function public.srm_run_review_cadence(p_as_of date default current_date) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_pk text; v_due date; v_title text; v_detail text; n int := 0; k int; v_count int; v_count2 int;
begin
  if auth.uid() is not null and not (public.is_admin() or coalesce(public.my_srt_role(), '') in ('lead','head','director')) then
    raise exception 'Only an SRT lead, the Procurement head or Director, or an admin can run the review cadence' using errcode = '42501';
  end if;
  for r in select lr.code, lr.name, lr.data from public.library_records lr
            where lr.library_key = 'onboarding_review_cadence' and lr.status = 'active'
              and lr.effective_from <= p_as_of and (lr.effective_to is null or lr.effective_to >= p_as_of) loop
    v_title := null; v_detail := null;
    case r.data->>'cadence'
      when 'weekly' then v_pk := to_char(p_as_of, 'IYYY-"W"IW'); v_due := p_as_of + 3;
      when 'monthly' then v_pk := to_char(p_as_of, 'YYYY-MM'); v_due := p_as_of + 7;
      when 'quarterly' then v_pk := to_char(p_as_of, 'YYYY-"Q"Q'); v_due := p_as_of + 14;
      else v_pk := null;
    end case;
    case r.data->>'scope'
      when 'open_cases' then
        select count(*) into v_count from public.onboarding_cases where status in ('submitted','in_onboarding','on_hold');
        v_title := format('Weekly review: %s open onboarding case%s', v_count, case when v_count = 1 then '' else 's' end);
      when 'exceptions' then
        select count(*) into v_count from public.onboarding_fast_tracks where status in ('requested','approved');
        select count(*) into v_count2 from public.onboarding_remediation_items where status = 'open' and due_date < p_as_of;
        v_title := format('Weekly review: %s fast-track exception%s, %s remediation item%s overdue', v_count, case when v_count = 1 then '' else 's' end, v_count2, case when v_count2 = 1 then '' else 's' end);
      when 'overdue_evidence' then
        select count(*) into v_count from public.onboarding_gaps where status = 'approved' and due_date < p_as_of;
        select count(*) into v_count2 from public.supplier_gates where status in ('verified','received') and expiry_date < p_as_of;
        v_title := format('Monthly review: %s documented gap%s past due, %s expired control%s', v_count, case when v_count = 1 then '' else 's' end, v_count2, case when v_count2 = 1 then '' else 's' end);
      when 'expiring_controls' then
        select count(*) into v_count from public.supplier_gates where status = 'verified' and expiry_date between p_as_of and p_as_of + 60;
        v_title := format('Monthly review: %s control%s expiring in the next 60 days', v_count, case when v_count = 1 then '' else 's' end);
      when 'sample_audit' then
        select string_agg(name, ', ') into v_detail from (select s.name from public.suppliers s where s.onboarding_released
          order by md5(s.id::text || v_pk) limit coalesce((r.data->>'sample_size')::int, 5)) x;
        v_title := 'Quarterly sample audit of released suppliers';
        v_detail := 'Check the evidence trail of: ' || coalesce(v_detail, 'no released suppliers yet');
      when 'access_review' then
        select count(*) into v_count from public.profiles where (user_type = 'internal' or is_admin) and (srt_role is not null or is_admin);
        v_title := format('Quarterly access review: %s people hold SRM roles', v_count);
      when 'revalidation' then
        if r.data->>'cadence' = 'event' then continue; end if;
        insert into public.srm_review_tasks (cadence, scope, title, detail, supplier_id, period_key, due_date, owner_role)
        select 'annual', 'revalidation', 'Revalidation due: ' || s.name, r.name, s.id,
               'due-' || to_char(coalesce(s.next_review_due, p_as_of), 'YYYY-MM'), greatest(coalesce(s.next_review_due, p_as_of), p_as_of) + 30, r.data->>'owner_role'
          from public.suppliers s left join public.supplier_profiles p on p.supplier_id = s.id
         where s.onboarding_released and s.active
           and coalesce(p.risk_level, 'low') in (select jsonb_array_elements_text(coalesce(r.data->'risk_levels', '[]'::jsonb)))
           and (s.next_review_due <= p_as_of
                or (s.next_review_due is null and coalesce(s.onboarding_carried_over_at, s.created_at)::date
                    <= p_as_of - make_interval(months => coalesce((r.data->>'interval_months')::int, 12))))
        on conflict do nothing;
        get diagnostics k = row_count; n := n + k;
        continue;
      else continue;
    end case;
    if v_pk is null or v_title is null then continue; end if;
    insert into public.srm_review_tasks (cadence, scope, title, detail, period_key, due_date, owner_role)
    values (r.data->>'cadence', r.data->>'scope', v_title, coalesce(v_detail, r.name), v_pk, v_due, r.data->>'owner_role')
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;

create or replace function public.srm_review_task_close(p_task uuid, p_outcome text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.srm_review_tasks;
begin
  perform public._assure_require_internal();
  select * into t from public.srm_review_tasks where id = p_task for update;
  if t.id is null then raise exception 'Review task not found'; end if;
  if t.status <> 'open' then raise exception 'This review is already %', t.status; end if;
  if nullif(trim(p_outcome), '') is null then raise exception 'Record the outcome of the review'; end if;
  update public.srm_review_tasks set status = 'done', outcome = trim(p_outcome), done_by = auth.uid(), done_at = now() where id = p_task;
  if t.supplier_id is not null and t.scope = 'revalidation' then
    perform set_config('assure.system_write', 'on', true);
    update public.suppliers s set next_review_due = current_date + make_interval(months => case a.review_cadence when 'quarterly' then 3 when 'semi_annual' then 6 when 'annual' then 12 else 24 end)
      from public.onboarding_activations a where a.supplier_id = s.id and s.id = t.supplier_id;
    update public.suppliers set next_review_due = current_date + interval '12 months' where id = t.supplier_id and next_review_due is null;
    perform set_config('assure.system_write', 'off', true);
    perform public._onb_event(t.supplier_id, t.case_id, 'revalidated', 'Revalidation completed', jsonb_build_object('outcome', trim(p_outcome)));
    update public.onboarding_cases set status = 'released', updated_at = now() where id = t.case_id and kind = 'revalidation' and status = 'in_onboarding';
  end if;
end $$;

create or replace function public.srm_raise_event(p_supplier uuid, p_event text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.suppliers; p public.supplier_profiles; v_case uuid; v_no bigint;
begin
  perform public._assure_require_internal();
  if coalesce(p_event, '') not in ('material_change','client_request','adverse_finding') then raise exception 'Choose the event: material change, client request or adverse finding'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Describe what happened'; end if;
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null then raise exception 'Supplier not found'; end if;
  select * into p from public.supplier_profiles where supplier_id = p_supplier;
  insert into public.onboarding_cases (kind, status, business_case, supplier_type, category, client, market, region, proposed_name, supplier_id,
    trigger_event, route, requested_by)
  values ('revalidation', 'in_onboarding', 'Revalidation (' || replace(p_event, '_', ' ') || '): ' || trim(p_note), coalesce(p.entity_type, 'manufacturer'),
    coalesce(s.category, 'General'), s.client, coalesce(s.market, 'Not set'), s.region, s.name, p_supplier, p_event, 'standard', auth.uid())
  returning id, case_no into v_case, v_no;
  insert into public.srm_review_tasks (cadence, scope, title, detail, supplier_id, case_id, period_key, due_date, owner_role)
  values ('event', 'revalidation', 'Revalidation (' || replace(p_event, '_', ' ') || '): ' || s.name, trim(p_note), p_supplier, v_case, 'event-' || v_no,
          current_date + coalesce((public._onb_setting(s.region)->>'escalation_days')::int, 5), 'srt_lead');
  if p_event = 'adverse_finding' then
    perform public._onb_set_gate(p_supplier, 'sanctions', 'requested', 'Re-screen after an adverse finding: ' || trim(p_note));
  end if;
  perform public._onb_event(p_supplier, v_case, 'revalidation_opened', 'Revalidation opened: ' || replace(p_event, '_', ' '), jsonb_build_object('note', trim(p_note)), false, true);
  perform public._approval_notify('srt_lead', 'assure', 'assure', 'Revalidation needed: ' || s.name, trim(p_note), '/assure/suppliers/' || p_supplier || '?tab=record', auth.uid());
  return v_case;
end $$;

alter function public.srt_daily_sweep() rename to _core_srt_daily_sweep;
create function public.srt_daily_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb := public._core_srt_daily_sweep();
begin
  return v || jsonb_build_object('review_tasks', public.srm_run_review_cadence(current_date));
end $$;

-- ===========================================================================
-- Scorecard: the Code of Conduct comes from the onboarding CoC gate (single source)
-- ===========================================================================
create or replace view public.scorecard_inputs_effective with (security_invoker = true) as
  select i.supplier_id, i.key, i.value_num, i.value_text, i.as_of, i.source from public.scorecard_inputs i where i.key <> 'coc'
  union all
  select g.supplier_id, 'coc', null::numeric, case when g.status = 'verified' then 'yes' else 'no' end, coalesce(g.updated_at::date, current_date),
         'Onboarding: Code of Conduct gate'
    from public.supplier_gates g where g.gate_key = 'coc';
revoke insert, update, delete on public.scorecard_inputs_effective from authenticated, anon;
revoke all on public.scorecard_inputs_effective from anon;

-- ===========================================================================
-- Read models
-- ===========================================================================
create or replace function public._onb_person(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = p;
$$;

-- Segregation exceptions (should always be zero: the database refuses them). Shown on the control dashboard.
create or replace function public._onb_segregation_exceptions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'case', 'ref', 'Request #' || c.case_no, 'supplier_id', c.supplier_id, 'detail',
             case when c.requested_by = c.triaged_by then 'Requester triaged their own request' else 'Triage approver also released the supplier' end) x
      from public.onboarding_cases c where c.requested_by = c.triaged_by or c.triaged_by = c.activated_by
    union all
    select jsonb_build_object('kind', 'activation', 'ref', s.name, 'supplier_id', s.id, 'detail', 'Released by the person who approved triage')
      from public.onboarding_activations a join public.suppliers s on s.id = a.supplier_id
      join public.supplier_gates g on g.supplier_id = a.supplier_id and g.gate_key = 'triage'
     where g.verified_by = a.activated_by
    union all
    select jsonb_build_object('kind', 'fast_track', 'ref', s.name, 'supplier_id', s.id, 'detail', 'Fast-track approved by its requester')
      from public.onboarding_fast_tracks f join public.suppliers s on s.id = f.supplier_id
     where f.requested_by in (f.director_approved_by, f.finance_approved_by)
    union all
    select jsonb_build_object('kind', 'gap', 'ref', s.name, 'supplier_id', s.id, 'detail', 'Documented gap approved by the person who raised it')
      from public.onboarding_gaps g join public.suppliers s on s.id = g.supplier_id where g.decided_by = g.raised_by
  ) y;
$$;

create or replace function public.srm_onboarding_dashboard(p_region text default null, p_market text default null, p_client text default null, p_category text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_esc int := coalesce((public._onb_setting(null)->>'escalation_days')::int, 5);
begin
  perform public._assure_require_internal();
  with sup as (
    select s.* from public.suppliers s
     where (p_region is null or s.region = p_region) and (p_market is null or s.market = p_market)
       and (p_client is null or s.client = p_client) and (p_category is null or s.category = p_category)
  ), cases as (
    select c.* from public.onboarding_cases c
     where (p_region is null or c.region = p_region) and (p_market is null or c.market = p_market)
       and (p_client is null or c.client = p_client) and (p_category is null or c.category = p_category)
  ), flight as (
    select s.*, extract(day from now() - s.onboarding_stage_since)::int as days_in_stage from sup s
     where not s.onboarding_released and s.onboarding_state in ('in_review','exception') and s.active
  ), gs as (
    select f.id as supplier_id, g.* from flight f cross join lateral public._onb_gate_states(f.id) g
  )
  select jsonb_build_object(
    'escalation_days', v_esc,
    'totals', jsonb_build_object(
      'submitted', (select count(*) from cases where status = 'submitted'),
      'in_review', (select count(*) from sup where onboarding_state = 'in_review'),
      'approved', (select count(*) from sup where onboarding_state = 'approved'),
      'declined', (select count(*) from cases where status in ('declined','duplicate','withdrawn')),
      'exception', (select count(*) from sup where onboarding_state = 'exception'),
      'on_hold', (select count(*) from sup where onboarding_state = 'on_hold') + (select count(*) from cases where status = 'on_hold' and supplier_id is null),
      'blocked', (select count(*) from sup where purchasing_blocked),
      'suppliers', (select count(*) from sup)),
    'pipeline', (select coalesce(jsonb_agg(jsonb_build_object('stage_no', st.stage_no, 'key', st.key, 'label', st.label, 'owner', st.owner_label,
        'count', coalesce(x.n, 0), 'avg_days', x.avg_days, 'max_days', x.max_days, 'over', coalesce(x.late, 0)) order by st.stage_no), '[]'::jsonb)
      from public.onboarding_stages st
      left join (select onboarding_stage, count(*) n, round(avg(days_in_stage))::int avg_days, max(days_in_stage) max_days,
                        count(*) filter (where days_in_stage > v_esc) late from flight group by onboarding_stage) x on x.onboarding_stage = st.stage_no),
    'by_owner', (select coalesce(jsonb_agg(jsonb_build_object('owner', owner, 'count', n, 'avg_days', avg_days, 'over', late) order by n desc), '[]'::jsonb)
      from (select st.owner_label owner, count(*) n, round(avg(f.days_in_stage))::int avg_days, count(*) filter (where f.days_in_stage > v_esc) late
              from flight f join public.onboarding_stages st on st.stage_no = f.onboarding_stage group by st.owner_label) y),
    'stuck', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', f.id, 'name', f.name, 'stage_no', f.onboarding_stage, 'stage', st.label,
        'owner', st.owner_label, 'days', f.days_in_stage, 'state', f.onboarding_state) order by f.days_in_stage desc), '[]'::jsonb)
      from (select * from flight order by days_in_stage desc limit 10) f join public.onboarding_stages st on st.stage_no = f.onboarding_stage),
    'missing_evidence', (select coalesce(jsonb_agg(jsonb_build_object('gate_key', gate_key, 'label', label, 'stage_no', stage_no, 'count', n) order by n desc, stage_no), '[]'::jsonb)
      from (select gate_key, label, stage_no, count(*) n from gs where not clear and verifier_role <> 'system' group by gate_key, label, stage_no) z),
    'gaps', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'supplier_id', g.supplier_id, 'name', s.name, 'gate', d.label, 'reason', g.reason,
        'status', g.status, 'due_date', g.due_date, 'days_left', g.due_date - current_date, 'owner', coalesce(public._onb_person(g.owner), case when g.owner_type = 'vendor' then 'Vendor' end))
        order by g.due_date), '[]'::jsonb)
      from public.onboarding_gaps g join sup s on s.id = g.supplier_id join public.gate_definitions d on d.key = g.gate_key
     where g.status in ('proposed','approved')),
    'remediation_overdue', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'supplier_id', i.supplier_id, 'name', s.name, 'item', i.item,
        'due_date', i.due_date, 'days_overdue', current_date - i.due_date, 'owner_type', i.owner_type, 'owner', public._onb_person(i.owner)) order by i.due_date), '[]'::jsonb)
      from public.onboarding_remediation_items i join sup s on s.id = i.supplier_id where i.status = 'open' and i.due_date < current_date),
    'remediation_open', (select count(*) from public.onboarding_remediation_items i join sup s on s.id = i.supplier_id where i.status = 'open'),
    'fast_tracks', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'supplier_id', f.supplier_id, 'name', s.name, 'status', f.status,
        'close_by', f.close_by, 'value_cap', f.scope_value_cap, 'currency', f.scope_currency, 'jobs', cardinality(f.scope_jobs),
        'director', f.director_approved_by is not null, 'finance', f.finance_approved_by is not null) order by f.requested_at desc), '[]'::jsonb)
      from public.onboarding_fast_tracks f join sup s on s.id = f.supplier_id where f.status in ('requested','approved')),
    'cert_expiry', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', s.id, 'name', s.name, 'gate', d.label, 'expiry_date', g.expiry_date,
        'days_left', g.expiry_date - current_date) order by g.expiry_date), '[]'::jsonb)
      from public.supplier_gates g join sup s on s.id = g.supplier_id join public.gate_definitions d on d.key = g.gate_key
     where g.status in ('verified','received') and g.expiry_date is not null and g.expiry_date <= current_date + 60 and s.active),
    'inactive', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', s.id, 'name', s.name, 'reason',
        case when not s.active then 'Marked inactive' else 'Released but no spend this year' end) order by s.name), '[]'::jsonb)
      from sup s where s.onboarding_released and (not s.active or coalesce(s.ytd_spend, 0) = 0)),
    'duplicates', (select coalesce(jsonb_agg(jsonb_build_object('a_id', a.id, 'a', a.name, 'b_id', b.id, 'b', b.name, 'reason', reason) order by a.name), '[]'::jsonb)
      from (select a.id a_id, b.id b_id,
                   case when public._onb_norm_name(a.name) = public._onb_norm_name(b.name) then 'Same name' else 'Same registration or VAT number' end reason
              from sup a join public.suppliers b on b.id > a.id
              left join public.supplier_profiles pa on pa.supplier_id = a.id left join public.supplier_profiles pb on pb.supplier_id = b.id
             where public._onb_norm_name(a.name) = public._onb_norm_name(b.name)
                or public._onb_digits(coalesce(pa.vat_number, pa.uen_number)) = public._onb_digits(coalesce(pb.vat_number, pb.uen_number))) d
      join public.suppliers a on a.id = d.a_id join public.suppliers b on b.id = d.b_id),
    'segregation', public._onb_segregation_exceptions(),
    'cases', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'case_no', c.case_no, 'name', c.proposed_name, 'status', c.status,
        'taxonomy', public.srm_status_taxonomy('case', c.status), 'kind', c.kind, 'client', c.client, 'market', c.market, 'urgency', c.urgency,
        'requested_by', public._onb_person(c.requested_by), 'requested_at', c.requested_at, 'supplier_id', c.supplier_id,
        'matches', jsonb_array_length(c.duplicate_matches)) order by c.requested_at desc), '[]'::jsonb)
      from (select * from cases where status in ('submitted','on_hold') or requested_at > now() - interval '30 days' order by requested_at desc limit 25) c),
    'review_tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'cadence', t.cadence, 'scope', t.scope, 'title', t.title, 'detail', t.detail,
        'due_date', t.due_date, 'supplier_id', t.supplier_id, 'owner_role', t.owner_role) order by t.due_date), '[]'::jsonb)
      from public.srm_review_tasks t where t.status = 'open'),
    'filters', jsonb_build_object(
      'regions', (select coalesce(jsonb_agg(distinct region order by region), '[]'::jsonb) from public.suppliers where region is not null),
      'markets', (select coalesce(jsonb_agg(distinct market order by market), '[]'::jsonb) from public.suppliers where market is not null),
      'clients', (select coalesce(jsonb_agg(distinct client order by client), '[]'::jsonb) from public.suppliers where client is not null),
      'categories', (select coalesce(jsonb_agg(distinct category order by category), '[]'::jsonb) from public.suppliers where category is not null))
  ) into v;
  return v;
end $$;

create or replace function public.srm_supplier_record(p_supplier uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.suppliers; p public.supplier_profiles; c public.onboarding_cases; v jsonb;
begin
  perform public._assure_require_internal();
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null then return null; end if;
  select * into p from public.supplier_profiles where supplier_id = p_supplier;
  c := public._onb_case(p_supplier);
  select jsonb_build_object(
    'supplier', jsonb_build_object('id', s.id, 'name', s.name, 'supplier_code', s.supplier_code, 'market', s.market, 'region', s.region, 'client', s.client,
       'category', s.category, 'status', s.status, 'active', s.active, 'state', s.onboarding_state, 'stage', s.onboarding_stage,
       'stage_since', s.onboarding_stage_since, 'released', s.onboarding_released, 'baseline', s.onboarding_baseline, 'blocked', s.purchasing_blocked,
       'block_reason', s.onboarding_block_reason, 'route', s.onboarding_route, 'ids_synced_at', s.ids_synced_at, 'next_review_due', s.next_review_due,
       'procurement_owner', public._onb_person(s.procurement_owner), 'srt_owner', public._onb_person(s.srt_owner), 'email', s.primary_contact_email),
    'identity', jsonb_build_object('legal_entity', p.legal_entity, 'registration_number', p.uen_number, 'vat_number', p.vat_number,
       'supplier_type', coalesce(p.entity_type, c.supplier_type), 'website', p.website, 'risk_level', coalesce(p.risk_level, 'low')),
    'case', case when c.id is null then null else to_jsonb(c) || jsonb_build_object('requested_by_name', public._onb_person(c.requested_by),
       'triaged_by_name', public._onb_person(c.triaged_by), 'activated_by_name', public._onb_person(c.activated_by)) end,
    'cases', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'case_no', x.case_no, 'kind', x.kind, 'status', x.status, 'requested_at', x.requested_at,
       'trigger_event', x.trigger_event, 'business_case', x.business_case) order by x.requested_at desc), '[]'::jsonb)
       from public.onboarding_cases x where x.supplier_id = p_supplier or x.linked_supplier_id = p_supplier),
    'stages', (select jsonb_agg(jsonb_build_object('stage_no', st.stage_no, 'key', st.key, 'label', st.label, 'owner', st.owner_label,
       'controls', st.controls, 'exit_criterion', st.exit_criterion,
       'complete', not exists (select 1 from public._onb_gate_states(p_supplier) g where g.stage_no = st.stage_no and not g.clear),
       'items', (select coalesce(jsonb_agg(jsonb_build_object('gate_key', g.gate_key, 'label', g.label, 'status', g.status, 'clear', g.clear,
            'critical', g.critical, 'expiry_date', g.expiry_date, 'expired', g.expired, 'gap_id', g.gap_id, 'gap_due', g.gap_due, 'allows_gap', g.allows_gap,
            'system', g.verifier_role = 'system', 'note', g.note, 'rejection_reason', g.rejection_reason, 'vendor_facing', g.vendor_facing,
            'taxonomy', public.srm_status_taxonomy('gate', g.status))), '[]'::jsonb)
          from public._onb_gate_states(p_supplier) g where g.stage_no = st.stage_no)) order by st.stage_no)
       from public.onboarding_stages st),
    'gaps', (select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('gate', d.label, 'owner_name', public._onb_person(g.owner),
       'raised_by_name', public._onb_person(g.raised_by), 'decided_by_name', public._onb_person(g.decided_by)) order by g.raised_at desc), '[]'::jsonb)
       from public.onboarding_gaps g join public.gate_definitions d on d.key = g.gate_key where g.supplier_id = p_supplier),
    'risk_review', (select to_jsonb(r) || jsonb_build_object('submitted_by_name', public._onb_person(r.submitted_by), 'cm_by_name', public._onb_person(r.cm_by),
       'quality_by_name', public._onb_person(r.quality_by)) from public.onboarding_risk_reviews r where r.supplier_id = p_supplier),
    'risk_rules', (select to_jsonb(x) from public._onb_risk_rules(p_supplier) x),
    'contracts', (select jsonb_agg(jsonb_build_object('doc', d.doc, 'label', d.label, 'gate_status', g.status,
       'contracts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'ref', k.contract_ref, 'status', k.status,
            'stored', nullif(trim(k.document_path), '') is not null, 'end_date', k.end_date)), '[]'::jsonb)
          from public.contracts k where k.supplier_id = p_supplier and (k.onboarding_doc = d.doc or (d.doc = 'psa' and k.onboarding_doc = 'schedule')))) order by d.sort)
       from (values ('nda', 'NDA', 1), ('coc', 'Code of Conduct', 2), ('msa', 'MSA / terms and conditions', 3), ('psa', 'PSA / SSA and schedules', 4)) d(doc, label, sort)
       left join public.supplier_gates g on g.supplier_id = p_supplier and g.gate_key = d.doc),
    'untagged_contracts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'status', k.status)), '[]'::jsonb)
       from public.contracts k where k.supplier_id = p_supplier and k.onboarding_doc is null and k.status not in ('cancelled','declined')),
    'system_ids', (select coalesce(jsonb_agg(jsonb_build_object('system', x.sys, 'label', x.label, 'required', g.status is distinct from 'not_required',
       'gate_status', g.status, 'external_id', i.external_id, 'name_in_system', i.name_in_system, 'vat_in_system', i.vat_in_system, 'reconciled', i.reconciled,
       'recorded_at', i.recorded_at) order by x.sort), '[]'::jsonb)
       from (values ('stocktool', 'id_stocktool', 'StockTool', 1), ('erp', 'id_erp', 'NAV / ERP', 2), ('sourcing_hub', 'id_hub', 'Sourcing Hub', 3)) x(sys, gate, label, sort)
       left join public.supplier_gates g on g.supplier_id = p_supplier and g.gate_key = x.gate
       left join public.supplier_system_ids i on i.supplier_id = p_supplier and i.system = x.sys),
    'panels', (select coalesce(jsonb_agg(panel order by panel), '[]'::jsonb) from public.supplier_panels where supplier_id = p_supplier),
    'activation', (select to_jsonb(a) || jsonb_build_object('owner_name', public._onb_person(a.owner), 'activated_by_name', public._onb_person(a.activated_by))
       from public.onboarding_activations a where a.supplier_id = p_supplier),
    'fast_track', (select to_jsonb(f) || jsonb_build_object('requested_by_name', public._onb_person(f.requested_by),
       'director_name', public._onb_person(f.director_approved_by), 'finance_name', public._onb_person(f.finance_approved_by),
       'taxonomy', public.srm_status_taxonomy('fast_track', f.status),
       'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'job_number', j.job_number, 'title', j.title)), '[]'::jsonb) from public.jobs j where j.id = any (f.scope_jobs)))
       from public.onboarding_fast_tracks f where f.supplier_id = p_supplier order by f.requested_at desc limit 1),
    'remediation', (select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object('owner_name', public._onb_person(i.owner), 'overdue', i.status = 'open' and i.due_date < current_date)
       order by i.due_date, i.item), '[]'::jsonb) from public.onboarding_remediation_items i where i.supplier_id = p_supplier),
    'certificates', (select coalesce(jsonb_agg(jsonb_build_object('label', d.label, 'status', g.status, 'expiry_date', g.expiry_date,
       'days_left', g.expiry_date - current_date) order by g.expiry_date), '[]'::jsonb)
       from public.supplier_gates g join public.gate_definitions d on d.key = g.gate_key where g.supplier_id = p_supplier and d.has_expiry),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object('type', r.approval_type, 'title', r.title, 'status', r.status, 'role', public.approval_role_label(r.approver_role),
       'requested_by', public._onb_person(r.requested_by), 'requested_at', r.requested_at, 'decided_by', public._onb_person(r.decided_by), 'decided_at', r.decided_at,
       'note', r.decision_note) order by r.requested_at desc), '[]'::jsonb)
       from public.approval_requests r where r.entity_id = p_supplier::text),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('type', d.approval_type, 'decision', d.decision, 'note', d.note, 'by', public._onb_person(d.actor), 'at', d.at)
       order by d.at desc), '[]'::jsonb)
       from public.approval_decisions d where d.entity_id = p_supplier::text or d.entity_id in (select id::text from public.onboarding_gaps where supplier_id = p_supplier)),
    'events', (select coalesce(jsonb_agg(e order by e->>'at' desc), '[]'::jsonb) from (
       select jsonb_build_object('at', at, 'title', title, 'kind', kind, 'by', public._onb_person(actor), 'source', 'onboarding') e
         from public.onboarding_events where supplier_id = p_supplier
       union all
       select jsonb_build_object('at', l.created_at, 'title', coalesce(d.label, l.gate_key) || ': ' || coalesce(l.from_status, 'new') || ' â†’ ' || coalesce(l.to_status, '')
                || coalesce(' (' || l.note || ')', ''), 'kind', 'gate', 'by', public._onb_person(l.actor), 'source', 'gate')
         from public.gate_audit_log l left join public.gate_definitions d on d.key = l.gate_key where l.supplier_id = p_supplier
       order by 1 limit 400) z),
    'min_pack', public.onboarding_min_pack(p_supplier),
    'review_tasks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date), '[]'::jsonb) from public.srm_review_tasks t where t.supplier_id = p_supplier),
    'can', jsonb_build_object(
       'triage', public.approval_has_role('procurement', 'assure'), 'gap_decide', public.approval_has_role('srt_lead', 'assure') or public.approval_has_role('procurement', 'assure'),
       'risk_cm', public.approval_has_role('category_manager', 'assure'), 'risk_quality', public.approval_has_role('quality', 'assure'),
       'finance', public.approval_has_role('local_finance', s.market), 'ids', public.assure_is_vendor_manager() or public.approval_has_role('finance', 'assure'),
       'activate', public.approval_has_role('procurement', 'assure'), 'director', public.approval_has_role('procurement_director', 'assure'),
       'vendor_manager', public.assure_is_vendor_manager())
  ) into v;
  return v;
end $$;

-- The vendor's own onboarding, in plain words. Only vendor-facing items; no internal notes, spend or approvals.
create or replace function public.vendor_onboarding_tracker() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); s public.suppliers; v jsonb;
begin
  if v_sup is null then raise exception 'Only vendor users can see their onboarding' using errcode = '42501'; end if;
  select * into s from public.suppliers where id = v_sup;
  select jsonb_build_object(
    'name', s.name, 'released', s.onboarding_released, 'stage', s.onboarding_stage, 'exception', s.onboarding_state = 'exception',
    'blocked_by_overdue', exists (select 1 from public.onboarding_remediation_items i where i.supplier_id = v_sup and i.status = 'open' and i.due_date < current_date),
    'stages', (select jsonb_agg(jsonb_build_object('stage_no', st.stage_no, 'label', st.label, 'text', st.vendor_text, 'action', st.vendor_action,
       'status', case when s.onboarding_released or st.stage_no < s.onboarding_stage then 'done' when st.stage_no = s.onboarding_stage then 'current' else 'upcoming' end,
       'needs_you', exists (select 1 from public._onb_gate_states(v_sup) g where g.stage_no = st.stage_no and g.vendor_facing and not g.clear)) order by st.stage_no)
       from public.onboarding_stages st),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('label', g.vendor_label, 'stage_no', g.stage_no,
       'status', case g.status when 'missing' then 'Needed from you' when 'requested' then 'Needed from you' when 'received' then 'Received, being checked'
                               when 'rejected' then 'Please resubmit' else 'Done' end,
       'what_to_fix', case when g.status = 'rejected' then g.rejection_reason end, 'expired', g.expired) order by g.stage_no), '[]'::jsonb)
       from public._onb_gate_states(v_sup) g where g.vendor_facing and not g.clear and g.gap_id is null),
    'remediation', (select coalesce(jsonb_agg(jsonb_build_object('item', coalesce(d.vendor_label, i.item), 'due_date', i.due_date,
       'overdue', i.due_date < current_date) order by i.due_date), '[]'::jsonb)
       from public.onboarding_remediation_items i left join public.gate_definitions d on d.key = i.gate_key
      where i.supplier_id = v_sup and i.owner_type = 'vendor' and i.status = 'open'),
    'gaps', (select coalesce(jsonb_agg(jsonb_build_object('item', coalesce(d.vendor_label, d.label), 'due_date', g.due_date) order by g.due_date), '[]'::jsonb)
       from public.onboarding_gaps g join public.gate_definitions d on d.key = g.gate_key
      where g.supplier_id = v_sup and g.owner_type = 'vendor' and g.status = 'approved')
  ) into v;
  return v;
end $$;

-- ===========================================================================
-- Privileges
-- ===========================================================================
revoke execute on function public._onb_person(uuid), public._onb_segregation_exceptions(), public._core_srt_daily_sweep() from public, anon, authenticated;
revoke execute on function public.srm_status_taxonomy(text, text, text), public.srm_run_review_cadence(date), public.srm_review_task_close(uuid, text),
  public.srm_raise_event(uuid, text, text), public.srt_daily_sweep(), public.srm_onboarding_dashboard(text, text, text, text),
  public.srm_supplier_record(uuid), public.vendor_onboarding_tracker() from public, anon;
grant execute on function public.srm_status_taxonomy(text, text, text), public.srm_run_review_cadence(date), public.srm_review_task_close(uuid, text),
  public.srm_raise_event(uuid, text, text), public.srt_daily_sweep(), public.srm_onboarding_dashboard(text, text, text, text),
  public.srm_supplier_record(uuid), public.vendor_onboarding_tracker() to authenticated;
