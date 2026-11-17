-- New brief, "Existing rate card": the user picks an approved rate card instead of writing a brief from scratch.
-- Adopt (the size and quantity fit the card) and Adapt (a changed size inside the tolerance band) skip the concept and ideation steps:
-- the brief, a job and a finished spec are created at once, the card's Impact Grade is copied onto the spec, and the line is routed
-- to the card's price. Routing a line away from an RFQ is a sourcing lead's decision, as everywhere else: a lead's brief is routed
-- (or sent for the second-lead approval the policy asks for); anyone else's leaves the line parked at Create with the card attached,
-- ready for a lead to confirm from the spec page.

alter table public.briefs
  add column if not exists rate_card_id uuid references public.library_records(id) on delete set null,
  add column if not exists rate_card_route text check (rate_card_route in ('adopt', 'adapt', 'push'));

create or replace function public.brief_from_rate_card(p_card uuid, p_client uuid, p_market text, p_title text, p_quantity int,
  p_length numeric default null, p_width numeric default null, p_target date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb; cl public.sourcing_clients; cfg public.sourcing_settings; mk public.markets; g public.rate_card_grades;
  v_card_len numeric; v_card_wid numeric; v_card_area numeric; v_area numeric; v_len numeric; v_wid numeric; v_dev numeric;
  v_min int; v_max int; v_qty_ok boolean; v_price numeric; v_route text; v_cur text; v_sub uuid; v_sup uuid;
  v_brief uuid; v_job uuid; v_spec uuid; v_tid uuid; v_outcome text; v_conf numeric; v_name text; v_type text;
begin
  perform public._briefing_require_internal();
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the brief a title'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Give the quantity you need'; end if;
  select * into mk from public.markets where code = upper(trim(coalesce(p_market, '')));
  if mk.code is null then raise exception 'Choose a market'; end if;
  select * into cl from public.sourcing_clients where id = p_client;
  if cl.id is null then raise exception 'Choose a client'; end if;

  select e into c from jsonb_array_elements(public.sourcing_rate_cards()) e where (e->>'id')::uuid = p_card;
  if c is null then raise exception 'Rate card not found'; end if;
  if not (c->>'selectable')::boolean then
    raise exception 'This rate card cannot be used yet: it must be active, in date, have an eligible supplier and a reviewed Impact Grade';
  end if;
  if c->>'client_code' is not null and c->>'client_code' <> cl.code then raise exception 'This rate card is only for client %', c->>'client_code'; end if;
  select * into cfg from public.sourcing_settings where id;
  select * into g from public.rate_card_grades where card_id = p_card;

  v_name := c->>'name'; v_type := coalesce(c->>'spec_type', '2d'); v_cur := coalesce(nullif(c->>'currency', ''), 'EUR');
  v_card_len := nullif(c->>'length_mm', '')::numeric; v_card_wid := nullif(c->>'width_mm', '')::numeric;
  v_len := coalesce(p_length, v_card_len); v_wid := coalesce(p_width, v_card_wid);
  v_card_area := v_card_len * v_card_wid; v_area := v_len * v_wid;
  v_dev := case when v_card_area is null and v_area is null then 0 when v_card_area is null or v_area is null or v_card_area = 0 then 100
                else abs(v_area - v_card_area) / v_card_area * 100 end;
  if v_dev > cfg.triage_tolerance_percent then
    raise exception 'That size is % percent away from the card, outside the % percent band. Start a normal brief so it can go to an RFQ', round(v_dev, 1), cfg.triage_tolerance_percent;
  end if;
  v_min := coalesce(nullif(c->>'min_qty', '')::int, 0); v_max := nullif(c->>'max_qty', '')::int;
  v_qty_ok := p_quantity >= v_min and (v_max is null or p_quantity <= v_max);
  v_price := round((c->>'unit_price')::numeric * case when v_area is not null and v_card_area is not null and v_card_area > 0 then v_area / v_card_area else 1 end, 4);
  v_route := case when v_dev <= 0.5 and v_qty_ok then 'adopt'
                  when v_qty_ok and v_price * p_quantity <= cfg.instant_price_limit then 'adapt'
                  else 'push' end;
  v_conf := greatest(0, 1 - v_dev / 100 - case when v_qty_ok then 0 else 0.05 end);
  v_sup := nullif(c->>'supplier_id', '')::uuid;
  select id into v_sub from public.library_records where library_key = 'substrates' and status = 'active' and code = c->>'substrate_code' order by version desc limit 1;

  -- The brief: no concepts, no approval round; it records which card it started from.
  insert into public.briefs (title, created_by) values (trim(p_title), auth.uid()) returning id into v_brief;
  perform public._brief_apply(v_brief, jsonb_build_object('title', trim(p_title), 'client', cl.name, 'region', mk.region_code, 'market', mk.code,
    'currency', v_cur, 'target_launch', p_target, 'brief_text', coalesce(nullif(trim(p_note), ''), 'Started from rate card ' || v_name || '.'),
    'product_category', v_name));
  update public.briefs set status = 'spec_created', rate_card_id = p_card, rate_card_route = v_route where id = v_brief;

  insert into public.jobs (title, client_id, region, market, brief_id, campaign_name, currency, target_delivery_date, notes)
  values (trim(p_title), cl.id, mk.region_code, mk.name, v_brief, trim(p_title), v_cur, p_target, 'Started from rate card ' || (c->>'code') || ' (' || v_name || ').')
  returning id into v_job;
  update public.briefs set resulting_job_id = v_job where id = v_brief;

  insert into public.job_specs (job_id, title, spec_type, size_unit, substrate_id, brief_id, description, spec_data)
  values (v_job, left(trim(p_title), 200), v_type, 'mm', v_sub, v_brief,
    'Started from rate card ' || v_name || ' (' || (c->>'code') || ').' || case when v_route = 'adopt' then ' Size and quantity match the card.' else ' Size or quantity differs from the card.' end,
    jsonb_build_object('seeded_from', jsonb_build_object('rate_card_id', p_card, 'rate_card_code', c->>'code', 'brief_id', v_brief, 'route', v_route)))
  returning id into v_spec;
  insert into public.spec_versions (spec_id, name, quantity, finished_length, finished_width) values (v_spec, 'Main', p_quantity, v_len, v_wid);

  -- The card's Impact Grade travels with the line. An adapted line is marked for a recalculation.
  insert into public.impact_grade_records (subject_kind, subject_id, job_id, brief_id, supplier_id, stage, score, letter, coverage, confidence,
    range_low, range_high, pef_mpt, supplier_score, inputs, tiers, sub_scores, warnings, review_status, reviewed_by, reviewed_at, review_note, updated_by)
  values ('spec', v_spec, v_job, v_brief, v_sup, 'spec', g.score, g.letter, g.coverage, g.confidence, g.range_low, g.range_high, g.pef_mpt, g.supplier_score,
    jsonb_build_object('from_rate_card', jsonb_build_object('card_id', p_card, 'code', c->>'code', 'adapted', v_route <> 'adopt')), g.tiers, g.sub_scores,
    case when v_route = 'adopt' then g.warnings else g.warnings || to_jsonb('Adapted from rate card ' || (c->>'code') || ': recalculate for the changed size or quantity') end,
    case when v_route = 'adopt' then g.review_status else 'unreviewed' end,
    case when v_route = 'adopt' then g.reviewed_by end, case when v_route = 'adopt' then g.reviewed_at end,
    'Copied from rate card ' || (c->>'code'), auth.uid());
  update public.job_specs set impact_grade = g.score where id = v_spec;

  -- Park the line at Create with the card's price, then route it away from the RFQ if the user may.
  v_tid := public._triage_insert(v_spec, 'create', 'Rate card "' || v_name || '" chosen at brief creation', v_conf, p_card, v_price, v_cur, p_quantity, null, 'override');
  if public.sourcing_is_lead() then
    v_tid := public.spec_triage_override(v_spec, v_route, 'Started from rate card ' || v_name);
    v_outcome := case when v_tid is null then 'awaiting_approval' else 'routed' end;
  else
    v_outcome := 'needs_lead';
  end if;
  perform public._brief_event(v_brief, 'created_from_rate_card', null, 'spec_created', (c->>'code') || ' / ' || v_route || ' / ' || v_outcome);
  perform public._sourcing_event(v_job, 'spec', v_spec, 'spec_from_rate_card', jsonb_build_object('card', c->>'code', 'route', v_route, 'outcome', v_outcome, 'size_deviation', round(v_dev, 1), 'quantity_ok', v_qty_ok));
  return jsonb_build_object('brief_id', v_brief, 'job_id', v_job, 'spec_id', v_spec, 'route', v_route, 'outcome', v_outcome, 'unit_price', v_price, 'currency', v_cur);
end $$;
revoke execute on function public.brief_from_rate_card(uuid, uuid, text, text, int, numeric, numeric, date, text) from public, anon;
grant execute on function public.brief_from_rate_card(uuid, uuid, text, text, int, numeric, numeric, date, text) to authenticated;
