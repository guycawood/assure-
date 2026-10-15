-- Reporting: the balanced scorecard (docs/REPORTING_SCORECARD.md).
--   1. Dimensions that were missing, as nullable columns (derived defaults in the fact view when empty):
--        jobs.urgent, jobs.governance_model ('central' | 'business_unit'), jobs.business_unit;
--        job_specs.complexity (low | medium | high), spend_exempt, harmonised, impact_grade (+ detail), design_score;
--        estimate_lines.savings_method, baseline_unit.
--      New Watchtower libraries: scorecard_kpis (governed KPI library, maker-checker), scorecard_targets (per client and/or
--      market, effective-dated, maker-checker), reporting_fx_rates (EUR reporting currency, maker-checker) and
--      client_brands (brand taxonomy per client: business unit, power brand). Typed views scorecard_kpis / scorecard_targets.
--   2. rpt_spec_lines: one row per order line (spec line on an approved estimate) with every dimension and measure.
--      Internal staff only. rpt_client_lines(p_client): the client-safe projection (no supplier, no cost, no margin;
--      sell-side spend and savings) for the Client Portal; vendors get nothing.
--   3. Calculation: scorecard_values / scorecard_influence / scorecard_country_kpis / scorecard_callouts (internal),
--      scorecard_report (all parts in one call), client_portal_scorecard (Client Portal), scorecard_target (precedence:
--      client + market, client, market, KPI default).
--   4. CRM review pack carries the scorecard summary and the country KPI table (wraps crm_review_generate_pack again).
--   5. Health: watchtower_health_scorecard (KPIs off target, all clients, last 12 months).
-- Safe on existing data: every new column is nullable or has a default; nothing existing is rewritten.

-- ---------------------------------------------------------------------------
-- 1. Dimensions
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists urgent boolean,
  add column if not exists governance_model text check (governance_model in ('central','business_unit')),
  add column if not exists business_unit text;

alter table public.job_specs
  add column if not exists complexity text check (complexity in ('low','medium','high')),
  add column if not exists spend_exempt boolean not null default false,
  add column if not exists harmonised boolean,
  add column if not exists impact_grade numeric(4,1) check (impact_grade between 0 and 10),
  add column if not exists impact_grade_detail jsonb,
  add column if not exists design_score numeric(4,1) check (design_score between 0 and 10);

alter table public.estimate_lines
  add column if not exists savings_method text check (savings_method in
    ('reference_pricing','value_engineering','market_benchmarking','prior_year_baseline','missed_opportunity','no_saving')),
  add column if not exists baseline_unit numeric(14,4) check (baseline_unit >= 0);

comment on column public.jobs.urgent is 'Urgent job. When empty, the scorecard treats a job as urgent when its planned lead time (target delivery - opened) is under the URGENT_PCT threshold_days.';
comment on column public.jobs.governance_model is 'central = run centrally for the client; business_unit = led by a business unit / market. When empty: central when the job comes from a central campaign.';
comment on column public.job_specs.complexity is 'low / medium / high. When empty: high for 3D, components or electronics; medium for promo and goods/services; otherwise low.';
comment on column public.job_specs.spend_exempt is 'Exempt (non-addressable) spend: excluded from savings % and rate-card usage.';
comment on column public.job_specs.harmonised is 'The spec was consolidated onto a standard (library) spec.';
comment on column public.job_specs.impact_grade is 'Impact Grade 0-10, weighted by the impact_grade_dimensions library (detail per dimension in impact_grade_detail).';
comment on column public.job_specs.design_score is 'Design effectiveness 0-10 where Shopper IQ has no verified execution score for the campaign.';
comment on column public.estimate_lines.savings_method is 'How the saving was achieved. When empty it is derived: live benchmark = market benchmarking, rate card = reference pricing, none = no saving, negative = missed opportunity.';
comment on column public.estimate_lines.baseline_unit is 'Baseline unit price the saving is measured against when it is not the live benchmark (reference price, prior-year average).';

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('scorecard_kpis', 'watchtower', 'Scorecard KPIs', 'The balanced scorecard KPI library: perspective, definition, formula, unit, direction and default target. Every scorecard (internal, CRM, Client Portal) uses these.', true, 20),
  ('scorecard_targets', 'watchtower', 'Scorecard targets', 'Targets per client and/or market that override a KPI''s default target. Client + market beats client, client beats market, market beats the default.', true, 21),
  ('reporting_fx_rates', 'watchtower', 'Reporting exchange rates', 'Rates used to report spend and savings in one currency (EUR) across clients.', true, 22),
  ('client_brands', 'crm', 'Client brands', 'Brand taxonomy per client: business unit and power-brand flag, used to cut reporting.', false, 20)
on conflict (key) do nothing;

-- KPI library (definitions are configuration, not demo data). calc: ratio = 100 x numerator / denominator of the
-- scorecard measures; value = a measure averaged or the median, counted by count_key.
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'scorecard_kpis', x.code, x.name, x.data::jsonb, 'active', date '2025-01-01', 'Scorecard KPI library (initial version)'
  from (values
  ('LOW_VALUE_PCT', 'Low-value jobs', '{"perspective":"plan","sort":1,"unit":"percent","direction":"lower","default_target":40,"measured":true,"calc":"ratio","numerator":"low_value_lines","denominator":"spend_lines","threshold_eur":1000,
     "definition":"Share of order lines worth less than the low-value threshold (EUR 1,000 sell value).","formula":"Order lines under the threshold / order lines with spend","measurement":"Monthly, from approved estimates (Order Management). Bundling small requests lowers this.","source":"Order Management: approved estimate lines"}'),
  ('MEDIAN_SPEND_SPEC', 'Median spend per spec', '{"perspective":"plan","sort":2,"unit":"eur","direction":"higher","default_target":null,"measured":true,"calc":"value","value_key":"median_spend_eur","count_key":"spend_lines",
     "definition":"Median sell value of an order line, in EUR.","formula":"Median of order-line spend (EUR)","measurement":"Monthly. No default target: set one per client when the plan calls for consolidation.","source":"Order Management: approved estimate lines"}'),
  ('URGENT_PCT', 'Urgent jobs', '{"perspective":"plan","sort":3,"unit":"percent","direction":"lower","default_target":10,"measured":true,"calc":"ratio","numerator":"urgent_jobs","denominator":"jobs","threshold_days":21,
     "definition":"Share of jobs flagged urgent, or planned with less than 21 days from opening to delivery.","formula":"Urgent jobs / jobs","measurement":"Monthly, by job (Sourcing).","source":"Sourcing: jobs (urgent flag, opened and target delivery dates)"}'),
  ('MEDIAN_LEAD_DAYS', 'Median lead time', '{"perspective":"plan","sort":4,"unit":"days","direction":"lower","default_target":45,"measured":true,"calc":"value","value_key":"median_lead_days","count_key":"lead_lines",
     "definition":"Median days from brief submitted (or job created) to delivery.","formula":"Median of brief-to-delivery days","measurement":"From the timestamped journey (v_job_speed): delivered jobs only.","source":"Journey: v_job_speed"}'),
  ('DESIGN_SCORE', 'Design effectiveness', '{"perspective":"design","sort":5,"unit":"score10","direction":"higher","default_target":7,"measured":true,"calc":"value","value_key":"design_score","count_key":"design_lines",
     "definition":"Average design effectiveness score (0-10): the spec design score, else the verified Shopper IQ execution score for the campaign and market.","formula":"Average design score","measurement":"Per spec; Shopper IQ results count only once verified.","source":"Shopper IQ effectiveness, spec design score"}'),
  ('ADOPT_PCT', 'Adopt', '{"perspective":"design","sort":6,"unit":"percent","direction":"higher","default_target":50,"measured":true,"calc":"ratio","numerator":"adopt_lines","denominator":"routed_lines",
     "definition":"Share of triaged order lines routed Adopt (an existing spec bought as is).","formula":"Adopt lines / triaged lines","measurement":"Current triage route per spec line (Sourcing).","source":"Sourcing: spec triage"}'),
  ('HARMONISATION_PCT', 'Specification harmonisation', '{"perspective":"design","sort":7,"unit":"percent","direction":"higher","default_target":10,"measured":true,"calc":"ratio","numerator":"harmonised_lines","denominator":"lines",
     "definition":"Share of order lines whose spec was consolidated onto a standard library spec.","formula":"Harmonised lines / lines","measurement":"Flag on the spec (Sourcing).","source":"Sourcing: job specs"}'),
  ('SUSTAINABILITY_SCORE', 'Sustainability performance', '{"perspective":"design","sort":8,"unit":"score10","direction":"higher","default_target":6,"measured":true,"calc":"value","value_key":"impact_grade","count_key":"impact_lines",
     "definition":"Average Impact Grade (0-10) of the specs ordered, weighted by the Impact Grade dimensions in the Watchtower.","formula":"Average Impact Grade","measurement":"Per spec, specs with a grade only.","source":"Sourcing: Impact Grade per spec"}'),
  ('POWER_BRAND_MIX', 'Power-brand spend mix', '{"perspective":"design","sort":9,"unit":"percent","direction":"higher","default_target":60,"measured":true,"calc":"ratio","numerator":"power_brand_eur","denominator":"spend_eur",
     "definition":"Share of spend on the client''s power brands.","formula":"Power-brand spend / spend","measurement":"Brand taxonomy in the client_brands library.","source":"CRM: client brands"}'),
  ('SAVINGS_PCT', 'Savings', '{"perspective":"buy","sort":10,"unit":"percent","direction":"higher","default_target":10,"measured":true,"calc":"ratio","numerator":"addr_savings_eur","denominator":"baseline_eur",
     "definition":"Savings achieved against the baseline (benchmark, reference or prior-year price) on addressable spend.","formula":"Savings / (spend + savings), addressable spend only","measurement":"Monthly reviews and annual reporting per contract year. Exempt spend is excluded.","source":"Sourcing award and estimate savings"}'),
  ('PERFECT_JOB_PCT', 'Quality (perfect job)', '{"perspective":"buy","sort":11,"unit":"percent","direction":"higher","default_target":95,"measured":true,"calc":"ratio","numerator":"perfect_lines","denominator":"quality_lines",
     "definition":"Share of order lines whose QA/QC passed first time with no non-conformance.","formula":"Perfect lines / lines with a closed QA/QC plan","measurement":"QA/QC plans (passed first time, no rejected checkpoint, no NCR on the PO).","source":"Order Management: QA/QC plans and NCRs"}'),
  ('OTIF_PCT', 'Delivery OTIF', '{"perspective":"buy","sort":12,"unit":"percent","direction":"higher","default_target":95,"measured":true,"calc":"ratio","numerator":"otif_lines","denominator":"otif_measured",
     "definition":"Share of order lines delivered on time (POD on or before the promised date, with tolerance) and in full.","formula":"OTIF lines / measured lines","measurement":"Same definition as Logistics (v_otif_deliveries).","source":"Logistics: deliveries and PODs"}'),
  ('RATE_CARD_PCT', 'Rate-card usage', '{"perspective":"buy","sort":13,"unit":"percent","direction":"higher","default_target":55,"measured":true,"calc":"ratio","numerator":"rate_card_eur","denominator":"addressable_eur",
     "definition":"Share of addressable spend priced from an approved rate card. Exempt spend is excluded.","formula":"Rate-card spend / addressable spend","measurement":"Catalogue and harmonisation work raises this.","source":"Sourcing: triage rate card, estimate benchmark source"}'),
  ('SUPPLIER_RATING', 'Supplier rating', '{"perspective":"buy","sort":14,"unit":"score100","direction":"higher","default_target":75,"measured":true,"calc":"value","value_key":"supplier_rating","count_key":"rating_lines",
     "definition":"Average SRM composite score (0-100) of the suppliers used, for the quarter of the order.","formula":"Average supplier composite score","measurement":"SRM performance records by quarter.","source":"SRM: performance records"}'),
  ('MARKET_TEMPERATURE_PCT', 'Market temperature checks', '{"perspective":"manage","sort":15,"unit":"percent","direction":"higher","default_target":90,"measured":true,"calc":"ratio","numerator":"survey_satisfied","denominator":"survey_responses",
     "definition":"Share of client survey responses rating the service 4 or more out of 5 overall.","formula":"Satisfied responses / responses","measurement":"CRM satisfaction surveys. Filters by market and date only.","source":"CRM: survey responses"}'),
  ('BRIEF_QUALITY_PCT', 'Brief quality score', '{"perspective":"manage","sort":16,"unit":"percent","direction":"higher","default_target":90,"measured":true,"calc":"value","value_key":"brief_quality","count_key":"brief_lines",
     "definition":"Average completeness of the briefs behind the work: the share of the ten fields that drive price, quality and compliance that were filled in.","formula":"Average brief completeness","measurement":"Briefing+ brief linked to the job.","source":"Briefing+: briefs"}'),
  ('PO_ON_TIME_PCT', 'PO on time', '{"perspective":"manage","sort":17,"unit":"percent","direction":"higher","default_target":95,"measured":true,"calc":"ratio","numerator":"po_on_time_lines","denominator":"po_lines","threshold_days":2,
     "definition":"Share of supplier POs issued within 2 days of the client approving the estimate.","formula":"POs issued on time / POs issued","measurement":"PO issued timestamp against the estimate approval.","source":"Order Management: purchase orders"}'),
  ('INNOVATION_PCT', 'Innovation engagement', '{"perspective":"manage","sort":18,"unit":"percent","direction":"higher","default_target":95,"measured":false,"calc":"none",
     "definition":"Share of innovation sessions and proposals the client engaged with.","formula":"Not yet defined","measurement":"Not yet measured: System Guy does not record innovation sessions yet.","source":"None yet"}')
  ) x(code, name, data)
 where not exists (select 1 from public.library_records r where r.library_key = 'scorecard_kpis' and r.code = x.code);

insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'reporting_fx_rates', x.code, x.name, jsonb_build_object('eur_per_unit', x.rate), 'active', date '2025-01-01', 'Indicative reporting rate; update in the Watchtower'
  from (values ('EUR','Euro',1.0), ('GBP','Pound sterling',1.17), ('USD','US dollar',0.92), ('SGD','Singapore dollar',0.69),
               ('AUD','Australian dollar',0.61), ('VND','Vietnamese dong',0.000037), ('CNY','Chinese yuan',0.13)) x(code, name, rate)
 where not exists (select 1 from public.library_records r where r.library_key = 'reporting_fx_rates' and r.code = x.code);

-- ---------------------------------------------------------------------------
-- Helpers (pure / config reads)
-- ---------------------------------------------------------------------------
create or replace function public._sc_kpi(p_code text, p_date date default current_date) returns jsonb
language sql stable security definer set search_path = public as $$
  select e.data from public.library_effective('scorecard_kpis', p_code, p_date) e where e.id is not null;
$$;
create or replace function public._sc_param(p_code text, p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(public._sc_kpi(p_code)->>p_key, '')::numeric, p_default);
$$;
create or replace function public._fx_eur(p_currency text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when upper(coalesce(p_currency, '')) = 'EUR' then 1::numeric
    else (select nullif(e.data->>'eur_per_unit', '')::numeric from public.library_effective('reporting_fx_rates', upper(p_currency), current_date) e where e.id is not null) end;
$$;
create or replace function public._sc_spec_group(p_type text) returns text language sql immutable as $$
  select case p_type when '2d' then 'Print' when '3d' then 'Retail display' when 'promo_merch' then 'Promo & merch'
                     when 'design' then 'Design' when 'custom_goods_services' then 'Goods & services' else coalesce(p_type, 'Other') end;
$$;
create or replace function public._sc_value_band(p_eur numeric) returns text language sql immutable as $$
  select case when p_eur is null then null when p_eur < 1000 then 'Under 1k' when p_eur < 5000 then '1k-5k'
              when p_eur < 25000 then '5k-25k' when p_eur < 100000 then '25k-100k' else '100k+' end;
$$;
-- Brief completeness (0-100): ten fields that drive price, quality and compliance.
create or replace function public._brief_completeness(b public.briefs) returns numeric language sql immutable as $$
  select case when b.id is null then null else 10 * (
      (nullif(trim(coalesce(b.objective, '')), '') is not null)::int + (nullif(trim(coalesce(b.brief_text, '')), '') is not null)::int
    + (nullif(trim(coalesce(b.target_outlets, '')), '') is not null)::int + (b.budget_high is not null or b.budget_low is not null)::int
    + (b.target_launch is not null)::int + (nullif(trim(coalesce(b.product_category, '')), '') is not null)::int
    + (nullif(trim(coalesce(b.sustainability_targets, '')), '') is not null or b.min_recycled_pct is not null)::int
    + (nullif(trim(coalesce(b.market, '')), '') is not null)::int + (nullif(trim(coalesce(b.brand, '')), '') is not null)::int
    + (nullif(trim(coalesce(b.division, '')), '') is not null)::int)::numeric end;
$$;

-- ---------------------------------------------------------------------------
-- Governed libraries as typed views (BI-ready). Records in force today.
-- ---------------------------------------------------------------------------
create view public.scorecard_kpis with (security_invoker = true) as
  select r.id, r.code, r.name, r.data->>'perspective' as perspective, (r.data->>'sort')::int as sort, r.data->>'definition' as definition,
         r.data->>'formula' as formula, r.data->>'calc' as calc, r.data->>'numerator' as numerator, r.data->>'denominator' as denominator,
         r.data->>'value_key' as value_key, r.data->>'unit' as unit, r.data->>'direction' as direction,
         nullif(r.data->>'default_target', '')::numeric as default_target, coalesce((r.data->>'measured')::boolean, true) as measured,
         r.data->>'measurement' as measurement, r.data->>'source' as source, r.version, r.effective_from, r.effective_to
    from public.library_records r
   where r.library_key = 'scorecard_kpis' and r.status = 'active' and r.effective_from <= current_date
     and (r.effective_to is null or r.effective_to >= current_date) and public.is_internal();

create view public.scorecard_targets with (security_invoker = true) as
  select r.id, r.code, r.name, r.data->>'kpi_code' as kpi_code, nullif(r.data->>'client_id', '')::uuid as client_id,
         coalesce(c.code, r.data->>'client_code') as client_code, c.name as client_name, public._market_code(nullif(r.data->>'market', '')) as market,
         nullif(r.data->>'target', '')::numeric as target, r.version, r.effective_from, r.effective_to, r.status
    from public.library_records r
    left join public.sourcing_clients c on c.id::text = r.data->>'client_id' or (r.data->>'client_id' is null and c.code = r.data->>'client_code')
   where r.library_key = 'scorecard_targets' and r.status in ('active','pending_approval') and public.is_internal();

-- ---------------------------------------------------------------------------
-- 2. Reporting fact view: one row per order line (spec line on an approved estimate)
-- ---------------------------------------------------------------------------
create view public.rpt_spec_lines with (security_invoker = true) as
  with prm as (
    select public._sc_param('URGENT_PCT', 'threshold_days', 21) as urgent_days, public._sc_param('PO_ON_TIME_PCT', 'threshold_days', 2) as po_days
  ), brands as (
    select distinct on (r.code) r.name, r.data from public.library_records r
     where r.library_key = 'client_brands' and r.status = 'active' order by r.code, r.version desc
  ), fx as (
    select distinct on (r.code) upper(r.code) as code, nullif(r.data->>'eur_per_unit', '')::numeric as rate from public.library_records r
     where r.library_key = 'reporting_fx_rates' and r.status = 'active' and r.effective_from <= current_date order by r.code, r.version desc
  ), el as (
    select l.*, e.job_id, e.supplier_id, e.currency, e.sell_price, e.benchmark_source, e.approved_at, e.estimate_number,
           sum(l.line_cost) over (partition by l.estimate_id) as est_cost
      from public.estimate_lines l join public.estimates e on e.id = l.estimate_id
     where e.status = 'approved'
  )
  select el.id as line_id, el.estimate_id, el.estimate_number, s.id as spec_id, s.spec_no, s.title as spec_title,
         j.id as job_id, j.job_number, j.title as job_title, j.client_id, c.code as client_code, c.name as client_name,
         coalesce(nullif(trim(j.business_unit), ''), nullif(br.data->>'business_unit', ''), nullif(trim((bq.brf).division), ''), nullif(trim(cp.division), ''), 'Unassigned') as business_unit,
         coalesce(nullif(trim(j.brand), ''), nullif(trim((bq.brf).brand), ''), 'Unbranded') as brand,
         coalesce((br.data->>'power_brand')::boolean, false) as power_brand,
         j.region, public._market_code(j.market) as market, coalesce(mk.name, j.market) as market_name,
         coalesce(t.route, 'unrouted') as aac_route, s.spec_type, public._sc_spec_group(s.spec_type) as spec_group,
         coalesce(nullif(trim(s.product_category), ''), public._sc_spec_group(s.spec_type)) as product_type,
         coalesce(s.complexity, case when s.spec_type = '3d' or s.has_components or s.has_lighting_electronics then 'high'
                                     when s.spec_type in ('promo_merch','custom_goods_services') then 'medium' else 'low' end) as complexity,
         coalesce(j.urgent, (j.target_delivery_date - j.opened_date) < prm.urgent_days, false) as urgent,
         coalesce(j.governance_model, case when cp.id is not null then 'central' else 'business_unit' end) as governance_model,
         public._sc_value_band(m.spend_eur) as value_band, m.month,
         el.supplier_id, su.name as supplier_name, el.currency, el.quantity, el.unit_cost,
         el.line_cost as cost, round(el.line_cost * m.fx, 2) as cost_eur, m.spend, m.spend_eur,
         round(m.spend - el.line_cost, 2) as margin, m.savings_cost, m.savings, m.savings_eur,
         coalesce(el.savings_method, case when m.savings_cost < 0 then 'missed_opportunity' when coalesce(m.savings_cost, 0) = 0 then 'no_saving'
                                          when el.baseline_unit is not null then 'reference_pricing'
                                          when el.benchmark_source = 'rate_card' then 'reference_pricing' else 'market_benchmarking' end) as savings_method,
         not s.spend_exempt as addressable, case when not s.spend_exempt then m.spend_eur end as addressable_spend_eur,
         (t.rate_card_id is not null or el.benchmark_source = 'rate_card') as rate_card,
         case when not s.spend_exempt and (t.rate_card_id is not null or el.benchmark_source = 'rate_card') then m.spend_eur end as rate_card_spend_eur,
         vs.brief_to_delivery_days as lead_time_days,
         po.id as po_id, po.po_number,
         case when po.issued_at is null or el.approved_at is null then null else po.issued_at::date <= el.approved_at::date + prm.po_days::int end as po_on_time,
         case when ot.n > 0 then ot.on_time end as otif_on_time, case when ot.n > 0 then ot.in_full end as otif_in_full,
         case when ot.n > 0 then ot.otif end as otif,
         case when po.id is null or coalesce(qa.closed_n, 0) = 0 or qa.open_n > 0 then null
              else qa.all_perfect and not exists (select 1 from public.ncrs n where n.po_reference = po.po_number and n.status <> 'cancelled') end as perfect_job,
         pr.composite_score as supplier_rating, s.impact_grade,
         coalesce(s.design_score, (select round(avg(x.execution_score) / 10, 1) from public.siq_effectiveness x
                                    where cp.id is not null and x.campaign_id = cp.id and public._market_code(x.market) = public._market_code(j.market)
                                      and x.verification_status = 'verified' and x.execution_score is not null)) as design_score,
         coalesce(s.harmonised, false) as harmonised, public._brief_completeness(bq.brf) as brief_quality
    from el cross join prm
    join public.job_specs s on s.id = el.spec_id
    join public.jobs j on j.id = el.job_id
    join public.sourcing_clients c on c.id = j.client_id
    left join public.suppliers su on su.id = el.supplier_id
    left join public.markets mk on mk.code = public._market_code(j.market)
    left join public.spec_triage t on t.spec_id = s.id and t.is_current
    left join lateral (select b2 as brf from public.briefs b2 where b2.id = j.brief_id or b2.resulting_job_id = j.id
                        order by (b2.id = j.brief_id) desc, b2.created_at limit 1) bq on true
    left join public.campaigns cp on cp.id = (bq.brf).campaign_id
    left join lateral (select bb.data from brands bb where lower(bb.name) = lower(coalesce(nullif(trim(j.brand), ''), (bq.brf).brand))
                          and (bb.data->>'client_id' = j.client_id::text or bb.data->>'client_code' = c.code) limit 1) br on true
    cross join lateral (
      select x.*, round(x.spend * x.fx, 2) as spend_eur, round(x.savings * x.fx, 2) as savings_eur from (
        select date_trunc('month', coalesce(el.approved_at, j.opened_date::timestamptz))::date as month,
               case when upper(el.currency) = 'EUR' then 1::numeric else (select fx.rate from fx where fx.code = upper(el.currency)) end as fx,
               round(el.sell_price * el.line_cost / nullif(el.est_cost, 0), 2) as spend,
               round((coalesce(el.baseline_unit, el.benchmark_unit, el.unit_cost) - el.unit_cost) * el.quantity, 2) as savings_cost,
               round((coalesce(el.baseline_unit, el.benchmark_unit, el.unit_cost) - el.unit_cost) * el.quantity
                     * (el.sell_price / nullif(el.est_cost, 0)), 2) as savings) x) m
    left join lateral (select p.* from public.purchase_orders p where p.estimate_id = el.estimate_id and p.status not in ('rejected','cancelled','declined')
                        order by p.created_at desc limit 1) po on true
    left join lateral (select count(*) as n, bool_and(o.on_time) as on_time, bool_and(o.in_full) as in_full, bool_and(o.otif) as otif
                         from public.v_otif_deliveries o where o.po_id = po.id and o.spec_id = s.id and o.measured) ot on true
    left join lateral (
      select count(*) filter (where q.status in ('passed','failed','waived')) as closed_n,
             count(*) filter (where q.status in ('not_started','in_progress')) as open_n,
             bool_and(q.status = 'passed' and not exists (select 1 from public.qaqc_checkpoints k where k.plan_id = q.id and k.status <> 'withdrawn'
                        and (k.first_time_pass = false or k.failed or k.ncr_id is not null or k.status = 'rejected'))) as all_perfect
        from public.qaqc_plans q where q.po_id = po.id and (q.estimate_line_id = el.id or q.estimate_line_id is null)) qa on true
    left join lateral (select p2.composite_score from public.performance_records p2 where p2.supplier_id = el.supplier_id and p2.composite_score is not null
                        order by (p2.period > to_char(m.month, 'YYYY-"Q"Q')), case when p2.period <= to_char(m.month, 'YYYY-"Q"Q') then p2.period end desc nulls last, p2.period
                        limit 1) pr on true
    left join public.v_job_speed vs on vs.job_id = j.id
   -- Internal staff only. Inside the security definer scorecard functions (run as the owner) every row is visible; they
   -- scope rows to the caller's clients themselves.
   where public.is_internal() or current_user not in ('authenticated', 'anon');

-- Client-safe line: no supplier, no cost or margin, sell-side spend and savings only.
create type public.rpt_client_line as (
  line_id uuid, spec_id uuid, job_id uuid, job_number text, spec_title text, client_id uuid, client_name text, business_unit text, brand text,
  power_brand boolean, region text, market text, market_name text, aac_route text, spec_type text, spec_group text, product_type text,
  complexity text, urgent boolean, governance_model text, value_band text, month date, currency text, spend numeric, spend_eur numeric,
  savings numeric, savings_eur numeric, savings_method text, addressable boolean, rate_card boolean, lead_time_days numeric,
  po_on_time boolean, otif_on_time boolean, otif_in_full boolean, otif boolean, perfect_job boolean, supplier_rating numeric,
  impact_grade numeric, design_score numeric, harmonised boolean, brief_quality numeric);

create or replace function public._sc_arr(p jsonb, k text) returns text[] language sql immutable as $$
  select case when p is null or p->k is null or jsonb_typeof(p->k) = 'null' then null
              when jsonb_typeof(p->k) = 'array' then (select nullif(array_agg(x), '{}') from jsonb_array_elements_text(p->k) x where trim(x) <> '')
              when trim(p->>k) = '' or lower(p->>k) = 'all' then null else array[p->>k] end;
$$;

-- Lines for a set of clients with the scorecard filters: routes, business_unit, market, brand, from, to (all optional;
-- routes / business_unit / market / brand take a value or an array).
create or replace function public._sc_lines(p_clients uuid[], p_filters jsonb default '{}'::jsonb) returns setof public.rpt_client_line
language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_routes text[] := public._sc_arr(f, 'routes'); v_bu text[] := public._sc_arr(f, 'business_unit');
  v_mk text[]; v_brand text[] := public._sc_arr(f, 'brand'); v_from date := nullif(f->>'from', '')::date; v_to date := nullif(f->>'to', '')::date;
begin
  select array_agg(public._market_code(x)) into v_mk from unnest(public._sc_arr(f, 'market')) x;
  return query
    select l.line_id, l.spec_id, l.job_id, l.job_number, l.spec_title, l.client_id, l.client_name, l.business_unit, l.brand, l.power_brand,
           l.region, l.market, l.market_name, l.aac_route, l.spec_type, l.spec_group, l.product_type, l.complexity, l.urgent, l.governance_model,
           l.value_band, l.month, l.currency, l.spend, l.spend_eur, l.savings, l.savings_eur, l.savings_method, l.addressable, l.rate_card,
           l.lead_time_days, l.po_on_time, l.otif_on_time, l.otif_in_full, l.otif, l.perfect_job, l.supplier_rating, l.impact_grade, l.design_score,
           l.harmonised, l.brief_quality
      from public.rpt_spec_lines l
     where l.client_id = any (p_clients)
       and (v_routes is null or l.aac_route = any (v_routes)) and (v_bu is null or l.business_unit = any (v_bu))
       and (v_mk is null or l.market = any (v_mk)) and (v_brand is null or l.brand = any (v_brand))
       and (v_from is null or l.month >= date_trunc('month', v_from::timestamptz)::date) and (v_to is null or l.month <= v_to);
end $$;

-- Client Portal / BI: the client-safe lines of the caller's own accounts (internal staff: the previewed client).
create or replace function public.rpt_client_lines(p_client uuid default null) returns setof public.rpt_client_line
language sql stable security definer set search_path = public as $$
  select * from public._sc_lines(public._client_scope(p_client), '{}'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- 3. Calculation
-- ---------------------------------------------------------------------------
-- Every measure the KPIs use, for each grouping the pages show (one scan of the lines).
create or replace function public._sc_bundles(p_clients uuid[], p_filters jsonb)
returns table (gset text, route text, month date, market text, market_name text, spec_group text, bu text, urgent text, governance text, complexity text, b jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_low numeric := public._sc_param('LOW_VALUE_PCT', 'threshold_eur', 1000);
begin
  return query
  with l as materialized (select * from public._sc_lines(p_clients, p_filters))
  select concat_ws('+', case when grouping(l.aac_route) = 0 then 'route' end, case when grouping(l.month) = 0 then 'month' end,
                   case when grouping(l.market) = 0 then 'market' end, case when grouping(l.spec_group) = 0 then 'spec_group' end,
                   case when grouping(l.business_unit) = 0 then 'bu' end, case when grouping(l.urgent) = 0 then 'urgent' end,
                   case when grouping(l.governance_model) = 0 then 'governance' end, case when grouping(l.complexity) = 0 then 'complexity' end),
         l.aac_route, l.month, l.market, min(l.market_name), l.spec_group, l.business_unit,
         case when l.urgent then 'urgent' when not l.urgent then 'planned' end, l.governance_model, l.complexity,
         jsonb_build_object(
           'lines', count(*), 'jobs', count(distinct l.job_id),
           'spend_eur', coalesce(round(sum(l.spend_eur), 2), 0), 'savings_eur', coalesce(round(sum(l.savings_eur), 2), 0),
           'addr_savings_eur', coalesce(round(sum(l.savings_eur) filter (where l.addressable), 2), 0),
           'baseline_eur', coalesce(round(sum(l.spend_eur + coalesce(l.savings_eur, 0)) filter (where l.addressable), 2), 0),
           'addressable_eur', coalesce(round(sum(l.spend_eur) filter (where l.addressable), 2), 0),
           'rate_card_eur', coalesce(round(sum(l.spend_eur) filter (where l.addressable and l.rate_card), 2), 0),
           'power_brand_eur', coalesce(round(sum(l.spend_eur) filter (where l.power_brand), 2), 0),
           'spend_lines', count(l.spend_eur), 'low_value_lines', count(*) filter (where l.spend_eur < v_low),
           'urgent_jobs', count(distinct l.job_id) filter (where l.urgent),
           'routed_lines', count(*) filter (where l.aac_route <> 'unrouted'), 'adopt_lines', count(*) filter (where l.aac_route = 'adopt'),
           'harmonised_lines', count(*) filter (where l.harmonised),
           'median_spend_eur', round((percentile_cont(0.5) within group (order by l.spend_eur))::numeric, 2),
           'median_lead_days', round((percentile_cont(0.5) within group (order by l.lead_time_days))::numeric, 1), 'lead_lines', count(l.lead_time_days),
           'design_score', round(avg(l.design_score), 1), 'design_lines', count(l.design_score),
           'impact_grade', round(avg(l.impact_grade), 1), 'impact_lines', count(l.impact_grade),
           'perfect_lines', count(*) filter (where l.perfect_job), 'quality_lines', count(l.perfect_job),
           'otif_lines', count(*) filter (where l.otif), 'otif_measured', count(l.otif),
           'po_on_time_lines', count(*) filter (where l.po_on_time), 'po_lines', count(l.po_on_time),
           'supplier_rating', round(avg(l.supplier_rating), 1), 'rating_lines', count(l.supplier_rating),
           'brief_quality', round(avg(l.brief_quality), 1), 'brief_lines', count(l.brief_quality))
    from l
   group by grouping sets ((), (l.aac_route), (l.month), (l.aac_route, l.month), (l.market), (l.spec_group, l.aac_route), (l.business_unit, l.aac_route),
                           (l.urgent), (l.urgent, l.aac_route), (l.governance_model), (l.governance_model, l.aac_route),
                           (l.complexity), (l.complexity, l.aac_route));
end $$;

-- Client survey responses (market temperature) for the same clients, market and date filters.
create or replace function public._sc_survey(p_clients uuid[], p_filters jsonb)
returns table (gset text, market text, month date, b jsonb)
language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_mk text[]; v_from date := nullif(f->>'from', '')::date; v_to date := nullif(f->>'to', '')::date;
begin
  select array_agg(public._market_code(x)) into v_mk from unnest(public._sc_arr(f, 'market')) x;
  return query
  select case when grouping(r.market) = 0 then 'market' when grouping(r.m) = 0 then 'month' else '' end, r.market, r.m,
         jsonb_build_object('survey_responses', count(*), 'survey_satisfied', count(*) filter (where r.overall >= 4))
    from (select s.market, s.overall, date_trunc('month', s.created_at)::date as m from public.crm_survey_responses s
           where s.client_id = any (p_clients) and s.overall is not null
             and (v_mk is null or s.market = any (v_mk))
             and (v_from is null or s.created_at >= date_trunc('month', v_from::timestamptz)) and (v_to is null or s.created_at::date <= v_to)) r
   group by grouping sets ((), (r.market), (r.m));
end $$;

create or replace function public._sc_kpi_value(k jsonb, b jsonb) returns numeric language sql immutable as $$
  select case
    when b is null or k is null or not coalesce((k->>'measured')::boolean, true) then null
    when k->>'calc' = 'ratio' then case when coalesce(nullif(b->>(k->>'denominator'), '')::numeric, 0) = 0 then null
         else round(100 * coalesce(nullif(b->>(k->>'numerator'), '')::numeric, 0) / (b->>(k->>'denominator'))::numeric, 1) end
    when k->>'calc' = 'value' then case when coalesce(nullif(b->>(k->>'count_key'), '')::numeric, 0) = 0 then null
         else nullif(b->>(k->>'value_key'), '')::numeric end
    end;
$$;

create or replace function public._sc_status(p_direction text, p_current numeric, p_target numeric, p_measured boolean default true) returns text
language sql immutable as $$
  select case when not coalesce(p_measured, true) then 'not_measured' when p_current is null then 'no_data' when p_target is null then 'no_target'
              when (p_direction = 'lower' and p_current <= p_target) or (coalesce(p_direction, 'higher') <> 'lower' and p_current >= p_target) then 'on_target'
              else 'off_target' end;
$$;

-- Target for a KPI: client + market, then client, then market, then the KPI default. Effective-dated.
create or replace function public._sc_target(p_kpi text, p_client uuid, p_market text, p_date date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text; v_mk text := public._market_code(p_market); r record; v_def jsonb := public._sc_kpi(p_kpi, p_date);
begin
  if p_client is not null then select code into v_code from public.sourcing_clients where id = p_client; end if;
  select x.target, x.src into r from (
    select nullif(t.data->>'target', '')::numeric as target,
           case when cl and mk then 1 when cl then 2 else 3 end as rank,
           case when cl and mk then 'client_market' when cl then 'client' else 'market' end as src
      from public._lib_current('scorecard_targets', p_date) t
      cross join lateral (select (p_client is not null and (t.data->>'client_id' = p_client::text or (nullif(t.data->>'client_id', '') is null and t.data->>'client_code' = v_code))) as cl,
                                 (v_mk is not null and public._market_code(nullif(t.data->>'market', '')) = v_mk) as mk,
                                 (nullif(t.data->>'client_id', '') is null and nullif(t.data->>'client_code', '') is null) as no_cl,
                                 (nullif(t.data->>'market', '') is null) as no_mk) z
     where t.data->>'kpi_code' = p_kpi
       and ((cl and mk) or (cl and no_mk) or (no_cl and mk))) x
   order by x.rank limit 1;
  if r.src is not null then return jsonb_build_object('target', r.target, 'source', r.src); end if;
  return jsonb_build_object('target', nullif(v_def->>'default_target', '')::numeric, 'source', case when nullif(v_def->>'default_target', '') is not null then 'default' end);
end $$;

create or replace function public._sc_route_label(p text) returns text language sql immutable as $$
  select case p when 'adopt' then 'Adopt' when 'adapt' then 'Adapt' when 'create' then 'Create' when 'push' then 'Push' when 'unrouted' then 'Not triaged' else initcap(coalesce(p, '')) end;
$$;

create or replace function public._sc_fmt(p_unit text, v numeric) returns text language sql immutable as $$
  select case when v is null then 'n/a' when p_unit = 'percent' then round(v, 1)::text || '%' when p_unit = 'days' then round(v, 1)::text || ' days'
              when p_unit = 'eur' then 'EUR ' || to_char(round(v), 'FM999G999G990') when p_unit = 'score10' then round(v, 1)::text || ' of 10'
              when p_unit = 'score100' then round(v, 1)::text || ' of 100' else round(v, 1)::text end;
$$;

-- The whole scorecard for a set of clients: KPI values with targets and status, breakdowns, influence factors, the
-- country table and narrative callouts. p_client_target: the client whose targets apply (one client in scope).
create or replace function public._sc_report(p_clients uuid[], p_filters jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_client uuid := case when cardinality(p_clients) = 1 then p_clients[1] end;
  v_mk text[]; v_market text; k record; v_kpis jsonb := '[]'::jsonb; v_break jsonb := '{}'::jsonb; v_tot jsonb; v_cur numeric; v_t jsonb;
  v_totals jsonb; v_infl jsonb; v_country jsonb; v_defs jsonb; v_callouts jsonb := '[]'::jsonb; x record; y record; v_text text;
  v_strategic text[] := array['SAVINGS_PCT','RATE_CARD_PCT','OTIF_PCT','PERFECT_JOB_PCT'];
begin
  select array_agg(public._market_code(z)) into v_mk from unnest(public._sc_arr(f, 'market')) z;
  v_market := case when cardinality(v_mk) = 1 then v_mk[1] end;
  create temp table if not exists _sc_b (gset text, route text, month date, market text, market_name text, spec_group text, bu text, urgent text, governance text, complexity text, b jsonb) on commit drop;
  create temp table if not exists _sc_s (gset text, market text, month date, b jsonb) on commit drop;
  create temp table if not exists _sc_k (code text, name text, data jsonb, sort int) on commit drop;
  truncate _sc_b; truncate _sc_s; truncate _sc_k;
  insert into _sc_b select * from public._sc_bundles(p_clients, f);
  insert into _sc_s select * from public._sc_survey(p_clients, f);
  -- Survey measures sit beside the line measures for the total, market and month groupings.
  update _sc_b set b = _sc_b.b || s.b from _sc_s s where s.gset = _sc_b.gset and s.market is not distinct from _sc_b.market and s.month is not distinct from _sc_b.month;
  insert into _sc_b (gset, market, market_name, b) select 'market', s.market, public._market_name(s.market), s.b from _sc_s s
   where s.gset = 'market' and not exists (select 1 from _sc_b xb where xb.gset = 'market' and xb.market = s.market);
  insert into _sc_b (gset, month, b) select 'month', s.month, s.b from _sc_s s
   where s.gset = 'month' and not exists (select 1 from _sc_b xb where xb.gset = 'month' and xb.month = s.month);
  if not exists (select 1 from _sc_b where gset = '') then insert into _sc_b (gset, b) select '', coalesce((select s.b from _sc_s s where s.gset = ''), '{}'::jsonb); end if;
  insert into _sc_k select r.code, r.name, r.data, coalesce((r.data->>'sort')::int, 99) from public._lib_current('scorecard_kpis') r;
  select b into v_tot from _sc_b where gset = '';

  v_totals := jsonb_build_object('lines', coalesce((v_tot->>'lines')::int, 0), 'spend_eur', coalesce((v_tot->>'spend_eur')::numeric, 0),
    'savings_eur', coalesce((v_tot->>'savings_eur')::numeric, 0), 'currency', 'EUR',
    'by_route', (select coalesce(jsonb_agg(jsonb_build_object('route', route, 'label', public._sc_route_label(route), 'spend_eur', (b->>'spend_eur')::numeric,
                   'savings_eur', (b->>'savings_eur')::numeric, 'lines', (b->>'lines')::int) order by array_position(array['adopt','adapt','create','push','unrouted'], route)), '[]'::jsonb)
                 from _sc_b where gset = 'route'));

  for k in select * from _sc_k order by sort loop
    v_cur := public._sc_kpi_value(k.data, v_tot);
    v_t := public._sc_target(k.code, v_client, v_market);
    v_kpis := v_kpis || jsonb_build_object('code', k.code, 'name', k.name, 'perspective', k.data->>'perspective', 'unit', k.data->>'unit',
      'direction', k.data->>'direction', 'definition', k.data->>'definition', 'formula', k.data->>'formula', 'measurement', k.data->>'measurement',
      'source', k.data->>'source', 'measured', coalesce((k.data->>'measured')::boolean, true), 'current', v_cur, 'target', v_t->'target',
      'target_source', v_t->'source', 'status', public._sc_status(k.data->>'direction', v_cur, (v_t->>'target')::numeric, coalesce((k.data->>'measured')::boolean, true)),
      'n', case when k.data->>'calc' = 'ratio' then (v_tot->>(k.data->>'denominator'))::numeric when k.data->>'calc' = 'value' then (v_tot->>(k.data->>'count_key'))::numeric end);
    if coalesce((k.data->>'measured')::boolean, true) then
      v_break := v_break || jsonb_build_object(k.code, jsonb_build_object(
        'by_route', (select coalesce(jsonb_agg(jsonb_build_object('route', route, 'value', public._sc_kpi_value(k.data, b))
                       order by array_position(array['adopt','adapt','create','push','unrouted'], route)), '[]'::jsonb) from _sc_b where gset = 'route'),
        'by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'value', public._sc_kpi_value(k.data, b)) order by month), '[]'::jsonb)
                       from _sc_b where gset = 'month'),
        'by_route_month', (select coalesce(jsonb_agg(jsonb_build_object('route', route, 'month', to_char(month, 'YYYY-MM'), 'value', public._sc_kpi_value(k.data, b)) order by route, month), '[]'::jsonb)
                       from _sc_b where gset = 'route+month'),
        'by_market', (select coalesce(jsonb_agg(jsonb_build_object('market', market, 'name', coalesce(market_name, market), 'value', v,
                         'target', (public._sc_target(k.code, v_client, market)->>'target')::numeric) order by v desc nulls last), '[]'::jsonb)
                       from (select market, market_name, public._sc_kpi_value(k.data, b) v from _sc_b where gset = 'market') q where q.v is not null),
        'by_spec_type', (select coalesce(jsonb_agg(jsonb_build_object('spec_type', spec_group, 'route', route, 'value', public._sc_kpi_value(k.data, b)) order by spec_group, route), '[]'::jsonb)
                       from _sc_b where gset = 'route+spec_group'),
        'by_business_unit', (select coalesce(jsonb_agg(jsonb_build_object('business_unit', bu, 'route', route, 'value', public._sc_kpi_value(k.data, b)) order by bu, route), '[]'::jsonb)
                       from _sc_b where gset = 'route+bu')));
    end if;
  end loop;

  -- Influence factors: savings, lead time, spend per spec, perfect job and supplier rating, split three ways and by route.
  v_infl := jsonb_build_object('factors', (
    select jsonb_agg(jsonb_build_object('key', fx.key, 'label', fx.label, 'groups', (
      select coalesce(jsonb_agg(jsonb_build_object('key', g.k, 'label', g.lbl, 'metrics', public._sc_influence_metrics(g.b),
        'by_route', (select coalesce(jsonb_agg(jsonb_build_object('route', r2.route, 'metrics', public._sc_influence_metrics(r2.b))
                       order by array_position(array['adopt','adapt','create','push','unrouted'], r2.route)), '[]'::jsonb)
                     from _sc_b r2 where r2.gset = 'route+' || fx.key and case fx.key when 'urgent' then r2.urgent when 'governance' then r2.governance else r2.complexity end = g.k))
        order by g.ord), '[]'::jsonb)
      from (select case fx.key when 'urgent' then x2.urgent when 'governance' then x2.governance else x2.complexity end as k, x2.b,
                   case fx.key when 'urgent' then case x2.urgent when 'urgent' then 'Urgent' else 'Planned (not urgent)' end
                               when 'governance' then case x2.governance when 'central' then 'Central' else 'Business-unit-led' end
                               else initcap(x2.complexity) end as lbl,
                   case coalesce(x2.urgent, x2.governance, x2.complexity) when 'planned' then 1 when 'urgent' then 2 when 'central' then 1 when 'business_unit' then 2
                        when 'low' then 1 when 'medium' then 2 when 'high' then 3 else 9 end as ord
              from _sc_b x2 where x2.gset = fx.key) g)) order by fx.ord)
    from (values ('urgent', 'Urgent vs planned', 1), ('governance', 'Governance model', 2), ('complexity', 'Spec complexity', 3)) fx(key, label, ord)),
    'total', public._sc_influence_metrics(v_tot));

  -- Strategic KPIs by country (market).
  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.name), '[]'::jsonb) into v_country from (
    select q.market, coalesce(q.market_name, q.market) as name, q.lines,
           q.savings, q.savings_target, q.rate_card, q.rate_card_target, q.otif, q.otif_target, q.quality, q.quality_target,
           case when q.measured = 0 then null else round(100.0 * q.on_target / q.measured, 1) end as kpi_delivery
      from (select z.*,
                   (z.savings is not null and z.savings_target is not null)::int + (z.rate_card is not null and z.rate_card_target is not null)::int
                 + (z.otif is not null and z.otif_target is not null)::int + (z.quality is not null and z.quality_target is not null)::int as measured,
                   coalesce((z.savings >= z.savings_target)::int, 0) + coalesce((z.rate_card >= z.rate_card_target)::int, 0)
                 + coalesce((z.otif >= z.otif_target)::int, 0) + coalesce((z.quality >= z.quality_target)::int, 0) as on_target
              from (select s.market, s.market_name, (s.b->>'lines')::int as lines,
                           public._sc_kpi_value((select data from _sc_k where code = 'SAVINGS_PCT'), s.b) as savings,
                           (public._sc_target('SAVINGS_PCT', v_client, s.market)->>'target')::numeric as savings_target,
                           public._sc_kpi_value((select data from _sc_k where code = 'RATE_CARD_PCT'), s.b) as rate_card,
                           (public._sc_target('RATE_CARD_PCT', v_client, s.market)->>'target')::numeric as rate_card_target,
                           public._sc_kpi_value((select data from _sc_k where code = 'OTIF_PCT'), s.b) as otif,
                           (public._sc_target('OTIF_PCT', v_client, s.market)->>'target')::numeric as otif_target,
                           public._sc_kpi_value((select data from _sc_k where code = 'PERFECT_JOB_PCT'), s.b) as quality,
                           (public._sc_target('PERFECT_JOB_PCT', v_client, s.market)->>'target')::numeric as quality_target
                      from _sc_b s where s.gset = 'market' and coalesce((s.b->>'lines')::int, 0) > 0) z) q) c;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'definition', data->>'definition', 'measurement', data->>'measurement',
           'formula', data->>'formula', 'default_target', data->'default_target') order by array_position(v_strategic, code)), '[]'::jsonb)
    into v_defs from _sc_k where code = any (v_strategic);

  -- Callouts: deterministic rules, in order; 2 to 4 kept.
  -- (1) Biggest gap to target among off-target KPIs (relative to the target).
  select * into x from (
    select e->>'name' as name, e->>'unit' as unit, e->>'direction' as dir, (e->>'current')::numeric as cur, (e->>'target')::numeric as tgt
      from jsonb_array_elements(v_kpis) e where e->>'status' = 'off_target' and (e->>'target')::numeric <> 0) z
   order by abs(z.cur - z.tgt) / abs(z.tgt) desc limit 1;
  if x.name is not null then
    v_callouts := v_callouts || jsonb_build_object('rule', 'biggest_gap', 'tone', 'bad', 'text',
      format('%s is the furthest from target: %s against a target of %s.', x.name, public._sc_fmt(x.unit, x.cur), public._sc_fmt(x.unit, x.tgt)));
  end if;
  -- (2) Route with the longest median lead time.
  select route, (b->>'median_lead_days')::numeric as d into x from _sc_b where gset = 'route' and coalesce((b->>'lead_lines')::int, 0) >= 3 order by (b->>'median_lead_days')::numeric desc limit 1;
  select route, (b->>'median_lead_days')::numeric as d into y from _sc_b where gset = 'route' and coalesce((b->>'lead_lines')::int, 0) >= 3 order by (b->>'median_lead_days')::numeric asc limit 1;
  if x.route is not null and y.route is not null and x.route <> y.route then
    v_callouts := v_callouts || jsonb_build_object('rule', 'route_lead_time', 'tone', 'info', 'text',
      format('%s lines take longest: a median of %s days from brief to delivery, against %s days for %s.', public._sc_route_label(x.route), round(x.d), round(y.d), public._sc_route_label(y.route)));
  end if;
  -- (3) Effect of urgency on savings.
  select public._sc_kpi_value((select data from _sc_k where code = 'SAVINGS_PCT'), b) as v into x from _sc_b where gset = 'urgent' and urgent = 'urgent';
  select public._sc_kpi_value((select data from _sc_k where code = 'SAVINGS_PCT'), b) as v into y from _sc_b where gset = 'urgent' and urgent = 'planned';
  if x.v is not null and y.v is not null and abs(x.v - y.v) >= 1 then
    v_callouts := v_callouts || jsonb_build_object('rule', 'urgency_savings', 'tone', case when x.v < y.v then 'warn' else 'info' end, 'text',
      case when x.v < y.v then format('Urgent jobs save %s%% against %s%% for planned work: planning ahead protects savings.', round(x.v, 1), round(y.v, 1))
           else format('Urgent jobs saved %s%% against %s%% for planned work.', round(x.v, 1), round(y.v, 1)) end);
  end if;
  -- (4) Spec type and route with the longest lead time (points to complexity).
  select spec_group, route, (b->>'median_lead_days')::numeric as d into x from _sc_b
   where gset = 'route+spec_group' and coalesce((b->>'lead_lines')::int, 0) >= 3 order by (b->>'median_lead_days')::numeric desc limit 1;
  if x.spec_group is not null and jsonb_array_length(v_callouts) < 4 then
    v_callouts := v_callouts || jsonb_build_object('rule', 'spec_type_lead_time', 'tone', 'info', 'text',
      format('%s %s lines have the longest lead time (median %s days), which points to complexity.', x.spec_group, public._sc_route_label(x.route), round(x.d)));
  end if;
  if jsonb_array_length(v_callouts) < 2 then
    v_text := case when coalesce((v_tot->>'lines')::int, 0) = 0 then 'No orders match these filters yet.'
                   when not exists (select 1 from jsonb_array_elements(v_kpis) e where e->>'status' = 'off_target') then 'Every measured KPI is on target for this selection.'
                   else 'There is not enough delivered work in this selection to compare routes or urgency.' end;
    v_callouts := v_callouts || jsonb_build_object('rule', 'summary', 'tone', 'info', 'text', v_text);
  end if;

  return jsonb_build_object('filters', f, 'clients', cardinality(p_clients), 'client_id', v_client, 'market', v_market,
    'totals', v_totals, 'kpis', v_kpis, 'breakdowns', v_break, 'influence', v_infl,
    'country', jsonb_build_object('rows', v_country, 'definitions', v_defs), 'callouts', v_callouts);
end $$;

create or replace function public._sc_influence_metrics(b jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('lines', coalesce((b->>'lines')::int, 0), 'spend_eur', coalesce((b->>'spend_eur')::numeric, 0),
    'savings_pct', case when coalesce((b->>'baseline_eur')::numeric, 0) = 0 then null else round(100 * (b->>'addr_savings_eur')::numeric / (b->>'baseline_eur')::numeric, 1) end,
    'median_lead_days', case when coalesce((b->>'lead_lines')::int, 0) = 0 then null else (b->>'median_lead_days')::numeric end,
    'median_spend_eur', case when coalesce((b->>'spend_lines')::int, 0) = 0 then null else (b->>'median_spend_eur')::numeric end,
    'perfect_pct', case when coalesce((b->>'quality_lines')::int, 0) = 0 then null else round(100.0 * (b->>'perfect_lines')::numeric / (b->>'quality_lines')::numeric, 1) end,
    'supplier_rating', case when coalesce((b->>'rating_lines')::int, 0) = 0 then null else (b->>'supplier_rating')::numeric end);
$$;

-- Internal entry points ---------------------------------------------------------------------------------------------
create or replace function public._sc_internal_scope(p_client uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'The scorecard across clients is for adm Indicia staff only' using errcode = '42501'; end if;
  if p_client is not null then
    if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
    return array[p_client];
  end if;
  select coalesce(array_agg(id), '{}') into v from public.sourcing_clients;
  return v;
end $$;

create or replace function public.scorecard_report(p_client uuid default null, p_filters jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select public._sc_report(public._sc_internal_scope(p_client), p_filters);
$$;
create or replace function public.scorecard_values(p_client uuid default null, p_filters jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('totals', r->'totals', 'kpis', r->'kpis', 'breakdowns', r->'breakdowns', 'filters', r->'filters')
    from public._sc_report(public._sc_internal_scope(p_client), p_filters) r;
$$;
create or replace function public.scorecard_influence(p_client uuid default null, p_filters jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select r->'influence' from public._sc_report(public._sc_internal_scope(p_client), p_filters) r;
$$;
create or replace function public.scorecard_country_kpis(p_client uuid default null, p_filters jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select r->'country' from public._sc_report(public._sc_internal_scope(p_client), p_filters) r;
$$;
create or replace function public.scorecard_callouts(p_client uuid default null, p_filters jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select r->'callouts' from public._sc_report(public._sc_internal_scope(p_client), p_filters) r;
$$;
create or replace function public.scorecard_target(p_kpi text, p_client uuid default null, p_market text default null, p_date date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'Only adm Indicia staff can read scorecard targets' using errcode = '42501'; end if;
  return public._sc_target(p_kpi, p_client, p_market, p_date);
end $$;
-- Filter options (business units, brands, markets present in the data) for the filter bar.
create or replace function public._sc_options(p_clients uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  with l as materialized (select business_unit, brand, market, market_name, month from public._sc_lines(p_clients, '{}'))
  select jsonb_build_object(
    'business_units', (select coalesce(jsonb_agg(distinct l.business_unit), '[]'::jsonb) from l),
    'brands', (select coalesce(jsonb_agg(distinct l.brand), '[]'::jsonb) from l),
    'markets', (select coalesce(jsonb_agg(jsonb_build_object('code', x.market, 'name', x.market_name) order by x.market_name), '[]'::jsonb)
                  from (select distinct l.market, l.market_name from l where l.market is not null) x),
    'months', (select jsonb_build_object('first', to_char(min(l.month), 'YYYY-MM'), 'last', to_char(max(l.month), 'YYYY-MM')) from l));
$$;
create or replace function public.scorecard_options(p_client uuid default null) returns jsonb
language sql security definer set search_path = public as $$
  select public._sc_options(public._sc_internal_scope(p_client));
$$;

-- Client Portal: the client's own accounts only (approvers and viewers; internal staff preview one client).
create or replace function public.client_portal_scorecard(p_client uuid default null, p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client);
begin
  if cardinality(v) = 0 then raise exception 'No client accounts to report on' using errcode = '42501'; end if;
  return public._sc_report(v, p_filters) || jsonb_build_object('options', public._sc_options(v));
end $$;

-- ---------------------------------------------------------------------------
-- 4. CRM review pack: scorecard summary and the country KPI table (last 12 months)
-- ---------------------------------------------------------------------------
alter function public.crm_review_generate_pack(uuid) rename to _otif_crm_review_generate_pack;
create function public.crm_review_generate_pack(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pack jsonb; r public.crm_reviews; s jsonb;
begin
  v_pack := public._otif_crm_review_generate_pack(p_id);
  select * into r from public.crm_reviews where id = p_id;
  s := public._sc_report(array[r.client_id], jsonb_build_object('from', to_char(current_date - 365, 'YYYY-MM-DD')));
  v_pack := v_pack || jsonb_build_object('scorecard', jsonb_build_object(
    'since', current_date - 365,
    'totals', s->'totals',
    'summary', (select coalesce(jsonb_agg(jsonb_build_object('code', e->>'code', 'name', e->>'name', 'perspective', e->>'perspective', 'unit', e->>'unit',
                  'direction', e->>'direction', 'current', e->'current', 'target', e->'target', 'status', e->>'status')), '[]'::jsonb)
                from jsonb_array_elements(s->'kpis') e),
    'country', s->'country', 'callouts', s->'callouts'));
  update public.crm_reviews set pack = v_pack where id = p_id;
  return v_pack;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Health: scorecard KPIs off target across all clients, last 12 months
-- ---------------------------------------------------------------------------
create or replace function public.scorecard_health() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_all uuid[];
begin
  if not public.is_internal() then return null; end if;
  select coalesce(array_agg(id), '{}') into v_all from public.sourcing_clients;
  v := public._sc_report(v_all, jsonb_build_object('from', to_char(current_date - 365, 'YYYY-MM-DD')));
  return jsonb_build_object('off_target', (select count(*) from jsonb_array_elements(v->'kpis') e where e->>'status' = 'off_target'),
    'measured', (select count(*) from jsonb_array_elements(v->'kpis') e where e->>'status' in ('on_target','off_target')),
    'not_measured', (select count(*) from jsonb_array_elements(v->'kpis') e where e->>'status' = 'not_measured'));
end $$;

create view public.watchtower_health_scorecard with (security_invoker = true) as
  select 'watchtower'::text as module, 'scorecard_off_target'::text as metric, 'Scorecard KPIs off target (all clients, 12 months)'::text as label,
         coalesce((h->>'off_target')::numeric, 0) as value, 0::numeric as target,
         case when coalesce((h->>'off_target')::int, 0) = 0 then 'ok' when (h->>'off_target')::int <= 3 then 'warn' else 'bad' end as status
    from (select public.scorecard_health() as h) x where public.is_internal();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.rpt_spec_lines, public.scorecard_kpis, public.scorecard_targets, public.watchtower_health_scorecard from authenticated, anon;
revoke all on public.rpt_spec_lines, public.scorecard_kpis, public.scorecard_targets, public.watchtower_health_scorecard from anon;
revoke execute on function public._sc_lines(uuid[], jsonb), public._sc_bundles(uuid[], jsonb), public._sc_survey(uuid[], jsonb), public._sc_report(uuid[], jsonb),
  public._sc_target(text, uuid, text, date), public._sc_internal_scope(uuid), public._sc_options(uuid[]), public._otif_crm_review_generate_pack(uuid)
  from public, anon, authenticated;
revoke execute on function public.rpt_client_lines(uuid), public.scorecard_report(uuid, jsonb), public.scorecard_values(uuid, jsonb), public.scorecard_influence(uuid, jsonb),
  public.scorecard_country_kpis(uuid, jsonb), public.scorecard_callouts(uuid, jsonb), public.scorecard_target(text, uuid, text, date), public.scorecard_options(uuid),
  public.client_portal_scorecard(uuid, jsonb), public.crm_review_generate_pack(uuid), public.scorecard_health(),
  public._sc_kpi(text, date), public._sc_param(text, text, numeric), public._fx_eur(text), public._sc_spec_group(text), public._sc_value_band(numeric),
  public._brief_completeness(public.briefs), public._sc_arr(jsonb, text), public._sc_kpi_value(jsonb, jsonb), public._sc_status(text, numeric, numeric, boolean),
  public._sc_route_label(text), public._sc_fmt(text, numeric), public._sc_influence_metrics(jsonb) from public, anon;
grant execute on function public.rpt_client_lines(uuid), public.scorecard_report(uuid, jsonb), public.scorecard_values(uuid, jsonb), public.scorecard_influence(uuid, jsonb),
  public.scorecard_country_kpis(uuid, jsonb), public.scorecard_callouts(uuid, jsonb), public.scorecard_target(text, uuid, text, date), public.scorecard_options(uuid),
  public.client_portal_scorecard(uuid, jsonb), public.crm_review_generate_pack(uuid), public.scorecard_health(),
  -- used inside the security-invoker reporting view
  public._sc_kpi(text, date), public._sc_param(text, text, numeric), public._fx_eur(text), public._sc_spec_group(text), public._sc_value_band(numeric),
  public._brief_completeness(public.briefs), public._sc_arr(jsonb, text), public._sc_kpi_value(jsonb, jsonb), public._sc_status(text, numeric, numeric, boolean),
  public._sc_route_label(text), public._sc_fmt(text, numeric), public._sc_influence_metrics(jsonb) to authenticated;
