-- DUMMY DATA: balanced scorecard reporting (migration 20261027000001). Runs after m95.
-- Every brand, figure and target here is invented. Clients are looked up by id (the demo accounts c5000000-...-0001 to -0004),
-- never by name. ~15 months of orders (jobs, specs, triage, approved estimates, POs, QA/QC, deliveries with PODs), client
-- survey responses, a brand taxonomy and per-client / per-market targets, so every chart on the scorecard has shape.
-- Safe on an existing demo database: library rows are guarded by "not exists", and the orders are only generated once
-- (keyed on fixed ids derived from md5('m97-...')).
select set_config('sourcing.system_write', 'on', false);

-- ---------------------------------------------------------------------------
-- Brand taxonomy (invented brands): business unit and power-brand flag per client account
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'client_brands', x.code, x.name, jsonb_build_object('client_id', x.client, 'business_unit', x.bu, 'power_brand', x.power), 'active', date '2025-01-01', 'Demo brand (invented)'
  from (values
    ('BR-LUMORA', 'Lumora', 'c5000000-0000-4000-8000-000000000001', 'Personal care', true),
    ('BR-FRESKO', 'Fresko', 'c5000000-0000-4000-8000-000000000001', 'Nutrition', true),
    ('BR-GLACIERA', 'Glaciera', 'c5000000-0000-4000-8000-000000000001', 'Ice cream', true),
    ('BR-SOLENNE', 'Solenne', 'c5000000-0000-4000-8000-000000000001', 'Beauty & wellbeing', true),
    ('BR-PUREVA', 'Pureva', 'c5000000-0000-4000-8000-000000000001', 'Home care', false),
    ('BR-VANTAGE', 'Vantage', 'c5000000-0000-4000-8000-000000000001', 'Personal care', false),
    ('BR-BRIGHTLEAF', 'Brightleaf', 'c5000000-0000-4000-8000-000000000001', 'Nutrition', false),
    ('BR-NORTHBREW', 'Northbrew', 'c5000000-0000-4000-8000-000000000002', 'Beer', true),
    ('BR-ZERONORTH', 'Zero North', 'c5000000-0000-4000-8000-000000000002', 'Low and no alcohol', true),
    ('BR-AMBERFIELD', 'Amberfield', 'c5000000-0000-4000-8000-000000000002', 'Beer', false),
    ('BR-CIDERWOOD', 'Ciderwood', 'c5000000-0000-4000-8000-000000000002', 'Cider', false),
    ('BR-CAREWELL', 'Carewell', 'c5000000-0000-4000-8000-000000000003', 'Ostomy care', true),
    ('BR-SOFTSEAL', 'Softseal', 'c5000000-0000-4000-8000-000000000003', 'Continence care', false),
    ('BR-SKINGUARD', 'Skinguard', 'c5000000-0000-4000-8000-000000000003', 'Skin care', false),
    ('BR-KESTREL', 'Kestrel', 'c5000000-0000-4000-8000-000000000004', 'General', false),
    ('BR-ORBIT', 'Orbit', 'c5000000-0000-4000-8000-000000000004', 'General', false)
  ) x(code, name, client, bu, power)
 where exists (select 1 from public.sourcing_clients c where c.id = x.client::uuid)
   and not exists (select 1 from public.library_records r where r.library_key = 'client_brands' and r.code = x.code);

-- ---------------------------------------------------------------------------
-- Targets: two client accounts, a few markets and one client + market (overriding the KPI defaults)
-- ---------------------------------------------------------------------------
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'scorecard_targets', x.code, x.name,
       jsonb_strip_nulls(jsonb_build_object('kpi_code', x.kpi, 'client_id', x.client, 'market', x.market, 'target', x.target)),
       'active', date '2025-07-01', 'Demo target'
  from (values
    ('TGT-SAV-C2', 'Savings target, account C2', 'SAVINGS_PCT', 'c5000000-0000-4000-8000-000000000002', null, 12),
    ('TGT-URG-C2', 'Urgent jobs ceiling, account C2', 'URGENT_PCT', 'c5000000-0000-4000-8000-000000000002', null, 8),
    ('TGT-OTIF-C2', 'OTIF target, account C2', 'OTIF_PCT', 'c5000000-0000-4000-8000-000000000002', null, 97),
    ('TGT-SAV-C2-NL', 'Savings target, account C2 in the Netherlands', 'SAVINGS_PCT', 'c5000000-0000-4000-8000-000000000002', 'NL', 13),
    ('TGT-RC-C3', 'Rate-card usage target, account C3', 'RATE_CARD_PCT', 'c5000000-0000-4000-8000-000000000003', null, 45),
    ('TGT-PJ-C3', 'Perfect job target, account C3', 'PERFECT_JOB_PCT', 'c5000000-0000-4000-8000-000000000003', null, 98),
    ('TGT-LEAD-C3', 'Lead time target, account C3', 'MEDIAN_LEAD_DAYS', 'c5000000-0000-4000-8000-000000000003', null, 50),
    ('TGT-SAV-VN', 'Savings target, Vietnam', 'SAVINGS_PCT', null, 'VN', 15),
    ('TGT-SAV-IN', 'Savings target, India', 'SAVINGS_PCT', null, 'IN', 14),
    ('TGT-OTIF-GB', 'OTIF target, United Kingdom', 'OTIF_PCT', null, 'GB', 96),
    ('TGT-RC-DE', 'Rate-card usage target, Germany', 'RATE_CARD_PCT', null, 'DE', 60)
  ) x(code, name, kpi, client, market, target)
 where (x.client is null or exists (select 1 from public.sourcing_clients c where c.id = x.client::uuid))
   and not exists (select 1 from public.library_records r where r.library_key = 'scorecard_targets' and r.code = x.code);

-- ---------------------------------------------------------------------------
-- Orders: ~280 jobs over the last 15 months
-- ---------------------------------------------------------------------------
create or replace function public._m97_r(p_i int, p_salt text) returns numeric language sql immutable as $$
  select (('x' || substr(md5(p_salt || ':' || p_i), 1, 8))::bit(32)::bigint)::numeric / 4294967295;
$$;
create or replace function public._m97_id(p_kind text, p_i int, p_j int default 0) returns uuid language sql immutable as $$
  select md5('m97-' || p_kind || '-' || p_i || '-' || p_j)::uuid;
$$;

create or replace function public._m97_type(p_i int, p_k int) returns text language sql immutable as $$
  select case when r < 0.45 then '2d' when r < 0.75 then '3d' when r < 0.9 then 'promo_merch' else 'custom_goods_services' end
    from (select public._m97_r(p_i * 10 + p_k, 'type') r) x;
$$;
create or replace function public._m97_route(p_i int, p_k int, p_ci int) returns text language sql immutable as $$
  select case public._m97_type(p_i, p_k)
    when '2d' then case when r < 0.72 then 'adopt' when r < 0.86 then 'adapt' when r < 0.93 then 'push' else 'create' end
    when '3d' then case when r < 0.38 then 'adopt' when r < 0.66 then 'adapt' when r < 0.69 then 'push' else 'create' end
    when 'promo_merch' then case when r < 0.55 then 'adopt' when r < 0.75 then 'adapt' else 'create' end
    else case when r < 0.2 then 'adopt' when r < 0.5 then 'adapt' else 'create' end end
    from (select public._m97_r(p_i * 10 + p_k, 'route') + case when p_ci = 3 then 0.12 else 0 end r) x;
$$;

do $$
declare
  v_clients uuid[] := array['c5000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000002',
                            'c5000000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-000000000004']::uuid[];
  v_markets text[][] := array[
    array['GB','GB','NL','DE','FR','IT','ES','PL','VN','ID','TH','IN','PH','VN','GB'],
    array['NL','NL','DE','GB','IT','ES','FR','VN','NL','DE','GB','IT','ES','NL','DE'],
    array['DE','FR','GB','US','NL','DE','FR','GB','US','NL','DE','FR','GB','US','DE'],
    array['GB','DE','SG','GB','DE','SG','GB','DE','SG','GB','DE','SG','GB','DE','SG']];
  v_brands text[][] := array[
    array['Lumora','Fresko','Glaciera','Solenne','Pureva','Vantage','Lumora','Fresko'],
    array['Northbrew','Zero North','Amberfield','Ciderwood','Northbrew','Zero North','Northbrew','Amberfield'],
    array['Carewell','Softseal','Skinguard','Carewell','Softseal','Carewell','Skinguard','Carewell'],
    array['Kestrel','Orbit','Kestrel','Orbit','Kestrel','Orbit','Kestrel','Orbit']];
  v_items text[] := array['Shelf strips','Gondola end','Floor display unit','Wobblers','Gift-with-purchase pack','Window graphics','Counter unit','Bar runners','Promo tote bags','Shelf barker set'];
  c public.sourcing_clients; v_ci int; i int; k int; n_specs int; r numeric; v_job uuid; v_brief uuid; v_spec uuid; v_tri uuid; v_est uuid; v_line uuid; v_po uuid; v_del uuid;
  v_mk text; v_mk_name text; v_region text; v_brand text; v_open date; v_urgent boolean; v_gov text; v_days int; v_target date; v_delivered boolean;
  v_type text; v_route text; v_cx text; v_qty int; v_unit numeric; v_cost numeric; v_s numeric; v_bench numeric; v_base numeric; v_method text;
  v_src text; v_bsrc text; v_sup uuid; v_card uuid; v_approved timestamptz; v_issued timestamptz; v_late int; v_ship int; v_ok boolean; v_ftp boolean;
  v_job_delivered timestamptz; v_sup_ids uuid[]; v_n int;
begin
  if exists (select 1 from public.jobs where id = public._m97_id('job', 1)) then return; end if;
  if (select count(*) from public.sourcing_clients where id = any (v_clients) and crm_setup_status = 'approved') < 4 then return; end if;
  select id into v_card from public.library_records where library_key = 'rate_cards' and status = 'active' order by code limit 1;

  for i in 1..280 loop
    v_ci := case when i <= 130 then 1 when i <= 210 then 2 when i <= 255 then 3 else 4 end;
    select * into c from public.sourcing_clients where id = v_clients[v_ci];
    v_mk := v_markets[v_ci][1 + floor(public._m97_r(i, 'mk') * 15)::int];
    select name, region_code into v_mk_name, v_region from public.markets where code = v_mk;
    v_brand := v_brands[v_ci][1 + floor(public._m97_r(i, 'br') * 8)::int];
    v_open := current_date - 470 + floor(public._m97_r(i, 'open') * 445)::int;
    v_urgent := public._m97_r(i, 'urg') < case v_ci when 2 then 0.16 else 0.07 end;
    v_gov := case when public._m97_r(i, 'gov') < 0.55 then 'central' else 'business_unit' end;
    n_specs := 1 + (public._m97_r(i, 'n1') < 0.45)::int + (public._m97_r(i, 'n2') < 0.15)::int;
    v_days := case when v_urgent then 9 + floor(public._m97_r(i, 'd') * 9)::int else 22 + floor(public._m97_r(i, 'd') * 26)::int end;
    -- Create and complex 3D work takes longer to make.
    v_days := v_days + (select max(case public._m97_route(i, kk, v_ci) when 'create' then 12 when 'adapt' then 5 else 0 end
                                     + case public._m97_type(i, kk) when '3d' then 6 else 0 end) from generate_series(1, n_specs) kk);
    v_target := v_open + v_days;
    v_delivered := v_target + 6 < current_date;
    v_job := public._m97_id('job', i);
    v_brief := public._m97_id('brief', i);
    select array_agg(id order by supplier_code) into v_sup_ids from public.suppliers
     where supplier_code like 'DEMO-%' and region = coalesce(nullif(v_region, 'GSC'), 'EMEA') and active;
    if v_sup_ids is null then select array_agg(id order by supplier_code) into v_sup_ids from public.suppliers where supplier_code like 'DEMO-%' and active; end if;

    insert into public.jobs (id, title, client_id, region, market, brand, budget, currency, opened_date, target_delivery_date, status,
      urgent, governance_model, created_at, notes)
    values (v_job, v_brand || ' ' || lower(v_items[1 + floor(public._m97_r(i, 'it') * 10)::int]) || ' (demo ' || i || ')', c.id, v_region, v_mk_name, v_brand,
      round(2000 + public._m97_r(i, 'bud') * 60000), c.default_currency, v_open, v_target, 'in_production', v_urgent, v_gov,
      (v_open + time '09:00')::timestamptz, 'Dummy job (scorecard demo)');

    -- The brief behind the job; some fields left empty so brief quality varies.
    insert into public.briefs (id, region, market, client, client_id, brand, division, title, objective, brief_text, target_outlets, budget_low, budget_high,
      currency, target_launch, product_category, sustainability_targets, status, approval_status, submitted_at, reviewed_at, resulting_job_id, created_at)
    values (v_brief, v_region, v_mk, null, c.id, v_brand,
      case when public._m97_r(i, 'b1') < 0.85 then (select data->>'business_unit' from public.library_records where library_key = 'client_brands' and name = v_brand limit 1) end,
      v_brand || ' activation brief (demo ' || i || ')',
      case when public._m97_r(i, 'b2') < 0.95 then 'Lift visibility and trial in-store (dummy objective)' end,
      case when public._m97_r(i, 'b3') < 0.9 then 'Dummy brief text: formats, quantities and timings as agreed with the account team.' end,
      case when public._m97_r(i, 'b4') < case v_ci when 3 then 0.6 else 0.93 end then 'Supermarkets and convenience (dummy)' end,
      case when public._m97_r(i, 'b5') < 0.9 then 1000 end, case when public._m97_r(i, 'b5') < 0.9 then 50000 end,
      c.default_currency, case when public._m97_r(i, 'b6') < 0.9 then v_target end,
      case when public._m97_r(i, 'b7') < case v_ci when 3 then 0.55 else 0.93 end then 'POSM' end,
      case when public._m97_r(i, 'b8') < 0.7 then 'Recyclable materials preferred (dummy)' end,
      'spec_created', 'approved', (v_open - 3 - floor(public._m97_r(i, 'bs') * 6)::int + time '10:00')::timestamptz,
      (v_open - 1 + time '15:00')::timestamptz, v_job, (v_open - 10 + time '09:00')::timestamptz);
    update public.jobs set brief_id = v_brief where id = v_job;

    v_job_delivered := null;
    for k in 1..n_specs loop
      v_type := public._m97_type(i, k);
      v_route := public._m97_route(i, k, v_ci);
      r := public._m97_r(i * 10 + k, 'cx');
      v_cx := case when v_type = '3d' then case when r < 0.6 then 'high' else 'medium' end
                   when v_type = '2d' then case when r < 0.7 then 'low' when r < 0.95 then 'medium' else 'high' end
                   else case when r < 0.3 then 'low' when r < 0.8 then 'medium' else 'high' end end;
      v_qty := case v_type when '2d' then 50 + floor(public._m97_r(i * 10 + k, 'q') * 2950) when '3d' then 5 + floor(public._m97_r(i * 10 + k, 'q') * 75)
                           when 'promo_merch' then 300 + floor(public._m97_r(i * 10 + k, 'q') * 2700) else 20 + floor(public._m97_r(i * 10 + k, 'q') * 380) end;
      v_unit := round(case v_type when '2d' then 0.3 + public._m97_r(i * 10 + k, 'u') * 3.5 when '3d' then 120 + public._m97_r(i * 10 + k, 'u') * 780
                                  when 'promo_merch' then 2 + public._m97_r(i * 10 + k, 'u') * 13 else 10 + public._m97_r(i * 10 + k, 'u') * 110 end, 4);
      v_cost := round(v_unit * v_qty, 2);
      -- Saving: by route, lower when urgent, higher when business-unit-led, lower for complex specs; a little noise.
      v_s := case v_route when 'adopt' then 0.13 when 'adapt' then 0.16 when 'create' then 0.11 else 0.09 end
             * case when v_urgent then 0.4 else 1 end * case when v_gov = 'business_unit' then 1.3 else 1 end
             * case v_cx when 'high' then 0.75 when 'medium' then 0.9 else 1 end
             * case when v_mk in ('VN','IN') then 1.25 else 1 end
             + (public._m97_r(i * 10 + k, 'noise') - 0.5) * 0.05;
      v_s := greatest(v_s, -0.03);
      v_sup := v_sup_ids[1 + floor(public._m97_r(i * 10 + k, 'sup') * cardinality(v_sup_ids))::int];
      v_spec := public._m97_id('spec', i, k);
      insert into public.job_specs (id, job_id, title, spec_type, complexity, product_category, impact_grade, design_score, harmonised, spend_exempt, created_at)
      values (v_spec, v_job, v_items[1 + floor(public._m97_r(i * 10 + k, 'it') * 10)::int] || ' (demo)', v_type, v_cx,
        case v_type when '2d' then 'Print' when '3d' then 'Retail display' when 'promo_merch' then 'Promo & merch' else 'Goods & services' end,
        round(3 + public._m97_r(i * 10 + k, 'ig') * 6 + case when v_ci = 1 then -0.6 else 0 end, 1),
        case when public._m97_r(i * 10 + k, 'dsn') < 0.85 then least(10, round(4.5 + public._m97_r(i * 10 + k, 'ds') * 5 + case when v_route = 'create' then 0.4 else 0 end, 1)) end,
        public._m97_r(i * 10 + k, 'harm') < 0.1, public._m97_r(i * 10 + k, 'ex') < 0.06, (v_open + time '11:00')::timestamptz);

      v_tri := public._m97_id('triage', i, k);
      v_bsrc := case when v_route in ('adopt','push') or (v_route = 'adapt' and public._m97_r(i * 10 + k, 'ad') < 0.5) then 'rate_card' else 'live' end;
      insert into public.spec_triage (id, spec_id, route, reason, confidence, rate_card_id, unit_price, currency, quantity, supplier_id, push_status,
        rule_version, source, decided_at)
      values (v_tri, v_spec, v_route, 'Dummy triage (scorecard demo)', round(0.6 + public._m97_r(i * 10 + k, 'conf') * 0.39, 3),
        case when v_bsrc = 'rate_card' then v_card end, case when v_bsrc = 'rate_card' then v_unit end, c.default_currency, v_qty,
        case when v_bsrc = 'rate_card' then v_sup end, case when v_route = 'push' then 'accepted' end, 'triage-rules-v1', 'rule',
        (v_open + 1 + time '10:00')::timestamptz);

      -- Saving method: live benchmark for quoted lines; a baseline (reference, prior year, value engineering) for rate-card lines.
      r := public._m97_r(i * 10 + k, 'meth');
      if v_bsrc = 'live' then
        v_bench := round(v_unit * (1 + greatest(v_s, 0)), 4); v_base := null;
        v_method := case when v_s <= 0.005 then 'no_saving' when r < 0.2 then 'value_engineering' else null end;
      else
        v_bench := v_unit;
        if r < 0.04 then v_base := round(v_unit * 0.97, 4); v_method := 'missed_opportunity';
        elsif v_s <= 0.005 then v_base := null; v_method := 'no_saving';
        else v_base := round(v_unit * (1 + v_s), 4);
             v_method := case when r < 0.5 then 'reference_pricing' when r < 0.8 then 'prior_year_baseline' else 'value_engineering' end;
        end if;
      end if;
      v_src := case when v_bsrc = 'rate_card' then case v_route when 'push' then 'push' when 'adapt' then 'adapt' else 'adopt' end else 'rfq' end;
      v_approved := (v_open + 4 + floor(public._m97_r(i * 10 + k, 'appr') * 6)::int + time '14:00')::timestamptz;
      v_est := public._m97_id('estimate', i, k);
      insert into public.estimates (id, job_id, supplier_id, source, currency, base_cost, benchmark_value, benchmark_source, pricing_mode, pricing_percent,
        savings_vs_benchmark, savings_target_percent, selection_reason, status, sent_at, approved_at, region, market, created_at)
      values (v_est, v_job, v_sup, v_src, c.default_currency, v_cost, round(v_bench * v_qty, 2), v_bsrc, 'markup', c.default_markup_percent,
        round((v_bench - v_unit) * v_qty, 2), c.savings_target_percent, 'Dummy award (scorecard demo)', 'approved', v_approved - interval '2 days', v_approved,
        v_region, v_mk_name, v_approved - interval '3 days');
      v_line := public._m97_id('line', i, k);
      insert into public.estimate_lines (id, estimate_id, spec_id, triage_id, quantity, unit_cost, line_cost, benchmark_unit, savings_method, baseline_unit)
      values (v_line, v_est, v_spec, v_tri, v_qty, v_unit, v_cost, v_bench, v_method, v_base);

      -- PO: mostly issued the same or next day; some late (more for account 3).
      r := public._m97_r(i * 10 + k, 'po');
      v_issued := v_approved + case when r < case v_ci when 3 then 0.8 else 0.975 end then make_interval(hours => 2 + floor(public._m97_r(i * 10 + k, 'poh') * 30)::int)
                                     else make_interval(days => 3 + floor(public._m97_r(i * 10 + k, 'pod') * 6)::int) end;
      v_po := public._m97_id('po', i, k);
      insert into public.purchase_orders (id, job_id, estimate_id, supplier_id, currency, total_value, po_date, delivery_date, status, required_doa_level, doa_basis,
        approved_at, issued_at, vendor_responded_at, region, market, notes, created_at)
      values (v_po, v_job, v_est, v_sup, c.default_currency, v_cost, v_issued::date, v_target, 'accepted', 1, 'Dummy (scorecard demo)',
        v_issued, v_issued, v_issued + interval '1 day', v_region, v_mk_name, 'Dummy PO (scorecard demo)', v_issued - interval '1 hour');

      -- QA/QC: closed plans for delivered work (a few failed or passed only on a second submission), open ones otherwise.
      r := public._m97_r(i * 10 + k, 'qa');
      v_ok := r >= case when v_mk = 'IN' then 0.12 when v_ci = 3 then 0.04 else 0.015 end;
      v_ftp := v_ok and public._m97_r(i * 10 + k, 'ftp') >= 0.02;
      insert into public.qaqc_plans (id, job_id, po_id, estimate_line_id, spec_id, supplier_id, client_id, region, market, computed_level, required_level,
        level_name, status, passed_at, failed_at, created_at)
      values (public._m97_id('plan', i, k), v_job, v_po, v_line, v_spec, v_sup, c.id, v_region, v_mk,
        case v_cx when 'high' then 3 when 'medium' then 2 else 1 end, case v_cx when 'high' then 3 when 'medium' then 2 else 1 end, null,
        case when not v_delivered then 'in_progress' when v_ok then 'passed' else 'failed' end,
        case when v_delivered and v_ok then v_target - 4 + time '12:00' end, case when v_delivered and not v_ok then v_target - 4 + time '12:00' end, v_issued);
      if v_delivered then
        insert into public.qaqc_checkpoints (plan_id, checkpoint, seq, status, submission_count, submitted_at, submitted_by_vendor, verified_at, first_time_pass, failed)
        values (public._m97_id('plan', i, k), 'pre_shipment', 3, case when v_ok then 'verified' else 'rejected' end, case when v_ftp then 1 else 2 end,
          (v_target - 5 + time '10:00')::timestamptz, true, (v_target - 4 + time '12:00')::timestamptz, v_ftp, not v_ok);
      end if;

      -- Delivery with a verified POD: a few late, a few short.
      if v_delivered then
        r := public._m97_r(i * 10 + k, 'late');
        v_late := case when r < case when v_mk in ('VN','PH','ID') then 0.12 when v_ci = 2 then 0.07 else 0.025 end then 2 + floor(public._m97_r(i * 10 + k, 'ld') * 5)::int
                       else -floor(public._m97_r(i * 10 + k, 'ld') * 3)::int end;
        v_ship := case when public._m97_r(i * 10 + k, 'short') < 0.03 then greatest(1, floor(v_qty * 0.95)::int) else v_qty end;
        v_del := public._m97_id('delivery', i, k);
        insert into public.deliveries (id, po_id, job_id, supplier_id, spec_id, quantity, uom, recipient_name, city, region, market, delivery_method,
          planned_dispatch_date, planned_delivery_date, actual_delivery_date, status, delivered_at, special_instructions)
        values (v_del, v_po, v_job, v_sup, v_spec, v_qty, 'units', 'Store receiving (dummy)', 'Demo city', v_region, v_mk, 'road',
          v_target - 5, v_target, v_target + v_late, 'delivered', (v_target + v_late + time '11:00')::timestamptz, 'Dummy delivery (scorecard demo)');
        insert into public.shipments (id, delivery_id, supplier_id, service_level, tracking_reference, dispatch_date, actual_delivery_date, quantity_shipped,
          pod_status, pod_received_at, pod_captured_at, pod_time_stated, pod_verified_at, recorded_by_vendor, notes)
        values (public._m97_id('shipment', i, k), v_del, v_sup, 'Pallet', 'SC-' || i || '-' || k, least(v_target - 5, v_target + v_late), v_target + v_late, v_ship,
          'verified', (v_target + v_late + 1 + time '09:00')::timestamptz, (v_target + v_late + time '11:00')::timestamptz, true,
          (v_target + v_late + 2 + time '10:00')::timestamptz, true, 'Dummy shipment (scorecard demo)');
        v_job_delivered := greatest(v_job_delivered, (v_target + v_late + time '11:00')::timestamptz);
      end if;
    end loop;

    update public.jobs set status = case when v_delivered then 'delivered' else 'in_production' end,
           production_started_at = (v_open + 8 + time '09:00')::timestamptz, delivered_at = v_job_delivered
     where id = v_job;
  end loop;

  -- Client survey responses (market temperature): roughly one per account and market each quarter.
  for i in 1..150 loop
    v_ci := case when i <= 60 then 1 when i <= 105 then 2 when i <= 130 then 3 else 4 end;
    v_mk := v_markets[v_ci][1 + floor(public._m97_r(i, 'smk') * 15)::int];
    r := public._m97_r(i, 'sov');
    insert into public.crm_survey_responses (id, client_id, source, market, nps, overall, created_at)
    select public._m97_id('survey', i), v_clients[v_ci], 'import', v_mk,
           least(10, greatest(0, round(5 + r * 5 + case v_ci when 2 then -1 else 0 end)))::int,
           least(5, greatest(1, round(3.85 + r * 1.15 + case v_ci when 2 then -0.3 else 0 end, 2))),
           (current_date - 460 + floor(public._m97_r(i, 'sd') * 450)::int + time '12:00')::timestamptz
     where not exists (select 1 from public.crm_survey_responses where id = public._m97_id('survey', i));
  end loop;
end $$;

drop function public._m97_r(int, text);
drop function public._m97_route(int, int, int);
drop function public._m97_type(int, int);
drop function public._m97_id(text, int, int);
select set_config('sourcing.system_write', 'off', false);
