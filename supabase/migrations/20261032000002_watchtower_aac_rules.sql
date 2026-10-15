-- AAC classification rules (Adopt / Adapt / Create, plus Push) as a governed master Watchtower library.
--
-- Before this migration spec_triage_run (20261011000001) routed every spec line with fixed logic:
--   * no live rate card for the spec type + material + client + currency → Create;
--   * nearest card within 0.5 % of the size and the quantity inside the card's range → Adopt (supplier blocked → Create);
--   * inside the tolerance band (sourcing_settings.triage_tolerance_percent, default 10 %): price scaled from the card;
--     value over sourcing_settings.instant_price_limit → Create; confidence ≥ sourcing_settings.push_confidence_threshold
--     with an eligible supplier → Push; no eligible supplier → Create; otherwise Adapt;
--   * outside the band → Create.
-- There were no tolerance-band or should-cost libraries: the band, push threshold and instant-price limit were Sourcing
-- settings, and the 0.5 % exact-match margin was hard-coded.
--
-- Now:
--   * library aac_classification_rules (owner watchtower, maker-checker, effective-dated). One record per rule: route,
--     plain definition, criteria, scope (form type / category / subcategory / product type from the product taxonomy,
--     client, market), priority and note.
--   * For each route the rule that applies to a spec is the most specific active one in scope:
--       product type > subcategory > category > form type > default (no taxonomy scope), then client, then market,
--       then the lowest priority number, then the newest version.
--   * Criteria values left blank fall back to the Sourcing settings, so the seeded defaults (blank band, push threshold
--     and value limit; 0.5 % exact margin) give exactly the old outcomes.
--   * spec_triage_run reads: exact-match margin and quantity-range flag (Adopt rule), tolerance band and value limit
--     (Adapt rule), push confidence (Push rule), supplier quality floor (any route rule), and Create rules that force an
--     RFQ for given spec forms or complexities. Rate-card matching, size scaling, confidence maths and the SRM
--     purchasing-block check stay in code (a blocked supplier can never be routed away from an RFQ).
--   * spec_triage records the applied rule (aac_rule_id, aac_rule_code) and registers it in library_refs.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('aac_classification_rules', 'watchtower', 'AAC classification rules',
   'How triage routes each spec line before an RFQ: Adopt (rate-card item as it is), Adapt (priced from a card inside the tolerance band), Push (we state the price, the supplier confirms) or Create (run an RFQ). Scoped by the product taxonomy, client and market; the most specific rule wins.',
   true, 25)
on conflict (key) do nothing;

-- Seeded defaults: identical outcomes to triage-rules-v1. Blank criteria = Sourcing settings.
insert into public.library_records (library_key, code, name, data, status, effective_from, effective_to, notes) values
  ('aac_classification_rules', 'AAC-ADOPT-DEFAULT', 'Adopt: exact rate-card match',
   jsonb_build_object('route', 'adopt', 'priority', 100, 'exact_match_percent', 0.5, 'allow_quantity_outside_range', false,
     'definition', 'Use a rate-card item as it is. The spec matches a live rate card for its type, material, client and currency within the exact-match margin, the quantity is inside the card''s range and the card''s supplier is cleared for purchasing in SRM. The card price applies.',
     'note', 'Default for every spec. Same outcome as triage before the AAC library.'),
   'active', '2026-01-01', null, 'Seeded from triage-rules-v1'),
  ('aac_classification_rules', 'AAC-ADAPT-DEFAULT', 'Adapt: priced from the card inside the band',
   jsonb_build_object('route', 'adapt', 'priority', 100,
     'definition', 'Price from the nearest live rate card, scaled to size, without an RFQ. The spec is inside the tolerance band of the card, the line value is under the value limit and the card''s supplier is eligible.',
     'note', 'Tolerance band and value limit are blank, so they come from Sourcing settings (10% and 25,000 by default).'),
   'active', '2026-01-01', null, 'Seeded from triage-rules-v1'),
  ('aac_classification_rules', 'AAC-PUSH-DEFAULT', 'Push: we state the price, the supplier confirms',
   jsonb_build_object('route', 'push', 'priority', 100,
     'definition', 'An Adapt line whose price confidence is at or above the push threshold goes to the card''s supplier, who accepts or declines the stated price within the respond-by days. Declined lines go to an RFQ.',
     'note', 'Push threshold is blank, so it comes from Sourcing settings (0.90 by default).'),
   'active', '2026-01-01', null, 'Seeded from triage-rules-v1'),
  ('aac_classification_rules', 'AAC-CREATE-DEFAULT', 'Create: run an RFQ',
   jsonb_build_object('route', 'create', 'priority', 100,
     'definition', 'Run an RFQ when no live rate card matches, the nearest card is outside the band, the value is over the limit, the supplier is not eligible, or a Create rule forces it.',
     'note', 'The fallback. It forces nothing on its own.'),
   'active', '2026-01-01', null, 'Seeded from triage-rules-v1'),
  ('aac_classification_rules', 'AAC-CREATE-IDEATION', 'Create: ideation and open specs',
   jsonb_build_object('route', 'create', 'priority', 50, 'force_spec_forms', jsonb_build_array('ideation', 'open'),
     'definition', 'Ideation and open specs always go to an RFQ, because there is no fixed spec to price from a card.',
     'note', 'Switched off when seeded so triage outcomes do not change. Reactivate it in the library to apply it.'),
   'retired', '2026-01-01', '2026-01-01', 'Seeded switched off');

-- spec_triage: which rule decided the route.
alter table public.spec_triage
  add column if not exists aac_rule_id uuid references public.library_records(id),
  add column if not exists aac_rule_code text;

-- Scope specificity: taxonomy level first (product type 4 … default 0), then client, then market.
create or replace function public._aac_specificity(d jsonb) returns int language sql immutable as $$
  select (case when nullif(trim(d->>'scope_product_type_code'), '') is not null then 4
               when nullif(trim(d->>'scope_subcategory_code'), '') is not null then 3
               when nullif(trim(d->>'scope_category_code'), '') is not null then 2
               when nullif(trim(d->>'scope_form_type'), '') is not null then 1 else 0 end) * 10
       + case when nullif(trim(d->>'scope_client_code'), '') is not null then 2 else 0 end
       + case when nullif(trim(d->>'scope_market'), '') is not null then 1 else 0 end;
$$;

-- Rules of a route that are in scope for a spec on a date, most specific first.
create or replace function public.aac_rules_for(p_spec uuid, p_route text, p_date date default current_date)
returns setof public.library_records language sql stable security definer set search_path = public as $$
  with s as (
    select sp.tax_form_type, upper(c.code) as cat_code, upper(sc.code) as sub_code, upper(pt.code) as pt_code,
           upper(cl.code) as client_code, public._market_code(j.market) as mk
      from public.job_specs sp join public.jobs j on j.id = sp.job_id
      left join public.sourcing_clients cl on cl.id = j.client_id
      left join public.tax_categories c on c.id = sp.tax_category_id
      left join public.tax_subcategories sc on sc.id = sp.tax_subcategory_id
      left join public.tax_product_types pt on pt.id = sp.tax_product_type_id
     where sp.id = p_spec)
  select r.* from public.library_records r cross join s
   where public.is_internal() and r.library_key = 'aac_classification_rules' and r.status = 'active'
     and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)
     and r.data->>'route' = p_route
     and (nullif(trim(r.data->>'scope_form_type'), '') is null or r.data->>'scope_form_type' = s.tax_form_type)
     and (nullif(trim(r.data->>'scope_category_code'), '') is null or upper(trim(r.data->>'scope_category_code')) = s.cat_code)
     and (nullif(trim(r.data->>'scope_subcategory_code'), '') is null or upper(trim(r.data->>'scope_subcategory_code')) = s.sub_code)
     and (nullif(trim(r.data->>'scope_product_type_code'), '') is null or upper(trim(r.data->>'scope_product_type_code')) = s.pt_code)
     and (nullif(trim(r.data->>'scope_client_code'), '') is null or upper(trim(r.data->>'scope_client_code')) = s.client_code)
     and (nullif(trim(r.data->>'scope_market'), '') is null or public._market_code(r.data->>'scope_market') = s.mk)
   order by public._aac_specificity(r.data) desc, coalesce(nullif(r.data->>'priority', '')::int, 100), r.effective_from desc, r.version desc;
$$;

-- The rule that applies per route for a spec, with the effective criteria (blank → Sourcing settings). For the UI and tests.
create or replace function public.aac_effective_rules(p_spec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.sourcing_settings; v jsonb := '{}'::jsonb; rt text; r public.library_records;
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can see triage rules' using errcode = '42501'; end if;
  select * into cfg from public.sourcing_settings where id;
  foreach rt in array array['adopt','adapt','push','create'] loop
    select * into r from public.aac_rules_for(p_spec, rt) limit 1;
    v := v || jsonb_build_object(rt, case when r.id is null then null else jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'version', r.version,
      'specificity', public._aac_specificity(r.data), 'data', r.data) end);
  end loop;
  return v || jsonb_build_object('effective', jsonb_build_object(
    'exact_match_percent', coalesce(nullif(v->'adopt'->'data'->>'exact_match_percent', '')::numeric, 0.5),
    'tolerance_percent', coalesce(nullif(v->'adapt'->'data'->>'tolerance_percent', '')::numeric, cfg.triage_tolerance_percent),
    'max_value', coalesce(nullif(v->'adapt'->'data'->>'max_value', '')::numeric, cfg.instant_price_limit),
    'min_confidence', coalesce(nullif(v->'push'->'data'->>'min_confidence', '')::numeric, cfg.push_confidence_threshold)));
end $$;

create or replace function public._aac_list(d jsonb, k text) returns text[] language sql immutable as $$
  select case when jsonb_typeof(d->k) = 'array' then array(select lower(trim(x)) from jsonb_array_elements_text(d->k) x where trim(x) <> '')
              when nullif(trim(d->>k), '') is not null then array(select lower(trim(x)) from regexp_split_to_table(d->>k, '[,;\n]') x where trim(x) <> '')
              else '{}'::text[] end;
$$;

-- Rule-driven triage (h.i.ve). Same inputs and matching as before; thresholds and forcing criteria from the AAC rules.
create or replace function public.spec_triage_run(p_spec uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.job_specs; j public.jobs; c public.sourcing_clients; cfg public.sourcing_settings;
  v_sub uuid; v_sub_code text; v_qty int; v_len numeric; v_wid numeric; v_unit text; v_mm numeric; v_area numeric;
  b record; v_price numeric; v_conf numeric; v_value numeric; v_sup public.suppliers;
  ra public.library_records; rd public.library_records; rp public.library_records; rc public.library_records; rf public.library_records;
  v_exact numeric; v_qty_any boolean; v_tol numeric; v_limit numeric; v_push numeric; v_score numeric; v_floor numeric;
  o_route text; o_reason text; o_conf numeric; o_card uuid; o_price numeric; o_sup uuid; o_rule public.library_records; v_id uuid;
begin
  if not public.is_internal() then raise exception 'Only internal staff can triage specs' using errcode = '42501'; end if;
  select * into s from public.job_specs where id = p_spec;
  if s.id is null then raise exception 'Spec not found'; end if;
  if s.is_draft then raise exception 'Finish the spec before triage'; end if;
  if exists (select 1 from public.spec_triage where spec_id = p_spec and is_current and route = 'push' and push_status = 'accepted') then
    raise exception 'The supplier has accepted the pushed price for this spec; it can''t be re-triaged';
  end if;
  select * into j from public.jobs where id = s.job_id;
  select * into c from public.sourcing_clients where id = j.client_id;
  select * into cfg from public.sourcing_settings where id;

  -- The rule per route (most specific in scope); blank criteria fall back to Sourcing settings.
  select * into ra from public.aac_rules_for(p_spec, 'adopt') limit 1;
  select * into rd from public.aac_rules_for(p_spec, 'adapt') limit 1;
  select * into rp from public.aac_rules_for(p_spec, 'push') limit 1;
  select * into rc from public.aac_rules_for(p_spec, 'create') limit 1;
  v_exact := coalesce(nullif(ra.data->>'exact_match_percent', '')::numeric, 0.5);
  v_qty_any := coalesce((ra.data->>'allow_quantity_outside_range')::boolean, false);
  v_tol := coalesce(nullif(rd.data->>'tolerance_percent', '')::numeric, cfg.triage_tolerance_percent);
  v_limit := coalesce(nullif(rd.data->>'max_value', '')::numeric, cfg.instant_price_limit);
  v_push := coalesce(nullif(rp.data->>'min_confidence', '')::numeric, cfg.push_confidence_threshold);

  v_sub := coalesce(s.substrate_id, (select substrate_id from public.spec_components
                                     where spec_id = p_spec and not is_packaging and substrate_id is not null
                                     order by sort, created_at limit 1));
  select code into v_sub_code from public.library_records where id = v_sub;
  select coalesce(sum(quantity), 0) into v_qty from public.spec_versions where spec_id = p_spec;
  if v_qty = 0 then raise exception 'Add at least one version with a quantity before triage'; end if;
  select finished_length, finished_width into v_len, v_wid from public.spec_versions where spec_id = p_spec order by sort, created_at limit 1;
  v_unit := coalesce(s.size_unit, s.spec_data->>'size_unit');
  v_mm := case v_unit when 'mm' then 1 when 'cm' then 10 when 'in' then 25.4 end;
  v_area := case when v_len is not null and v_wid is not null and v_mm is not null then (v_len * v_mm) * (v_wid * v_mm) end;

  -- Create rules that force an RFQ (spec form or complexity), most specific first.
  for rf in select * from public.aac_rules_for(p_spec, 'create') loop
    if lower(coalesce(s.spec_form, '')) = any (public._aac_list(rf.data, 'force_spec_forms')) then
      o_route := 'create'; o_rule := rf; o_conf := 0;
      o_reason := format('Rule %s: %s specs go to an RFQ.', rf.code, initcap(s.spec_form));
      exit;
    elsif s.complexity is not null and lower(s.complexity) = any (public._aac_list(rf.data, 'force_complexity')) then
      o_route := 'create'; o_rule := rf; o_conf := 0;
      o_reason := format('Rule %s: %s-complexity specs go to an RFQ.', rf.code, initcap(s.complexity));
      exit;
    end if;
  end loop;

  if o_route is null then
    select r.id, r.name, r.data, sup.id as supplier_id, coalesce((r.data->>'unit_price')::numeric, 0) as price,
           (r.data->>'client_code') is not null as client_specific,
           case when ca.area is null and v_area is null then 0
                when ca.area is null or v_area is null then 100
                else abs(v_area - ca.area) / ca.area * 100 end as size_dev,
           ca.area as card_area,
           (v_qty >= coalesce((r.data->>'min_qty')::int, 0) and (r.data->>'max_qty' is null or v_qty <= (r.data->>'max_qty')::int)) as qty_ok
      into b
      from public.library_records r
      cross join lateral (select (r.data->>'finished_length_mm')::numeric * (r.data->>'finished_width_mm')::numeric as area) ca
      left join public.suppliers sup on sup.supplier_code = r.data->>'supplier_code'
     where r.library_key = 'rate_cards' and r.status = 'active'
       and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date)
       and r.data->>'spec_type' = s.spec_type
       and (r.data->>'client_code' is null or r.data->>'client_code' = c.code)
       and (r.data->>'substrate_code' is null or r.data->>'substrate_code' = v_sub_code)
       and coalesce(r.data->>'currency', j.currency) = j.currency
     order by size_dev, qty_ok desc, client_specific desc, r.effective_from desc
     limit 1;

    if b.id is null then
      o_route := 'create'; o_rule := rc; o_conf := 0;
      o_reason := 'No live rate card matches this spec type and material: run an RFQ.';
    else
      if b.supplier_id is not null then select * into v_sup from public.suppliers where id = b.supplier_id; end if;
      if v_sup.id is not null then
        select p.composite_score into v_score from public.performance_records p
         where p.supplier_id = v_sup.id and p.composite_score is not null order by p.period desc limit 1;
      end if;

      if b.size_dev <= v_exact and (b.qty_ok or v_qty_any) then
        v_floor := nullif(ra.data->>'min_supplier_score', '')::numeric;
        if v_sup.id is not null and (not v_sup.active or v_sup.purchasing_blocked) then
          o_route := 'create'; o_rule := rc; o_conf := 0.5; o_card := b.id; o_price := b.price;
          o_reason := format('Exact match to rate card "%s", but its supplier %s is blocked for purchasing in SRM: run an RFQ.', b.name, v_sup.name);
        elsif v_floor is not null and (v_score is null or v_score < v_floor) then
          o_route := 'create'; o_rule := ra; o_conf := 0.5; o_card := b.id; o_price := b.price;
          o_reason := format('Exact match to rate card "%s", but rule %s needs a supplier quality score of at least %s (%s has %s): run an RFQ.',
            b.name, ra.code, v_floor, coalesce(v_sup.name, 'the card supplier'), coalesce(round(v_score, 1)::text, 'none'));
        else
          o_route := 'adopt'; o_rule := ra; o_conf := case when b.client_specific then 1.0 else 0.95 end;
          o_card := b.id; o_price := b.price; o_sup := v_sup.id;
          o_reason := format('Exact match to rate card "%s": card price applies.', b.name);
        end if;
      elsif b.size_dev <= v_tol then
        v_price := b.price * case when v_area is not null and b.card_area is not null then v_area / b.card_area else 1 end;
        v_conf := greatest(0, 1 - b.size_dev / 100 - case when b.qty_ok then 0 else 0.05 end);
        v_value := v_price * v_qty;
        o_conf := v_conf; o_card := b.id; o_price := v_price;
        if v_value > v_limit then
          o_route := 'create'; o_rule := rd;
          o_reason := format('Priced in band from "%s" (%s%% off), but the value %s is over the instant-price limit of %s: run an RFQ.',
            b.name, round(b.size_dev, 1), round(v_value, 2), v_limit);
        elsif v_conf >= v_push and v_sup.id is not null and v_sup.active and not v_sup.purchasing_blocked
              and (nullif(rp.data->>'min_supplier_score', '') is null or coalesce(v_score, -1) >= (rp.data->>'min_supplier_score')::numeric) then
          o_route := 'push'; o_rule := rp; o_sup := v_sup.id;
          o_reason := format('Inside the ±%s%% band of "%s" with %s confidence: we state the price and %s confirms.',
            v_tol, b.name, round(v_conf * 100) || '%', v_sup.name);
        elsif v_sup.id is null or not v_sup.active or v_sup.purchasing_blocked then
          o_route := 'create'; o_rule := rc;
          o_reason := format('Inside the band of "%s" but the card has no eligible supplier: run an RFQ.', b.name);
        elsif nullif(rd.data->>'min_supplier_score', '') is not null and coalesce(v_score, -1) < (rd.data->>'min_supplier_score')::numeric then
          o_route := 'create'; o_rule := rd;
          o_reason := format('Inside the band of "%s", but rule %s needs a supplier quality score of at least %s (%s has %s): run an RFQ.',
            b.name, rd.code, rd.data->>'min_supplier_score', v_sup.name, coalesce(round(v_score, 1)::text, 'none'));
        else
          o_route := 'adapt'; o_rule := rd; o_sup := v_sup.id;
          o_reason := format('Inside the ±%s%% band of "%s" (%s%% off): priced from the card, no RFQ.', v_tol, b.name, round(b.size_dev, 1));
        end if;
      else
        o_route := 'create'; o_rule := rc; o_conf := 0;
        o_reason := format('Nearest rate card "%s" is %s%% off, outside the ±%s%% band: run an RFQ.', b.name, round(b.size_dev, 1), v_tol);
      end if;
    end if;
  end if;

  v_id := public._triage_insert(p_spec, o_route, o_reason, o_conf, o_card, o_price, j.currency, v_qty,
    case when o_route = 'create' then null else o_sup end, 'rule');
  if o_rule.id is not null then
    update public.spec_triage set aac_rule_id = o_rule.id, aac_rule_code = o_rule.code where id = v_id;
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (o_rule.id, 'spec_triage', v_id::text, 'Triage decision')
    on conflict do nothing;
  end if;
  return v_id;
end $$;

-- Which rule decided the current triage of each spec, by route (for the Watchtower AAC tab).
create or replace function public.aac_rule_usage() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('route', route, 'rule_code', coalesce(aac_rule_code, 'before AAC rules'), 'lines', n)
                            order by route, n desc), '[]'::jsonb)
    from (select route, aac_rule_code, count(*) as n from public.spec_triage where is_current and source = 'rule' group by 1, 2) x
   where public.is_internal();
$$;

revoke execute on function public._aac_specificity(jsonb), public._aac_list(jsonb, text) from public, anon;
revoke execute on function public.aac_rules_for(uuid, text, date), public.aac_effective_rules(uuid), public.aac_rule_usage() from public, anon;
grant execute on function public.aac_rules_for(uuid, text, date), public.aac_effective_rules(uuid), public.aac_rule_usage(),
  public._aac_specificity(jsonb), public._aac_list(jsonb, text) to authenticated;
